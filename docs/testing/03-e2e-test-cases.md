# End-to-End Test Cases (10)

**How executed:** each case was run through the **real UI** in Google Chrome (headless), using `playwright-core` with [`qa/e2e/e2e-cases.mjs`](../../qa/e2e/e2e-cases.mjs). Actions were real form entries, file uploads, buttons and confirmation dialogs, against the running backend and PostgreSQL.

**Final run:**
- run id `QA-mwz131i1`, 2026-11-27 13:41 UTC
- frontend `http://localhost:5173` (Vite dev server, which proxies `/api` to the Spring Boot backend on `:8080`)

**Evidence:**
- [evidence/e2e-results.json](evidence/e2e-results.json): every observed value
- [evidence/e2e-run.txt](evidence/e2e-run.txt): console output
- [evidence/screenshots/](evidence/screenshots/): one screenshot per case
- [evidence/payout_PB-00023.csv](evidence/payout_PB-00023.csv): the exported bank file

**Result: 10 executed, 10 passed, 0 failed, 0 blocked.**

**Test data conventions:**
- Claim titles start with the run id (`QA-…`).
- Vendors are unique per run.
- Expense dates are weekdays or Saturdays in 2024, outside the seeded 12-month window, so seeded data can't trigger the duplicate or daily-meal rules by accident.
- Each run generates its own receipts: real PNG images with unique hashes.

**Users:** `employee` (Rohan Gupta, Engineering, reports to `manager`), `manager` (Vikram Rao), `auditor` (Anil Kumar), `financehead` (Priya Sharma), `maria.sharma` (Maria Sharma, a manager in another reporting line). Password `Demo@123`.

---

### E2E-01 — Normal expense submission and manager approval
- **Preconditions:** the stack is running. `employee` reports to `manager`.
- **Test data:** a Hotel line in Nagpur (not a tier-1 city): 2 nights, ₹7,000 (₹3,500 per night, within the ₹4,000 limit), a Wednesday, with a receipt.
- **Steps:**
  1. Log in as `employee`, then go to New claim.
  2. Enter the title and click Create draft.
  3. Choose Hotel, then enter the date, amount, vendor, city and nights. Click Add expense.
  4. Upload the receipt in the line's dropzone.
  5. Click Submit for approval, then Submit claim in the dialog.
  6. Log in as `manager`, then go to Approvals. The claim is listed.
  7. Open the claim and click Approve. Enter a comment and confirm.
- **Expected:**
  - After submit: `Pending · Manager` with no violations. The policy engine routes the claim because ₹7,000 is above the ₹5,000 auto-approve limit.
  - After approval: `Approved` (₹7,000 ≤ ₹25,000). The history shows the manager's approval.
- **Actual:**
  - Claim 3262 (CLM-003262).
  - After submit: `Pending · Manager`, violations `[]`. Banner: "Policy engine: Routed to manager: amount above auto-approve limit ₹5000."
  - After approval: `Approved`.
  - History: "Submitted by Rohan Gupta", "Policy check by System (policy engine)", "Approved by Vikram Rao".
- **Status: Pass**

### E2E-02 — Expense above ₹25,000 requiring auditor review
- **Preconditions:** as in E2E-01.
- **Test data:** a Hotel line in Mumbai (tier-1): 5 nights, ₹26,000 (₹5,200 per night, within the ₹6,000 limit), with a receipt.
- **Steps:**
  1. As `employee`, create and submit the claim.
  2. As `manager`, approve it.
  3. As `auditor`, open Audit queue. The claim is listed. Open it and click Approve.
- **Expected:** `Pending · Manager` → `Pending · Auditor` (because ₹26,000 > ₹25,000) → `Approved`.
- **Actual:** claim 3263. After submit `Pending · Manager`, after the manager `Pending · Auditor`, after the auditor `Approved`.
- **Status: Pass**

### E2E-03 — Expense above ₹1,00,000 requiring Finance Head approval
- **Test data:** a Hotel line in Mumbai: 20 nights, ₹1,10,000 (₹5,500 per night), with a receipt.
- **Steps:**
  1. As `employee`, submit the claim.
  2. As `manager`, approve it.
  3. As `auditor`, approve it.
  4. As `financehead`, approve it.
- **Expected:** Manager → Auditor → `Pending · Finance Head` → `Approved`. There are three approval entries.
- **Actual:**
  - Claim 3264. After the manager `Pending · Auditor`, after the auditor `Pending · Finance Head`, after the FH `Approved`.
  - Approvals in the history: "Approved by Vikram Rao", "Approved by Anil Kumar", "Approved by Priya Sharma".
- **Status: Pass**

### E2E-04 — Expense exceeding a policy limit
- **Test data:** a Local cab line of ₹2,500 (the limit is ₹2,000 per trip), with a receipt, on a weekday.
- **Steps:** as `employee`, create and submit the claim, then read the violations and line outcome on the claim page.
- **Expected:** `Pending · Manager`. The violation `CAB_TRIP_LIMIT` is shown, and the line badge reads "Needs approval".
- **Actual:** claim 3265. `Pending · Manager`, violations `["CAB_TRIP_LIMIT"]`, line badge "Needs approval".
- **Status: Pass**

### E2E-05 — Missing mandatory receipt
- **Test data:** a Meal line of ₹800 **with no receipt**.
- **Steps:**
  1. As `employee`, add the line. Check the hint under the amount field.
  2. Submit the claim.
- **Expected:**
  - The form hints "Receipt required above ₹500".
  - After submit, the claim is `Rejected` (its only line is auto-rejected), with `RECEIPT_REQUIRED`.
- **Actual:**
  - Hint: "Receipt required above ₹500.00."
  - Claim 3266 is `Rejected`, violations `["RECEIPT_REQUIRED"]`, message "Receipt required above ₹500".
- **Status: Pass**

### E2E-06 — Duplicate expense submission
- **Test data:** two claims, each with one Local cab line: the same vendor (the 2nd written in UPPER CASE), ₹450, the same date, no receipt (≤ ₹500 needs none).
- **Steps:** as `employee`, submit claim A, then submit claim B.
- **Expected:** claim A is clean. Claim B gets `DUPLICATE_EXPENSE` and goes to `Pending · Manager`.
- **Actual:**
  - Claim A (3267): `Approved` (auto-approved), violations `[]`.
  - Claim B (3268): `Pending · Manager`, violations `["DUPLICATE_EXPENSE"]`.
- **Status: Pass**

### E2E-07 — Duplicate receipt file upload
- **Test data:** two claims with Local cab lines (₹600 and ₹700, different vendors and dates). **The same receipt file** is uploaded to both.
- **Steps:** as `employee`, submit claim A with the file, then submit claim B with the same file.
- **Expected:** claim A is clean. Claim B gets `DUPLICATE_RECEIPT`, and since that is its only line it is auto-rejected, so the claim is `Rejected`.
- **Actual:**
  - Claim A (3269): violations `[]`, status `Pending · Auditor`. It was clean and auto-approved, then **randomly picked for the 10% sample audit**.
  - Claim B (3270): `Rejected`, violations `["DUPLICATE_RECEIPT"]`.
- **Status: Pass**

### E2E-08 — Weekend expense flagging
- **Test data:** a Local cab line of ₹300 dated Saturday 2024-10-26, no receipt.
- **Steps:**
  1. As `employee`, submit the claim.
  2. As `manager`, open Approvals and find the row.
- **Expected:** `WEEKEND_EXPENSE`, `Pending · Manager`, and the row shows the ⚠ flag in the manager's queue.
- **Actual:** claim 3271. `Pending · Manager`, violations `["WEEKEND_EXPENSE"]`, flag shown in the queue: true.
- **Status: Pass**

### E2E-09 — Manager clarification, employee resubmission and approval
- **Test data:** a Hotel line in Indore: 2 nights, ₹7,200, with a receipt.
- **Steps:**
  1. As `employee`, submit the claim.
  2. As `manager`, click Send back and confirm with an **empty** comment. The dialog shows an error. Cancel.
  3. Send back with the comment "Please split breakfast out of the room rate".
  4. As `employee`, open Edit. The comment is shown in a banner.
  5. Edit the line amount to ₹7,000, save, and click Resubmit claim.
  6. As `manager`, approve.
- **Expected:**
  - An empty comment is blocked.
  - The status becomes `Clarification requested` and the employee sees the comment.
  - Resubmitting returns the claim to `Pending · Manager`, and the approval makes it `Approved`.
  - The history shows the send-back and two submissions.
- **Actual:**
  - Claim 3272. Error "A comment is required to send back."
  - The status became `Clarification requested`, and the banner read "Vikram Rao asked for clarification: Please split breakfast out of the room rate".
  - After resubmit `Pending · Manager`, then `Approved`.
  - History: Submitted → Policy check → Sent back for clarification by Vikram Rao → Submitted → Policy check → Approved by Vikram Rao.
- **Status: Pass**

### E2E-10 — Delegated approval, then payout and CSV export
- **Test data:** a delegation from Vikram Rao to Maria Sharma, from today to today + 2. A Hotel line in Nashik: 2 nights, ₹7,500, with a receipt.
- **Steps:**
  1. As `manager`, open Approvals → Delegation panel. Choose Maria Sharma, set the dates and click Add delegation.
  2. As `employee`, submit the claim.
  3. As `maria.sharma`, open Approvals. The claim is listed. Approve it.
  4. As `financehead`, open Payouts. Click Create payout batch and confirm. Download the CSV, then click Mark paid and confirm.
  5. As `employee`, check the claim.
  6. As `manager`, remove the delegation.
- **Expected:**
  - The delegation shows as Active, and the delegate can approve.
  - The history records the delegate **on behalf of** the manager.
  - The CSV has an H row, D rows for the approved claims, and a T row.
  - The batch and the claim end as `Paid`.
- **Actual:**
  - The delegation showed as "Active, 27 Nov 2026 → 29 Nov 2026".
  - Claim 3273 was `Approved` with history "Approved by Maria Sharma on behalf of Vikram Rao".
  - Batch **PB-00023** was created. The CSV `payout_PB-00023.csv` has 8 rows:
    - `H,EXPENSEFLOW,PB-00023,2026-11-27,6,157950.00`
    - D rows that include CLM-003262, 003263, 003264, 003272 and 003273 (all present)
    - `T,6,157950.00`
  - The batch status is `Paid`, and the claim status is `Paid`.
  - The delegation was removed.
- **Status: Pass**

---

## Summary

| ID | Scenario | Status |
|---|---|---|
| E2E-01 | Normal submission and manager approval | Pass |
| E2E-02 | Above ₹25,000 → auditor review | Pass |
| E2E-03 | Above ₹1,00,000 → Finance Head | Pass |
| E2E-04 | Policy limit exceeded | Pass |
| E2E-05 | Missing mandatory receipt | Pass |
| E2E-06 | Duplicate expense | Pass |
| E2E-07 | Duplicate receipt file | Pass |
| E2E-08 | Weekend flag | Pass |
| E2E-09 | Clarification and resubmission | Pass |
| E2E-10 | Delegation → payout → CSV | Pass |

The same 10 cases also passed in an earlier run (`QA-mwz0sv4r`, batch PB-00021) before the final regression run.
