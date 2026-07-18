BEGIN;

ALTER TABLE product_state.import_decision
  DROP CONSTRAINT import_decision_schema_version_check;
ALTER TABLE product_state.import_decision
  ALTER COLUMN schema_version SET DEFAULT '1.1.0';
ALTER TABLE product_state.import_decision
  ADD CONSTRAINT import_decision_schema_version_check
  CHECK (schema_version IN ('1.0.0', '1.1.0'));

ALTER TABLE product_state.import_decision
  ADD COLUMN scope text;
ALTER TABLE product_state.import_decision
  ADD COLUMN legacy_import_receipt_id text;
ALTER TABLE product_state.import_decision
  ADD CONSTRAINT import_decision_legacy_receipt_fk
  FOREIGN KEY (legacy_import_receipt_id) REFERENCES product_state.legacy_import_receipt(id);
ALTER TABLE product_state.import_decision
  ADD CONSTRAINT import_decision_scope_check
  CHECK (
    (schema_version = '1.0.0' AND scope IS NULL AND legacy_import_receipt_id IS NULL)
    OR (
      schema_version = '1.1.0'
      AND length(btrim(environment)) > 0
      AND length(btrim(scope)) > 0
      AND scope = environment
      AND evidence ->> 'environment' IS NOT NULL
      AND evidence ->> 'environment' = environment
      AND evidence ->> 'scope' IS NOT NULL
      AND evidence ->> 'scope' = scope
    )
  );
ALTER TABLE product_state.import_decision
  ADD CONSTRAINT import_decision_receipt_check
  CHECK (
    schema_version = '1.0.0'
    OR (decision = 'IMPORT_COMPLETED' AND legacy_import_receipt_id IS NOT NULL)
    OR (decision = 'NO_IMPORT_REQUIRED' AND legacy_import_receipt_id IS NULL)
  );

CREATE OR REPLACE FUNCTION product_state.valid_no_import_inventory_evidence(
  evidence_value jsonb,
  expected_environment text,
  expected_scope text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT evidence_value ->> 'environment' = expected_environment
    AND evidence_value ->> 'scope' = expected_scope
    AND evidence_value ->> 'evidenceKind' = 'LEGACY_STATE_INVENTORY'
    AND length(btrim(COALESCE(evidence_value ->> 'inventoryId', ''))) > 0
    AND evidence_value ->> 'sourceSystem' = 'LEGACY_SHOWCASE'
    AND COALESCE(evidence_value ->> 'sourceSystemScanHash', '') ~ '^[0-9a-f]{64}$'
    AND evidence_value -> 'recordCount' = '0'::jsonb
    AND length(btrim(COALESCE(evidence_value ->> 'inventoryTimestamp', ''))) > 0
    AND (evidence_value ->> 'inventoryTimestamp')::timestamptz IS NOT NULL
    AND length(btrim(COALESCE(evidence_value ->> 'scannerImplementationId', ''))) > 0
    AND length(btrim(COALESCE(evidence_value ->> 'scannerImplementationVersion', ''))) > 0;
$$;

CREATE OR REPLACE FUNCTION product_state.enforce_import_decision_receipt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  receipt_task_id text;
  expected_event_count integer;
  actual_event_count integer;
BEGIN
  IF NEW.schema_version <> '1.1.0' THEN
    RAISE EXCEPTION 'new import decisions require schema 1.1.0' USING ERRCODE = '23514';
  END IF;
  IF NEW.decision = 'NO_IMPORT_REQUIRED' THEN
    IF NOT product_state.valid_no_import_inventory_evidence(NEW.evidence, NEW.environment, NEW.scope) THEN
      RAISE EXCEPTION 'governed zero-record Legacy inventory evidence required' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT receipt.task_id, (receipt.details ->> 'importedMessageCount')::integer
  INTO receipt_task_id, expected_event_count
  FROM product_state.legacy_import_receipt receipt
  WHERE receipt.id = NEW.legacy_import_receipt_id;
  IF NOT FOUND OR expected_event_count IS NULL OR expected_event_count < 1 THEN
    RAISE EXCEPTION 'nonempty Legacy import receipt required' USING ERRCODE = '23514';
  END IF;
  SELECT count(*)::integer INTO actual_event_count
  FROM product_state.conversation_event event
  WHERE event.task_id = receipt_task_id;
  IF actual_event_count <> expected_event_count THEN
    RAISE EXCEPTION 'Legacy import receipt content mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER import_decision_receipt_guard
BEFORE INSERT ON product_state.import_decision
FOR EACH ROW EXECUTE FUNCTION product_state.enforce_import_decision_receipt();

CREATE UNIQUE INDEX learner_attempt_one_successor_idx
  ON product_state.learner_attempt(supersedes_attempt_id)
  WHERE supersedes_attempt_id IS NOT NULL;

UPDATE product_state.learner_attempt parent
SET status = 'SUPERSEDED'
WHERE parent.status = 'SUBMITTED'
  AND EXISTS (
    SELECT 1 FROM product_state.learner_attempt child
    WHERE child.supersedes_attempt_id = parent.id
  );

CREATE OR REPLACE FUNCTION product_state.enforce_attempt_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.task_id IS DISTINCT FROM OLD.task_id
    OR NEW.episode_id IS DISTINCT FROM OLD.episode_id
    OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
    OR NEW.artifact_refs IS DISTINCT FROM OLD.artifact_refs
    OR NEW.evidence_refs IS DISTINCT FROM OLD.evidence_refs
    OR NEW.capability IS DISTINCT FROM OLD.capability
    OR NEW.supersedes_attempt_id IS DISTINCT FROM OLD.supersedes_attempt_id THEN
    RAISE EXCEPTION 'learner attempt identity and evidence are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> NEW.status AND NOT (OLD.status = 'SUBMITTED' AND NEW.status = 'SUPERSEDED') THEN
    RAISE EXCEPTION 'invalid learner_attempt transition % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER learner_attempt_transition_guard
BEFORE UPDATE ON product_state.learner_attempt
FOR EACH ROW EXECUTE FUNCTION product_state.enforce_attempt_transition();

CREATE OR REPLACE FUNCTION product_state.enforce_attempt_supersession()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_task_id text;
  parent_episode_id text;
  parent_status text;
  parent_learner_id text;
  successor_learner_id text;
BEGIN
  IF NEW.supersedes_attempt_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.id = NEW.supersedes_attempt_id OR NEW.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'invalid learner attempt supersession' USING ERRCODE = '23514';
  END IF;
  SELECT parent.task_id, parent.episode_id, parent.status, parent_task.learner_id, successor_task.learner_id
  INTO parent_task_id, parent_episode_id, parent_status, parent_learner_id, successor_learner_id
  FROM product_state.learner_attempt parent
  JOIN product_state.learning_task parent_task ON parent_task.id = parent.task_id
  JOIN product_state.learning_task successor_task ON successor_task.id = NEW.task_id
  WHERE parent.id = NEW.supersedes_attempt_id
  FOR UPDATE OF parent;
  IF NOT FOUND
    OR parent_status <> 'SUBMITTED'
    OR parent_task_id <> NEW.task_id
    OR parent_episode_id <> NEW.episode_id
    OR parent_learner_id <> successor_learner_id THEN
    RAISE EXCEPTION 'superseded attempt must be current and in the same task, episode and learner scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER learner_attempt_supersession_guard
BEFORE INSERT ON product_state.learner_attempt
FOR EACH ROW EXECUTE FUNCTION product_state.enforce_attempt_supersession();

CREATE OR REPLACE FUNCTION product_state.mark_superseded_attempt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.supersedes_attempt_id IS NOT NULL THEN
    UPDATE product_state.learner_attempt
    SET status = 'SUPERSEDED'
    WHERE id = NEW.supersedes_attempt_id AND status = 'SUBMITTED';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'submitted superseded attempt required' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER learner_attempt_supersession_apply
AFTER INSERT ON product_state.learner_attempt
FOR EACH ROW EXECUTE FUNCTION product_state.mark_superseded_attempt();

CREATE UNIQUE INDEX diagnostic_observation_one_root_idx
  ON product_state.diagnostic_observation(attempt_id)
  WHERE supersedes_observation_id IS NULL;
CREATE UNIQUE INDEX diagnostic_observation_one_successor_idx
  ON product_state.diagnostic_observation(supersedes_observation_id)
  WHERE supersedes_observation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION product_state.enforce_diagnostic_observation_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_attempt_id text;
BEGIN
  PERFORM 1 FROM product_state.learner_attempt attempt
  WHERE attempt.id = NEW.attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'observation attempt required' USING ERRCODE = '23503';
  END IF;
  IF NEW.supersedes_observation_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM product_state.diagnostic_observation observation
      WHERE observation.attempt_id = NEW.attempt_id
    ) THEN
      RAISE EXCEPTION 'current DiagnosticObservation supersession required' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id = NEW.supersedes_observation_id THEN
    RAISE EXCEPTION 'DiagnosticObservation cannot supersede itself' USING ERRCODE = '23514';
  END IF;
  SELECT parent.attempt_id INTO parent_attempt_id
  FROM product_state.diagnostic_observation parent
  WHERE parent.id = NEW.supersedes_observation_id
  FOR UPDATE;
  IF NOT FOUND OR parent_attempt_id <> NEW.attempt_id THEN
    RAISE EXCEPTION 'DiagnosticObservation must supersede the current observation for the same Attempt' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM product_state.diagnostic_observation child
    WHERE child.supersedes_observation_id = NEW.supersedes_observation_id
  ) THEN
    RAISE EXCEPTION 'DiagnosticObservation supersession fork prohibited' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM product_state.teacher_review review
    WHERE review.observation_id = NEW.supersedes_observation_id
  ) THEN
    RAISE EXCEPTION 'reviewed DiagnosticObservation cannot be superseded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER diagnostic_observation_chain_guard
BEFORE INSERT ON product_state.diagnostic_observation
FOR EACH ROW EXECUTE FUNCTION product_state.enforce_diagnostic_observation_chain();

CREATE UNIQUE INDEX teacher_review_one_root_idx
  ON product_state.teacher_review(observation_id)
  WHERE supersedes_review_id IS NULL;
CREATE UNIQUE INDEX teacher_review_one_successor_idx
  ON product_state.teacher_review(supersedes_review_id)
  WHERE supersedes_review_id IS NOT NULL;

CREATE OR REPLACE FUNCTION product_state.enforce_teacher_review_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_observation_id text;
BEGIN
  PERFORM 1 FROM product_state.diagnostic_observation observation
  WHERE observation.id = NEW.observation_id
  FOR UPDATE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM product_state.diagnostic_observation child
    WHERE child.supersedes_observation_id = NEW.observation_id
  ) THEN
    RAISE EXCEPTION 'TeacherReview requires the current DiagnosticObservation leaf' USING ERRCODE = '23514';
  END IF;
  IF NEW.supersedes_review_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM product_state.teacher_review review
      WHERE review.observation_id = NEW.observation_id
    ) THEN
      RAISE EXCEPTION 'current TeacherReview supersession required' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT parent.observation_id INTO parent_observation_id
  FROM product_state.teacher_review parent
  WHERE parent.id = NEW.supersedes_review_id
  FOR UPDATE;
  IF NOT FOUND OR parent_observation_id <> NEW.observation_id THEN
    RAISE EXCEPTION 'TeacherReview must supersede the current review for the same observation' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM product_state.teacher_review child
    WHERE child.supersedes_review_id = NEW.supersedes_review_id
  ) THEN
    RAISE EXCEPTION 'TeacherReview supersession fork prohibited' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM product_state.retry_attempt retry
    WHERE retry.review_id = NEW.supersedes_review_id
  ) THEN
    RAISE EXCEPTION 'TeacherReview with a planned retry cannot be superseded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER teacher_review_chain_guard
BEFORE INSERT ON product_state.teacher_review
FOR EACH ROW EXECUTE FUNCTION product_state.enforce_teacher_review_chain();

CREATE UNIQUE INDEX retry_attempt_one_per_review_idx
  ON product_state.retry_attempt(review_id);

CREATE OR REPLACE FUNCTION product_state.enforce_retry_review_and_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  review_decision text;
  reviewed_attempt_id text;
  attempt_task_id text;
  attempt_episode_id text;
  attempt_status text;
BEGIN
  SELECT review.decision, observation.attempt_id,
         attempt.task_id, attempt.episode_id, attempt.status
  INTO review_decision, reviewed_attempt_id,
       attempt_task_id, attempt_episode_id, attempt_status
  FROM product_state.teacher_review review
  JOIN product_state.diagnostic_observation observation ON observation.id = review.observation_id
  JOIN product_state.learner_attempt attempt ON attempt.id = observation.attempt_id
  WHERE review.id = NEW.review_id
  FOR UPDATE OF review, attempt;
  IF NOT FOUND
    OR review_decision = 'ESCALATE'
    OR reviewed_attempt_id <> NEW.original_attempt_id
    OR attempt_task_id <> NEW.task_id
    OR attempt_episode_id <> NEW.episode_id
    OR attempt_status <> 'SUBMITTED'
    OR EXISTS (
      SELECT 1 FROM product_state.teacher_review child
      WHERE child.supersedes_review_id = NEW.review_id
    ) THEN
    RAISE EXCEPTION 'retry requires the current actionable review in the same learning scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER retry_attempt_review_scope_guard
BEFORE INSERT ON product_state.retry_attempt
FOR EACH ROW EXECUTE FUNCTION product_state.enforce_retry_review_and_scope();

CREATE OR REPLACE FUNCTION product_state.enforce_cutover_import_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  decision_schema_version text;
  decision_environment text;
  decision_scope text;
  decision_value text;
  receipt_id text;
  receipt_task_id text;
  expected_event_count integer;
  actual_event_count integer;
BEGIN
  SELECT schema_version, environment, scope, decision, legacy_import_receipt_id
  INTO decision_schema_version, decision_environment, decision_scope, decision_value, receipt_id
  FROM product_state.import_decision
  WHERE id = NEW.importer_decision_id;
  IF NOT FOUND
    OR decision_schema_version <> '1.1.0'
    OR decision_environment <> NEW.environment
    OR decision_scope <> NEW.environment THEN
    RAISE EXCEPTION 'cutover import decision scope mismatch' USING ERRCODE = '23514';
  END IF;
  IF decision_value = 'IMPORT_COMPLETED' AND receipt_id IS NULL THEN
    RAISE EXCEPTION 'cutover requires a Legacy import receipt' USING ERRCODE = '23514';
  END IF;
  IF decision_value = 'IMPORT_COMPLETED' THEN
    SELECT receipt.task_id, (receipt.details ->> 'importedMessageCount')::integer
    INTO receipt_task_id, expected_event_count
    FROM product_state.legacy_import_receipt receipt
    WHERE receipt.id = receipt_id;
    SELECT count(*)::integer INTO actual_event_count
    FROM product_state.conversation_event event
    WHERE event.task_id = receipt_task_id;
    IF expected_event_count IS NULL OR expected_event_count < 1 OR actual_event_count <> expected_event_count THEN
      RAISE EXCEPTION 'cutover Legacy import receipt content mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF decision_value = 'NO_IMPORT_REQUIRED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM product_state.import_decision decision_record
      WHERE decision_record.id = NEW.importer_decision_id
        AND product_state.valid_no_import_inventory_evidence(
          decision_record.evidence,
          NEW.environment,
          NEW.environment
        )
    ) THEN
      RAISE EXCEPTION 'cutover requires governed zero-record Legacy inventory evidence' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cutover_import_scope_guard
BEFORE INSERT ON product_state.cutover_acceptance
FOR EACH ROW EXECUTE FUNCTION product_state.enforce_cutover_import_scope();

INSERT INTO product_state.schema_migration(version, content_hash)
VALUES ('0003', '__MIGRATION_CONTENT_HASH__');

COMMIT;
