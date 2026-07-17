BEGIN;

CREATE SCHEMA IF NOT EXISTS product_state;

CREATE TABLE IF NOT EXISTS product_state.schema_migration (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  content_hash text NOT NULL
);

CREATE OR REPLACE FUNCTION product_state.reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TABLE product_state.learning_task (
  id text PRIMARY KEY,
  schema_version text NOT NULL DEFAULT '1.0.0' CHECK (schema_version = '1.0.0'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  goal text NOT NULL CHECK (length(btrim(goal)) > 0),
  material_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(material_refs) = 'array'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at)
);

CREATE TABLE product_state.learning_episode (
  id text PRIMARY KEY,
  schema_version text NOT NULL DEFAULT '1.0.0' CHECK (schema_version = '1.0.0'),
  task_id text NOT NULL REFERENCES product_state.learning_task(id),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'INTERRUPTED')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK ((status = 'ACTIVE' AND completed_at IS NULL) OR (status <> 'ACTIVE' AND completed_at IS NOT NULL))
);

CREATE TABLE product_state.conversation_event (
  id text PRIMARY KEY,
  schema_version text NOT NULL DEFAULT '1.0.0' CHECK (schema_version = '1.0.0'),
  task_id text NOT NULL REFERENCES product_state.learning_task(id),
  episode_id text NOT NULL REFERENCES product_state.learning_episode(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  occurred_at timestamptz NOT NULL,
  actor text NOT NULL CHECK (actor IN ('LEARNER', 'TEACHER', 'FOUNDRY', 'SYSTEM')),
  kind text NOT NULL CHECK (length(btrim(kind)) > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  artifact_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(artifact_refs) = 'array'),
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_refs) = 'array'),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_refs) = 'array'),
  UNIQUE (episode_id, sequence)
);

CREATE INDEX conversation_event_task_order_idx
  ON product_state.conversation_event(task_id, occurred_at, sequence);

CREATE TABLE product_state.learner_attempt (
  id text PRIMARY KEY,
  schema_version text NOT NULL DEFAULT '1.0.0' CHECK (schema_version = '1.0.0'),
  task_id text NOT NULL REFERENCES product_state.learning_task(id),
  episode_id text NOT NULL REFERENCES product_state.learning_episode(id),
  submitted_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('SUBMITTED', 'SUPERSEDED')),
  artifact_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(artifact_refs) = 'array'),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_refs) = 'array'),
  capability jsonb CHECK (capability IS NULL OR jsonb_typeof(capability) = 'object'),
  supersedes_attempt_id text REFERENCES product_state.learner_attempt(id)
);

CREATE INDEX learner_attempt_task_order_idx
  ON product_state.learner_attempt(task_id, submitted_at);

CREATE TABLE product_state.diagnostic_observation (
  id text PRIMARY KEY,
  schema_version text NOT NULL DEFAULT '1.0.0' CHECK (schema_version = '1.0.0'),
  attempt_id text NOT NULL REFERENCES product_state.learner_attempt(id),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
  created_at timestamptz NOT NULL,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_refs) = 'array'),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_refs) = 'array'),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
  diagnosis_payload jsonb NOT NULL CHECK (jsonb_typeof(diagnosis_payload) = 'object')
);

CREATE INDEX diagnostic_observation_attempt_idx
  ON product_state.diagnostic_observation(attempt_id, created_at);

CREATE TABLE product_state.observation_correction (
  id text PRIMARY KEY,
  schema_version text NOT NULL DEFAULT '1.0.0' CHECK (schema_version = '1.0.0'),
  observation_id text NOT NULL REFERENCES product_state.diagnostic_observation(id),
  created_at timestamptz NOT NULL,
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  supersedes_correction_id text REFERENCES product_state.observation_correction(id)
);

CREATE TABLE product_state.teacher_review (
  id text PRIMARY KEY,
  schema_version text NOT NULL DEFAULT '1.0.0' CHECK (schema_version = '1.0.0'),
  observation_id text NOT NULL REFERENCES product_state.diagnostic_observation(id),
  reviewer_id text NOT NULL CHECK (length(btrim(reviewer_id)) > 0),
  reviewed_at timestamptz NOT NULL,
  decision text NOT NULL CHECK (decision IN ('ACCEPT', 'CORRECT', 'ESCALATE')),
  rationale text NOT NULL CHECK (length(btrim(rationale)) > 0),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_refs) = 'array'),
  supersedes_review_id text REFERENCES product_state.teacher_review(id)
);

CREATE INDEX teacher_review_observation_idx
  ON product_state.teacher_review(observation_id, reviewed_at);

CREATE TABLE product_state.retry_attempt (
  id text PRIMARY KEY,
  schema_version text NOT NULL DEFAULT '1.0.0' CHECK (schema_version = '1.0.0'),
  task_id text NOT NULL REFERENCES product_state.learning_task(id),
  episode_id text NOT NULL REFERENCES product_state.learning_episode(id),
  original_attempt_id text NOT NULL REFERENCES product_state.learner_attempt(id),
  review_id text NOT NULL REFERENCES product_state.teacher_review(id),
  attempt_id text UNIQUE REFERENCES product_state.learner_attempt(id),
  status text NOT NULL CHECK (status IN ('PLANNED', 'SUBMITTED', 'COMPLETED', 'CANCELLED')),
  created_at timestamptz NOT NULL
);

CREATE TABLE product_state.learning_outcome (
  id text PRIMARY KEY,
  schema_version text NOT NULL DEFAULT '1.0.0' CHECK (schema_version = '1.0.0'),
  task_id text NOT NULL REFERENCES product_state.learning_task(id),
  episode_id text NOT NULL REFERENCES product_state.learning_episode(id),
  original_attempt_id text NOT NULL REFERENCES product_state.learner_attempt(id),
  retry_attempt_id text NOT NULL UNIQUE REFERENCES product_state.retry_attempt(id),
  recorded_at timestamptz NOT NULL,
  outcome_type text NOT NULL CHECK (outcome_type IN ('RETRY', 'TRANSFER', 'RETENTION')),
  result text NOT NULL CHECK (result IN ('IMPROVED', 'UNCHANGED', 'REGRESSED', 'INCONCLUSIVE')),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_refs) = 'array'),
  recorded_by text NOT NULL CHECK (length(btrim(recorded_by)) > 0)
);

CREATE TABLE product_state.product_state_decision (
  id text PRIMARY KEY,
  schema_version text NOT NULL DEFAULT '1.0.0' CHECK (schema_version = '1.0.0'),
  event_type text NOT NULL,
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) > 0),
  actor_role text NOT NULL CHECK (actor_role IN ('LEARNER', 'TEACHER', 'FOUNDRY', 'SYSTEM')),
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX product_state_decision_aggregate_idx
  ON product_state.product_state_decision(aggregate_type, aggregate_id, occurred_at);

CREATE TABLE product_state.outbox_message (
  id text PRIMARY KEY,
  schema_version text NOT NULL DEFAULT '1.0.0' CHECK (schema_version = '1.0.0'),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  dispatched_at timestamptz
);

CREATE INDEX outbox_message_pending_idx
  ON product_state.outbox_message(occurred_at)
  WHERE dispatched_at IS NULL;

CREATE OR REPLACE FUNCTION product_state.enforce_task_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> NEW.status AND NOT (
    OLD.status = 'ACTIVE' AND NEW.status IN ('COMPLETED', 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'invalid learning_task transition % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION product_state.enforce_episode_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> NEW.status AND NOT (
    OLD.status = 'ACTIVE' AND NEW.status IN ('COMPLETED', 'INTERRUPTED')
  ) THEN
    RAISE EXCEPTION 'invalid learning_episode transition % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION product_state.enforce_retry_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> NEW.status AND NOT (
    (OLD.status = 'PLANNED' AND NEW.status IN ('SUBMITTED', 'CANCELLED')) OR
    (OLD.status = 'SUBMITTED' AND NEW.status IN ('COMPLETED', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'invalid retry_attempt transition % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_task_transition
BEFORE UPDATE ON product_state.learning_task
FOR EACH ROW EXECUTE FUNCTION product_state.enforce_task_transition();

CREATE TRIGGER learning_episode_transition
BEFORE UPDATE ON product_state.learning_episode
FOR EACH ROW EXECUTE FUNCTION product_state.enforce_episode_transition();

CREATE TRIGGER retry_attempt_transition
BEFORE UPDATE ON product_state.retry_attempt
FOR EACH ROW EXECUTE FUNCTION product_state.enforce_retry_transition();

CREATE TRIGGER conversation_event_append_only
BEFORE UPDATE OR DELETE ON product_state.conversation_event
FOR EACH ROW EXECUTE FUNCTION product_state.reject_append_only_mutation();
CREATE TRIGGER diagnostic_observation_append_only
BEFORE UPDATE OR DELETE ON product_state.diagnostic_observation
FOR EACH ROW EXECUTE FUNCTION product_state.reject_append_only_mutation();
CREATE TRIGGER observation_correction_append_only
BEFORE UPDATE OR DELETE ON product_state.observation_correction
FOR EACH ROW EXECUTE FUNCTION product_state.reject_append_only_mutation();
CREATE TRIGGER teacher_review_append_only
BEFORE UPDATE OR DELETE ON product_state.teacher_review
FOR EACH ROW EXECUTE FUNCTION product_state.reject_append_only_mutation();
CREATE TRIGGER learning_outcome_append_only
BEFORE UPDATE OR DELETE ON product_state.learning_outcome
FOR EACH ROW EXECUTE FUNCTION product_state.reject_append_only_mutation();
CREATE TRIGGER product_state_decision_append_only
BEFORE UPDATE OR DELETE ON product_state.product_state_decision
FOR EACH ROW EXECUTE FUNCTION product_state.reject_append_only_mutation();

INSERT INTO product_state.schema_migration(version, content_hash)
VALUES ('0001', '__MIGRATION_CONTENT_HASH__');

COMMIT;
