package com.expenseflow.approval;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** POST /api/claims/{id}/reject and /send-back: comment is required. */
public record RequiredCommentRequest(
        @NotBlank(message = "A comment is required") @Size(max = 1000) String comment) {
}
