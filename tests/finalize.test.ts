import { afterEach, describe, expect, test } from "bun:test";
import {
  link,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
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
  return { link, lstat, rename, stat, unlink };
}

describe("finalizeStagedFile", () => {
  test("replaces an existing file with one real rename on the current host", async () => {
    const root = await temporaryDirectory();
    const destination = join(root, "output.bin");
    const staged = join(root, ".output.bin.tmp-test");
    await writeFile(destination, "original");
    await writeFile(staged, "replacement");

    await finalizeStagedFile(staged, destination, true);

    expect(await readFile(destination, "utf8")).toBe("replacement");
    expect(await readdir(root)).toEqual(["output.bin"]);
  });

  test("keeps the original and removes staging when overwrite rename fails", async () => {
    const root = await temporaryDirectory();
    const destination = join(root, "output.bin");
    const staged = join(root, ".output.bin.tmp-test");
    await writeFile(destination, "original");
    await writeFile(staged, "replacement");
    const real = realFileOps();
    const renameCalls: string[] = [];
    let originalPresentAtFailure = false;
    const fileOps: AtomicFinalizeFileOps = {
      ...real,
      async rename(from, to) {
        renameCalls.push(`${from}->${to}`);
        if (from === staged && to === destination) {
          originalPresentAtFailure =
            (await readFile(destination, "utf8")) === "original";
          throw new Error("injected rename failure");
        }
        await real.rename(from, to);
      },
    };

    try {
      await finalizeStagedFile(staged, destination, true, fileOps);
      throw new Error("Expected finalization to reject");
    } catch (error) {
      expect((error as Error).message).toBe("injected rename failure");
    }

    expect(renameCalls).toEqual([`${staged}->${destination}`]);
    expect(originalPresentAtFailure).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("original");
    expect(await readdir(root)).toEqual(["output.bin"]);
  });
});
