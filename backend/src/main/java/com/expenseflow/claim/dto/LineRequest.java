package com.expenseflow.claim.dto;

import java.math.BigDecimal;
import java.time.LocalDate;

import com.expenseflow.claim.Category;
import com.fasterxml.jackson.annotation.JsonIgnore;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * POST/PUT a claim line (§4.3). Field shape is fixed by the API contract.
 * Never add status, outcome or amounts computed by the server here.
 */
public record LineRequest(
        @NotNull Category category,
        @NotNull LocalDate expenseDate,
        @NotNull
        @DecimalMin(value = "0.01", message = "must be greater than 0")
        @DecimalMax(value = "1000000.00", message = "must be at most 10,00,000")
        @Digits(integer = 7, fraction = 2, message = "must have at most 2 decimals")
        BigDecimal amount,
        @NotBlank @Size(max = 120) String vendor,
        @Size(max = 60) String city,
        @Min(1) @Max(365) Integer nights,
        @Size(max = 500) String description) {

    /** HOTEL requires city and nights >= 1. */
    @JsonIgnore
    @AssertTrue(message = "HOTEL lines require city and nights of at least 1")
    public boolean isHotelDetailsValid() {
        if (category != Category.HOTEL) {
            return true;
        }
        return city != null && !city.isBlank() && nights != null && nights >= 1;
    }
}
