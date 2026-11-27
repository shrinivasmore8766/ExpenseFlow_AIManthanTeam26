package com.expenseflow.approval;

import java.util.List;

/** Response of POST /api/approvals/bulk-approve: {approved: [ids], skipped: [{id, reason}]}. */
public record BulkApproveResult(List<Long> approved, List<Skipped> skipped) {

    public record Skipped(Long id, String reason) {
    }
}
