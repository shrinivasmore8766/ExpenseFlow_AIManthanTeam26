package com.expenseflow.claim;

import java.util.Collection;
import java.util.List;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ClaimRepository extends JpaRepository<Claim, Long> {

    /** GET /api/claims: always filtered by the current employee. */
    @Query("""
            select c from Claim c
            join fetch c.employee
            left join fetch c.department
            where c.employee.id = :employeeId
            order by c.createdAt desc
            """)
    List<Claim> findOwn(@Param("employeeId") Long employeeId);

    /** Candidates for the approval queue; ApprovalService filters them with canAct. Oldest first. */
    @Query("""
            select c from Claim c
            join fetch c.employee
            left join fetch c.department
            where c.status in :statuses
            order by c.submittedAt asc
            """)
    List<Claim> findByStatusInOldestFirst(@Param("statuses") Collection<ClaimStatus> statuses, Pageable page);

    /** GET /api/payouts/eligible and POST /api/payouts. */
    @Query("""
            select c from Claim c
            join fetch c.employee
            left join fetch c.department
            where c.status = com.expenseflow.claim.ClaimStatus.APPROVED and c.payoutBatch is null
            order by c.decidedAt asc
            """)
    List<Claim> findEligibleForPayout();

    List<Claim> findByPayoutBatchIdOrderByIdAsc(Long payoutBatchId);

    long countByStatus(ClaimStatus status);
}
