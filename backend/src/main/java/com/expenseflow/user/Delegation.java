package com.expenseflow.user;

import java.time.LocalDate;

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

/** delegator -> delegate, active from startDate to endDate inclusive. */
@Entity
@Table(name = "delegation", indexes = {
        @Index(name = "ix_delegation_delegator", columnList = "delegator_id"),
        @Index(name = "ix_delegation_delegate", columnList = "delegate_id")
})
public class Delegation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "delegator_id", nullable = false)
    private Employee delegator;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "delegate_id", nullable = false)
    private Employee delegate;

    @Column(nullable = false)
    private LocalDate startDate;

    @Column(nullable = false)
    private LocalDate endDate;

    protected Delegation() {
    }

    public Delegation(Employee delegator, Employee delegate, LocalDate startDate, LocalDate endDate) {
        this.delegator = delegator;
        this.delegate = delegate;
        this.startDate = startDate;
        this.endDate = endDate;
    }

    public Long getId() {
        return id;
    }

    public Employee getDelegator() {
        return delegator;
    }

    public Employee getDelegate() {
        return delegate;
    }

    public LocalDate getStartDate() {
        return startDate;
    }

    public void setStartDate(LocalDate startDate) {
        this.startDate = startDate;
    }

    public LocalDate getEndDate() {
        return endDate;
    }

    public void setEndDate(LocalDate endDate) {
        this.endDate = endDate;
    }
}
