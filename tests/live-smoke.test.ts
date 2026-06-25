import { describe, expect, test } from "bun:test";

import { readRuntimeConfig } from "../src/config";
import { AppError } from "../src/contracts";
import {
  hasLiveCredentials,
  shouldSoftSkipLiveSmoke,
} from "../scripts/live-smoke";

describe("live smoke credential policy", () => {
  test("detects configured VOT credentials without exposing values", () => {
    expect(hasLiveCredentials(readRuntimeConfig({}))).toBe(false);
    expect(
      hasLiveCredentials(readRuntimeConfig({ VOT_API_TOKEN: "secret" })),
    ).toBe(true);
    expect(
      hasLiveCredentials(readRuntimeConfig({ VOT_YANDEX_COOKIE: "Session_id=secret" })),
    ).toBe(true);
    expect(
      hasLiveCredentials(readRuntimeConfig({ VOT_WORKER_HOST: "worker.example.test" })),
    ).toBe(true);
  });

  test("soft-skips only unauthenticated GitHub translation upstream failures", () => {
    const translationError = new AppError(
      "translation",
      "VOT translation request failed.",
    );

    expect(
      shouldSoftSkipLiveSmoke(translationError, readRuntimeConfig({}), {
        GITHUB_ACTIONS: "true",
      }),
    ).toBe(true);
    expect(
      shouldSoftSkipLiveSmoke(
        translationError,
        readRuntimeConfig({ VOT_API_TOKEN: "secret" }),
        { GITHUB_ACTIONS: "true" },
      ),
    ).toBe(false);
    expect(
      shouldSoftSkipLiveSmoke(translationError, readRuntimeConfig({}), {
        GITHUB_ACTIONS: "true",
        VOT_LIVE_SMOKE_REQUIRED: "true",
      }),
    ).toBe(false);
    expect(
      shouldSoftSkipLiveSmoke(new AppError("subtitles", "bad subtitles"), readRuntimeConfig({}), {
        GITHUB_ACTIONS: "true",
      }),
    ).toBe(false);
    expect(
      shouldSoftSkipLiveSmoke(translationError, readRuntimeConfig({}), {}),
    ).toBe(false);
  });
});
