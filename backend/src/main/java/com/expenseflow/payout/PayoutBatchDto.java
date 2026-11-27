package com.expenseflow.payout;

import java.math.BigDecimal;
import java.time.Instant;

/** API shape "PayoutBatch". */
public record PayoutBatchDto(
        Long id,
        String batchNumber,
        Instant createdAt,
        int claimCount,
        BigDecimal totalAmount,
        PayoutStatus status,
        Instant paidAt) {

    public static PayoutBatchDto from(PayoutBatch b) {
        return new PayoutBatchDto(b.getId(), b.getBatchNumber(), b.getCreatedAt(), b.getClaimCount(),
                b.getTotalAmount(), b.getStatus(), b.getPaidAt());
    }
}
