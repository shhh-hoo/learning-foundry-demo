import { describe, expect, it } from "vitest";
import { resolveDatabaseUrls } from "@/db/database-config";

describe("database connection boundaries", () => {
  it("uses DATABASE_URL only as a local/test fallback", () => {
    const url = "postgresql://local:local@127.0.0.1:55432/learning_foundry";
    expect(resolveDatabaseUrls({ NODE_ENV: "test", DATABASE_URL: url })).toEqual({
      productDatabaseUrl: url,
      checkpointDatabaseUrl: url,
    });
  });

  it("fails production when Product and checkpoint use the same role and target", () => {
    const url = "postgresql://shared_role:secret@db.example/learning_foundry";
    expect(() => resolveDatabaseUrls({
      NODE_ENV: "production",
      PRODUCT_DATABASE_URL: url,
      CHECKPOINT_DATABASE_URL: url,
    })).toThrow(/distinct database roles or targets/);
  });

  it("allows the same managed database with distinct least-privilege roles", () => {
    const resolved = resolveDatabaseUrls({
      NODE_ENV: "production",
      PRODUCT_DATABASE_URL: "postgresql://product_role:one@db.example/learning_foundry",
      CHECKPOINT_DATABASE_URL: "postgresql://checkpoint_role:two@db.example/learning_foundry",
    });
    expect(resolved.productDatabaseUrl).toContain("product_role");
    expect(resolved.checkpointDatabaseUrl).toContain("checkpoint_role");
  });

  it("does not accept DATABASE_URL as a production fallback", () => {
    expect(() => resolveDatabaseUrls({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://shared:secret@db.example/learning_foundry",
    })).toThrow(/PRODUCT_DATABASE_URL/);
  });
});
