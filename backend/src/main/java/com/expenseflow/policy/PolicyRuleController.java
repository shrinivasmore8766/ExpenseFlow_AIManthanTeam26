package com.expenseflow.policy;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/policy-rules")
public class PolicyRuleController {

    private final PolicyService policyService;

    public PolicyRuleController(PolicyService policyService) {
        this.policyService = policyService;
    }

    @GetMapping
    public List<PolicyRuleDto> list() {
        return policyService.listRules();
    }

    /** Finance Head only (SecurityConfig). */
    @PutMapping("/{id}")
    public PolicyRuleDto update(@PathVariable Long id, @Valid @RequestBody PolicyRuleUpdateRequest request) {
        return policyService.updateRule(id, request);
    }
}
