package com.expenseflow.approval;

import java.util.Collection;
import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ApprovalActionRepository extends JpaRepository<ApprovalAction, Long> {

    /** Claim history, oldest first, with actor names loaded. */
    @Query("""
            select a from ApprovalAction a
            left join fetch a.actor
            left join fetch a.onBehalfOf
            where a.claim.id = :claimId
            order by a.createdAt asc, a.id asc
            """)
    List<ApprovalAction> findHistory(@Param("claimId") Long claimId);

    /** "Anyone who has acted" may view the claim (§5 row 6). */
    boolean existsByClaimIdAndActorId(Long claimId, Long actorId);

    /** Who approved each claim since its last submit (submittedAt is reset on every submit). */
    @Query("""
            select new com.expenseflow.approval.ClaimActor(a.claim.id, a.actor.id)
            from ApprovalAction a
            where a.claim.id in :claimIds
              and a.action = com.expenseflow.approval.ActionType.APPROVE
              and a.createdAt >= a.claim.submittedAt
            """)
    List<ClaimActor> findApproversThisRound(@Param("claimIds") Collection<Long> claimIds);
}
