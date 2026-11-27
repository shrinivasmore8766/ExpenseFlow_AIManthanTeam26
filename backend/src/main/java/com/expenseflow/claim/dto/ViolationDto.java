package com.expenseflow.claim.dto;

import com.expenseflow.claim.PolicyViolation;
import com.expenseflow.policy.Outcome;

public record ViolationDto(String ruleCode, Outcome outcome, String message) {

    public static ViolationDto from(PolicyViolation v) {
        return new ViolationDto(v.getRuleCode(), v.getOutcome(), v.getMessage());
    }
}
