package com.expenseflow.policy;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.IntStream;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import com.expenseflow.claim.Category;
import com.expenseflow.claim.ClaimStatus;

/**
 * Unit tests for every policy rule (§4.4): below limit, exact boundary, above limit, and missing/invalid input.
 * PolicyEngine is pure, so no Spring context is needed.
 */
class PolicyEngineTest {

    // A Wednesday and a Saturday/Sunday, fixed so results never depend on today's date.
    static final LocalDate WEEKDAY = LocalDate.of(2026, 11, 25);
    static final LocalDate SATURDAY = LocalDate.of(2026, 11, 21);
    static final LocalDate SUNDAY = LocalDate.of(2026, 11, 22);
    static final String HASH_A = "a".repeat(64);
    static final String HASH_B = "b".repeat(64);
    static final int NO_AUDIT = 99; // auditRoll that never triggers a 10% sample audit

    static Map<String, BigDecimal> seededLimits() {
        Map<String, BigDecimal> limits = new HashMap<>();
        limits.put(PolicyEngine.RECEIPT_REQUIRED, bd("500"));
        limits.put(PolicyEngine.MEAL_DAILY_LIMIT, bd("1500"));
        limits.put(PolicyEngine.HOTEL_TIER1_LIMIT, bd("6000"));
        limits.put(PolicyEngine.HOTEL_OTHER_LIMIT, bd("4000"));
        limits.put(PolicyEngine.CAB_TRIP_LIMIT, bd("2000"));
        return limits;
    }

    static final Set<String> ALL_RULES = Set.of(PolicyEngine.RECEIPT_REQUIRED, PolicyEngine.DUPLICATE_RECEIPT,
            PolicyEngine.DUPLICATE_EXPENSE, PolicyEngine.MEAL_DAILY_LIMIT, PolicyEngine.HOTEL_TIER1_LIMIT,
            PolicyEngine.HOTEL_OTHER_LIMIT, PolicyEngine.CAB_TRIP_LIMIT, PolicyEngine.WEEKEND_EXPENSE,
            PolicyEngine.NO_LIMIT_CATEGORY);

    static PolicyContext ctx() {
        return ctx(ALL_RULES, Set.of(), Set.of(), Map.of());
    }

    static PolicyContext ctx(Set<String> active, Set<String> priorHashes, Set<String> priorKeys,
                             Map<LocalDate, BigDecimal> priorMeals) {
        return new PolicyContext(active, seededLimits(),
                Set.of("mumbai", "delhi", "bengaluru", "chennai", "kolkata", "hyderabad", "pune", "ahmedabad"),
                bd("5000"), 10, priorHashes, priorKeys, priorMeals);
    }

    static BigDecimal bd(String v) {
        return new BigDecimal(v);
    }

    static LineInput line(Category c, String amount, LocalDate date, String vendor, String city, Integer nights,
                          String hash) {
        return new LineInput(c, date, bd(amount), vendor, city, nights, hash);
    }

    static LineInput meal(String amount) {
        return line(Category.MEAL, amount, WEEKDAY, "Cafe " + amount, null, null, null);
    }

    static LineResult evalOne(LineInput l) {
        return PolicyEngine.evaluate(List.of(l), ctx()).get(0);
    }

    static List<String> codes(LineResult r) {
        return r.hits().stream().map(RuleHit::ruleCode).toList();
    }

    // ------------------------------------------------------------------ 1. Meals ₹1,500 per day

    @Nested
    class MealDailyLimit {
        @Test
        void belowLimitIsAutoApproved() {
            LineResult r = evalOne(line(Category.MEAL, "1499.99", WEEKDAY, "Cafe", null, null, HASH_A));
            assertThat(r.outcome()).isEqualTo(Outcome.AUTO_APPROVE);
            assertThat(r.hits()).isEmpty();
        }

        @Test
        void exactlyAtLimitIsNotAViolation() {
            // amount > 500 needs a receipt, so attach one to isolate the meal rule
            LineResult r = evalOne(line(Category.MEAL, "1500.00", WEEKDAY, "Cafe", null, null, HASH_A));
            assertThat(codes(r)).doesNotContain(PolicyEngine.MEAL_DAILY_LIMIT);
            assertThat(r.outcome()).isEqualTo(Outcome.AUTO_APPROVE);
        }

        @Test
        void aboveLimitRoutesToManagerWithReason() {
            LineResult r = evalOne(line(Category.MEAL, "1500.01", WEEKDAY, "Cafe", null, null, HASH_A));
            assertThat(r.outcome()).isEqualTo(Outcome.ROUTE);
            assertThat(r.hits()).anySatisfy(h -> {
                assertThat(h.ruleCode()).isEqualTo(PolicyEngine.MEAL_DAILY_LIMIT);
                assertThat(h.message()).contains("daily limit of ₹1500");
            });
        }

        @Test
        void dailyTotalAcrossTwoLinesInSameClaimIsChecked() {
            List<LineResult> r = PolicyEngine.evaluate(List.of(
                    line(Category.MEAL, "800", WEEKDAY, "Lunch place", null, null, HASH_A),
                    line(Category.MEAL, "700.01", WEEKDAY, "Dinner place", null, null, HASH_B)), ctx());
            // 800 + 700.01 = 1500.01 > 1500: every meal line on that day is flagged
            assertThat(codes(r.get(0))).containsExactly(PolicyEngine.MEAL_DAILY_LIMIT);
            assertThat(codes(r.get(1))).containsExactly(PolicyEngine.MEAL_DAILY_LIMIT);
        }

        @Test
        void priorMealsOnOtherClaimsCountTowardsTheDay() {
            PolicyContext c = ctx(ALL_RULES, Set.of(), Set.of(), Map.of(WEEKDAY, bd("1200")));
            LineResult r = PolicyEngine.evaluate(List.of(meal("300.01")), c).get(0);
            assertThat(codes(r)).containsExactly(PolicyEngine.MEAL_DAILY_LIMIT);
        }

        @Test
        void mealsOnDifferentDaysAreNotSummed() {
            List<LineResult> r = PolicyEngine.evaluate(List.of(
                    line(Category.MEAL, "1000", WEEKDAY, "A", null, null, HASH_A),
                    line(Category.MEAL, "1000", WEEKDAY.minusDays(1), "B", null, null, HASH_B)), ctx());
            assertThat(r).allSatisfy(x -> assertThat(codes(x)).doesNotContain(PolicyEngine.MEAL_DAILY_LIMIT));
        }

        @Test
        void inactiveRuleIsSkipped() {
            Set<String> active = new java.util.HashSet<>(ALL_RULES);
            active.remove(PolicyEngine.MEAL_DAILY_LIMIT);
            LineResult r = PolicyEngine.evaluate(List.of(line(Category.MEAL, "9000", WEEKDAY, "X", null, null, HASH_A)),
                    ctx(active, Set.of(), Set.of(), Map.of())).get(0);
            assertThat(codes(r)).doesNotContain(PolicyEngine.MEAL_DAILY_LIMIT);
        }
    }

    // ------------------------------------------------------------------ 2/3. Hotels ₹6,000 tier-1 / ₹4,000 other

    @Nested
    class HotelLimits {
        LineResult hotel(String amount, String city, Integer nights) {
            return evalOne(line(Category.HOTEL, amount, WEEKDAY, "Hotel " + city, city, nights, HASH_A));
        }

        @Test
        void tier1BelowAtAndAboveLimit() {
            assertThat(codes(hotel("5999.99", "Mumbai", 1))).isEmpty();
            assertThat(codes(hotel("6000.00", "Mumbai", 1))).isEmpty();
            LineResult above = hotel("6000.01", "Mumbai", 1);
            assertThat(above.outcome()).isEqualTo(Outcome.ROUTE);
            assertThat(codes(above)).containsExactly(PolicyEngine.HOTEL_TIER1_LIMIT);
            assertThat(above.hits().get(0).message()).contains("tier-1 city limit of ₹6000");
        }

        @Test
        void otherCityBelowAtAndAboveLimit() {
            assertThat(codes(hotel("3999.99", "Nagpur", 1))).isEmpty();
            assertThat(codes(hotel("4000.00", "Nagpur", 1))).isEmpty();
            LineResult above = hotel("4000.01", "Nagpur", 1);
            assertThat(codes(above)).containsExactly(PolicyEngine.HOTEL_OTHER_LIMIT);
            assertThat(above.hits().get(0).message()).contains("non-tier-1 city limit of ₹4000");
        }

        @Test
        void perNightMathUsesNights() {
            assertThat(codes(hotel("18000.00", "Delhi", 3))).isEmpty();                 // 6000/night
            assertThat(codes(hotel("18000.03", "Delhi", 3)))                            // 6000.01/night
                    .containsExactly(PolicyEngine.HOTEL_TIER1_LIMIT);
            assertThat(codes(hotel("12000.00", "Indore", 3))).isEmpty();               // 4000/night
            assertThat(codes(hotel("12001.00", "Indore", 3)))
                    .containsExactly(PolicyEngine.HOTEL_OTHER_LIMIT);
        }

        @Test
        void cityMatchIsCaseAndWhitespaceInsensitive() {
            assertThat(codes(hotel("6000.00", "  mUmBaI ", 1))).isEmpty(); // tier-1 limit applies, not 4000
        }

        @Test
        void missingCityFallsBackToTheStricterNonTier1Limit() {
            assertThat(codes(hotel("4500", null, 1))).containsExactly(PolicyEngine.HOTEL_OTHER_LIMIT);
        }

        @Test
        void missingOrInvalidNightsIsTreatedAsOneNight() {
            assertThat(codes(hotel("6500", "Mumbai", null))).containsExactly(PolicyEngine.HOTEL_TIER1_LIMIT);
            assertThat(codes(hotel("6500", "Mumbai", 0))).containsExactly(PolicyEngine.HOTEL_TIER1_LIMIT);
        }
    }

    // ------------------------------------------------------------------ 4. Local cab ₹2,000 per trip

    @Nested
    class CabTripLimit {
        LineResult cab(String amount) {
            return evalOne(line(Category.LOCAL_CAB, amount, WEEKDAY, "Uber", null, null, HASH_A));
        }

        @Test
        void belowAtAndAboveLimit() {
            assertThat(codes(cab("1999.99"))).isEmpty();
            assertThat(codes(cab("2000.00"))).isEmpty();
            LineResult above = cab("2000.01");
            assertThat(above.outcome()).isEqualTo(Outcome.ROUTE);
            assertThat(codes(above)).containsExactly(PolicyEngine.CAB_TRIP_LIMIT);
            assertThat(above.hits().get(0).message()).isEqualTo("Cab trip above the limit of ₹2000");
        }

        @Test
        void limitIsPerTripNotPerDay() {
            List<LineResult> r = PolicyEngine.evaluate(List.of(
                    line(Category.LOCAL_CAB, "1500", WEEKDAY, "Uber", null, null, HASH_A),
                    line(Category.LOCAL_CAB, "1500", WEEKDAY, "Ola", null, null, HASH_B)), ctx());
            assertThat(r).allSatisfy(x -> assertThat(codes(x)).doesNotContain(PolicyEngine.CAB_TRIP_LIMIT));
        }
    }

    // ------------------------------------------------------------------ 5. Receipt mandatory above ₹500

    @Nested
    class ReceiptRequired {
        @Test
        void belowAndExactlyAtThresholdNeedNoReceipt() {
            assertThat(codes(evalOne(meal("499.99")))).isEmpty();
            assertThat(codes(evalOne(meal("500.00")))).isEmpty();
        }

        @Test
        void aboveThresholdWithoutReceiptIsAutoRejected() {
            LineResult r = evalOne(meal("500.01"));
            assertThat(r.outcome()).isEqualTo(Outcome.AUTO_REJECT);
            assertThat(r.hits()).singleElement().satisfies(h -> {
                assertThat(h.ruleCode()).isEqualTo(PolicyEngine.RECEIPT_REQUIRED);
                assertThat(h.message()).isEqualTo("Receipt required above ₹500");
            });
        }

        @Test
        void aboveThresholdWithReceiptPasses() {
            assertThat(codes(evalOne(line(Category.MEAL, "500.01", WEEKDAY, "Cafe", null, null, HASH_A)))).isEmpty();
        }

        @Test
        void appliesToEveryCategory() {
            for (Category c : Category.values()) {
                LineResult r = evalOne(line(c, "600", WEEKDAY, "V", "Nagpur", 1, null));
                assertThat(codes(r)).as(c.name()).contains(PolicyEngine.RECEIPT_REQUIRED);
                assertThat(r.outcome()).as(c.name()).isEqualTo(Outcome.AUTO_REJECT);
            }
        }
    }

    // ------------------------------------------------------------------ 6. Duplicate vendor + amount + date

    @Nested
    class DuplicateExpense {
        @Test
        void sameVendorAmountDateOnAnEarlierClaimRoutes() {
            String key = PolicyEngine.expenseKey("Taj Hotel", bd("450"), WEEKDAY);
            PolicyContext c = ctx(ALL_RULES, Set.of(), Set.of(key), Map.of());
            LineResult r = PolicyEngine.evaluate(
                    List.of(line(Category.OTHER, "450.00", WEEKDAY, "  TAJ hotel ", null, null, null)), c).get(0);
            assertThat(codes(r)).contains(PolicyEngine.DUPLICATE_EXPENSE);
            assertThat(r.outcome()).isEqualTo(Outcome.ROUTE);
        }

        @Test
        void duplicateWithinTheSameClaimFlagsTheSecondLineOnly() {
            List<LineResult> r = PolicyEngine.evaluate(List.of(meal("300"), meal("300")), ctx());
            assertThat(codes(r.get(0))).doesNotContain(PolicyEngine.DUPLICATE_EXPENSE);
            assertThat(codes(r.get(1))).contains(PolicyEngine.DUPLICATE_EXPENSE);
        }

        @Test
        void differentAmountDateOrVendorIsNotADuplicate() {
            String key = PolicyEngine.expenseKey("Cafe", bd("300"), WEEKDAY);
            PolicyContext c = ctx(ALL_RULES, Set.of(), Set.of(key), Map.of());
            List<LineResult> r = PolicyEngine.evaluate(List.of(
                    line(Category.MEAL, "300.01", WEEKDAY, "Cafe", null, null, null),
                    line(Category.MEAL, "300", WEEKDAY.minusDays(1), "Cafe", null, null, null),
                    line(Category.MEAL, "300", WEEKDAY, "Cafe Two", null, null, null)), c);
            assertThat(r).allSatisfy(x -> assertThat(codes(x)).doesNotContain(PolicyEngine.DUPLICATE_EXPENSE));
        }

        @Test
        void keyNormalisesVendorAndAmountScale() {
            assertThat(PolicyEngine.expenseKey(" Uber ", bd("300"), WEEKDAY))
                    .isEqualTo(PolicyEngine.expenseKey("uber", bd("300.00"), WEEKDAY));
        }

        @Test
        void missingVendorProducesNoKey() {
            assertThat(PolicyEngine.expenseKey("  ", bd("1"), WEEKDAY)).isNull();
            assertThat(PolicyEngine.expenseKey(null, bd("1"), WEEKDAY)).isNull();
        }
    }

    // ------------------------------------------------------------------ 7. Duplicate receipt hash

    @Nested
    class DuplicateReceipt {
        @Test
        void hashUsedOnAnEarlierClaimIsAutoRejected() {
            PolicyContext c = ctx(ALL_RULES, Set.of(HASH_A), Set.of(), Map.of());
            LineResult r = PolicyEngine.evaluate(
                    List.of(line(Category.MEAL, "800", WEEKDAY, "Cafe", null, null, HASH_A)), c).get(0);
            assertThat(r.outcome()).isEqualTo(Outcome.AUTO_REJECT);
            assertThat(r.hits()).anySatisfy(h -> {
                assertThat(h.ruleCode()).isEqualTo(PolicyEngine.DUPLICATE_RECEIPT);
                assertThat(h.message()).isEqualTo("Duplicate receipt file");
            });
        }

        @Test
        void sameFileTwiceInOneClaimRejectsTheSecondLine() {
            List<LineResult> r = PolicyEngine.evaluate(List.of(
                    line(Category.MEAL, "800", WEEKDAY, "A", null, null, HASH_A),
                    line(Category.MEAL, "600", WEEKDAY.minusDays(1), "B", null, null, HASH_A)), ctx());
            assertThat(codes(r.get(0))).doesNotContain(PolicyEngine.DUPLICATE_RECEIPT);
            assertThat(codes(r.get(1))).contains(PolicyEngine.DUPLICATE_RECEIPT);
        }

        @Test
        void newHashAndNoReceiptAreNotDuplicates() {
            PolicyContext c = ctx(ALL_RULES, Set.of(HASH_A), Set.of(), Map.of());
            List<LineResult> r = PolicyEngine.evaluate(List.of(
                    line(Category.MEAL, "800", WEEKDAY, "A", null, null, HASH_B),
                    line(Category.MEAL, "100", WEEKDAY.minusDays(2), "B", null, null, null)), c);
            assertThat(r).allSatisfy(x -> assertThat(codes(x)).doesNotContain(PolicyEngine.DUPLICATE_RECEIPT));
        }
    }

    // ------------------------------------------------------------------ 8. Weekend flag

    @Nested
    class WeekendExpense {
        @Test
        void saturdayAndSundayAreRouted() {
            for (LocalDate d : List.of(SATURDAY, SUNDAY)) {
                LineResult r = evalOne(line(Category.LOCAL_CAB, "300", d, "Uber", null, null, null));
                assertThat(r.outcome()).as(d.getDayOfWeek().name()).isEqualTo(Outcome.ROUTE);
                assertThat(r.hits()).singleElement().satisfies(h -> {
                    assertThat(h.ruleCode()).isEqualTo(PolicyEngine.WEEKEND_EXPENSE);
                    assertThat(h.message()).isEqualTo("Weekend expense — manager attention");
                });
            }
        }

        @Test
        void fridayAndMondayAreNotFlagged() {
            LocalDate friday = SATURDAY.minusDays(1);
            LocalDate monday = SUNDAY.plusDays(1);
            assertThat(friday.getDayOfWeek()).isEqualTo(DayOfWeek.FRIDAY);
            assertThat(codes(evalOne(line(Category.LOCAL_CAB, "300", friday, "Uber", null, null, null)))).isEmpty();
            assertThat(codes(evalOne(line(Category.LOCAL_CAB, "300", monday, "Uber", null, null, null)))).isEmpty();
        }
    }

    // ------------------------------------------------------------------ TRAVEL / OTHER always need a human

    @Test
    void travelAndOtherAreAlwaysRouted() {
        for (Category c : List.of(Category.TRAVEL, Category.OTHER)) {
            LineResult r = evalOne(line(c, "100", WEEKDAY, "V", null, null, null));
            assertThat(codes(r)).as(c.name()).containsExactly(PolicyEngine.NO_LIMIT_CATEGORY);
            assertThat(r.outcome()).isEqualTo(Outcome.ROUTE);
        }
    }

    @Test
    void lineOutcomeIsTheMostSevereHit() {
        // weekend (ROUTE) + no receipt above 500 (AUTO_REJECT) => AUTO_REJECT, both hits recorded
        LineResult r = evalOne(line(Category.LOCAL_CAB, "2500", SATURDAY, "Uber", null, null, null));
        assertThat(r.outcome()).isEqualTo(Outcome.AUTO_REJECT);
        assertThat(codes(r)).containsExactlyInAnyOrder(PolicyEngine.RECEIPT_REQUIRED, PolicyEngine.CAB_TRIP_LIMIT,
                PolicyEngine.WEEKEND_EXPENSE);
    }

    // ------------------------------------------------------------------ claim-level decision and routing

    @Nested
    class ClaimDecisionRouting {
        ClaimDecision decide(List<LineInput> lines, int roll) {
            return PolicyEngine.decide(lines, PolicyEngine.evaluate(lines, ctx()), ctx(), roll);
        }

        @Test
        void cleanClaimAtAutoApproveLimitIsApproved() {
            ClaimDecision d = decide(List.of(line(Category.MEAL, "1500", WEEKDAY, "A", null, null, HASH_A),
                    line(Category.LOCAL_CAB, "2000", WEEKDAY, "B", null, null, HASH_B),
                    line(Category.HOTEL, "1500", WEEKDAY, "C", "Pune", 1, "c".repeat(64))), NO_AUDIT);
            assertThat(d.approvedAmount()).isEqualByComparingTo("5000");
            assertThat(d.status()).isEqualTo(ClaimStatus.APPROVED);
            assertThat(d.autoApproved()).isTrue();
            assertThat(d.sampleAudit()).isFalse();
            assertThat(d.hasViolations()).isFalse();
        }

        @Test
        void cleanClaimJustAboveAutoApproveLimitGoesToManager() {
            ClaimDecision d = decide(List.of(line(Category.HOTEL, "5000.01", WEEKDAY, "C", "Pune", 2, HASH_A)), NO_AUDIT);
            assertThat(d.status()).isEqualTo(ClaimStatus.PENDING_MANAGER);
            assertThat(d.autoApproved()).isFalse();
            assertThat(d.summary()).contains("amount above auto-approve limit ₹5000");
        }

        @Test
        void anyRoutedLineSendsTheClaimToTheManagerWithReasons() {
            ClaimDecision d = decide(List.of(line(Category.LOCAL_CAB, "2100", WEEKDAY, "Uber", null, null, HASH_A)), NO_AUDIT);
            assertThat(d.status()).isEqualTo(ClaimStatus.PENDING_MANAGER);
            assertThat(d.hasViolations()).isTrue();
            assertThat(d.summary()).isEqualTo("Routed to manager: CAB_TRIP_LIMIT.");
        }

        @Test
        void allLinesRejectedRejectsTheClaim() {
            ClaimDecision d = decide(List.of(meal("900"), line(Category.MEAL, "700", WEEKDAY.minusDays(1), "X", null, null, null)), NO_AUDIT);
            assertThat(d.status()).isEqualTo(ClaimStatus.REJECTED);
            assertThat(d.approvedAmount()).isEqualByComparingTo("0");
            assertThat(d.totalAmount()).isEqualByComparingTo("1600");
        }

        @Test
        void rejectedLinesAreExcludedFromTheApprovedAmount() {
            ClaimDecision d = decide(List.of(meal("900"), line(Category.MEAL, "400", WEEKDAY.minusDays(1), "Y", null, null, null)), NO_AUDIT);
            assertThat(d.totalAmount()).isEqualByComparingTo("1300");
            assertThat(d.approvedAmount()).isEqualByComparingTo("400");
            // one clean line remains, within the auto-approve limit
            assertThat(d.status()).isEqualTo(ClaimStatus.APPROVED);
            assertThat(d.hasViolations()).isTrue();
        }
    }

    // ------------------------------------------------------------------ 9. Random 10% sample audit

    @Nested
    class SampleAudit {
        final List<LineInput> clean = List.of(meal("400"));

        ClaimDecision decide(int roll, List<LineInput> lines) {
            return PolicyEngine.decide(lines, PolicyEngine.evaluate(lines, ctx()), ctx(), roll);
        }

        @ParameterizedTest
        @ValueSource(ints = {0, 5, 9})
        void rollsBelowTheConfiguredPercentSelectTheClaim(int roll) {
            ClaimDecision d = decide(roll, clean);
            assertThat(d.status()).isEqualTo(ClaimStatus.PENDING_AUDITOR);
            assertThat(d.sampleAudit()).isTrue();
            assertThat(d.autoApproved()).isTrue();
            assertThat(d.summary()).contains("random sample audit");
        }

        @ParameterizedTest
        @ValueSource(ints = {10, 50, 99})
        void rollsAtOrAboveThePercentAreApproved(int roll) {
            ClaimDecision d = decide(roll, clean);
            assertThat(d.status()).isEqualTo(ClaimStatus.APPROVED);
            assertThat(d.sampleAudit()).isFalse();
        }

        @Test
        void exactlyTenOfTheHundredPossibleRollsSelectAClaim() {
            // The service draws SecureRandom.nextInt(100) (uniform 0..99); 10 of those 100 values select.
            long selected = IntStream.range(0, 100).filter(roll -> decide(roll, clean).sampleAudit()).count();
            assertThat(selected).isEqualTo(10);
        }

        @Test
        void routedOrRejectedClaimsAreNeverSampleAudited() {
            assertThat(decide(0, List.of(line(Category.TRAVEL, "100", WEEKDAY, "V", null, null, null))).sampleAudit()).isFalse();
            assertThat(decide(0, List.of(meal("900"))).sampleAudit()).isFalse();
        }

        @Test
        void percentIsReadFromConfig() {
            PolicyContext zero = new PolicyContext(ALL_RULES, seededLimits(), Set.of(), bd("5000"), 0,
                    Set.of(), Set.of(), Map.of());
            PolicyContext all = new PolicyContext(ALL_RULES, seededLimits(), Set.of(), bd("5000"), 100,
                    Set.of(), Set.of(), Map.of());
            List<LineResult> r = PolicyEngine.evaluate(clean, zero);
            assertThat(PolicyEngine.decide(clean, r, zero, 0).sampleAudit()).isFalse();
            assertThat(PolicyEngine.decide(clean, r, all, 99).sampleAudit()).isTrue();
        }
    }
}
