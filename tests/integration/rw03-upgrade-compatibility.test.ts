import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getActor } from "@/application/actor";
import { reviewSourceRights } from "@/application/file-intake";
import { closeDb, getDb, withTenantDatabase } from "@/db/client";
import { SEED } from "@/db/ids";
import { evidenceUnits, fileAssets, sourceAssetVersions, sourceRecords } from "@/db/schema";

const runUpgradeFixture = process.env.RW03_UPGRADE_FIXTURE === "1";
if (runUpgradeFixture) {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("RW03_UPGRADE_FIXTURE requires DATABASE_URL");
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(url.hostname) || !database.startsWith("learning_foundry_rw03")) {
    throw new Error("RW03_UPGRADE_FIXTURE must target a disposable localhost learning_foundry_rw03* database");
  }
}

describe.runIf(runUpgradeFixture)("RW-03 populated upgrade compatibility", () => {
  it("preserves legacy file storage lineage through mutation and rights-version advancement", async () => {
    const teacher = await getActor(SEED.teacher, SEED.institution, "integration-test", "rw03-upgrade-compatibility");
    try {
      await withTenantDatabase(teacher, async () => {
        const [sourceBefore] = await getDb().select().from(sourceRecords).where(eq(sourceRecords.sourceKey, "rw03-preupgrade-file-fixture"));
        const [fileBefore] = await getDb().select().from(fileAssets).where(eq(fileAssets.sourceId, sourceBefore.id));
        const [versionBefore] = await getDb().select().from(sourceAssetVersions).where(eq(sourceAssetVersions.id, sourceBefore.sourceAssetVersionId));
        expect(versionBefore).toMatchObject({
          storageKey: fileBefore.storageKey,
          mediaType: fileBefore.mediaType,
          byteSize: fileBefore.byteSize,
          contentHash: fileBefore.contentHash,
        });
        const updated = await getDb().update(fileAssets).set({ updatedAt: new Date() }).where(eq(fileAssets.id, fileBefore.id)).returning();
        expect(updated).toHaveLength(1);

        const decision = await reviewSourceRights(teacher, {
          sourceId: sourceBefore.id,
          decision: "APPROVED",
          rights: "Authenticated teacher approved the pre-upgrade file for institution course use.",
          idempotencyKey: "rw03-preupgrade-rights-review",
        });
        expect(decision).toMatchObject({ replayed: false, evidenceCount: 1 });
        const [sourceAfter] = await getDb().select().from(sourceRecords).where(eq(sourceRecords.id, sourceBefore.id));
        const [fileAfter] = await getDb().select().from(fileAssets).where(eq(fileAssets.id, fileBefore.id));
        const [versionAfter] = await getDb().select().from(sourceAssetVersions).where(eq(sourceAssetVersions.id, sourceAfter.sourceAssetVersionId));
        const [evidence] = await getDb().select().from(evidenceUnits).where(eq(evidenceUnits.sourceId, sourceBefore.id));
        expect(sourceAfter.sourceAssetVersionId).not.toBe(sourceBefore.sourceAssetVersionId);
        expect(fileAfter.sourceAssetVersionId).toBe(sourceAfter.sourceAssetVersionId);
        expect(versionAfter).toMatchObject({
          supersedesVersionId: sourceBefore.sourceAssetVersionId,
          storageKey: fileBefore.storageKey,
          mediaType: fileBefore.mediaType,
          byteSize: fileBefore.byteSize,
          contentHash: fileBefore.contentHash,
          rightsStatus: "APPROVED",
        });
        expect(evidence.sourceAssetVersionId).toBe(sourceAfter.sourceAssetVersionId);
      });
    } finally {
      await closeDb();
    }
  });
});
