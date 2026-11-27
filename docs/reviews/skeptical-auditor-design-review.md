# Design Review — "Skeptical Finance Auditor"

**Phase:** Architecture · **Reviewer:** Claude, prompted to act as a skeptical finance auditor looking for ways to bypass approvals
**Input:** [03-detailed-design.md](../architecture/03-detailed-design.md) · **Date:** 2026-11-27
**Team action:** accept each finding as real or reject it as a false alarm, and link the test that proves the control.

## Method
1. Walked every transition in the state machine and asked whether it could be reached by the wrong person, at the wrong time, or twice.
2. Asked of each policy rule what the cheapest way around it is.
3. Asked of each role, especially the Finance Head as admin, what they can do alone with no second pair of eyes.
4. Looked for race conditions in submit, approve and payout.

Earlier findings B1–B21 are in [01-requirements-analysis.md §8](../architecture/01-requirements-analysis.md). This review re-checks those findings against the detailed design and adds new ones (N1–N14).

## New findings against the detailed design

| ID | Bypass / weakness | Severity | Fix adopted in design | Proving test |
|---|---|---|---|---|
| N1 | **Concurrent submissions defeat aggregate rules.** Two claims, each with ₹1,000 of meals for the same day, are submitted in parallel. Neither sees the other, so both pass the ₹1,500/day limit. The same applies to duplicate-hash checks. | High | Submit takes `pg_advisory_xact_lock(employee_id)`, plus one lock per receipt hash, before building the history snapshot. | Integration: two parallel submits → second is ROUTEd |
| N2 | **One person approves two levels.** If the Finance Head delegates to an auditor, that auditor can approve level 2 and then level 3 of the same claim. | High | `canAct` adds: the user has not acted on another step of this claim in the current round. | Unit: `canAct` same-user-two-levels → false |
| N3 | **Death by a thousand auto-approvals.** Auto-approved claims (≤ ₹5,000, clean) never reach a human except the 10% sample. An employee files many small claims. | High | New config `auto_approve_monthly_cap` (default ₹15,000 per employee). Above the cap, claims are ROUTEd. Also feeds the B13 frequency flag. | Unit: 4th ₹4,900 claim in the month → ROUTE |
| N4 | **Someone else's receipt.** Uploaded receipt IDs are sequential, so a line can point to a receipt uploaded by another user (IDOR). | High | A line may reference only receipts `uploaded_by = claimant`. Receipt IDs exposed to clients are UUIDs. | API: attach other user's receipt → 404 |
| N5 | **Finance Head redirects money.** The admin edits an employee's bank account to their own, then creates, exports and marks the batch paid. | High | Bank details can be changed only by the employee (self-service), not by the admin. Changes are audited, and the beneficiary is flagged on the batch if changed within 7 days (B19). | API: FH PUT bank details of other user → 403 |
| N6 | **One person runs the whole payout.** The Finance Head creates, exports and marks paid alone. | Medium | Stretch goal: an auditor "verifies" the batch before export (four-eyes control). MVP: documented risk, every step audited, file checksum stored. | — (documented) |
| N7 | **Withdrawn claims cause false duplicates.** An employee withdraws and recreates a claim, and the new lines are flagged against their own withdrawn lines. | Low (false positive) | Duplicate matching excludes lines of WITHDRAWN claims. Withdraw can't reroll the sample audit, because withdraw is only allowed for routed claims. | Unit: history snapshot excludes WITHDRAWN |
| N8 | **Stale privileges in the JWT.** A demoted or deactivated manager keeps approving for up to 60 minutes. | Medium | Each request loads the user's `active` flag and roles from the DB (cheap at this scale). The JWT only proves identity. | API: deactivate user → next call 401 |
| N9 | **Amount tricks.** Negative or zero lines, or a "refund" line, pull the total under a threshold. Sub-paisa amounts are used to dodge exact duplicates. | Medium | `amount > 0`, scale ≤ 2 (Bean Validation and DB CHECK). Thresholds use the payable amount of approved-eligible lines only. | Unit/API: amount -1, 0, 100.001 → 400 |
| N10 | **Auditor cherry-picking.** The auditor step goes to a pool, so a colluding auditor can always pick up a friend's claims. | Low | Who acted is audited, and the dashboard shows the distribution of approvals by auditor. Stretch goal: random auto-assignment within the pool. | — (report) |
| N11 | **Admin edits hierarchy mid-flight.** The admin moves a claimant under a lenient manager while a claim is pending. | Medium | Steps are assigned at submit, so the move doesn't affect pending steps. Reassigning a step is an explicit, audited admin action with a mandatory reason. | Unit: hierarchy change doesn't alter open step |
| N12 | **Policy loosened, claim approved, policy restored.** | Medium | Policy edits are versioned and audited. Violations store the rule version. The dashboard lists policy changes in the reporting period. | Integration: edit rule → new version row, old intact |
| N13 | **Rubber-stamping.** Approvers approve without opening the receipt. | Low | The approver screen shows the receipt next to the lines by default. Stretch goal: flag approvals done in under 5 s with flags present. | — (UX) |
| N14 | **Demo credentials reach a real deploy.** | Medium | Known seed passwords exist only under the `demo` profile. The app refuses to start the `demo` profile unless `DEMO_MODE=true` is set. | Startup test |

## Re-check of earlier findings

| ID | Status after detailed design |
|---|---|
| B1 claim splitting | Partially mitigated: `SPLIT_SUSPICION` rule (stretch) plus N3 monthly cap |
| B2 line splitting | Closed: daily meal sum per employee across claims, plus the N1 lock |
| B4 edit after submit | Closed: aggregate invariants plus state guards; clarification restarts the chain |
| B5 self-approval | Closed: `canAct` checks claimant first, including delegates, the merge rule and the escalation user |
| B7 hierarchy manipulation | Closed for in-flight claims (N11) |
| B10 resubmit a rejected claim | Closed: duplicate matching includes rejected lines (but not withdrawn, per N7) |
| B14 sample audit gaming | Closed: SecureRandom, decided once per claim, hidden from the employee |
| B15 API / IDOR / mass assignment | Closed by design. Verified by the authorization-matrix test in CI |
| B16 races (double approve, double pay) | Closed: `@Version` optimistic lock plus partial unique index on `payout_item.claim_id` |
| B17 bulk approve of flagged claims | Closed: bulk endpoint skips flagged claims and returns per-claim results |
| B19 bank account switch | Strengthened by N5 |
| B20 audit tampering | Closed at DB level. The hash chain is a stretch goal |
| B3, B6, B8, B11, B12, B13, B18, B21 | Mitigated as described in 01 §8. Residual risk accepted for the hackathon |

## Accepted residual risks (state these openly to judges)
1. Exact-hash duplicate detection misses re-photographed receipts. Partly offset by the vendor/amount/date rule and sample audits.
2. The Finance Head can still run a payout batch alone (N6). Every step is audited.
3. A JWT can't be revoked within its 60-minute life, but role and active checks per request limit the damage (N8).
4. No OCR, so the amount, date and vendor on the receipt are not checked against the line. That is left to the approver, helped by the side-by-side viewer.
