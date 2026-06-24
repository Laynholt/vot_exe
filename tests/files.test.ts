import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";

import { AppError } from "../src/contracts";
import { downloadAtomic, writeAtomic } from "../src/files";

const binaryPayload = Uint8Array.from([
  0x00, 0xff, 0x10, 0x80, 0x41, 0x42, 0x43, 0x7f,
]);
const temporaryRoots: string[] = [];

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/binary") {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(binaryPayload.slice(0, 2));
            controller.enqueue(binaryPayload.slice(2, 5));
            controller.enqueue(binaryPayload.slice(5));
            controller.close();
          },
        });
        return new Response(body, {
          headers: { "content-type": "application/octet-stream" },
        });
      }

      return new Response("missing", { status: 404 });
    },
  });
});

afterAll(async () => {
  await server.stop(true);
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vot-helper-files-"));
  temporaryRoots.push(root);
  return root;
}

function serverUrl(path: string): string {
  return `http://127.0.0.1:${server.port}${path}`;
}

function injectedFetch(
  implementation: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): typeof fetch {
  return Object.assign(implementation, { preconnect: fetch.preconnect });
}

async function expectAppError(
  promise: Promise<unknown>,
  code: "download" | "fileIO",
): Promise<AppError> {
  try {
    await promise;
    throw new Error("Expected operation to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  }
}

async function expectNoStagingFiles(
  directory: string,
  outputName: string,
): Promise<void> {
  const siblings = await readdir(directory);
  expect(
    siblings.filter((name) => name.startsWith(`.${outputName}.tmp-`)),
  ).toEqual([]);
}

describe("writeAtomic", () => {
  test("writes text atomically and returns an absolute path and byte count", async () => {
    const root = await temporaryDirectory();
    const output = join(root, "captions.srt");
    const content = "Привет, world!\r\n";

    const result = await writeAtomic(output, content, { force: false });

    expect(result).toEqual({
      path: output,
      bytes: new TextEncoder().encode(content).byteLength,
    });
    expect(isAbsolute(result.path)).toBe(true);
    expect(await readFile(output, "utf8")).toBe(content);
    await expectNoStagingFiles(root, "captions.srt");
  });

  test("writes Uint8Array content byte-for-byte", async () => {
    const root = await temporaryDirectory();
    const output = join(root, "payload.bin");

    const result = await writeAtomic(output, binaryPayload, { force: false });

    expect(result.bytes).toBe(binaryPayload.byteLength);
    expect(new Uint8Array(await readFile(output))).toEqual(binaryPayload);
    await expectNoStagingFiles(root, "payload.bin");
  });

  test("refuses an existing file without force and leaves it unchanged", async () => {
    const root = await temporaryDirectory();
    const output = join(root, "existing.txt");
    await writeFile(output, "original");

    await expectAppError(
      writeAtomic(output, "replacement", { force: false }),
      "fileIO",
    );

    expect(await readFile(output, "utf8")).toBe("original");
    await expectNoStagingFiles(root, "existing.txt");
  });

  test("force replaces an existing file without leaving staging files", async () => {
    const root = await temporaryDirectory();
    const output = join(root, "existing.txt");
    await writeFile(output, "original");

    const result = await writeAtomic(output, "replacement", { force: true });

    expect(result.bytes).toBe(11);
    expect(await readFile(output, "utf8")).toBe("replacement");
    await expectNoStagingFiles(root, "existing.txt");
  });

  test("rejects a destination directory even with force", async () => {
    const root = await temporaryDirectory();
    const output = join(root, "directory");
    await mkdir(output);

    await expectAppError(
      writeAtomic(output, "content", { force: true }),
      "fileIO",
    );

    expect(await readdir(output)).toEqual([]);
    await expectNoStagingFiles(root, "directory");
  });

  test("rejects a missing parent directory without creating it", async () => {
    const root = await temporaryDirectory();
    const parent = join(root, "missing");
    const output = join(parent, "output.txt");

    await expectAppError(
      writeAtomic(output, "content", { force: false }),
      "fileIO",
    );

    expect(await readdir(root)).toEqual([]);
  });
});

describe("downloadAtomic", () => {
  test("streams binary bytes from HTTP and returns metadata", async () => {
    const root = await temporaryDirectory();
    const output = join(root, "audio.bin");

    const result = await downloadAtomic(serverUrl("/binary"), output, {
      force: false,
    });

    expect(result).toEqual({
      path: output,
      bytes: binaryPayload.byteLength,
      contentType: "application/octet-stream",
    });
    expect(isAbsolute(result.path)).toBe(true);
    expect(new Uint8Array(await readFile(output))).toEqual(binaryPayload);
    await expectNoStagingFiles(root, "audio.bin");
  });

  test("maps non-2xx responses to download errors without creating output", async () => {
    const root = await temporaryDirectory();
    const output = join(root, "missing.bin");

    const error = await expectAppError(
      downloadAtomic(serverUrl("/not-found?token=secret-value"), output, {
        force: false,
      }),
      "download",
    );

    expect(error.message).not.toContain("secret-value");
    expect(await readdir(root)).toEqual([]);
  });

  test("cancels and unlocks a non-2xx response body", async () => {
    const root = await temporaryDirectory();
    const output = join(root, "rejected.bin");
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        // Keep the response open until downloadAtomic disposes it.
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchFn = injectedFetch(
      async () => new Response(body, { status: 503 }),
    );

    await expectAppError(
      downloadAtomic("https://example.invalid/rejected", output, {
        force: false,
        fetchFn,
      }),
      "download",
    );

    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
    expect(await readdir(root)).toEqual([]);
  });

  test("maps a null response body to a download error", async () => {
    const root = await temporaryDirectory();
    const output = join(root, "empty.bin");
    const fetchFn = injectedFetch(
      async () => new Response(null, { status: 200 }),
    );

    await expectAppError(
      downloadAtomic("https://example.invalid/private", output, {
        force: false,
        fetchFn,
      }),
      "download",
    );

    expect(await readdir(root)).toEqual([]);
  });

  test("maps network failures to download errors without exposing the URL", async () => {
    const root = await temporaryDirectory();
    const output = join(root, "network.bin");
    const fetchFn = injectedFetch(async () => {
      throw new Error("network failure includes api-key=secret-value");
    });

    const error = await expectAppError(
      downloadAtomic("https://example.invalid/?token=secret-value", output, {
        force: false,
        fetchFn,
      }),
      "download",
    );

    expect(error.message).not.toContain("secret-value");
    expect(await readdir(root)).toEqual([]);
  });

  test("removes a partial temp file when the response stream throws", async () => {
    const root = await temporaryDirectory();
    const output = join(root, "interrupted.bin");
    const fetchFn = injectedFetch(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Uint8Array.from([1, 2, 3]));
            controller.error(new Error("interrupted with bearer secret-value"));
          },
        }),
      ));

    const error = await expectAppError(
      downloadAtomic("https://example.invalid/private", output, {
        force: false,
        fetchFn,
      }),
      "download",
    );

    expect(error.message).not.toContain("secret-value");
    expect(await readdir(root)).toEqual([]);
  });

  test("cancels an unlocked body when staging creation fails after fetch", async () => {
    const root = await temporaryDirectory();
    const parent = join(root, "output");
    await mkdir(parent);
    const output = join(parent, "audio.bin");
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        // Keep the response open until downloadAtomic disposes it.
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchFn = injectedFetch(async () => {
      await rm(parent, { recursive: true, force: true });
      return new Response(body);
    });

    await expectAppError(
      downloadAtomic("https://example.invalid/audio", output, {
        force: false,
        fetchFn,
      }),
      "fileIO",
    );

    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
    expect(await readdir(root)).toEqual([]);
  });

  test("preserves the original when forced finalization fails", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const root = await temporaryDirectory();
    const output = join(root, "locked.bin");
    const original = Uint8Array.from([9, 8, 7, 6]);
    await writeFile(output, original);

    const lockScript = [
      "$stream = [System.IO.File]::Open($env:LOCK_PATH, 'Open', 'ReadWrite', 'None')",
      "[Console]::Out.WriteLine('ready')",
      "[Console]::Out.Flush()",
      "[Console]::ReadLine() | Out-Null",
      "$stream.Dispose()",
    ].join("; ");
    const lock = Bun.spawn(
      ["powershell", "-NoProfile", "-NonInteractive", "-Command", lockScript],
      {
        env: { ...process.env, LOCK_PATH: output },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const lockOutput = lock.stdout.getReader();
    const ready = await lockOutput.read();
    expect(new TextDecoder().decode(ready.value).trim()).toBe("ready");
    lockOutput.releaseLock();

    try {
      await expectAppError(
        downloadAtomic(serverUrl("/binary"), output, { force: true }),
        "fileIO",
      );
    } finally {
      lock.stdin.write("\n");
      lock.stdin.end();
      await lock.exited;
    }

    expect(new Uint8Array(await readFile(output))).toEqual(original);
    await expectNoStagingFiles(root, "locked.bin");
  });
});
