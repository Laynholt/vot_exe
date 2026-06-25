import { describe, expect, test } from "bun:test";

import { AppError, type TranslateCommand } from "../src/contracts";
import { runCommand, type AppRuntime } from "../src/app";
import { readRuntimeConfig } from "../src/config";

const runtime: AppRuntime = {
  helperVersion: "0.1.0-test",
  votVersion: "2.4.12-test",
  config: readRuntimeConfig({ VOT_YANDEX_COOKIE: "Session_id=cookie" }),
};

const baseTranslateCommand: TranslateCommand = {
  kind: "translate",
  url: "https://youtu.be/example",
  sourceLang: "auto",
  targetLang: "ru",
  timeoutSeconds: 900,
  noWait: false,
  livelyVoice: false,
  force: false,
  quiet: false,
};

const videoData = {
  url: "https://youtu.be/example",
  videoId: "example",
  host: "youtube",
};

function makeDeps(overrides: Partial<Parameters<typeof runCommand>[2]> = {}) {
  const calls = {
    getVideoData: [] as unknown[][],
    requestTranslation: [] as unknown[][],
    downloadAtomic: [] as unknown[][],
    getSubtitles: [] as unknown[][],
    fetchJson: [] as unknown[][],
    writeAtomic: [] as unknown[][],
  };

  const deps = {
    async getVideoData(...args: unknown[]) {
      calls.getVideoData.push(args);
      return videoData;
    },
    async requestTranslation(...args: unknown[]) {
      calls.requestTranslation.push(args);
      return {
        state: "ready" as const,
        translationId: "tr-1",
        audioUrl: "https://cdn.example/audio.mp3",
        status: 1,
      };
    },
    async downloadAtomic(...args: unknown[]) {
      calls.downloadAtomic.push(args);
      return {
        path: "C:/out/audio.mp3",
        bytes: 123,
        contentType: "audio/mpeg",
      };
    },
    async getSubtitles(...args: unknown[]) {
      calls.getSubtitles.push(args);
      return {
        waiting: false,
        subtitles: [
          {
            language: "en",
            url: "https://example.com/en.json",
            translatedLanguage: "ru",
            translatedUrl: "https://example.com/en-ru.json",
          },
        ],
      };
    },
    async fetchJson(...args: unknown[]) {
      calls.fetchJson.push(args);
      return [{ text: "Hello", startMs: 0, durationMs: 1500 }];
    },
    async writeAtomic(...args: unknown[]) {
      calls.writeAtomic.push(args);
      return { path: "C:/out/subs.srt", bytes: 44 };
    },
    ...overrides,
  };

  return { calls, deps };
}

describe("runCommand translate", () => {
  test("returns a translated audio URL without downloading when output is absent", async () => {
    const { calls, deps } = makeDeps();

    await expect(
      runCommand(baseTranslateCommand, runtime, deps),
    ).resolves.toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        operation: "translate",
        data: {
          state: "ready",
          audioUrl: "https://cdn.example/audio.mp3",
        },
      },
    });

    expect(calls.getVideoData).toEqual([["https://youtu.be/example"]]);
    expect(calls.downloadAtomic).toEqual([]);
    expect(calls.requestTranslation[0]?.[0]).toMatchObject({
      videoData,
      sourceLang: "auto",
      targetLang: "ru",
      timeoutSeconds: 900,
      headers: { Cookie: "Session_id=cookie" },
    });
  });

  test("downloads translated audio atomically when output is provided", async () => {
    const { calls, deps } = makeDeps();

    await expect(
      runCommand(
        {
          ...baseTranslateCommand,
          output: "audio.mp3",
          force: true,
        },
        runtime,
        deps,
      ),
    ).resolves.toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        data: {
          output: {
            path: "C:/out/audio.mp3",
            bytes: 123,
            contentType: "audio/mpeg",
          },
        },
      },
    });

    expect(calls.downloadAtomic).toEqual([
      [
        "https://cdn.example/audio.mp3",
        "audio.mp3",
        {
          force: true,
        },
      ],
    ]);
  });

  test("returns pending no-wait without downloading", async () => {
    const { calls, deps } = makeDeps({
      async requestTranslation(...args: unknown[]) {
        calls.requestTranslation.push(args);
        return {
          state: "pending" as const,
          translationId: "tr-pending",
          remainingTimeSeconds: 30,
          status: 2,
        };
      },
    });

    await expect(
      runCommand(
        {
          ...baseTranslateCommand,
          noWait: true,
          output: "audio.mp3",
        },
        runtime,
        deps,
      ),
    ).resolves.toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        data: {
          state: "pending",
          remainingTimeSeconds: 30,
        },
      },
    });
    expect(calls.downloadAtomic).toEqual([]);
  });

  test("uses injected client, clock, and sleep when polling is not overridden", async () => {
    const { deps } = makeDeps();
    const translateCalls: unknown[] = [];
    const sleeps: number[] = [];

    await expect(
      runCommand(baseTranslateCommand, runtime, {
        ...deps,
        requestTranslation: undefined,
        client: {
          async translateVideo(input: unknown) {
            translateCalls.push(input);
            if (translateCalls.length === 1) {
              return {
                translated: false,
                translationId: "tr-wait",
                remainingTime: 5,
                status: 2,
              };
            }
            return {
              translated: true,
              translationId: "tr-ready",
              url: "https://cdn.example/default.mp3",
              remainingTime: 0,
              status: 1,
            };
          },
        },
        now: (() => {
          let value = 0;
          return () => value;
        })(),
        sleep: async (milliseconds: number) => {
          sleeps.push(milliseconds);
        },
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        data: {
          state: "ready",
          audioUrl: "https://cdn.example/default.mp3",
        },
      },
    });

    expect(translateCalls).toHaveLength(2);
    expect(sleeps).toEqual([5_000]);
  });
});

describe("runCommand subtitles", () => {
  test("lists subtitle tracks when output is absent", async () => {
    const { calls, deps } = makeDeps();

    await expect(
      runCommand(
        {
          kind: "subtitles",
          url: "https://youtu.be/example",
          sourceLang: "auto",
          targetLang: "ru",
          format: "srt",
          original: false,
          force: false,
          quiet: false,
        },
        runtime,
        deps,
      ),
    ).resolves.toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        operation: "subtitles",
        data: {
          waiting: false,
          tracks: [
            {
              language: "en",
              translatedLanguage: "ru",
            },
          ],
        },
      },
    });
    expect(calls.fetchJson).toEqual([]);
    expect(calls.writeAtomic).toEqual([]);
  });

  test("exports translated SRT subtitles with force", async () => {
    const { calls, deps } = makeDeps();

    await expect(
      runCommand(
        {
          kind: "subtitles",
          url: "https://youtu.be/example",
          sourceLang: "auto",
          targetLang: "ru",
          format: "srt",
          original: false,
          output: "subs.srt",
          force: true,
          quiet: false,
        },
        runtime,
        deps,
      ),
    ).resolves.toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        data: {
          selectedTrack: {
            kind: "translated",
            language: "ru",
            translatedFromLanguage: "en",
          },
          output: {
            path: "C:/out/subs.srt",
            bytes: 44,
          },
        },
      },
    });

    expect(calls.fetchJson).toEqual([["https://example.com/en-ru.json"]]);
    expect(calls.writeAtomic).toEqual([
      [
        "subs.srt",
        "1\r\n00:00:00,000 --> 00:00:01,500\r\nHello\r\n",
        { force: true },
      ],
    ]);
  });

  test("exports original VTT subtitles", async () => {
    const { calls, deps } = makeDeps();

    await runCommand(
      {
        kind: "subtitles",
        url: "https://youtu.be/example",
        sourceLang: "en",
        targetLang: "ru",
        format: "vtt",
        original: true,
        output: "subs.vtt",
        force: false,
        quiet: false,
      },
      runtime,
      deps,
    );

    expect(calls.fetchJson).toEqual([["https://example.com/en.json"]]);
    expect(calls.writeAtomic[0]?.[1]).toBe(
      "WEBVTT\r\n\r\n00:00:00.000 --> 00:00:01.500\r\nHello\r\n",
    );
    expect(calls.writeAtomic[0]?.[2]).toEqual({ force: false });
  });

  test("maps subtitle selection failures to exit code 6 with safe metadata", async () => {
    const { deps } = makeDeps({
      async getSubtitles() {
        return {
          waiting: false,
          subtitles: [
            {
              language: "en",
              url: "https://example.com/en.json",
              translatedLanguage: "ru",
              translatedUrl: "https://example.com/en-ru.json",
            },
            {
              language: "de",
              url: "https://example.com/de.json",
              translatedLanguage: "ru",
              translatedUrl: "https://example.com/de-ru.json",
            },
          ],
        };
      },
    });

    const result = await runCommand(
      {
        kind: "subtitles",
        url: "https://youtu.be/example",
        sourceLang: "auto",
        targetLang: "ru",
        format: "json",
        original: false,
        output: "subs.json",
        force: false,
        quiet: false,
      },
      runtime,
      deps,
    );

    expect(result.exitCode).toBe(6);
    expect(result.envelope.ok).toBe(false);
    if (!result.envelope.ok) {
      expect(result.envelope.error.message).toContain("ambiguous");
      expect(JSON.stringify(result.envelope.error.details)).not.toContain(
        "https://",
      );
    }
  });
});

describe("runCommand errors", () => {
  test("maps AppError to its stable exit code", async () => {
    const { deps } = makeDeps({
      async getVideoData() {
        throw new AppError("videoData", "No video data");
      },
    });

    const result = await runCommand(baseTranslateCommand, runtime, deps);

    expect(result.exitCode).toBe(3);
    expect(result.envelope.ok).toBe(false);
    if (!result.envelope.ok) {
      expect(result.envelope.error).toMatchObject({
        code: "videoData",
        message: "No video data",
      });
    }
  });
});
