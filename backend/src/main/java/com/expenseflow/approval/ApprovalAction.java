package com.expenseflow.approval;

import java.time.Instant;

import com.expenseflow.claim.Claim;
import com.expenseflow.claim.ClaimStatus;
import com.expenseflow.user.Employee;

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

/** One step in a claim's history. actor == null means the system (policy engine). */
@Entity
@Table(name = "approval_action", indexes = {
        @Index(name = "ix_approval_action_claim", columnList = "claim_id"),
        @Index(name = "ix_approval_action_actor", columnList = "actor_id")
})
public class ApprovalAction {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "claim_id", nullable = false)
    private Claim claim;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "actor_id")
    private Employee actor;

    /** Set when a delegate acted: the delegator. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "on_behalf_of_id")
    private Employee onBehalfOf;

    @Enumerated(EnumType.STRING)
    @Column(length = 30)
    private ClaimStatus fromStatus;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private ClaimStatus toStatus;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private ActionType action;

    @Column(length = 1000)
    private String comment;

    @Column(nullable = false)
    private Instant createdAt;

    protected ApprovalAction() {
    }

    public ApprovalAction(Claim claim, Employee actor, Employee onBehalfOf, ActionType action,
                          ClaimStatus fromStatus, ClaimStatus toStatus, String comment, Instant createdAt) {
        this.claim = claim;
        this.actor = actor;
        this.onBehalfOf = onBehalfOf;
        this.action = action;
        this.fromStatus = fromStatus;
        this.toStatus = toStatus;
        this.comment = comment;
        this.createdAt = createdAt;
    }

    public Long getId() {
        return id;
    }

    public Claim getClaim() {
        return claim;
    }

    public Employee getActor() {
        return actor;
    }

    public Employee getOnBehalfOf() {
        return onBehalfOf;
    }

    public ClaimStatus getFromStatus() {
        return fromStatus;
    }

    public ClaimStatus getToStatus() {
        return toStatus;
    }

    public ActionType getAction() {
        return action;
    }

    public String getComment() {
        return comment;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
