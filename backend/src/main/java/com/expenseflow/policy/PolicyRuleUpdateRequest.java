package com.expenseflow.policy;

import java.math.BigDecimal;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;

/** PUT /api/policy-rules/{id}. limitAmount may be null for rules without a numeric limit. */
public record PolicyRuleUpdateRequest(
        @DecimalMin(value = "0.00", message = "must not be negative")
        @Digits(integer = 10, fraction = 2) BigDecimal limitAmount,
        @NotNull Boolean active) {
}
