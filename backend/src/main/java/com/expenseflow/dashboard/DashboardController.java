package com.expenseflow.dashboard;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** MANAGER (own department), FINANCE_AUDITOR, FINANCE_HEAD (SecurityConfig). */
@RestController
public class DashboardController {

    private final DashboardService dashboardService;

    public DashboardController(DashboardService dashboardService) {
        this.dashboardService = dashboardService;
    }

    @GetMapping("/api/dashboard")
    public DashboardDto dashboard() {
        return dashboardService.dashboard();
    }
}
