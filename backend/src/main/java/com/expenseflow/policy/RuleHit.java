package com.expenseflow.policy;

/** One rule that fired on a line; stored as a policy_violation row. */
public record RuleHit(String ruleCode, Outcome outcome, String message) {
}
