import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type StoredObject = { storageKey: string; byteSize: number };

export interface FileStorage {
  put(input: { key: string; bytes: Uint8Array }): Promise<StoredObject>;
  read(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

function configuredRoot(): string {
  const configured = process.env.FILE_STORAGE_LOCAL_ROOT;
  if (process.env.NODE_ENV === "production" && !configured) {
    throw new Error("FILE_STORAGE_LOCAL_ROOT or a managed FileStorage adapter is required in production");
  }
  if (configured) return resolve(/* turbopackIgnore: true */ configured);
  return resolve(process.cwd(), ".local-data", "uploads");
}

export class LocalFileStorage implements FileStorage {
  constructor(private readonly root = configuredRoot()) {}

  private pathFor(key: string): string {
    if (isAbsolute(key) || key.includes("\0")) throw new Error("Invalid storage key");
    const target = resolve(this.root, key);
    const scoped = relative(this.root, target);
    if (scoped.startsWith("..") || isAbsolute(scoped)) throw new Error("Storage key escapes configured root");
    return target;
  }

  async put(input: { key: string; bytes: Uint8Array }): Promise<StoredObject> {
    const target = this.pathFor(input.key);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, input.bytes, { flag: "wx" });
    await rename(temporary, target);
    return { storageKey: input.key, byteSize: input.bytes.byteLength };
  }

  async read(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathFor(key)));
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

let storage: FileStorage | null = null;

export function getFileStorage(): FileStorage {
  storage ??= new LocalFileStorage();
  return storage;
}

export function setFileStorageForTests(value: FileStorage | null): void {
  storage = value;
}
