import type {
  ParsedCommand,
  SubtitleCue,
  SubtitlesCommand,
  TranslateCommand,
  UpstreamSubtitleTrack,
} from "./contracts";
import { type RuntimeConfig, votRequestHeaders } from "./config";
import {
  EXIT_CODES,
  errorEnvelope,
  normalizeError,
  successEnvelope,
  type ErrorEnvelope,
  type SuccessEnvelope,
} from "./result";
import { downloadAtomic, writeAtomic } from "./files";
import {
  normalizeVotCues,
  selectSubtitleTrack,
  serializeSubtitles,
} from "./subtitles";
import { requestTranslation, type TranslationResult } from "./translation";
import type { TranslationClient } from "./translation";

export interface AppRuntime {
  helperVersion: string;
  votVersion: string;
  config: RuntimeConfig;
}

export interface FileResult {
  path: string;
  bytes: number;
  contentType?: string;
}

export interface AppDeps {
  getVideoData: (url: string) => Promise<unknown>;
  requestTranslation?: typeof requestTranslation | undefined;
  client?: TranslationClient | undefined;
  now?: (() => number) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  downloadAtomic?: typeof downloadAtomic | undefined;
  getSubtitles: (input: unknown) => Promise<unknown>;
  fetchJson: (url: string) => Promise<unknown>;
  writeAtomic?: typeof writeAtomic | undefined;
}

export interface CommandResult {
  exitCode: number;
  envelope: SuccessEnvelope | ErrorEnvelope;
}

function operation(command: ParsedCommand): string {
  return command.kind;
}

function success(
  command: ParsedCommand,
  runtime: AppRuntime,
  data: unknown,
): CommandResult {
  return {
    exitCode: 0,
    envelope: successEnvelope({
      operation: operation(command),
      helperVersion: runtime.helperVersion,
      votVersion: runtime.votVersion,
      data,
    }),
  };
}

function failure(
  command: ParsedCommand,
  runtime: AppRuntime,
  error: unknown,
): CommandResult {
  const normalized = normalizeError(error, {
    operation: operation(command),
    helperVersion: runtime.helperVersion,
    votVersion: runtime.votVersion,
  });
  return {
    exitCode: normalized.exitCode,
    envelope: normalized.envelope,
  };
}

function commandHeaders(runtime: AppRuntime): Record<string, string> | undefined {
  return votRequestHeaders(runtime.config);
}

function requireClient(deps: AppDeps): TranslationClient {
  if (deps.client === undefined) {
    throw new Error("Translation client dependency is required.");
  }
  return deps.client;
}

function fallbackClient(): TranslationClient {
  return {
    async translateVideo(): Promise<unknown> {
      throw new Error("Translation client dependency is required.");
    },
  };
}

function pollingDeps(deps: AppDeps, requireRealClient: boolean) {
  return {
    client: requireRealClient ? requireClient(deps) : (deps.client ?? fallbackClient()),
    now: deps.now ?? Date.now,
    sleep:
      deps.sleep ??
      ((milliseconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds))),
  };
}

function mapSubtitleTracks(raw: unknown): {
  waiting: boolean;
  tracks: UpstreamSubtitleTrack[];
} {
  if (typeof raw !== "object" || raw === null) {
    return { waiting: false, tracks: [] };
  }

  const value = raw as { waiting?: unknown; subtitles?: unknown };
  return {
    waiting: value.waiting === true,
    tracks: Array.isArray(value.subtitles)
      ? (value.subtitles as UpstreamSubtitleTrack[])
      : [],
  };
}

async function runTranslate(
  command: TranslateCommand,
  runtime: AppRuntime,
  deps: AppDeps,
): Promise<CommandResult> {
  const videoData = await deps.getVideoData(command.url);
  const headers = commandHeaders(runtime);
  const options = {
    videoData,
    sourceLang: command.sourceLang,
    targetLang: command.targetLang,
    timeoutSeconds: command.timeoutSeconds,
    noWait: command.noWait,
    livelyVoice: command.livelyVoice,
    ...(headers === undefined ? {} : { headers }),
  };
  const translation =
    deps.requestTranslation === undefined
      ? await requestTranslation(options, pollingDeps(deps, true))
      : await deps.requestTranslation(options, pollingDeps(deps, false));

  if (translation.state !== "ready" || command.output === undefined) {
    return success(command, runtime, translation);
  }

  const downloader = deps.downloadAtomic ?? downloadAtomic;
  const output = await downloader(translation.audioUrl, command.output, {
    force: command.force,
  });

  return success(command, runtime, {
    ...translation,
    output,
  });
}

async function runSubtitles(
  command: SubtitlesCommand,
  runtime: AppRuntime,
  deps: AppDeps,
): Promise<CommandResult> {
  const videoData = await deps.getVideoData(command.url);
  const headers = commandHeaders(runtime);
  const rawSubtitles = await deps.getSubtitles({
    videoData,
    ...(command.sourceLang === "auto"
      ? {}
      : { requestLang: command.sourceLang }),
    ...(headers === undefined ? {} : { headers }),
  });
  const { waiting, tracks } = mapSubtitleTracks(rawSubtitles);

  if (command.output === undefined) {
    return success(command, runtime, {
      waiting,
      tracks: tracks.map((track) => ({
        language: track.language,
        ...(track.translatedLanguage === undefined
          ? {}
          : { translatedLanguage: track.translatedLanguage }),
      })),
    });
  }

  const selectedTrack = selectSubtitleTrack(tracks, {
    original: command.original,
    sourceLang: command.sourceLang,
    targetLang: command.targetLang,
  });
  const payload = await deps.fetchJson(selectedTrack.url);
  const cues: readonly SubtitleCue[] = normalizeVotCues(payload);
  const serialized = serializeSubtitles(cues, command.format);
  const writer = deps.writeAtomic ?? writeAtomic;
  const output = await writer(command.output, serialized, {
    force: command.force,
  });

  return success(command, runtime, {
    waiting,
    selectedTrack,
    output,
  });
}

export async function runCommand(
  command: ParsedCommand,
  runtime: AppRuntime,
  deps: AppDeps,
): Promise<CommandResult> {
  try {
    if (command.kind === "translate") {
      return await runTranslate(command, runtime, deps);
    }
    if (command.kind === "subtitles") {
      return await runSubtitles(command, runtime, deps);
    }

    return {
      exitCode: EXIT_CODES.invalidArguments,
      envelope: errorEnvelope(
        new Error("Help and version commands are handled by the process layer."),
        {
          operation: operation(command),
          helperVersion: runtime.helperVersion,
          votVersion: runtime.votVersion,
        },
      ),
    };
  } catch (error) {
    return failure(command, runtime, error);
  }
}

export type { TranslationResult };
