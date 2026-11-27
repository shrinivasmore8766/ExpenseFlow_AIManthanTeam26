# ExpenseFlow — Operations Runbook

How to run, check, back up and troubleshoot ExpenseFlow. Every command in this runbook was run against the local Docker stack on 27 Nov 2026. Commands are for **PowerShell** on Windows and work the same in bash unless a note says otherwise. Run them from the **project root folder**.

---

## 1. Service overview

| Component | Runs as | Port | Data |
|---|---|---|---|
| PostgreSQL 16 | Docker service `db` | 5432 | volume `expenseflow_aimanthanteam26_db-data` |
| Backend (Spring Boot 3.3, Java 17) | Docker service `backend` | 8080 | receipts in volume `expenseflow_aimanthanteam26_receipts`, mounted at `/data/receipts` |
| Frontend (React + Vite) | `npm run dev` in `frontend/` | 5173 | none. It proxies `/api` to `localhost:8080` |

**Request path:** browser → frontend (5173) → `/api/*` → backend (8080) → PostgreSQL (5432).
Authentication is HTTP Basic on every request. The backend is stateless: no sessions or cookies.

On the **first start against an empty database**, the backend seeds 150 users, 8 departments, policy rules and 3,000 claims. On later starts it logs `Seed skipped: employee table is not empty`.

---

## 2. Start, stop, restart

| Task | Command | Data kept? |
|---|---|---|
| Start database and backend | `docker compose up -d` | Yes |
| Start after a code change (rebuild the backend image) | `docker compose up -d --build backend` | Yes |
| Start the frontend | `cd frontend; npm run dev` (first time: `npm install`) | — |
| Follow startup | `docker compose logs -f backend`. Wait for `Started ExpenseFlowApplication` (about 20 s). | — |
| Restart only the backend | `docker compose restart backend` | Yes |
| Stop everything | `Ctrl+C` in the frontend terminal, then `docker compose stop` | Yes |
| Remove containers | `docker compose down` | Yes (volumes stay) |
| **Wipe everything** (fresh demo) | `docker compose down -v`, then `docker compose up -d --build` | **No: deletes the database and all receipts** |

> ⚠️ Never add `-v` to `docker compose down` unless you mean to erase all data. Take a backup first (section 7).

---

## 3. Health checks

| Check | Command | Healthy result |
|---|---|---|
| Containers | `docker compose ps` | `db` is `Up (healthy)`, `backend` is `Up` |
| Backend health | `curl.exe http://localhost:8080/actuator/health` | `{"status":"UP",...}` |
| Liveness / readiness | `curl.exe http://localhost:8080/actuator/health/liveness` (and `/readiness`) | HTTP 200 |
| Authenticated API | `curl.exe -u employee:Demo@123 http://localhost:8080/api/me` | JSON for Rohan Gupta |
| Auth is enforced | `curl.exe -i http://localhost:8080/api/me` | `401` with **no** `WWW-Authenticate` header |
| Frontend | open `http://localhost:5173` | the login page |
| Database | `docker compose exec db pg_isready -U expenseflow -d expenseflow` | `accepting connections` |

---

## 4. Configuration

Settings come from environment variables. Docker Compose reads them from `.env` in the project root (git-ignored). Copy `.env.example` to create it.

| Variable | Default | Purpose |
|---|---|---|
| `DB_URL` | `jdbc:postgresql://localhost:5432/expenseflow` (Compose sets `…//db:5432/…`) | Database connection |
| `DB_USER` / `DB_PASSWORD` | `expenseflow` / `expenseflow` | Database credentials. **Change these outside a demo.** |
| `APP_SEED_ENABLED` | `true` | Seed demo data when the database is empty |
| `APP_DEMO_PASSWORD` | `Demo@123` | Password given to all seeded users |
| `APP_RECEIPTS_DIR` | `./data/receipts` (Compose sets `/data/receipts`) | Where receipt files are stored |

Policy limits and approval thresholds are stored **in the database**, not in config:
- Policy limits are in the `policy_rule` table. The Finance Head can edit them on **Policy rules** in the app.
- Approval thresholds are in the `app_config` table: `AUTO_APPROVE_LIMIT=5000`, `AUDITOR_THRESHOLD=25000`, `FINANCE_HEAD_THRESHOLD=100000`, `SAMPLE_AUDIT_PERCENT=10`.

---

## 5. Logs

| Task | Command |
|---|---|
| Live backend log | `docker compose logs -f backend` |
| Last 200 lines | `docker compose logs --tail 200 backend` |
| Errors only | `docker compose logs backend \| Select-String " ERROR "` (bash: `grep " ERROR "`) |
| Server errors (HTTP 5xx) | `docker compose logs backend \| Select-String -Pattern "-> 5\d\d"` |
| Database log | `docker compose logs --tail 100 db` |

**Format:** every request writes one line, for example:

```
2026-11-27T14:01:02.248Z  INFO [05034825] ... RequestLoggingFilter : GET /api/dashboard -> 200 (84 ms)
```

The value in brackets (`[05034825]`) is the **request id**. Search for it to find every log line from the same request. Business actions are logged at INFO, for example `Claim 3276 submitted by 47: DRAFT -> PENDING_MANAGER`. Passwords, Basic tokens and receipt contents are never logged.

**Known noise:** `ERROR … HHH100501 StaleStateException` appears when two people approve the same claim at the same moment. The user correctly gets HTTP 409 and nothing is wrong. Don't alert on it (defect DEF-05).

---

## 6. Metrics

`http://localhost:8080/actuator/prometheus` (public, Prometheus text format). Useful series:

| Metric | What it tells you |
|---|---|
| `http_server_requests_seconds_count{status="5xx"…}` | Server errors per endpoint. This should stay at 0. |
| `http_server_requests_seconds_sum` / `_count` | Average latency per `uri` |
| `hikaricp_connections_active`, `hikaricp_connections_pending` | Database pool pressure. Pending > 0 for long periods means the pool is saturated (maximum 10). |
| `jvm_memory_used_bytes{area="heap"}`, `process_uptime_seconds` | JVM health; an uptime reset means a restart |

There are **no custom business metrics** yet, such as pending-claim counts. Use the in-app **Dashboard** (pending by status, oldest pending) or the SQL in section 9.

---

## 7. Backup and restore

**Back up** the database and receipts into `.\backup\`. This copies files out of the containers, which avoids PowerShell's binary redirection problem.

```powershell
New-Item -ItemType Directory -Force backup | Out-Null
docker compose exec -T db pg_dump -U expenseflow -d expenseflow -Fc -f /tmp/expenseflow.dump
docker compose cp db:/tmp/expenseflow.dump .\backup\expenseflow.dump
docker compose cp backend:/data/receipts .\backup\receipts
docker compose exec -T db rm /tmp/expenseflow.dump
```

In the tested run, this produced a 686 KB dump (3,180 claims) and 155 receipt files.

**Restore.** This replaces the current data. Stop the backend first, so nothing writes during the restore.

```powershell
docker compose stop backend
docker compose cp .\backup\expenseflow.dump db:/tmp/restore.dump
docker compose exec -T db pg_restore -U expenseflow -d expenseflow --clean --if-exists --no-owner /tmp/restore.dump
docker compose cp .\backup\receipts\. backend:/data/receipts
docker compose start backend
```

> Restoring into a scratch database (`createdb … expenseflow_restore_test`, then `pg_restore`, then `dropdb`) was tested and gave exactly the live claim count. Test a backup that way before relying on it.

---

## 8. Routine operations

| Task | How |
|---|---|
| Reset to fresh demo data | Back up, then `docker compose down -v` and `docker compose up -d --build`. The seed runs automatically. |
| Payout cycle | Finance Head → **Payouts** → Create payout batch → **CSV** → after the bank confirms, **Mark paid**. Check for batches still waiting with the query "exported batches not yet paid" (section 9). |
| Manager on leave | The manager uses **Approvals → Delegation while on leave**. Check active delegations with the SQL in section 9. |
| Change a policy limit | Finance Head → **Policy rules** → Edit. It applies to claims submitted afterwards and is written to the audit log. |
| Run the test suites | Backend: `cd backend; docker run --rm -v "${PWD}:/app" -v expenseflow-m2:/root/.m2 -w /app maven:3.9-eclipse-temurin-17 mvn -B test`. API (stack must be running): `cd qa/api-tests; node --test --test-concurrency=1 01-auth-security.test.mjs 02-claims-policy.test.mjs 03-approvals-delegation.test.mjs 04-payout-dashboard.test.mjs 99-cleanup.test.mjs` |

---

## 9. Diagnostic SQL

Open a SQL prompt with `docker compose exec db psql -U expenseflow -d expenseflow`. These queries are read-only.

```sql
-- Pending claims per level and the oldest one (hours)
SELECT status, count(*), round(extract(epoch FROM now() - min(submitted_at))/3600) AS oldest_hours
FROM claim WHERE status LIKE 'PENDING_%' GROUP BY status ORDER BY 1;

-- Claims stuck at Finance Head level (defect DEF-02)
SELECT c.claim_number, c.approved_amount FROM claim c JOIN employee fh ON fh.role = 'FINANCE_HEAD'
WHERE c.status = 'PENDING_FINANCE_HEAD'
  AND (c.employee_id = fh.id OR EXISTS (SELECT 1 FROM approval_action a
       WHERE a.claim_id = c.id AND a.actor_id = fh.id AND a.action = 'APPROVE'));

-- Payout batches exported but not yet marked paid
SELECT batch_number, claim_count, total_amount, created_at FROM payout_batch WHERE status = 'EXPORTED';

-- Delegations active today
SELECT d.id, a.username AS delegator, b.username AS delegate, d.start_date, d.end_date
FROM delegation d JOIN employee a ON a.id = d.delegator_id JOIN employee b ON b.id = d.delegate_id
WHERE current_date BETWEEN d.start_date AND d.end_date;

-- Latest audit entries
SELECT created_at, action, entity_type, entity_id FROM audit_log ORDER BY id DESC LIMIT 20;
```

`audit_log` is append-only: a database trigger rejects every UPDATE and DELETE. Don't try to edit it.

---

## 10. Incident playbooks

| Symptom | Likely cause | What to do |
|---|---|---|
| UI shows "Cannot reach the server" | The backend is down or still starting | `docker compose ps`, then `docker compose logs --tail 100 backend`. Start it with `docker compose up -d` and wait about 20 s for the health check to show UP. |
| Backend exits at start, log shows `Connection refused` / `Connection to db:5432` | The database isn't ready or isn't running | `docker compose up -d db`, wait for `healthy`, then `docker compose restart backend`. Check that `DB_USER`/`DB_PASSWORD` in `.env` match the volume's original values. |
| Every login fails (401) | Wrong password, or `APP_DEMO_PASSWORD` changed after seeding | Seeded passwords are fixed at seed time. Use the original password, or reset the demo data (section 8). |
| A user gets 403 "You do not have permission" | Expected: wrong role for that page or action | Check the user's role in the app's top bar. Payouts and policy edits are Finance Head only. Bulk approve is for Auditors and the Finance Head. |
| An approver gets 409 "changed by someone else" | Two people acted on the same claim | Expected behaviour. Reload the claim. Only one action is kept. |
| A claim waits forever at **Pending · Finance Head** | **DEF-02:** the Finance Head was its manager-level approver, or it is the FH's own claim, and it is above ₹1,00,000. Nobody is allowed to act. | Find it with the DEF-02 query in section 9. There is no in-app fix yet. Escalate to the product owner for a decision. Don't edit the database without approval: any manual change bypasses the audit trail. |
| Receipt panel shows an error on old claims | Seeded historical claims store only a receipt hash, with no file | Expected for seeded data. New uploads display normally. |
| Receipt upload rejected | Not a real PDF/JPEG/PNG (checked by content), or over 5 MB | Ask the user to upload a PDF, JPG or PNG under 5 MB. |
| Payout batch created but claims still Approved | The batch hasn't been marked paid yet | Download the CSV and send it to the bank. After confirmation, click **Mark paid**. |
| `npm install` fails with EPERM / `'vite' is not recognized` | Another dev server is locking files, or packages are missing | Stop the other `npm run dev`, then run `npm install` in `frontend/`. |
| Port 5173, 8080 or 5432 already in use | Another process is using it | `Get-NetTCPConnection -LocalPort 8080 -State Listen` to find the owning process, then stop it. Or change the port mapping in `docker-compose.yml`. |
| Slow responses | Database pool saturated, or a slow query | Check `hikaricp_connections_pending` and request durations in the log (`-> 200 (NNN ms)`). |

---

## 11. Known issues

| ID | Severity | Summary | Operational impact |
|---|---|---|---|
| DEF-02 | High | Claims above ₹1,00,000 whose manager-level approver is the Finance Head can never complete | Watch with the DEF-02 query; needs a business decision |
| DEF-03 | Low | The API accepts future expense dates (the UI blocks them) | None for UI users |
| DEF-04 | Medium | No lockout after repeated failed logins | Watch for repeated `-> 401` lines for one user in the log |
| DEF-05 | Low | Handled 409 conflicts logged at ERROR | Don't alert on `HHH100501` |

Details are in `docs/testing/04-defect-log.md`. Security notes: `/actuator/prometheus` is public and the demo passwords are committed as defaults. Restrict and change both before any non-demo use. Serve over HTTPS, because HTTP Basic sends the password on every request.
