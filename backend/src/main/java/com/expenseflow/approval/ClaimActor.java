package com.expenseflow.approval;

/** Query projection: an actor id on a claim. */
public record ClaimActor(Long claimId, Long actorId) {
}
