package com.expenseflow.dashboard;

import java.util.List;

/** Response of GET /api/dashboard. Hours are plain numbers (null when there is no data). */
public record DashboardDto(
        List<LabelAmount> spendByCategory,
        List<LabelAmount> spendByDepartment,
        List<LabelAmount> spendByMonth,
        List<LabelCount> violationsByRule,
        Double avgApprovalHours,
        List<LabelCount> pendingByStatus,
        Double oldestPendingHours) {
}
