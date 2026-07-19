import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";

const parentVersionId = "f4000000-0000-4000-8000-000000000001";
const firstChildVersionId = "14000000-0000-4000-8000-000000000002";
const secondChildVersionId = "24000000-0000-4000-8000-000000000003";
const fixtureVersionIds = [parentVersionId, firstChildVersionId, secondChildVersionId];

function guardedLocalUrl(raw: string | undefined): string {
  if (!raw) throw new Error("RW04_UPGRADE_DATABASE_URL is required");
  const url = new URL(raw);
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(url.hostname)) {
    throw new Error("RW04_UPGRADE_DATABASE_URL must target localhost");
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database.startsWith("learning_foundry_rw04")) {
    throw new Error("RW04_UPGRADE_DATABASE_URL must target a disposable learning_foundry_rw04* database");
  }
  return url.toString();
}

const databaseUrl = guardedLocalUrl(process.env.RW04_UPGRADE_DATABASE_URL ?? process.env.DATABASE_URL);
const migration = await readFile(new URL("../db/migrations/0005_canonical_review_component_lifecycle.sql", import.meta.url), "utf8");
const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);
const db = postgres(databaseUrl, { max: 1, prepare: false });

try {
  const [preflight] = await db<Array<{ rw04_table: string | null; version_count: number }>>`
    SELECT to_regclass('foundry_product.component_draft_revisions')::text rw04_table,
      count(*)::int version_count
    FROM foundry_product.component_versions
  `;
  if (!preflight || preflight.rw04_table !== null || preflight.version_count === 0) {
    throw new Error("Topological rehearsal requires a populated exact pre-0005 database");
  }

  const result = await db.begin(async (transaction) => {
    const tx = transaction as unknown as Sql;
    const [source] = await tx<Array<{
      component_id: string;
      institution_id: string;
      source_version_id: string;
      created_by: string;
    }>>`
      SELECT c.id component_id,c.institution_id,v.id source_version_id,v.created_by
      FROM foundry_product.component_versions v
      JOIN foundry_product.components c ON c.id=v.component_id
      WHERE v.status='PUBLISHED' AND NOT EXISTS (
        SELECT 1 FROM foundry_product.component_versions child
        WHERE child.successor_of_version_id=v.id
      )
      ORDER BY c.created_at,c.id,v.created_at,v.id
      LIMIT 1
    `;
    if (!source) throw new Error("Topological rehearsal requires one populated published leaf ComponentVersion");

    await tx`SELECT set_config('foundry.institution_id',${source.institution_id},true)`;
    await tx`SELECT set_config('foundry.governance_command','component_successor',true)`;

    await tx`
      INSERT INTO foundry_product.component_versions
        (id,component_id,version,successor_of_version_id,contract,content,source_observation_ids,source_review_ids,
         validation,eval_result,status,content_hash,created_by,created_at)
      SELECT ${parentVersionId}::uuid,component_id,'99.0.0-rw04-topology-parent',id,contract,content,
        source_observation_ids,source_review_ids,validation,NULL,'DRAFT','rw04-topology-parent',created_by,now()
      FROM foundry_product.component_versions WHERE id=${source.source_version_id}::uuid
    `;
    await tx`
      INSERT INTO foundry_product.component_versions
        (id,component_id,version,successor_of_version_id,contract,content,source_observation_ids,source_review_ids,
         validation,eval_result,status,content_hash,created_by,created_at)
      SELECT ${firstChildVersionId}::uuid,component_id,'99.0.1-rw04-topology-child-a',${parentVersionId}::uuid,contract,content,
        source_observation_ids,source_review_ids,validation,NULL,'DRAFT','rw04-topology-child-a',created_by,now()
      FROM foundry_product.component_versions WHERE id=${source.source_version_id}::uuid
    `;
    await tx`
      INSERT INTO foundry_product.component_versions
        (id,component_id,version,successor_of_version_id,contract,content,source_observation_ids,source_review_ids,
         validation,eval_result,status,content_hash,created_by,created_at)
      SELECT ${secondChildVersionId}::uuid,component_id,'99.0.2-rw04-topology-child-b',${parentVersionId}::uuid,contract,content,
        source_observation_ids,source_review_ids,validation,NULL,'DRAFT','rw04-topology-child-b',created_by,now()
      FROM foundry_product.component_versions WHERE id=${source.source_version_id}::uuid
    `;

    const fixtureBefore = await tx<Array<{ id: string; created_at: string; timestamp_rank: number }>>`
      SELECT id,created_at::text,
        row_number() OVER (ORDER BY created_at,id)::int timestamp_rank
      FROM foundry_product.component_versions
      WHERE id=ANY(${fixtureVersionIds}::uuid[])
      ORDER BY id
    `;
    if (fixtureBefore.length !== 3 || new Set(fixtureBefore.map((row) => row.created_at)).size !== 1) {
      throw new Error("Equal-timestamp branch fixture was not constructed exactly");
    }
    const parentTimestampRank = fixtureBefore.find((row) => row.id === parentVersionId)?.timestamp_rank;
    const childTimestampRanks = fixtureBefore.filter((row) => row.id !== parentVersionId).map((row) => row.timestamp_rank);
    if (parentTimestampRank === undefined || !childTimestampRanks.every((rank) => rank < parentTimestampRank)) {
      throw new Error("Fixture does not prove the predecessor-after-child timestamp/ID edge");
    }

    for (const statement of statements) await tx.unsafe(statement);

    const fixtureAfter = await tx<Array<{
      version_id: string;
      revision_number: number;
      predecessor_version_id: string;
      predecessor_revision_number: number;
    }>>`
      SELECT v.id version_id,r.revision_number,v.successor_of_version_id predecessor_version_id,
        predecessor.revision_number predecessor_revision_number
      FROM foundry_product.component_versions v
      JOIN foundry_product.component_draft_revisions r ON r.id=v.draft_revision_id
      JOIN foundry_product.component_versions predecessor_version ON predecessor_version.id=v.successor_of_version_id
      JOIN foundry_product.component_draft_revisions predecessor ON predecessor.id=predecessor_version.draft_revision_id
      WHERE v.id=ANY(${fixtureVersionIds}::uuid[])
      ORDER BY r.revision_number
    `;
    if (fixtureAfter.length !== 3 || fixtureAfter.some((row) => row.predecessor_revision_number >= row.revision_number)) {
      throw new Error(`Topological backfill did not preserve predecessor ordering: ${JSON.stringify(fixtureAfter)}`);
    }
    const children = fixtureAfter.filter((row) => row.version_id !== parentVersionId);
    if (children.length !== 2 || children.some((row) => row.predecessor_version_id !== parentVersionId)) {
      throw new Error("Topological backfill did not preserve both exact successor branches");
    }

    const [postflight] = await tx<Array<{ violations: number; mapped_versions: number }>>`
      SELECT
        (SELECT count(*)::int
         FROM foundry_product.component_draft_revisions child
         JOIN foundry_product.component_draft_revisions parent ON parent.id=child.predecessor_revision_id
         WHERE parent.revision_number>=child.revision_number) violations,
        (SELECT count(*)::int
         FROM foundry_product.component_versions v
         JOIN foundry_product.component_draft_revisions r ON r.id=v.draft_revision_id) mapped_versions
    `;
    if (!postflight || postflight.violations !== 0 || postflight.mapped_versions !== preflight.version_count + 3) {
      throw new Error(`Topological upgrade postflight mismatch: ${JSON.stringify(postflight)}`);
    }

    return {
      status: "PASS",
      populatedVersions: postflight.mapped_versions,
      equalTimestampBranchVersions: 3,
      legacyTimestampOrderWouldViolate: true,
      exactSuccessorBranchesPreserved: 2,
      predecessorOrderingViolations: 0,
    };
  });

  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await db.end();
}
