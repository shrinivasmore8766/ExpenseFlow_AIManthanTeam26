package com.expenseflow.payout;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.ZoneOffset;
import java.util.List;

import com.expenseflow.claim.Claim;
import com.expenseflow.user.Employee;

/**
 * Mock bank file (§4.6):
 * <pre>
 * H,EXPENSEFLOW,&lt;batchNumber&gt;,&lt;yyyy-MM-dd&gt;,&lt;count&gt;,&lt;total&gt;
 * D,&lt;claimNumber&gt;,&lt;employeeName&gt;,&lt;bankAccount&gt;,&lt;ifsc&gt;,&lt;amount&gt;,INR,&lt;claimTitle&gt;
 * T,&lt;count&gt;,&lt;total&gt;
 * </pre>
 * Cells starting with = + - @ tab or CR get a ' prefix (CSV-injection guard); cells with commas or quotes are quoted.
 */
public final class BankCsvWriter {

    private BankCsvWriter() {
    }

    public static String write(PayoutBatch batch, List<Claim> claims) {
        StringBuilder sb = new StringBuilder();
        String total = amount(batch.getTotalAmount());
        row(sb, "H", "EXPENSEFLOW", batch.getBatchNumber(),
                batch.getCreatedAt().atOffset(ZoneOffset.UTC).toLocalDate().toString(),
                String.valueOf(batch.getClaimCount()), total);
        for (Claim c : claims) {
            Employee e = c.getEmployee();
            row(sb, "D", c.getClaimNumber(), e.getFullName(), nullToEmpty(e.getBankAccount()),
                    nullToEmpty(e.getIfsc()), amount(c.getApprovedAmount()), "INR", c.getTitle());
        }
        row(sb, "T", String.valueOf(batch.getClaimCount()), total);
        return sb.toString();
    }

    private static void row(StringBuilder sb, String... cells) {
        for (int i = 0; i < cells.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(cell(cells[i]));
        }
        sb.append("\r\n");
    }

    static String cell(String value) {
        String v = value == null ? "" : value;
        // OWASP CSV-injection guidance: a leading tab or carriage return can also start a formula.
        if (!v.isEmpty() && "=+-@\t\r".indexOf(v.charAt(0)) >= 0) {
            v = "'" + v;
        }
        if (v.contains(",") || v.contains("\"") || v.contains("\n") || v.contains("\r")) {
            v = "\"" + v.replace("\"", "\"\"") + "\"";
        }
        return v;
    }

    private static String amount(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }
}
