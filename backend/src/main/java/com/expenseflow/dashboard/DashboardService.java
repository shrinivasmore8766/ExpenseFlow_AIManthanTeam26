package com.expenseflow.dashboard;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.expenseflow.claim.ClaimStatus;
import com.expenseflow.common.CurrentUser;
import com.expenseflow.user.Employee;
import com.expenseflow.user.Role;

/**
 * Dashboard figures (§4.7), last 12 months. Finance Head and Auditors see everything; a Manager sees
 * their own department only (a manager without a department, i.e. the CEO, sees everything).
 */
@Service
public class DashboardService {

    private static final Set<ClaimStatus> SPEND = EnumSet.of(ClaimStatus.APPROVED, ClaimStatus.PAID);
    private static final Set<ClaimStatus> PENDING =
            EnumSet.of(ClaimStatus.PENDING_MANAGER, ClaimStatus.PENDING_AUDITOR, ClaimStatus.PENDING_FINANCE_HEAD);

    private final DashboardRepository repo;
    private final CurrentUser currentUser;
    private final Clock clock;

    public DashboardService(DashboardRepository repo, CurrentUser currentUser, Clock clock) {
        this.repo = repo;
        this.currentUser = currentUser;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public DashboardDto dashboard() {
        Employee me = currentUser.get();
        Long deptId = me.getRole() == Role.MANAGER && me.getDepartment() != null ? me.getDepartment().getId() : null;
        boolean all = deptId == null;
        long deptParam = all ? -1L : deptId;
        Instant now = Instant.now(clock);
        Instant since = now.atOffset(ZoneOffset.UTC).minusMonths(12).toInstant();

        List<LabelAmount> byCategory = amounts(repo.spendByCategory(SPEND, since, all, deptParam));
        List<LabelAmount> byDepartment = amounts(repo.spendByDepartment(SPEND, since, all, deptParam));
        List<LabelAmount> byMonth = new ArrayList<>();
        for (Object[] row : repo.spendByMonth(SPEND, since, all, deptParam)) {
            String label = String.format("%04d-%02d", ((Number) row[0]).intValue(), ((Number) row[1]).intValue());
            byMonth.add(new LabelAmount(label, money((BigDecimal) row[2])));
        }
        List<LabelCount> violations = repo.violationsByRule(since, all, deptParam).stream()
                .map(r -> new LabelCount((String) r[0], ((Number) r[1]).longValue()))
                .toList();

        List<Object[]> times = repo.decisionTimes(SPEND, since, all, deptParam);
        Double avgHours = times.isEmpty() ? null : round1(times.stream()
                .mapToLong(r -> Duration.between((Instant) r[0], (Instant) r[1]).toMinutes())
                .average().orElse(0) / 60.0);

        List<LabelCount> pending = new ArrayList<>();
        Instant oldest = null;
        List<Object[]> pendingRows = repo.pendingByStatus(PENDING, all, deptParam);
        for (ClaimStatus status : PENDING) {
            long count = 0;
            for (Object[] row : pendingRows) {
                if (row[0] == status) {
                    count = ((Number) row[1]).longValue();
                    Instant min = (Instant) row[2];
                    if (min != null && (oldest == null || min.isBefore(oldest))) {
                        oldest = min;
                    }
                }
            }
            pending.add(new LabelCount(status.name(), count));
        }
        Double oldestHours = oldest == null ? null : round1(Duration.between(oldest, now).toMinutes() / 60.0);

        return new DashboardDto(byCategory, byDepartment, byMonth, violations, avgHours, pending, oldestHours);
    }

    private static List<LabelAmount> amounts(List<Object[]> rows) {
        return rows.stream()
                .map(r -> new LabelAmount(r[0] == null ? "No department" : r[0].toString(), money((BigDecimal) r[1])))
                .toList();
    }

    private static BigDecimal money(BigDecimal v) {
        return v == null ? BigDecimal.ZERO.setScale(2) : v.setScale(2, RoundingMode.HALF_UP);
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}
