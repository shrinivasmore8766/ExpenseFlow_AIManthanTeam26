package com.expenseflow.approval;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import com.expenseflow.approval.ApprovalRules.Actor;
import com.expenseflow.approval.ApprovalRules.ClaimState;
import com.expenseflow.approval.ApprovalRules.Decision;
import com.expenseflow.approval.ApprovalRules.Grant;
import com.expenseflow.claim.ClaimStatus;
import com.expenseflow.user.Role;

/** Unit tests for approval thresholds, permissions and delegation (§4.5). ApprovalRules is pure. */
class ApprovalRulesTest {

    static final BigDecimal AUDITOR_THRESHOLD = new BigDecimal("25000");
    static final BigDecimal FH_THRESHOLD = new BigDecimal("100000");
    static final LocalDate TODAY = LocalDate.of(2026, 11, 27);

    static final long CLAIMANT = 10, MANAGER = 20, OTHER_MANAGER = 21, AUDITOR = 30, FH = 40, DELEGATE = 50;

    static Actor actor(long id, Role role) {
        return new Actor(id, role);
    }

    static ClaimState pending(ClaimStatus status) {
        return new ClaimState(CLAIMANT, status, status == ClaimStatus.PENDING_MANAGER ? MANAGER : null);
    }

    static Decision canAct(Actor a, ClaimState c) {
        return ApprovalRules.canAct(a, c, List.of(), Set.of(), TODAY);
    }

    static ClaimStatus approve(ClaimStatus from, String amount, boolean sampleAudit) {
        return ApprovalRules.statusAfterApprove(from, new BigDecimal(amount), sampleAudit, AUDITOR_THRESHOLD, FH_THRESHOLD);
    }

    // ------------------------------------------------------------------ thresholds and the approval chain

    @Nested
    class Thresholds {
        @Test
        void upTo25000OnlyTheManagerApproves() {
            assertThat(approve(ClaimStatus.PENDING_MANAGER, "24999.99", false)).isEqualTo(ClaimStatus.APPROVED);
            assertThat(approve(ClaimStatus.PENDING_MANAGER, "25000.00", false)).isEqualTo(ClaimStatus.APPROVED);
        }

        @Test
        void above25000NeedsTheAuditorAfterTheManager() {
            assertThat(approve(ClaimStatus.PENDING_MANAGER, "25000.01", false)).isEqualTo(ClaimStatus.PENDING_AUDITOR);
            assertThat(approve(ClaimStatus.PENDING_MANAGER, "25001", false)).isEqualTo(ClaimStatus.PENDING_AUDITOR);
            assertThat(approve(ClaimStatus.PENDING_AUDITOR, "25001", false)).isEqualTo(ClaimStatus.APPROVED);
        }

        @Test
        void upTo100000TheAuditorIsTheLastLevel() {
            assertThat(approve(ClaimStatus.PENDING_MANAGER, "100000", false)).isEqualTo(ClaimStatus.PENDING_AUDITOR);
            assertThat(approve(ClaimStatus.PENDING_AUDITOR, "100000", false)).isEqualTo(ClaimStatus.APPROVED);
        }

        @Test
        void above100000NeedsManagerThenAuditorThenFinanceHead() {
            ClaimStatus s = approve(ClaimStatus.PENDING_MANAGER, "100001", false);
            assertThat(s).isEqualTo(ClaimStatus.PENDING_AUDITOR);          // manager cannot jump to FH or APPROVED
            s = approve(s, "100001", false);
            assertThat(s).isEqualTo(ClaimStatus.PENDING_FINANCE_HEAD);
            assertThat(approve(s, "100001", false)).isEqualTo(ClaimStatus.APPROVED);
            assertThat(approve(ClaimStatus.PENDING_AUDITOR, "100000.01", false)).isEqualTo(ClaimStatus.PENDING_FINANCE_HEAD);
        }

        @Test
        void sampleAuditClaimIsApprovedByTheAuditorWithoutFinanceHead() {
            assertThat(approve(ClaimStatus.PENDING_AUDITOR, "4000", true)).isEqualTo(ClaimStatus.APPROVED);
        }

        @ParameterizedTest
        @EnumSource(value = ClaimStatus.class, names = {"DRAFT", "CLARIFICATION_REQUESTED", "APPROVED", "REJECTED", "PAID"})
        void nonPendingClaimsCannotBeApproved(ClaimStatus status) {
            assertThatThrownBy(() -> approve(status, "100", false)).isInstanceOf(IllegalArgumentException.class);
        }
    }

    // ------------------------------------------------------------------ who may act

    @Nested
    class Permissions {
        @Test
        void assignedManagerCanActAtManagerLevel() {
            Decision d = canAct(actor(MANAGER, Role.MANAGER), pending(ClaimStatus.PENDING_MANAGER));
            assertThat(d.allowed()).isTrue();
            assertThat(d.onBehalfOfId()).isNull();
        }

        @Test
        void otherManagerAuditorAndFinanceHeadCannotSkipTheManagerLevel() {
            ClaimState c = pending(ClaimStatus.PENDING_MANAGER);
            assertThat(canAct(actor(OTHER_MANAGER, Role.MANAGER), c).allowed()).isFalse();
            assertThat(canAct(actor(AUDITOR, Role.FINANCE_AUDITOR), c).allowed()).isFalse();
            assertThat(canAct(actor(FH, Role.FINANCE_HEAD), c).allowed()).isFalse();
        }

        @Test
        void auditorLevelIsForAuditorsOnly() {
            ClaimState c = pending(ClaimStatus.PENDING_AUDITOR);
            assertThat(canAct(actor(AUDITOR, Role.FINANCE_AUDITOR), c).allowed()).isTrue();
            assertThat(canAct(actor(MANAGER, Role.MANAGER), c).allowed()).isFalse();
            assertThat(canAct(actor(FH, Role.FINANCE_HEAD), c).allowed()).isFalse();
            assertThat(canAct(actor(99, Role.EMPLOYEE), c).allowed()).isFalse();
        }

        @Test
        void financeHeadLevelIsForTheFinanceHeadOnly() {
            ClaimState c = pending(ClaimStatus.PENDING_FINANCE_HEAD);
            assertThat(canAct(actor(FH, Role.FINANCE_HEAD), c).allowed()).isTrue();
            assertThat(canAct(actor(AUDITOR, Role.FINANCE_AUDITOR), c).allowed()).isFalse();
            assertThat(canAct(actor(MANAGER, Role.MANAGER), c).allowed()).isFalse();
        }

        @Test
        void nobodyCanActOnTheirOwnClaimInAnyRole() {
            for (ClaimStatus s : List.of(ClaimStatus.PENDING_MANAGER, ClaimStatus.PENDING_AUDITOR, ClaimStatus.PENDING_FINANCE_HEAD)) {
                for (Role r : Role.values()) {
                    // claimant is also the assigned approver: still denied
                    ClaimState c = new ClaimState(CLAIMANT, s, CLAIMANT);
                    Decision d = canAct(actor(CLAIMANT, r), c);
                    assertThat(d.allowed()).as(s + "/" + r).isFalse();
                    assertThat(d.reason()).isEqualTo("You cannot act on your own claim");
                }
            }
        }

        @Test
        void theSameUserCannotApproveTwiceInOneRound() {
            Decision d = ApprovalRules.canAct(actor(AUDITOR, Role.FINANCE_AUDITOR), pending(ClaimStatus.PENDING_AUDITOR),
                    List.of(), Set.of(AUDITOR), TODAY);
            assertThat(d.allowed()).isFalse();
            assertThat(d.reason()).isEqualTo("You already approved this claim");
        }

        @ParameterizedTest
        @EnumSource(value = ClaimStatus.class, names = {"DRAFT", "CLARIFICATION_REQUESTED", "APPROVED", "REJECTED", "PAID"})
        void nobodyCanActOnANonPendingClaim(ClaimStatus status) {
            Decision d = canAct(actor(FH, Role.FINANCE_HEAD), new ClaimState(CLAIMANT, status, MANAGER));
            assertThat(d.allowed()).isFalse();
            assertThat(d.reason()).isEqualTo("Claim is not awaiting approval");
        }
    }

    // ------------------------------------------------------------------ delegation

    @Nested
    class Delegation {
        Grant managerGrant(LocalDate start, LocalDate end) {
            return new Grant(MANAGER, Role.MANAGER, start, end);
        }

        @Test
        void activeDelegateActsOnBehalfOfTheManager() {
            Decision d = ApprovalRules.canAct(actor(DELEGATE, Role.EMPLOYEE), pending(ClaimStatus.PENDING_MANAGER),
                    List.of(managerGrant(TODAY.minusDays(1), TODAY.plusDays(1))), Set.of(), TODAY);
            assertThat(d.allowed()).isTrue();
            assertThat(d.onBehalfOfId()).isEqualTo(MANAGER);
        }

        @Test
        void delegationDatesAreInclusive() {
            for (LocalDate[] range : new LocalDate[][] {{TODAY, TODAY}, {TODAY.minusDays(5), TODAY}, {TODAY, TODAY.plusDays(5)}}) {
                Decision d = ApprovalRules.canAct(actor(DELEGATE, Role.MANAGER), pending(ClaimStatus.PENDING_MANAGER),
                        List.of(managerGrant(range[0], range[1])), Set.of(), TODAY);
                assertThat(d.allowed()).isTrue();
            }
        }

        @Test
        void expiredOrFutureDelegationGivesNoRights() {
            for (Grant g : List.of(managerGrant(TODAY.minusDays(10), TODAY.minusDays(1)),
                    managerGrant(TODAY.plusDays(1), TODAY.plusDays(3)))) {
                Decision d = ApprovalRules.canAct(actor(DELEGATE, Role.MANAGER), pending(ClaimStatus.PENDING_MANAGER),
                        List.of(g), Set.of(), TODAY);
                assertThat(d.allowed()).isFalse();
            }
        }

        @Test
        void delegateOfAnotherManagerCannotActOnThisClaim() {
            Grant other = new Grant(OTHER_MANAGER, Role.MANAGER, TODAY, TODAY);
            assertThat(ApprovalRules.canAct(actor(DELEGATE, Role.MANAGER), pending(ClaimStatus.PENDING_MANAGER),
                    List.of(other), Set.of(), TODAY).allowed()).isFalse();
        }

        @Test
        void delegateCannotExceedTheDelegatorsPermissions() {
            // A manager's delegate gets manager-level rights only: not auditor or finance-head levels.
            List<Grant> grants = List.of(managerGrant(TODAY, TODAY));
            assertThat(ApprovalRules.canAct(actor(DELEGATE, Role.EMPLOYEE), pending(ClaimStatus.PENDING_AUDITOR),
                    grants, Set.of(), TODAY).allowed()).isFalse();
            assertThat(ApprovalRules.canAct(actor(DELEGATE, Role.EMPLOYEE), pending(ClaimStatus.PENDING_FINANCE_HEAD),
                    grants, Set.of(), TODAY).allowed()).isFalse();
        }

        @Test
        void auditorDelegateActsAtAuditorLevelOnBehalfOfTheAuditor() {
            Grant g = new Grant(AUDITOR, Role.FINANCE_AUDITOR, TODAY, TODAY);
            Decision d = ApprovalRules.canAct(actor(DELEGATE, Role.MANAGER), pending(ClaimStatus.PENDING_AUDITOR),
                    List.of(g), Set.of(), TODAY);
            assertThat(d.allowed()).isTrue();
            assertThat(d.onBehalfOfId()).isEqualTo(AUDITOR);
        }

        @Test
        void delegateCannotActOnTheirOwnClaim() {
            ClaimState own = new ClaimState(DELEGATE, ClaimStatus.PENDING_MANAGER, MANAGER);
            assertThat(ApprovalRules.canAct(actor(DELEGATE, Role.EMPLOYEE), own,
                    List.of(managerGrant(TODAY, TODAY)), Set.of(), TODAY).allowed()).isFalse();
        }

        @Test
        void grantFromTheClaimantIsIgnored() {
            // The claimant delegating their own approver rights must not let anyone approve the claimant's claim.
            Grant fromClaimant = new Grant(CLAIMANT, Role.FINANCE_AUDITOR, TODAY, TODAY);
            assertThat(ApprovalRules.canAct(actor(DELEGATE, Role.MANAGER), pending(ClaimStatus.PENDING_AUDITOR),
                    List.of(fromClaimant), Set.of(), TODAY).allowed()).isFalse();
        }

        @Test
        void delegateWhoAlreadyApprovedThisRoundIsDenied() {
            assertThat(ApprovalRules.canAct(actor(DELEGATE, Role.MANAGER), pending(ClaimStatus.PENDING_MANAGER),
                    List.of(managerGrant(TODAY, TODAY)), Set.of(DELEGATE), TODAY).allowed()).isFalse();
        }
    }

    // ------------------------------------------------------------------ submit, resubmit, edit, allowed actions

    @Nested
    class Lifecycle {
        @Test
        void resubmissionAlwaysRestartsAtTheManager() {
            assertThat(ApprovalRules.statusAfterSubmit(ClaimStatus.APPROVED, true)).isEqualTo(ClaimStatus.PENDING_MANAGER);
            assertThat(ApprovalRules.statusAfterSubmit(ClaimStatus.PENDING_AUDITOR, true)).isEqualTo(ClaimStatus.PENDING_MANAGER);
            assertThat(ApprovalRules.statusAfterSubmit(ClaimStatus.PENDING_MANAGER, true)).isEqualTo(ClaimStatus.PENDING_MANAGER);
        }

        @Test
        void resubmissionThatBreaksHardRulesIsStillRejected() {
            assertThat(ApprovalRules.statusAfterSubmit(ClaimStatus.REJECTED, true)).isEqualTo(ClaimStatus.REJECTED);
        }

        @Test
        void firstSubmissionKeepsThePolicyOutcome() {
            assertThat(ApprovalRules.statusAfterSubmit(ClaimStatus.APPROVED, false)).isEqualTo(ClaimStatus.APPROVED);
        }

        @Test
        void initialApproverIsTheManagerOrTheFinanceHeadWhenThereIsNone() {
            assertThat(ApprovalRules.initialApproverId(MANAGER, FH)).isEqualTo(MANAGER);
            assertThat(ApprovalRules.initialApproverId(null, FH)).isEqualTo(FH);
        }

        @Test
        void onlyTheClaimantEditsAndOnlyInDraftOrClarification() {
            assertThat(ApprovalRules.canEdit(CLAIMANT, CLAIMANT, ClaimStatus.DRAFT)).isTrue();
            assertThat(ApprovalRules.canEdit(CLAIMANT, CLAIMANT, ClaimStatus.CLARIFICATION_REQUESTED)).isTrue();
            assertThat(ApprovalRules.canEdit(CLAIMANT, CLAIMANT, ClaimStatus.PENDING_MANAGER)).isFalse();
            assertThat(ApprovalRules.canEdit(MANAGER, CLAIMANT, ClaimStatus.DRAFT)).isFalse();
            assertThat(ApprovalRules.canDelete(CLAIMANT, CLAIMANT, ClaimStatus.DRAFT)).isTrue();
            assertThat(ApprovalRules.canDelete(CLAIMANT, CLAIMANT, ClaimStatus.CLARIFICATION_REQUESTED)).isFalse();
        }

        @Test
        void allowedActionsReflectRole() {
            Actor claimant = actor(CLAIMANT, Role.EMPLOYEE);
            assertThat(ApprovalRules.allowedActions(claimant, new ClaimState(CLAIMANT, ClaimStatus.DRAFT, null),
                    new Decision(false, null, "x"))).containsExactly("EDIT", "SUBMIT", "DELETE");
            ClaimState pm = pending(ClaimStatus.PENDING_MANAGER);
            Actor mgr = actor(MANAGER, Role.MANAGER);
            assertThat(ApprovalRules.allowedActions(mgr, pm, canAct(mgr, pm)))
                    .containsExactly("APPROVE", "REJECT", "SEND_BACK");
            assertThat(ApprovalRules.allowedActions(claimant, pm, canAct(claimant, pm))).isEmpty();
        }

        @Test
        void onlyApprovedAndRejectedAreFinal() {
            assertThat(ApprovalRules.isFinal(ClaimStatus.APPROVED)).isTrue();
            assertThat(ApprovalRules.isFinal(ClaimStatus.REJECTED)).isTrue();
            assertThat(ApprovalRules.isFinal(ClaimStatus.PENDING_AUDITOR)).isFalse();
        }
    }
}
