# VOT Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, test, and publish a standalone Windows x64 CLI for VOT audio translation and timed subtitle export.

**Architecture:** A thin Bun/TypeScript CLI wraps the exact npm publication of `@vot.js/node`. Pure modules own argument parsing, polling, subtitle conversion, file safety, and JSON envelopes; an injected application layer connects those modules to VOT and the filesystem. GitHub Actions validate Dependabot PRs, merge only trusted dependency-only changes, and publish immutable `vot-X.Y.Z-rN` releases.

**Tech Stack:** Bun 1.3.14, TypeScript 5.9.3, `@vot.js/node` 2.4.12, Bun test, GitHub Actions, Dependabot

---

## File map

- `package.json`, `bun.lock`, `tsconfig.json`: pinned toolchain and scripts.
- `src/contracts.ts`: command, result, error, and injected-service types.
- `src/args.ts`: parsing, validation, help text, and defaults.
- `src/result.ts`: JSON envelopes, redaction, and exit codes.
- `src/files.ts`: atomic writes and streamed downloads.
- `src/subtitles.ts`: track selection and SRT/VTT/JSON serialization.
- `src/translation.ts`: bounded VOT polling.
- `src/config.ts`: environment parsing and client construction.
- `src/app.ts`: command orchestration.
- `src/vot-helper.ts`: process entrypoint and production adapters.
- `scripts/build.ts`, `scripts/live-smoke.ts`: compilation and live validation.
- `tests/*.test.ts`: unit, contract, and process tests.
- `.github/**`: dependency, CI, merge, retry, and release automation.
- `README.md`, `README-RU.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`: public documentation.

### Task 1: Bootstrap the pinned Bun project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Generate: `bun.lock`

- [ ] **Step 1: Add exact package metadata**

Create `package.json`:

```json
{
  "name": "vot-helper",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "packageManager": "bun@1.3.14",
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "check": "bun run typecheck && bun test",
    "build": "bun run scripts/build.ts"
  },
  "dependencies": { "@vot.js/node": "2.4.12" },
  "devDependencies": {
    "@types/bun": "1.3.14",
    "typescript": "5.9.3"
  }
}
```

- [ ] **Step 2: Add strict TypeScript configuration**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "resolveJsonModule": true,
    "types": ["bun"],
    "noEmit": true
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Add generated-file exclusions**

Create `.gitignore` containing `node_modules/`, `dist/`, `*.tmp`, `.env`, and `.env.*`, with `!.env.example` last.

- [ ] **Step 4: Generate and verify the lockfile**

Run `bun install` and then `bun install --frozen-lockfile`.

Expected: both exit 0; text `bun.lock` pins `@vot.js/node@2.4.12`.

- [ ] **Step 5: Commit**

```powershell
git add package.json tsconfig.json .gitignore bun.lock
git commit -m "build: bootstrap pinned bun project"
```

### Task 2: Define CLI parsing through failing tests

**Files:**
- Create: `tests/args.test.ts`
- Create: `src/contracts.ts`
- Create: `src/args.ts`

- [ ] **Step 1: Write failing command/default tests**

```ts
import { expect, test } from "bun:test";
import { parseArgs } from "../src/args";

test("translate applies stable defaults", () => {
  expect(parseArgs(["translate", "--url", "https://youtu.be/example"])).toEqual({
    kind: "translate",
    url: "https://youtu.be/example",
    sourceLang: "auto",
    targetLang: "ru",
    timeoutSeconds: 900,
    noWait: false,
    livelyVoice: false,
    force: false,
    quiet: false,
  });
});

test("subtitles defaults to translated SRT", () => {
  expect(parseArgs(["subtitles", "--url", "https://youtu.be/example", "--output", "subs.srt"])).toMatchObject({
    kind: "subtitles",
    targetLang: "ru",
    format: "srt",
    original: false,
    output: "subs.srt",
  });
});

test("rejects unknown flags", () => {
  expect(() => parseArgs(["translate", "--url", "https://youtu.be/example", "--unknown"]))
    .toThrow("Unknown option: --unknown");
});
```

Add focused tests for missing URL, non-HTTP URL, invalid timeout/format, every agreed flag, `--help`, and `--version`.

- [ ] **Step 2: Verify RED**

Run `bun test tests/args.test.ts`.

Expected: module-not-found for `src/args.ts`.

- [ ] **Step 3: Implement the minimal parser**

Define discriminated `TranslateCommand`, `SubtitlesCommand`, `HelpCommand`, and `VersionCommand` in `src/contracts.ts`. Implement an explicit option loop in `src/args.ts`, require `http:` or `https:`, apply the tested defaults, and export complete help text.

- [ ] **Step 4: Verify GREEN**

Run `bun test tests/args.test.ts` and `bun run typecheck`.

Expected: all argument tests pass and no type errors.

- [ ] **Step 5: Commit**

```powershell
git add src/contracts.ts src/args.ts tests/args.test.ts
git commit -m "feat: define vot helper cli contract"
```

### Task 3: Add versioned JSON results and stable failures

**Files:**
- Create: `tests/result.test.ts`
- Create: `src/result.ts`
- Modify: `src/contracts.ts`

- [ ] **Step 1: Write failing envelope/redaction tests**

Assert `schemaVersion: 1`, `ok`, operation, VOT version, stable error code/exit code, one trailing newline, and redaction of OAuth tokens plus `Session_id` cookie values.

- [ ] **Step 2: Verify RED**

Run `bun test tests/result.test.ts`; expect module-not-found.

- [ ] **Step 3: Implement errors and envelopes**

Use this exit-code contract:

```ts
export const EXIT_CODES = {
  invalidArguments: 2,
  videoData: 3,
  translation: 4,
  timeout: 5,
  subtitles: 6,
  download: 7,
  fileIO: 8,
  configuration: 9,
  unexpected: 10,
} as const;
```

Implement `AppError`, `successEnvelope`, `errorEnvelope`, `redactSecrets`, and deterministic `serializeEnvelope`.

- [ ] **Step 4: Verify GREEN and commit**

Run `bun test tests/result.test.ts && bun run typecheck`, then:

```powershell
git add src/contracts.ts src/result.ts tests/result.test.ts
git commit -m "feat: add versioned json result contract"
```

### Task 4: Implement safe atomic file output

**Files:**
- Create: `tests/files.test.ts`
- Create: `src/files.ts`

- [ ] **Step 1: Write failing tests with a local Bun HTTP server**

Cover successful streaming, existing-output refusal, `force: true`, non-2xx responses, interrupted-response cleanup, and atomic text writes. Assert no sibling temp file remains after failure.

- [ ] **Step 2: Verify RED**

Run `bun test tests/files.test.ts`; expect module-not-found.

- [ ] **Step 3: Implement the tested API**

```ts
export async function writeAtomic(
  output: string,
  content: string | Uint8Array,
  options: { force: boolean },
): Promise<{ path: string; bytes: number }>;

export async function downloadAtomic(
  url: string,
  output: string,
  options: { force: boolean; fetchFn?: typeof fetch },
): Promise<{ path: string; bytes: number; contentType?: string }>;
```

Use a unique exclusive sibling temp file, stream bytes, close, then rename. Reject existing output unless forced and delete the temp path in `finally` after errors.

- [ ] **Step 4: Verify GREEN and commit**

Run `bun test tests/files.test.ts && bun run typecheck`, then commit `src/files.ts` and its test as `feat: add atomic output handling`.

### Task 5: Convert and select timed subtitles

**Files:**
- Create: `tests/subtitles.test.ts`
- Create: `src/subtitles.ts`
- Modify: `src/contracts.ts`

- [ ] **Step 1: Write failing conversion and selection tests**

Use cues `{ text, startMs, durationMs }`. Assert exact SRT timestamps (`00:00:00,000 --> 00:00:01,500`), VTT timestamps/header, CRLF, ordering, multiline text, invalid timing rejection, and JSON round-trip. Test translated `ru`, original selection, missing tracks, and ambiguous tracks.

- [ ] **Step 2: Verify RED**

Run `bun test tests/subtitles.test.ts`; expect module-not-found.

- [ ] **Step 3: Implement subtitle functions**

Export `selectSubtitleTrack`, `normalizeVotCues`, and `serializeSubtitles`. Require finite nonnegative start, positive duration, and nonempty text. Preserve text/timing except format-required escaping. Return safe track metadata with selection errors.

- [ ] **Step 4: Verify GREEN and commit**

Run `bun test tests/subtitles.test.ts && bun run typecheck`, then commit as `feat: export vot subtitles as srt and vtt`.

### Task 6: Implement bounded translation polling

**Files:**
- Create: `tests/translation.test.ts`
- Create: `src/translation.ts`

- [ ] **Step 1: Write failing polling tests**

With fake client/clock/sleep, cover immediate success, wait then success, `noWait`, timeout, partial-content success, upstream exception mapping, and clamping `remainingTime` to 5–60 seconds.

- [ ] **Step 2: Verify RED**

Run `bun test tests/translation.test.ts`; expect module-not-found.

- [ ] **Step 3: Implement `requestTranslation(options, deps)`**

Reuse the same video data for every poll, stop on `translated: true`, return pending state for `noWait`, use a monotonic deadline, and throw `AppError("timeout", ...)` on expiry.

- [ ] **Step 4: Verify GREEN and commit**

Run `bun test tests/translation.test.ts && bun run typecheck`, then commit as `feat: add bounded translation polling`.

### Task 7: Configure VOT clients without leaking secrets

**Files:**
- Create: `tests/config.test.ts`
- Create: `src/config.ts`

- [ ] **Step 1: Write failing environment tests**

Cover direct defaults, worker host, OAuth token, cookie headers, blank values, secret-free diagnostics, and `--lively-voice` rejection when neither credential is present.

- [ ] **Step 2: Verify RED**

Run `bun test tests/config.test.ts`; expect module-not-found.

- [ ] **Step 3: Implement pure parsing and injected construction**

Expose `readRuntimeConfig(env)` and `createVotClient(config, constructors)`. Select `VOTWorkerClient` only for a worker host; otherwise create `VOTClient` with `apiToken`. Keep the cookie only in per-request headers.

- [ ] **Step 4: Verify GREEN and commit**

Run `bun test tests/config.test.ts && bun run typecheck`, then commit as `feat: configure vot clients from environment`.

### Task 8: Orchestrate translate and subtitles commands

**Files:**
- Create: `tests/app.test.ts`
- Create: `src/app.ts`
- Modify: `src/contracts.ts`

- [ ] **Step 1: Write failing application tests**

Inject fake `getVideoData`, client calls, fetch, sleep, and file functions. Test translation URL output, audio output, pending no-wait, subtitle listing, translated SRT, original VTT, selection failure metadata, `force`, and error-to-exit-code mapping.

- [ ] **Step 2: Verify RED**

Run `bun test tests/app.test.ts`; expect module-not-found.

- [ ] **Step 3: Implement `runCommand(command, runtime, deps)`**

Return `{ exitCode, envelope }`. For translation, get video data, poll, and optionally call `downloadAtomic`. For subtitles, call `getSubtitles`, return tracks when no output was requested, otherwise select a track, fetch its JSON, normalize/serialize it, and call `writeAtomic`. Pass lively-voice and cookie options only when configured.

- [ ] **Step 4: Verify GREEN and commit**

Run `bun test tests/app.test.ts && bun run typecheck`, then commit as `feat: orchestrate vot helper commands`.

### Task 9: Add the production entrypoint and subprocess contract

**Files:**
- Create: `tests/cli.test.ts`
- Create: `src/vot-helper.ts`

- [ ] **Step 1: Write failing subprocess tests**

Spawn `bun src/vot-helper.ts --help`, `--version`, an invalid command, and a missing-URL command. Assert human help, helper/VOT versions, exactly one JSON error object on stdout, diagnostics only on stderr, and stable exits.

- [ ] **Step 2: Verify RED**

Run `bun test tests/cli.test.ts`; expect missing entrypoint.

- [ ] **Step 3: Implement the thin process adapter**

Import `VOTClient`, `VOTWorkerClient`, and `getVideoData` from documented package exports. Read the exact VOT version from root `package.json`. Parse `Bun.argv.slice(2)`, handle help/version without network, build production dependencies, write one envelope for operational commands, set `process.exitCode`, and redact unexpected errors.

- [ ] **Step 4: Verify GREEN and commit**

Run `bun test tests/cli.test.ts && bun run typecheck`, then commit as `feat: add vot helper process entrypoint`.

### Task 10: Compile and smoke-test the Windows executable

**Files:**
- Create: `tests/build.test.ts`
- Create: `scripts/build.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write a failing build-contract test**

Test an exported build-argument function with `VOT_HELPER_RELEASE=vot-2.4.12-r1`. Assert compile mode, `bun-windows-x64-baseline`, `src/vot-helper.ts`, `dist/vot-helper.exe`, and a quoted compile-time release define.

- [ ] **Step 2: Verify RED**

Run `bun test tests/build.test.ts`; expect module-not-found.

- [ ] **Step 3: Implement the build script**

It must produce the equivalent of:

```powershell
bun build --compile --target=bun-windows-x64-baseline `
  --define "VOT_HELPER_RELEASE='vot-2.4.12-r1'" `
  src/vot-helper.ts --outfile dist/vot-helper.exe
```

Validate `^vot-\d+\.\d+\.\d+-r\d+$|^development$`, create `dist`, use `Bun.spawn`, and propagate failure.

- [ ] **Step 4: Verify GREEN and real compilation**

```powershell
bun test tests/build.test.ts
$env:VOT_HELPER_RELEASE='development'
bun run build
& .\dist\vot-helper.exe --help
& .\dist\vot-helper.exe --version
```

Expected: all exit 0; the EXE smoke runs without Node/Bun installed as a separate runtime.

- [ ] **Step 5: Commit**

Commit the script, test, and ignore update as `build: compile standalone windows helper`.

### Task 11: Document usage and licensing

**Files:**
- Create: `README.md`
- Create: `README-RU.md`
- Create: `LICENSE`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `.env.example`

- [ ] **Step 1: Write equivalent English and Russian guides**

Document commands/options, stdout/stderr, exit codes, environment variables, best-effort site scope, Windows x64, SmartScreen, checksums/attestation, and upstream relationships. Include `ffmpeg` examples for soft-muxing SRT and burning subtitles into video.

- [ ] **Step 2: Add safe environment examples**

List empty `VOT_WORKER_HOST`, `VOT_API_TOKEN`, and `VOT_YANDEX_COOKIE`; state that `.env` is ignored and not loaded automatically.

- [ ] **Step 3: Add licenses/notices**

Use standard MIT text with `Copyright (c) 2026 Laynholt`. Cite `FOSWLY/vot.js`, `ilyhalight/voice-over-translation`, and Bun with URLs/MIT licensing; call the EXE unofficial and unsigned.

- [ ] **Step 4: Verify and commit**

Run `rg -n "TBD|TODO|FIXME|2\.4\.17" README.md README-RU.md THIRD_PARTY_NOTICES.md .env.example`; review every match, then commit as `docs: document helper usage and licensing`.

### Task 12: Add CI, Dependabot, trusted auto-merge, and retry

**Files:**
- Create: `.github/dependabot.yml`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/dependabot-automerge.yml`
- Create: `.github/workflows/retry-live.yml`
- Create: `scripts/live-smoke.ts`

- [ ] **Step 1: Configure Dependabot**

Use npm ecosystem `/`, daily at `06:00 UTC`, open PR limit 1, target `master`, and an `allow` rule restricted to `@vot.js/node`, including major updates. Add weekly `github-actions` updates separately so Actions changes are never eligible for npm auto-merge.

- [ ] **Step 2: Implement bounded live smoke**

Use the documented upstream YouTube fixture. Request translation, validate a downloadable audio response when ready, obtain VOT subtitles, require a positive-duration cue, and serialize SRT. Use three attempts under one timeout and never print secrets.

- [ ] **Step 3: Add CI with pinned Actions**

Use only these full SHAs:

```yaml
actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5
oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6
actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
```

Run frozen install, typecheck, tests, Windows compile, EXE help/version, and a separately named `live-integration` job. Use `contents: read` and per-ref concurrency.

- [ ] **Step 4: Add privileged post-CI merge without checkout**

Trigger `workflow_run` for completed `CI`. Verify successful conclusion, one associated PR, author `dependabot[bot]`, target `master`, changed files restricted to `package.json`/`bun.lock`, and a base/head `package.json` comparison in which the only changed dependency field is `dependencies["@vot.js/node"]`. Merge via API with `contents: write` and `pull-requests: write`. Never checkout or execute PR code here.

- [ ] **Step 5: Retry only transient live failures daily**

For open Dependabot npm PRs, find the latest failed CI run. Rerun the `live-integration` job only when it failed and every non-live job succeeded or was skipped. Use only `actions: write`, `contents: read`, and `pull-requests: read`.

- [ ] **Step 6: Validate and commit**

```powershell
bun run typecheck
bun test
rg -n "uses:.*@(v[0-9]+|main|master)$" .github/workflows
```

Expected: checks pass and no floating action tags. Commit as `ci: automate dependency validation and merge`.

### Task 13: Publish immutable revisioned releases

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Add path-scoped serialized triggering**

Trigger pushes to `master` affecting `src/**`, `tests/**`, `scripts/**`, `package.json`, `bun.lock`, or the release workflow. Use repository-wide release concurrency with `cancel-in-progress: false`.

- [ ] **Step 2: Calculate `vot-X.Y.Z-rN`**

Read the exact dependency version, reject ranges, list matching tag refs, find maximum numeric revision, and export the next immutable tag.

- [ ] **Step 3: Build and verify once on Windows**

Frozen-install, typecheck, test, set `VOT_HELPER_RELEASE`, compile once, run EXE smoke, create `vot-helper-windows-x64.zip`, and write lowercase SHA-256 entries for EXE and ZIP to `SHA256SUMS.txt`.

- [ ] **Step 4: Attest and release**

Use `actions/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be` with `id-token: write` and `attestations: write`. Use `gh release create` with `contents: write`, generated notes, `--latest`, and exactly the EXE, ZIP, and checksum assets.

- [ ] **Step 5: Validate security and commit**

Run the floating-action search, parse workflow YAML, and inspect job permissions. Commit as `ci: publish revisioned helper releases`.

### Task 14: Run final verification and prepare GitHub handoff

**Files:**
- Modify only files required by a verified failure; add a failing regression test first for any behavioral defect.

- [ ] **Step 1: Run the complete local suite**

```powershell
bun install --frozen-lockfile
bun run typecheck
bun test
$env:VOT_HELPER_RELEASE='development'
bun run build
& .\dist\vot-helper.exe --help
& .\dist\vot-helper.exe --version
git diff --check
git status --short
```

Expected: zero failures, successful EXE smoke, clean diff check, and only intentional files.

- [ ] **Step 2: Audit every design requirement**

Map each line of `docs/superpowers/specs/2026-06-24-vot-helper-design.md` to an implementation, test, workflow, or documentation section. Add a failing test before correcting behavioral gaps.

- [ ] **Step 3: Configure the remote without pushing**

If absent:

```powershell
git remote add origin https://github.com/Laynholt/vot_exe.git
git remote -v
```

Expected: `origin` has the user-provided URL. Pushing remains separately authorized.

- [ ] **Step 4: Report evidence and external settings**

Report exact local test/build evidence. Identify any GitHub workflow-write settings still required. Do not claim live CI, auto-merge, attestation, or release success until GitHub has run those workflows.
