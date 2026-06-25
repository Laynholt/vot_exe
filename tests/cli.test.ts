import { describe, expect, test } from "bun:test";

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn([process.execPath, "src/vot-helper.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      VOT_WORKER_HOST: "",
      VOT_API_TOKEN: "",
      VOT_YANDEX_COOKIE: "",
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

function parseSingleJsonLine(stdout: string) {
  expect(stdout.endsWith("\n")).toBe(true);
  expect(stdout.trimEnd().split("\n")).toHaveLength(1);
  return JSON.parse(stdout);
}

describe("vot-helper process contract", () => {
  test("prints help without a JSON envelope or network access", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("vot-helper.exe translate");
    expect(result.stdout).toContain("VOT_WORKER_HOST");
    expect(result.stderr).toBe("");
  });

  test("prints helper and VOT versions", async () => {
    const result = await runCli(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("vot-helper 0.1.0");
    expect(result.stdout).toContain("@vot.js/node 2.4.12");
    expect(result.stderr).toBe("");
  });

  test("prints one JSON error for an invalid command", async () => {
    const result = await runCli(["wat"]);
    const envelope = parseSingleJsonLine(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown command: wat.");
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      ok: false,
      operation: "arguments",
      helperVersion: "0.1.0",
      votVersion: "2.4.12",
      error: {
        code: "invalidArguments",
        message: "Unknown command: wat.",
      },
    });
  });

  test("prints one JSON error for a missing URL", async () => {
    const result = await runCli(["translate"]);
    const envelope = parseSingleJsonLine(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Missing required option --url");
    expect(envelope.error).toMatchObject({
      code: "invalidArguments",
      message: "Missing required option --url for translate.",
    });
  });
});
