export class ArgumentError extends Error {
  override readonly name = "ArgumentError";
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
