package com.expenseflow.policy;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

public interface PolicyRuleRepository extends JpaRepository<PolicyRule, Long> {

    List<PolicyRule> findAllByOrderByCodeAsc();

    List<PolicyRule> findByActiveTrue();

    Optional<PolicyRule> findByCode(String code);
}
