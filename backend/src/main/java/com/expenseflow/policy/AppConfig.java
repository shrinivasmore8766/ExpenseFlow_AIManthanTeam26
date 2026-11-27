package com.expenseflow.policy;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * Key/value thresholds (table {@code app_config}), e.g. AUTO_APPROVE_LIMIT, AUDITOR_THRESHOLD,
 * FINANCE_HEAD_THRESHOLD, SAMPLE_AUDIT_PERCENT, TIER1_CITIES.
 */
@Entity
@Table(name = "app_config")
public class AppConfig {

    @Id
    @Column(name = "key", length = 60)
    private String key;

    @Column(name = "value", nullable = false, length = 500)
    private String value;

    protected AppConfig() {
    }

    public AppConfig(String key, String value) {
        this.key = key;
        this.value = value;
    }

    public String getKey() {
        return key;
    }

    public String getValue() {
        return value;
    }

    public void setValue(String value) {
        this.value = value;
    }
}
