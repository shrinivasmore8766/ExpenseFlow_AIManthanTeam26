package com.expenseflow.claim.dto;

import java.time.Instant;

import com.expenseflow.approval.ApprovalAction;
import com.expenseflow.claim.ClaimStatus;

/** API shape "HistoryItem", built from approval_action rows. */
public record HistoryItem(
        Instant at,
        String actorName,
        String onBehalfOfName,
        String action,
        ClaimStatus fromStatus,
        ClaimStatus toStatus,
        String comment) {

    public static final String SYSTEM_ACTOR_NAME = "System (policy engine)";

    public static HistoryItem from(ApprovalAction a) {
        return new HistoryItem(
                a.getCreatedAt(),
                a.getActor() == null ? SYSTEM_ACTOR_NAME : a.getActor().getFullName(),
                a.getOnBehalfOf() == null ? null : a.getOnBehalfOf().getFullName(),
                a.getAction().name(),
                a.getFromStatus(),
                a.getToStatus(),
                a.getComment());
    }
}
