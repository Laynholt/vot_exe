# VOT Helper Design

## Goal

Build and publish a reusable, standalone Windows x64 executable around the
published `@vot.js/node` package. The executable exposes video voice-over
translation and subtitle retrieval without requiring Node.js or Bun on the
user's computer.

The repository remains small: it contains the helper source, tests, pinned
dependency metadata, documentation, and GitHub automation. Third-party VOT
code is consumed from npm rather than copied into this repository.

## Scope

The first release supports every site recognized by `@vot.js/node`. YouTube is
the guaranteed integration-test target; other supported sites are best-effort
because their behavior depends on upstream extractors and external services.

The release target is Windows x64 only, compiled with Bun's
`bun-windows-x64-baseline` target. The executable is not Authenticode-signed.

## Dependency and version model

- `@vot.js/node` is an exact, lockfile-pinned npm dependency.
- The npm publication is the authoritative VOT version, even if the upstream
  GitHub monorepository has a newer tag.
- Release tags use `vot-X.Y.Z-rN`, where `X.Y.Z` is the installed
  `@vot.js/node` version and `N` is this repository's build revision for that
  VOT version.
- Revisions are immutable. A helper-only change on the same VOT version creates
  the next `rN`; a VOT version change starts again at `r1`.

## CLI contract

The executable is named `vot-helper.exe` and provides two subcommands.

### Translation

```powershell
vot-helper.exe translate --url "https://example.com/video" \
  --source-lang auto --target-lang ru
```

Defaults:

- `--source-lang auto`
- `--target-lang ru`
- wait timeout of 15 minutes

The command obtains video metadata through `@vot.js/node`, requests a voice-over
translation, and waits while VOT reports a pending status. Polling respects the
upstream-reported delay, bounded to a safe interval. `--timeout <seconds>`
changes the overall limit, and `--no-wait` returns the current status and
translation identifier immediately.

Without `--output`, the command returns the translated audio URL and metadata.
With `--output <path>`, it also downloads the audio. Existing files are rejected
unless `--force` is present. Downloads use a temporary sibling file followed by
an atomic rename; failures remove the temporary file.

### Subtitles

```powershell
vot-helper.exe subtitles --url "https://example.com/video" \
  --target-lang ru --format srt --output subtitles.srt
```

Without `--output`, the command returns every subtitle track reported by VOT,
including original and translated track URLs and languages.

With `--output`, the default selection is a translated track matching
`--target-lang` (`ru` by default). `--original` selects the original track.
When the selection is absent or ambiguous, the command returns the available
tracks and a selection error rather than guessing.

Supported output formats are:

- `srt` (default): generated from VOT `startMs` and `durationMs` values;
- `vtt`: generated from the same millisecond timing data;
- `json`: the normalized VOT subtitle representation without timing loss.

Subtitle output uses the same temporary-file, atomic-rename, and `--force`
rules as audio downloads.

## Authentication and worker configuration

Direct `VOTClient` operation is the default. Optional runtime configuration is
read from environment variables:

- `VOT_WORKER_HOST`
- `VOT_API_TOKEN`
- `VOT_YANDEX_COOKIE`

Secrets are never accepted as command-line arguments and are never included in
logs or JSON output. The worker host is not secret and may be reported in
diagnostic metadata without credentials.

## Process output and errors

Integration commands write exactly one JSON object to standard output. The
object includes `schemaVersion: 1`, operation status, installed VOT version, and
operation-specific data. Progress and diagnostic messages go to standard error;
`--quiet` disables progress output.

Stable nonzero exit codes distinguish invalid arguments, unsupported or invalid
video data, translation failure, timeout, subtitle selection/fetch failure,
download failure, and local file I/O failure. Error JSON excludes secrets and
includes a stable machine-readable error code and a human-readable message.

`--help` is human-readable. `--version` reports both the helper release identity
and the installed `@vot.js/node` version.

## Code boundaries

The implementation is divided into focused units:

- argument parsing and command dispatch;
- VOT client creation and environment configuration;
- translation polling;
- subtitle track selection and SRT/VTT/JSON serialization;
- atomic HTTP download and file writing;
- versioned success/error envelopes and exit-code mapping.

VOT calls, sleeping, clocks, and HTTP transfers are injected at these
boundaries so behavior can be tested without external services. Production
code does not include test-only branches.

## Testing

Unit and contract tests cover:

- CLI arguments, defaults, validation, help, and version output;
- JSON schema version and stable success/error envelopes;
- waiting, polling, no-wait, timeout, and upstream failures;
- subtitle selection, missing/ambiguous tracks, and original-track selection;
- SRT and WebVTT timestamp formatting, empty cues, boundary timestamps, text
  escaping, and normalized JSON output;
- atomic download success, refusal to overwrite, `--force`, and cleanup after a
  failed transfer;
- environment-based client configuration and secret redaction.

CI also compiles the Windows executable and executes `--help` and `--version`
against it.

Dependency update PRs run blocking live checks against the YouTube URL used in
the upstream VOT examples. The checks request a translation, verify that the
audio URL is downloadable, request subtitles, verify nonempty timing data, and
validate generated SRT. Each live check receives three bounded attempts and an
overall timeout. An external outage therefore delays an update rather than
publishing an unverified binary. A daily workflow retries failed live checks on
open Dependabot PRs; build or unit-test failures are not bypassed.

## Dependency automation

Dependabot checks npm dependencies daily at 06:00 UTC and allows one open npm
update PR at a time. Patch, minor, and major `@vot.js/node` updates all use the
same automatic path.

An update PR is eligible for automatic merge only when:

- its author is `dependabot[bot]`;
- its changed files are restricted to the expected package and lock files;
- install with the frozen lockfile succeeds;
- formatting/type checks, unit tests, compilation, executable smoke tests, and
  live integration tests pass.

The automatic merge job uses minimal GitHub token permissions. Third-party
GitHub Actions are pinned to full commit SHAs.

## Release automation

A push to `master` creates a release only when binary-affecting paths changed:

- `src/**`;
- `package.json` or `bun.lock`;
- tests or build/release workflow configuration that changes the validated
  artifact.

Documentation-only changes do not create a release. Release jobs are serialized
to prevent duplicate revision numbers. The job derives the exact installed VOT
version, finds the next available revision, builds once, verifies the artifact,
and creates an immutable GitHub Release marked as Latest.

Each release contains:

- `vot-helper.exe` for automated consumers and a stable Latest asset name;
- `vot-helper-windows-x64.zip` for manual download;
- `SHA256SUMS.txt` covering both downloadable binary artifacts;
- GitHub artifact attestation/build provenance.

All earlier releases remain available for rollback. Release notes identify the
VOT version, helper revision, source commit, workflow run, unsigned-binary
status, and upstream project links.

## Repository and documentation

The default branch remains `master`. The project uses the MIT License and
includes third-party notices for VOT and the embedded Bun runtime.

`README.md` is the primary English documentation. `README-RU.md` contains the
equivalent Russian documentation. Both document installation, all CLI options,
JSON behavior, environment variables, subtitle muxing examples with `ffmpeg`,
unsigned-binary warnings, checksum/provenance verification, supported-platform
scope, and the relationship between `voice-over-translation`, `vot.js`, and
this unofficial helper.

## Explicit non-goals

- Building directly from unpublished GitHub monorepository tags.
- Bundling Node.js or Bun as a separate runtime installation.
- Windows ARM64, Linux, or macOS release artifacts.
- Authenticode signing in the initial release.
- Guaranteeing every upstream-supported site in live CI.
- Automatically deleting or replacing historical releases.
