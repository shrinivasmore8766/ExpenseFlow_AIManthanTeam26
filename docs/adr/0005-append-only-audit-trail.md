# ADR 0005 — Append-only business audit trail

**Status:** Accepted · **Date:** 2026-11-27

## Context
The spec requires an append-only audit trail of every action. Auditors need to see intent, such as
"approved on behalf of", "bulk approved" or "exported batch", not just changed columns.

## Decision
- `AuditService.record(...)` writes an `audit_log` row in the **same transaction** as the business change,
  using `Propagation.MANDATORY`. Audit is never asynchronous.
- Each row holds: actor, on-behalf-of, action, entity, before and after state (JSONB), IP and timestamp.
- The row is written from inside the state machine transitions and every admin, payout and config action.
- Append-only is enforced in the database:
  - a trigger raises on UPDATE and DELETE
  - the application DB role is granted INSERT and SELECT only
- Tamper evidence (stretch goal): a hash chain where `hash = sha256(prev_hash || canonical row)`, plus a `/audit-log/verify` endpoint.
- `approval_step` remains the domain record of approvals. The audit log is the compliance record.

## Alternatives considered
- **Hibernate Envers**: records data changes but not business intent, exports or logins.
- **Pure DB triggers**: don't know the application user.
- **Event sourcing**: too complex for the timeline.

## Consequences
- Developers must call audit for non-transition actions. Code review and a test that checks "every controller mutation writes audit" cover this.
- Audit rows grow without bound. That is fine at this scale, and partitioning by month is the future path.
