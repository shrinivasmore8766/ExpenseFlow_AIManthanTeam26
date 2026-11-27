# Approval Threshold and Delegation Test Report

**Scope:**
- `approval/ApprovalRules` (pure routing and permission rules)
- `approval/ApprovalService` (state changes, history, queue, bulk approve)
- `user/DelegationService`

**Executed:** 2026-11-27, against the running stack (Spring Boot 3.3.5, PostgreSQL 16, seeded data).

| Layer | File | Tests | Result |
|---|---|---|---|
| Unit (pure rules) | [`ApprovalRulesTest.java`](../../backend/src/test/java/com/expenseflow/approval/ApprovalRulesTest.java) | 37 | 37 passed |
| API integration (real DB) | [`03-approvals-delegation.test.mjs`](../../qa/api-tests/03-approvals-delegation.test.mjs) | 17 | 17 passed |
| Browser E2E | E2E-01, 02, 03, 09, 10 in [03-e2e-test-cases.md](03-e2e-test-cases.md) | 5 | 5 passed |
| Defect reproduction | [`qa/repro/`](../../qa/repro/) | 2 | Defect **DEF-02 reproduced** (still open) |

Raw output: [evidence/backend-unit-tests.txt](evidence/backend-unit-tests.txt) and [evidence/api-tests.txt](evidence/api-tests.txt).

## A. Approval thresholds

The approval chain uses the claim's **approved amount** (lines that were not auto-rejected). The auditor and Finance Head thresholds come from `app_config`: ₹25,000 and ₹1,00,000.

| Amount | Expected chain | Unit result | Live API result (claim moved through the real endpoints) |
|---|---|---|---|
| ₹24,999.99 | Manager only | Pass | — |
| **₹25,000** | Manager only | Pass | THR-01 Pass: manager approval → `APPROVED`. A later auditor approve returns 409. |
| ₹25,000.01 | Manager → Auditor | Pass | — |
| **₹25,001** | Manager → Auditor | Pass | THR-02 Pass: `PENDING_AUDITOR` → `APPROVED` |
| **₹1,00,000** | Manager → Auditor | Pass | THR-03 Pass: auditor approval is final (no Finance Head) |
| ₹1,00,000.01 | Manager → Auditor → Finance Head | Pass | — |
| **₹1,00,001** | Manager → Auditor → Finance Head | Pass | THR-04 Pass: `PENDING_AUDITOR` → `PENDING_FINANCE_HEAD` → `APPROVED`. The history shows Vikram Rao, then Anil Kumar, then Priya Sharma. |
| Sample-audit claim (any amount) | Auditor only | Pass | Seen live in E2E-07 (claim routed to `PENDING_AUDITOR`) |

### Chain integrity checks

| Check | How | Result |
|---|---|---|
| Approvals cannot be skipped | THR-04: at `PENDING_MANAGER`, the auditor and the Finance Head both get **403**. At `PENDING_AUDITOR`, the Finance Head and the manager (who already approved) get **403**. At `PENDING_FINANCE_HEAD`, `auditor2` and the manager get **403**. Unit: the other manager, auditor and FH are denied at manager level. | Pass |
| Unauthorised roles cannot approve | Unit: an employee is denied at the auditor level. API: another employee gets **404** (the claim isn't even visible). RBAC: an employee calling bulk approve gets 403, and so does a manager. | Pass |
| No self-approval in any role | Unit: all 3 pending levels × 4 roles, including when the claimant is also the assigned approver → "You cannot act on your own claim". API: the claimant approving gets **403**. | Pass |
| Same user cannot approve twice per round | Unit and API (THR-04: the manager trying again at auditor level gets 403) | Pass |
| Rejected claims cannot proceed to payout | APR-02: rejected with a comment → approve returns **409** for both manager and auditor, and the claim is absent from `/payouts/eligible`. DB check: 0 rejected claims have ever had a payout batch or `paid_at`. | Pass |
| Reject and send back need a comment | APR-01: empty and whitespace-only comments get **400**, and the status is unchanged. Also checked in the UI (E2E-09). | Pass |
| Clarification and resubmission | APR-03: the auditor sends back → `CLARIFICATION_REQUESTED`. Only the claimant can then edit or submit. After editing the amount and resubmitting, the claim goes back to **`PENDING_MANAGER`**, not to the auditor. The manager may approve again in the new round, and the claim completes. | Pass |
| History is kept and in order | APR-03 checks the exact action sequence `SUBMIT, POLICY_DECISION, APPROVE, SEND_BACK, SUBMIT, POLICY_DECISION, APPROVE, APPROVE` and that the timestamps are ascending. AUD-01 checks that every QA claim has an actor and time on each entry. | Pass |
| Status changes are correct | Unit: approving a non-pending status throws an exception, and only APPROVED and REJECTED are final. API: every transition above was asserted. | Pass |
| Queue membership follows the current level | THR-05: the claim is in the manager's queue only, then in both auditors' queues only, then leaves the queue. | Pass |
| Concurrent approvals | APR-04: 3 simultaneous approve calls give **exactly one 200**, and the others get 409 (optimistic lock) or 403. There is exactly one APPROVE history entry. | Pass |
| Bulk approve skips flagged claims | APR-05: the skip reasons are "Has policy violations; review it individually" and "Claim not found" (for an unknown id). Nothing was approved. | Pass |

## B. Delegation

| Check | How | Result |
|---|---|---|
| A manager delegates during leave | DEL-04 (API) and E2E-10 (UI, through the Approvals → Delegation panel): Vikram Rao → Maria Sharma, today to today + 2 days, shown as **Active** | Pass |
| The delegate can approve | The claim appears in Maria's queue, and her approval moves it to `APPROVED` | Pass |
| The original manager stays in the audit history | History entry "Approved by **Maria Sharma** on behalf of **Vikram Rao**" (`onBehalfOfName`). Checked in the API and the UI. | Pass |
| Unauthorised users cannot delegate | DEL-02: an employee calling `POST /api/delegations` gets **403**. An auditor deleting Vikram's delegation gets **404**. | Pass |
| Delegation expiry and future dates | Unit: an expired range and a future range give no rights, and the boundaries are inclusive. API: a past end date is rejected with **400**. DEL-03: a future delegation gives no rights (Maria gets 404). DEL-06: after deletion, the rights are gone. | Pass |
| Invalid delegations | DEL-01: delegating to yourself, end before start, already expired, unknown delegate, missing delegate → **400** each | Pass |
| A delegate cannot exceed the delegator's rights | DEL-05: Maria (holding manager rights) on a `PENDING_AUDITOR` claim is denied. Unit: a manager grant gives no auditor or FH rights. A grant whose delegator is the claimant is ignored. A delegate can't act on their own claim. | Pass |

## C. Defect found: DEF-02 (High, Open)

**Claims above ₹1,00,000 whose manager-level approver is the Finance Head can never be completed.**

Reproduced live twice. The scripts are in [`qa/repro/`](../../qa/repro/). Output: [own claim](evidence/DEF-02-repro-finance-head-own-claim.txt) and [direct report](evidence/DEF-02-repro-finance-head-direct-report.txt).

| Claimant | Chain observed | At `PENDING_FINANCE_HEAD` |
|---|---|---|
| `financehead` (own claim of ₹1,00,001) | CEO approves → auditor approves | FH: 403 "You cannot act on your own claim". CEO: 403 "already approved". Auditor: 403 "already approved". The claim is in nobody's queue. |
| `auditor2` (a direct report of the FH) | FH approves (as their manager) → auditor approves | FH: 403 "You already approved this claim". There is no other Finance Head. |

Who is affected: the Finance Head and their direct reports (`auditor`, `auditor2`, `rahul.patel`, `sai.banerjee`), for claims above ₹1,00,000.

The requirements say such claims must escalate (A11 and B21 in `docs/architecture/01-requirements-analysis.md`). But the two safeguards — no self-approval, and no second approval by the same person — leave nobody eligible.

This was **not fixed**. Choosing between the options changes a business rule, so the team has to decide. The options are in the [defect log](04-defect-log.md#def-02). The two stuck test claims were removed from the database after the reproduction.
