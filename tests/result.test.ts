import { describe, expect, test } from "bun:test";

import { AppError, EXIT_CODES } from "../src/contracts";
import {
  errorEnvelope,
  normalizeError,
  redactSecrets,
  serializeEnvelope,
  successEnvelope,
} from "../src/result";

const context = {
  operation: "translate",
  helperVersion: "0.1.0",
  votVersion: "2.4.12",
};

describe("result envelopes", () => {
  test("creates the exact versioned success shape", () => {
    expect(
      successEnvelope({
        ...context,
        data: { output: "voice.mp3" },
      }),
    ).toEqual({
      schemaVersion: 1,
      ok: true,
      operation: "translate",
      helperVersion: "0.1.0",
      votVersion: "2.4.12",
      data: { output: "voice.mp3" },
    });
  });

  test("defines every exit code exactly", () => {
    expect(EXIT_CODES).toEqual({
      invalidArguments: 2,
      videoData: 3,
      translation: 4,
      timeout: 5,
      subtitles: 6,
      download: 7,
      fileIO: 8,
      configuration: 9,
      unexpected: 10,
    });
  });

  test.each(Object.entries(EXIT_CODES))(
    "maps AppError code %s to exit code %i",
    (code, exitCode) => {
      const normalized = normalizeError(
        new AppError(
          code as keyof typeof EXIT_CODES,
          `Public message for ${code}`,
        ),
        context,
      );

      expect(normalized.exitCode).toBe(exitCode);
      expect(normalized.envelope.error.code).toBe(
        code as keyof typeof EXIT_CODES,
      );
    },
  );

  test("normalizes AppError while omitting its cause", () => {
    const cause = new Error("internal stack and VOT_API_TOKEN=private");
    const normalized = normalizeError(
      new AppError("translation", "Translation failed.", {
        details: { provider: "vot", retryable: false },
        cause,
      }),
      context,
    );

    expect(normalized).toEqual({
      exitCode: 4,
      envelope: {
        schemaVersion: 1,
        ok: false,
        operation: "translate",
        helperVersion: "0.1.0",
        votVersion: "2.4.12",
        error: {
          code: "translation",
          message: "Translation failed.",
          details: { provider: "vot", retryable: false },
        },
      },
    });
    expect(normalized.envelope.error).not.toHaveProperty("cause");
    expect(normalized.envelope.error).not.toHaveProperty("stack");
  });

  test("maps an unexpected Error to a safe generic error", () => {
    const normalized = normalizeError(
      new Error("database failed with Bearer top-secret"),
      context,
    );

    expect(normalized).toEqual({
      exitCode: 10,
      envelope: {
        schemaVersion: 1,
        ok: false,
        operation: "translate",
        helperVersion: "0.1.0",
        votVersion: "2.4.12",
        error: {
          code: "unexpected",
          message: "An unexpected error occurred.",
        },
      },
    });
  });

  test("maps an unknown thrown value without stringifying it", () => {
    const thrown = {
      password: "do-not-expose",
      toString: () => "VOT_API_TOKEN=also-secret",
    };

    expect(
      normalizeError(thrown, {
        helperVersion: "0.1.0",
        votVersion: "2.4.12",
      }),
    ).toEqual({
      exitCode: 10,
      envelope: {
        schemaVersion: 1,
        ok: false,
        helperVersion: "0.1.0",
        votVersion: "2.4.12",
        error: {
          code: "unexpected",
          message: "An unexpected error occurred.",
        },
      },
    });
  });

  test("errorEnvelope returns only the serializable error envelope", () => {
    expect(
      errorEnvelope(
        new AppError("timeout", "Translation timed out."),
        context,
      ),
    ).toEqual({
      schemaVersion: 1,
      ok: false,
      operation: "translate",
      helperVersion: "0.1.0",
      votVersion: "2.4.12",
      error: {
        code: "timeout",
        message: "Translation timed out.",
      },
    });
  });

  test("serializes deterministically with exactly one trailing newline", () => {
    const envelope = successEnvelope({
      ...context,
      data: { first: 1, second: true },
    });
    const expected =
      '{"schemaVersion":1,"ok":true,"operation":"translate","helperVersion":"0.1.0","votVersion":"2.4.12","data":{"first":1,"second":true}}\n';

    expect(serializeEnvelope(envelope)).toBe(expected);
    expect(serializeEnvelope(envelope)).toBe(expected);
    expect(serializeEnvelope(envelope).endsWith("\n\n")).toBe(false);
  });

  test("does not rewrite success data while serializing", () => {
    const envelope = successEnvelope({
      ...context,
      data: { diagnostic: "Bearer is nonsecret application data here" },
    });

    expect(serializeEnvelope(envelope)).toContain(
      '"diagnostic":"Bearer is nonsecret application data here"',
    );
  });

  test("redacts secrets recursively in messages and nested details", () => {
    const normalized = normalizeError(
      new AppError(
        "configuration",
        "OAuth oauth-value failed; region=eu remains",
        {
          details: {
            header: "Bearer bearer-value; request=42 remains",
            environment: "before VOT_API_TOKEN=env-value after remains",
            cookies: [
              "theme=dark; Session_id=session-value; locale=ru remains",
              { note: "ordinary content remains" },
            ],
          },
        },
      ),
      context,
    );

    expect(normalized.envelope.error).toEqual({
      code: "configuration",
      message: "OAuth [REDACTED] failed; region=eu remains",
      details: {
        header: "Bearer [REDACTED]; request=42 remains",
        environment: "before VOT_API_TOKEN=[REDACTED] after remains",
        cookies: [
          "theme=dark; Session_id=[REDACTED]; locale=ru remains",
          { note: "ordinary content remains" },
        ],
      },
    });
  });
});

describe("redactSecrets", () => {
  test.each([
    ["prefix OAuth oauth-token suffix", "prefix OAuth [REDACTED] suffix"],
    ["prefix Bearer bearer-token suffix", "prefix Bearer [REDACTED] suffix"],
    [
      "prefix VOT_API_TOKEN=api-token suffix",
      "prefix VOT_API_TOKEN=[REDACTED] suffix",
    ],
    [
      "foo=bar; Session_id=cookie-token; theme=dark",
      "foo=bar; Session_id=[REDACTED]; theme=dark",
    ],
  ])("redacts credential values while preserving neighboring text", (input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });
});
