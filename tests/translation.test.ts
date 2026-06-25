import { describe, expect, test } from "bun:test";

import { AppError } from "../src/contracts";
import { requestTranslation } from "../src/translation";

const videoData = Object.freeze({
  url: "https://youtu.be/example",
  videoId: "example",
  host: "youtube",
});

function fakeDeps(
  responses: unknown[],
  options: { nowMs?: number } = {},
) {
  let nowMs = options.nowMs ?? 1_000;
  const calls: unknown[] = [];
  const sleeps: number[] = [];

  return {
    calls,
    sleeps,
    deps: {
      client: {
        async translateVideo(input: unknown): Promise<unknown> {
          calls.push(input);
          const response = responses.shift();
          if (response instanceof Error) {
            throw response;
          }
          return response;
        },
      },
      now: () => nowMs,
      sleep: async (milliseconds: number) => {
        sleeps.push(milliseconds);
        nowMs += milliseconds;
      },
    },
  };
}

function baseOptions(overrides: Partial<Parameters<typeof requestTranslation>[0]> = {}) {
  return {
    videoData,
    sourceLang: "en",
    targetLang: "ru",
    timeoutSeconds: 900,
    noWait: false,
    livelyVoice: false,
    ...overrides,
  };
}

describe("requestTranslation", () => {
  test("returns immediate translated audio without sleeping", async () => {
    const { deps, calls, sleeps } = fakeDeps([
      {
        translated: true,
        translationId: "tr-1",
        url: "https://cdn.example/audio.mp3",
        remainingTime: 0,
        status: 1,
      },
    ]);

    await expect(requestTranslation(baseOptions(), deps)).resolves.toEqual({
      state: "ready",
      translationId: "tr-1",
      audioUrl: "https://cdn.example/audio.mp3",
      status: 1,
    });

    expect(sleeps).toEqual([]);
    expect(calls).toEqual([
      {
        videoData,
        requestLang: "en",
        responseLang: "ru",
        extraOpts: {
          useLivelyVoice: false,
        },
      },
    ]);
  });

  test("waits then reuses the same video data until translated", async () => {
    const { deps, calls, sleeps } = fakeDeps([
      {
        translated: false,
        translationId: "tr-wait",
        remainingTime: 7,
        status: 2,
        message: "queued",
      },
      {
        translated: true,
        translationId: "tr-ready",
        url: "https://cdn.example/ready.mp3",
        remainingTime: 0,
        status: 1,
      },
    ]);

    await expect(requestTranslation(baseOptions(), deps)).resolves.toMatchObject({
      state: "ready",
      audioUrl: "https://cdn.example/ready.mp3",
    });

    expect(sleeps).toEqual([7_000]);
    expect(calls).toHaveLength(2);
    expect(calls).toEqual([
      {
        videoData,
        requestLang: "en",
        responseLang: "ru",
        extraOpts: {
          useLivelyVoice: false,
        },
      },
      {
        videoData,
        requestLang: "en",
        responseLang: "ru",
        extraOpts: {
          useLivelyVoice: false,
        },
      },
    ]);
  });

  test("returns pending immediately for noWait", async () => {
    const { deps, sleeps } = fakeDeps([
      {
        translated: false,
        translationId: "tr-pending",
        remainingTime: 30,
        status: 3,
        message: "long wait",
      },
    ]);

    await expect(
      requestTranslation(baseOptions({ noWait: true }), deps),
    ).resolves.toEqual({
      state: "pending",
      translationId: "tr-pending",
      remainingTimeSeconds: 30,
      status: 3,
      message: "long wait",
    });
    expect(sleeps).toEqual([]);
  });

  test("throws timeout on monotonic deadline expiry", async () => {
    const { deps, sleeps } = fakeDeps([
      { translated: false, translationId: "tr-1", remainingTime: 5, status: 2 },
      { translated: false, translationId: "tr-1", remainingTime: 5, status: 2 },
    ]);

    await expect(
      requestTranslation(baseOptions({ timeoutSeconds: 5 }), deps),
    ).rejects.toMatchObject({
      code: "timeout",
      message: "VOT translation did not finish before the timeout.",
    });
    expect(sleeps).toEqual([5_000]);
  });

  test("treats partial-content translated responses as success", async () => {
    const { deps } = fakeDeps([
      {
        translated: true,
        translationId: "tr-part",
        url: "https://cdn.example/partial.mp3",
        remainingTime: 0,
        status: 5,
        message: "partial content",
      },
    ]);

    await expect(requestTranslation(baseOptions(), deps)).resolves.toEqual({
      state: "ready",
      translationId: "tr-part",
      audioUrl: "https://cdn.example/partial.mp3",
      status: 5,
      message: "partial content",
    });
  });

  test("maps upstream exceptions to translation AppError", async () => {
    const { deps } = fakeDeps([new Error("OAuth token=secret failed")]);

    const error = await requestTranslation(baseOptions(), deps).catch((caught) =>
      caught,
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("translation");
    expect((error as AppError).message).toBe("VOT translation request failed.");
  });

  test("clamps remainingTime to 5 through 60 seconds before sleeping", async () => {
    const low = fakeDeps([
      { translated: false, translationId: "tr-low", remainingTime: 1, status: 2 },
      {
        translated: true,
        translationId: "tr-low",
        url: "https://cdn.example/low.mp3",
        remainingTime: 0,
        status: 1,
      },
    ]);
    await requestTranslation(baseOptions(), low.deps);
    expect(low.sleeps).toEqual([5_000]);

    const high = fakeDeps([
      {
        translated: false,
        translationId: "tr-high",
        remainingTime: 120,
        status: 2,
      },
      {
        translated: true,
        translationId: "tr-high",
        url: "https://cdn.example/high.mp3",
        remainingTime: 0,
        status: 1,
      },
    ]);
    await requestTranslation(baseOptions(), high.deps);
    expect(high.sleeps).toEqual([60_000]);
  });

  test("rejects malformed upstream responses as translation errors", async () => {
    const { deps } = fakeDeps([{ translated: true, translationId: "bad" }]);

    const error = await requestTranslation(baseOptions(), deps).catch((caught) =>
      caught,
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("translation");
  });
});
