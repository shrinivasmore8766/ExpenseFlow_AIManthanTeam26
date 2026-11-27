# Architecture Decision Records

| # | Decision | Status |
|---|---|---|
| [0001](0001-modular-monolith.md) | Modular monolith with pure-Java core | Accepted |
| [0002](0002-policy-as-configuration.md) | Policy as configuration: rule types in code, parameters in DB | Accepted |
| [0003](0003-approval-chain-modelling.md) | Approval chain: explicit state machine (status-driven in the 3 h build) | Accepted, amended |
| [0004](0004-authentication-and-authorization.md) | Authentication (HTTP Basic in the 3 h build; JWT next) + role and resource-based authorization | Accepted, amended |
| [0005](0005-append-only-audit-trail.md) | Business audit log, append-only at DB level | Accepted |

Format: Context → Decision → Alternatives considered → Consequences.
Full option analysis: [../architecture/02-architecture-options.md](../architecture/02-architecture-options.md).
