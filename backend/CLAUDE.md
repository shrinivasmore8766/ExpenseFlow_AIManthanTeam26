# ExpenseFlow Backend — Instructions for Claude

ExpenseFlow is an expense claims system with a policy engine, a multi-level approval chain, an auditor queue,
a payout CSV export and a dashboard. Hackathon build: **2 developers, 3 hours**. A small, fully working
app beats a sophisticated, unfinished one.

The frontend lives in `../frontend` (see `../frontend/CLAUDE.md`). The **API contract table below is
duplicated in both files and must stay identical**.

## 1. Guardrails (read before every task)
- Always prioritize working functionality. Get it compiling, running and demoable first.
- Do not overengineer. Do not create abstractions, interfaces or generic frameworks without a real, present need.
- Do not introduce libraries beyond those listed in §2. Ask first.
- Do not implement microservices, message brokers, async processing or caching.
- Do not duplicate business rules:
  - policy logic lives only in `policy/PolicyEngine`
  - approval routing and permission logic lives only in `approval/ApprovalRules`
  - the frontend never re-implements these; it renders `allowedActions` and `violations`
- Never return mock data from an endpoint. Implement the real query.
- Do not change an agreed API contract (path, method, request or response field) without updating the
  table in both CLAUDE.md files and telling the other developer.
- Run relevant tests after meaningful changes: `./mvnw test`.
- Fix existing build or test errors before adding more features.
- Keep changes inside the feature package you are working on. Shared files (`SecurityConfig`,
  `GlobalExceptionHandler`, `DataSeeder`) take small, additive edits only.

## 2. Final technical decisions
| Area | Decision |
|---|---|
| Runtime | Java 17, Spring Boot 3.3.x, Maven wrapper |
| Dependencies (only these) | spring-boot-starter-web, -data-jpa, -security, -validation, -actuator; postgresql; micrometer-registry-prometheus; spring-boot-starter-test; spring-security-test. **No Lombok, no MapStruct, no extra libs.** |
| Architecture | Modular monolith, package per feature, layered Controller → Service → Repository |
| Pure rule classes | `policy/PolicyEngine` and `approval/ApprovalRules`: no Spring, JPA or I/O imports; inputs in, results out |
| DB | PostgreSQL 16. Schema from JPA entities with `spring.jpa.hibernate.ddl-auto=update` (deliberate 3 h trade-off; Flyway later) |
| Config data | Policy limits in table `policy_rule`; thresholds in table `app_config`; both seeded by `DataSeeder`; never hard-coded |
| Processing | Synchronous. One `@Transactional` service method per user action changes state, writes `approval_action` and writes `audit_log` |
| Auth | Spring Security HTTP Basic, stateless, BCrypt, users from table `employee` |
| Receipts | Local folder `${app.receipts.dir}` (Docker volume), file name = random UUID, SHA-256 hex stored on the line |
| API | REST + JSON under `/api`; DTOs are Java `record`s; errors are Spring `ProblemDetail` |
| Metrics | Actuator `health` + `prometheus`; custom gauges in `dashboard/PendingMetrics` |

## 3. Folder structure
```
src/main/java/com/expenseflow/
  config/     SecurityConfig, WebConfig, GlobalExceptionHandler, TimeConfig (Clock bean)
  common/     CurrentUser (resolves logged-in Employee), NotFoundException (404), ForbiddenException (403),
              BadRequestException (400), ConflictException (409 illegal state)
  user/       Employee, Department, Delegation, Role + repositories, UserController, DelegationController, DelegationService
  policy/     PolicyEngine (pure), PolicyContext, LineInput, LineResult, Outcome, PolicyRule, AppConfig, PolicyService, PolicyRuleController
  claim/      Claim, ClaimLine, ClaimStatus, Category, PolicyViolation, ClaimService, ClaimController, ReceiptStorage, dto/
  approval/   ApprovalRules (pure), ApprovalAction, ApprovalService, ApprovalController
  payout/     PayoutBatch, PayoutService, PayoutController, BankCsvWriter
  dashboard/  DashboardService, DashboardController, PendingMetrics
  audit/      AuditLog, AuditLogRepository, AuditService
  seed/       DataSeeder
src/test/java/com/expenseflow/
  policy/PolicyEngineTest   approval/ApprovalRulesTest   security/ClaimAccessWebTest
```

## 4. Business rules (source of truth)

### 4.1 Roles
- `EMPLOYEE`, `MANAGER`, `FINANCE_AUDITOR`, `FINANCE_HEAD` (Finance Head is also admin).
- One role per user. **Every role can also submit its own claims.**
- An employee sees **only their own claims**.
- Nobody may act on their own claim, in any role or as a delegate.

### 4.2 Claim statuses
`DRAFT`, `PENDING_MANAGER`, `PENDING_AUDITOR`, `PENDING_FINANCE_HEAD`, `CLARIFICATION_REQUESTED`,
`APPROVED`, `REJECTED`, `PAID`.
- A claim in a payout batch stays `APPROVED`, with `payoutBatchId` set, until the batch is marked paid.
- Lines are editable only in `DRAFT` and `CLARIFICATION_REQUESTED`, and only by the claimant.

### 4.3 Categories
`MEAL`, `HOTEL`, `LOCAL_CAB`, `TRAVEL`, `OTHER`.
- HOTEL requires `city` and `nights` ≥ 1.
- Amounts are `BigDecimal`, > 0, at most 2 decimals, at most 10,00,000 per line.

### 4.4 Policy engine (`PolicyEngine.evaluate(List<LineInput>, PolicyContext) → List<LineResult>`)
All limits come from `policy_rule.limit_amount` and `app_config`. Comparisons are **strictly greater than**.

| Rule code | Check | Line outcome |
|---|---|---|
| `RECEIPT_REQUIRED` | amount > 500 and no receipt | AUTO_REJECT "Receipt required above ₹500" |
| `DUPLICATE_RECEIPT` | receipt hash equals the hash on any earlier line (other claims, any employee, not DRAFT) or an earlier line in this claim | AUTO_REJECT "Duplicate receipt file" |
| `DUPLICATE_EXPENSE` | same vendor (trimmed, lower-case) + amount + date as an earlier line (same scope as above) | ROUTE "Possible duplicate expense" |
| `MEAL_DAILY_LIMIT` | MEAL: employee's meal total for that date (this claim + other non-draft, non-rejected claims) > 1500 | ROUTE |
| `HOTEL_TIER1_LIMIT` / `HOTEL_OTHER_LIMIT` | HOTEL: amount / nights > 6000 if city ∈ `TIER1_CITIES`, else > 4000 | ROUTE |
| `CAB_TRIP_LIMIT` | LOCAL_CAB: amount > 2000 | ROUTE |
| `WEEKEND_EXPENSE` | expense date is Saturday or Sunday | ROUTE "Weekend expense — manager attention" |
| `NO_LIMIT_CATEGORY` | TRAVEL or OTHER | ROUTE (always needs human approval) |

- Line outcome = most severe result: `AUTO_REJECT > ROUTE > AUTO_APPROVE`. Every hit is stored as a `policy_violation`.
- `approvedAmount` = sum of the lines that are not AUTO_REJECT.
- Claim outcome:
  - all lines AUTO_REJECT → `REJECTED`
  - else any ROUTE line, or approvedAmount > `AUTO_APPROVE_LIMIT` (5000) → `PENDING_MANAGER`
  - else **auto-approved**: with probability `SAMPLE_AUDIT_PERCENT` (10, `SecureRandom`) → `PENDING_AUDITOR` with `sampleAudit=true`; otherwise `APPROVED`. In both cases `autoApproved=true`.
- `PolicyService` builds the `PolicyContext`: rules, config, and lookups of prior hashes, prior vendor/amount/date keys and the employee's meal totals per date. The engine itself never queries the DB.

### 4.5 Approval workflow (`ApprovalRules`, used only by `ApprovalService`)
- **Submit / resubmit** (claimant; from DRAFT or CLARIFICATION_REQUESTED):
  - delete old violations, run the policy, set the status per §4.4
  - set `currentApproverId` = claimant's manager; if the claimant has no manager, the Finance Head
  - set `submittedAt`
  - resubmit always restarts at the manager
- **Approve**:
  - `PENDING_MANAGER` → `PENDING_AUDITOR` if approvedAmount > `AUDITOR_THRESHOLD` (25000), else `APPROVED`
  - `PENDING_AUDITOR` → `APPROVED` if `sampleAudit`; else `PENDING_FINANCE_HEAD` if approvedAmount > `FINANCE_HEAD_THRESHOLD` (100000), else `APPROVED`
  - `PENDING_FINANCE_HEAD` → `APPROVED`
  - set `decidedAt` when the claim reaches APPROVED or REJECTED
- **Reject**: any PENDING_* → `REJECTED`. Comment required.
- **Send back**: any PENDING_* → `CLARIFICATION_REQUESTED`. Comment required.
- **Comment** is stored on the `approval_action` row.
- **canAct(actor, claim, activeDelegations, priorApproverIdsThisRound)** is true only if **all** hold:
  - actor ≠ claimant
  - actor did not already approve this claim since its last submit
  - and, by status:
    - `PENDING_MANAGER`: actor = currentApprover, or actor is an active delegate of currentApprover
    - `PENDING_AUDITOR`: actor role is FINANCE_AUDITOR, or actor is an active delegate of an auditor
    - `PENDING_FINANCE_HEAD`: actor role is FINANCE_HEAD, or actor is an active delegate of the Finance Head
- **Delegation**:
  - stored as `delegator → delegate`, `startDate..endDate` inclusive
  - active if today is within the range
  - delegate ≠ delegator
  - when a delegate acts, `onBehalfOfId` = delegator
- **Bulk approve** (auditor queue): approve each claim only if `canAct` and `hasViolations == false`. Otherwise skip it with a reason. Returns `{approved:[ids], skipped:[{id, reason}]}`.
- Every state change uses optimistic locking (`@Version`). On a conflict, return 409.

### 4.6 Payout
- Finance Head only.
- **Create batch**: all claims with status `APPROVED` and `payoutBatchId == null`. Sets `payoutBatchId`, the batch's total and count, status `EXPORTED`.
- **CSV** (`text/csv`, `payout_<batchNumber>.csv`):
  ```
  H,EXPENSEFLOW,<batchNumber>,<yyyy-MM-dd>,<count>,<total>
  D,<claimNumber>,<employeeName>,<bankAccount>,<ifsc>,<amount>,INR,<claimTitle>
  T,<count>,<total>
  ```
  Amounts use 2 decimals. Any cell starting with `= + - @` gets a `'` prefix (CSV-injection guard).
- **Mark paid**: batch → `PAID`; its claims → `PAID` with `paidAt` set.

### 4.7 Dashboard (Finance Head, Auditor; Manager sees own department only)
- Spend = approvedAmount of claims in `APPROVED` or `PAID`, grouped by category (from lines), department and month (`submittedAt`, last 12 months).
- Violations = count of `policy_violation` rows by `rule_code`.
- Average approval time = mean of `decidedAt − submittedAt` in hours, for claims that are `APPROVED`/`PAID` and **not** `autoApproved`.
- Also: pending count per PENDING_* status, and oldest pending age in hours.

### 4.8 Audit trail
- `AuditService.log(actor, action, entityType, entityId, details)` is called inside the same transaction for:
  - create, update and delete of drafts
  - receipt upload
  - submit and policy outcome
  - approve, reject, send back, bulk approve
  - delegation create and delete
  - payout create, export and mark paid
  - policy rule edits
- `AuditLogRepository` extends `Repository` (not `JpaRepository`) and exposes only `save` and finders. The entity is `@Immutable`.

### 4.9 Seed data (`DataSeeder`, runs when `app.seed.enabled=true` and the `employee` table is empty)
- **Departments (8)**: Engineering, Sales, Marketing, Finance, HR, Operations, Delivery, Legal.
- **Fixed demo users**, password from `app.seed.demo-password` (default `Demo@123`):

  | Username | Role | Department | Reports to |
  |---|---|---|---|
  | `ceo` | MANAGER | — | nobody |
  | `financehead` | FINANCE_HEAD | Finance | `ceo` |
  | `auditor` | FINANCE_AUDITOR | Finance | `financehead` |
  | `auditor2` | FINANCE_AUDITOR | Finance | `financehead` |
  | `manager` | MANAGER | Engineering | `ceo` |
  | `employee` | EMPLOYEE | Engineering | `manager` |
  | `employee2` | EMPLOYEE | Engineering | `manager` |

- The remaining users are generated up to **150**: one head per department reporting to `ceo`, about 2 managers per department, and the rest employees.
- **Policy rules** with the limits in §4.4.
- **app_config**:
  - `AUTO_APPROVE_LIMIT=5000`
  - `AUDITOR_THRESHOLD=25000`
  - `FINANCE_HEAD_THRESHOLD=100000`
  - `SAMPLE_AUDIT_PERCENT=10`
  - `TIER1_CITIES=Mumbai,Delhi,Bengaluru,Chennai,Kolkata,Hyderabad,Pune,Ahmedabad`
- **3,000 historical claims** over the last 12 months, using a fixed `Random(42)`:
  - run through the same `PolicyEngine`
  - roughly 3% duplicates (same receipt hash, or same vendor/amount/date)
  - roughly 5% limit breaches, plus weekend lines
  - realistic final statuses (mostly APPROVED/PAID, some REJECTED, about 60 still PENDING_*, a few pending more than 3 days)
  - matching `approval_action` rows and `decidedAt` timestamps
- Seeded claims don't need receipt files: store a hash only.
- Use JDBC batch inserts if JPA seeding takes longer than about 20 s.
- SHOULD: create the trigger that blocks UPDATE/DELETE on `audit_log` via `JdbcTemplate`.

## 5. API contract (identical copy in frontend/CLAUDE.md)
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

## 6. Coding conventions
- Packages and classes as in §3. One public class per file. Constructor injection only (no `@Autowired` on fields).
- Entities: plain JPA with getters and setters. IDs are `Long` `IDENTITY`. Enums are `@Enumerated(STRING)`. Use `@ManyToOne(fetch = LAZY)`.
- **Never serialize entities.** Map to `record` DTOs inside the `@Transactional` service method. This avoids lazy-loading
  errors and JSON recursion. Set `spring.jpa.open-in-view=false`.
- Validation: `@Valid` plus Jakarta constraints on request records. Business-rule violations throw `BadRequestException`,
  `ForbiddenException` or `NotFoundException`. `GlobalExceptionHandler` maps them to `ProblemDetail`.
- Money: `BigDecimal`, `scale 2`, `RoundingMode.HALF_UP`. Never `double`.
- Time: use an injected `java.time.Clock` bean in services, so tests and the seeder can control "now".
- Keep methods short and named for the business action (`submit`, `approve`, `sendBack`). No speculative interfaces.
- SQL: Spring Data derived queries or `@Query` JPQL with parameters. Never concatenate user input into SQL.
- Logging: SLF4J. INFO for business actions with claimId. Never log passwords, receipts or bank numbers.

## 7. Security requirements
- `SecurityConfig`:
  - `httpBasic` with a **custom entry point that returns 401 without a `WWW-Authenticate` header**, so the browser shows no popup
  - stateless sessions
  - CSRF disabled (no cookies are used)
  - `BCryptPasswordEncoder`
  - `UserDetailsService` loads `employee` by username **on every request**, so role changes apply immediately
- URL rules: `/actuator/health` is public. Everything else under `/api/**` is authenticated. Role-only endpoints are listed in §5.
- Object-level checks live in services:
  - claims list is always filtered by the current employee in the query
  - single-claim access per §5 row 6; otherwise throw `NotFoundException` (404)
  - actions go through `canAct`
- Request DTOs never contain `status`, `employeeId`, `approvedAmount`, `outcome`, `sampleAudit` or `version`.
- Uploads:
  - allow only `application/pdf`, `image/jpeg`, `image/png`, checked by magic bytes, max 5 MB (`spring.servlet.multipart.max-file-size=5MB`)
  - store under a UUID name; never use the client file name in a path
  - serve only via endpoint 13
- CSV-injection guard on export (§4.6).
- Secrets: DB credentials and the demo password come from env vars (`.env`, git-ignored). Commit `.env.example` only.
- `/actuator/prometheus` is exposed for the demo, and that is documented as an internal-only endpoint.

## 8. Testing expectations
- **Write tests before the code**: `PolicyEngineTest` before `PolicyEngine`, and `ApprovalRulesTest` before `ApprovalRules`.
- `PolicyEngineTest` covers at least one passing and one failing case per rule, including boundaries:
  - meals: 1500.00 passes, 1500.01 routes; daily meal total across two lines
  - hotel: tier-1 6000 passes, 6000.01 routes; non-tier 4000 vs 4000.01; per-night math with `nights = 3`
  - cab: 2000 vs 2000.01
  - receipt: 500 with no receipt passes, 500.01 with no receipt is rejected
  - duplicates: duplicate hash rejected, duplicate vendor/amount/date routed (case-insensitive vendor)
  - weekend: Saturday routed
  - TRAVEL is routed
  - combination: all rejected → REJECTED; clean ≤ 5000 → auto-approve; clean 5000.01 → PENDING_MANAGER
- `ApprovalRulesTest` covers:
  - thresholds: 25000 → APPROVED after the manager; 25000.01 → PENDING_AUDITOR; 100000 vs 100000.01 after the auditor
  - a sample-audit claim goes to APPROVED after the auditor
  - self-approval is denied
  - the same user can't approve twice
  - the delegate is allowed inside the date range and denied outside it
  - a non-assigned manager is denied
  - resubmit starts at PENDING_MANAGER
- SHOULD: `@WebMvcTest` with `spring-security-test`:
  - an employee GET on another employee's claim → 404
  - an employee calling `/api/payouts` → 403
  - an unauthenticated call → 401
- Run `./mvnw test` before every push. A red build is fixed before any new feature.

## 9. Build and run
```bash
# DB only (local dev)
docker compose up -d db
# backend (http://localhost:8080)
./mvnw spring-boot:run            # Windows: mvnw.cmd spring-boot:run
./mvnw test                       # unit + web tests
./mvnw -DskipTests package        # jar for Docker
# full stack, seeded demo (from repo root)
docker compose up --build
```
`application.yml` reads `DB_URL` (default `jdbc:postgresql://localhost:5432/expenseflow`), `DB_USER`, `DB_PASSWORD`,
`APP_SEED_ENABLED` (default true), `APP_DEMO_PASSWORD`, `APP_RECEIPTS_DIR` (default `./data/receipts`).
Quick check: `curl -u employee:Demo@123 http://localhost:8080/api/me`.

## 10. Avoid unnecessary complexity — explicitly out of scope
JWT/OAuth, Flyway, JSONB, Lombok/MapStruct, Testcontainers, async/events/queues, caching, pagination,
generic "rule framework" interfaces, hexagonal ports/adapters, DTO-mapping libraries, multi-module Maven,
Kubernetes. If you think one is needed, stop and ask.
