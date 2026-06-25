import VOTClient, { VOTWorkerClient } from "@vot.js/node";
import { getVideoData } from "@vot.js/node/utils/videoData";

import {
  createVotClient,
  readRuntimeConfig,
  votRequestHeaders,
  type RuntimeConfig,
} from "../src/config";
import { AppError } from "../src/contracts";
import { normalizeVotCues, selectSubtitleTrack, serializeSubtitles } from "../src/subtitles";
import { requestTranslation } from "../src/translation";

const FIXTURE_URL = "https://youtu.be/LK6nLR1bzpI";
const ATTEMPTS = 3;
const TIMEOUT_SECONDS = 180;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`subtitle fetch failed with HTTP ${response.status}`);
  }
  return await response.json();
}

async function assertDownloadable(url: string): Promise<void> {
  const response = await fetch(url, { method: "GET" });
  response.body?.cancel().catch(() => {});
  if (!response.ok) {
    throw new Error(`translated audio is not downloadable: HTTP ${response.status}`);
  }
}

export function hasLiveCredentials(config: RuntimeConfig): boolean {
  return (
    config.workerHost !== undefined ||
    config.apiToken !== undefined ||
    config.yandexCookie !== undefined
  );
}

function requiredByEnv(env: Record<string, string | undefined>): boolean {
  const raw = env.VOT_LIVE_SMOKE_REQUIRED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function shouldSoftSkipLiveSmoke(
  error: unknown,
  config: RuntimeConfig,
  env: Record<string, string | undefined>,
): boolean {
  return (
    env.GITHUB_ACTIONS === "true" &&
    !requiredByEnv(env) &&
    !hasLiveCredentials(config) &&
    error instanceof AppError &&
    error.code === "translation"
  );
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "live smoke failed";
}

async function runAttempt(config: RuntimeConfig): Promise<void> {
  const client = createVotClient(config, { VOTClient, VOTWorkerClient });
  const headers = votRequestHeaders(config);
  const videoData = await getVideoData(FIXTURE_URL);

  const translation = await requestTranslation(
    {
      videoData,
      sourceLang: "auto",
      targetLang: "ru",
      timeoutSeconds: TIMEOUT_SECONDS,
      noWait: true,
      livelyVoice: false,
      ...(headers === undefined ? {} : { headers }),
    },
    {
      client: client as never,
      now: Date.now,
      sleep,
    },
  );

  if (translation.state === "ready") {
    await assertDownloadable(translation.audioUrl);
  }

  const rawSubtitles = await (client as { getSubtitles(input: unknown): Promise<unknown> }).getSubtitles({
    videoData,
    ...(headers === undefined ? {} : { headers }),
  });
  const tracks =
    typeof rawSubtitles === "object" &&
    rawSubtitles !== null &&
    Array.isArray((rawSubtitles as { subtitles?: unknown }).subtitles)
      ? (rawSubtitles as { subtitles: unknown[] }).subtitles
      : [];
  const selected = selectSubtitleTrack(tracks as never, {
    original: false,
    sourceLang: "auto",
    targetLang: "ru",
  });
  const cues = normalizeVotCues(await fetchJson(selected.url));
  if (!cues.some((cue) => cue.durationMs > 0)) {
    throw new Error("subtitles did not include a positive-duration cue");
  }
  serializeSubtitles(cues, "srt");
}

export async function main(
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const config = readRuntimeConfig(env);
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      await runAttempt(config);
      return 0;
    } catch (error) {
      lastError = error;
      process.stderr.write(`live smoke attempt ${attempt} failed\n`);
      if (attempt < ATTEMPTS) {
        await sleep(5_000);
      }
    }
  }

  if (shouldSoftSkipLiveSmoke(lastError, config, env)) {
    process.stderr.write(
      "live smoke skipped: GitHub Actions direct VOT translation failed without VOT credentials. Configure VOT_API_TOKEN, VOT_YANDEX_COOKIE, or VOT_WORKER_HOST to make this a hard live gate.\n",
    );
    return 0;
  }

  process.stderr.write(`${safeErrorMessage(lastError)}\n`);
  return 1;
}

if (import.meta.main) {
  process.exitCode = await main();
}
