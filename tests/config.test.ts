import { describe, expect, test } from "bun:test";

import { AppError } from "../src/contracts";
import {
  assertLivelyVoiceAllowed,
  createVotClient,
  readRuntimeConfig,
  votRequestHeaders,
} from "../src/config";

function makeConstructors() {
  const directOptions: unknown[] = [];
  const workerOptions: unknown[] = [];

  return {
    directOptions,
    workerOptions,
    constructors: {
      VOTClient: class FakeVOTClient {
        readonly kind = "direct";

        constructor(options?: unknown) {
          directOptions.push(options);
        }
      },
      VOTWorkerClient: class FakeVOTWorkerClient {
        readonly kind = "worker";

        constructor(options?: unknown) {
          workerOptions.push(options);
        }
      },
    },
  };
}

describe("readRuntimeConfig", () => {
  test("uses direct defaults without secrets", () => {
    expect(readRuntimeConfig({})).toEqual({
      diagnostics: {
        mode: "direct",
        hasApiToken: false,
        hasYandexCookie: false,
      },
    });
  });

  test("parses worker host and reports only safe diagnostics", () => {
    expect(
      readRuntimeConfig({
        VOT_WORKER_HOST: " vot.example.test ",
        VOT_API_TOKEN: " secret-token ",
        VOT_YANDEX_COOKIE: " Session_id=secret-cookie ",
      }),
    ).toEqual({
      workerHost: "vot.example.test",
      apiToken: "secret-token",
      yandexCookie: "Session_id=secret-cookie",
      diagnostics: {
        mode: "worker",
        workerHost: "vot.example.test",
        hasApiToken: true,
        hasYandexCookie: true,
      },
    });
  });

  test("treats blank environment values as absent", () => {
    expect(
      readRuntimeConfig({
        VOT_WORKER_HOST: "  ",
        VOT_API_TOKEN: "",
        VOT_YANDEX_COOKIE: "\t",
      }),
    ).toEqual({
      diagnostics: {
        mode: "direct",
        hasApiToken: false,
        hasYandexCookie: false,
      },
    });
  });

  test("does not leak secret values through diagnostics", () => {
    const config = readRuntimeConfig({
      VOT_API_TOKEN: "OAuth super-secret",
      VOT_YANDEX_COOKIE: "Session_id=cookie-secret",
    });

    expect(JSON.stringify(config.diagnostics)).not.toContain("super-secret");
    expect(JSON.stringify(config.diagnostics)).not.toContain("cookie-secret");
  });
});

describe("createVotClient", () => {
  test("creates a direct VOT client with api token only", () => {
    const { constructors, directOptions, workerOptions } = makeConstructors();
    const config = readRuntimeConfig({
      VOT_API_TOKEN: "token",
      VOT_YANDEX_COOKIE: "Session_id=cookie",
    });

    const client = createVotClient<unknown>(config, constructors);

    expect(client).toMatchObject({ kind: "direct" });
    expect(directOptions).toEqual([{ apiToken: "token" }]);
    expect(workerOptions).toEqual([]);
    expect(JSON.stringify(directOptions)).not.toContain("cookie");
  });

  test("creates a worker client when worker host is configured", () => {
    const { constructors, directOptions, workerOptions } = makeConstructors();
    const config = readRuntimeConfig({
      VOT_WORKER_HOST: "worker.example.test",
      VOT_API_TOKEN: "token",
    });

    const client = createVotClient<unknown>(config, constructors);

    expect(client).toMatchObject({ kind: "worker" });
    expect(directOptions).toEqual([]);
    expect(workerOptions).toEqual([{ host: "worker.example.test" }]);
  });
});

describe("request headers and lively voice", () => {
  test("keeps cookie only in per-request headers", () => {
    const config = readRuntimeConfig({
      VOT_YANDEX_COOKIE: "Session_id=cookie-secret",
    });

    expect(votRequestHeaders(config)).toEqual({
      Cookie: "Session_id=cookie-secret",
    });
  });

  test("returns undefined request headers without a cookie", () => {
    expect(votRequestHeaders(readRuntimeConfig({}))).toBeUndefined();
  });

  test("rejects lively voice without token or cookie credentials", () => {
    const error = (() => {
      try {
        assertLivelyVoiceAllowed(readRuntimeConfig({}), { livelyVoice: true });
      } catch (caught) {
        return caught;
      }
      throw new Error("Expected assertLivelyVoiceAllowed to throw");
    })();

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("configuration");
    expect((error as AppError).message).toContain("--lively-voice");
  });

  test("allows lively voice with either token or cookie credential", () => {
    expect(() =>
      assertLivelyVoiceAllowed(readRuntimeConfig({ VOT_API_TOKEN: "token" }), {
        livelyVoice: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertLivelyVoiceAllowed(
        readRuntimeConfig({ VOT_YANDEX_COOKIE: "Session_id=cookie" }),
        { livelyVoice: true },
      ),
    ).not.toThrow();
  });
});
