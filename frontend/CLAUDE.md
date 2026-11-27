# ExpenseFlow Frontend — Instructions for Claude

React UI for ExpenseFlow (expense claims, policy engine, approval chain, auditor queue, payout, dashboard).
Hackathon build: **2 developers, 3 hours**. A small, fully working app beats a sophisticated, unfinished one.

The backend lives in `../backend` (see `../backend/CLAUDE.md`). The **API contract table below is
duplicated in both files and must stay identical**.

## 1. Guardrails (read before every task)
- Always prioritize working functionality. Every screen must call the real API.
- Do not overengineer. No component libraries, design systems, or generic table/form frameworks.
  Build simple components only when they are reused at least twice.
- Do not introduce libraries beyond those listed in §2. Ask first.
- Do not implement microservices or a BFF. The frontend talks to the single backend via `/api`.
- Do not duplicate business rules. The UI **never** calculates policy outcomes, approval routing,
  thresholds or permissions. It renders `status`, `violations` and `allowedActions` from the API.
  (Input validation for UX, like required fields, is fine. The backend still validates.)
- Do not use mock or hard-coded data where a working API exists. If an endpoint is missing, implement it in the
  backend or ask. Never fake the response.
- Do not change an agreed API contract without updating the table in both CLAUDE.md files and telling the other developer.
- Run `npm run build` after meaningful changes. It must pass with no errors.
- Fix existing build errors before adding more features.

## 2. Final technical decisions
| Area | Decision |
|---|---|
| Stack | React 18, Vite, **JavaScript (JSX)**, no TypeScript (3 h trade-off) |
| Dependencies (only these) | `react`, `react-dom`, `react-router-dom`, `recharts` (dashboard only). Dev: `vite`, `@vitejs/plugin-react`. **No axios, Redux, React Query, MUI/AntD/Tailwind, form libs.** |
| HTTP | Native `fetch` wrapped once in `src/api/client.js` |
| State | `useState`/`useEffect` per page; `AuthContext` for the current user only |
| Styling | One `src/styles.css`, CSS variables, mobile-first; tables dense |
| Auth | HTTP Basic: the header is built from username/password at login, verified with `GET /api/me`, kept in memory + `sessionStorage` |
| Dev proxy | `vite.config.js` proxies `/api` → `http://localhost:8080` (no CORS needed) |
| Prod | Static build served by nginx, which proxies `/api` to the `backend` service |

## 3. Folder structure
```
src/
  main.jsx            router + AuthProvider
  App.jsx             routes, role-based nav (Layout)
  styles.css
  api/client.js       apiGet/apiPost/apiPut/apiDelete/apiUpload/apiDownload, error handling
  auth/AuthContext.jsx login(username,password), logout(), user, hasRole()
  components/
    Layout.jsx        top bar + nav by role
    StatusBadge.jsx   colour per status
    Money.jsx         ₹ formatting (en-IN)
    ViolationList.jsx rule badges + messages
    ReceiptViewer.jsx <img> or <iframe> for PDF, loaded via an authenticated blob URL
    HistoryTimeline.jsx approval/audit history
  pages/
    LoginPage.jsx        form + demo user quick-pick buttons
    MyClaimsPage.jsx     own claims table
    ClaimFormPage.jsx    create/edit draft, lines, receipt upload, submit (mobile-first)
    ClaimDetailPage.jsx  lines + violations | receipt viewer side-by-side; history; action buttons from allowedActions
    ApprovalsPage.jsx    inbox / auditor queue: filters, checkbox bulk approve, delegation panel (SHOULD)
    PayoutPage.jsx       eligible claims, create batch, download CSV, mark paid (FINANCE_HEAD)
    DashboardPage.jsx    Recharts bar charts + KPI tiles
    PolicyRulesPage.jsx  list rules; FH can edit limits (SHOULD)
```

## 4. Business rules the UI must reflect (display only; the backend decides)
- **Roles and navigation**:
  - all roles: My Claims, New Claim
  - MANAGER / FINANCE_AUDITOR / FINANCE_HEAD: Approvals, Dashboard
  - FINANCE_HEAD: Payout, Policy Rules
- **Statuses** (badge colours):
  - `DRAFT` grey
  - `PENDING_MANAGER` / `PENDING_AUDITOR` / `PENDING_FINANCE_HEAD` amber, shown as "Pending · Manager/Auditor/Finance Head"
  - `CLARIFICATION_REQUESTED` blue
  - `APPROVED` green
  - `REJECTED` red
  - `PAID` dark green
  - Show a "Sample audit" tag when `sampleAudit` is true. Show it only to approvers, never on the employee's own views.
- **Line categories**: `MEAL`, `HOTEL`, `LOCAL_CAB`, `TRAVEL`, `OTHER`. HOTEL shows the `city` and `nights` inputs.
- **Receipts**: the UI hints "Receipt required above ₹500". The policy limits shown on the form come from `GET /api/policy-rules`, never hard-coded.
- **Line outcome badges**: `AUTO_APPROVE` ✓, `ROUTE` ⚠ (needs approval), `AUTO_REJECT` ✕ (with the message).
- **Actions**:
  - show only the buttons in `allowedActions`
  - Reject and Send back open a comment box; the comment is required, and the UI enforces non-empty
  - after an action, re-render from the returned `ClaimDetail`
- **Bulk approve**: checkboxes on the approvals table. After the call, show "N approved, M skipped" with the skip reasons.
  Flagged rows (`hasViolations`) show a ⚠ icon.
- **Employees** only reach their own claims. If the API returns 404 on a claim, show "Claim not found".

## 5. API contract (identical copy in backend/CLAUDE.md)
Base path `/api`. Auth: HTTP Basic on every call except `/actuator/health`. JSON uses camelCase. Dates are `yyyy-MM-dd`;
timestamps are ISO-8601 UTC. Money is a JSON number with 2 decimals.
Errors: `ProblemDetail` `{status, title, detail}`. Status codes:
- 400 validation
- 401 not logged in
- 403 wrong role
- **404 for claims you may not see**
- 409 version conflict or illegal state

| # | Method & path | Who | Request | Response |
|---|---|---|---|---|
| 1 | `GET /api/me` | any | – | `User {id, username, fullName, role, departmentId, departmentName, managerName}` |
| 2 | `GET /api/users?role=` | MANAGER, AUDITOR, FH | – | `User[]` (for the delegate picker) |
| 3 | `GET /api/departments` | any | – | `[{id, name}]` |
| 4 | `GET /api/claims` | any | – | `ClaimSummary[]`, **own claims only**, newest first |
| 5 | `POST /api/claims` | any | `{title}` | `ClaimDetail` (DRAFT) |
| 6 | `GET /api/claims/{id}` | claimant, anyone who can act or has acted, AUDITOR, FH | – | `ClaimDetail` |
| 7 | `PUT /api/claims/{id}` | claimant, editable status | `{title}` | `ClaimDetail` |
| 8 | `DELETE /api/claims/{id}` | claimant, DRAFT | – | 204 |
| 9 | `POST /api/claims/{id}/lines` | claimant, editable status | `LineRequest {category, expenseDate, amount, vendor, city, nights, description}` | `ClaimDetail` |
| 10 | `PUT /api/claims/{id}/lines/{lineId}` | same | `LineRequest` | `ClaimDetail` |
| 11 | `DELETE /api/claims/{id}/lines/{lineId}` | same | – | `ClaimDetail` |
| 12 | `POST /api/claims/{id}/lines/{lineId}/receipt` | same | multipart `file` (pdf/jpg/png, ≤ 5 MB) | `ClaimDetail` |
| 13 | `GET /api/claims/{id}/lines/{lineId}/receipt` | whoever can view the claim | – | file bytes, correct `Content-Type` |
| 14 | `POST /api/claims/{id}/submit` | claimant, DRAFT or CLARIFICATION_REQUESTED | – | `ClaimDetail` (with policy outcome) |
| 15 | `GET /api/approvals?status=&departmentId=&minAmount=&flaggedOnly=` | MANAGER, AUDITOR, FH | – | `ClaimSummary[]` the caller `canAct` on (incl. via delegation), oldest first, max 500 |
| 16 | `POST /api/claims/{id}/approve` | `canAct` | `{comment?}` | `ClaimDetail` |
| 17 | `POST /api/claims/{id}/reject` | `canAct` | `{comment}` (required) | `ClaimDetail` |
| 18 | `POST /api/claims/{id}/send-back` | `canAct` | `{comment}` (required) | `ClaimDetail` |
| 19 | `POST /api/approvals/bulk-approve` | AUDITOR, FH | `{claimIds: number[]}` | `{approved: number[], skipped: [{id, reason}]}` |
| 20 | `GET /api/delegations` | MANAGER, AUDITOR, FH | – | `[{id, delegatorName, delegateId, delegateName, startDate, endDate, active}]` (mine as delegator) |
| 21 | `POST /api/delegations` | MANAGER, AUDITOR, FH | `{delegateId, startDate, endDate}` | the created delegation |
| 22 | `DELETE /api/delegations/{id}` | delegator | – | 204 |
| 23 | `GET /api/payouts/eligible` | FH | – | `ClaimSummary[]` (APPROVED, not batched) |
| 24 | `POST /api/payouts` | FH | – | `PayoutBatch {id, batchNumber, createdAt, claimCount, totalAmount, status, paidAt}` |
| 25 | `GET /api/payouts` | FH | – | `PayoutBatch[]` |
| 26 | `GET /api/payouts/{id}/csv` | FH | – | `text/csv` attachment |
| 27 | `POST /api/payouts/{id}/mark-paid` | FH | – | `PayoutBatch` |
| 28 | `GET /api/dashboard` | MANAGER (own dept), AUDITOR, FH | – | `{spendByCategory:[{label, amount}], spendByDepartment:[…], spendByMonth:[…], violationsByRule:[{label, count}], avgApprovalHours, pendingByStatus:[{label, count}], oldestPendingHours}` |
| 29 | `GET /api/policy-rules` | any | – | `[{id, code, category, limitAmount, description, active}]` |
| 30 | `PUT /api/policy-rules/{id}` | FH | `{limitAmount, active}` | the updated rule (SHOULD) |

**Shapes**
- `ClaimSummary = {id, claimNumber, title, status, employeeName, departmentName, totalAmount, approvedAmount, submittedAt, hasViolations, sampleAudit}`
- `ClaimDetail = ClaimSummary + {employeeId, autoApproved, currentApproverName, lines: Line[], history: HistoryItem[], allowedActions: string[]}`
  - `allowedActions` ⊆ `EDIT, SUBMIT, DELETE, APPROVE, REJECT, SEND_BACK`, computed by the backend for the caller.
- `Line = {id, category, expenseDate, amount, vendor, city, nights, description, hasReceipt, receiptContentType, outcome, violations: [{ruleCode, outcome, message}]}`
- `HistoryItem = {at, actorName, onBehalfOfName, action, fromStatus, toStatus, comment}`
  - built from `approval_action`; SYSTEM entries have `actorName = "System (policy engine)"`.

## 6. API integration standards
- All calls go through `src/api/client.js`. Components never call `fetch` directly.
- `client.js`:
  - prefixes `/api`
  - adds `Authorization: Basic …` and `Accept: application/json`
  - sends JSON bodies with `Content-Type: application/json`
  - `apiUpload` sends `FormData` and does **not** set Content-Type itself
  - on a non-2xx response it reads `ProblemDetail.detail` (fallback `title`) and throws `Error(message)` with `.status`
  - on **401** it clears auth and redirects to `/login`
- Receipt viewing and CSV download fetch with auth, then use `URL.createObjectURL(blob)`. Plain `<a href>` links won't carry the auth header.
- Every page has three states: **loading** (simple "Loading…"), **error** (red banner with the message plus a Retry button), and **empty** ("No claims yet" with a call-to-action).
- Disable action buttons while a request is in flight, to prevent double submits.
- Format money with `Intl.NumberFormat('en-IN', {style:'currency', currency:'INR'})`. Format dates as `dd MMM yyyy` via `toLocaleDateString('en-IN')`.

## 7. UX requirements (spec)
- **Mobile-friendly claim capture**:
  - single column below 768 px
  - large tap targets
  - native `<input type="date">`, `type="number" inputmode="decimal"`, and `<input type="file" accept="image/*,application/pdf" capture="environment">`
- **Side-by-side receipt viewer** for approvers:
  - ClaimDetailPage uses a 2-column grid at ≥ 1024 px: the lines table on the left, the selected line's receipt on the right
  - stacked on mobile
  - clicking a line selects its receipt
- **Dense, scannable tables**:
  - sticky header, right-aligned amounts, a status badge, a ⚠ for violations
  - a row checkbox and a select-all for bulk actions on ApprovalsPage
  - filters in one row above the table
- **Login page**: buttons "Employee / Manager / Auditor / Finance Head" fill in the demo usernames for a fast demo.

## 8. Coding conventions
- Function components and hooks only. One component per file. PascalCase file names for components.
- Keep pages self-contained: fetch in `useEffect`, keep local state, extract a component only when it is reused.
- No business constants in the UI (thresholds, limits, rule logic). Read them from the API.
- Use semantic HTML (`<table>`, `<label htmlFor>`, `<button>`) for accessibility.
- No `dangerouslySetInnerHTML`. No `eval`. Render all user text as text.

## 9. Security requirements
- Credentials are kept in memory plus `sessionStorage` (cleared when the tab closes). Never use `localStorage` or cookies.
  Logout clears both. This is an accepted demo trade-off of HTTP Basic, documented in the security checklist.
- Never log credentials or receipt contents to the console.
- Hidden buttons are not security. The backend enforces everything, and the UI just mirrors `allowedActions`.
- Validate file type and size (≤ 5 MB) client-side for UX only.

## 10. Testing expectations
- `npm run build` must pass before every push.
- No frontend unit-test framework (3 h trade-off).
- The 10 written E2E cases in `docs/testing/e2e-cases.md` are run manually against `docker compose up` before the demo, and results are recorded there. Any failure is logged in `docs/testing/defect-log.md`.
- After changing a page, click through its happy path against the real backend with the matching demo user.

## 11. Build and run
```bash
npm install
npm run dev        # http://localhost:5173, proxies /api to http://localhost:8080 (backend must be running)
npm run build      # production build into dist/ — must pass
npm run preview
# full stack from repo root:
docker compose up --build   # UI at http://localhost:3000
```
Demo users (password `Demo@123` unless `.env` changes it): `employee`, `employee2`, `manager`, `auditor`, `financehead`, `ceo`.

## 12. Avoid unnecessary complexity — explicitly out of scope
TypeScript, Redux/Zustand/React Query, axios, UI kits, CSS frameworks, form libraries, i18n,
service workers/PWA, WebSockets, SSR/Next.js, micro-frontends, OpenAPI code generation, unit-test frameworks.
If you think one is needed, stop and ask.
