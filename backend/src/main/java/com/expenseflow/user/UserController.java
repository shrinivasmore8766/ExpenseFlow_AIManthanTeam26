package com.expenseflow.user;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    /** Also serves as the "login" check: valid Basic credentials return the user, otherwise 401. */
    @GetMapping("/me")
    public UserDto me() {
        return userService.me();
    }

    @GetMapping("/users")
    public List<UserDto> users(@RequestParam(required = false) Role role) {
        return userService.list(role);
    }

    @GetMapping("/departments")
    public List<DepartmentDto> departments() {
        return userService.departments();
    }
}
