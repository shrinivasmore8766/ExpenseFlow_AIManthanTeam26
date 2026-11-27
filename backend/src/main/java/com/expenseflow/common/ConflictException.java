package com.expenseflow.common;

/** 409: action not allowed in the claim's current status. */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }
}
