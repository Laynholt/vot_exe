import { mkdir } from "node:fs/promises";

const RELEASE_PATTERN = /^vot-\d+\.\d+\.\d+-r\d+$|^development$/;

export function releaseName(env: Record<string, string | undefined>): string {
  const value = env.VOT_HELPER_RELEASE;
  if (value === undefined || !RELEASE_PATTERN.test(value)) {
    throw new Error(
      "VOT_HELPER_RELEASE must be development or vot-X.Y.Z-rN.",
    );
  }
  return value;
}

export function buildArgs(release: string): string[] {
  if (!RELEASE_PATTERN.test(release)) {
    throw new Error("Invalid release name.");
  }

  return [
    "build",
    "--compile",
    "--target=bun-windows-x64-baseline",
    "--define",
    `VOT_HELPER_RELEASE='${release}'`,
    "src/vot-helper.ts",
    "--outfile",
    "dist/vot-helper.exe",
  ];
}

function buildArgsWithExecutablePath(
  release: string,
  executablePath: string,
): string[] {
  const args = buildArgs(release);
  const targetIndex = args.findIndex((arg) => arg.startsWith("--target="));
  if (targetIndex === -1) {
    throw new Error("Build target argument is missing.");
  }
  return [
    ...args.slice(0, targetIndex + 1),
    "--compile-executable-path",
    executablePath,
    ...args.slice(targetIndex + 1),
  ];
}

async function runBuild(args: string[]): Promise<number> {
  const proc = Bun.spawn([process.execPath, ...args], {
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

async function main(): Promise<number> {
  const release = releaseName(process.env);
  await mkdir("dist", { recursive: true });

  const firstExitCode = await runBuild(buildArgs(release));
  if (firstExitCode === 0) {
    return 0;
  }

  process.stderr.write(
    "Initial Bun compile failed; retrying with --compile-executable-path.\n",
  );
  return await runBuild(buildArgsWithExecutablePath(release, process.execPath));
}

if (import.meta.main) {
  process.exitCode = await main();
}
