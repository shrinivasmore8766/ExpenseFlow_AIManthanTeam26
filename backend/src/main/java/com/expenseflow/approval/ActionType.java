package com.expenseflow.approval;

/** What happened in an approval_action row (shown as HistoryItem.action). */
public enum ActionType {
    /** Claimant submitted or resubmitted. */
    SUBMIT,
    /** System entry (actor null): the policy engine's outcome after submit. */
    POLICY_DECISION,
    APPROVE,
    REJECT,
    SEND_BACK,
    /** Claim paid as part of a payout batch. */
    PAID
}
