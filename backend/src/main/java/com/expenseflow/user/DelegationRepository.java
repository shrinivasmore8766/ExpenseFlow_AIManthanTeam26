package com.expenseflow.user;

import java.time.LocalDate;
import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DelegationRepository extends JpaRepository<Delegation, Long> {

    @Query("""
            select d from Delegation d
            join fetch d.delegator
            join fetch d.delegate
            where d.delegator.id = :delegatorId
            order by d.startDate desc
            """)
    List<Delegation> findByDelegator(@Param("delegatorId") Long delegatorId);

    /** Delegations in which this employee is the delegate and that are active on the given day. */
    @Query("""
            select d from Delegation d
            join fetch d.delegator
            where d.delegate.id = :delegateId
              and d.startDate <= :day and d.endDate >= :day
            """)
    List<Delegation> findActiveForDelegate(@Param("delegateId") Long delegateId, @Param("day") LocalDate day);
}
