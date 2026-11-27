package com.expenseflow.claim.dto;

import java.math.BigDecimal;
import java.time.Instant;

import com.expenseflow.claim.Claim;
import com.expenseflow.claim.ClaimStatus;

/** API shape "ClaimSummary". Build inside a transaction (touches lazy employee and department). */
public record ClaimSummary(
        Long id,
        String claimNumber,
        String title,
        ClaimStatus status,
        String employeeName,
        String departmentName,
        BigDecimal totalAmount,
        BigDecimal approvedAmount,
        Instant submittedAt,
        boolean hasViolations,
        boolean sampleAudit) {

    public static ClaimSummary from(Claim c) {
        return new ClaimSummary(
                c.getId(),
                c.getClaimNumber(),
                c.getTitle(),
                c.getStatus(),
                c.getEmployee().getFullName(),
                c.getDepartment() == null ? null : c.getDepartment().getName(),
                c.getTotalAmount(),
                c.getApprovedAmount(),
                c.getSubmittedAt(),
                c.isHasViolations(),
                c.isSampleAudit());
    }
}
