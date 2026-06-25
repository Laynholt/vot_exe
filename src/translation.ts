import { AppError } from "./contracts";

export interface TranslationRequestOptions {
  videoData: unknown;
  sourceLang: string;
  targetLang: string;
  timeoutSeconds: number;
  noWait: boolean;
  livelyVoice: boolean;
  headers?: Record<string, string>;
}

export interface TranslationClient {
  translateVideo(input: unknown): Promise<unknown>;
}

export interface TranslationDeps {
  client: TranslationClient;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}

export interface ReadyTranslationResult {
  state: "ready";
  translationId: string;
  audioUrl: string;
  status?: number;
  message?: string;
}

export interface PendingTranslationResult {
  state: "pending";
  translationId?: string;
  remainingTimeSeconds: number;
  status?: number;
  message?: string;
}

export type TranslationResult =
  | ReadyTranslationResult
  | PendingTranslationResult;

const MIN_POLL_SECONDS = 5;
const MAX_POLL_SECONDS = 60;

function clampPollSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MIN_POLL_SECONDS;
  }
  return Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, value));
}

function pendingSeconds(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : MIN_POLL_SECONDS;
}

function responseObject(response: unknown): Record<string, unknown> {
  if (typeof response !== "object" || response === null) {
    throw new AppError("translation", "Invalid VOT translation response.");
  }
  return response as Record<string, unknown>;
}

function optionalStatus(response: Record<string, unknown>) {
  return typeof response.status === "number" && Number.isFinite(response.status)
    ? { status: response.status }
    : {};
}

function optionalMessage(response: Record<string, unknown>) {
  return typeof response.message === "string"
    ? { message: response.message }
    : {};
}

function readyResult(response: Record<string, unknown>): ReadyTranslationResult {
  if (
    response.translated !== true ||
    typeof response.translationId !== "string" ||
    response.translationId.length === 0 ||
    typeof response.url !== "string" ||
    response.url.length === 0
  ) {
    throw new AppError("translation", "Invalid VOT translation response.");
  }

  return {
    state: "ready",
    translationId: response.translationId,
    audioUrl: response.url,
    ...optionalStatus(response),
    ...optionalMessage(response),
  };
}

function pendingResult(
  response: Record<string, unknown>,
): PendingTranslationResult {
  if (response.translated !== false) {
    throw new AppError("translation", "Invalid VOT translation response.");
  }

  return {
    state: "pending",
    ...(typeof response.translationId === "string" &&
    response.translationId.length > 0
      ? { translationId: response.translationId }
      : {}),
    remainingTimeSeconds: pendingSeconds(response.remainingTime),
    ...optionalStatus(response),
    ...optionalMessage(response),
  };
}

function makeTranslateInput(options: TranslationRequestOptions) {
  return {
    videoData: options.videoData,
    ...(options.sourceLang === "auto"
      ? {}
      : { requestLang: options.sourceLang }),
    responseLang: options.targetLang,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    extraOpts: {
      useLivelyVoice: options.livelyVoice,
    },
  };
}

async function translateOnce(
  options: TranslationRequestOptions,
  deps: TranslationDeps,
): Promise<Record<string, unknown>> {
  try {
    return responseObject(
      await deps.client.translateVideo(makeTranslateInput(options)),
    );
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("translation", "VOT translation request failed.", {
      cause: error,
    });
  }
}

export async function requestTranslation(
  options: TranslationRequestOptions,
  deps: TranslationDeps,
): Promise<TranslationResult> {
  const deadlineMs = deps.now() + options.timeoutSeconds * 1_000;

  let response = await translateOnce(options, deps);
  while (response.translated !== true) {
    const pending = pendingResult(response);
    if (options.noWait) {
      return pending;
    }

    const remainingDeadlineMs = deadlineMs - deps.now();
    if (remainingDeadlineMs <= 0) {
      throw new AppError(
        "timeout",
        "VOT translation did not finish before the timeout.",
      );
    }

    const sleepMs = Math.min(
      clampPollSeconds(response.remainingTime) * 1_000,
      remainingDeadlineMs,
    );
    await deps.sleep(sleepMs);

    if (deadlineMs - deps.now() <= 0) {
      throw new AppError(
        "timeout",
        "VOT translation did not finish before the timeout.",
      );
    }
    response = await translateOnce(options, deps);
  }

  return readyResult(response);
}
