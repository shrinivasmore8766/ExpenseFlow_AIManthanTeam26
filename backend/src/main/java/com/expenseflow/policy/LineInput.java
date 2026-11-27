package com.expenseflow.policy;

import java.math.BigDecimal;
import java.time.LocalDate;

import com.expenseflow.claim.Category;

/** One claim line as the policy engine sees it. receiptHash is null when no receipt was uploaded. */
public record LineInput(
        Category category,
        LocalDate expenseDate,
        BigDecimal amount,
        String vendor,
        String city,
        Integer nights,
        String receiptHash) {
}
