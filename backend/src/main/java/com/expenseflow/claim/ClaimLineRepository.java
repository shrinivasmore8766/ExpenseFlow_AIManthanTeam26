package com.expenseflow.claim;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Lookups PolicyService needs to build the PolicyContext (§4.4). The engine itself never queries. */
public interface ClaimLineRepository extends JpaRepository<ClaimLine, Long> {

    /** DUPLICATE_RECEIPT: hashes already used on lines of other, non-draft claims (any employee). */
    @Query("""
            select distinct l.receiptHash from ClaimLine l
            where l.receiptHash in :hashes
              and l.claim.id <> :claimId
              and l.claim.status <> com.expenseflow.claim.ClaimStatus.DRAFT
            """)
    List<String> findPriorReceiptHashes(@Param("hashes") Collection<String> hashes,
                                        @Param("claimId") Long claimId);

    /**
     * DUPLICATE_EXPENSE: lines of other, non-draft claims with a matching date and amount.
     * The caller compares the normalised vendor (trim + lower-case).
     */
    @Query("""
            select l from ClaimLine l
            where l.expenseDate in :dates
              and l.amount in :amounts
              and l.claim.id <> :claimId
              and l.claim.status <> com.expenseflow.claim.ClaimStatus.DRAFT
            """)
    List<ClaimLine> findPriorLinesForDuplicateCheck(@Param("dates") Collection<LocalDate> dates,
                                                    @Param("amounts") Collection<BigDecimal> amounts,
                                                    @Param("claimId") Long claimId);

    /** MEAL_DAILY_LIMIT: the employee's meal total per date on other non-draft, non-rejected claims. */
    @Query("""
            select new com.expenseflow.claim.DailyAmount(l.expenseDate, sum(l.amount))
            from ClaimLine l
            where l.claim.employee.id = :employeeId
              and l.category = com.expenseflow.claim.Category.MEAL
              and l.expenseDate in :dates
              and l.claim.id <> :claimId
              and l.claim.status not in (com.expenseflow.claim.ClaimStatus.DRAFT,
                                         com.expenseflow.claim.ClaimStatus.REJECTED)
            group by l.expenseDate
            """)
    List<DailyAmount> findMealTotalsByDate(@Param("employeeId") Long employeeId,
                                           @Param("dates") Collection<LocalDate> dates,
                                           @Param("claimId") Long claimId);
}
