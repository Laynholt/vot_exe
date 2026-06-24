export class ArgumentError extends Error {
  override readonly name = "ArgumentError";
}

export const EXIT_CODES = {
  invalidArguments: 2,
  videoData: 3,
  translation: 4,
  timeout: 5,
  subtitles: 6,
  download: 7,
  fileIO: 8,
  configuration: 9,
  unexpected: 10,
} as const;

export type AppErrorCode = keyof typeof EXIT_CODES;
export type AppExitCode = (typeof EXIT_CODES)[AppErrorCode];

export interface AppErrorOptions {
  details?: unknown;
  cause?: unknown;
}

export class AppError extends Error {
  override readonly name = "AppError";
  readonly exitCode: AppExitCode;
  readonly details?: unknown;

  constructor(
    readonly code: AppErrorCode,
    message: string,
    options?: AppErrorOptions,
  ) {
    super(
      message,
      options !== undefined && "cause" in options
        ? { cause: options.cause }
        : undefined,
    );
    this.exitCode = EXIT_CODES[code];
    if (options?.details !== undefined) {
      this.details = options.details;
    }
  }
}

export interface HelpCommand {
  kind: "help";
}

export interface VersionCommand {
  kind: "version";
}

export interface TranslateCommand {
  kind: "translate";
  url: string;
  sourceLang: string;
  targetLang: string;
  timeoutSeconds: number;
  noWait: boolean;
  livelyVoice: boolean;
  output?: string;
  force: boolean;
  quiet: boolean;
}

export type SubtitlesFormat = "srt" | "vtt" | "json";

export interface UpstreamSubtitleTrack {
  language: string;
  url: string;
  translatedLanguage?: string;
  translatedUrl?: string;
}

export interface OriginalSubtitleTrack {
  kind: "original";
  language: string;
  url: string;
}

export interface TranslatedSubtitleTrack {
  kind: "translated";
  language: string;
  url: string;
  translatedFromLanguage: string;
}

export type SelectedSubtitleTrack =
  | OriginalSubtitleTrack
  | TranslatedSubtitleTrack;

export interface SubtitleCue {
  text: string;
  startMs: number;
  durationMs: number;
}

export interface SubtitlesCommand {
  kind: "subtitles";
  url: string;
  sourceLang: string;
  targetLang: string;
  format: SubtitlesFormat;
  original: boolean;
  output?: string;
  force: boolean;
  quiet: boolean;
}

export type ParsedCommand =
  | HelpCommand
  | VersionCommand
  | TranslateCommand
  | SubtitlesCommand;
