import VOTClient from "@vot.js/node";
import { getVideoData } from "@vot.js/node/utils/videoData";

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

async function runAttempt(): Promise<void> {
  const client = new VOTClient();
  const videoData = await getVideoData(FIXTURE_URL);

  const translation = await requestTranslation(
    {
      videoData,
      sourceLang: "auto",
      targetLang: "ru",
      timeoutSeconds: TIMEOUT_SECONDS,
      noWait: true,
      livelyVoice: false,
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

let lastError: unknown;
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  try {
    await runAttempt();
    process.exitCode = 0;
    process.exit();
  } catch (error) {
    lastError = error;
    process.stderr.write(`live smoke attempt ${attempt} failed\n`);
    if (attempt < ATTEMPTS) {
      await sleep(5_000);
    }
  }
}

process.stderr.write(
  lastError instanceof Error ? `${lastError.message}\n` : "live smoke failed\n",
);
process.exitCode = 1;
