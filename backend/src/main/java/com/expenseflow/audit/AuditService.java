package com.expenseflow.audit;

import java.time.Clock;
import java.time.Instant;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.expenseflow.user.Employee;

/**
 * Writes the audit trail. MANDATORY propagation: the audit row must commit or roll back
 * together with the business change, so calling this outside a transaction is a bug.
 * Never pass passwords, receipt contents or bank numbers in {@code details}.
 */
@Service
public class AuditService {

    private static final int MAX_DETAILS = 2000;

    private final AuditLogRepository repository;
    private final Clock clock;

    public AuditService(AuditLogRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void log(Employee actor, String action, String entityType, Long entityId, String details) {
        String trimmed = details != null && details.length() > MAX_DETAILS
                ? details.substring(0, MAX_DETAILS)
                : details;
        repository.save(new AuditLog(actor, action, entityType, entityId, trimmed, Instant.now(clock)));
    }
}
