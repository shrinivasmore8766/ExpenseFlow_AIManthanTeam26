package com.expenseflow.policy;

import java.math.BigDecimal;

import com.expenseflow.claim.Category;

public record PolicyRuleDto(
        Long id,
        String code,
        Category category,
        BigDecimal limitAmount,
        String description,
        boolean active) {

    public static PolicyRuleDto from(PolicyRule r) {
        return new PolicyRuleDto(r.getId(), r.getCode(), r.getCategory(), r.getLimitAmount(),
                r.getDescription(), r.isActive());
    }
}
