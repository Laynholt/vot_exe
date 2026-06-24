import { describe, expect, test } from "bun:test";

import { AppError, type UpstreamSubtitleTrack } from "../src/contracts";
import {
  normalizeVotCues,
  selectSubtitleTrack,
  serializeSubtitles,
} from "../src/subtitles";

const tracks: UpstreamSubtitleTrack[] = [
  {
    language: "en",
    url: "https://example.com/original-en",
    translatedLanguage: "ru",
    translatedUrl: "https://example.com/translated-en-ru",
  },
  {
    language: "de",
    url: "https://example.com/original-de",
    translatedLanguage: "ru",
    translatedUrl: "https://example.com/translated-de-ru",
  },
  {
    language: "ja",
    url: "https://example.com/original-ja",
    translatedLanguage: "en",
    translatedUrl: "https://example.com/translated-ja-en",
  },
];

function expectSubtitleError(operation: () => unknown): AppError {
  try {
    operation();
    throw new Error("Expected operation to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("subtitles");
    return error as AppError;
  }
}

describe("selectSubtitleTrack", () => {
  test("selects a unique translated Russian track", () => {
    expect(
      selectSubtitleTrack([tracks[0]!], {
        original: false,
        sourceLang: "auto",
        targetLang: "ru",
      }),
    ).toEqual({
      kind: "translated",
      language: "ru",
      url: "https://example.com/translated-en-ru",
      translatedFromLanguage: "en",
    });
  });

  test("narrows translated selection by an explicit source language", () => {
    expect(
      selectSubtitleTrack(tracks, {
        original: false,
        sourceLang: "de",
        targetLang: "ru",
      }),
    ).toEqual({
      kind: "translated",
      language: "ru",
      url: "https://example.com/translated-de-ru",
      translatedFromLanguage: "de",
    });
  });

  test("ignores translated tracks whose URL is empty", () => {
    expect(
      selectSubtitleTrack(
        [
          { ...tracks[0]!, translatedUrl: "" },
          tracks[1]!,
        ],
        { original: false, sourceLang: "auto", targetLang: "ru" },
      ),
    ).toMatchObject({ translatedFromLanguage: "de" });
  });

  test("selects an original track by explicit source language", () => {
    expect(
      selectSubtitleTrack(tracks, {
        original: true,
        sourceLang: "ja",
        targetLang: "ru",
      }),
    ).toEqual({
      kind: "original",
      language: "ja",
      url: "https://example.com/original-ja",
    });
  });

  test("selects the only original track when source language is auto", () => {
    expect(
      selectSubtitleTrack([tracks[0]!], {
        original: true,
        sourceLang: "auto",
        targetLang: "ru",
      }),
    ).toEqual({
      kind: "original",
      language: "en",
      url: "https://example.com/original-en",
    });
  });

  test("throws for no match with safe available-track details", () => {
    const error = expectSubtitleError(() =>
      selectSubtitleTrack(tracks, {
        original: false,
        sourceLang: "en",
        targetLang: "fr",
      }),
    );

    expect(error.message).toContain("No subtitle track");
    expect(error.details).toEqual({
      availableTracks: [
        { language: "en", translatedLanguage: "ru" },
        { language: "de", translatedLanguage: "ru" },
        { language: "ja", translatedLanguage: "en" },
      ],
    });
    expect(JSON.stringify(error.details)).not.toContain("https://");
  });

  test("throws instead of guessing when selection is ambiguous", () => {
    const error = expectSubtitleError(() =>
      selectSubtitleTrack(tracks, {
        original: false,
        sourceLang: "auto",
        targetLang: "ru",
      }),
    );

    expect(error.message).toContain("ambiguous");
    expect(error.details).toEqual({
      availableTracks: [
        { language: "en", translatedLanguage: "ru" },
        { language: "de", translatedLanguage: "ru" },
        { language: "ja", translatedLanguage: "en" },
      ],
    });
    expect(JSON.stringify(error.details)).not.toContain("https://");
  });
});

describe("normalizeVotCues", () => {
  test("accepts a direct cue array and strips upstream fields", () => {
    expect(
      normalizeVotCues([
        { text: "Hello", startMs: 12, durationMs: 34, speaker: "Alice" },
      ]),
    ).toEqual([{ text: "Hello", startMs: 12, durationMs: 34 }]);
  });

  test("accepts a subtitles object", () => {
    expect(
      normalizeVotCues({
        subtitles: [{ text: "Привет", startMs: 0, durationMs: 1500 }],
      }),
    ).toEqual([{ text: "Привет", startMs: 0, durationMs: 1500 }]);
  });

  test("normalizes newlines, drops blank cues, and sorts stably", () => {
    expect(
      normalizeVotCues([
        { text: "second-a\r\nline", startMs: 20, durationMs: 5 },
        { text: "first\rline", startMs: 10, durationMs: 5 },
        { text: "  \r\n\t", startMs: 15, durationMs: 5 },
        { text: "second-b", startMs: 20, durationMs: 6 },
      ]),
    ).toEqual([
      { text: "first\nline", startMs: 10, durationMs: 5 },
      { text: "second-a\nline", startMs: 20, durationMs: 5 },
      { text: "second-b", startMs: 20, durationMs: 6 },
    ]);
  });

  test.each([
    [null, "null payload"],
    ["captions", "string payload"],
    [{}, "object without subtitles"],
    [{ subtitles: {} }, "non-array subtitles"],
    [[null], "null cue"],
    [[{ text: 42, startMs: 0, durationMs: 1 }], "non-string text"],
    [[{ text: "x", startMs: -1, durationMs: 1 }], "negative start"],
    [[{ text: "x", startMs: Number.NaN, durationMs: 1 }], "NaN start"],
    [[{ text: "x", startMs: Number.POSITIVE_INFINITY, durationMs: 1 }], "infinite start"],
    [[{ text: "x", startMs: 0, durationMs: 0 }], "zero duration"],
    [[{ text: "x", startMs: 0, durationMs: -1 }], "negative duration"],
    [[{ text: "x", startMs: 0, durationMs: Number.NaN }], "NaN duration"],
    [[{ text: "x", startMs: 0, durationMs: Number.NEGATIVE_INFINITY }], "infinite duration"],
  ] as const)("rejects invalid %s", (input) => {
    expectSubtitleError(() => normalizeVotCues(input));
  });
});

describe("serializeSubtitles", () => {
  test("serializes exact SRT with boundary carry, multiline text, CRLF, and terminal CRLF", () => {
    expect(
      serializeSubtitles(
        [
          { text: "Hello\nworld & <friends>", startMs: 3_723_004, durationMs: 1_996 },
          { text: "Long run", startMs: 360_000_000, durationMs: 1 },
        ],
        "srt",
      ),
    ).toBe(
      "1\r\n01:02:03,004 --> 01:02:05,000\r\nHello\r\nworld & <friends>\r\n\r\n" +
        "2\r\n100:00:00,000 --> 100:00:00,001\r\nLong run\r\n",
    );
  });

  test("serializes exact VTT and escapes cue text", () => {
    expect(
      serializeSubtitles(
        [
          { text: "Hello\nworld & <friends>", startMs: 3_723_004, durationMs: 1_996 },
          { text: "Long > run", startMs: 360_000_000, durationMs: 1 },
        ],
        "vtt",
      ),
    ).toBe(
      "WEBVTT\r\n\r\n" +
        "01:02:03.004 --> 01:02:05.000\r\nHello\r\nworld &amp; &lt;friends&gt;\r\n\r\n" +
        "100:00:00.000 --> 100:00:00.001\r\nLong &gt; run\r\n",
    );
  });

  test("serializes deterministic pretty JSON with a newline and no timing loss", () => {
    const cues = [
      { text: "Precise", startMs: 0.25, durationMs: 1.5 },
      { text: "Later", startMs: 2, durationMs: 3 },
    ];

    const serialized = serializeSubtitles(cues, "json");

    expect(serialized).toBe(`${JSON.stringify(cues, null, 2)}\n`);
    expect(JSON.parse(serialized)).toEqual(cues);
  });

  test("does not mutate cue objects or their order", () => {
    const cues = [
      { text: "late", startMs: 10, durationMs: 2 },
      { text: "early", startMs: 0, durationMs: 1 },
    ];
    const before = structuredClone(cues);

    serializeSubtitles(cues, "srt");
    serializeSubtitles(cues, "vtt");
    serializeSubtitles(cues, "json");

    expect(cues).toEqual(before);
  });
});
