package com.expenseflow.approval;

import jakarta.validation.constraints.Size;

/** POST /api/claims/{id}/approve: comment is optional. */
public record CommentRequest(
        @Size(max = 1000) String comment) {
}
