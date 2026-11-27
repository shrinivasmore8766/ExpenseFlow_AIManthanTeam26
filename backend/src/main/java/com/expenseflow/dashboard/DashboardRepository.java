package com.expenseflow.dashboard;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import com.expenseflow.claim.Claim;
import com.expenseflow.claim.ClaimStatus;

/**
 * Read-only aggregate queries for GET /api/dashboard. {@code allDepts=true} ignores {@code deptId};
 * otherwise results are limited to that department (managers).
 */
public interface DashboardRepository extends Repository<Claim, Long> {

    /** [category, sum(amount)] of non-rejected lines on spend claims. */
    @Query("""
            select l.category, sum(l.amount)
            from ClaimLine l join l.claim c
            where c.status in :statuses and c.submittedAt >= :since
              and (l.outcome is null or l.outcome <> com.expenseflow.policy.Outcome.AUTO_REJECT)
              and (:allDepts = true or c.department.id = :deptId)
            group by l.category
            order by sum(l.amount) desc
            """)
    List<Object[]> spendByCategory(@Param("statuses") Collection<ClaimStatus> statuses, @Param("since") Instant since,
                                   @Param("allDepts") boolean allDepts, @Param("deptId") Long deptId);

    /** [departmentName, sum(approvedAmount)]. */
    @Query("""
            select d.name, sum(c.approvedAmount)
            from Claim c left join c.department d
            where c.status in :statuses and c.submittedAt >= :since
              and (:allDepts = true or d.id = :deptId)
            group by d.name
            order by sum(c.approvedAmount) desc
            """)
    List<Object[]> spendByDepartment(@Param("statuses") Collection<ClaimStatus> statuses, @Param("since") Instant since,
                                     @Param("allDepts") boolean allDepts, @Param("deptId") Long deptId);

    /** [year, month, sum(approvedAmount)] by submittedAt (UTC). */
    @Query("""
            select year(c.submittedAt), month(c.submittedAt), sum(c.approvedAmount)
            from Claim c
            where c.status in :statuses and c.submittedAt >= :since
              and (:allDepts = true or c.department.id = :deptId)
            group by year(c.submittedAt), month(c.submittedAt)
            order by year(c.submittedAt), month(c.submittedAt)
            """)
    List<Object[]> spendByMonth(@Param("statuses") Collection<ClaimStatus> statuses, @Param("since") Instant since,
                                @Param("allDepts") boolean allDepts, @Param("deptId") Long deptId);

    /** [ruleCode, count]. */
    @Query("""
            select v.ruleCode, count(v)
            from PolicyViolation v join v.claim c
            where c.submittedAt >= :since
              and (:allDepts = true or c.department.id = :deptId)
            group by v.ruleCode
            order by count(v) desc
            """)
    List<Object[]> violationsByRule(@Param("since") Instant since,
                                    @Param("allDepts") boolean allDepts, @Param("deptId") Long deptId);

    /** [submittedAt, decidedAt] of manually decided spend claims (for the average approval time). */
    @Query("""
            select c.submittedAt, c.decidedAt
            from Claim c
            where c.status in :statuses and c.autoApproved = false
              and c.submittedAt >= :since and c.decidedAt is not null
              and (:allDepts = true or c.department.id = :deptId)
            """)
    List<Object[]> decisionTimes(@Param("statuses") Collection<ClaimStatus> statuses, @Param("since") Instant since,
                                 @Param("allDepts") boolean allDepts, @Param("deptId") Long deptId);

    /** [status, count, min(submittedAt)] for pending statuses. */
    @Query("""
            select c.status, count(c), min(c.submittedAt)
            from Claim c
            where c.status in :statuses
              and (:allDepts = true or c.department.id = :deptId)
            group by c.status
            """)
    List<Object[]> pendingByStatus(@Param("statuses") Collection<ClaimStatus> statuses,
                                   @Param("allDepts") boolean allDepts, @Param("deptId") Long deptId);
}
