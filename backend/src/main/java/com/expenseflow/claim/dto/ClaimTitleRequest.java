package com.expenseflow.claim.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** POST /api/claims and PUT /api/claims/{id}. */
public record ClaimTitleRequest(
        @NotBlank @Size(max = 200) String title) {
}
