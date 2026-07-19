import { createHash } from "node:crypto";
import type { ExecutionControl } from "@/application/execution-control";
import type { FileStorage } from "@/infrastructure/file-storage";

export function deterministicUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "a";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

/**
 * Keeps external storage and canonical Product State bounded: a failed database
 * finalization removes the just-written object rather than leaving an orphan.
 */
export async function putWithDatabaseCompensation<T>(input: {
  storage: FileStorage;
  key: string;
  bytes: Uint8Array;
  finalize: () => Promise<T>;
  control?: ExecutionControl;
}): Promise<T> {
  await input.storage.put({ key: input.key, bytes: input.bytes }, input.control);
  try {
    return await input.finalize();
  } catch (error) {
    try {
      await input.storage.delete(input.key, input.control);
    } catch (compensationError) {
      throw new AggregateError([error, compensationError], "Database finalization and storage compensation both failed");
    }
    throw error;
  }
}
