package com.expenseflow.policy;

import java.math.BigDecimal;

import com.expenseflow.claim.ClaimStatus;

/**
 * Claim-level policy outcome (§4.4).
 *
 * @param status  REJECTED, PENDING_MANAGER, PENDING_AUDITOR (sample audit) or APPROVED
 * @param summary human-readable explanation, stored on the system history entry
 */
public record ClaimDecision(
        ClaimStatus status,
        BigDecimal totalAmount,
        BigDecimal approvedAmount,
        boolean autoApproved,
        boolean sampleAudit,
        boolean hasViolations,
        String summary) {
}
