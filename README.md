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

Defaults:

- source language: `auto`
- target language: `ru`
- translate timeout: `900` seconds
- subtitle format: `srt`

Stdout contains one JSON result for operational commands. Help and version print human-readable text. Diagnostics and error messages go to stderr.

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
