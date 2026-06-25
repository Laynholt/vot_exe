import { AppError } from "./contracts";

export interface RuntimeDiagnostics {
  mode: "direct" | "worker";
  workerHost?: string;
  hasApiToken: boolean;
  hasYandexCookie: boolean;
}

export interface RuntimeConfig {
  workerHost?: string;
  apiToken?: string;
  yandexCookie?: string;
  diagnostics: RuntimeDiagnostics;
}

export interface VotClientConstructors<TClient = unknown> {
  VOTClient: new (options?: unknown) => TClient;
  VOTWorkerClient: new (options?: unknown) => TClient;
}

export interface LivelyVoiceOptions {
  livelyVoice: boolean;
}

function envValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

export function readRuntimeConfig(
  env: Record<string, string | undefined>,
): RuntimeConfig {
  const workerHost = envValue(env.VOT_WORKER_HOST);
  const apiToken = envValue(env.VOT_API_TOKEN);
  const yandexCookie = envValue(env.VOT_YANDEX_COOKIE);
  const diagnostics: RuntimeDiagnostics = {
    mode: workerHost === undefined ? "direct" : "worker",
    ...(workerHost === undefined ? {} : { workerHost }),
    hasApiToken: apiToken !== undefined,
    hasYandexCookie: yandexCookie !== undefined,
  };

  return {
    ...(workerHost === undefined ? {} : { workerHost }),
    ...(apiToken === undefined ? {} : { apiToken }),
    ...(yandexCookie === undefined ? {} : { yandexCookie }),
    diagnostics,
  };
}

export function createVotClient<TClient>(
  config: RuntimeConfig,
  constructors: VotClientConstructors<TClient>,
): TClient {
  if (config.workerHost !== undefined) {
    return new constructors.VOTWorkerClient({ host: config.workerHost });
  }

  return new constructors.VOTClient(
    config.apiToken === undefined ? undefined : { apiToken: config.apiToken },
  );
}

export function votRequestHeaders(
  config: RuntimeConfig,
): Record<string, string> | undefined {
  if (config.yandexCookie === undefined) {
    return undefined;
  }

  return { Cookie: config.yandexCookie };
}

export function assertLivelyVoiceAllowed(
  config: RuntimeConfig,
  options: LivelyVoiceOptions,
): void {
  if (
    options.livelyVoice &&
    config.apiToken === undefined &&
    config.yandexCookie === undefined
  ) {
    throw new AppError(
      "configuration",
      "--lively-voice requires VOT_API_TOKEN or VOT_YANDEX_COOKIE.",
      { details: config.diagnostics },
    );
  }
}
