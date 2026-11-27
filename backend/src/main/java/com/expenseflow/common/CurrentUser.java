package com.expenseflow.common;

import org.springframework.security.authentication.AuthenticationCredentialsNotFoundException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import com.expenseflow.user.Employee;
import com.expenseflow.user.EmployeeRepository;

/** Resolves the logged-in Employee. Call it inside the service transaction so lazy fields load. */
@Component
public class CurrentUser {

    private final EmployeeRepository employees;

    public CurrentUser(EmployeeRepository employees) {
        this.employees = employees;
    }

    public Employee get() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) {
            throw new AuthenticationCredentialsNotFoundException("Not logged in");
        }
        return employees.findByUsername(auth.getName())
                .orElseThrow(() -> new AuthenticationCredentialsNotFoundException("Unknown user"));
    }
}
