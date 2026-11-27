package com.expenseflow.claim;

public enum ClaimStatus {
    DRAFT,
    PENDING_MANAGER,
    PENDING_AUDITOR,
    PENDING_FINANCE_HEAD,
    CLARIFICATION_REQUESTED,
    APPROVED,
    REJECTED,
    PAID;

    public boolean isPending() {
        return this == PENDING_MANAGER || this == PENDING_AUDITOR || this == PENDING_FINANCE_HEAD;
    }

    /** Lines and title may change only in these statuses (and only by the claimant). */
    public boolean isEditable() {
        return this == DRAFT || this == CLARIFICATION_REQUESTED;
    }
}
