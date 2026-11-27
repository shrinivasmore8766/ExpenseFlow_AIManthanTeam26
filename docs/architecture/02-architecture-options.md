# ExpenseFlow — Architecture Options & Trade-offs (Step 2)

## Context
Hackathon (AI Manthan, Track A). Two devs, Java 17 / Spring Boot / PostgreSQL / React, backend-first.
Repo is empty. Step 1 (requirements analysis, appendix below) is done. This step compares architecture
options per area and proposes a combination. **Nothing is final until the team approves**; the next step
after approval is the detailed architecture (C4 diagrams, ERD, ADRs, state machine spec).

Scale reality check: 150 users, ~3,000 historical claims, a few hundred new claims/month. Any option
whose main benefit is horizontal scale is solving a problem we do not have. The judges reward
*justified* decisions, so each choice below is also an ADR candidate.

Time impact legend: **+0** baseline · **+S** ≈ half a day · **+M** ≈ 1–2 days · **+L** ≥ 3 days (for 2 devs).

---

## A1. Backend Architecture

### Monolith vs modular monolith vs microservices
| | Layered monolith (global `controller/service/repo` packages) | **Modular monolith** (package per business module, one deployable, one DB) | Microservices (claims, policy, approval, payout, reporting) |
|---|---|---|---|
| Pros | Fastest start; every Spring tutorial looks like this | ACID transactions across approve + audit + payout; one deploy; clear ownership per dev; modules can be extracted later | Independent deploy/scale; tech isolation; looks "enterprise" |
| Cons | Becomes a tangle as features grow; two devs collide in the same packages | Needs discipline so modules don't reach into each other's tables/repos | Distributed transactions (approve claim ↔ write audit ↔ add to batch), service discovery, N databases, N pipelines, network auth between services |
| Complexity | Low | Low–medium | High |
| Failure scenarios | Hidden coupling → change in claims breaks payout | Module boundaries erode under deadline pressure | Approval committed but audit event lost; payout service down mid-batch → partially paid batch; cascading timeouts |
| Scale / maintainability | Vertical only; maintainability degrades | Vertical scale is plenty here; good maintainability; extraction path exists | Best scale, worst for a 2-person team to operate |
| Hackathon time | +0 | +0 to +S | **+L** (and risk of not finishing end-to-end) |

### Layered vs clean/hexagonal
| | Classic layered (Controller → Service → Repository, JPA entities used as domain) | Clean / hexagonal (framework-free domain, ports & adapters) | **Hybrid: layered modules + pure-Java core for policy engine & state machine** |
|---|---|---|---|
| Pros | Spring-idiomatic, minimal mapping code | Domain fully testable without Spring/DB; swaps infrastructure easily | Pure, fast unit tests exactly where business risk lives; rest stays simple |
| Cons | Business rules leak into services/controllers; harder to unit-test without mocks | ~2× classes (domain model ↔ JPA entity ↔ DTO mappers), slower to build | Two styles in one codebase (needs a one-line rule in CLAUDE.md) |
| Failure | Rule duplicated in two services → inconsistent decisions | Mapping bugs; team spends time on plumbing | Someone puts DB calls inside the "pure" engine |
| Hackathon time | +0 | +M | +S |

### DDD vs simple module-based design
| | Full DDD (bounded contexts, aggregates, domain events, ubiquitous language, repositories per aggregate) | Simple module-based (anemic entities, logic in services) | **"DDD-lite"**: Claim is an aggregate (lines only change through Claim), `Money` value object, domain events for audit, no further ceremony |
|---|---|---|---|
| Pros | Invariants enforced in one place; great story for judges | Fastest | Gets the key invariant protection (no edits after submit, totals consistent) cheaply |
| Cons | Lots of ceremony; easy to over-model | Invariants scattered → bypass bugs (e.g. editing lines of a submitted claim via line endpoint) | Requires agreeing on aggregate boundaries up front |
| Hackathon time | +M to +L | +0 | +S |

---

## A2. Policy Engine

### Approaches
| | Hard-coded rules (`if amount > 1500`) | **DB-driven parameterized rules** (rule *types* in Java, *parameters* in DB) | Expression rules in DB (SpEL / MVEL / JEXL strings) | Existing engine (Drools, Easy Rules, DMN/Camunda) |
|---|---|---|---|---|
| Pros | Fastest; trivially readable | Meets "config, not hard-coded"; limits/actions editable at runtime; strongly typed; easy TDD; explainable results | New rules without deploy; very flexible | Mature, decision tables, business-editable (DMN), rete performance |
| Cons | **Violates the spec** | New rule *type* (e.g. "airfare limit by distance") still needs code | Expression injection risk (SpEL injection = RCE), hard to test/validate, opaque errors | Learning curve, heavy dependencies, DRL/DMN tooling; massive overkill for 8 rules |
| Complexity | Very low | Low–medium | Medium + security hardening | High |
| Failures | Limit change requires redeploy | Bad config (negative or missing limit) → validate on save; stale cache after edit | Admin types expression that crashes or allows everything; sandbox escape | Rule-firing order surprises; debugging inside engine; startup/memory cost |
| Scale/maint. | Poor | Good — add a type = one class + tests | Unbounded, hard to reason about | Good at large rule counts we don't have |
| Hackathon time | +0 (but fails requirement) | +S | +M | +M to +L |

### How policies should be evaluated (applies to any approach)
1. **When**: synchronously on *submit* (authoritative) and on a *dry-run preview* while drafting (shows warnings live, improves UX, same code path).
2. **Shape**: a pure function `evaluate(claim, historyLookup, policySet) → results`. History lookup (prior lines, receipt hashes, same-day meal totals) is loaded first and passed in, so the engine never touches the DB → deterministic unit tests.
3. **Order**: line rules (cab limit, receipt required, weekend) → aggregate rules (daily meal total across lines + other claims) → cross-claim rules (duplicates).
4. **Combine**: per line, most severe wins: `REJECT > ROUTE > FLAG > PASS`; per claim, as defined in requirements A1/A2.
5. **Explainability**: every result stored with rule code, message, and policy version → approvers see *why*, auditors can reproduce.

### Changing policies without code
- Admin edits a rule → **new version row** inserted, old one deactivated (never update in place) → history preserved, audit logged.
- `effective_from` date; submitted claims keep the version they were evaluated against (no retroactive changes).
- Validation on save (typed param records per rule type); in-memory cache evicted on change.
- Limitation to state honestly to judges: limits/actions/thresholds/categories/city tiers are config; *new kinds of logic* are code + tests by design (safer than expression strings).

---

## A3. Approval Workflow

### Workflow model
| | Condition-based (status checks scattered in services) | **Explicit state machine** (enum states + transition table, one guarded `transition()` method) | Spring Statemachine library | BPMN engine (Camunda / Flowable) |
|---|---|---|---|---|
| Pros | Quickest first feature | Illegal transitions impossible; whole lifecycle readable in one file; trivial to test every edge; diagram maps 1:1 to code | Hierarchical states, guards, actions out of the box | Visual model, timers, escalation, delegation, task inbox built in |
| Cons | Every new action re-implements checks → **bypass bugs** (approve a REJECTED claim, approve twice) | Hand-written timers/escalation | Persistence/rehydration is awkward; heavy for ~10 states; learning curve | Own tables & runtime, BPMN learning curve, long setup; hides logic from tests |
| Failures | Inconsistent states in DB | Forgetting to route a new action through `transition()` (mitigate: entity setter private) | Machine state and DB state diverge | Engine/DB version issues; debugging opaque |
| Hackathon time | +0 initially, costly later | +S | +M | +L |

### How the approval chain is modelled
| | **Pre-computed steps at submit** (insert `approval_step` rows for each required level with assigned approver; pointer to current step) | Dynamic next-approver after each approval |
|---|---|---|
| Pros | Full chain visible to employee & approver upfront; "my inbox" = simple query; approval history is just these rows; easy metrics (age per level) | Always reflects latest hierarchy |
| Cons | Hierarchy change mid-flight needs re-resolution | Can't show the chain upfront; harder metrics; logic re-run each step |
| Failure | Approver leaves company → stuck step (admin reassign + alert on age) | Reporting-line edit can silently skip a level (bypass B7) |

### Synchronous vs asynchronous
| | **Synchronous in one DB transaction** (transition + approval step + audit row together) | Async via Spring events after commit | Message broker (Kafka / RabbitMQ) |
|---|---|---|---|
| Use for | State changes, policy evaluation, audit writes | Notifications (mock email), metric refresh | — |
| Pros | Consistency: no approved claim without an audit row; simple debugging | Slow side effects don't block user | Durable, scalable, decoupled |
| Cons | Request latency includes everything (fine: < 50 ms work) | Event lost if app crashes after commit (acceptable for notifications only) | Extra infra container, retries, idempotency, dead-letter handling |
| Hackathon time | +0 | +S | +M to +L |

Rule: **audit is never async** — losing an audit row is a compliance failure.
Scheduled jobs (`@Scheduled`): delegation expiry, oldest-pending metric, optional SLA escalation.

### Delegation, clarification, multi-level
- **Delegation** options: (a) reassign pending steps when delegation is created — simple, but breaks when leave ends early and misses claims arriving later; (b) **resolve at action time** — step stays assigned to the original approver, anyone with an active delegation from them may act and is recorded as "X on behalf of Y". (b) recommended; inbox query = assigned to me OR to someone who delegated to me now.
- **Clarification** options: (a) resume at the same level after resubmit — faster for approvers, but employee can raise amounts after the manager approved (bypass); (b) **cancel open steps (kept as history), re-run policy, regenerate chain from level 1** — recommended; safe and simple.
- **Multi-level**: sequential (manager → auditor → head), as spec implies; parallel approvals not needed. Each level gate decided from the *payable* amount at submit time.

---

## A4. Database Design

### Normalization
| | Strict 3NF (derive everything with joins) | **Normalized core + selective denormalization** | Separate reporting store (star schema / read replica / materialized views) |
|---|---|---|---|
| Denormalized fields | none | `claim.total_amount`, `claim.payable_amount`, `claim.department_id` (snapshot at submit), `claim.current_approver_id`, `claim_line.vendor_normalized`, `claim_line.employee_id` (for duplicate / daily-meal queries) | aggregates pre-computed |
| Pros | No drift possible | Fast inbox & duplicate queries; historically correct reporting (department at time of claim) | Very fast dashboards |
| Cons | Department moves rewrite history in reports; heavier queries | Totals can drift if updated outside the aggregate (mitigate: only Claim recomputes; DB CHECK constraints) | Refresh lag & extra moving parts |
| Hackathon time | +0 | +0 | +S (materialized views) to +M |

At 3,000 claims, plain `GROUP BY` queries with indexes are fast; materialized views are an optional stretch.

### Audit history and approval history
| | **Explicit business audit log** (service writes `audit_log` row per action, before/after JSONB, actor, on-behalf-of, IP) | Hibernate Envers (automatic `_AUD` tables per entity) | DB triggers capturing row changes | Event sourcing (events are the source of truth) |
|---|---|---|---|---|
| Pros | Captures *intent* ("approved on behalf of", "bulk approved", "exported batch"); one table to query; works for non-entity actions (CSV export, login) | Zero effort, captures every column change | Can't be bypassed by app code | Perfect history, replay |
| Cons | Developer must call it (mitigate: write inside `transition()` + AOP for others) | Captures data changes, not business actions or reads/exports; many tables | Doesn't know the app user (needs session vars); logic hidden in SQL | Huge complexity, projections, rebuilds |
| Hackathon time | +S | +S | +S | +L |

**Approval history is domain data, not audit data**: `approval_step` rows are read by the UI (timeline), the inbox, and SRE metrics. Keep both: `approval_step` (domain) + `audit_log` (compliance).
**Append-only enforcement** options: app convention only (weak) → DB trigger rejecting UPDATE/DELETE + app DB user with INSERT/SELECT only (recommended) → plus hash chain `hash = sha256(prev_hash + row)` for tamper evidence (stretch, demos well).

### JSONB for configurable policies
| | All typed columns (`limit_amount`, `tier`, …) | **Hybrid: typed common columns + `params JSONB`** | Everything as one JSON document |
|---|---|---|---|
| Pros | DB-enforced types | Each rule type has its own parameter shape without migrations; common fields (code, category, action, active, version) still queryable/indexable | Ultimate flexibility |
| Cons | Sparse nullable columns or a migration per new rule type | JSON not validated by DB (validate with a Java record per rule type on save) | No integrity, hard to version per rule |
| Failure | — | Malformed params reach engine (mitigate: validate on save + on load, fail closed = ROUTE) | Whole policy breaks from one typo |

Reference data with real relationships (categories, city tiers, departments) stays in normal tables, not JSON.
Migrations: **Flyway** (SQL-first, simple) vs Liquibase (XML/YAML, rollback) vs `ddl-auto=update` (never for anything shown to judges).

---

## A5. Authentication & Authorization

### Authentication
| | Server session (Spring Security, HttpOnly cookie) | **JWT bearer token** (short-lived, stateless) | OAuth2/OIDC with Keycloak |
|---|---|---|---|
| Pros | Real logout/revocation; cookie not readable by JS; least custom code in Spring | Stateless (any replica can serve); easy for Postman/RestAssured/E2E; easy demo role-switching; common SPA pattern | Realistic enterprise SSO, MFA, user mgmt for free |
| Cons | Needs CSRF protection for SPA; sticky sessions or Redis if scaled | Revocation hard (mitigate: short expiry); token storage XSS risk if in localStorage; signing-key management | Extra container, realm config, token mapping — slow to set up |
| Failures | CSRF misconfig blocks POSTs or leaves a hole | Leaked/long-lived token valid until expiry; weak/committed signing secret | Keycloak misconfig = nobody logs in during demo |
| Hackathon time | +S | +S | +M |

Both session and JWT are defensible; JWT is chosen mainly for testability and stateless Compose scaling, with expiry ~1h, secret from env, token kept in memory (not localStorage).

### Authorization
| | Pure RBAC (`@PreAuthorize("hasRole('MANAGER')")`) | **RBAC + resource-based checks** (role gate + "is this my claim / am I the assigned approver or their active delegate / not my own claim") | Spring ACL / ABAC engine (OPA) |
|---|---|---|---|
| Pros | Simple | Closes IDOR and self-approval bypasses (B5, B15); checks centralized in one `ClaimAccessPolicy` | Fine-grained, externalized |
| Cons | **Any manager can approve any claim; any employee can read any claim by ID** — fails requirement 7 | Must be applied on every endpoint (mitigate: authorization test matrix in CI) | ACL tables per object, or another service to run |
| Hackathon time | +0 (but insecure) | +S | +M to +L |

Also: list endpoints *scope the query* (`WHERE employee_id = :me`) rather than filtering after fetch.

---

## A6. File & Receipt Management

### Storage
| | **Local filesystem behind a `ReceiptStorage` interface** (Docker volume) | Object storage (MinIO locally / S3 in cloud) | DB `bytea` |
|---|---|---|---|
| Pros | Zero infra; fast to build; interface makes S3 swap a one-class change | Scales across instances; presigned URLs; lifecycle/retention | Transactional with the claim; one backup |
| Cons | Not shared across replicas; manual backups | One more container + SDK + bucket setup | DB bloat; slower backups; memory pressure streaming large files |
| Failures | Volume lost on `docker compose down -v`; path traversal if filenames trusted | Bucket misconfigured public; credentials leakage | Large uploads hurt DB performance |
| Hackathon time | +0 | +S | +0 |

Common rules regardless: random storage keys (never user filename), type check by magic bytes (PDF/JPG/PNG), size limit, download only through an authorized endpoint.

### Hashing & duplicate detection
- **SHA-256 computed server-side while streaming the upload** (never trust a client hash); stored and indexed.
- Check twice: at upload (instant "this receipt was already used" warning in UI) and at submit inside the transaction (authoritative; avoids race between two concurrent submits).
- Scope company-wide; compare against all prior non-draft lines incl. rejected; same receipt on two lines of the same claim also counts.
- Limits to be honest about: exact hash only catches byte-identical files. A re-photographed receipt has a new hash → covered partly by vendor+amount+date rule with normalized vendor and a "near duplicate" flag (amount ±1%, date ±1 day). Perceptual image hashing / OCR = stretch / future work.
- Seed data: generate small synthetic receipt files so planted duplicates share real hashes.

---

## A7. Frontend Integration

### Communication style
| | **REST + JSON** | GraphQL | gRPC(-web) | WebSocket / SSE |
|---|---|---|---|---|
| Pros | Universally understood; Spring-native; easy caching, testing, OpenAPI | Flexible dashboard queries, fewer round trips | Typed, fast | Live inbox updates |
| Cons | Several calls for dashboard (fine) | Field-level authorization is harder (IDOR risk per resolver), N+1, new tooling | Needs proxy for browsers; overkill | Connection handling, auth on socket |
| Hackathon time | +0 | +M | +M | +S (stretch; polling is fine) |

### Keeping contracts in sync
| | **Code-first OpenAPI** (springdoc generates spec from controllers → generate TS types/client with openapi-typescript/orval) | Contract-first (hand-write `openapi.yaml`, generate server interfaces + client) | Hand-written TS types |
|---|---|---|---|
| Pros | Fits backend-first exactly; spec always matches running code; Swagger UI for judges | Best for parallel FE/BE dev; review the API before coding | No tooling |
| Cons | FE waits for backend endpoints to exist | Generator quirks; slower start | Silent drift → runtime bugs at demo time |
| Hackathon time | +S (one-time setup) | +M | +0 now, costly later |

Conventions: `/api/v1`, RFC 7807 `ProblemDetail` errors, consistent pagination/sorting params, DTOs separate from entities. CI step fails if generated TS types are out of date.

---

## A8. Testing & Deployment

### Testing levels
| Level | Tooling options | What it covers here | Time |
|---|---|---|---|
| Unit | JUnit 5 + AssertJ, parameterized tests | **Every policy rule** (boundary: 1,500 vs 1,500.01, 500 receipt edge, weekend), state-machine transitions, threshold routing (25,000 / 25,000.01 / 1,00,000.01), delegation rules | +S, written *before* engine (spec asks) |
| Integration | **Testcontainers PostgreSQL** vs H2 | Repositories, JSONB, audit trigger, duplicate queries, transaction rollback | Testcontainers +S; H2 is faster but lacks JSONB/trigger parity → false confidence |
| API / security | MockMvc or RestAssured | Authorization matrix (each role × each endpoint × own/other claim), IDOR, self-approval | +S |
| End-to-end | **Playwright** vs Cypress vs Selenium; or API-level E2E | 10 written journeys (submit → approve chain → payout → Paid, send-back, delegation, auto-reject, sample audit…) | Playwright +M; API-level E2E +S as fallback |

Failure scenarios to plan for: flaky UI E2E tests in CI (keep UI E2E small, rest at API level); Testcontainers needs Docker on CI runner (GitHub-hosted Ubuntu has it).

### Deployment
| | **Docker Compose** (postgres, backend, frontend/nginx, prometheus, grafana; `docker compose up` seeds demo) | Kubernetes / Helm | PaaS (Render, Railway, Fly) | Run jar + npm locally |
|---|---|---|---|---|
| Pros | Meets "one command" requirement; same everywhere; judges can run it | Production-grade, scaling, health probes | Public demo URL | Zero setup |
| Cons | Single host | Big learning/time cost | Accounts, secrets in cloud, cold starts, free-tier limits | Not reproducible; fails requirement |
| Time | +S | +L | +S to +M (optional extra) | +0 |

### CI/CD & dependency checks
| Option | Notes |
|---|---|
| **GitHub Actions** (vs Jenkins/GitLab CI) | Repo is already on GitHub; free runners; Claude can author workflow |
| Dependency check | OWASP dependency-check Maven plugin (thorough, slow first run, needs NVD API key + cache) vs **Dependabot + `dependency-review-action` + `npm audit`** (fast, zero infra); Trivy image scan as extra |
| Secret scanning | gitleaks step + GitHub secret scanning ("team confirms secrets are not committed") |
| CD | Build & push images to GHCR on main — optional |

### Monitoring
| | **Actuator + Micrometer + Prometheus + Grafana** (in Compose) | Logs only | ELK / OpenTelemetry stack | Cloud APM (Datadog, New Relic) |
|---|---|---|---|---|
| Pros | Native to Spring; custom gauges (queue size per level, oldest pending age), HTTP latency histograms for free; Prometheus/Grafana alert rules | Nothing to set up | Traces + logs + metrics | Polished |
| Cons | Two extra containers; dashboard JSON to build | Can't show dashboard/alert (spec requires) | Heavy | Accounts, cost, external data |
| Time | +S | +0 (fails SRE phase) | +M to +L | +S, but external |

---

## A9. Summary Comparison & Recommended Combination

| Area | Options considered | **Recommended** | Why (one line) | Time |
|---|---|---|---|---|
| Deployment unit | Layered monolith · Modular monolith · Microservices | **Modular monolith** | ACID across approve/audit/payout; 2 devs own separate modules | +0 |
| Code structure | Layered · Clean/hexagonal · Hybrid | **Layered modules + pure-Java policy engine & state machine** | Purity where business risk is; Spring simplicity elsewhere | +S |
| Domain modelling | Full DDD · Anemic modules · DDD-lite | **DDD-lite** (Claim aggregate, Money, domain events) | Protects "immutable after submit" invariants cheaply | +S |
| Policy engine | Hard-coded · DB-param rules · Expressions · Drools/DMN | **DB-driven parameterized rule types, versioned** | Meets spec, typed, safe, testable | +S |
| Workflow | Conditions · Hand-rolled state machine · Spring SM · BPMN | **Hand-rolled explicit state machine** | Bypass-proof transitions, diagram = code | +S |
| Chain model | Pre-computed · Dynamic | **Pre-computed `approval_step` rows, delegate resolved at action time** | Visible chain, easy inbox & metrics | — |
| Processing | Sync · Async events · Broker | **Sync transaction + after-commit events for notifications** | Consistency; no broker to run | +0 |
| Clarification | Resume same level · Restart | **Restart chain + re-run policy** | Closes amount-raise bypass | — |
| DB shape | 3NF · Selective denorm · Reporting store | **Normalized + selective denormalization** | Fast queries, historically correct reports | +0 |
| History | Business audit log · Envers · Triggers · Event sourcing | **Business `audit_log` (append-only via trigger) + `approval_step` domain table** | Captures intent; tamper-resistant | +S |
| Policy storage | Typed cols · Hybrid JSONB · Pure JSON | **Hybrid typed + `params JSONB`** | Flexible params, validated in Java | +0 |
| Migrations | Flyway · Liquibase · ddl-auto | **Flyway** | SQL-first, simple | +0 |
| AuthN | Session · JWT · Keycloak | **JWT (short-lived, secret from env)** | Testable, stateless; session equally valid if preferred | +S |
| AuthZ | RBAC · RBAC+resource · ACL/OPA | **RBAC + resource checks in a central access policy** | Required for "own claims only" & no self-approval | +S |
| Receipts | Local FS · MinIO/S3 · bytea | **Local volume behind `ReceiptStorage` interface** (MinIO stretch) | Zero infra, swap path shown | +0 |
| Duplicates | — | **Server-side SHA-256 + normalized vendor/amount/date, checked at upload and submit** | Fast warning + authoritative check | +S |
| API style | REST · GraphQL · gRPC · WS | **REST + JSON** | Simplest, best tooling | +0 |
| Contracts | Code-first · Contract-first · Manual | **Code-first OpenAPI → generated TS types** | Fits backend-first, no drift | +S |
| Tests | Unit · Integration · E2E | **Unit (rules, TDD) + Testcontainers integration + authz matrix + 10 E2E (Playwright core, API-level rest)** | Covers spec's testing phase realistically | +M |
| Deploy | Compose · K8s · PaaS · local | **Docker Compose** (PaaS optional) | One-command seeded demo | +S |
| CI | GH Actions · Jenkins | **GitHub Actions + dependency-review/npm audit (+OWASP DC if time) + gitleaks** | Fast, free, Claude-authored | +S |
| Monitoring | Prometheus/Grafana · logs · ELK · APM | **Actuator + Micrometer + Prometheus + Grafana + alert on oldest pending approval** | Spring-native, satisfies SRE phase | +S |

**Things we deliberately reject (and say so in ADRs — judges like this):** microservices, Drools/BPMN engines, event sourcing, GraphQL, Kubernetes, Keycloak. Each is a good tool for a different scale/team; here they cost days without adding demo value.

**Key risks with the recommended combination**
1. Module boundaries erode → add a simple ArchUnit test (or Spring Modulith verify) as a guardrail.
2. Missed authorization check on one endpoint → authorization test matrix runs in CI.
3. Policy config typo → validated on save, engine fails closed (ROUTE, never auto-approve).
4. Demo-day Compose failure → health checks + seed idempotency + rehearsed `docker compose up` from a clean clone.

## Next step (after team approval)
Detailed architecture design: C4 context & container diagrams, module map with owners (Dev A / Dev B), ERD, state machine spec, policy config schema, ADRs (approval-chain modelling, policy-as-config, auth choice), and the skeptical-auditor design review.

---
