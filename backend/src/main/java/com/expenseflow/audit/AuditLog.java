package com.expenseflow.audit;

import java.time.Instant;

import org.hibernate.annotations.Immutable;

import com.expenseflow.user.Employee;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

/**
 * Append-only audit trail (ADR 0005). @Immutable in Hibernate, and a DB trigger
 * (src/main/resources/schema.sql) rejects UPDATE and DELETE. No setters on purpose.
 */
@Entity
@Immutable
@Table(name = "audit_log", indexes = {
        @Index(name = "ix_audit_log_entity", columnList = "entity_type,entity_id"),
        @Index(name = "ix_audit_log_created_at", columnList = "created_at")
})
public class AuditLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Null for system actions (e.g. seeding). */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "actor_id")
    private Employee actor;

    @Column(nullable = false, length = 50)
    private String action;

    @Column(nullable = false, length = 40)
    private String entityType;

    private Long entityId;

    @Column(length = 2000)
    private String details;

    @Column(nullable = false)
    private Instant createdAt;

    protected AuditLog() {
    }

    public AuditLog(Employee actor, String action, String entityType, Long entityId, String details,
                    Instant createdAt) {
        this.actor = actor;
        this.action = action;
        this.entityType = entityType;
        this.entityId = entityId;
        this.details = details;
        this.createdAt = createdAt;
    }

    public Long getId() {
        return id;
    }

    public Employee getActor() {
        return actor;
    }

    public String getAction() {
        return action;
    }

    public String getEntityType() {
        return entityType;
    }

    public Long getEntityId() {
        return entityId;
    }

    public String getDetails() {
        return details;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
