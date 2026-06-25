# vot-helper

Standalone Windows x64 CLI for VOT audio translation and timed subtitle export.

This project builds an unofficial helper executable around the pinned npm package `@vot.js/node` `2.4.12`. Users do not need Node.js or Bun when using the published `vot-helper.exe`.

## Download and verification

Release assets are unsigned. Windows SmartScreen may warn on first launch.

For each release, verify the downloaded files with `SHA256SUMS.txt` and GitHub build provenance/attestation before trusting the executable.

## Commands

```powershell
vot-helper.exe translate --url https://youtu.be/example
vot-helper.exe translate --url https://youtu.be/example --output audio.mp3 --force
vot-helper.exe subtitles --url https://youtu.be/example
vot-helper.exe subtitles --url https://youtu.be/example --output subtitles.srt
vot-helper.exe subtitles --url https://youtu.be/example --original --source-lang en --format vtt --output original.vtt
```

The executable has two operational commands:

- `translate` asks VOT for a translated Russian audio track by default. If the translation is cached upstream, the command can return quickly. If not, it polls VOT until the translation is ready or the timeout expires.
- `subtitles` asks VOT for subtitle track metadata. Without `--output`, it lists available tracks. With `--output`, it selects one track, downloads its VOT subtitle JSON, normalizes cues, and writes SRT/VTT/JSON.

Defaults:

- source language: `auto`
- target language: `ru`
- translate timeout: `900` seconds
- subtitle format: `srt`

Stdout contains one JSON result for operational commands. Help and version print human-readable text. Diagnostics and error messages go to stderr.

## Flag reference

Global forms:

```powershell
vot-helper.exe --help
vot-helper.exe --version
vot-helper.exe translate --help
vot-helper.exe subtitles --help
```

`translate` flags:

| Flag | Value | Default | Meaning |
| --- | --- | --- | --- |
| `--url` | HTTP(S) URL | required | Video URL supported by upstream VOT site helpers. |
| `--source-lang` | language code | `auto` | Source language passed to VOT. Use explicit values such as `en` when auto-selection is ambiguous. |
| `--target-lang` | language code | `ru` | Target translation language. |
| `--timeout` | positive integer seconds | `900` | Maximum polling time when translation is not ready. |
| `--no-wait` | none | `false` | Return pending status after the first VOT response instead of polling. |
| `--lively-voice` | none | `false` | Request lively synthesized voice. Requires `VOT_API_TOKEN` or `VOT_YANDEX_COOKIE`. |
| `--output` | path | omitted | Download the translated audio to this path. Without it, the JSON contains the temporary audio URL. |
| `--force` | none | `false` | Overwrite existing output file atomically. |
| `--quiet` | none | `false` | Reserved for suppressing non-error progress logs. |

`subtitles` flags:

| Flag | Value | Default | Meaning |
| --- | --- | --- | --- |
| `--url` | HTTP(S) URL | required | Video URL supported by upstream VOT site helpers. |
| `--source-lang` | language code | `auto` | Source subtitle language. Set explicitly when VOT exposes several source tracks for the same target language. |
| `--target-lang` | language code | `ru` | Target translated subtitle language. |
| `--format` | `srt`, `vtt`, `json` | `srt` | Output subtitle format. |
| `--original` | none | `false` | Select original subtitles instead of translated subtitles. |
| `--output` | path | omitted | Write selected subtitles. Without it, the command lists available track metadata. |
| `--force` | none | `false` | Overwrite existing output file atomically. |
| `--quiet` | none | `false` | Reserved for suppressing non-error progress logs. |

## JSON contract for integrations

Operational commands always write exactly one JSON object followed by a newline to stdout. Stderr is for human diagnostics and should not be parsed as data.

Successful envelope:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "operation": "translate",
  "helperVersion": "0.1.0",
  "votVersion": "2.4.12",
  "data": {}
}
```

Error envelope:

```json
{
  "schemaVersion": 1,
  "ok": false,
  "operation": "subtitles",
  "helperVersion": "0.1.0",
  "votVersion": "2.4.12",
  "error": {
    "code": "subtitles",
    "message": "Subtitle track selection is ambiguous.",
    "details": {}
  }
}
```

Typical `translate` success without `--output`:

```json
{
  "state": "ready",
  "translationId": "355844302",
  "audioUrl": "https://...",
  "status": 1
}
```

Typical `translate` success with `--output` adds:

```json
{
  "output": {
    "path": "C:\\absolute\\audio.mp3",
    "bytes": 12963466,
    "contentType": "audio/mpeg"
  }
}
```

Typical pending response with `--no-wait`:

```json
{
  "state": "pending",
  "translationId": "tr-pending",
  "remainingTimeSeconds": 30,
  "status": 2
}
```

Typical `subtitles` listing data:

```json
{
  "waiting": false,
  "tracks": [
    { "language": "en", "translatedLanguage": "ru" }
  ]
}
```

Typical `subtitles` export data:

```json
{
  "waiting": false,
  "selectedTrack": {
    "kind": "translated",
    "language": "ru",
    "translatedFromLanguage": "en",
    "url": "https://..."
  },
  "output": {
    "path": "C:\\absolute\\subtitles.srt",
    "bytes": 31093
  }
}
```

For privacy and stability, selection error metadata intentionally omits raw signed subtitle/audio URLs.

## Subprocess integration pattern

Recommended integration flow from another app:

1. Ship or download `vot-helper.exe`.
2. Spawn it as a child process.
3. Pass secrets only through environment variables.
4. Parse stdout as a single JSON line for operational commands.
5. Treat non-zero exit code as failure and inspect `error.code`.
6. Use stderr only for logs shown to humans.

Example pseudo-code:

```ts
const child = spawn("vot-helper.exe", [
  "translate",
  "--url", videoUrl,
  "--target-lang", "ru",
  "--output", outputPath,
  "--force",
], {
  env: {
    ...process.env,
    VOT_WORKER_HOST: "",
    VOT_API_TOKEN: token,
  },
});

const result = JSON.parse(await readAll(child.stdout));
if (!result.ok) throw new Error(result.error.message);
```

File writes are atomic: the helper writes to a sibling temporary file and renames it into place only after success. Existing output files are refused unless `--force` is provided.

## Environment

The helper reads these optional variables from the process environment:

- `VOT_WORKER_HOST` — use a VOT worker host instead of direct VOT client requests.
- `VOT_API_TOKEN` — API token for VOT requests.
- `VOT_YANDEX_COOKIE` — Yandex cookie, for example a `Session_id` value, sent only as per-request headers.

`.env` files are ignored by git and are not loaded automatically.

## Exit codes

- `2` invalid arguments
- `3` video data failure
- `4` translation failure
- `5` translation timeout
- `6` subtitles failure
- `7` download failure
- `8` file I/O failure
- `9` configuration failure
- `10` unexpected failure

## Subtitles and ffmpeg

VOT subtitle JSON is normalized to `{ text, startMs, durationMs }` cues and can be exported as SRT, VTT, or JSON. SRT/VTT timestamps are generated from cue timings, so they can be muxed or burned into video with ffmpeg.

Soft-mux subtitles:

```powershell
ffmpeg -i input.mp4 -i subtitles.srt -c copy -c:s mov_text output.mp4
```

Burn subtitles into the video:

```powershell
ffmpeg -i input.mp4 -vf "subtitles=subtitles.srt" -c:a copy output-burned.mp4
```

## Site scope

The helper delegates site support to upstream VOT packages. It is best-effort and may change when `@vot.js/node` changes.

## Upstream

This repository does not vendor VOT source code. It pins `@vot.js/node` as a dependency and builds an executable in GitHub Actions.

Upstream projects:

- `FOSWLY/vot.js`
- `ilyhalight/voice-over-translation`
- Bun
