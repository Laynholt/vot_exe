import {
  ArgumentError,
  type ParsedCommand,
  type SubtitlesCommand,
  type SubtitlesFormat,
  type TranslateCommand,
} from "./contracts";

export const HELP_TEXT = `vot-helper translates video audio and retrieves subtitles.

Usage:
  vot translate --url <http(s)-url> [options]
  vot subtitles --url <http(s)-url> [options]
  vot --help | vot help
  vot --version | vot version

Commands:
  translate   Create or retrieve a translated audio track.
  subtitles   Retrieve translated or original subtitles.

Global options:
  --help      Show this help text. Also valid after a subcommand.
  --version   Show the installed version.

Translate options:
  --url <url>             Video URL; http:// or https:// is required.
  --source-lang <code>    Source language code (default: auto).
  --target-lang <code>    Target language code (default: ru).
  --timeout <seconds>     Positive integer wait timeout (default: 900).
  --no-wait               Return without waiting for translation (default: false).
  --lively-voice          Request a lively synthesized voice (default: false).
  --output <path>         Write the audio payload to this optional path.
  --force                 Overwrite an existing output file (default: false).
  --quiet                 Suppress non-error progress logs (default: false).

Subtitles options:
  --url <url>             Video URL; http:// or https:// is required.
  --source-lang <code>    Source language code (default: auto).
  --target-lang <code>    Target language code (default: ru).
  --format <format>       Subtitle format: srt, vtt, or json (default: srt).
  --original              Retrieve original subtitles (default: false).
  --output <path>         Write subtitles to this optional path.
  --force                 Overwrite an existing output file (default: false).
  --quiet                 Suppress non-error progress logs (default: false).

Output:
  Successful commands write a JSON result to stdout.
  Progress, diagnostics, and errors are written to stderr.

Environment:
  VOT_WORKER_HOST          Override the VOT worker host.
  VOT_API_TOKEN            Authenticate requests with a VOT API token.
  VOT_YANDEX_COOKIE        Supply a Yandex session cookie when required.`;

const TRANSLATE_ONLY_OPTIONS = new Set(["--timeout", "--no-wait", "--lively-voice"]);
const SUBTITLES_ONLY_OPTIONS = new Set(["--format", "--original"]);

function readValue(argv: string[], optionIndex: number, option: string): string {
  const value = argv[optionIndex + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new ArgumentError(`Missing value for ${option}.`);
  }
  return value;
}

function validateUrl(url: string | undefined, command: "translate" | "subtitles"): string {
  if (url === undefined) {
    throw new ArgumentError(`Missing required option --url for ${command}.`);
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return url;
    }
  } catch {
    // The shared error below covers malformed and unsupported URLs.
  }

  throw new ArgumentError(
    `Invalid value for --url: expected an http:// or https:// URL, received "${url}".`,
  );
}

function parseTimeout(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ArgumentError(
      `Invalid value for --timeout: expected a positive integer, received "${value}".`,
    );
  }

  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout)) {
    throw new ArgumentError(
      `Invalid value for --timeout: expected a positive integer, received "${value}".`,
    );
  }
  return timeout;
}

function parseTranslate(argv: string[]): TranslateCommand {
  let url: string | undefined;
  let sourceLang = "auto";
  let targetLang = "ru";
  let timeoutSeconds = 900;
  let noWait = false;
  let livelyVoice = false;
  let output: string | undefined;
  let force = false;
  let quiet = false;

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === undefined) {
      continue;
    }

    if (SUBTITLES_ONLY_OPTIONS.has(option)) {
      throw new ArgumentError(`Option ${option} is not valid for translate.`);
    }

    switch (option) {
      case "--url":
        url = readValue(argv, index, option);
        index += 1;
        break;
      case "--source-lang":
        sourceLang = readValue(argv, index, option);
        index += 1;
        break;
      case "--target-lang":
        targetLang = readValue(argv, index, option);
        index += 1;
        break;
      case "--timeout":
        timeoutSeconds = parseTimeout(readValue(argv, index, option));
        index += 1;
        break;
      case "--no-wait":
        noWait = true;
        break;
      case "--lively-voice":
        livelyVoice = true;
        break;
      case "--output":
        output = readValue(argv, index, option);
        index += 1;
        break;
      case "--force":
        force = true;
        break;
      case "--quiet":
        quiet = true;
        break;
      default:
        throw new ArgumentError(`Unknown option for translate: ${option}.`);
    }
  }

  return {
    kind: "translate",
    url: validateUrl(url, "translate"),
    sourceLang,
    targetLang,
    timeoutSeconds,
    noWait,
    livelyVoice,
    ...(output === undefined ? {} : { output }),
    force,
    quiet,
  };
}

function parseSubtitlesFormat(value: string): SubtitlesFormat {
  if (value === "srt" || value === "vtt" || value === "json") {
    return value;
  }
  throw new ArgumentError(
    `Invalid value for --format: expected srt, vtt, or json, received "${value}".`,
  );
}

function parseSubtitles(argv: string[]): SubtitlesCommand {
  let url: string | undefined;
  let sourceLang = "auto";
  let targetLang = "ru";
  let format: SubtitlesFormat = "srt";
  let original = false;
  let output: string | undefined;
  let force = false;
  let quiet = false;

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === undefined) {
      continue;
    }

    if (TRANSLATE_ONLY_OPTIONS.has(option)) {
      throw new ArgumentError(`Option ${option} is not valid for subtitles.`);
    }

    switch (option) {
      case "--url":
        url = readValue(argv, index, option);
        index += 1;
        break;
      case "--source-lang":
        sourceLang = readValue(argv, index, option);
        index += 1;
        break;
      case "--target-lang":
        targetLang = readValue(argv, index, option);
        index += 1;
        break;
      case "--format":
        format = parseSubtitlesFormat(readValue(argv, index, option));
        index += 1;
        break;
      case "--original":
        original = true;
        break;
      case "--output":
        output = readValue(argv, index, option);
        index += 1;
        break;
      case "--force":
        force = true;
        break;
      case "--quiet":
        quiet = true;
        break;
      default:
        throw new ArgumentError(`Unknown option for subtitles: ${option}.`);
    }
  }

  return {
    kind: "subtitles",
    url: validateUrl(url, "subtitles"),
    sourceLang,
    targetLang,
    format,
    original,
    ...(output === undefined ? {} : { output }),
    force,
    quiet,
  };
}

export function parseArgs(argv: string[]): ParsedCommand {
  const command = argv[0];
  if (command === undefined) {
    throw new ArgumentError("Missing command. Use --help for usage.");
  }

  if (argv.length === 1 && (command === "--help" || command === "help")) {
    return { kind: "help" };
  }
  if (argv.length === 1 && (command === "--version" || command === "version")) {
    return { kind: "version" };
  }

  if (
    (command === "translate" || command === "subtitles") &&
    argv.length === 2 &&
    argv[1] === "--help"
  ) {
    return { kind: "help" };
  }

  if (command === "translate") {
    return parseTranslate(argv.slice(1));
  }
  if (command === "subtitles") {
    return parseSubtitles(argv.slice(1));
  }

  throw new ArgumentError(`Unknown command: ${command}.`);
}
