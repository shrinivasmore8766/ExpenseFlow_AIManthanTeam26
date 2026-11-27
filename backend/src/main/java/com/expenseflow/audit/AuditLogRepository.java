package com.expenseflow.audit;

import java.util.List;

import org.springframework.data.repository.Repository;

/** Deliberately not a JpaRepository: only save and finders, no update or delete methods. */
public interface AuditLogRepository extends Repository<AuditLog, Long> {

    AuditLog save(AuditLog log);

    List<AuditLog> findByEntityTypeAndEntityIdOrderByCreatedAtAsc(String entityType, Long entityId);

    List<AuditLog> findTop100ByOrderByCreatedAtDesc();

    long count();
}
