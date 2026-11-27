-- Database constraints that JPA annotations cannot express.
-- Tables and columns come from the JPA entities (spring.jpa.hibernate.ddl-auto=update, see CLAUDE.md §2).
-- This script runs AFTER Hibernate on every start (spring.jpa.defer-datasource-initialization=true),
-- so every statement must be idempotent.
-- Statements end with ^; (spring.sql.init.separator) because PL/pgSQL bodies contain ';'.
-- Do not put comments inside statements: the script splitter collapses newlines.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_claim_line_amount_positive') THEN
        ALTER TABLE claim_line ADD CONSTRAINT ck_claim_line_amount_positive CHECK (amount > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_claim_line_nights_positive') THEN
        ALTER TABLE claim_line ADD CONSTRAINT ck_claim_line_nights_positive CHECK (nights IS NULL OR nights >= 1);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_claim_amounts_non_negative') THEN
        ALTER TABLE claim ADD CONSTRAINT ck_claim_amounts_non_negative
            CHECK (total_amount >= 0 AND approved_amount >= 0 AND approved_amount <= total_amount);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_delegation_not_self') THEN
        ALTER TABLE delegation ADD CONSTRAINT ck_delegation_not_self CHECK (delegator_id <> delegate_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_delegation_date_range') THEN
        ALTER TABLE delegation ADD CONSTRAINT ck_delegation_date_range CHECK (end_date >= start_date);
    END IF;
END
$$^;

CREATE OR REPLACE FUNCTION audit_log_block_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END
$$ LANGUAGE plpgsql^;

DROP TRIGGER IF EXISTS trg_audit_log_append_only ON audit_log^;

CREATE TRIGGER trg_audit_log_append_only
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_block_change()^;
