import { afterEach, describe, expect, test } from "bun:test";
import {
  link,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  finalizeStagedFile,
  type AtomicFinalizeFileOps,
} from "../src/files";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vot-helper-finalize-"));
  temporaryRoots.push(root);
  return root;
}

function realFileOps(): AtomicFinalizeFileOps {
  return { link, lstat, rename, rmdir, stat, unlink };
}

describe("finalizeStagedFile", () => {
  test("uses one atomic overwrite rename for forced replacement off Windows", async () => {
    const root = await temporaryDirectory();
    const destination = join(root, "output.bin");
    const staged = join(root, ".output.bin.tmp-test");
    await writeFile(destination, "original");
    await writeFile(staged, "replacement");
    const calls: string[] = [];
    const real = realFileOps();
    const fileOps: AtomicFinalizeFileOps = {
      ...real,
      async link() {
        throw new Error("non-Windows forced replacement must not create a link");
      },
      async rename(from, to) {
        calls.push(`rename:${from}->${to}`);
        await real.rename(from, to);
      },
      async unlink(path) {
        calls.push(`unlink:${path}`);
        await real.unlink(path);
      },
    };

    await finalizeStagedFile(staged, destination, true, {
      platform: "linux",
      fileOps,
    });

    expect(calls).toEqual([`rename:${staged}->${destination}`]);
    expect(await readFile(destination, "utf8")).toBe("replacement");
    expect(await readdir(root)).toEqual(["output.bin"]);
  });

  test("restores the original after Windows install fails post-backup", async () => {
    const root = await temporaryDirectory();
    const destination = join(root, "output.bin");
    const staged = join(root, ".output.bin.tmp-test");
    await writeFile(destination, "original");
    await writeFile(staged, "replacement");
    const real = realFileOps();
    let installAttemptedAfterBackup = false;
    let destinationMissingDuringInstall = false;
    let backupContainsOriginal = false;
    const fileOps: AtomicFinalizeFileOps = {
      ...real,
      async rename(from, to) {
        if (from === staged && to === destination) {
          const siblings = await readdir(root);
          const backupName = siblings.find((name) =>
            name.startsWith(".output.bin.backup-"),
          );
          installAttemptedAfterBackup = backupName !== undefined;
          if (backupName !== undefined) {
            backupContainsOriginal =
              (await readFile(join(root, backupName), "utf8")) === "original";
          }
          try {
            await real.lstat(destination);
          } catch (error) {
            destinationMissingDuringInstall =
              (error as NodeJS.ErrnoException).code === "ENOENT";
          }
          throw new Error("injected install failure");
        }
        await real.rename(from, to);
      },
    };

    try {
      await finalizeStagedFile(staged, destination, true, {
        platform: "win32",
        fileOps,
      });
      throw new Error("Expected finalization to reject");
    } catch (error) {
      expect((error as Error).message).toBe("injected install failure");
    }

    expect(installAttemptedAfterBackup).toBe(true);
    expect(destinationMissingDuringInstall).toBe(true);
    expect(backupContainsOriginal).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("original");
    expect(await readdir(root)).toEqual(["output.bin"]);
  });
});
