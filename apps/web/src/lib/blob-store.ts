import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function storageRoot() {
  // This is an operator-selected data directory, not an application import.
  // Keep it outside Turbopack's deployment trace while retaining the explicit
  // path-traversal checks at every read and delete boundary below.
  return resolve(/* turbopackIgnore: true */ process.env.FILE_STORAGE_PATH ?? ".data/files");
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
  return readFile(/* turbopackIgnore: true */ absolutePath);
}

/** Remove one known local source object; callers must obtain its reference from an authorized source row. */
export async function deleteSourceBlob(storageReference: string) {
  const mode = (process.env.FILE_STORAGE ?? "local").toLowerCase();
  if (mode !== "local" || !storageReference.startsWith("local://")) return;
  const root = storageRoot(); const relativePath = storageReference.slice("local://".length); const absolutePath = resolve(root, relativePath);
  if (!absolutePath.startsWith(`${root}/`)) throw new Error("Invalid source storage path");
  await rm(absolutePath, { force: true });
}
