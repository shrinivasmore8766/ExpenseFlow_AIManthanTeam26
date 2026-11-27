package com.expenseflow.common;

/** 400: the request breaks a business rule (e.g. missing comment on reject). */
public class BadRequestException extends RuntimeException {

    public BadRequestException(String message) {
        super(message);
    }
}
