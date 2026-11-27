package com.expenseflow.common;

/** 403: authenticated but not allowed to perform this action. */
public class ForbiddenException extends RuntimeException {

    public ForbiddenException(String message) {
        super(message);
    }
}
