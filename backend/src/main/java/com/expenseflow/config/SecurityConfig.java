package com.expenseflow.config;

import java.io.IOException;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;

import com.expenseflow.user.EmployeeRepository;
import com.expenseflow.user.Role;
import com.fasterxml.jackson.databind.ObjectMapper;

import jakarta.servlet.http.HttpServletResponse;

/**
 * HTTP Basic, stateless, BCrypt (CLAUDE.md §7, ADR 0004). Role-only URLs follow the API contract (§5);
 * object-level checks (own claims, canAct) live in the services.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private static final String MANAGER = Role.MANAGER.name();
    private static final String AUDITOR = Role.FINANCE_AUDITOR.name();
    private static final String FINANCE_HEAD = Role.FINANCE_HEAD.name();

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http, ObjectMapper objectMapper) throws Exception {
        AuthenticationEntryPoint unauthorized = (request, response, ex) ->
                writeProblem(response, objectMapper, HttpStatus.UNAUTHORIZED, "Authentication required.");
        AccessDeniedHandler forbidden = (request, response, ex) ->
                writeProblem(response, objectMapper, HttpStatus.FORBIDDEN,
                        "You do not have permission to perform this action.");

        http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                // Custom entry point: 401 without WWW-Authenticate, so the browser shows no login popup.
                .httpBasic(basic -> basic.authenticationEntryPoint(unauthorized))
                .exceptionHandling(e -> e.authenticationEntryPoint(unauthorized).accessDeniedHandler(forbidden))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/actuator/health", "/actuator/health/**").permitAll()
                        // Internal-only endpoint, exposed for the demo (CLAUDE.md §7).
                        .requestMatchers("/actuator/prometheus").permitAll()
                        .requestMatchers("/error").permitAll()
                        .requestMatchers("/api/payouts", "/api/payouts/**").hasRole(FINANCE_HEAD)
                        .requestMatchers(HttpMethod.PUT, "/api/policy-rules/**").hasRole(FINANCE_HEAD)
                        .requestMatchers("/api/approvals/bulk-approve").hasAnyRole(AUDITOR, FINANCE_HEAD)
                        .requestMatchers("/api/approvals", "/api/approvals/**").hasAnyRole(MANAGER, AUDITOR, FINANCE_HEAD)
                        .requestMatchers("/api/delegations", "/api/delegations/**").hasAnyRole(MANAGER, AUDITOR, FINANCE_HEAD)
                        .requestMatchers("/api/users").hasAnyRole(MANAGER, AUDITOR, FINANCE_HEAD)
                        .requestMatchers("/api/dashboard").hasAnyRole(MANAGER, AUDITOR, FINANCE_HEAD)
                        .requestMatchers("/api/**").authenticated()
                        .anyRequest().authenticated());
        return http.build();
    }

    /** Loads the employee on every request, so role changes apply immediately. */
    @Bean
    public UserDetailsService userDetailsService(EmployeeRepository employees) {
        return username -> employees.findByUsername(username)
                .map(e -> User.withUsername(e.getUsername())
                        .password(e.getPasswordHash())
                        .roles(e.getRole().name())
                        .build())
                .orElseThrow(() -> new UsernameNotFoundException("Unknown user"));
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    private static void writeProblem(HttpServletResponse response, ObjectMapper objectMapper,
                                     HttpStatus status, String detail) throws IOException {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(status, detail);
        pd.setTitle(status.getReasonPhrase());
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), pd);
    }
}
