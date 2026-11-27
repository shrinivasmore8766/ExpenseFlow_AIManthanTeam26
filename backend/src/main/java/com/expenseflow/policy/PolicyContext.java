package com.expenseflow.policy;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Map;
import java.util.Set;

/**
 * Everything the engine needs, prepared by PolicyService (or the seeder). The engine never queries.
 *
 * @param activeRuleCodes    codes of active policy_rule rows; inactive rules are skipped
 * @param limits             limit_amount per rule code (rules without a limit are absent)
 * @param tier1Cities        lower-case, trimmed city names
 * @param priorReceiptHashes hashes on lines of other non-draft claims
 * @param priorExpenseKeys   {@link PolicyEngine#expenseKey} of lines on other non-draft claims
 * @param priorMealTotals    the claimant's meal totals per date on other non-draft, non-rejected claims
 */
public record PolicyContext(
        Set<String> activeRuleCodes,
        Map<String, BigDecimal> limits,
        Set<String> tier1Cities,
        BigDecimal autoApproveLimit,
        int sampleAuditPercent,
        Set<String> priorReceiptHashes,
        Set<String> priorExpenseKeys,
        Map<LocalDate, BigDecimal> priorMealTotals) {

    public boolean isActive(String ruleCode) {
        return activeRuleCodes.contains(ruleCode);
    }

    /** The limit of an active rule, or null if the rule is inactive or has no limit. */
    public BigDecimal activeLimit(String ruleCode) {
        return isActive(ruleCode) ? limits.get(ruleCode) : null;
    }
}
