# ADR 0004 — JWT authentication, role and resource-based authorization

**Status:** Accepted, **amended for the 3-hour build** · **Date:** 2026-11-27

> **Amendment (3-hour scope):** authentication is **HTTP Basic** (stateless, BCrypt, user reloaded per request,
> custom 401 entry point) instead of JWT.
> - **Why:** it needs zero extra dependencies and no custom filter, and it is trivial in MockMvc and curl.
> - **Accepted downside:** credentials are sent on every request (HTTPS in real deployments) and there is no server-side logout.
> - JWT is the documented next step.
>
> The role and resource-based authorization decision is unchanged.
> See [04-final-3h-architecture.md](../architecture/04-final-3h-architecture.md).

## Context
- Employees may only see their own claims.
- Approvers may act only on claims assigned to them or delegated to them, and never on their own claim.
- The API must be easy to exercise from automated tests.

## Decision
- **Authentication**:
  - Spring Security with a short-lived JWT (60 min, HS256).
  - The signing secret comes from the `JWT_SECRET` env var, and startup fails if it is missing or shorter than 32 bytes.
  - Passwords use BCrypt, and login is rate-limited.
  - The SPA keeps the token in memory and `sessionStorage`, never in `localStorage` or cookies.
- **Authorization** works in two layers:
  1. Role checks with `@PreAuthorize`: EMPLOYEE, MANAGER, FINANCE_AUDITOR, FINANCE_HEAD. Roles are additive.
  2. Resource checks in a central `ClaimAccessPolicy`: ownership, `canAct`, not the claimant, and allowed status.
     List queries are scoped in SQL. A wrong object returns 404, not 403.
- Request DTOs never carry server-owned fields such as status, payable amount, employee or outcome, which prevents mass assignment.

## Alternatives considered
- **Server sessions**: equally valid, but need CSRF handling and are less convenient for API testing.
- **Keycloak/OIDC**: realistic, but needs an extra container and setup time.
- **Pure RBAC**: any manager could approve any claim. Rejected.
- **Spring ACL / OPA**: too heavy for this scale.

## Consequences
- A token can't be revoked before it expires. This is mitigated by the 60-minute expiry, and it is documented.
- Every new endpoint needs a resource check. A CI authorization matrix test (role × endpoint × own/other/assigned claim) catches omissions.
