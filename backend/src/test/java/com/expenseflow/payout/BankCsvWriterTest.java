package com.expenseflow.payout;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** CSV cell encoding for the mock bank file, including the CSV-injection guard (§4.6). */
class BankCsvWriterTest {

    @ParameterizedTest
    @ValueSource(strings = {"=HYPERLINK(\"x\")", "+91", "-5", "@SUM(A1)"})
    void formulaPrefixesAreNeutralised(String value) {
        assertThat(BankCsvWriter.cell(value)).contains("'" + value.charAt(0));
        assertThat(BankCsvWriter.cell(value).replace("\"", "")).startsWith("'");
    }

    @ParameterizedTest
    @ValueSource(strings = {"\t=cmd", "\r=cmd"})
    void tabAndCarriageReturnPrefixesAreNeutralised(String value) {
        // OWASP CSV-injection guidance: a leading tab or CR can also start a formula in spreadsheet tools.
        assertThat(BankCsvWriter.cell(value).replace("\"", "")).startsWith("'");
    }

    @Test
    void commasAndQuotesAreQuoted() {
        assertThat(BankCsvWriter.cell("Trip, Mumbai")).isEqualTo("\"Trip, Mumbai\"");
        assertThat(BankCsvWriter.cell("The \"big\" trip")).isEqualTo("\"The \"\"big\"\" trip\"");
    }

    @Test
    void plainValuesAndNullsAreUnchanged() {
        assertThat(BankCsvWriter.cell("CLM-000001")).isEqualTo("CLM-000001");
        assertThat(BankCsvWriter.cell("1500.00")).isEqualTo("1500.00");
        assertThat(BankCsvWriter.cell(null)).isEmpty();
    }
}
