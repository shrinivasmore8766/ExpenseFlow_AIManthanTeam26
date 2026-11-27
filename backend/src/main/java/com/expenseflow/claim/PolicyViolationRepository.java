package com.expenseflow.claim;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import com.expenseflow.dashboard.LabelCount;

public interface PolicyViolationRepository extends JpaRepository<PolicyViolation, Long> {

    /** Dashboard: violations by rule_code. */
    @Query("""
            select new com.expenseflow.dashboard.LabelCount(v.ruleCode, count(v))
            from PolicyViolation v
            group by v.ruleCode
            order by count(v) desc
            """)
    List<LabelCount> countByRuleCode();
}
