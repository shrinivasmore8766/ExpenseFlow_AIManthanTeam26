package com.expenseflow.user;

/** API shape "User". Build inside a transaction (touches lazy department and manager). */
public record UserDto(
        Long id,
        String username,
        String fullName,
        Role role,
        Long departmentId,
        String departmentName,
        String managerName) {

    public static UserDto from(Employee e) {
        Department d = e.getDepartment();
        Employee m = e.getManager();
        return new UserDto(
                e.getId(),
                e.getUsername(),
                e.getFullName(),
                e.getRole(),
                d == null ? null : d.getId(),
                d == null ? null : d.getName(),
                m == null ? null : m.getFullName());
    }
}
