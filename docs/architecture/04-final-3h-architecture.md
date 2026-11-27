# ExpenseFlow — Final 3-Hour Architecture (Step 4)

> Supersedes parts of [03-detailed-design.md](03-detailed-design.md) for the 3-hour build. Full coding rules and API contract: [backend/CLAUDE.md](../../backend/CLAUDE.md), [frontend/CLAUDE.md](../../frontend/CLAUDE.md).

## Context
The real budget is **3 hours and 2 developers**, each working across frontend and backend. Earlier steps are
already saved in `docs/`:
- requirements: `docs/architecture/01`
- architecture options: `docs/architecture/02`
- detailed design: `docs/architecture/03`
- ADRs: `docs/adr/`
- auditor review: `docs/reviews/`

Those docs assumed several days. This step cuts the design down to what we can **build, integrate, test and demo
in 3 hours**. It keeps every spec business rule, simplified where needed, and produces `backend/CLAUDE.md`
and `frontend/CLAUDE.md`.

Budget: 3 h × 2 devs = 6 dev-hours, with Claude generating most code. Rule of thumb: anything that needs
**new infrastructure, a new library to learn, or more than about 20 minutes of debugging risk** is out.

1. Write `backend/CLAUDE.md` and `frontend/CLAUDE.md` exactly as in Part 4.
2. Add `docs/architecture/04-final-3h-architecture.md` (Parts 1–3 and 6).
3. Mark ADR 0003 and 0004 as "amended by the 3-hour scope" with a one-line pointer.

No application code is written in this step.

---

## PART 1 — Feasibility-Based Selection

Ratings: **L**ow / **M**edium / **H**igh effort or risk. ✅ = selected, ❌ = rejected.

| Area | Option | 3 h? | Impl | Integr | Debug | Test | Risk incomplete | Maint | Eval coverage | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Deployable | Microservices | No | H | H | H | H | H | M | M | ❌ distributed transactions, several builds; would never finish |
| | **Modular monolith (package per feature)** | Yes | L | L | L | L | L | H | H | ✅ |
| Code style | Clean/hexagonal | No | H | M | M | L | H | H | M | ❌ about 2× classes and mapping code |
| | **Layered per feature (Controller → Service → Repository) + 2 pure-Java rule classes** | Yes | L | L | L | L | L | M | H | ✅ the pure classes are the ones we unit-test |
| Domain | Full DDD | No | H | – | M | M | H | H | M | ❌ ceremony |
| | **Simple services + JPA entities; state changes only inside `ApprovalService`/`ClaimService`** | Yes | L | L | L | L | L | M | M | ✅ |
| Module guard | ArchUnit / Spring Modulith | Marginal | M | – | M | M | M | H | L | ❌ nice to have, not demoable |
| Policy engine | Hard-coded `if`s | Yes | L | L | L | L | L | L | **fails spec** | ❌ "config, not hard-coded" |
| | Drools / Easy Rules | No | H | M | H | M | H | M | M | ❌ new library to learn |
| | SpEL expressions in DB | No | M | M | H | H | M | L | M | ❌ injection risk, hard to debug |
| | DB rules with JSONB params | Marginal | M | M | M | M | M | H | H | ❌ Hibernate JSON mapping is a debugging trap; not needed for about 8 rules |
| | **DB table with typed columns (`code, category, limit_amount, active`) + `app_config` key/value; rule logic in one pure `PolicyEngine` class** | Yes | L | L | L | L | L | M | H | ✅ limits editable in DB/API; logic unit-tested |
| Workflow | BPMN (Camunda/Flowable) / Spring Statemachine | No | H | H | H | M | H | M | M | ❌ |
| | Pre-computed `approval_step` table | Marginal | M | M | M | M | M | H | H | ❌ for 3 h: an extra table and sync logic |
| | **Status enum on claim + pure `ApprovalRules` (next status, can act) + `approval_action` history table** | Yes | L | L | L | L | L | M | H | ✅ the status *is* the current level |
| Processing | Kafka/RabbitMQ / async events | No | H | H | H | H | H | M | L | ❌ |
| | **Synchronous, one `@Transactional` service method per action (state + history + audit)** | Yes | L | L | L | L | L | H | H | ✅ |
| Schema mgmt | Flyway SQL migrations | Marginal | M | M | M | L | M | H | M | ❌ for 3 h: entities and DDL must be kept in sync by hand; mismatches cost startup debugging |
| | **JPA `ddl-auto=update` + Java `DataSeeder` (idempotent)** | Yes | L | L | L | L | L | M | M | ✅ deliberate trade-off, documented; Flyway is the stated next step |
| Data model | Strict 3NF + reporting store | No | M | M | M | M | M | H | M | ❌ |
| | **Normalized core, receipt fields stored on the line, `department_id` snapshot on claim** | Yes | L | L | L | L | L | M | H | ✅ |
| Audit | Envers / event sourcing / hash chain | No | M–H | M | M | M | M | – | M | ❌ |
| | **`audit_log` table written by one `AuditService.log()`; repository exposes no update/delete; DB trigger blocks UPDATE/DELETE (SHOULD)** | Yes | L | L | L | L | L | M | H | ✅ |
| Authentication | Keycloak / OAuth2 | No | H | H | H | M | H | H | M | ❌ |
| | JWT (jjwt + custom filter) | Marginal | M | M | M | M | M | M | M | ❌ for 3 h: filter, expiry and 401 handling cost 30–45 min of debugging; **challenges our earlier ADR 0004** |
| | Session cookie + form login | Marginal | M | M | M | M | M | M | M | ❌ CSRF and SPA session handling |
| | **Spring Security HTTP Basic, stateless, BCrypt users from DB, custom 401 entry point (no browser popup)** | Yes | L | L | L | L | L | M | M | ✅ zero extra deps; trivial in MockMvc/curl. Downside (credentials sent on every request, no server logout) accepted for demo; JWT is the next step |
| Authorization | Pure RBAC | Yes | L | L | L | L | L | L | **fails "own claims only"** | ❌ |
| | ACL / OPA | No | H | H | H | H | H | M | M | ❌ |
| | **URL role rules in `SecurityConfig` + ownership/`canAct` checks in services** | Yes | L | L | L | L | L | M | H | ✅ |
| Receipts | S3/MinIO | No | M | M | M | M | M | H | L | ❌ extra container |
| | DB `bytea` | Marginal | L | M | M | L | L | M | L | ❌ Hibernate `@Lob` maps to Postgres OIDs, a known trap |
| | **Local disk folder (Docker volume), random UUID file names, SHA-256 via `MessageDigest`, fields on `claim_line`** | Yes | L | L | L | L | L | M | H | ✅ |
| API style | GraphQL / gRPC / WebSocket | No | H | H | H | M | H | M | L | ❌ |
| | **REST + JSON, contract table duplicated in both CLAUDE.md files** | Yes | L | L | L | L | L | M | H | ✅ |
| Contracts | OpenAPI codegen → TS types | Marginal | M | M | M | – | M | H | M | ❌ for 3 h: toolchain setup; springdoc Swagger UI is NICE |
| Frontend lang | TypeScript | Marginal | M | L | M | – | M | H | M | ❌ for 3 h: type errors block the Docker build |
| | **React 18 + Vite + JavaScript (JSX)** | Yes | L | L | L | – | L | M | M | ✅ |
| UI libs | MUI / AntD / Tailwind / Redux / React Query / axios | Marginal | M | M | M | – | M | – | M | ❌ new APIs to learn, or bundle/setup time |
| | **react-router-dom + Recharts (dashboard only) + plain CSS + `fetch`** | Yes | L | L | L | – | L | M | H | ✅ two runtime deps |
| Unit tests | **JUnit 5 + AssertJ on `PolicyEngine` and `ApprovalRules` (pure, no Spring)** | Yes | L | – | L | L | L | H | H | ✅ written first |
| Integration | Testcontainers | Marginal | M | M | M | M | M | H | M | ❌ for 3 h: Docker-in-tests and slow CI |
| | **2–3 `@WebMvcTest` security tests (own-claim isolation, self-approval) with mocked services** | Yes | L | L | M | L | L | M | H | ✅ SHOULD |
| E2E | Playwright | No | M | M | H | M | H | M | M | ❌ for 3 h |
| | **10 written E2E cases (markdown) run manually against Docker, results recorded** | Yes | L | – | – | L | L | – | H | ✅ the spec asks for "written" cases |
| Deploy | Kubernetes / PaaS | No | H | H | H | – | H | – | M | ❌ |
| | **Docker Compose: `db`, `backend`, `frontend` (nginx proxies `/api`)** | Yes | L | M | M | – | L | H | H | ✅ build it early (by 1:15) |
| CI | Jenkins | No | M | M | M | – | M | – | M | ❌ |
| | OWASP dependency-check | Marginal | L | M | H | – | M | – | H | ❌ NVD download takes 10+ min and needs an API key |
| | **GitHub Actions: `mvn test`, `npm ci && npm run build`, `npm audit --audit-level=high`, Trivy filesystem scan, gitleaks** | Yes | L | L | L | – | L | H | H | ✅ |
| Monitoring | ELK / APM | No | H | H | H | – | H | – | M | ❌ |
| | Prometheus + Grafana containers | Marginal | M | M | M | – | M | H | H | NICE |
| | **Actuator + Micrometer Prometheus endpoint + custom gauges (pending count per status, oldest pending age) + `ops/prometheus/alerts.yml` + runbook** | Yes | L | L | L | – | L | H | H | ✅ |

---

## PART 2 — Three-Hour Scope

No spec business rule is dropped. Simplifications are stated next to each item.

### MUST HAVE (the demo fails without these)
1. **Login** with seeded users, HTTP Basic, and a demo user picker on the login page.
2. **Claim capture**:
   - create a draft with several lines (category, amount, date, vendor, city, nights, description)
   - edit and save the draft, upload a receipt per line, submit
   - mobile-responsive single column
3. **Policy engine** with all spec rules, all read from DB config:
   - meals ≤ 1,500 per employee per day
   - hotel ≤ 6,000 per night in tier-1 cities, ≤ 4,000 elsewhere
   - cab ≤ 2,000 per trip
   - receipt required above 500
   - duplicate vendor + amount + date
   - duplicate receipt hash
   - weekend flag

   The engine returns AUTO_APPROVE / ROUTE / AUTO_REJECT with reasons.
4. **Approval chain**:
   - manager, then auditor above 25,000, then Finance Head above 1,00,000
   - approve, reject, send back (comment mandatory for reject and send back)
   - no self-approval
   - resubmit after send-back re-runs the policy and restarts from the manager
5. **Approver screen**: inbox table plus claim detail with a **side-by-side receipt viewer**.
6. **Auditor queue**:
   - filters: status, department, minimum amount, flagged only
   - **bulk approve**, which skips flagged claims and reports what it skipped
   - **10% random sample audit** of auto-approved claims (status `PENDING_AUDITOR`, `sampleAudit = true`)
7. **Payout**: the Finance Head creates a batch from approved claims, downloads the mock bank CSV, and marks it paid. The claims become `PAID`.
8. **Dashboard**: spend by category, department and month; violations by rule; average approval time.
9. **Audit trail**: every action is written to `audit_log` and shown on the claim history. Employees only ever see their own claims.
10. **Seed data**:
    - 8 departments
    - 150 employees with a hierarchy
    - fixed demo users
    - policy rules and config
    - **3,000 historical claims** with planted duplicates and limit breaches
11. **Tests**: unit tests for every policy rule and for approval thresholds and delegation (pure classes).
12. **Docker Compose**: `docker compose up --build` starts the seeded demo.
13. **CI**: build plus tests.

### SHOULD HAVE (in this order, if time allows)
1. **Delegation while on leave**. This is in the spec, so it is first in line. Simplified to a date range and a delegate on the Approvals page. The backend `canAct` already supports it, and its unit test is in MUST.
2. `@WebMvcTest` security tests: an employee can't read another employee's claim, and nobody can approve their own claim.
3. Prometheus metrics endpoint with custom gauges, plus `ops/prometheus/alerts.yml` (oldest pending > 48 h) and `docs/sre/runbook.md`.
4. CI security steps: `npm audit`, Trivy filesystem scan, gitleaks.
5. Docs:
   - `docs/testing/e2e-cases.md` (10 cases, run and results recorded)
   - `docs/testing/defect-log.md`
   - `docs/testing/security-checklist.md`
6. A DB trigger that blocks UPDATE/DELETE on `audit_log`, created by the seeder via `JdbcTemplate`.
7. Policy rules page: read-only list, plus a Finance Head edit of `limit_amount` (`PUT /api/policy-rules/{id}`) to *show* "configuration, not code".
8. Rejecting expense dates in the future.

### NICE TO HAVE (only once everything above works in Docker)
- Prometheus and Grafana containers with a dashboard
- Swagger UI (springdoc)
- monthly cap on auto-approved spend (review N3)
- claim-split detection (B1)
- withdraw a claim
- pagination
- hash-chained audit log
- Playwright smoke test
- notifications

### Deliberately skipped (with the reason we give judges)
- **Advisory locks against parallel submit (N1)**: documented residual risk.
- **Four-eyes control on payout (N6)**: documented.
- **OCR and perceptual receipt hashing**: out of scope.
- **Microservices, BPMN, JWT/Keycloak, Flyway, Testcontainers, TypeScript, Kubernetes**: rejected in Part 1, each with a stated next step.

### Minimum end-to-end demo workflow (about 6 minutes)
1. **Employee (`employee`)**, phone-width browser:
   - Create a claim with three lines: hotel in Mumbai, 3 nights at ₹7,000/night (breach); airfare ₹9,000; dinner ₹1,200 on a Saturday. Upload receipts.
   - Save the draft, then submit.
   - The claim shows ROUTED with reasons (hotel over limit, weekend). Total ₹31,200 → `PENDING_MANAGER`.
2. **Employee**: submit a second claim reusing an already-claimed receipt → `REJECTED` with "Duplicate receipt".
3. **Manager (`manager`)**:
   - The inbox shows the claim with violation badges.
   - Open it: lines on the left, receipt on the right.
   - Approve with a comment → `PENDING_AUDITOR`, because the amount is above 25k.
4. **Auditor (`auditor`)**:
   - In the queue, filter "flagged only".
   - Approve the demo claim → `APPROVED`.
   - Bulk-approve 5 clean seeded claims. The flagged ones are reported as skipped.
   - Show a "sample audit" claim.
5. **Finance Head (`financehead`)**:
   - Payout: create a batch, download the CSV and show it, mark it paid.
   - The demo claim is now `PAID`.
6. **Dashboard** over the 3,000 seeded claims, plus the claim's **audit trail** timeline.
7. *(If built)* The manager sets a delegation, and the delegate approves "on behalf of".

---

## PART 3 — Final Architecture

### Backend
One Spring Boot 3.3 app on Java 17, using Maven. Package by feature under `com.expenseflow`. Inside each feature:
`XController` → `XService` (`@Transactional`, holds the business flow) → `XRepository` (Spring Data JPA).
Two **pure Java classes** with no Spring imports hold the critical rules, and are unit-tested:
- `policy/PolicyEngine`
- `approval/ApprovalRules`

Controllers return **DTO records only**, never entities.

### Frontend
React 18 + Vite, plain JS. `react-router-dom` for routing, Recharts for the dashboard only, plain CSS.
One `src/api/client.js` wraps `fetch`: it adds the Basic auth header, parses JSON, and throws the backend's `detail` message.
`AuthContext` holds the current user and role. Navigation is role-based. The frontend **never re-implements business
rules**: it renders `allowedActions` and `violations` that come from the API.

### Database (PostgreSQL 16, schema from JPA entities)
| Table | Columns (main) |
|---|---|
| `department` | id, name |
| `employee` | id, username (unique), full_name, email, password_hash, role (`EMPLOYEE`/`MANAGER`/`FINANCE_AUDITOR`/`FINANCE_HEAD`), department_id, manager_id, bank_account, ifsc |
| `delegation` | id, delegator_id, delegate_id, start_date, end_date |
| `policy_rule` | id, code (unique), category, limit_amount, description, active |
| `app_config` | key (PK), value |
| `claim` | id, claim_number, employee_id, department_id, title, status, total_amount, approved_amount, current_approver_id, sample_audit, auto_approved, has_violations, submitted_at, decided_at, paid_at, payout_batch_id, version (`@Version`), created_at |
| `claim_line` | id, claim_id, category, expense_date, amount, vendor, city, nights, description, receipt_path, receipt_hash, receipt_content_type, outcome |
| `policy_violation` | id, claim_id, line_id, rule_code, outcome, message |
| `approval_action` | id, claim_id, actor_id, on_behalf_of_id, from_status, to_status, action, comment, created_at |
| `payout_batch` | id, batch_number, created_by, created_at, claim_count, total_amount, status (`EXPORTED`/`PAID`), paid_at |
| `audit_log` | id, actor_id, action, entity_type, entity_id, details, created_at |

### API, authentication and authorization, policy evaluation, approval workflow, receipt handling
Fully specified in the CLAUDE.md files below. They are the single source of truth, and both carry the same API contract table.

### Testing
1. Pure unit tests, written **before** the classes they test: `PolicyEngineTest` (one or more tests per rule, including boundaries) and `ApprovalRulesTest` (thresholds, self-approval, delegation, sample audit routing).
2. SHOULD: `@WebMvcTest` security tests.
3. 10 written E2E cases, run manually against Docker.
4. Frontend: `npm run build` must pass. No frontend unit tests.

### Deployment
`docker-compose.yml` runs three services:
- `db`: postgres:16-alpine, with a healthcheck
- `backend`: multi-stage Maven → JRE 17 image, with a receipts volume
- `frontend`: multi-stage Node build → nginx, serving the SPA and proxying `/api` to the backend

`.env.example` is committed and `.env` is git-ignored. The seeder runs when `APP_SEED_ENABLED=true` and the DB is empty.

### Final folder structure
```
ExpenseFlow_AIManthanTeam26/
├── backend/
│   ├── CLAUDE.md
│   ├── pom.xml  mvnw  .mvn/  Dockerfile
│   └── src/
│       ├── main/java/com/expenseflow/
│       │   ├── ExpenseFlowApplication.java
│       │   ├── config/      SecurityConfig, WebConfig, GlobalExceptionHandler
│       │   ├── common/      CurrentUser, ForbiddenException, NotFoundException, BadRequestException
│       │   ├── user/        Employee, Department, Delegation, Role, *Repository, UserController, DelegationController/Service
│       │   ├── policy/      PolicyEngine (pure), PolicyContext, LineResult, PolicyRule, AppConfig, PolicyService, PolicyRuleController
│       │   ├── claim/       Claim, ClaimLine, ClaimStatus, Category, PolicyViolation, ClaimService, ClaimController, ReceiptStorage, dto/
│       │   ├── approval/    ApprovalRules (pure), ApprovalAction, ApprovalService, ApprovalController
│       │   ├── payout/      PayoutBatch, PayoutService, PayoutController, BankCsvWriter
│       │   ├── dashboard/   DashboardService, DashboardController, PendingMetrics
│       │   ├── audit/       AuditLog, AuditLogRepository, AuditService
│       │   └── seed/        DataSeeder
│       ├── main/resources/application.yml
│       └── test/java/com/expenseflow/
│           ├── policy/PolicyEngineTest.java
│           ├── approval/ApprovalRulesTest.java
│           └── security/ClaimAccessWebTest.java        (SHOULD)
├── frontend/
│   ├── CLAUDE.md
│   ├── package.json  vite.config.js  index.html  Dockerfile  nginx.conf
│   └── src/
│       ├── main.jsx  App.jsx  styles.css
│       ├── api/client.js
│       ├── auth/AuthContext.jsx
│       ├── components/  Layout.jsx  StatusBadge.jsx  Money.jsx  ViolationList.jsx  ReceiptViewer.jsx  HistoryTimeline.jsx
│       └── pages/       LoginPage  MyClaimsPage  ClaimFormPage  ClaimDetailPage  ApprovalsPage  PayoutPage  DashboardPage  PolicyRulesPage(SHOULD)
├── docs/            architecture/  adr/  reviews/  testing/  sre/
├── ops/prometheus/alerts.yml
├── docker-compose.yml
├── .env.example
└── .github/workflows/ci.yml
```

---

## PART 5 — Development Guardrails
These are included verbatim in §1 of both files above. They cover:
- prioritize working functionality
- don't overengineer, add unnecessary libraries or abstractions, or use microservices
- don't duplicate business rules
- no mock data
- don't change contracts without the other side
- run tests after changes
- fix the build first

---

## PART 6 — Final Recommendation

**Final technology and architecture:**
- Backend: one Spring Boot 3.3 / Java 17 modular monolith, package per feature.
- Database: PostgreSQL 16 with the schema from JPA entities.
- Business rules: two pure, unit-tested classes, `PolicyEngine` and `ApprovalRules`. Policy limits and thresholds are database configuration.
- Auth: HTTP Basic + BCrypt.
- Receipts: local volume.
- Frontend: React + Vite (JS) with fetch, router and Recharts.
- Runs with three-service Docker Compose, plus a GitHub Actions CI.

**Build in 3 hours:** the 13 MUST items. Then SHOULD items 1–5 in order. Delegation is first because it is in the spec.

**Deliberately skip:** everything in Part 1 marked ❌, plus the NICE list. Each skip is stated to the judges with its next step.
This is good engineering storytelling, not a gap.

**Biggest risks and mitigations**
1. **Integration at the end.** Run `docker compose up --build` by **1:15**, not at 2:50. Use the Vite proxy so there are no CORS issues.
2. **JPA pitfalls.** Lazy-init errors and JSON recursion: DTOs only and `open-in-view=false`, both written into CLAUDE.md.
3. **Seeder too slow or wrong.** Use a fixed seed and JDBC batch if needed. Seed the org data first (needed at 0:45), and seed 3,000 claims later.
4. **Browser Basic-auth popup.** Use the custom 401 entry point, which is in CLAUDE.md.
5. **Contract drift between the two devs.** One contract table in both files. `allowedActions` is computed by the backend.
6. **Scope creep.** Feature freeze at **2:35**. Polish only after the demo script passes in Docker.
7. **Merge conflicts.** Vertical ownership (below). Shared files (`SecurityConfig`, `App.jsx`, `DataSeeder`) take small additive edits, committed often.

**Recommended implementation order** (Dev A = employee side; Dev B = approver/finance side)

| Time | Dev A | Dev B |
|---|---|---|
| 0:00–0:20 | Spring Boot skeleton, `application.yml`, entities, compose `db` | Vite app, router, `client.js`, `AuthContext`, LoginPage, Layout |
| 0:20–0:50 | **`PolicyEngineTest` first**, then `PolicyEngine` | `SecurityConfig` (Basic), `/api/me`, `DataSeeder` org part (depts, 150 users, demo users, rules, config) |
| 0:50–1:15 | `ClaimService`/Controller: CRUD, lines, receipt upload + hash, submit (`PolicyService`) | **`ApprovalRulesTest` first**, then `ApprovalRules`, `ApprovalService` (approve/reject/send back), `AuditService` |
| **1:15** | **Checkpoint**: curl flow create → submit → manager approve works, and `docker compose up --build` works | same |
| 1:15–1:55 | ClaimFormPage (mobile), MyClaimsPage, ClaimDetailPage + ReceiptViewer + history | ApprovalsPage (filters, bulk approve), approval actions on ClaimDetail (shared page: Dev A owns the layout, Dev B adds the action bar) |
| 1:55–2:20 | DashboardService + DashboardPage; historical 3,000 claims seeder | Payout API + CSV + PayoutPage; delegation API + panel |
| 2:20–2:35 | `@WebMvcTest` security tests; Prometheus gauges | CI workflow, `.env.example`, final Dockerfiles |
| **2:35** | **Feature freeze**. Both run the demo script in Docker and fix defects | same |
| 2:45–3:00 | `docs/testing/e2e-cases.md` (10 cases + results), security checklist | defect log, `ops/prometheus/alerts.yml`, `docs/sre/runbook.md` |

## Verification
- `./mvnw test` is green: PolicyEngine and ApprovalRules tests, plus the web security tests if built.
- `npm run build` passes.
- `docker compose up --build` on a clean clone produces the seeded app at `http://localhost:3000`.
- The 6-step demo workflow in Part 2 passes end-to-end with the demo users, and the results are recorded in `docs/testing/e2e-cases.md`.
- CI is green on push.
