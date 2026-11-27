package com.expenseflow.user;

/** One role per user. Every role can also submit its own claims. FINANCE_HEAD is also admin. */
public enum Role {
    EMPLOYEE,
    MANAGER,
    FINANCE_AUDITOR,
    FINANCE_HEAD
}
