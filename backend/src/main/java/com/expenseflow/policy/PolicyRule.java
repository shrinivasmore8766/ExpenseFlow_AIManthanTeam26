package com.expenseflow.policy;

import java.math.BigDecimal;

import com.expenseflow.claim.Category;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** A configurable policy limit (table {@code policy_rule}). Limits are never hard-coded. */
@Entity
@Table(name = "policy_rule")
public class PolicyRule {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 40)
    private String code;

    /** Null when the rule applies to every category (e.g. RECEIPT_REQUIRED, WEEKEND_EXPENSE). */
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private Category category;

    /** Null for rules without a numeric limit. */
    @Column(precision = 12, scale = 2)
    private BigDecimal limitAmount;

    @Column(nullable = false, length = 200)
    private String description;

    @Column(nullable = false)
    private boolean active = true;

    protected PolicyRule() {
    }

    public PolicyRule(String code, Category category, BigDecimal limitAmount, String description) {
        this.code = code;
        this.category = category;
        this.limitAmount = limitAmount;
        this.description = description;
    }

    public Long getId() {
        return id;
    }

    public String getCode() {
        return code;
    }

    public Category getCategory() {
        return category;
    }

    public void setCategory(Category category) {
        this.category = category;
    }

    public BigDecimal getLimitAmount() {
        return limitAmount;
    }

    public void setLimitAmount(BigDecimal limitAmount) {
        this.limitAmount = limitAmount;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }
}
