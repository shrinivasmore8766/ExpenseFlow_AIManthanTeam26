package com.expenseflow.user;

public record DepartmentDto(Long id, String name) {

    public static DepartmentDto from(Department d) {
        return new DepartmentDto(d.getId(), d.getName());
    }
}
