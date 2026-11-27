package com.expenseflow.user;

import java.time.LocalDate;

public record DelegationDto(
        Long id,
        String delegatorName,
        Long delegateId,
        String delegateName,
        LocalDate startDate,
        LocalDate endDate,
        boolean active) {

    /** {@code today} comes from the injected Clock in the calling service. */
    public static DelegationDto from(Delegation d, LocalDate today) {
        boolean active = !today.isBefore(d.getStartDate()) && !today.isAfter(d.getEndDate());
        return new DelegationDto(
                d.getId(),
                d.getDelegator().getFullName(),
                d.getDelegate().getId(),
                d.getDelegate().getFullName(),
                d.getStartDate(),
                d.getEndDate(),
                active);
    }
}
