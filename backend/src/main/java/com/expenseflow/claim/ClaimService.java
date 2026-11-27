package com.expenseflow.claim;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import com.expenseflow.approval.ApprovalRules;
import com.expenseflow.approval.ApprovalService;
import com.expenseflow.audit.AuditService;
import com.expenseflow.claim.dto.ClaimDetail;
import com.expenseflow.claim.dto.ClaimSummary;
import com.expenseflow.claim.dto.LineRequest;
import com.expenseflow.common.BadRequestException;
import com.expenseflow.common.ConflictException;
import com.expenseflow.common.CurrentUser;
import com.expenseflow.common.ForbiddenException;
import com.expenseflow.common.NotFoundException;
import com.expenseflow.user.Employee;

/** Drafts, lines and receipts. Visibility and allowedActions come from ApprovalService/ApprovalRules. */
@Service
public class ClaimService {

    private static final Logger log = LoggerFactory.getLogger(ClaimService.class);
    private static final long MAX_RECEIPT_BYTES = 5L * 1024 * 1024;

    private final ClaimRepository claims;
    private final ApprovalService approvals;
    private final ReceiptStorage storage;
    private final AuditService audit;
    private final CurrentUser currentUser;
    private final Clock clock;

    public ClaimService(ClaimRepository claims, ApprovalService approvals, ReceiptStorage storage,
                        AuditService audit, CurrentUser currentUser, Clock clock) {
        this.claims = claims;
        this.approvals = approvals;
        this.storage = storage;
        this.audit = audit;
        this.currentUser = currentUser;
        this.clock = clock;
    }

    /** Own claims only, newest first. */
    @Transactional(readOnly = true)
    public List<ClaimSummary> listOwn() {
        Employee me = currentUser.get();
        return claims.findOwn(me.getId()).stream().map(ClaimSummary::from).toList();
    }

    @Transactional
    public ClaimDetail create(String title) {
        Employee me = currentUser.get();
        Claim claim = claims.save(new Claim(temporaryNumber(), me, title.trim(), Instant.now(clock)));
        claim.setClaimNumber(claimNumber(claim.getId()));
        audit.log(me, "CLAIM_CREATE", "CLAIM", claim.getId(), "title=" + claim.getTitle());
        log.info("Claim {} created by {}", claim.getId(), me.getId());
        return approvals.toDetail(claim, me);
    }

    @Transactional(readOnly = true)
    public ClaimDetail get(Long id) {
        Employee me = currentUser.get();
        return approvals.toDetail(approvals.loadVisible(id, me), me);
    }

    @Transactional
    public ClaimDetail updateTitle(Long id, String title) {
        Employee me = currentUser.get();
        Claim claim = loadEditable(id, me);
        claim.setTitle(title.trim());
        audit.log(me, "CLAIM_UPDATE", "CLAIM", id, "title=" + claim.getTitle());
        return approvals.toDetail(claim, me);
    }

    @Transactional
    public void delete(Long id) {
        Employee me = currentUser.get();
        Claim claim = approvals.loadVisible(id, me);
        if (!me.getId().equals(claim.getEmployee().getId())) {
            throw new ForbiddenException("Only the claimant can delete this claim.");
        }
        if (!ApprovalRules.canDelete(me.getId(), claim.getEmployee().getId(), claim.getStatus())) {
            throw new ConflictException("Only DRAFT claims can be deleted.");
        }
        List<String> files = claim.getLines().stream().map(ClaimLine::getReceiptPath).toList();
        claims.delete(claim);
        files.forEach(storage::delete);
        audit.log(me, "CLAIM_DELETE", "CLAIM", id, "claimNumber=" + claim.getClaimNumber());
        log.info("Claim {} deleted by {}", id, me.getId());
    }

    @Transactional
    public ClaimDetail addLine(Long id, LineRequest request) {
        Employee me = currentUser.get();
        Claim claim = loadEditable(id, me);
        ClaimLine line = new ClaimLine(request.category(), request.expenseDate(), money(request.amount()));
        apply(line, request);
        claim.addLine(line);
        recalculateTotal(claim);
        claims.flush();
        audit.log(me, "LINE_CREATE", "CLAIM", id, "lineId=" + line.getId() + ", " + request.category()
                + ", amount=" + line.getAmount());
        return approvals.toDetail(claim, me);
    }

    @Transactional
    public ClaimDetail updateLine(Long id, Long lineId, LineRequest request) {
        Employee me = currentUser.get();
        Claim claim = loadEditable(id, me);
        ClaimLine line = findLine(claim, lineId);
        line.setCategory(request.category());
        line.setExpenseDate(request.expenseDate());
        line.setAmount(money(request.amount()));
        apply(line, request);
        // The line changed, so any earlier policy result no longer applies until the next submit.
        line.setOutcome(null);
        line.getViolations().clear();
        recalculateTotal(claim);
        audit.log(me, "LINE_UPDATE", "CLAIM", id, "lineId=" + lineId + ", " + request.category()
                + ", amount=" + line.getAmount());
        return approvals.toDetail(claim, me);
    }

    @Transactional
    public ClaimDetail deleteLine(Long id, Long lineId) {
        Employee me = currentUser.get();
        Claim claim = loadEditable(id, me);
        ClaimLine line = findLine(claim, lineId);
        String file = line.getReceiptPath();
        claim.removeLine(line);
        recalculateTotal(claim);
        storage.delete(file);
        audit.log(me, "LINE_DELETE", "CLAIM", id, "lineId=" + lineId);
        return approvals.toDetail(claim, me);
    }

    @Transactional
    public ClaimDetail uploadReceipt(Long id, Long lineId, MultipartFile file) {
        Employee me = currentUser.get();
        Claim claim = loadEditable(id, me);
        ClaimLine line = findLine(claim, lineId);
        if (file == null || file.isEmpty()) {
            throw new BadRequestException("Choose a receipt file to upload.");
        }
        if (file.getSize() > MAX_RECEIPT_BYTES) {
            throw new BadRequestException("Receipt must be at most 5 MB.");
        }
        byte[] bytes = readBytes(file);
        String contentType = detectContentType(bytes);
        if (contentType == null) {
            throw new BadRequestException("Only PDF, JPEG or PNG receipts are allowed.");
        }
        String oldFile = line.getReceiptPath();
        line.setReceiptPath(storage.store(bytes));
        line.setReceiptHash(sha256(bytes));
        line.setReceiptContentType(contentType);
        line.setOutcome(null);
        line.getViolations().clear();
        storage.delete(oldFile);
        audit.log(me, "RECEIPT_UPLOAD", "CLAIM", id, "lineId=" + lineId + ", type=" + contentType
                + ", bytes=" + bytes.length);
        log.info("Receipt uploaded for claim {} line {} ({} bytes)", id, lineId, bytes.length);
        return approvals.toDetail(claim, me);
    }

    @Transactional(readOnly = true)
    public ReceiptFile receipt(Long id, Long lineId) {
        Employee me = currentUser.get();
        Claim claim = approvals.loadVisible(id, me);
        ClaimLine line = findLine(claim, lineId);
        if (line.getReceiptPath() == null) {
            throw new NotFoundException("No receipt file for this line.");
        }
        byte[] bytes = storage.read(line.getReceiptPath());
        if (bytes == null) {
            throw new NotFoundException("Receipt file is not available.");
        }
        return new ReceiptFile(bytes, line.getReceiptContentType());
    }

    // ------------------------------------------------------------------ helpers

    private Claim loadEditable(Long id, Employee me) {
        Claim claim = approvals.loadVisible(id, me);
        Long claimantId = claim.getEmployee().getId();
        if (!me.getId().equals(claimantId)) {
            throw new ForbiddenException("Only the claimant can change this claim.");
        }
        if (!ApprovalRules.canEdit(me.getId(), claimantId, claim.getStatus())) {
            throw new ConflictException("A claim can only be changed while in DRAFT or CLARIFICATION_REQUESTED.");
        }
        return claim;
    }

    private static ClaimLine findLine(Claim claim, Long lineId) {
        return claim.getLines().stream()
                .filter(l -> l.getId().equals(lineId))
                .findFirst()
                .orElseThrow(() -> new NotFoundException("Line not found."));
    }

    private static void apply(ClaimLine line, LineRequest r) {
        line.setVendor(trimToNull(r.vendor()));
        line.setCity(trimToNull(r.city()));
        line.setNights(r.nights());
        line.setDescription(trimToNull(r.description()));
    }

    /**
     * Lines changed: update the total. The approved amount belongs to the last policy run and is
     * recalculated on the next submit, so it is cleared here (it may not exceed the new total).
     */
    private static void recalculateTotal(Claim claim) {
        BigDecimal total = claim.getLines().stream().map(ClaimLine::getAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
        claim.setTotalAmount(money(total));
        claim.setApprovedAmount(money(BigDecimal.ZERO));
    }

    /** Content type from magic bytes, never from the client. */
    static String detectContentType(byte[] b) {
        if (b.length >= 4 && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F') {
            return "application/pdf";
        }
        if (b.length >= 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) {
            return "image/jpeg";
        }
        if (b.length >= 8 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G'
                && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A) {
            return "image/png";
        }
        return null;
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] readBytes(MultipartFile file) {
        try {
            return file.getBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static BigDecimal money(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP);
    }

    private static String trimToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    /** Placeholder until the id is known (claim_number is NOT NULL UNIQUE). */
    private static String temporaryNumber() {
        return "TMP-" + UUID.randomUUID().toString().substring(0, 24);
    }

    public static String claimNumber(Long id) {
        return String.format("CLM-%06d", id);
    }
}
