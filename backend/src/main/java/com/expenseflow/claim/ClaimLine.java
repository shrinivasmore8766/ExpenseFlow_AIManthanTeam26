package com.expenseflow.claim;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import com.expenseflow.policy.Outcome;

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

@Entity
@Table(name = "claim_line", indexes = {
        @Index(name = "ix_claim_line_claim", columnList = "claim_id"),
        @Index(name = "ix_claim_line_receipt_hash", columnList = "receipt_hash"),
        @Index(name = "ix_claim_line_expense_date", columnList = "expense_date")
})
public class ClaimLine {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "claim_id", nullable = false)
    private Claim claim;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Category category;

    @Column(nullable = false)
    private LocalDate expenseDate;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(length = 120)
    private String vendor;

    @Column(length = 60)
    private String city;

    private Integer nights;

    @Column(length = 500)
    private String description;

    /** Stored file name (random UUID) under app.receipts.dir; never the client file name. */
    @Column(length = 64)
    private String receiptPath;

    /** SHA-256 hex of the receipt bytes. */
    @Column(length = 64)
    private String receiptHash;

    @Column(length = 50)
    private String receiptContentType;

    /** Null until the claim is submitted and the policy engine has run. */
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private Outcome outcome;

    @OneToMany(mappedBy = "line", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("id")
    private List<PolicyViolation> violations = new ArrayList<>();

    protected ClaimLine() {
    }

    public ClaimLine(Category category, LocalDate expenseDate, BigDecimal amount) {
        this.category = category;
        this.expenseDate = expenseDate;
        this.amount = amount;
    }

    public boolean hasReceipt() {
        return receiptHash != null;
    }

    public Long getId() {
        return id;
    }

    public Claim getClaim() {
        return claim;
    }

    void setClaim(Claim claim) {
        this.claim = claim;
    }

    public Category getCategory() {
        return category;
    }

    public void setCategory(Category category) {
        this.category = category;
    }

    public LocalDate getExpenseDate() {
        return expenseDate;
    }

    public void setExpenseDate(LocalDate expenseDate) {
        this.expenseDate = expenseDate;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }

    public String getVendor() {
        return vendor;
    }

    public void setVendor(String vendor) {
        this.vendor = vendor;
    }

    public String getCity() {
        return city;
    }

    public void setCity(String city) {
        this.city = city;
    }

    public Integer getNights() {
        return nights;
    }

    public void setNights(Integer nights) {
        this.nights = nights;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getReceiptPath() {
        return receiptPath;
    }

    public void setReceiptPath(String receiptPath) {
        this.receiptPath = receiptPath;
    }

    public String getReceiptHash() {
        return receiptHash;
    }

    public void setReceiptHash(String receiptHash) {
        this.receiptHash = receiptHash;
    }

    public String getReceiptContentType() {
        return receiptContentType;
    }

    public void setReceiptContentType(String receiptContentType) {
        this.receiptContentType = receiptContentType;
    }

    public Outcome getOutcome() {
        return outcome;
    }

    public void setOutcome(Outcome outcome) {
        this.outcome = outcome;
    }

    public List<PolicyViolation> getViolations() {
        return violations;
    }
}
