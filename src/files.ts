import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  open,
  rename,
  rmdir,
  stat,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { AppError } from "./contracts";

interface AtomicOptions {
  force: boolean;
}

interface DownloadOptions extends AtomicOptions {
  fetchFn?: typeof fetch;
}

interface StagedFile {
  handle: FileHandle;
  path: string;
}

type DestinationKind = "missing" | "file" | "directory";

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function fileError(message: string, cause?: unknown): AppError {
  return new AppError("fileIO", message, { cause });
}

async function destinationKind(path: string): Promise<DestinationKind> {
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return "missing";
    }
    throw error;
  }

  if (entry.isDirectory()) {
    return "directory";
  }

  if (entry.isSymbolicLink()) {
    try {
      if ((await stat(path)).isDirectory()) {
        return "directory";
      }
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
  }

  return "file";
}

async function validateDestination(
  destination: string,
  force: boolean,
): Promise<void> {
  const parent = dirname(destination);
  let parentInfo;
  try {
    parentInfo = await stat(parent);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      throw fileError("Output parent directory does not exist.", error);
    }
    throw fileError("Could not inspect the output parent directory.", error);
  }

  if (!parentInfo.isDirectory()) {
    throw fileError("Output parent path is not a directory.");
  }

  let kind: DestinationKind;
  try {
    kind = await destinationKind(destination);
  } catch (error) {
    throw fileError("Could not inspect the output path.", error);
  }

  if (kind === "directory") {
    throw fileError("Output path is a directory.");
  }
  if (kind === "file" && !force) {
    throw fileError("Output file already exists.");
  }
}

function siblingPath(destination: string, role: "tmp" | "backup"): string {
  return join(
    dirname(destination),
    `.${basename(destination)}.${role}-${randomUUID()}`,
  );
}

async function createStagedFile(destination: string): Promise<StagedFile> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const path = siblingPath(destination, "tmp");
    try {
      return { path, handle: await open(path, "wx", 0o600) };
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) {
        throw error;
      }
    }
  }

  throw new Error("Could not allocate a unique temporary file.");
}

async function writeAll(handle: FileHandle, chunk: Uint8Array): Promise<number> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(
      chunk,
      offset,
      chunk.byteLength - offset,
    );
    if (bytesWritten === 0) {
      throw new Error("File write made no progress.");
    }
    offset += bytesWritten;
  }
  return offset;
}

async function readDownloadChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
) {
  try {
    return await reader.read();
  } catch (error) {
    throw new AppError("download", "Download stream failed.", {
      cause: error,
    });
  }
}

async function createBackup(destination: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const backup = siblingPath(destination, "backup");
    try {
      await link(destination, backup);
      return backup;
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) {
        throw error;
      }
    }
  }

  throw new Error("Could not allocate a unique backup file.");
}

async function removeRollbackObstacle(path: string): Promise<void> {
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }

  if (entry.isDirectory()) {
    await rmdir(path);
  } else {
    await unlink(path);
  }
}

async function replaceExisting(
  stagedPath: string,
  destination: string,
): Promise<void> {
  const backup = await createBackup(destination);
  let originalRemoved = false;

  try {
    await unlink(destination);
    originalRemoved = true;
    await rename(stagedPath, destination);
    await unlink(backup);
  } catch (error) {
    if (!originalRemoved) {
      try {
        await unlink(backup);
      } catch {
        // The original is still at the destination; outer cleanup reports the failure.
      }
      throw error;
    }

    try {
      await removeRollbackObstacle(destination);
      await rename(backup, destination);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Could not restore the original output file.",
      );
    }

    throw error;
  }
}

async function installStagedFile(
  stagedPath: string,
  destination: string,
  force: boolean,
): Promise<void> {
  let kind = await destinationKind(destination);
  if (kind === "directory") {
    throw fileError("Output path is a directory.");
  }

  if (!force) {
    if (kind !== "missing") {
      throw fileError("Output file already exists.");
    }
    try {
      await link(stagedPath, destination);
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        throw fileError("Output file already exists.", error);
      }
      throw error;
    }
    try {
      await unlink(stagedPath);
    } catch (error) {
      try {
        await unlink(destination);
      } catch {
        // Preserve the original cleanup error.
      }
      throw error;
    }
    return;
  }

  if (kind === "missing") {
    try {
      await rename(stagedPath, destination);
      return;
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST") && !hasErrorCode(error, "EPERM")) {
        throw error;
      }
      kind = await destinationKind(destination);
      if (kind === "missing") {
        throw error;
      }
      if (kind === "directory") {
        throw fileError("Output path is a directory.", error);
      }
    }
  }

  await replaceExisting(stagedPath, destination);
}

async function withStagedFile(
  destination: string,
  force: boolean,
  writer: (handle: FileHandle) => Promise<number>,
): Promise<number> {
  let staged: StagedFile | undefined;
  let handleOpen = false;

  try {
    staged = await createStagedFile(destination);
    handleOpen = true;
    const bytes = await writer(staged.handle);
    await staged.handle.sync();
    await staged.handle.close();
    handleOpen = false;
    await installStagedFile(staged.path, destination, force);
    staged = undefined;
    return bytes;
  } catch (error) {
    if (handleOpen && staged !== undefined) {
      try {
        await staged.handle.close();
      } catch {
        // Preserve the error that caused cleanup.
      }
    }
    if (staged !== undefined) {
      try {
        await unlink(staged.path);
      } catch (cleanupError) {
        if (!hasErrorCode(cleanupError, "ENOENT")) {
          // Preserve the primary operation error.
        }
      }
    }
    if (error instanceof AppError) {
      throw error;
    }
    throw fileError("Could not write the output file.", error);
  }
}

export async function writeAtomic(
  output: string,
  content: string | Uint8Array,
  options: AtomicOptions,
): Promise<{ path: string; bytes: number }> {
  const destination = resolve(output);
  await validateDestination(destination, options.force);
  const bytes =
    typeof content === "string" ? new TextEncoder().encode(content) : content;
  const count = await withStagedFile(destination, options.force, (handle) =>
    writeAll(handle, bytes),
  );
  return { path: destination, bytes: count };
}

export async function downloadAtomic(
  url: string,
  output: string,
  options: DownloadOptions,
): Promise<{ path: string; bytes: number; contentType?: string }> {
  const destination = resolve(output);
  await validateDestination(destination, options.force);

  let response: Response;
  try {
    response = await (options.fetchFn ?? fetch)(url);
  } catch (error) {
    throw new AppError("download", "Download request failed.", { cause: error });
  }

  if (!response.ok) {
    throw new AppError(
      "download",
      `Download failed with HTTP status ${response.status}.`,
    );
  }
  if (response.body === null) {
    throw new AppError("download", "Download response had no body.");
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch (error) {
    throw new AppError("download", "Download response body was unavailable.", {
      cause: error,
    });
  }
  const bytes = await withStagedFile(destination, options.force, async (handle) => {
    let count = 0;
    try {
      while (true) {
        const readResult = await readDownloadChunk(reader);

        if (readResult.done) {
          return count;
        }
        count += await writeAll(handle, readResult.value);
      }
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the read or file-write error.
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  });

  const contentType = response.headers.get("content-type");
  return {
    path: destination,
    bytes,
    ...(contentType === null ? {} : { contentType }),
  };
}
