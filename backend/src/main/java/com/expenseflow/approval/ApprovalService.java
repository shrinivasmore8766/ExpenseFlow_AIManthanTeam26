package com.expenseflow.approval;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.expenseflow.approval.ApprovalRules.Actor;
import com.expenseflow.approval.ApprovalRules.ClaimState;
import com.expenseflow.approval.ApprovalRules.Decision;
import com.expenseflow.approval.ApprovalRules.Grant;
import com.expenseflow.audit.AuditService;
import com.expenseflow.claim.Claim;
import com.expenseflow.claim.ClaimRepository;
import com.expenseflow.claim.ClaimStatus;
import com.expenseflow.claim.dto.ClaimDetail;
import com.expenseflow.claim.dto.ClaimSummary;
import com.expenseflow.claim.dto.HistoryItem;
import com.expenseflow.common.BadRequestException;
import com.expenseflow.common.ConflictException;
import com.expenseflow.common.CurrentUser;
import com.expenseflow.common.ForbiddenException;
import com.expenseflow.common.NotFoundException;
import com.expenseflow.policy.ClaimDecision;
import com.expenseflow.policy.PolicyService;
import com.expenseflow.user.DelegationRepository;
import com.expenseflow.user.Employee;
import com.expenseflow.user.EmployeeRepository;
import com.expenseflow.user.Role;

/**
 * Claim workflow: submit, approve, reject, send back, bulk approve, the approval queue, plus
 * claim visibility and allowedActions. Every decision goes through {@link ApprovalRules};
 * every state change writes approval_action and audit_log in the same transaction.
 */
@Service
public class ApprovalService {

    private static final Logger log = LoggerFactory.getLogger(ApprovalService.class);
    private static final Set<ClaimStatus> PENDING =
            EnumSet.of(ClaimStatus.PENDING_MANAGER, ClaimStatus.PENDING_AUDITOR, ClaimStatus.PENDING_FINANCE_HEAD);
    private static final int QUEUE_LIMIT = 500;
    private static final int QUEUE_CANDIDATES = 5000;

    private final ClaimRepository claims;
    private final ApprovalActionRepository actions;
    private final DelegationRepository delegations;
    private final EmployeeRepository employees;
    private final PolicyService policy;
    private final AuditService audit;
    private final CurrentUser currentUser;
    private final Clock clock;

    public ApprovalService(ClaimRepository claims, ApprovalActionRepository actions, DelegationRepository delegations,
                           EmployeeRepository employees, PolicyService policy, AuditService audit,
                           CurrentUser currentUser, Clock clock) {
        this.claims = claims;
        this.actions = actions;
        this.delegations = delegations;
        this.employees = employees;
        this.policy = policy;
        this.audit = audit;
        this.currentUser = currentUser;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ visibility and detail

    /**
     * Loads a claim the viewer may see: claimant, Auditor, Finance Head, anyone who has acted on it,
     * or anyone who can act on it now. Otherwise 404, so existence is not revealed.
     */
    public Claim loadVisible(Long claimId, Employee viewer) {
        Claim claim = claims.findById(claimId).orElseThrow(ApprovalService::claimNotFound);
        if (!canView(claim, viewer, grantsOf(viewer))) {
            throw claimNotFound();
        }
        return claim;
    }

    public ClaimDetail toDetail(Claim claim, Employee viewer) {
        Decision act = decide(claim, viewer, grantsOf(viewer));
        List<String> allowed = ApprovalRules.allowedActions(actorOf(viewer), stateOf(claim), act);
        List<HistoryItem> history = actions.findHistory(claim.getId()).stream().map(HistoryItem::from).toList();
        return ClaimDetail.of(claim, history, allowed);
    }

    // ------------------------------------------------------------------ submit

    @Transactional
    public ClaimDetail submit(Long claimId) {
        Employee me = currentUser.get();
        Claim claim = loadVisible(claimId, me);
        Long claimantId = claim.getEmployee().getId();
        if (!me.getId().equals(claimantId)) {
            throw new ForbiddenException("Only the claimant can submit this claim.");
        }
        if (!ApprovalRules.canEdit(me.getId(), claimantId, claim.getStatus())) {
            throw new ConflictException("Only DRAFT or CLARIFICATION_REQUESTED claims can be submitted.");
        }
        if (claim.getLines().isEmpty()) {
            throw new BadRequestException("Add at least one expense line before submitting.");
        }

        ClaimStatus from = claim.getStatus();
        boolean resubmit = from == ClaimStatus.CLARIFICATION_REQUESTED;
        ClaimDecision decision = policy.evaluate(claim);
        ClaimStatus to = ApprovalRules.statusAfterSubmit(decision.status(), resubmit);
        boolean autoApproved = to == decision.status() && decision.autoApproved();
        Instant now = Instant.now(clock);

        claim.setStatus(to);
        claim.setTotalAmount(decision.totalAmount());
        claim.setApprovedAmount(decision.approvedAmount());
        claim.setHasViolations(decision.hasViolations());
        claim.setAutoApproved(autoApproved);
        claim.setSampleAudit(autoApproved && decision.sampleAudit());
        claim.setSubmittedAt(now);
        claim.setDecidedAt(ApprovalRules.isFinal(to) ? now : null);
        claim.setCurrentApprover(to == ClaimStatus.PENDING_MANAGER ? initialApprover(me) : null);

        actions.save(new ApprovalAction(claim, me, null, ActionType.SUBMIT, from, to, null, now));
        String summary = resubmit && to != decision.status()
                ? decision.summary() + " Resubmission restarts at the manager."
                : decision.summary();
        actions.save(new ApprovalAction(claim, null, null, ActionType.POLICY_DECISION, to, to, summary, now));
        audit.log(me, resubmit ? "CLAIM_RESUBMIT" : "CLAIM_SUBMIT", "CLAIM", claim.getId(),
                "status=" + to + ", total=" + decision.totalAmount() + ", approved=" + decision.approvedAmount()
                        + ", violations=" + decision.hasViolations());
        log.info("Claim {} submitted by {}: {} -> {} (approved {})", claim.getId(), me.getId(), from, to,
                decision.approvedAmount());
        return toDetail(claim, me);
    }

    // ------------------------------------------------------------------ approve / reject / send back

    @Transactional
    public ClaimDetail approve(Long claimId, String comment) {
        Employee me = currentUser.get();
        Claim claim = loadVisible(claimId, me);
        Decision decision = requireCanAct(claim, me, grantsOf(me));
        doApprove(claim, me, decision, comment);
        return toDetail(claim, me);
    }

    @Transactional
    public ClaimDetail reject(Long claimId, String comment) {
        Employee me = currentUser.get();
        Claim claim = loadVisible(claimId, me);
        Decision decision = requireCanAct(claim, me, grantsOf(me));
        transition(claim, me, decision, ActionType.REJECT, ClaimStatus.REJECTED, comment);
        return toDetail(claim, me);
    }

    @Transactional
    public ClaimDetail sendBack(Long claimId, String comment) {
        Employee me = currentUser.get();
        Claim claim = loadVisible(claimId, me);
        Decision decision = requireCanAct(claim, me, grantsOf(me));
        transition(claim, me, decision, ActionType.SEND_BACK, ClaimStatus.CLARIFICATION_REQUESTED, comment);
        return toDetail(claim, me);
    }

    /** Approve each claim only if the caller canAct and it has no violations; otherwise skip with a reason. */
    @Transactional
    public BulkApproveResult bulkApprove(List<Long> claimIds) {
        Employee me = currentUser.get();
        List<Grant> grants = grantsOf(me);
        List<Long> approved = new ArrayList<>();
        List<BulkApproveResult.Skipped> skipped = new ArrayList<>();
        for (Long id : new LinkedHashSet<>(claimIds)) {
            Claim claim = claims.findById(id).orElse(null);
            if (claim == null || !canView(claim, me, grants)) {
                skipped.add(new BulkApproveResult.Skipped(id, "Claim not found"));
                continue;
            }
            if (claim.isHasViolations()) {
                skipped.add(new BulkApproveResult.Skipped(id, "Has policy violations; review it individually"));
                continue;
            }
            Decision decision = decide(claim, me, grants);
            if (!decision.allowed()) {
                skipped.add(new BulkApproveResult.Skipped(id, decision.reason()));
                continue;
            }
            doApprove(claim, me, decision, "Bulk approved");
            approved.add(id);
        }
        audit.log(me, "CLAIM_BULK_APPROVE", "CLAIM", null,
                "approved=" + approved + ", skipped=" + skipped.stream().map(BulkApproveResult.Skipped::id).toList());
        log.info("Bulk approve by {}: {} approved, {} skipped", me.getId(), approved.size(), skipped.size());
        return new BulkApproveResult(approved, skipped);
    }

    // ------------------------------------------------------------------ queue

    /** Claims the caller can act on now (incl. via delegation), oldest first, max 500. */
    @Transactional(readOnly = true)
    public List<ClaimSummary> queue(ClaimStatus status, Long departmentId, BigDecimal minAmount, boolean flaggedOnly) {
        if (status != null && !status.isPending()) {
            throw new BadRequestException("status must be one of " + PENDING + ".");
        }
        Employee me = currentUser.get();
        List<Grant> grants = grantsOf(me);
        Collection<ClaimStatus> statuses = status == null ? PENDING : Set.of(status);
        List<Claim> candidates = claims.findByStatusInOldestFirst(statuses, PageRequest.of(0, QUEUE_CANDIDATES))
                .stream()
                .filter(c -> departmentId == null
                        || (c.getDepartment() != null && departmentId.equals(c.getDepartment().getId())))
                .filter(c -> minAmount == null || c.getApprovedAmount().compareTo(minAmount) >= 0)
                .filter(c -> !flaggedOnly || c.isHasViolations())
                .toList();
        Map<Long, Set<Long>> approvers = approversThisRound(candidates.stream().map(Claim::getId).toList());
        LocalDate today = LocalDate.now(clock);
        Actor actor = actorOf(me);
        return candidates.stream()
                .filter(c -> ApprovalRules.canAct(actor, stateOf(c), grants,
                        approvers.getOrDefault(c.getId(), Set.of()), today).allowed())
                .limit(QUEUE_LIMIT)
                .map(ClaimSummary::from)
                .toList();
    }

    // ------------------------------------------------------------------ internals

    private void doApprove(Claim claim, Employee me, Decision decision, String comment) {
        ClaimStatus next = ApprovalRules.statusAfterApprove(claim.getStatus(), claim.getApprovedAmount(),
                claim.isSampleAudit(),
                policy.decimalConfig(PolicyService.AUDITOR_THRESHOLD),
                policy.decimalConfig(PolicyService.FINANCE_HEAD_THRESHOLD));
        transition(claim, me, decision, ActionType.APPROVE, next, comment);
    }

    private void transition(Claim claim, Employee me, Decision decision, ActionType action, ClaimStatus to,
                            String comment) {
        ClaimStatus from = claim.getStatus();
        Instant now = Instant.now(clock);
        claim.setStatus(to);
        claim.setCurrentApprover(null);
        if (ApprovalRules.isFinal(to)) {
            claim.setDecidedAt(now);
        }
        Employee onBehalfOf = decision.onBehalfOfId() == null ? null : employees.getReferenceById(decision.onBehalfOfId());
        String trimmed = comment == null || comment.isBlank() ? null : comment.trim();
        actions.save(new ApprovalAction(claim, me, onBehalfOf, action, from, to, trimmed, now));
        audit.log(me, "CLAIM_" + action.name(), "CLAIM", claim.getId(),
                from + " -> " + to + (onBehalfOf == null ? "" : ", onBehalfOf=" + decision.onBehalfOfId()));
        log.info("Claim {} {} by {}{}: {} -> {}", claim.getId(), action, me.getId(),
                onBehalfOf == null ? "" : " for " + decision.onBehalfOfId(), from, to);
    }

    private Decision requireCanAct(Claim claim, Employee me, List<Grant> grants) {
        if (!claim.getStatus().isPending()) {
            throw new ConflictException("This claim is not awaiting approval (status " + claim.getStatus() + ").");
        }
        Decision decision = decide(claim, me, grants);
        if (!decision.allowed()) {
            throw new ForbiddenException(decision.reason() + ".");
        }
        return decision;
    }

    private boolean canView(Claim claim, Employee viewer, List<Grant> grants) {
        if (viewer.getId().equals(claim.getEmployee().getId())
                || viewer.getRole() == Role.FINANCE_AUDITOR
                || viewer.getRole() == Role.FINANCE_HEAD) {
            return true;
        }
        if (actions.existsByClaimIdAndActorId(claim.getId(), viewer.getId())) {
            return true;
        }
        return decide(claim, viewer, grants).allowed();
    }

    private Decision decide(Claim claim, Employee viewer, List<Grant> grants) {
        if (!claim.getStatus().isPending()) {
            return new Decision(false, null, "Claim is not awaiting approval");
        }
        Set<Long> prior = approversThisRound(List.of(claim.getId())).getOrDefault(claim.getId(), Set.of());
        return ApprovalRules.canAct(actorOf(viewer), stateOf(claim), grants, prior, LocalDate.now(clock));
    }

    private Map<Long, Set<Long>> approversThisRound(List<Long> claimIds) {
        Map<Long, Set<Long>> result = new HashMap<>();
        if (claimIds.isEmpty()) {
            return result;
        }
        for (ClaimActor ca : actions.findApproversThisRound(claimIds)) {
            result.computeIfAbsent(ca.claimId(), k -> new HashSet<>()).add(ca.actorId());
        }
        return result;
    }

    private List<Grant> grantsOf(Employee delegate) {
        return delegations.findActiveForDelegate(delegate.getId(), LocalDate.now(clock)).stream()
                .map(d -> new Grant(d.getDelegator().getId(), d.getDelegator().getRole(), d.getStartDate(),
                        d.getEndDate()))
                .toList();
    }

    private Employee initialApprover(Employee claimant) {
        Long managerId = claimant.getManager() == null ? null : claimant.getManager().getId();
        Long financeHeadId = employees.findFirstByRoleOrderByIdAsc(Role.FINANCE_HEAD).map(Employee::getId).orElse(null);
        Long approverId = ApprovalRules.initialApproverId(managerId, financeHeadId);
        if (approverId == null) {
            throw new ConflictException("No approver is configured for this claimant.");
        }
        return employees.getReferenceById(approverId);
    }

    private static Actor actorOf(Employee e) {
        return new Actor(e.getId(), e.getRole());
    }

    private static ClaimState stateOf(Claim c) {
        return new ClaimState(c.getEmployee().getId(), c.getStatus(),
                c.getCurrentApprover() == null ? null : c.getCurrentApprover().getId());
    }

    private static NotFoundException claimNotFound() {
        return new NotFoundException("Claim not found.");
    }
}
