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
  helperVersion: "2.4.12-R2",
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
      helperVersion: "2.4.12-R2",
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
        helperVersion: "2.4.12-R2",
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
        helperVersion: "2.4.12-R2",
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
        helperVersion: "2.4.12-R2",
        votVersion: "2.4.12",
      }),
    ).toEqual({
      exitCode: 10,
      envelope: {
        schemaVersion: 1,
        ok: false,
        helperVersion: "2.4.12-R2",
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
      helperVersion: "2.4.12-R2",
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
      '{"schemaVersion":1,"ok":true,"operation":"translate","helperVersion":"2.4.12-R2","votVersion":"2.4.12","data":{"first":1,"second":true}}\n';

    expect(serializeEnvelope(envelope)).toBe(expected);
    expect(serializeEnvelope(envelope)).toBe(expected);
    expect(serializeEnvelope(envelope).endsWith("\n\n")).toBe(false);
  });

  test("preserves success payload strings byte-for-byte", () => {
    const diagnostic = "Bearer is nonsecret application data here";
    const envelope = successEnvelope({
      ...context,
      data: { diagnostic },
    });

    expect(envelope.data).toEqual({ diagnostic });
    expect(serializeEnvelope(envelope)).toContain(
      `"diagnostic":${JSON.stringify(diagnostic)}`,
    );
  });

  test("normalizes BigInt success data before serialization", () => {
    const envelope = successEnvelope({
      ...context,
      data: { contentLength: 9_007_199_254_740_993n },
    });

    expect(envelope.data).toEqual({ contentLength: "9007199254740993" });
    expect(() => serializeEnvelope(envelope)).not.toThrow();
  });

  test("marks circular success data before serialization", () => {
    const data: { label: string; self?: unknown } = { label: "root" };
    data.self = data;

    const envelope = successEnvelope({ ...context, data });

    expect(envelope.data).toEqual({ label: "root", self: "[Circular]" });
    expect(() => serializeEnvelope(envelope)).not.toThrow();
  });

  test("ignores hostile success toJSON methods without leaking secrets", () => {
    let toJSONCalls = 0;
    const envelope = successEnvelope({
      ...context,
      data: {
        safe: "value",
        toJSON() {
          toJSONCalls += 1;
          return { authorization: "Bearer leaked-token" };
        },
      },
    });

    const serialized = serializeEnvelope(envelope);

    expect(toJSONCalls).toBe(0);
    expect(envelope.data).toEqual({ safe: "value" });
    expect(serialized).not.toContain("leaked-token");
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

  test("ignores enumerable toJSON methods instead of invoking or preserving them", () => {
    let toJSONCalls = 0;
    const normalized = normalizeError(
      new AppError("translation", "Translation failed.", {
        details: {
          provider: "vot",
          toJSON() {
            toJSONCalls += 1;
            return { authorization: "Bearer leaked-token" };
          },
        },
      }),
      context,
    );

    const serialized = serializeEnvelope(normalized.envelope);

    expect(toJSONCalls).toBe(0);
    expect(normalized.envelope.error.details).toEqual({ provider: "vot" });
    expect(serialized).not.toContain("leaked-token");
    expect(serialized).not.toContain("toJSON");
  });

  test("marks circular details without throwing", () => {
    const details: { label: string; self?: unknown } = { label: "root" };
    details.self = details;

    const normalized = normalizeError(
      new AppError("unexpected", "Cycle found.", { details }),
      context,
    );

    expect(normalized.envelope.error.details).toEqual({
      label: "root",
      self: "[Circular]",
    });
    expect(() => serializeEnvelope(normalized.envelope)).not.toThrow();
  });

  test("marks throwing getters without executing them", () => {
    let getterCalls = 0;
    const details = { safe: "value" } as Record<string, unknown>;
    Object.defineProperty(details, "dangerous", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("Bearer getter-secret");
      },
    });

    const normalized = normalizeError(
      new AppError("fileIO", "Could not inspect details.", { details }),
      context,
    );

    expect(getterCalls).toBe(0);
    expect(normalized.envelope.error.details).toEqual({
      safe: "value",
      dangerous: "[Unserializable property]",
    });
    expect(() => serializeEnvelope(normalized.envelope)).not.toThrow();
  });

  test("converts BigInt and Date details to stable JSON values", () => {
    const normalized = normalizeError(
      new AppError("videoData", "Video metadata failed.", {
        details: {
          contentLength: 9_007_199_254_740_993n,
          fetchedAt: new Date("2026-06-24T12:34:56.789Z"),
        },
      }),
      context,
    );

    expect(normalized.envelope.error.details).toEqual({
      contentLength: "9007199254740993",
      fetchedAt: "2026-06-24T12:34:56.789Z",
    });
    expect(() => serializeEnvelope(normalized.envelope)).not.toThrow();
    expect(serializeEnvelope(normalized.envelope)).toContain(
      '"contentLength":"9007199254740993","fetchedAt":"2026-06-24T12:34:56.789Z"',
    );
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
