package com.expenseflow.claim;

import com.expenseflow.policy.Outcome;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

/**
 * One policy-rule hit on a line. Owned by {@link ClaimLine#getViolations()} (cascade + orphanRemoval):
 * clear that list to delete old violations on resubmit.
 */
@Entity
@Table(name = "policy_violation", indexes = {
        @Index(name = "ix_policy_violation_claim", columnList = "claim_id"),
        @Index(name = "ix_policy_violation_line", columnList = "line_id"),
        @Index(name = "ix_policy_violation_rule", columnList = "rule_code")
})
public class PolicyViolation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "claim_id", nullable = false)
    private Claim claim;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "line_id", nullable = false)
    private ClaimLine line;

    @Column(nullable = false, length = 40)
    private String ruleCode;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Outcome outcome;

    @Column(nullable = false, length = 200)
    private String message;

    protected PolicyViolation() {
    }

    public PolicyViolation(ClaimLine line, String ruleCode, Outcome outcome, String message) {
        this.claim = line.getClaim();
        this.line = line;
        this.ruleCode = ruleCode;
        this.outcome = outcome;
        this.message = message;
    }

    public Long getId() {
        return id;
    }

    public Claim getClaim() {
        return claim;
    }

    public ClaimLine getLine() {
        return line;
    }

    public String getRuleCode() {
        return ruleCode;
    }

    public Outcome getOutcome() {
        return outcome;
    }

    public String getMessage() {
        return message;
    }
}
