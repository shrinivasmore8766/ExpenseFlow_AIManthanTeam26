package com.expenseflow.claim.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

import com.expenseflow.claim.Claim;
import com.expenseflow.claim.ClaimStatus;

/**
 * API shape "ClaimDetail" = ClaimSummary fields + detail fields (flat JSON).
 * {@code allowedActions} ⊆ EDIT, SUBMIT, DELETE, APPROVE, REJECT, SEND_BACK and is computed by the
 * service for the caller (via ApprovalRules); it is passed in, never derived here.
 */
public record ClaimDetail(
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
        boolean sampleAudit,
        Long employeeId,
        boolean autoApproved,
        String currentApproverName,
        List<LineDto> lines,
        List<HistoryItem> history,
        List<String> allowedActions) {

    public static ClaimDetail of(Claim c, List<HistoryItem> history, List<String> allowedActions) {
        return new ClaimDetail(
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
                c.isSampleAudit(),
                c.getEmployee().getId(),
                c.isAutoApproved(),
                c.getCurrentApprover() == null ? null : c.getCurrentApprover().getFullName(),
                c.getLines().stream().map(LineDto::from).toList(),
                history,
                allowedActions);
    }
}
