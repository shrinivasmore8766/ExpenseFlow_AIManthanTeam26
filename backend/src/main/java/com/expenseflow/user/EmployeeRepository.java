package com.expenseflow.user;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface EmployeeRepository extends JpaRepository<Employee, Long> {

    Optional<Employee> findByUsername(String username);

    List<Employee> findByRoleInOrderByFullNameAsc(Collection<Role> roles);

    List<Employee> findAllByOrderByFullNameAsc();

    List<Employee> findByRole(Role role);

    Optional<Employee> findFirstByRoleOrderByIdAsc(Role role);

    /** User list with department and manager loaded in one query (no N+1). */
    @Query("""
            select e from Employee e
            left join fetch e.department
            left join fetch e.manager
            order by e.fullName asc
            """)
    List<Employee> findAllWithDetails();
}
