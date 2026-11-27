# ExpenseFlow — Requirements Analysis (Step 1, agreed)


## 1. Roles & Permissions

| Capability | Employee | Line Manager | Finance Auditor | Finance Head (Admin) |
|---|---|---|---|---|
| Create/edit/submit own claims | ✅ | ✅ | ✅ | ✅ |
| View claims | own only | own + direct reports' claims assigned to them | all (read) | all |
| Approve / reject / send back | ❌ | level 1 (direct reports) | level 2 (>25k) + sample audits | level 3 (>1L) |
| Delegate own approvals while on leave | ❌ | ✅ | ✅ | ✅ |
| Review queue, filters, bulk approve | ❌ | own inbox (no bulk on flagged) | ✅ | ✅ |
| Create payout batch, export CSV, mark Paid | ❌ | ❌ | ❌ | ✅ |
| Dashboard | ❌ (own summary) | team | all | all |
| Policy config, users, hierarchy | ❌ | ❌ | ❌ | ✅ |
| Audit trail | own claims' history | assigned claims | all | all |

Roles are additive (a manager is also an employee). **Nobody may ever act on their own claim**, in any role or as a delegate.

---

## 2. Business Rules (from the spec)

**Claims**
- BR-1 Claim = header + ≥1 line items (category, amount, date, vendor, receipt, description; hotel adds city + nights).
- BR-2 Draft can be saved and edited freely; submit freezes the claim (immutable lines).
- BR-3 Employee sees only their own claims (enforced server-side, not just UI).

**Policy (all seeded as configuration, not code)**
- PR-1 Meals ≤ 1,500 INR **per day**.
- PR-2 Hotel ≤ 6,000 INR/night in tier-1 cities, ≤ 4,000 elsewhere (city-tier list is config).
- PR-3 Local cab ≤ 2,000 INR per trip.
- PR-4 Receipt mandatory when amount > 500 INR.
- PR-5 Duplicate: same vendor + amount + date as an earlier line → flag.
- PR-6 Duplicate: same receipt file hash (SHA-256) → flag.
- PR-7 Weekend expense → flag for manager attention (not a rejection).
- Engine returns per line: **AUTO_APPROVE / ROUTE_FOR_APPROVAL / AUTO_REJECT (with reason)**.

**Approval chain (thresholds are config)**
- AP-1 Manager always approves routed claims.
- AP-2 + Finance Auditor if claim amount > 25,000.
- AP-3 + Finance Head if claim amount > 1,00,000.
- AP-4 Approvers can comment, approve, reject, send back for clarification, delegate while on leave.

**Audit / payout / reporting**
- AU-1 Random 10% of auto-approved claims flagged for sample audit → auditor queue.
- AU-2 Auditor queue with filters + bulk approve.
- PY-1 Approved claims → payout batch → CSV mock bank file → claims become PAID.
- RP-1 Dashboard: spend by category / department / month, policy violations, avg approval time.
- AT-1 Append-only audit trail of every action.

---

## 3. Ambiguities & Proposed Defaults [DECIDE]

| # | Ambiguity | Proposed default |
|---|---|---|
| A1 | Engine decides **per line**, approval is **per claim**. How to combine? | Line outcome = most severe rule result. Rejected lines are excluded from payable amount (claim continues). All lines rejected → claim AUTO_REJECTED. Any line ROUTE → whole claim routed. All lines AUTO_APPROVE → claim auto-approved. |
| A2 | When is a claim "auto-approve"? Spec says chain always starts at manager. | Auto-approve only if every line is clean (no flags) **and** claim total ≤ configurable auto-approve limit (default **5,000**). Otherwise route. |
| A3 | Over-limit spend: reject, cap, or route? | Configurable action per rule. Defaults: limit breach → ROUTE with violation flag (manager sees it); missing receipt > 500 → AUTO_REJECT line; receipt-hash duplicate → AUTO_REJECT line; vendor/amount/date duplicate → ROUTE + DUPLICATE flag; weekend → FLAG (route). |
| A4 | Meals "per day" — per line, per claim, or per employee? | Sum per **employee per date across all non-rejected claims**. Stops line/claim splitting. |
| A5 | Hotel "per night" | Line has `nights`; limit = rate × nights. City chosen from controlled list (no free text). |
| A6 | Threshold basis for 25k / 1L | Sum of non-rejected line amounts; strictly greater-than. |
| A7 | Duplicate scope | Receipt hash: **company-wide** (catches colleagues claiming same bill). Vendor+amount+date: company-wide, vendor name normalized (lowercase, trimmed, punctuation stripped). Compare against all prior submitted lines incl. rejected. |
| A8 | Categories without a limit (Airfare, Other…) | No limit rule → always ROUTE; "Other" requires description. |
| A9 | Send back for clarification — then what? | Claim returns to employee editable; on resubmit, **policy re-runs and chain restarts at level 1**. |
| A10 | Delegation details | Time-bound (from/to), one active delegate per approver, no re-delegation, delegate must not be the claimant, delegate must hold ≥ the required role for that level. Audit records "X on behalf of Y". Delegate resolved **at action time**. |
| A11 | Self/top-of-tree approvals (manager's own claim, finance head's claim, approver = claimant at a later level) | Chain built from claimant's reporting line. Seed a CEO/Director at the top with MANAGER role. If approver at a level == claimant, escalate to the next eligible person (another auditor / CEO). |
| A12 | Sample audit — does it block payout? | Yes: state SAMPLE_AUDIT; payable only after auditor clears. Selection via `SecureRandom` at auto-approval time, decision stored, never shown to employee. |
| A13 | Bulk approve and flags | Bulk approve disabled for claims with violation/duplicate flags — those need individual review. |
| A14 | "Move to Paid" timing | Export CSV → batch EXPORTED; Finance Head clicks "Mark batch paid" (simulating bank confirmation) → claims PAID. |
| A15 | Department for reporting | Snapshot employee's department on the claim at submit time. |
| A16 | Other gaps | INR only; withdraw allowed only before first approver action; reject expense dates in the future or older than 90 days (config); employee bank account/IFSC needed for CSV. |
| A17 | Avg approval time definition | `final_decision_at − submitted_at` for routed claims (exclude auto-approved), also per level. |

---

## 4. Claim Lifecycle (State Machine)

```
DRAFT ──submit──► SUBMITTED ──policy engine──┬─► AUTO_REJECTED (terminal)
  ▲                                           ├─► AUTO_APPROVED ──90%──► APPROVED
  │                                           │        └──10%──► SAMPLE_AUDIT ─auditor─► APPROVED | REJECTED
  │                                           └─► PENDING_MANAGER
  │                                                   │ approve: amt>25k ─► PENDING_AUDITOR
  │                                                   │          amt>1L  ─► (after auditor) PENDING_FINANCE_HEAD
  │                                                   │ else ─► APPROVED
  └──resubmit── CLARIFICATION_REQUESTED ◄──send back── any PENDING_*
                                     any PENDING_* ──reject──► REJECTED (terminal)
APPROVED ──added to batch──► IN_PAYOUT ──batch marked paid──► PAID (terminal)
DRAFT/PENDING_MANAGER(no action yet) ──withdraw──► WITHDRAWN
```
Every transition is a single service method, validated against an allowed-transition table, written with optimistic locking (`@Version`), and emits an audit event.

---

## 5. Policy Engine Design (policy-as-configuration)

- Table `policy_rule`: `code, rule_type, category, params (jsonb), action (REJECT|ROUTE|FLAG), severity, active, version, effective_from`.
- Java: one `RuleEvaluator` per **rule type** (not per rule) — the code knows *how* to check, the DB says *what* limits:
  `CATEGORY_DAILY_LIMIT` (meals), `PER_UNIT_LIMIT_BY_CITY_TIER` (hotel), `PER_TXN_LIMIT` (cab), `RECEIPT_REQUIRED_ABOVE`, `DUPLICATE_VENDOR_AMOUNT_DATE`, `DUPLICATE_RECEIPT_HASH`, `WEEKEND_FLAG`, `DATE_SANITY`.
- Each returns `RuleResult{code, outcome, message}`; results stored in `line_violation` with policy version → explainable, reproducible decisions.
- Approval thresholds (25k / 1L / auto-approve 5k / sample 10%) in `approval_config`, also versioned.
- Engine is a pure function over (claim, history lookup, config) → easy to TDD (spec requires tests **before** the engine).

---

## 6. Database Requirements (PostgreSQL + Flyway)

| Table | Key columns / notes |
|---|---|
| `department` | id, name, code |
| `app_user` | emp_code, name, email, password_hash, department_id, manager_id (self-FK), roles, bank_account, ifsc, active |
| `delegation` | delegator_id, delegate_id, valid_from, valid_to, active |
| `expense_category`, `city_tier` | reference data |
| `policy_rule`, `approval_config` | versioned config (above) |
| `claim` | claim_no, employee_id, department_id (snapshot), status, total_amount, payable_amount, current_level, current_approver_id, sample_audit, submitted_at, decided_at, paid_at, `version` |
| `claim_line` | claim_id, category, expense_date, amount, vendor, vendor_normalized, city, nights, description, receipt_id, outcome, reject_reason |
| `receipt` | storage_key, original_name, content_type, size, sha256, uploaded_by |
| `line_violation` | line_id, rule_code, outcome, message, policy_version |
| `approval_step` | claim_id, level, assigned_approver_id, acted_by_id, on_behalf_of_id, action, comment, acted_at |
| `payout_batch` / `payout_item` | batch_no, status, totals, file checksum / **claim_id UNIQUE** (no double pay), bank snapshot |
| `audit_log` | actor, action, entity, entity_id, before/after jsonb, ip, ts, prev_hash, hash — **INSERT-only** (DB trigger blocks UPDATE/DELETE + hash chain) |

Indexes: `claim(status, current_approver_id)`, `claim(employee_id)`, `claim_line(vendor_normalized, amount, expense_date)`, `receipt(sha256)`, `claim_line(employee, expense_date, category)` for daily meal sum.
Seed: 8 depts, 150 users with hierarchy (1 CEO, 1 Finance Head, 3 Auditors, 8 dept heads, ~20 managers), 3,000 historical claims over 12 months with ~3% planted duplicates, ~5% limit breaches, weekend spend — deterministic seed, run via one command.

---

## 7. API Requirements (REST, `/api/v1`)

- **Auth**: `POST /auth/login` (JWT), `GET /me`
- **Claims**: `POST /claims`, `PUT /claims/{id}` (draft only), `GET /claims?mine`, `GET /claims/{id}`, `POST /claims/{id}/submit`, `POST /claims/{id}/withdraw`, `DELETE /claims/{id}` (draft)
- **Lines & receipts**: `POST/PUT/DELETE /claims/{id}/lines[/{lineId}]`, `POST /receipts` (multipart, returns id + hash), `GET /receipts/{id}` (authorized stream)
- **Policy preview**: `POST /claims/{id}/evaluate` (dry-run before submit, shows warnings live)
- **Approvals**: `GET /approvals/inbox?filters`, `POST /claims/{id}/approve|reject|send-back|comment`, `POST /approvals/bulk-approve`
- **Delegation**: `POST/GET/DELETE /delegations`
- **Audit queue**: `GET /audit-queue?dept&category&amountMin&flag&sample`, bulk approve
- **Payout**: `POST /payout-batches` (collect APPROVED), `GET /payout-batches/{id}/export.csv`, `POST /payout-batches/{id}/mark-paid`
- **Dashboard**: `GET /reports/spend?groupBy=category|department|month&from&to`, `/reports/violations`, `/reports/approval-time`
- **Admin**: `GET/PUT /admin/policy-rules`, `/admin/approval-config`, `/admin/users`
- **Audit trail**: `GET /claims/{id}/history`, `GET /audit-log` (admin)
- **Ops**: `/actuator/health`, `/actuator/prometheus` (restricted)
- Paged responses, standard error body (RFC 7807 ProblemDetail), OpenAPI via springdoc.

---

## 8. Approval Bypass Scenarios (skeptical finance auditor view)

| # | Bypass | Mitigation |
|---|---|---|
| B1 | **Claim splitting**: 30k split into two 15k claims to dodge auditor | Flag "possible split" when an employee's claims within 7 days sum past a threshold; aggregate same-trip claims |
| B2 | **Line splitting**: 2,000 dinner as two 1,000 lines | Daily per-employee aggregation (A4) |
| B3 | Splitting to stay under 500 receipt rule | Flag ≥3 receiptless lines same day/vendor |
| B4 | Editing claim after approval / during review | Lines immutable after submit; edits only in CLARIFICATION state, which restarts chain + re-runs policy |
| B5 | Self-approval (own claim, delegating to self, delegate = claimant) | Hard check `actor != claimant` and `onBehalfOf != claimant` at every step |
| B6 | Delegating to a friendly peer/subordinate | Delegate role ≥ level, time-bound, visible in audit and dashboard |
| B7 | Changing reporting line to a lenient manager | Approver snapshot at submit; hierarchy changes audited; admin-only |
| B8 | Duplicate evasion: re-scan receipt (new hash), vendor typo, amount ±1 | Vendor normalization; near-duplicate flag (same vendor, amount ±1%, date ±1 day) for review |
| B9 | Colleagues claim the same shared bill | Company-wide hash + vendor/amount/date check |
| B10 | Resubmitting a rejected claim as new | Duplicate check includes rejected lines |
| B11 | Moving weekend date to weekday / backdating | Date sanity rules; receipt shown side-by-side to approver; sample audit |
| B12 | Misreporting city tier or category ("Other" for meals) | Controlled city list; "Other" always routes, needs description |
| B13 | Staying just under auto-approve limit repeatedly | Frequency flag on employees with many near-threshold claims |
| B14 | Gaming sample audit (predictable 10%) | `SecureRandom`, decision persisted, hidden from employee; withdraw/resubmit doesn't reroll (dup check) |
| B15 | **API bypass**: call approve endpoint directly, IDOR on claimId, mass-assign `status=APPROVED` | Server-side RBAC + object ownership checks on every endpoint; request DTOs never contain status/amount-approved |
| B16 | Race: double approval / claim in two batches | `@Version` optimistic locking; unique `payout_item.claim_id` |
| B17 | Bulk-approving flagged claims | A13 — bulk excludes flagged |
| B18 | Admin loosens policy temporarily, then reverts | Config versioned + audited; claim stores policy version used |
| B19 | Bank account switched just before payout | Bank detail changes audited; flagged in batch if changed within 7 days |
| B20 | Editing exported CSV / tampering audit log | Store file checksum on batch; audit log insert-only + hash chain |
| B21 | Finance Head (admin) approving own claim or editing own data | Same self-approval rules apply to admin; CEO approves FH claims |

**Hackathon scope**: B1, B2, B4, B5, B10, B14–B17 are must-implement (cheap, high-impact); others as flags/stretch or documented in the threat review.

---

## 9. Security Requirements
- Spring Security + JWT (short expiry), BCrypt passwords, login rate limiting.
- RBAC (`@PreAuthorize`) **plus** object-level checks (ownership / assigned approver) — the IDOR rule.
- Bean Validation on all DTOs (amount > 0, max cap, dates, enums); no entity binding (mass assignment).
- File upload: whitelist PDF/JPG/PNG by magic bytes, max 5 MB, random storage keys outside web root, served only via authorized endpoint.
- **CSV injection** guard on export (prefix cells starting with `= + - @`).
- JPA parameterized queries only; React default escaping (no `dangerouslySetInnerHTML`).
- CORS locked to frontend origin; actuator restricted; no stack traces in errors.
- Secrets via env vars / `.env` (git-ignored); OWASP dependency-check + `npm audit` in CI.
- Append-only audit log enforced at DB level.

## 10. Reporting & SRE Requirements
- **Dashboard**: spend by category / department / month (APPROVED+PAID), top policy violations by rule & dept, avg approval time overall & per level, plus queue counts.
- **SRE metrics** (Micrometer → Prometheus → Grafana): pending queue size per level, **oldest pending approval age**, approval-time histogram, HTTP p95 latency per endpoint.
- **Alert**: oldest pending approval > 48h (threshold to validate), p95 latency > 1s.
- **Runbook**: stuck approvals, failed exports, DB down, high latency.

---

## 11. Practical Hackathon Plan (backend-first, 2 devs)

| Step | Dev A | Dev B | Claude usage (for judges) |
|---|---|---|---|
| 0 Architecture | Context/container diagram, state machine, ADR "approval chain modelling" | Policy-as-config design, ERD | Skeptical-auditor review → this bypass list |
| 1 Foundation | Spring Boot skeleton, Flyway schema, CLAUDE.md with business rules | Auth/JWT, users, hierarchy, seed data generator | Plan-first prompts |
| 2 Core | **Policy engine (tests first)** | Claims + lines + receipts + hashing | Rule-by-rule test generation |
| 3 Workflow | Approval chain, delegation, send-back | Audit log, sample audit, auditor queue + bulk | Threshold/delegation tests |
| 4 Money & reports | Payout batch + CSV | Dashboard/report queries | |
| 5 UI (React) | Claim capture (mobile), side-by-side receipt viewer | Data tables w/ filters & bulk, dashboard charts | Layout/state proposals, stopwatch test |
| 6 Test/Deploy/SRE | 10 E2E cases, defect log, security checklist | Docker Compose, GitHub Actions CI, Prometheus/Grafana, alert, runbook | Code vuln review, CI authoring |

**MVP cut line** (must work in demo): steps 0–4 + core UI screens + Compose + CI. Stretch: Grafana, near-duplicate fuzzy match, split detection, hash-chained audit.

**Suggested repo layout**: `backend/` (Spring Boot, packages: `auth, user, claim, policy, approval, audit, payout, report`), `frontend/` (React + Vite), `docs/` (architecture, ADRs, threat review, test cases, defect log, runbook), `docker-compose.yml`, `.github/workflows/ci.yml`, `CLAUDE.md`.

## Verification (of this analysis)
- Team walks the state machine with 5 sample claims (12k clean, 30k with hotel breach, 1.2L, duplicate receipt, weekend meal) and confirms every transition and approver.
- Confirm the [DECIDE] defaults in §3; they then go verbatim into `CLAUDE.md` and the policy-engine test suite.
