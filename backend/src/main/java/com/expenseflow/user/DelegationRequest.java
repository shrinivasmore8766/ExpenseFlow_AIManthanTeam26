package com.expenseflow.user;

import java.time.LocalDate;

import com.fasterxml.jackson.annotation.JsonIgnore;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;

/** POST /api/delegations. delegate != delegator is checked in DelegationService (needs the current user). */
public record DelegationRequest(
        @NotNull Long delegateId,
        @NotNull LocalDate startDate,
        @NotNull LocalDate endDate) {

    @JsonIgnore
    @AssertTrue(message = "endDate must be on or after startDate")
    public boolean isDateRangeValid() {
        return startDate == null || endDate == null || !endDate.isBefore(startDate);
    }
}
