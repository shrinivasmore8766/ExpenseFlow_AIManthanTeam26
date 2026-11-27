package com.expenseflow.claim;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Receipt type detection by magic bytes and safe storage names. */
class ReceiptValidationTest {

    @Test
    void detectsPdfJpegAndPngByMagicBytes() {
        assertThat(ClaimService.detectContentType("%PDF-1.7 body".getBytes(StandardCharsets.US_ASCII)))
                .isEqualTo("application/pdf");
        assertThat(ClaimService.detectContentType(new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 0x00}))
                .isEqualTo("image/jpeg");
        assertThat(ClaimService.detectContentType(new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0}))
                .isEqualTo("image/png");
    }

    @Test
    void rejectsOtherContentEvenWithAnAllowedLookingName() {
        assertThat(ClaimService.detectContentType("<script>alert(1)</script>".getBytes(StandardCharsets.UTF_8))).isNull();
        assertThat(ClaimService.detectContentType("MZ executable".getBytes(StandardCharsets.US_ASCII))).isNull();
        assertThat(ClaimService.detectContentType(new byte[] {(byte) 0x89, 'P', 'N'})).isNull(); // truncated PNG
        assertThat(ClaimService.detectContentType(new byte[0])).isNull();
    }

    @Test
    void storageUsesRandomNamesAndRejectsPathTraversal(@TempDir Path dir) {
        ReceiptStorage storage = new ReceiptStorage(dir.toString());
        String name = storage.store(new byte[] {1, 2, 3});
        assertThat(name).matches("[0-9a-f-]{36}");
        assertThat(storage.read(name)).containsExactly(1, 2, 3);
        assertThatThrownBy(() -> storage.read("../../etc/passwd")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> storage.read("..\\..\\windows\\win.ini")).isInstanceOf(IllegalArgumentException.class);
        storage.delete(name);
        assertThat(storage.read(name)).isNull();
    }
}
