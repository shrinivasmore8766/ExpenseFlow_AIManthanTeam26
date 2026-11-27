package com.expenseflow.policy;

import java.math.BigDecimal;
import java.security.SecureRandom;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.expenseflow.audit.AuditService;
import com.expenseflow.claim.Claim;
import com.expenseflow.claim.ClaimLine;
import com.expenseflow.claim.ClaimLineRepository;
import com.expenseflow.claim.DailyAmount;
import com.expenseflow.claim.PolicyViolation;
import com.expenseflow.common.CurrentUser;
import com.expenseflow.common.NotFoundException;
import com.expenseflow.user.Employee;

/**
 * Builds the {@link PolicyContext} from the database, runs the {@link PolicyEngine} and stores the
 * results on the claim lines. Also the single reader of app_config thresholds.
 */
@Service
public class PolicyService {

    public static final String AUTO_APPROVE_LIMIT = "AUTO_APPROVE_LIMIT";
    public static final String AUDITOR_THRESHOLD = "AUDITOR_THRESHOLD";
    public static final String FINANCE_HEAD_THRESHOLD = "FINANCE_HEAD_THRESHOLD";
    public static final String SAMPLE_AUDIT_PERCENT = "SAMPLE_AUDIT_PERCENT";
    public static final String TIER1_CITIES = "TIER1_CITIES";

    private static final Logger log = LoggerFactory.getLogger(PolicyService.class);

    private final PolicyRuleRepository rules;
    private final AppConfigRepository config;
    private final ClaimLineRepository lines;
    private final AuditService audit;
    private final CurrentUser currentUser;
    private final SecureRandom random = new SecureRandom();

    public PolicyService(PolicyRuleRepository rules, AppConfigRepository config, ClaimLineRepository lines,
                         AuditService audit, CurrentUser currentUser) {
        this.rules = rules;
        this.config = config;
        this.lines = lines;
        this.audit = audit;
        this.currentUser = currentUser;
    }

    /**
     * Runs the policy on a claim being submitted: replaces each line's outcome and violations
     * and returns the claim-level decision. Must run inside the submit transaction.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public ClaimDecision evaluate(Claim claim) {
        List<ClaimLine> claimLines = claim.getLines();
        List<LineInput> inputs = claimLines.stream().map(PolicyService::toInput).toList();
        PolicyContext ctx = contextFor(claim, inputs);

        List<LineResult> results = PolicyEngine.evaluate(inputs, ctx);
        for (int i = 0; i < claimLines.size(); i++) {
            ClaimLine line = claimLines.get(i);
            LineResult result = results.get(i);
            line.getViolations().clear();
            line.setOutcome(result.outcome());
            for (RuleHit hit : result.hits()) {
                line.getViolations().add(new PolicyViolation(line, hit.ruleCode(), hit.outcome(), hit.message()));
            }
        }
        return PolicyEngine.decide(inputs, results, ctx, random.nextInt(100));
    }

    /** Context with the active rules and thresholds only (no prior-claim lookups). Used by the seeder. */
    @Transactional(readOnly = true)
    public PolicyContext baseContext() {
        return buildContext(Set.of(), Set.of(), Map.of());
    }

    public BigDecimal decimalConfig(String key) {
        return new BigDecimal(requiredConfig(key).trim());
    }

    @Transactional(readOnly = true)
    public List<PolicyRuleDto> listRules() {
        return rules.findAllByOrderByCodeAsc().stream().map(PolicyRuleDto::from).toList();
    }

    @Transactional
    public PolicyRuleDto updateRule(Long id, PolicyRuleUpdateRequest request) {
        Employee me = currentUser.get();
        PolicyRule rule = rules.findById(id).orElseThrow(() -> new NotFoundException("Policy rule not found."));
        String before = "limit=" + rule.getLimitAmount() + ", active=" + rule.isActive();
        rule.setLimitAmount(request.limitAmount());
        rule.setActive(request.active());
        String after = "limit=" + rule.getLimitAmount() + ", active=" + rule.isActive();
        audit.log(me, "POLICY_RULE_UPDATE", "POLICY_RULE", rule.getId(), rule.getCode() + ": " + before + " -> " + after);
        log.info("Policy rule {} updated by {}: {} -> {}", rule.getCode(), me.getId(), before, after);
        return PolicyRuleDto.from(rule);
    }

    private PolicyContext contextFor(Claim claim, List<LineInput> inputs) {
        Long claimId = claim.getId();
        Set<String> hashes = inputs.stream().map(LineInput::receiptHash).filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Set<String> priorHashes = hashes.isEmpty()
                ? Set.of()
                : new HashSet<>(lines.findPriorReceiptHashes(hashes, claimId));

        Set<LocalDate> dates = inputs.stream().map(LineInput::expenseDate).collect(Collectors.toSet());
        Set<BigDecimal> amounts = inputs.stream().map(LineInput::amount).collect(Collectors.toSet());
        Set<String> priorKeys = new HashSet<>();
        if (!dates.isEmpty()) {
            for (ClaimLine prior : lines.findPriorLinesForDuplicateCheck(dates, amounts, claimId)) {
                String key = PolicyEngine.expenseKey(prior.getVendor(), prior.getAmount(), prior.getExpenseDate());
                if (key != null) {
                    priorKeys.add(key);
                }
            }
        }

        Map<LocalDate, BigDecimal> mealTotals = new HashMap<>();
        if (!dates.isEmpty()) {
            for (DailyAmount d : lines.findMealTotalsByDate(claim.getEmployee().getId(), dates, claimId)) {
                mealTotals.put(d.date(), d.amount());
            }
        }
        return buildContext(priorHashes, priorKeys, mealTotals);
    }

    private PolicyContext buildContext(Set<String> priorHashes, Set<String> priorKeys,
                                       Map<LocalDate, BigDecimal> mealTotals) {
        Set<String> active = new HashSet<>();
        Map<String, BigDecimal> limits = new HashMap<>();
        for (PolicyRule rule : rules.findByActiveTrue()) {
            active.add(rule.getCode());
            if (rule.getLimitAmount() != null) {
                limits.put(rule.getCode(), rule.getLimitAmount());
            }
        }
        Set<String> tier1 = Arrays.stream(requiredConfig(TIER1_CITIES).split(","))
                .map(s -> s.trim().toLowerCase(Locale.ROOT))
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toSet());
        return new PolicyContext(active, limits, tier1,
                decimalConfig(AUTO_APPROVE_LIMIT),
                Integer.parseInt(requiredConfig(SAMPLE_AUDIT_PERCENT).trim()),
                priorHashes, priorKeys, mealTotals);
    }

    private String requiredConfig(String key) {
        return config.findById(key)
                .map(AppConfig::getValue)
                .orElseThrow(() -> new IllegalStateException("Missing app_config value: " + key));
    }

    private static LineInput toInput(ClaimLine l) {
        return new LineInput(l.getCategory(), l.getExpenseDate(), l.getAmount(), l.getVendor(), l.getCity(),
                l.getNights(), l.getReceiptHash());
    }
}
