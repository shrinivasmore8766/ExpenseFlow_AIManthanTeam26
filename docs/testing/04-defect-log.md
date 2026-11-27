# Defect Log

Only **application** defects are listed here. Mistakes in the test code found while writing tests (wrong test data, a test race) are listed separately in the [regression report](08-regression-test-report.md#test-code-issues-not-application-defects).

| ID | Module | Severity | Status |
|---|---|---|---|
| [DEF-01](#def-01) | Payout CSV export | Medium | **Verified** (fixed and regression-tested) |
| [DEF-02](#def-02) | Approval workflow | **High** | **Open**: needs a business decision |
| [DEF-03](#def-03) | Claim lines API validation | Low | Open |
| [DEF-04](#def-04) | Authentication | Medium | Open: needs a new capability |
| [DEF-05](#def-05) | Logging | Low | Open |

---

### DEF-01
- **Module:** Payout, `backend/.../payout/BankCsvWriter.java`
- **Description:** the CSV-injection guard prefixed cells starting with `= + - @`, but not cells starting with a **tab** or **carriage return**. OWASP lists those as formula triggers too. A claim title or employee name starting with a tab followed by `=cmd…` would reach the bank CSV unescaped.
- **Severity:** Medium. The CSV is meant to be opened in spreadsheet tools by finance staff.
- **Reproduction:** the unit test `BankCsvWriterTest.tabAndCarriageReturnPrefixesAreNeutralised` with inputs `"\t=cmd"` and `"\r=cmd"`.
- **Expected:** the cell is prefixed with `'`.
- **Actual (before the fix):** `"\t=cmd"` came out unchanged, and `"\r=cmd"` was quoted but not prefixed. Both test cases failed, as shown in the first `mvn test` run: 93 tests, 3 failures.
- **Root cause:** the guard character set `"=+-@"` was incomplete.
- **Fix applied:** a one-line change to `"=+-@\t\r"`, with an updated comment. No other behaviour changed.
- **Regression test:** `BankCsvWriterTest` passes 8/8. API PAY-03 checks the real CSV has no unescaped formula cells. E2E-10 downloaded and parsed `payout_PB-00023.csv`. The backend container was rebuilt and the whole suite re-run.
- **Status:** Verified

### DEF-02
- **Module:** Approval workflow (`ApprovalRules.canAct` and `ApprovalService`)
- **Description:** a claim above ₹1,00,000 whose **manager-level approver is the Finance Head** gets stuck in `PENDING_FINANCE_HEAD` permanently. Nobody can approve, reject or send it back. Who is affected:
  - the Finance Head's own claims (their manager-level approver is the CEO)
  - claims from the Finance Head's direct reports: `auditor`, `auditor2`, `rahul.patel`, `sai.banerjee`
- **Severity:** High. These reimbursements can never be paid, and the claim is invisible in every queue.
- **Reproduction:**
  - **Own claim** ([script](../../qa/repro/DEF-02-finance-head-own-claim.mjs), [output](evidence/DEF-02-repro-finance-head-own-claim.txt)):
    1. `financehead` submits a ₹1,00,001 Travel claim. The manager-level approver is the CEO.
    2. `ceo` approves → `PENDING_AUDITOR`.
    3. `auditor` approves → `PENDING_FINANCE_HEAD`.
    4. Now FH gets 403 "You cannot act on your own claim", CEO gets 403 "You already approved this claim", auditor gets 403 "already approved", and `auditor2` gets 403 "not an approver". The claim is in nobody's queue.
  - **Direct report** ([script](../../qa/repro/DEF-02b-finance-head-direct-report.mjs), [output](evidence/DEF-02-repro-finance-head-direct-report.txt)):
    1. `auditor2` submits a ₹1,00,001 claim.
    2. `financehead` approves as their manager → `PENDING_AUDITOR`.
    3. `auditor` approves → `PENDING_FINANCE_HEAD`.
    4. Now FH gets 403 "You already approved this claim".
- **Expected:** requirements A11 and B21 (`docs/architecture/01-requirements-analysis.md`): "If approver at a level == claimant, escalate to the next eligible person" and "CEO approves FH claims". So the claim must reach someone who is allowed to finish it.
- **Actual:** no eligible actor exists. The rule against self-approval and the rule against the same person approving twice together exclude the only Finance Head and the CEO.
- **Root cause:** the Finance Head level is tied to the single `FINANCE_HEAD` role, and there is no escalation rule for when that person is excluded.
- **Fix applied:** **none, on purpose.** Each possible fix changes a business rule, and the brief says not to change business requirements. Options for the team:
  1. Escalate the Finance Head level to a configured approver (for example the CEO) when the FH is the claimant or already approved. For the FH's own claim, the CEO would then approve twice, so a different escalation user is needed.
  2. Treat the FH level as satisfied when the FH already approved at manager level, and record a system history entry. This needs explicit sign-off, because it weakens four-eyes control.
  3. Allow a second Finance Head, or a delegate with the FH role, for this case.

  After a decision, add unit tests to `ApprovalRulesTest` and replay the two repro scripts.
- **Regression test result:** the repro scripts reproduce the defect every time. The two stuck QA claims were removed from the database afterwards, and the audit-log rows were kept.
- **Status:** Open

### DEF-03
- **Module:** Claim lines API (`LineRequest`)
- **Description:** the API accepts an expense date in the future. Requirement A16 says future dates should be rejected, and it is SHOULD item 8 in `04-final-3h-architecture.md`. The UI blocks it, because the date picker has `max = today`, but direct API calls get through.
- **Severity:** Low. A future-dated line is still checked by every other policy rule and approval level.
- **Reproduction:** `POST /api/claims/{id}/lines` with `expenseDate` = today + 30 days → **200**. This is API test EXP-04, which records the current behaviour.
- **Expected:** 400.
- **Actual:** 200.
- **Root cause:** `LineRequest.expenseDate` has no `@PastOrPresent` (or similar) check.
- **Fix applied:** not applied. A plain `@PastOrPresent` uses the server's UTC date, so an employee in India entering *today's* date between 00:00 and 05:30 IST would be rejected wrongly. The fix needs a timezone decision, such as allowing today + 1 day in UTC.
- **Status:** Open

### DEF-04
- **Module:** Authentication (`SecurityConfig`)
- **Description:** there is no lockout or throttling after repeated failed logins. Combined with HTTP Basic, which checks credentials on every request, this allows unlimited password guessing.
- **Severity:** Medium (security).
- **Reproduction:** 15 wrong-password requests for `employee2` all returned 401, and the correct password still worked straight after (API test SEC-11).
- **Expected:** a lockout or rising delays after N failures, with an audit entry.
- **Actual:** no limit.
- **Root cause:** not in the 3-hour scope. ADR 0004 accepted HTTP Basic for the demo.
- **Fix applied:** not applied. It needs a new capability (a failure counter or rate limiter), and the brief says no new features.
- **Status:** Open (recommendation in the [security checklist](05-security-checklist.md))

### DEF-05
- **Module:** Logging
- **Description:** when two approvers act on the same claim at the same moment, the API correctly answers **409** (optimistic locking). But Hibernate also logs `ERROR … HHH100501 StaleStateException` for each conflict. During the concurrency test, 5 ERROR lines appeared for an expected, handled situation.
- **Severity:** Low. This is log noise that could trigger false SRE alerts. No data or behaviour is wrong.
- **Reproduction:** API test APR-04 (3 simultaneous approve calls), then `docker compose logs backend | grep " ERROR "`.
- **Expected:** at most WARN for a handled conflict.
- **Actual:** ERROR from `org.hibernate.orm.jdbc.batch`.
- **Fix applied:** not applied. Turning that logger down globally would also hide genuine batch failures, so the right fix belongs to the SRE phase (alert rules), which is out of scope here.
- **Status:** Open
