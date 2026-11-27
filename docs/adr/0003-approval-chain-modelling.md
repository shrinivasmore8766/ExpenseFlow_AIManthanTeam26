# ADR 0003 — How approval chains are modelled

**Status:** Accepted, **amended for the 3-hour build** · **Date:** 2026-11-27

> **Amendment (3-hour scope):** the pre-computed `approval_step` table is dropped.
> - The claim's status enum (`PENDING_MANAGER/AUDITOR/FINANCE_HEAD`) is the current level.
> - Routing and `canAct` live in the pure class `ApprovalRules`.
> - History is kept in `approval_action`.
>
> The explicit state machine, action-time delegation, restart-on-resubmit and synchronous transactions all remain.
> See [04-final-3h-architecture.md](../architecture/04-final-3h-architecture.md) and [backend/CLAUDE.md](../../backend/CLAUDE.md) §4.5.

## Context
- The chain is manager, then Finance Auditor above 25,000 INR, then Finance Head above 1,00,000 INR.
- Approvers can comment, reject, send back for clarification, and delegate while on leave.
- Incorrect transitions such as double approval, approving a rejected claim or self-approval are the main ways to bypass approvals.

## Decision
1. **Explicit state machine.** `ClaimStatus` has separate `PENDING_MANAGER / PENDING_AUDITOR / PENDING_FINANCE_HEAD` states.
   Allowed transitions live in one transition table in `ClaimStateMachine`, and entity setters are private.
2. **Pre-computed steps.** On submit, `ApprovalChainBuilder` inserts one `approval_step` row per required level,
   using the payable amount and the hierarchy at submit time.
   - The manager step goes to a named user.
   - The auditor step goes to the auditor *role pool*.
   - The Finance Head step goes to the Finance Head, or to the CEO if the claimant is the Finance Head.
   - Consecutive steps that land on the same person are merged.
   - A step is never assigned to the claimant.
3. **Delegation is resolved at action time.**
   - A step keeps its original assignee. Anyone with an active, time-bound delegation from that assignee may act,
     and is recorded as acting on their behalf.
   - The inbox and the action endpoints share one `canAct` predicate.
4. **Clarification restarts the chain.** Sending back cancels the open steps, which are kept with a `round` number.
   Resubmitting runs the policy again and builds a new chain from level 1.
5. **Processing is synchronous.** The state change, the step update and the audit row are saved in one transaction
   with optimistic locking (`@Version`).

## Alternatives considered
- **Condition checks spread across services**: leads to bypass bugs.
- **Spring Statemachine**: awkward persistence and heavy for about 10 states.
- **BPMN (Camunda/Flowable)**: too much setup time and hides logic from unit tests.
- **Dynamic next-approver**: the chain can't be shown upfront, and a reporting-line change can silently skip a level.
- **Reassigning steps when a delegation is created**: breaks when leave ends early, and misses claims that arrive later.

## Consequences
- Employees and approvers can see the full chain, and approval history is just the step rows.
- SRE metrics such as queue size and oldest pending approval come from simple queries.
- If the hierarchy changes mid-flight, the admin must reassign the step. This shows up as an ageing alert.
- If the Finance Head delegates to an auditor, a single auditor could approve both the auditor and Finance Head levels
  of the same claim. `canAct` blocks this: the same user cannot act on two levels of one claim.
