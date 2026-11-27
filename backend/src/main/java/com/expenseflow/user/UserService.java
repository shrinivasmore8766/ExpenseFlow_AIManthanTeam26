package com.expenseflow.user;

import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.expenseflow.common.CurrentUser;

@Service
public class UserService {

    private final CurrentUser currentUser;
    private final EmployeeRepository employees;
    private final DepartmentRepository departments;

    public UserService(CurrentUser currentUser, EmployeeRepository employees, DepartmentRepository departments) {
        this.currentUser = currentUser;
        this.employees = employees;
        this.departments = departments;
    }

    @Transactional(readOnly = true)
    public UserDto me() {
        return UserDto.from(currentUser.get());
    }

    /** Delegate picker. Optional role filter. */
    @Transactional(readOnly = true)
    public List<UserDto> list(Role role) {
        return employees.findAllWithDetails().stream()
                .filter(e -> role == null || e.getRole() == role)
                .map(UserDto::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<DepartmentDto> departments() {
        return departments.findAllByOrderByNameAsc().stream().map(DepartmentDto::from).toList();
    }
}
