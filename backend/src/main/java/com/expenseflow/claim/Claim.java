package com.expenseflow.claim;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import com.expenseflow.payout.PayoutBatch;
import com.expenseflow.user.Department;
import com.expenseflow.user.Employee;

import jakarta.persistence.CascadeType;
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
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

@Entity
@Table(name = "claim", indexes = {
        @Index(name = "ix_claim_employee_status", columnList = "employee_id,status"),
        @Index(name = "ix_claim_status", columnList = "status"),
        @Index(name = "ix_claim_current_approver", columnList = "current_approver_id"),
        @Index(name = "ix_claim_payout_batch", columnList = "payout_batch_id"),
        @Index(name = "ix_claim_department", columnList = "department_id")
})
public class Claim {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 30)
    private String claimNumber;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "employee_id", nullable = false)
    private Employee employee;

    /** Snapshot of the claimant's department at creation (for dashboard and filters). */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "department_id")
    private Department department;

    @Column(nullable = false, length = 200)
    private String title;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private ClaimStatus status = ClaimStatus.DRAFT;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal totalAmount = BigDecimal.ZERO.setScale(2);

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal approvedAmount = BigDecimal.ZERO.setScale(2);

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "current_approver_id")
    private Employee currentApprover;

    @Column(nullable = false)
    private boolean sampleAudit;

    @Column(nullable = false)
    private boolean autoApproved;

    @Column(nullable = false)
    private boolean hasViolations;

    private Instant submittedAt;

    private Instant decidedAt;

    private Instant paidAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "payout_batch_id")
    private PayoutBatch payoutBatch;

    @Version
    @Column(nullable = false)
    private Long version;

    @Column(nullable = false)
    private Instant createdAt;

    @OneToMany(mappedBy = "claim", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("id")
    private List<ClaimLine> lines = new ArrayList<>();

    protected Claim() {
    }

    public Claim(String claimNumber, Employee employee, String title, Instant createdAt) {
        this.claimNumber = claimNumber;
        this.employee = employee;
        this.department = employee.getDepartment();
        this.title = title;
        this.createdAt = createdAt;
    }

    public void addLine(ClaimLine line) {
        line.setClaim(this);
        lines.add(line);
    }

    public void removeLine(ClaimLine line) {
        lines.remove(line);
        line.setClaim(null);
    }

    public Long getId() {
        return id;
    }

    public String getClaimNumber() {
        return claimNumber;
    }

    public void setClaimNumber(String claimNumber) {
        this.claimNumber = claimNumber;
    }

    public Employee getEmployee() {
        return employee;
    }

    public Department getDepartment() {
        return department;
    }

    public void setDepartment(Department department) {
        this.department = department;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public ClaimStatus getStatus() {
        return status;
    }

    public void setStatus(ClaimStatus status) {
        this.status = status;
    }

    public BigDecimal getTotalAmount() {
        return totalAmount;
    }

    public void setTotalAmount(BigDecimal totalAmount) {
        this.totalAmount = totalAmount;
    }

    public BigDecimal getApprovedAmount() {
        return approvedAmount;
    }

    public void setApprovedAmount(BigDecimal approvedAmount) {
        this.approvedAmount = approvedAmount;
    }

    public Employee getCurrentApprover() {
        return currentApprover;
    }

    public void setCurrentApprover(Employee currentApprover) {
        this.currentApprover = currentApprover;
    }

    public boolean isSampleAudit() {
        return sampleAudit;
    }

    public void setSampleAudit(boolean sampleAudit) {
        this.sampleAudit = sampleAudit;
    }

    public boolean isAutoApproved() {
        return autoApproved;
    }

    public void setAutoApproved(boolean autoApproved) {
        this.autoApproved = autoApproved;
    }

    public boolean isHasViolations() {
        return hasViolations;
    }

    public void setHasViolations(boolean hasViolations) {
        this.hasViolations = hasViolations;
    }

    public Instant getSubmittedAt() {
        return submittedAt;
    }

    public void setSubmittedAt(Instant submittedAt) {
        this.submittedAt = submittedAt;
    }

    public Instant getDecidedAt() {
        return decidedAt;
    }

    public void setDecidedAt(Instant decidedAt) {
        this.decidedAt = decidedAt;
    }

    public Instant getPaidAt() {
        return paidAt;
    }

    public void setPaidAt(Instant paidAt) {
        this.paidAt = paidAt;
    }

    public PayoutBatch getPayoutBatch() {
        return payoutBatch;
    }

    public void setPayoutBatch(PayoutBatch payoutBatch) {
        this.payoutBatch = payoutBatch;
    }

    public Long getVersion() {
        return version;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public List<ClaimLine> getLines() {
        return lines;
    }
}
