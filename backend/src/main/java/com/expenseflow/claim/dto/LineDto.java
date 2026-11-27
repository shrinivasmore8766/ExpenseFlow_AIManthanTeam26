package com.expenseflow.claim.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import com.expenseflow.claim.Category;
import com.expenseflow.claim.ClaimLine;
import com.expenseflow.policy.Outcome;

/** API shape "Line". The receipt path and hash are never exposed. */
public record LineDto(
        Long id,
        Category category,
        LocalDate expenseDate,
        BigDecimal amount,
        String vendor,
        String city,
        Integer nights,
        String description,
        boolean hasReceipt,
        String receiptContentType,
        Outcome outcome,
        List<ViolationDto> violations) {

    public static LineDto from(ClaimLine l) {
        return new LineDto(
                l.getId(),
                l.getCategory(),
                l.getExpenseDate(),
                l.getAmount(),
                l.getVendor(),
                l.getCity(),
                l.getNights(),
                l.getDescription(),
                l.hasReceipt(),
                l.getReceiptContentType(),
                l.getOutcome(),
                l.getViolations().stream().map(ViolationDto::from).toList());
    }
}
