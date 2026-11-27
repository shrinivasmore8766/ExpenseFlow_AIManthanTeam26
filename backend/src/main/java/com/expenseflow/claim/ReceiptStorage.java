package com.expenseflow.claim;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Receipt files on local disk under {@code app.receipts.dir}. File names are random UUIDs;
 * the client file name is never used in a path.
 */
@Component
public class ReceiptStorage {

    private static final Pattern STORED_NAME = Pattern.compile("^[0-9a-f-]{36}$");

    private final Path dir;

    public ReceiptStorage(@Value("${app.receipts.dir}") String dir) {
        this.dir = Path.of(dir).toAbsolutePath().normalize();
        try {
            Files.createDirectories(this.dir);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot create receipts directory " + this.dir, e);
        }
    }

    /** Stores the bytes and returns the generated file name. */
    public String store(byte[] bytes) {
        String name = UUID.randomUUID().toString();
        try {
            Files.write(resolve(name), bytes);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot store receipt", e);
        }
        return name;
    }

    /** Null when the file does not exist (e.g. seeded claims, which store only a hash). */
    public byte[] read(String name) {
        Path path = resolve(name);
        if (!Files.exists(path)) {
            return null;
        }
        try {
            return Files.readAllBytes(path);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read receipt", e);
        }
    }

    public void delete(String name) {
        if (name == null) {
            return;
        }
        try {
            Files.deleteIfExists(resolve(name));
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot delete receipt", e);
        }
    }

    private Path resolve(String name) {
        if (!STORED_NAME.matcher(name).matches()) {
            throw new IllegalArgumentException("Invalid receipt name");
        }
        return dir.resolve(name);
    }
}
