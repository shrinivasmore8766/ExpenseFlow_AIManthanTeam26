package com.expenseflow.claim;

import java.math.BigDecimal;
import java.time.LocalDate;

/** Query projection: an amount total for one date. */
public record DailyAmount(LocalDate date, BigDecimal amount) {
}
