package com.expenseflow.seed;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Types;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.time.format.TextStyle;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.TreeMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import com.expenseflow.approval.ActionType;
import com.expenseflow.approval.ApprovalRules;
import com.expenseflow.audit.AuditService;
import com.expenseflow.claim.Category;
import com.expenseflow.claim.ClaimService;
import com.expenseflow.claim.ClaimStatus;
import com.expenseflow.payout.PayoutService;
import com.expenseflow.policy.AppConfig;
import com.expenseflow.policy.AppConfigRepository;
import com.expenseflow.policy.ClaimDecision;
import com.expenseflow.policy.LineInput;
import com.expenseflow.policy.LineResult;
import com.expenseflow.policy.PolicyContext;
import com.expenseflow.policy.PolicyEngine;
import com.expenseflow.policy.PolicyRule;
import com.expenseflow.policy.PolicyRuleRepository;
import com.expenseflow.policy.PolicyService;
import com.expenseflow.policy.RuleHit;
import com.expenseflow.user.Department;
import com.expenseflow.user.DepartmentRepository;
import com.expenseflow.user.Employee;
import com.expenseflow.user.EmployeeRepository;
import com.expenseflow.user.Role;

/**
 * Demo data (§4.9). Runs when app.seed.enabled=true and the employee table is empty.
 * Users, departments, rules and config go through JPA; 3,000 historical claims are generated with a
 * fixed Random(42), evaluated by the real PolicyEngine and routed by the real ApprovalRules, then
 * written with JDBC batch inserts using pre-assigned ids (identity columns are BY DEFAULT).
 */
@Component
@ConditionalOnProperty(name = "app.seed.enabled", havingValue = "true")
public class DataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    private static final int TOTAL_USERS = 150;
    private static final int CLAIM_COUNT = 3000;
    /** Claims submitted in the last 3 days stay at their first pending step... */
    private static final int OPEN_WINDOW_DAYS = 3;
    /** ...and so do a few older ones (pending more than 3 days). */
    private static final int STALE_WINDOW_DAYS = 10;
    private static final double STALE_PENDING_SHARE = 0.25;
    /** Extra submissions in the last 3 days, so about 60 claims are still pending. */
    private static final int RECENT_CLAIMS = 75;

    private static final List<String> DEPARTMENTS =
            List.of("Engineering", "Sales", "Marketing", "Finance", "HR", "Operations", "Delivery", "Legal");
    private static final List<String> TIER1 =
            List.of("Mumbai", "Delhi", "Bengaluru", "Chennai", "Kolkata", "Hyderabad", "Pune", "Ahmedabad");
    private static final List<String> OTHER_CITIES =
            List.of("Jaipur", "Lucknow", "Kochi", "Indore", "Coimbatore", "Nagpur", "Chandigarh", "Bhubaneswar");
    private static final List<String> FIRST_NAMES = List.of("Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai",
            "Reyansh", "Krishna", "Ishaan", "Shaurya", "Ananya", "Diya", "Aadhya", "Saanvi", "Pari", "Myra", "Kavya",
            "Riya", "Ira", "Neha", "Rahul", "Karan", "Siddharth", "Nikhil", "Pooja", "Divya", "Lakshmi", "Harish",
            "Deepak", "Suresh", "Anjali", "Tanvi", "Manish", "Gaurav", "Swati", "Farhan", "Zoya", "Imran", "Joseph",
            "Maria");
    private static final List<String> LAST_NAMES = List.of("Sharma", "Verma", "Iyer", "Nair", "Reddy", "Patel",
            "Shah", "Gupta", "Mehta", "Kapoor", "Menon", "Rao", "Das", "Bose", "Khan", "Singh", "Joshi", "Kulkarni",
            "Pillai", "Fernandes", "Chopra", "Banerjee", "Mishra", "Agarwal", "Desai");
    private static final List<String> IFSC = List.of("HDFC0001234", "ICIC0004567", "SBIN0007890", "UTIB0002345",
            "KKBK0000958");
    private static final Map<Category, List<String>> VENDORS = Map.of(
            Category.MEAL, List.of("Barbeque Nation", "Haldiram's", "Saravana Bhavan", "Social", "Cafe Coffee Day",
                    "Swiggy", "Zomato", "Mainland China"),
            Category.HOTEL, List.of("Taj Hotels", "ITC Hotels", "Lemon Tree", "Ginger", "Novotel", "Treebo",
                    "FabHotels", "Marriott"),
            Category.LOCAL_CAB, List.of("Uber", "Ola", "Rapido", "Meru Cabs", "BluSmart"),
            Category.TRAVEL, List.of("IndiGo", "Air India", "Vistara", "IRCTC", "Akasa Air", "SpiceJet"),
            Category.OTHER, List.of("Amazon Business", "Croma", "Staples", "Conference Registrations", "Udemy",
                    "Reliance Digital"));
    private static final List<String> REJECT_COMMENTS = List.of("Not a business expense.",
            "Personal expense, not reimbursable.", "Expense is outside the project budget.");
    private static final List<String> SEND_BACK_COMMENTS = List.of("Please add the client name in the description.",
            "Please attach an itemised bill.", "Which project should this be charged to?");

    private final DepartmentRepository departments;
    private final EmployeeRepository employees;
    private final PolicyRuleRepository rules;
    private final AppConfigRepository config;
    private final PolicyService policy;
    private final AuditService audit;
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;
    private final TransactionTemplate tx;
    private final Clock clock;
    private final String demoPassword;

    public DataSeeder(DepartmentRepository departments, EmployeeRepository employees, PolicyRuleRepository rules,
                      AppConfigRepository config, PolicyService policy, AuditService audit, JdbcTemplate jdbc,
                      PasswordEncoder passwordEncoder, TransactionTemplate tx, Clock clock,
                      @Value("${app.seed.demo-password}") String demoPassword) {
        this.departments = departments;
        this.employees = employees;
        this.rules = rules;
        this.config = config;
        this.policy = policy;
        this.audit = audit;
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        this.tx = tx;
        this.clock = clock;
        this.demoPassword = demoPassword;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (employees.count() > 0) {
            log.info("Seed skipped: employee table is not empty");
            return;
        }
        long start = System.currentTimeMillis();
        tx.executeWithoutResult(status -> seed());
        log.info("Seed finished in {} ms", System.currentTimeMillis() - start);
    }

    private void seed() {
        seedConfig();
        seedRules();
        People people = seedUsers();
        int claims = seedClaims(people, new Random(42));
        audit.log(null, "DATA_SEED", "SYSTEM", null,
                people.all.size() + " employees, " + claims + " claims, " + DEPARTMENTS.size() + " departments");
    }

    // ------------------------------------------------------------------ config and rules

    private void seedConfig() {
        if (config.count() > 0) {
            return;
        }
        config.saveAll(List.of(
                new AppConfig(PolicyService.AUTO_APPROVE_LIMIT, "5000"),
                new AppConfig(PolicyService.AUDITOR_THRESHOLD, "25000"),
                new AppConfig(PolicyService.FINANCE_HEAD_THRESHOLD, "100000"),
                new AppConfig(PolicyService.SAMPLE_AUDIT_PERCENT, "10"),
                new AppConfig(PolicyService.TIER1_CITIES, String.join(",", TIER1))));
    }

    private void seedRules() {
        if (rules.count() > 0) {
            return;
        }
        rules.saveAll(List.of(
                new PolicyRule(PolicyEngine.RECEIPT_REQUIRED, null, new BigDecimal("500.00"),
                        "Lines above this amount need a receipt, otherwise they are auto-rejected"),
                new PolicyRule(PolicyEngine.DUPLICATE_RECEIPT, null, null,
                        "The same receipt file was already claimed: auto-reject"),
                new PolicyRule(PolicyEngine.DUPLICATE_EXPENSE, null, null,
                        "Same vendor, amount and date as an earlier line: route to manager"),
                new PolicyRule(PolicyEngine.MEAL_DAILY_LIMIT, Category.MEAL, new BigDecimal("1500.00"),
                        "Daily meal total per employee"),
                new PolicyRule(PolicyEngine.HOTEL_TIER1_LIMIT, Category.HOTEL, new BigDecimal("6000.00"),
                        "Hotel per night in tier-1 cities"),
                new PolicyRule(PolicyEngine.HOTEL_OTHER_LIMIT, Category.HOTEL, new BigDecimal("4000.00"),
                        "Hotel per night in other cities"),
                new PolicyRule(PolicyEngine.CAB_TRIP_LIMIT, Category.LOCAL_CAB, new BigDecimal("2000.00"),
                        "Per local cab trip"),
                new PolicyRule(PolicyEngine.WEEKEND_EXPENSE, null, null,
                        "Expenses dated Saturday or Sunday need manager attention"),
                new PolicyRule(PolicyEngine.NO_LIMIT_CATEGORY, null, null,
                        "TRAVEL and OTHER always need human approval")));
    }

    // ------------------------------------------------------------------ users

    /** The seeded organisation. */
    private static final class People {
        final List<Employee> all = new ArrayList<>();
        final List<Employee> employeesOnly = new ArrayList<>();
        final List<Employee> managers = new ArrayList<>();
        final List<Employee> auditors = new ArrayList<>();
        Employee financeHead;
    }

    private People seedUsers() {
        Random rng = new Random(7);
        Map<String, Department> depts = new LinkedHashMap<>();
        for (String name : DEPARTMENTS) {
            depts.put(name, departments.save(new Department(name)));
        }
        String hash = passwordEncoder.encode(demoPassword);
        Set<String> usernames = new HashSet<>();
        People p = new People();

        Employee ceo = user(p, usernames, rng, hash, "ceo", "Rajesh Iyer", Role.MANAGER, null, null);
        Employee fh = user(p, usernames, rng, hash, "financehead", "Priya Sharma", Role.FINANCE_HEAD,
                depts.get("Finance"), ceo);
        p.financeHead = fh;
        p.auditors.add(user(p, usernames, rng, hash, "auditor", "Anil Kumar", Role.FINANCE_AUDITOR,
                depts.get("Finance"), fh));
        p.auditors.add(user(p, usernames, rng, hash, "auditor2", "Meera Nair", Role.FINANCE_AUDITOR,
                depts.get("Finance"), fh));
        Employee manager = user(p, usernames, rng, hash, "manager", "Vikram Rao", Role.MANAGER,
                depts.get("Engineering"), ceo);
        user(p, usernames, rng, hash, "employee", "Rohan Gupta", Role.EMPLOYEE, depts.get("Engineering"), manager);
        user(p, usernames, rng, hash, "employee2", "Sneha Patel", Role.EMPLOYEE, depts.get("Engineering"), manager);

        Map<Department, List<Employee>> managersByDept = new LinkedHashMap<>();
        for (Department d : depts.values()) {
            Employee head = d.getName().equals("Finance")
                    ? fh
                    : generated(p, usernames, rng, hash, Role.MANAGER, d, ceo);
            List<Employee> deptManagers = new ArrayList<>();
            if (d.getName().equals("Engineering")) {
                deptManagers.add(manager);
            }
            while (deptManagers.size() < 2) {
                deptManagers.add(generated(p, usernames, rng, hash, Role.MANAGER, d, head));
            }
            managersByDept.put(d, deptManagers);
        }
        List<Department> deptList = new ArrayList<>(depts.values());
        for (int i = 0; p.all.size() < TOTAL_USERS; i++) {
            Department d = deptList.get(i % deptList.size());
            List<Employee> ms = managersByDept.get(d);
            generated(p, usernames, rng, hash, Role.EMPLOYEE, d, ms.get(rng.nextInt(ms.size())));
        }
        employees.flush();
        log.info("Seeded {} employees in {} departments", p.all.size(), depts.size());
        return p;
    }

    private Employee generated(People p, Set<String> usernames, Random rng, String hash, Role role, Department d,
                               Employee manager) {
        String first = FIRST_NAMES.get(rng.nextInt(FIRST_NAMES.size()));
        String last = LAST_NAMES.get(rng.nextInt(LAST_NAMES.size()));
        String base = (first + "." + last).toLowerCase(Locale.ROOT);
        String username = base;
        for (int n = 2; usernames.contains(username); n++) {
            username = base + n;
        }
        return user(p, usernames, rng, hash, username, first + " " + last, role, d, manager);
    }

    private Employee user(People p, Set<String> usernames, Random rng, String hash, String username, String fullName,
                          Role role, Department d, Employee manager) {
        Employee e = new Employee(username, fullName, hash, role);
        e.setEmail(username + "@expenseflow.example");
        e.setDepartment(d);
        e.setManager(manager);
        e.setBankAccount(String.format("%04d%08d", 1000 + rng.nextInt(9000), rng.nextInt(100_000_000)));
        e.setIfsc(IFSC.get(rng.nextInt(IFSC.size())));
        e = employees.save(e);
        usernames.add(username);
        p.all.add(e);
        switch (role) {
            case EMPLOYEE -> p.employeesOnly.add(e);
            case MANAGER -> p.managers.add(e);
            default -> {
                // auditors and the finance head are tracked separately
            }
        }
        return e;
    }

    // ------------------------------------------------------------------ claims

    /** A generated claim before it is written. */
    private static final class SeedClaim {
        long id;
        Employee employee;
        String title;
        ClaimStatus status;
        BigDecimal total;
        BigDecimal approved;
        Long currentApproverId;
        boolean sampleAudit;
        boolean autoApproved;
        boolean hasViolations;
        Instant createdAt;
        Instant submittedAt;
        Instant decidedAt;
        Instant paidAt;
        Long payoutBatchId;
    }

    private int seedClaims(People people, Random rng) {
        Instant now = clock.instant();
        PolicyContext base = policy.baseContext();
        BigDecimal auditorThreshold = policy.decimalConfig(PolicyService.AUDITOR_THRESHOLD);
        BigDecimal fhThreshold = policy.decimalConfig(PolicyService.FINANCE_HEAD_THRESHOLD);

        List<Instant> times = new ArrayList<>();
        for (int i = 0; i < CLAIM_COUNT; i++) {
            int spanDays = i < RECENT_CLAIMS ? OPEN_WINDOW_DAYS : 365;
            long secondsAgo = 3600 + (long) (rng.nextDouble() * spanDays * 24 * 3600);
            times.add(now.minusSeconds(secondsAgo));
        }
        times.sort(null);

        Set<String> priorHashes = new HashSet<>();
        List<String> hashList = new ArrayList<>();
        Set<String> priorKeys = new HashSet<>();
        List<LineInput> priorLines = new ArrayList<>();
        Map<Long, Map<LocalDate, BigDecimal>> mealTotals = new HashMap<>();

        List<SeedClaim> claims = new ArrayList<>();
        List<Object[]> lineRows = new ArrayList<>();
        List<Object[]> violationRows = new ArrayList<>();
        List<Object[]> actionRows = new ArrayList<>();
        long lineId = 0;
        long violationId = 0;
        long[] actionId = {0};

        for (int i = 0; i < CLAIM_COUNT; i++) {
            SeedClaim c = new SeedClaim();
            c.id = i + 1;
            c.submittedAt = times.get(i);
            c.createdAt = c.submittedAt.minus(Duration.ofMinutes(10 + rng.nextInt(600)));
            c.employee = rng.nextDouble() < 0.85
                    ? people.employeesOnly.get(rng.nextInt(people.employeesOnly.size()))
                    : people.managers.get(rng.nextInt(people.managers.size()));
            LocalDate submittedDate = c.submittedAt.atOffset(ZoneOffset.UTC).toLocalDate();

            int lineCount = pickLineCount(rng);
            List<LineInput> lines = new ArrayList<>();
            List<String> descriptions = new ArrayList<>();
            for (int j = 0; j < lineCount; j++) {
                LineInput line = randomLine(rng, submittedDate, hashList, priorLines);
                lines.add(line);
                descriptions.add(description(line));
            }
            c.title = title(lines.get(0), submittedDate);

            PolicyContext ctx = new PolicyContext(base.activeRuleCodes(), base.limits(), base.tier1Cities(),
                    base.autoApproveLimit(), base.sampleAuditPercent(), priorHashes, priorKeys,
                    mealTotals.getOrDefault(c.employee.getId(), Map.of()));
            List<LineResult> results = PolicyEngine.evaluate(lines, ctx);
            ClaimDecision decision = PolicyEngine.decide(lines, results, ctx, rng.nextInt(100));

            for (int j = 0; j < lineCount; j++) {
                LineInput l = lines.get(j);
                LineResult r = results.get(j);
                lineId++;
                lineRows.add(new Object[] {lineId, c.id, l.category().name(), l.expenseDate(), l.amount(), l.vendor(),
                        l.city(), l.nights(), descriptions.get(j), null, l.receiptHash(), null, r.outcome().name()});
                for (RuleHit hit : r.hits()) {
                    violationId++;
                    violationRows.add(new Object[] {violationId, c.id, lineId, hit.ruleCode(), hit.outcome().name(),
                            hit.message()});
                }
            }
            // Everything submitted becomes "prior" for later claims.
            for (LineInput l : lines) {
                if (l.receiptHash() != null && priorHashes.add(l.receiptHash())) {
                    hashList.add(l.receiptHash());
                }
                String key = PolicyEngine.expenseKey(l.vendor(), l.amount(), l.expenseDate());
                if (key != null) {
                    priorKeys.add(key);
                }
                priorLines.add(l);
            }

            simulateWorkflow(c, decision, people, rng, now, auditorThreshold, fhThreshold, actionRows, actionId);

            if (c.status != ClaimStatus.REJECTED) {
                Map<LocalDate, BigDecimal> meals = mealTotals.computeIfAbsent(c.employee.getId(), k -> new HashMap<>());
                for (LineInput l : lines) {
                    if (l.category() == Category.MEAL) {
                        meals.merge(l.expenseDate(), l.amount(), BigDecimal::add);
                    }
                }
            }
            claims.add(c);
        }

        List<Object[]> batchRows = createPayouts(claims, people.financeHead, now, actionRows, actionId);
        writeAll(batchRows, claims, lineRows, violationRows, actionRows);
        logSummary(claims);
        return claims.size();
    }

    private void simulateWorkflow(SeedClaim c, ClaimDecision d, People people, Random rng, Instant now,
                                  BigDecimal auditorThreshold, BigDecimal fhThreshold,
                                  List<Object[]> actionRows, long[] actionId) {
        c.status = d.status();
        c.total = d.totalAmount();
        c.approved = d.approvedAmount();
        c.autoApproved = d.autoApproved();
        c.sampleAudit = d.sampleAudit();
        c.hasViolations = d.hasViolations();
        Employee manager = c.employee.getManager() != null ? c.employee.getManager() : people.financeHead;
        c.currentApproverId = c.status == ClaimStatus.PENDING_MANAGER ? manager.getId() : null;
        Instant t = c.submittedAt;
        if (ApprovalRules.isFinal(c.status)) {
            c.decidedAt = t;
        }
        action(actionRows, actionId, c.id, c.employee.getId(), ActionType.SUBMIT, ClaimStatus.DRAFT, c.status, null, t);
        action(actionRows, actionId, c.id, null, ActionType.POLICY_DECISION, c.status, c.status, d.summary(), t);

        boolean open = c.submittedAt.isAfter(now.minus(Duration.ofDays(OPEN_WINDOW_DAYS)))
                || (c.submittedAt.isAfter(now.minus(Duration.ofDays(STALE_WINDOW_DAYS)))
                && rng.nextDouble() < STALE_PENDING_SHARE);
        while (c.status.isPending() && !open) {
            Instant next = t.plus(Duration.ofMinutes(60L + rng.nextInt(60 * 60)));
            if (next.isAfter(now.minus(Duration.ofHours(1)))) {
                break; // would be in the future: leave it pending
            }
            t = next;
            Employee actor = switch (c.status) {
                case PENDING_MANAGER -> manager;
                case PENDING_AUDITOR -> people.auditors.get(rng.nextInt(people.auditors.size()));
                default -> people.financeHead;
            };
            double roll = rng.nextDouble();
            boolean managerStep = c.status == ClaimStatus.PENDING_MANAGER;
            double approveBelow = managerStep ? 0.90 : 0.95;
            double rejectBelow = managerStep ? 0.97 : 0.99;
            ClaimStatus from = c.status;
            if (roll < approveBelow) {
                c.status = ApprovalRules.statusAfterApprove(from, c.approved, c.sampleAudit, auditorThreshold,
                        fhThreshold);
                action(actionRows, actionId, c.id, actor.getId(), ActionType.APPROVE, from, c.status, null, t);
            } else if (roll < rejectBelow) {
                c.status = ClaimStatus.REJECTED;
                action(actionRows, actionId, c.id, actor.getId(), ActionType.REJECT, from, c.status,
                        REJECT_COMMENTS.get(rng.nextInt(REJECT_COMMENTS.size())), t);
            } else {
                c.status = ClaimStatus.CLARIFICATION_REQUESTED;
                action(actionRows, actionId, c.id, actor.getId(), ActionType.SEND_BACK, from, c.status,
                        SEND_BACK_COMMENTS.get(rng.nextInt(SEND_BACK_COMMENTS.size())), t);
            }
            c.currentApproverId = null;
            if (ApprovalRules.isFinal(c.status)) {
                c.decidedAt = t;
            }
        }
    }

    /** Monthly payout batches for claims approved in earlier months; the current month stays eligible. */
    private List<Object[]> createPayouts(List<SeedClaim> claims, Employee financeHead, Instant now,
                                         List<Object[]> actionRows, long[] actionId) {
        Map<YearMonth, List<SeedClaim>> byMonth = new TreeMap<>();
        for (SeedClaim c : claims) {
            if (c.status == ClaimStatus.APPROVED && c.decidedAt != null) {
                byMonth.computeIfAbsent(YearMonth.from(c.decidedAt.atOffset(ZoneOffset.UTC)), k -> new ArrayList<>())
                        .add(c);
            }
        }
        List<Object[]> rows = new ArrayList<>();
        long batchId = 0;
        for (Map.Entry<YearMonth, List<SeedClaim>> e : byMonth.entrySet()) {
            Instant created = e.getKey().plusMonths(1).atDay(3).atTime(10, 0).toInstant(ZoneOffset.UTC);
            if (created.isAfter(now.minus(Duration.ofDays(1)))) {
                continue; // not batched yet: these remain eligible for the live demo
            }
            Instant paid = created.plus(Duration.ofDays(1));
            boolean isPaid = paid.isBefore(now);
            batchId++;
            BigDecimal total = BigDecimal.ZERO;
            for (SeedClaim c : e.getValue()) {
                c.payoutBatchId = batchId;
                total = total.add(c.approved);
                if (isPaid) {
                    c.status = ClaimStatus.PAID;
                    c.paidAt = paid;
                    action(actionRows, actionId, c.id, financeHead.getId(), ActionType.PAID, ClaimStatus.APPROVED,
                            ClaimStatus.PAID, "Paid in batch " + PayoutService.batchNumber(batchId), paid);
                }
            }
            rows.add(new Object[] {batchId, PayoutService.batchNumber(batchId), financeHead.getId(), ts(created),
                    e.getValue().size(), total.setScale(2, RoundingMode.HALF_UP), isPaid ? "PAID" : "EXPORTED",
                    isPaid ? ts(paid) : null, 0L});
        }
        return rows;
    }

    private void writeAll(List<Object[]> batchRows, List<SeedClaim> claims, List<Object[]> lineRows,
                          List<Object[]> violationRows, List<Object[]> actionRows) {
        final int big = Types.BIGINT;
        final int str = Types.VARCHAR;
        final int num = Types.NUMERIC;
        final int tsz = Types.TIMESTAMP_WITH_TIMEZONE;
        final int bool = Types.BOOLEAN;

        jdbc.batchUpdate("insert into payout_batch (id, batch_number, created_by, created_at, claim_count, "
                        + "total_amount, status, paid_at, version) values (?,?,?,?,?,?,?,?,?)",
                batchRows, new int[] {big, str, big, tsz, Types.INTEGER, num, str, tsz, big});

        List<Object[]> claimRows = new ArrayList<>();
        for (SeedClaim c : claims) {
            claimRows.add(new Object[] {c.id, ClaimService.claimNumber(c.id), c.employee.getId(),
                    c.employee.getDepartment() == null ? null : c.employee.getDepartment().getId(), c.title,
                    c.status.name(), c.total, c.approved, c.currentApproverId, c.sampleAudit, c.autoApproved,
                    c.hasViolations, ts(c.submittedAt), ts(c.decidedAt), ts(c.paidAt), c.payoutBatchId, 0L,
                    ts(c.createdAt)});
        }
        jdbc.batchUpdate("insert into claim (id, claim_number, employee_id, department_id, title, status, "
                        + "total_amount, approved_amount, current_approver_id, sample_audit, auto_approved, "
                        + "has_violations, submitted_at, decided_at, paid_at, payout_batch_id, version, created_at) "
                        + "values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                claimRows, new int[] {big, str, big, big, str, str, num, num, big, bool, bool, bool, tsz, tsz, tsz,
                        big, big, tsz});

        jdbc.batchUpdate("insert into claim_line (id, claim_id, category, expense_date, amount, vendor, city, "
                        + "nights, description, receipt_path, receipt_hash, receipt_content_type, outcome) "
                        + "values (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                lineRows, new int[] {big, big, str, Types.DATE, num, str, str, Types.INTEGER, str, str, str, str,
                        str});

        jdbc.batchUpdate("insert into policy_violation (id, claim_id, line_id, rule_code, outcome, message) "
                + "values (?,?,?,?,?,?)", violationRows, new int[] {big, big, big, str, str, str});

        jdbc.batchUpdate("insert into approval_action (id, claim_id, actor_id, on_behalf_of_id, action, "
                        + "from_status, to_status, comment, created_at) values (?,?,?,?,?,?,?,?,?)",
                actionRows, new int[] {big, big, big, big, str, str, str, str, tsz});

        // Move the identity sequences past the pre-assigned ids (table names are constants).
        for (String table : List.of("payout_batch", "claim", "claim_line", "policy_violation", "approval_action")) {
            jdbc.queryForObject("select setval(pg_get_serial_sequence('" + table + "', 'id'), "
                    + "coalesce((select max(id) from " + table + "), 0) + 1, false)", Long.class);
        }
    }

    private void logSummary(List<SeedClaim> claims) {
        Map<ClaimStatus, Integer> byStatus = new TreeMap<>();
        claims.forEach(c -> byStatus.merge(c.status, 1, Integer::sum));
        log.info("Seeded {} claims: {}", claims.size(), byStatus);
    }

    // ------------------------------------------------------------------ random content

    private static int pickLineCount(Random rng) {
        double r = rng.nextDouble();
        return r < 0.30 ? 1 : r < 0.65 ? 2 : r < 0.90 ? 3 : 4;
    }

    private static LineInput randomLine(Random rng, LocalDate submittedDate, List<String> hashes,
                                        List<LineInput> priorLines) {
        // ~1.5% copy an earlier line's vendor/amount/date: DUPLICATE_EXPENSE.
        if (!priorLines.isEmpty() && rng.nextDouble() < 0.015) {
            LineInput p = priorLines.get(rng.nextInt(priorLines.size()));
            return new LineInput(p.category(), p.expenseDate(), p.amount(), p.vendor(), p.city(), p.nights(),
                    newHash(rng));
        }
        Category category = pickCategory(rng);
        LocalDate date = submittedDate.minusDays(rng.nextInt(10));
        DayOfWeek dow = date.getDayOfWeek();
        if ((dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY) && rng.nextDouble() < 0.8) {
            date = date.with(TemporalAdjusters.previous(DayOfWeek.FRIDAY));
        }
        boolean breach = rng.nextDouble() < 0.05;
        String city = null;
        Integer nights = null;
        BigDecimal amount;
        switch (category) {
            case MEAL -> amount = rupees(rng, breach ? 1600 : 150, breach ? 2600 : 1200);
            case LOCAL_CAB -> amount = rupees(rng, breach ? 2100 : 120, breach ? 3800 : 1500);
            case HOTEL -> {
                boolean tier1 = rng.nextDouble() < 0.7;
                city = tier1 ? TIER1.get(rng.nextInt(TIER1.size())) : OTHER_CITIES.get(rng.nextInt(OTHER_CITIES.size()));
                nights = 1 + rng.nextInt(3);
                int limit = tier1 ? 6000 : 4000;
                BigDecimal perNight = breach
                        ? rupees(rng, limit + 200, limit + 2500)
                        : rupees(rng, tier1 ? 3000 : 2000, limit - 200);
                amount = perNight.multiply(BigDecimal.valueOf(nights));
            }
            case TRAVEL -> amount = rng.nextDouble() < 0.04 ? rupees(rng, 26000, 60000) : rupees(rng, 1200, 15000);
            default -> amount = rng.nextDouble() < 0.015 ? rupees(rng, 30000, 130000) : rupees(rng, 300, 4500);
        }
        if (city == null && category != Category.OTHER) {
            city = rng.nextDouble() < 0.6 ? TIER1.get(rng.nextInt(TIER1.size()))
                    : OTHER_CITIES.get(rng.nextInt(OTHER_CITIES.size()));
        }
        List<String> vendors = VENDORS.get(category);
        String vendor = vendors.get(rng.nextInt(vendors.size()));

        String hash;
        if (amount.compareTo(new BigDecimal("500")) <= 0 && rng.nextDouble() < 0.5) {
            hash = null; // small amounts often have no receipt, which is allowed
        } else if (rng.nextDouble() < 0.02) {
            hash = null; // missing receipt above 500: RECEIPT_REQUIRED
        } else if (!hashes.isEmpty() && rng.nextDouble() < 0.015) {
            hash = hashes.get(rng.nextInt(hashes.size())); // re-used receipt: DUPLICATE_RECEIPT
        } else {
            hash = newHash(rng);
        }
        return new LineInput(category, date, amount, vendor, city, nights, hash);
    }

    private static Category pickCategory(Random rng) {
        double r = rng.nextDouble();
        return r < 0.36 ? Category.MEAL
                : r < 0.62 ? Category.LOCAL_CAB
                : r < 0.80 ? Category.HOTEL
                : r < 0.92 ? Category.TRAVEL
                : Category.OTHER;
    }

    private static BigDecimal rupees(Random rng, int min, int max) {
        return BigDecimal.valueOf(min + rng.nextInt(max - min + 1)).setScale(2, RoundingMode.HALF_UP);
    }

    private static String newHash(Random rng) {
        return String.format("%016x%016x%016x%016x", rng.nextLong(), rng.nextLong(), rng.nextLong(), rng.nextLong());
    }

    private static String title(LineInput first, LocalDate date) {
        String month = date.getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH) + " " + date.getYear();
        String where = first.city() == null ? "" : " - " + first.city();
        return switch (first.category()) {
            case MEAL -> "Client meetings" + where + " (" + month + ")";
            case HOTEL, TRAVEL -> "Business trip" + where + " (" + month + ")";
            case LOCAL_CAB -> "Local conveyance" + where + " (" + month + ")";
            case OTHER -> "Office and training expenses (" + month + ")";
        };
    }

    private static String description(LineInput l) {
        return switch (l.category()) {
            case MEAL -> "Meal at " + l.vendor();
            case HOTEL -> l.nights() + " night(s) at " + l.vendor() + ", " + l.city();
            case LOCAL_CAB -> "Cab ride (" + l.vendor() + ")";
            case TRAVEL -> "Ticket booked with " + l.vendor();
            case OTHER -> "Purchase from " + l.vendor();
        };
    }

    private static void action(List<Object[]> rows, long[] id, long claimId, Long actorId, ActionType action,
                               ClaimStatus from, ClaimStatus to, String comment, Instant at) {
        id[0]++;
        rows.add(new Object[] {id[0], claimId, actorId, null, action.name(), from == null ? null : from.name(),
                to.name(), comment, ts(at)});
    }

    private static OffsetDateTime ts(Instant i) {
        return i == null ? null : i.atOffset(ZoneOffset.UTC);
    }
}
