import { describe, expect, test } from "bun:test";

import { HELP_TEXT, parseArgs } from "../src/args";
import { ArgumentError } from "../src/contracts";

function expectArgumentError(argv: string[], message: string): void {
  try {
    parseArgs(argv);
    throw new Error("Expected parseArgs to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(ArgumentError);
    expect((error as Error).message).toBe(message);
  }
}

describe("parseArgs", () => {
  test("returns the exact translate defaults without an output property", () => {
    const command = parseArgs(["translate", "--url", "https://example.com/video"]);

    expect(command).toEqual({
      kind: "translate",
      url: "https://example.com/video",
      sourceLang: "auto",
      targetLang: "ru",
      timeoutSeconds: 900,
      noWait: false,
      livelyVoice: false,
      force: false,
      quiet: false,
    });
    expect("output" in command).toBe(false);
  });

  test("returns subtitles defaults and preserves output", () => {
    expect(
      parseArgs([
        "subtitles",
        "--url",
        "http://example.com/watch?v=42",
        "--output",
        "captions.srt",
      ]),
    ).toEqual({
      kind: "subtitles",
      url: "http://example.com/watch?v=42",
      sourceLang: "auto",
      targetLang: "ru",
      format: "srt",
      original: false,
      output: "captions.srt",
      force: false,
      quiet: false,
    });
  });

  test("parses every non-default translate flag", () => {
    expect(
      parseArgs([
        "translate",
        "--url",
        "https://example.com/video",
        "--source-lang",
        "en",
        "--target-lang",
        "de",
        "--timeout",
        "45",
        "--no-wait",
        "--lively-voice",
        "--output",
        "voice.mp3",
        "--force",
        "--quiet",
      ]),
    ).toEqual({
      kind: "translate",
      url: "https://example.com/video",
      sourceLang: "en",
      targetLang: "de",
      timeoutSeconds: 45,
      noWait: true,
      livelyVoice: true,
      output: "voice.mp3",
      force: true,
      quiet: true,
    });
  });

  test("parses every non-default subtitles flag", () => {
    expect(
      parseArgs([
        "subtitles",
        "--url",
        "https://example.com/video",
        "--source-lang",
        "ja",
        "--target-lang",
        "en",
        "--format",
        "json",
        "--original",
        "--output",
        "captions.json",
        "--force",
        "--quiet",
      ]),
    ).toEqual({
      kind: "subtitles",
      url: "https://example.com/video",
      sourceLang: "ja",
      targetLang: "en",
      format: "json",
      original: true,
      output: "captions.json",
      force: true,
      quiet: true,
    });
  });

  test.each([
    [["--help"], { kind: "help" }],
    [["help"], { kind: "help" }],
    [["translate", "--help"], { kind: "help" }],
    [["subtitles", "--help"], { kind: "help" }],
    [["--version"], { kind: "version" }],
    [["version"], { kind: "version" }],
  ] as const)("parses help and version form %#", (argv, expected) => {
    expect(parseArgs([...argv])).toEqual(expected);
  });

  test.each(["translate", "subtitles"] as const)(
    "rejects a missing URL for %s",
    (kind) => {
      expectArgumentError([kind], `Missing required option --url for ${kind}.`);
    },
  );

  test.each(["translate", "subtitles"] as const)(
    "rejects a non-HTTP URL for %s",
    (kind) => {
      expectArgumentError(
        [kind, "--url", "file:///tmp/video.mp4"],
        'Invalid value for --url: expected an http:// or https:// URL, received "file:///tmp/video.mp4".',
      );
    },
  );

  test.each(["0", "-1", "1.5", "1e3", "forever"])(
    "rejects invalid translate timeout %s",
    (timeout) => {
      expectArgumentError(
        ["translate", "--url", "https://example.com", "--timeout", timeout],
        `Invalid value for --timeout: expected a positive integer, received "${timeout}".`,
      );
    },
  );

  test("rejects an unsupported subtitles format", () => {
    expectArgumentError(
      ["subtitles", "--url", "https://example.com", "--format", "ass"],
      'Invalid value for --format: expected srt, vtt, or json, received "ass".',
    );
  });

  test.each([
    [["translate", "--url", "https://example.com", "--source-lang"], "--source-lang"],
    [
      ["subtitles", "--url", "https://example.com", "--format", "--original"],
      "--format",
    ],
  ] as const)("rejects a missing option value for %s", (argv, option) => {
    expectArgumentError([...argv], `Missing value for ${option}.`);
  });

  test.each(["translate", "subtitles"] as const)(
    "rejects an unknown option for %s",
    (kind) => {
      expectArgumentError(
        [kind, "--url", "https://example.com", "--wat"],
        `Unknown option for ${kind}: --wat.`,
      );
    },
  );

  test("rejects a subtitles-only flag for translate", () => {
    expectArgumentError(
      ["translate", "--url", "https://example.com", "--original"],
      "Option --original is not valid for translate.",
    );
  });

  test("rejects translate --format", () => {
    expectArgumentError(
      ["translate", "--url", "https://example.com", "--format", "vtt"],
      "Option --format is not valid for translate.",
    );
  });

  test("rejects a translate-only flag for subtitles", () => {
    expectArgumentError(
      ["subtitles", "--url", "https://example.com", "--no-wait"],
      "Option --no-wait is not valid for subtitles.",
    );
  });

  test("rejects subtitles --timeout", () => {
    expectArgumentError(
      ["subtitles", "--url", "https://example.com", "--timeout", "30"],
      "Option --timeout is not valid for subtitles.",
    );
  });

  test("rejects subtitles --lively-voice", () => {
    expectArgumentError(
      ["subtitles", "--url", "https://example.com", "--lively-voice"],
      "Option --lively-voice is not valid for subtitles.",
    );
  });

  test("rejects an unknown command", () => {
    expectArgumentError(["download"], "Unknown command: download.");
  });
});

describe("HELP_TEXT", () => {
  test("names vot-helper.exe in every usage form", () => {
    expect(HELP_TEXT).toContain(
      "vot-helper.exe translate --url <http(s)-url> [options]",
    );
    expect(HELP_TEXT).toContain(
      "vot-helper.exe subtitles --url <http(s)-url> [options]",
    );
    expect(HELP_TEXT).toContain("vot-helper.exe --help | vot-helper.exe help");
    expect(HELP_TEXT).toContain("vot-helper.exe --version | vot-helper.exe version");
  });

  test("documents commands, defaults, flags, streams, and environment", () => {
    for (const text of [
      "translate",
      "subtitles",
      "--url",
      "--source-lang",
      "--target-lang",
      "--timeout",
      "--no-wait",
      "--lively-voice",
      "--format",
      "--original",
      "--output",
      "--force",
      "--quiet",
      "--help",
      "--version",
      "auto",
      "ru",
      "900",
      "srt",
      "stdout",
      "stderr",
      "VOT_WORKER_HOST",
      "VOT_API_TOKEN",
      "VOT_YANDEX_COOKIE",
    ]) {
      expect(HELP_TEXT).toContain(text);
    }
  });
});
