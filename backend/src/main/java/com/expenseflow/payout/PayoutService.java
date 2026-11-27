package com.expenseflow.payout;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.expenseflow.approval.ActionType;
import com.expenseflow.approval.ApprovalAction;
import com.expenseflow.approval.ApprovalActionRepository;
import com.expenseflow.audit.AuditService;
import com.expenseflow.claim.Claim;
import com.expenseflow.claim.ClaimRepository;
import com.expenseflow.claim.ClaimStatus;
import com.expenseflow.claim.dto.ClaimSummary;
import com.expenseflow.common.ConflictException;
import com.expenseflow.common.CurrentUser;
import com.expenseflow.common.NotFoundException;
import com.expenseflow.user.Employee;

/** Finance Head only (enforced in SecurityConfig). */
@Service
public class PayoutService {

    private static final Logger log = LoggerFactory.getLogger(PayoutService.class);

    private final PayoutBatchRepository batches;
    private final ClaimRepository claims;
    private final ApprovalActionRepository actions;
    private final AuditService audit;
    private final CurrentUser currentUser;
    private final Clock clock;

    public PayoutService(PayoutBatchRepository batches, ClaimRepository claims, ApprovalActionRepository actions,
                         AuditService audit, CurrentUser currentUser, Clock clock) {
        this.batches = batches;
        this.claims = claims;
        this.actions = actions;
        this.audit = audit;
        this.currentUser = currentUser;
        this.clock = clock;
    }

    /** APPROVED claims not yet in a batch. */
    @Transactional(readOnly = true)
    public List<ClaimSummary> eligible() {
        return claims.findEligibleForPayout().stream().map(ClaimSummary::from).toList();
    }

    @Transactional(readOnly = true)
    public List<PayoutBatchDto> list() {
        return batches.findAllByOrderByCreatedAtDesc().stream().map(PayoutBatchDto::from).toList();
    }

    /** Puts every eligible claim into a new batch (status EXPORTED). Claims stay APPROVED until marked paid. */
    @Transactional
    public PayoutBatchDto create() {
        Employee me = currentUser.get();
        List<Claim> eligible = claims.findEligibleForPayout();
        if (eligible.isEmpty()) {
            throw new ConflictException("There are no approved claims waiting for payout.");
        }
        PayoutBatch batch = batches.save(new PayoutBatch("TMP-" + UUID.randomUUID().toString().substring(0, 24),
                me, Instant.now(clock)));
        batch.setBatchNumber(batchNumber(batch.getId()));
        BigDecimal total = BigDecimal.ZERO;
        for (Claim c : eligible) {
            c.setPayoutBatch(batch);
            total = total.add(c.getApprovedAmount());
        }
        batch.setClaimCount(eligible.size());
        batch.setTotalAmount(total.setScale(2, RoundingMode.HALF_UP));
        audit.log(me, "PAYOUT_CREATE", "PAYOUT_BATCH", batch.getId(),
                batch.getBatchNumber() + ": " + eligible.size() + " claims, total " + batch.getTotalAmount());
        log.info("Payout batch {} created by {}: {} claims, total {}", batch.getBatchNumber(), me.getId(),
                eligible.size(), batch.getTotalAmount());
        return PayoutBatchDto.from(batch);
    }

    @Transactional
    public CsvFile exportCsv(Long batchId) {
        Employee me = currentUser.get();
        PayoutBatch batch = find(batchId);
        List<Claim> batchClaims = claims.findByPayoutBatchIdOrderByIdAsc(batchId);
        String csv = BankCsvWriter.write(batch, batchClaims);
        audit.log(me, "PAYOUT_EXPORT", "PAYOUT_BATCH", batchId, batch.getBatchNumber());
        log.info("Payout batch {} exported by {}", batch.getBatchNumber(), me.getId());
        return new CsvFile("payout_" + batch.getBatchNumber() + ".csv", csv);
    }

    @Transactional
    public PayoutBatchDto markPaid(Long batchId) {
        Employee me = currentUser.get();
        PayoutBatch batch = find(batchId);
        if (batch.getStatus() == PayoutStatus.PAID) {
            throw new ConflictException("This batch is already marked as paid.");
        }
        Instant now = Instant.now(clock);
        batch.setStatus(PayoutStatus.PAID);
        batch.setPaidAt(now);
        for (Claim c : claims.findByPayoutBatchIdOrderByIdAsc(batchId)) {
            ClaimStatus from = c.getStatus();
            c.setStatus(ClaimStatus.PAID);
            c.setPaidAt(now);
            actions.save(new ApprovalAction(c, me, null, ActionType.PAID, from, ClaimStatus.PAID,
                    "Paid in batch " + batch.getBatchNumber(), now));
        }
        audit.log(me, "PAYOUT_MARK_PAID", "PAYOUT_BATCH", batchId,
                batch.getBatchNumber() + ": " + batch.getClaimCount() + " claims");
        log.info("Payout batch {} marked paid by {}", batch.getBatchNumber(), me.getId());
        return PayoutBatchDto.from(batch);
    }

    private PayoutBatch find(Long id) {
        return batches.findById(id).orElseThrow(() -> new NotFoundException("Payout batch not found."));
    }

    public static String batchNumber(Long id) {
        return String.format("PB-%05d", id);
    }
}
