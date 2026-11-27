package com.expenseflow.approval;

import java.math.BigDecimal;
import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.expenseflow.claim.ClaimStatus;
import com.expenseflow.claim.dto.ClaimDetail;
import com.expenseflow.claim.dto.ClaimSummary;

import jakarta.validation.Valid;

@RestController
public class ApprovalController {

    private final ApprovalService approvalService;

    public ApprovalController(ApprovalService approvalService) {
        this.approvalService = approvalService;
    }

    @GetMapping("/api/approvals")
    public List<ClaimSummary> queue(@RequestParam(required = false) ClaimStatus status,
                                    @RequestParam(required = false) Long departmentId,
                                    @RequestParam(required = false) BigDecimal minAmount,
                                    @RequestParam(defaultValue = "false") boolean flaggedOnly) {
        return approvalService.queue(status, departmentId, minAmount, flaggedOnly);
    }

    @PostMapping("/api/claims/{id}/approve")
    public ClaimDetail approve(@PathVariable Long id, @Valid @RequestBody(required = false) CommentRequest request) {
        return approvalService.approve(id, request == null ? null : request.comment());
    }

    @PostMapping("/api/claims/{id}/reject")
    public ClaimDetail reject(@PathVariable Long id, @Valid @RequestBody RequiredCommentRequest request) {
        return approvalService.reject(id, request.comment());
    }

    @PostMapping("/api/claims/{id}/send-back")
    public ClaimDetail sendBack(@PathVariable Long id, @Valid @RequestBody RequiredCommentRequest request) {
        return approvalService.sendBack(id, request.comment());
    }

    @PostMapping("/api/approvals/bulk-approve")
    public BulkApproveResult bulkApprove(@Valid @RequestBody BulkApproveRequest request) {
        return approvalService.bulkApprove(request.claimIds());
    }
}
