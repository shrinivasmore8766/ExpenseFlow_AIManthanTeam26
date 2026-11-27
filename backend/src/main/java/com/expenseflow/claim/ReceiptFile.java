package com.expenseflow.claim;

/** A receipt to send back to the client (endpoint 13). */
public record ReceiptFile(byte[] bytes, String contentType) {
}
