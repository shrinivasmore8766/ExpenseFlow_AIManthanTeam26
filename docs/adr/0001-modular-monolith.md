# ADR 0001 — Modular monolith with a pure-Java core

**Status:** Accepted · **Date:** 2026-11-27

## Context
Two developers, hackathon timeline, about 150 users and 3,000 claims. Approving a claim, writing its audit row
and adding it to a payout batch must be consistent.

## Decision
- Build one Spring Boot deployable, organized as business modules (`identity, policy, claim, approval, payout, reporting, audit, seed`).
- A module may call another module's service layer, never its repositories. An ArchUnit test enforces this.
- The policy engine, claim state machine and approval chain builder are plain Java with no framework or I/O dependencies.
- Domain modelling is light DDD: `Claim` is the aggregate root, and lines only change through it.

## Alternatives considered
- **Microservices**: would need distributed transactions between approval, audit and payout, and too much to operate for two people. Rejected.
- **Plain layered monolith**: quick to start, but tangles as it grows and the two developers would edit the same packages. Rejected.
- **Full clean/hexagonal**: doubles the mapping code. Used only where business risk lives.

## Consequences
- ACID transactions, one pipeline, one Compose service.
- Each developer owns whole modules, which reduces merge conflicts.
- A module could be pulled out into its own service later if scale required it.
- Module boundaries need guarding, hence the ArchUnit test.
