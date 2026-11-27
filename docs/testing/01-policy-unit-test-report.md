# Policy Engine Unit Test Report

**Scope:** `backend/src/main/java/com/expenseflow/policy/PolicyEngine.java`. This is the pure class that holds all expense-policy rules.
**Tests:** [`backend/src/test/java/com/expenseflow/policy/PolicyEngineTest.java`](../../backend/src/test/java/com/expenseflow/policy/PolicyEngineTest.java)
**Framework:** JUnit 5 and AssertJ (`spring-boot-starter-test`). There is no Spring context, because the engine is pure.
**Executed:** 2026-11-27, `mvn -B package` in `maven:3.9-eclipse-temurin-17`. Raw output: [evidence/backend-unit-tests.txt](evidence/backend-unit-tests.txt)
**Result:** **45 / 45 passed**, 0 failed, 0 skipped.

Limits used by the tests are the seeded configuration:
- meals ₹1,500 per day
- hotels ₹6,000 per night in tier-1 cities, ₹4,000 per night elsewhere
- cab ₹2,000 per trip
- receipt required above ₹500
- auto-approve limit ₹5,000
- sample audit 10%

Comparisons are strictly greater than. A value exactly at the limit passes.

## Results per rule

| # | Rule (code) | Below limit | Exact boundary | Above limit | Missing / invalid input | Decision and reason verified | Result |
|---|---|---|---|---|---|---|---|
| 1 | Meals ₹1,500 per day (`MEAL_DAILY_LIMIT`) | 1499.99 → AUTO_APPROVE | 1500.00 → no hit | 1500.01 → ROUTE, "…above the daily limit of ₹1500" | Rule switched off → skipped. Different days are not summed. | Daily total across 2 lines in one claim (800 + 700.01 → both lines flagged). Earlier meals on other claims count (1200 + 300.01). | Pass (7 tests) |
| 2 | Hotel, tier-1 city ₹6,000 per night (`HOTEL_TIER1_LIMIT`) | 5999.99 → no hit | 6000.00 → no hit | 6000.01 → ROUTE, "…tier-1 city limit of ₹6000" | City name ignores case and spaces ("  mUmBaI "). Nights missing or 0 → treated as 1 night. | Per-night maths: 18000.00 / 3 passes, 18000.03 / 3 is routed | Pass |
| 3 | Hotel, other city ₹4,000 per night (`HOTEL_OTHER_LIMIT`) | 3999.99 → no hit | 4000.00 → no hit | 4000.01 → ROUTE, "…non-tier-1 city limit of ₹4000" | Missing city → the stricter non-tier-1 limit applies | 12000 / 3 passes, 12001 / 3 is routed | Pass (6 hotel tests) |
| 4 | Local cab ₹2,000 per trip (`CAB_TRIP_LIMIT`) | 1999.99 → no hit | 2000.00 → no hit | 2000.01 → ROUTE, "Cab trip above the limit of ₹2000" | — | The limit is per trip: two ₹1,500 trips on one day are not flagged | Pass (2 tests) |
| 5 | Receipt mandatory above ₹500 (`RECEIPT_REQUIRED`) | 499.99 with no receipt → passes | 500.00 with no receipt → passes | 500.01 with no receipt → AUTO_REJECT, "Receipt required above ₹500" | Applies to every category (MEAL, HOTEL, LOCAL_CAB, TRAVEL, OTHER). With a receipt → passes. | Line outcome is the most severe hit (AUTO_REJECT beats ROUTE) | Pass (4 tests) |
| 6 | Duplicate vendor + amount + date (`DUPLICATE_EXPENSE`) | Different amount, date or vendor → no hit | Same key on an earlier claim → ROUTE, "Possible duplicate expense" | Same key twice in one claim → only the 2nd line is flagged | Blank or null vendor → no key, so no false duplicate | Vendor ignores case and spaces, and the amount scale is normalised ("  TAJ hotel " 450.00 = "Taj Hotel" 450) | Pass (5 tests) |
| 7 | Duplicate receipt by file hash (`DUPLICATE_RECEIPT`) | New hash → no hit | Hash used on an earlier claim → AUTO_REJECT, "Duplicate receipt file" | Same file twice in one claim → only the 2nd line is rejected | No receipt → never a duplicate | — | Pass (3 tests) |
| 8 | Weekend flag (`WEEKEND_EXPENSE`) | Friday and Monday → no hit | Saturday → ROUTE | Sunday → ROUTE, "Weekend expense — manager attention" | — | — | Pass (2 tests) |
| 9 | Random 10% sample audit | Rolls 0, 5, 9 → PENDING_AUDITOR, `sampleAudit=true`, `autoApproved=true` | Roll 10 (the boundary) → APPROVED | Rolls 50, 99 → APPROVED | Percent from config: 0% never selects, 100% always selects | Exactly 10 of the 100 possible rolls (0–99) select a claim. Routed or rejected claims are never sample-audited. | Pass (9 tests) |
| — | TRAVEL / OTHER always need a human (`NO_LIMIT_CATEGORY`) | — | — | Any amount → ROUTE | — | — | Pass (1 test) |
| — | Most severe hit wins | — | — | Cab ₹2,500 on a Saturday with no receipt → AUTO_REJECT with 3 hits recorded | — | — | Pass (1 test) |

**Claim-level routing** (`ClaimDecisionRouting`, 5 tests, all passed):
- A clean claim totalling exactly ₹5,000 is APPROVED and auto-approved.
- A clean claim of ₹5,000.01 goes to PENDING_MANAGER, with the reason "amount above auto-approve limit ₹5000".
- Any routed line sends the claim to PENDING_MANAGER, with the rule codes in the summary.
- If every line is rejected, the claim is REJECTED with an approved amount of 0.
- Rejected lines are excluded from the approved amount: ₹1,300 total gives ₹400 approved.

## How the 10% sample audit was verified

The engine does not call a random number generator itself. `PolicyService` draws `SecureRandom.nextInt(100)` and passes the value to `PolicyEngine.decide(..., auditRoll)`. So the **selection logic** can be tested exactly, without relying on chance:
- A claim is selected only when it is clean, within the limit, and `auditRoll < SAMPLE_AUDIT_PERCENT`.
- Exactly 10 of the 100 equally likely rolls qualify.

On top of that, two observations from real data (not used as pass/fail gates):
- **Seeded history:** 89 of 1,025 auto-approved seeded claims, or 8.68%, were selected. The 95% binomial range for a true 10% rate on 1,025 claims is about 8.2%–11.8%. Query output is in [05-security-checklist.md](05-security-checklist.md) (evidence for item 14).
- **Live run:** in the final E2E run, a clean ₹600 claim (CLM-003269) was randomly selected and routed to `PENDING_AUDITOR` ([evidence/e2e-results.json](evidence/e2e-results.json), E2E-07).

## The same rules through the real API

Every rule was also checked end to end through `POST /api/claims/{id}/submit` against the running backend and PostgreSQL. These are tests POL-API-01 to POL-API-10 in [`qa/api-tests/02-claims-policy.test.mjs`](../../qa/api-tests/02-claims-policy.test.mjs), **10/10 passed**. They confirm what an unpure unit test can't:
- the per-day meal total across separate claims
- the hash-based duplicate check across employees
- the stored violation messages
- the resulting claim status

## Test-design note

The first run had 1 failing test. `belowLimitIsAutoApproved` used a ₹1,499.99 meal **without** a receipt, and the receipt rule correctly rejected it. That was a mistake in the test data, not an application defect. The test now attaches a receipt, so it isolates the meal rule.
