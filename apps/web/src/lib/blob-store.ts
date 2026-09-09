import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function storageRoot() {
  return resolve(process.env.FILE_STORAGE_PATH ?? ".data/files");
}

/** Store original source bytes without exposing filesystem paths to the app. */
export async function storeSourceBlob(companyId: string, hash: string, bytes: Uint8Array) {
  const mode = (process.env.FILE_STORAGE ?? "local").toLowerCase();
  if (mode !== "local") throw new Error(`FILE_STORAGE=${mode} is not configured; use FILE_STORAGE=local for now.`);
  const relativePath = `${companyId}/${hash}`;
  const absolutePath = resolve(storageRoot(), relativePath);
  if (!absolutePath.startsWith(`${storageRoot()}/`)) throw new Error("Invalid source storage path");
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  return `local://${relativePath}`;
}

export async function readSourceBlob(storageReference: string) {
  const mode = (process.env.FILE_STORAGE ?? "local").toLowerCase();
  if (mode !== "local" || !storageReference.startsWith("local://")) throw new Error("Source storage is not available in the configured storage mode");
  const relativePath = storageReference.slice("local://".length);
  const root = storageRoot();
  const absolutePath = resolve(root, relativePath);
  if (!absolutePath.startsWith(`${root}/`)) throw new Error("Invalid source storage path");
  return readFile(absolutePath);
}
