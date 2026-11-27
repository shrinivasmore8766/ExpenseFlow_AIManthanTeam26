package com.expenseflow.payout;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

public interface PayoutBatchRepository extends JpaRepository<PayoutBatch, Long> {

    List<PayoutBatch> findAllByOrderByCreatedAtDesc();
}
