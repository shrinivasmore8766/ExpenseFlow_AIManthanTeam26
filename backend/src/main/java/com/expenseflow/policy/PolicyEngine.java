package com.expenseflow.policy;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import com.expenseflow.claim.Category;
import com.expenseflow.claim.ClaimStatus;

/**
 * The expense policy (§4.4). Pure: no Spring, JPA or I/O. Inputs in, results out.
 * All limits come from the {@link PolicyContext}; comparisons are strictly greater than.
 * This is the only place policy rules are implemented.
 */
public final class PolicyEngine {

    public static final String RECEIPT_REQUIRED = "RECEIPT_REQUIRED";
    public static final String DUPLICATE_RECEIPT = "DUPLICATE_RECEIPT";
    public static final String DUPLICATE_EXPENSE = "DUPLICATE_EXPENSE";
    public static final String MEAL_DAILY_LIMIT = "MEAL_DAILY_LIMIT";
    public static final String HOTEL_TIER1_LIMIT = "HOTEL_TIER1_LIMIT";
    public static final String HOTEL_OTHER_LIMIT = "HOTEL_OTHER_LIMIT";
    public static final String CAB_TRIP_LIMIT = "CAB_TRIP_LIMIT";
    public static final String WEEKEND_EXPENSE = "WEEKEND_EXPENSE";
    public static final String NO_LIMIT_CATEGORY = "NO_LIMIT_CATEGORY";

    private PolicyEngine() {
    }

    public static List<LineResult> evaluate(List<LineInput> lines, PolicyContext ctx) {
        Map<LocalDate, BigDecimal> mealTotals = new HashMap<>(ctx.priorMealTotals());
        for (LineInput line : lines) {
            if (line.category() == Category.MEAL) {
                mealTotals.merge(line.expenseDate(), line.amount(), BigDecimal::add);
            }
        }

        Set<String> seenHashes = new HashSet<>();
        Set<String> seenKeys = new HashSet<>();
        List<LineResult> results = new ArrayList<>();
        for (LineInput line : lines) {
            List<RuleHit> hits = new ArrayList<>();
            checkReceipt(line, ctx, hits);
            checkDuplicateReceipt(line, ctx, seenHashes, hits);
            checkDuplicateExpense(line, ctx, seenKeys, hits);
            checkCategoryLimits(line, ctx, mealTotals, hits);
            checkWeekend(line, ctx, hits);
            results.add(new LineResult(mostSevere(hits), List.copyOf(hits)));
        }
        return results;
    }

    /**
     * Claim outcome from line results.
     *
     * @param auditRoll a random number in [0, 100); sample audit when {@code auditRoll < sampleAuditPercent}
     */
    public static ClaimDecision decide(List<LineInput> lines, List<LineResult> results, PolicyContext ctx,
                                       int auditRoll) {
        BigDecimal total = BigDecimal.ZERO;
        BigDecimal approved = BigDecimal.ZERO;
        boolean anyRoute = false;
        boolean allRejected = !lines.isEmpty();
        boolean hasViolations = false;
        Set<String> routedCodes = new LinkedHashSet<>();
        for (int i = 0; i < lines.size(); i++) {
            LineResult r = results.get(i);
            total = total.add(lines.get(i).amount());
            if (r.outcome() != Outcome.AUTO_REJECT) {
                approved = approved.add(lines.get(i).amount());
                allRejected = false;
            }
            if (r.outcome() == Outcome.ROUTE) {
                anyRoute = true;
            }
            hasViolations |= !r.hits().isEmpty();
            r.hits().stream().filter(h -> h.outcome() == Outcome.ROUTE).forEach(h -> routedCodes.add(h.ruleCode()));
        }
        total = money(total);
        approved = money(approved);

        if (allRejected) {
            return new ClaimDecision(ClaimStatus.REJECTED, total, approved, false, false, hasViolations,
                    "Auto-rejected: every line breaks a hard policy rule.");
        }
        boolean overLimit = approved.compareTo(ctx.autoApproveLimit()) > 0;
        if (anyRoute || overLimit) {
            List<String> reasons = new ArrayList<>(routedCodes);
            if (overLimit) {
                reasons.add("amount above auto-approve limit ₹" + plain(ctx.autoApproveLimit()));
            }
            return new ClaimDecision(ClaimStatus.PENDING_MANAGER, total, approved, false, false, hasViolations,
                    "Routed to manager: " + String.join(", ", reasons) + ".");
        }
        if (auditRoll < ctx.sampleAuditPercent()) {
            return new ClaimDecision(ClaimStatus.PENDING_AUDITOR, total, approved, true, true, hasViolations,
                    "Auto-approved within policy; selected for random sample audit.");
        }
        return new ClaimDecision(ClaimStatus.APPROVED, total, approved, true, false, hasViolations,
                "Auto-approved within policy.");
    }

    /** Duplicate-expense key: trimmed lower-case vendor + amount (2 decimals) + date. Null without a vendor. */
    public static String expenseKey(String vendor, BigDecimal amount, LocalDate date) {
        if (vendor == null || vendor.isBlank() || amount == null || date == null) {
            return null;
        }
        return vendor.trim().toLowerCase(Locale.ROOT) + "|" + money(amount).toPlainString() + "|" + date;
    }

    private static void checkReceipt(LineInput line, PolicyContext ctx, List<RuleHit> hits) {
        BigDecimal limit = ctx.activeLimit(RECEIPT_REQUIRED);
        if (limit != null && line.receiptHash() == null && line.amount().compareTo(limit) > 0) {
            hits.add(new RuleHit(RECEIPT_REQUIRED, Outcome.AUTO_REJECT, "Receipt required above ₹" + plain(limit)));
        }
    }

    private static void checkDuplicateReceipt(LineInput line, PolicyContext ctx, Set<String> seenHashes,
                                              List<RuleHit> hits) {
        String hash = line.receiptHash();
        if (hash == null) {
            return;
        }
        boolean earlierInClaim = !seenHashes.add(hash);
        if (ctx.isActive(DUPLICATE_RECEIPT) && (earlierInClaim || ctx.priorReceiptHashes().contains(hash))) {
            hits.add(new RuleHit(DUPLICATE_RECEIPT, Outcome.AUTO_REJECT, "Duplicate receipt file"));
        }
    }

    private static void checkDuplicateExpense(LineInput line, PolicyContext ctx, Set<String> seenKeys,
                                              List<RuleHit> hits) {
        String key = expenseKey(line.vendor(), line.amount(), line.expenseDate());
        if (key == null) {
            return;
        }
        boolean earlierInClaim = !seenKeys.add(key);
        if (ctx.isActive(DUPLICATE_EXPENSE) && (earlierInClaim || ctx.priorExpenseKeys().contains(key))) {
            hits.add(new RuleHit(DUPLICATE_EXPENSE, Outcome.ROUTE, "Possible duplicate expense"));
        }
    }

    private static void checkCategoryLimits(LineInput line, PolicyContext ctx, Map<LocalDate, BigDecimal> mealTotals,
                                            List<RuleHit> hits) {
        switch (line.category()) {
            case MEAL -> {
                BigDecimal limit = ctx.activeLimit(MEAL_DAILY_LIMIT);
                BigDecimal dayTotal = mealTotals.getOrDefault(line.expenseDate(), BigDecimal.ZERO);
                if (limit != null && dayTotal.compareTo(limit) > 0) {
                    hits.add(new RuleHit(MEAL_DAILY_LIMIT, Outcome.ROUTE,
                            "Meals on " + line.expenseDate() + " total ₹" + plain(dayTotal)
                                    + ", above the daily limit of ₹" + plain(limit)));
                }
            }
            case HOTEL -> {
                boolean tier1 = line.city() != null
                        && ctx.tier1Cities().contains(line.city().trim().toLowerCase(Locale.ROOT));
                String code = tier1 ? HOTEL_TIER1_LIMIT : HOTEL_OTHER_LIMIT;
                BigDecimal limit = ctx.activeLimit(code);
                int nights = line.nights() == null || line.nights() < 1 ? 1 : line.nights();
                BigDecimal perNight = line.amount().divide(BigDecimal.valueOf(nights), 2, RoundingMode.HALF_UP);
                if (limit != null && perNight.compareTo(limit) > 0) {
                    hits.add(new RuleHit(code, Outcome.ROUTE,
                            "Hotel ₹" + plain(perNight) + "/night is above the "
                                    + (tier1 ? "tier-1 city" : "non-tier-1 city") + " limit of ₹" + plain(limit)));
                }
            }
            case LOCAL_CAB -> {
                BigDecimal limit = ctx.activeLimit(CAB_TRIP_LIMIT);
                if (limit != null && line.amount().compareTo(limit) > 0) {
                    hits.add(new RuleHit(CAB_TRIP_LIMIT, Outcome.ROUTE,
                            "Cab trip above the limit of ₹" + plain(limit)));
                }
            }
            case TRAVEL, OTHER -> {
                if (ctx.isActive(NO_LIMIT_CATEGORY)) {
                    hits.add(new RuleHit(NO_LIMIT_CATEGORY, Outcome.ROUTE,
                            line.category() + " expenses always need human approval"));
                }
            }
        }
    }

    private static void checkWeekend(LineInput line, PolicyContext ctx, List<RuleHit> hits) {
        DayOfWeek day = line.expenseDate().getDayOfWeek();
        if (ctx.isActive(WEEKEND_EXPENSE) && (day == DayOfWeek.SATURDAY || day == DayOfWeek.SUNDAY)) {
            hits.add(new RuleHit(WEEKEND_EXPENSE, Outcome.ROUTE, "Weekend expense — manager attention"));
        }
    }

    private static Outcome mostSevere(List<RuleHit> hits) {
        Outcome worst = Outcome.AUTO_APPROVE;
        for (RuleHit h : hits) {
            if (h.outcome().ordinal() > worst.ordinal()) {
                worst = h.outcome();
            }
        }
        return worst;
    }

    private static BigDecimal money(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP);
    }

    private static String plain(BigDecimal value) {
        return value.stripTrailingZeros().toPlainString();
    }
}
