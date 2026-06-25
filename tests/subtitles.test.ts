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

  test("deduplicates repeated original candidates with the same language and URL", () => {
    expect(
      selectSubtitleTrack(
        [
          tracks[0]!,
          {
            ...tracks[0]!,
            translatedLanguage: "de",
            translatedUrl: "https://example.com/translated-en-de",
          },
        ],
        { original: true, sourceLang: "en", targetLang: "ru" },
      ),
    ).toEqual({
      kind: "original",
      language: "en",
      url: "https://example.com/original-en",
    });
  });

  test("deduplicates repeated translated candidates from the same source", () => {
    expect(
      selectSubtitleTrack(
        [tracks[0]!, { ...tracks[0]! }],
        { original: false, sourceLang: "auto", targetLang: "ru" },
      ),
    ).toEqual({
      kind: "translated",
      language: "ru",
      url: "https://example.com/translated-en-ru",
      translatedFromLanguage: "en",
    });
  });

  test("keeps translated candidates from different source languages ambiguous", () => {
    const sharedUrl = "https://example.com/shared-translation";
    const error = expectSubtitleError(() =>
      selectSubtitleTrack(
        [
          { ...tracks[0]!, translatedUrl: sharedUrl },
          { ...tracks[1]!, translatedUrl: sharedUrl },
        ],
        { original: false, sourceLang: "auto", targetLang: "ru" },
      ),
    );

    expect(error.message).toContain("ambiguous");
  });

  test("ignores malformed candidates when a valid equivalent is available", () => {
    expect(
      selectSubtitleTrack(
        [
          { ...tracks[0]!, url: "file:///private/original" },
          tracks[0]!,
        ],
        { original: true, sourceLang: "en", targetLang: "ru" },
      ),
    ).toEqual({
      kind: "original",
      language: "en",
      url: "https://example.com/original-en",
    });
  });

  test.each([
    [
      "blank original URL",
      [{ ...tracks[0]!, url: "" }],
      { original: true, sourceLang: "en", targetLang: "ru" },
    ],
    [
      "non-HTTP original URL",
      [{ ...tracks[0]!, url: "ftp://example.com/original-en" }],
      { original: true, sourceLang: "en", targetLang: "ru" },
    ],
    [
      "blank translated URL",
      [{ ...tracks[0]!, translatedUrl: "" }],
      { original: false, sourceLang: "en", targetLang: "ru" },
    ],
    [
      "non-HTTP translated URL",
      [{ ...tracks[0]!, translatedUrl: "file:///private/subtitles" }],
      { original: false, sourceLang: "en", targetLang: "ru" },
    ],
  ] as const)("rejects %s", (_label, candidateTracks, options) => {
    const error = expectSubtitleError(() =>
      selectSubtitleTrack(candidateTracks, options),
    );
    expect(JSON.stringify(error.details)).not.toContain("://");
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

  test("preserves cue-internal blank lines for JSON but protects SRT and VTT blocks", () => {
    const cues = normalizeVotCues([
      { text: "line1\r\n\rline2", startMs: 0, durationMs: 1 },
    ]);

    expect(cues).toEqual([
      { text: "line1\n\nline2", startMs: 0, durationMs: 1 },
    ]);
    expect(serializeSubtitles(cues, "json")).toBe(
      `${JSON.stringify(cues, null, 2)}\n`,
    );
    expect(serializeSubtitles(cues, "srt")).toBe(
      "1\r\n00:00:00,000 --> 00:00:00,001\r\nline1\r\n\u00a0\r\nline2\r\n",
    );
    expect(serializeSubtitles(cues, "vtt")).toBe(
      "WEBVTT\r\n\r\n00:00:00.000 --> 00:00:00.001\r\nline1\r\n\u00a0\r\nline2\r\n",
    );
  });

  test("preserves finite fractional timing losslessly", () => {
    const cues = normalizeVotCues([
      { text: "sub-ms", startMs: 0.25, durationMs: 0.1 },
      { text: "boundary", startMs: 999.9, durationMs: 0.2 },
    ]);

    expect(cues).toEqual([
      { text: "sub-ms", startMs: 0.25, durationMs: 0.1 },
      { text: "boundary", startMs: 999.9, durationMs: 0.2 },
    ]);
    expect(JSON.parse(serializeSubtitles(cues, "json"))).toEqual(cues);
  });

  test("rejects payloads containing no nonblank cues", () => {
    expectSubtitleError(() => normalizeVotCues([]));
    expectSubtitleError(() =>
      normalizeVotCues([
        { text: " \r\n\t", startMs: 0, durationMs: 1 },
        { text: "", startMs: 1, durationMs: 1 },
      ]),
    );
  });

  test.each([
    ["null payload", null],
    ["string payload", "captions"],
    ["object without subtitles", {}],
    ["non-array subtitles", { subtitles: {} }],
  ] as const)("rejects %s", (_label, input) => {
    expectSubtitleError(() => normalizeVotCues(input));
  });

  test.each([
    ["null cue", null],
    ["non-string text", { text: 42, startMs: 0, durationMs: 1 }],
    ["negative start", { text: "x", startMs: -1, durationMs: 1 }],
    ["NaN start", { text: "x", startMs: Number.NaN, durationMs: 1 }],
    [
      "infinite start",
      { text: "x", startMs: Number.POSITIVE_INFINITY, durationMs: 1 },
    ],
    ["zero duration", { text: "x", startMs: 0, durationMs: 0 }],
    ["negative duration", { text: "x", startMs: 0, durationMs: -1 }],
    ["NaN duration", { text: "x", startMs: 0, durationMs: Number.NaN }],
    [
      "infinite duration",
      { text: "x", startMs: 0, durationMs: Number.NEGATIVE_INFINITY },
    ],
    [
      "overflowing end",
      { text: "x", startMs: Number.MAX_VALUE, durationMs: Number.MAX_VALUE },
    ],
    [
      "non-increasing end",
      { text: "x", startMs: Number.MAX_VALUE, durationMs: Number.MIN_VALUE },
    ],
  ] as const)("rejects %s with its cue index", (_label, invalidCue) => {
    const error = expectSubtitleError(() =>
      normalizeVotCues([
        { text: "valid", startMs: 0, durationMs: 1 },
        invalidCue,
      ]),
    );

    expect(error.details).toEqual({ cueIndex: 1 });
  });
});

describe("serializeSubtitles", () => {
  test("uses floor(start) and ceil(end) for fractional and sub-ms cues", () => {
    const cues = normalizeVotCues([
      { text: "sub-ms", startMs: 0.25, durationMs: 0.1 },
      { text: "boundary", startMs: 999.9, durationMs: 0.2 },
    ]);

    expect(serializeSubtitles(cues, "srt")).toBe(
      "1\r\n00:00:00,000 --> 00:00:00,001\r\nsub-ms\r\n\r\n" +
        "2\r\n00:00:00,999 --> 00:00:01,001\r\nboundary\r\n",
    );
    expect(serializeSubtitles(cues, "vtt")).toBe(
      "WEBVTT\r\n\r\n" +
        "00:00:00.000 --> 00:00:00.001\r\nsub-ms\r\n\r\n" +
        "00:00:00.999 --> 00:00:01.001\r\nboundary\r\n",
    );
  });

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
      { text: "Precise", startMs: 3_723_004, durationMs: 1_996 },
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
