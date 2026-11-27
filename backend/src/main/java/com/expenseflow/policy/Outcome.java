package com.expenseflow.policy;

/** Policy result for a line, ordered from least to most severe (compare with {@code ordinal()}). */
public enum Outcome {
    AUTO_APPROVE,
    ROUTE,
    AUTO_REJECT
}
