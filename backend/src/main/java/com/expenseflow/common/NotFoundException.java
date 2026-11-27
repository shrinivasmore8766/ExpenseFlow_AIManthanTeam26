package com.expenseflow.common;

/** 404. Also used when the caller may not see a resource, so its existence is not revealed. */
public class NotFoundException extends RuntimeException {

    public NotFoundException(String message) {
        super(message);
    }
}
