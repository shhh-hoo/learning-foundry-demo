BEGIN;

CREATE TABLE product_state.legacy_import_receipt (
  id text PRIMARY KEY,
  schema_version text NOT NULL DEFAULT '1.0.0' CHECK (schema_version = '1.0.0'),
  source_system text NOT NULL,
  source_key text NOT NULL,
  source_hash text NOT NULL,
  imported_at timestamptz NOT NULL,
  imported_by text NOT NULL,
  task_id text NOT NULL REFERENCES product_state.learning_task(id),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  UNIQUE (source_system, source_key)
);

CREATE TABLE product_state.import_decision (
  id text PRIMARY KEY,
  schema_version text NOT NULL DEFAULT '1.0.0' CHECK (schema_version = '1.0.0'),
  environment text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('IMPORT_COMPLETED', 'NO_IMPORT_REQUIRED')),
  decided_at timestamptz NOT NULL,
  decided_by text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE product_state.cutover_acceptance (
  id text PRIMARY KEY,
  schema_version text NOT NULL DEFAULT '1.0.0' CHECK (schema_version = '1.0.0'),
  environment text NOT NULL,
  mode text NOT NULL CHECK (mode = 'POSTGRES_CANONICAL'),
  accepted_at timestamptz NOT NULL,
  accepted_by text NOT NULL,
  migration_version text NOT NULL,
  database_ready boolean NOT NULL CHECK (database_ready),
  importer_decision_id text NOT NULL REFERENCES product_state.import_decision(id),
  dual_write boolean NOT NULL CHECK (dual_write = false),
  notes text NOT NULL,
  UNIQUE (environment, mode)
);

CREATE TRIGGER legacy_import_receipt_append_only
BEFORE UPDATE OR DELETE ON product_state.legacy_import_receipt
FOR EACH ROW EXECUTE FUNCTION product_state.reject_append_only_mutation();
CREATE TRIGGER import_decision_append_only
BEFORE UPDATE OR DELETE ON product_state.import_decision
FOR EACH ROW EXECUTE FUNCTION product_state.reject_append_only_mutation();
CREATE TRIGGER cutover_acceptance_append_only
BEFORE UPDATE OR DELETE ON product_state.cutover_acceptance
FOR EACH ROW EXECUTE FUNCTION product_state.reject_append_only_mutation();

INSERT INTO product_state.schema_migration(version, content_hash)
VALUES ('0002', '__MIGRATION_CONTENT_HASH__');

COMMIT;
