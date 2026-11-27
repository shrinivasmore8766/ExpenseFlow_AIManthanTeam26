package com.expenseflow.user;

import java.time.Clock;
import java.time.LocalDate;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.expenseflow.audit.AuditService;
import com.expenseflow.common.BadRequestException;
import com.expenseflow.common.CurrentUser;
import com.expenseflow.common.NotFoundException;

@Service
public class DelegationService {

    private static final Logger log = LoggerFactory.getLogger(DelegationService.class);

    private final CurrentUser currentUser;
    private final DelegationRepository delegations;
    private final EmployeeRepository employees;
    private final AuditService audit;
    private final Clock clock;

    public DelegationService(CurrentUser currentUser, DelegationRepository delegations,
                             EmployeeRepository employees, AuditService audit, Clock clock) {
        this.currentUser = currentUser;
        this.delegations = delegations;
        this.employees = employees;
        this.audit = audit;
        this.clock = clock;
    }

    /** Delegations where the caller is the delegator. */
    @Transactional(readOnly = true)
    public List<DelegationDto> mine() {
        Employee me = currentUser.get();
        LocalDate today = LocalDate.now(clock);
        return delegations.findByDelegator(me.getId()).stream()
                .map(d -> DelegationDto.from(d, today))
                .toList();
    }

    @Transactional
    public DelegationDto create(DelegationRequest request) {
        Employee me = currentUser.get();
        if (me.getId().equals(request.delegateId())) {
            throw new BadRequestException("You cannot delegate to yourself.");
        }
        Employee delegate = employees.findById(request.delegateId())
                .orElseThrow(() -> new BadRequestException("Delegate not found."));
        LocalDate today = LocalDate.now(clock);
        if (request.endDate().isBefore(today)) {
            throw new BadRequestException("endDate must not be in the past.");
        }
        Delegation saved = delegations.save(
                new Delegation(me, delegate, request.startDate(), request.endDate()));
        audit.log(me, "DELEGATION_CREATE", "DELEGATION", saved.getId(),
                "delegateId=" + delegate.getId() + ", " + request.startDate() + ".." + request.endDate());
        log.info("Delegation {} created: {} -> {} ({}..{})", saved.getId(), me.getId(), delegate.getId(),
                request.startDate(), request.endDate());
        return DelegationDto.from(saved, today);
    }

    @Transactional
    public void delete(Long id) {
        Employee me = currentUser.get();
        Delegation d = delegations.findById(id)
                .filter(x -> x.getDelegator().getId().equals(me.getId()))
                .orElseThrow(() -> new NotFoundException("Delegation not found."));
        delegations.delete(d);
        audit.log(me, "DELEGATION_DELETE", "DELEGATION", id, "delegateId=" + d.getDelegate().getId());
        log.info("Delegation {} deleted by {}", id, me.getId());
    }
}
