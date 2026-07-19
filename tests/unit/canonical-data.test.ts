import { describe, expect, it } from "vitest";
import { deterministicUuid, putWithDatabaseCompensation } from "@/application/canonical-data";
import type { FileStorage } from "@/infrastructure/file-storage";

class MemoryStorage implements FileStorage {
  readonly objects = new Map<string, Uint8Array>();
  failDelete = false;

  async put(input: { key: string; bytes: Uint8Array }) {
    this.objects.set(input.key, input.bytes.slice());
    return { storageKey: input.key, byteSize: input.bytes.byteLength };
  }

  async read(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error("missing object");
    return bytes.slice();
  }

  async delete(key: string) {
    if (this.failDelete) throw new Error("delete failed");
    this.objects.delete(key);
  }
}

describe("canonical data helpers", () => {
  it("derives stable, seed-sensitive RFC 4122 UUIDs", () => {
    const first = deterministicUuid("source-version:one");
    expect(first).toBe(deterministicUuid("source-version:one"));
    expect(first).not.toBe(deterministicUuid("source-version:two"));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("removes the just-written object when database finalization fails", async () => {
    const storage = new MemoryStorage();
    await expect(putWithDatabaseCompensation({
      storage,
      key: "canonical/failed",
      bytes: new Uint8Array([1, 2, 3]),
      finalize: async () => { throw new Error("database failed"); },
    })).rejects.toThrow("database failed");
    expect(storage.objects.has("canonical/failed")).toBe(false);
  });

  it("retains the object only after successful finalization", async () => {
    const storage = new MemoryStorage();
    const result = await putWithDatabaseCompensation({
      storage,
      key: "canonical/succeeded",
      bytes: new Uint8Array([4, 5, 6]),
      finalize: async () => "committed",
    });
    expect(result).toBe("committed");
    expect(storage.objects.get("canonical/succeeded")).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("preserves both failures when storage compensation also fails", async () => {
    const storage = new MemoryStorage();
    storage.failDelete = true;
    await expect(putWithDatabaseCompensation({
      storage,
      key: "canonical/orphan-risk",
      bytes: new Uint8Array([7]),
      finalize: async () => { throw new Error("database failed"); },
    })).rejects.toBeInstanceOf(AggregateError);
  });
});
