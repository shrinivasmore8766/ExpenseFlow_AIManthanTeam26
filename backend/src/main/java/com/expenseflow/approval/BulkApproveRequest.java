package com.expenseflow.approval;

import java.util.List;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** POST /api/approvals/bulk-approve. */
public record BulkApproveRequest(
        @NotEmpty @Size(max = 500) List<@NotNull Long> claimIds) {
}
