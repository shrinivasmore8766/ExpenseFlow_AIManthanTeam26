# ADR 0002 — Policy as configuration

**Status:** Accepted · **Date:** 2026-11-27

## Context
The spec requires policy rules to be "seeded as configuration, not hard-coded". There are currently 8–10 rules.
Every decision must be explainable and reproducible for auditors.

## Decision
- Each *kind* of check is a Java `RuleEvaluator` per `rule_type`, for example `PER_TXN_LIMIT` or `CATEGORY_DAILY_LIMIT`.
- Each concrete rule is a `policy_rule` row. The row holds typed common columns (code, category, action, active, version) and a `params JSONB` column.
- Params are validated against a Java record for each rule type on save and on load.
- Edits insert a new version and never update in place. Violations store the rule version they were evaluated against.
- The engine is a pure function `evaluate(claim, historySnapshot, policySet)` and fails closed: on error it routes for approval and never auto-approves.
- Approval thresholds and the sample rate live in a versioned `approval_config` table.

## Alternatives considered
- **Hard-coded rules**: violate the spec.
- **Expression strings (SpEL/MVEL)**: risk code injection and remote code execution, and are hard to validate and test.
- **Drools / DMN**: steep learning curve and heavy runtime for about 10 rules.

## Consequences
- Finance can change limits, actions, categories and city tiers at runtime with a full history of changes.
- A genuinely new kind of logic needs code plus tests. We accept this as a safety property.
- Tests are written before the engine, one parameterized suite per rule type.
