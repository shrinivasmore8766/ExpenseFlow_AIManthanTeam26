package com.expenseflow.approval;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import com.expenseflow.claim.ClaimStatus;
import com.expenseflow.user.Role;

/**
 * Approval routing and permissions (§4.5). Pure: no Spring, JPA or I/O. This is the only place
 * that decides who may act on or edit a claim and where an approval sends it next.
 */
public final class ApprovalRules {

    public static final String EDIT = "EDIT";
    public static final String SUBMIT = "SUBMIT";
    public static final String DELETE = "DELETE";
    public static final String APPROVE = "APPROVE";
    public static final String REJECT = "REJECT";
    public static final String SEND_BACK = "SEND_BACK";

    /** The person trying to act. */
    public record Actor(Long id, Role role) {
    }

    /** The parts of a claim the rules need. currentApproverId is only set while PENDING_MANAGER. */
    public record ClaimState(Long claimantId, ClaimStatus status, Long currentApproverId) {
    }

    /** A delegation in which the actor is the delegate. Active from startDate to endDate inclusive. */
    public record Grant(Long delegatorId, Role delegatorRole, LocalDate startDate, LocalDate endDate) {

        boolean activeOn(LocalDate day) {
            return !day.isBefore(startDate) && !day.isAfter(endDate);
        }
    }

    /** Result of {@link #canAct}. onBehalfOfId is the delegator when the actor acts as a delegate. */
    public record Decision(boolean allowed, Long onBehalfOfId, String reason) {

        static Decision allow(Long onBehalfOfId) {
            return new Decision(true, onBehalfOfId, null);
        }

        static Decision deny(String reason) {
            return new Decision(false, null, reason);
        }
    }

    private ApprovalRules() {
    }

    /**
     * True only if: actor is not the claimant, actor has not already approved since the last submit,
     * and the actor holds the approver slot for the current status (directly or as an active delegate).
     */
    public static Decision canAct(Actor actor, ClaimState claim, List<Grant> grants,
                                  Set<Long> priorApproverIdsThisRound, LocalDate today) {
        if (!claim.status().isPending()) {
            return Decision.deny("Claim is not awaiting approval");
        }
        if (actor.id().equals(claim.claimantId())) {
            return Decision.deny("You cannot act on your own claim");
        }
        if (priorApproverIdsThisRound.contains(actor.id())) {
            return Decision.deny("You already approved this claim");
        }
        List<Grant> active = grants.stream()
                .filter(g -> g.activeOn(today))
                .filter(g -> !g.delegatorId().equals(claim.claimantId()))
                .toList();
        switch (claim.status()) {
            case PENDING_MANAGER -> {
                if (actor.id().equals(claim.currentApproverId())) {
                    return Decision.allow(null);
                }
                for (Grant g : active) {
                    if (g.delegatorId().equals(claim.currentApproverId())) {
                        return Decision.allow(g.delegatorId());
                    }
                }
            }
            case PENDING_AUDITOR -> {
                return byRole(actor, active, Role.FINANCE_AUDITOR);
            }
            case PENDING_FINANCE_HEAD -> {
                return byRole(actor, active, Role.FINANCE_HEAD);
            }
            default -> {
                // not reachable: non-pending statuses are rejected above
            }
        }
        return Decision.deny("You are not an approver for this claim");
    }

    /** Status after an approval (§4.5). */
    public static ClaimStatus statusAfterApprove(ClaimStatus current, BigDecimal approvedAmount, boolean sampleAudit,
                                                 BigDecimal auditorThreshold, BigDecimal financeHeadThreshold) {
        return switch (current) {
            case PENDING_MANAGER -> approvedAmount.compareTo(auditorThreshold) > 0
                    ? ClaimStatus.PENDING_AUDITOR
                    : ClaimStatus.APPROVED;
            case PENDING_AUDITOR -> {
                if (sampleAudit) {
                    yield ClaimStatus.APPROVED;
                }
                yield approvedAmount.compareTo(financeHeadThreshold) > 0
                        ? ClaimStatus.PENDING_FINANCE_HEAD
                        : ClaimStatus.APPROVED;
            }
            case PENDING_FINANCE_HEAD -> ClaimStatus.APPROVED;
            default -> throw new IllegalArgumentException("Cannot approve a claim in status " + current);
        };
    }

    /** Resubmission after clarification always restarts at the manager, unless the policy rejects it outright. */
    public static ClaimStatus statusAfterSubmit(ClaimStatus policyStatus, boolean resubmit) {
        if (resubmit && policyStatus != ClaimStatus.REJECTED) {
            return ClaimStatus.PENDING_MANAGER;
        }
        return policyStatus;
    }

    /** The claimant's manager; without a manager, the Finance Head. */
    public static Long initialApproverId(Long managerId, Long financeHeadId) {
        return managerId != null ? managerId : financeHeadId;
    }

    public static boolean isFinal(ClaimStatus status) {
        return status == ClaimStatus.APPROVED || status == ClaimStatus.REJECTED;
    }

    /** Lines and title: only the claimant, only in DRAFT or CLARIFICATION_REQUESTED. */
    public static boolean canEdit(Long actorId, Long claimantId, ClaimStatus status) {
        return actorId.equals(claimantId) && status.isEditable();
    }

    public static boolean canDelete(Long actorId, Long claimantId, ClaimStatus status) {
        return actorId.equals(claimantId) && status == ClaimStatus.DRAFT;
    }

    /** allowedActions for the caller (rendered as-is by the frontend). */
    public static List<String> allowedActions(Actor actor, ClaimState claim, Decision actDecision) {
        List<String> actions = new ArrayList<>();
        if (canEdit(actor.id(), claim.claimantId(), claim.status())) {
            actions.add(EDIT);
            actions.add(SUBMIT);
        }
        if (canDelete(actor.id(), claim.claimantId(), claim.status())) {
            actions.add(DELETE);
        }
        if (actDecision.allowed()) {
            actions.add(APPROVE);
            actions.add(REJECT);
            actions.add(SEND_BACK);
        }
        return actions;
    }

    private static Decision byRole(Actor actor, List<Grant> active, Role required) {
        if (actor.role() == required) {
            return Decision.allow(null);
        }
        for (Grant g : active) {
            if (g.delegatorRole() == required) {
                return Decision.allow(g.delegatorId());
            }
        }
        return Decision.deny("You are not an approver for this claim");
    }
}
