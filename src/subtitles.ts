import {
  AppError,
  type SelectedSubtitleTrack,
  type SubtitleCue,
  type SubtitlesFormat,
  type UpstreamSubtitleTrack,
} from "./contracts";

export interface SubtitleSelectionOptions {
  original: boolean;
  sourceLang: string;
  targetLang: string;
}

interface IndexedCue extends SubtitleCue {
  originalIndex: number;
}

function availableTrackDetails(tracks: readonly UpstreamSubtitleTrack[]) {
  return {
    availableTracks: tracks.map((track) => ({
      language: track.language,
      ...(track.translatedLanguage === undefined
        ? {}
        : { translatedLanguage: track.translatedLanguage }),
    })),
  };
}

export function selectSubtitleTrack(
  tracks: readonly UpstreamSubtitleTrack[],
  options: SubtitleSelectionOptions,
): SelectedSubtitleTrack {
  const candidates: SelectedSubtitleTrack[] = options.original
    ? tracks
        .filter(
          (track) =>
            options.sourceLang === "auto" ||
            track.language === options.sourceLang,
        )
        .map((track) => ({
          kind: "original",
          language: track.language,
          url: track.url,
        }))
    : tracks
        .filter(
          (track) =>
            track.translatedLanguage === options.targetLang &&
            typeof track.translatedUrl === "string" &&
            track.translatedUrl.length > 0 &&
            (options.sourceLang === "auto" ||
              track.language === options.sourceLang),
        )
        .map((track) => ({
          kind: "translated",
          language: track.translatedLanguage!,
          url: track.translatedUrl!,
          translatedFromLanguage: track.language,
        }));

  if (candidates.length === 1) {
    return candidates[0]!;
  }

  const details = availableTrackDetails(tracks);
  if (candidates.length === 0) {
    throw new AppError(
      "subtitles",
      "No subtitle track matched the requested languages.",
      { details },
    );
  }

  throw new AppError(
    "subtitles",
    "Subtitle track selection is ambiguous.",
    { details },
  );
}

function cueArray(input: unknown): unknown[] {
  if (Array.isArray(input)) {
    return input;
  }
  if (
    typeof input === "object" &&
    input !== null &&
    "subtitles" in input &&
    Array.isArray((input as { subtitles?: unknown }).subtitles)
  ) {
    return (input as { subtitles: unknown[] }).subtitles;
  }

  throw new AppError("subtitles", "Invalid VOT subtitle payload.");
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function normalizeVotCues(input: unknown): SubtitleCue[] {
  const normalized: IndexedCue[] = [];

  for (const [originalIndex, value] of cueArray(input).entries()) {
    if (typeof value !== "object" || value === null) {
      throw new AppError("subtitles", "Invalid VOT subtitle cue.");
    }

    const cue = value as {
      text?: unknown;
      startMs?: unknown;
      durationMs?: unknown;
    };
    if (typeof cue.text !== "string") {
      throw new AppError("subtitles", "Invalid VOT subtitle cue text.");
    }
    if (
      typeof cue.startMs !== "number" ||
      !Number.isFinite(cue.startMs) ||
      cue.startMs < 0
    ) {
      throw new AppError("subtitles", "Invalid VOT subtitle cue start time.");
    }
    if (
      typeof cue.durationMs !== "number" ||
      !Number.isFinite(cue.durationMs) ||
      cue.durationMs <= 0
    ) {
      throw new AppError("subtitles", "Invalid VOT subtitle cue duration.");
    }

    const text = normalizeNewlines(cue.text);
    if (text.trim().length === 0) {
      continue;
    }

    normalized.push({
      text,
      startMs: cue.startMs,
      durationMs: cue.durationMs,
      originalIndex,
    });
  }

  normalized.sort(
    (left, right) =>
      left.startMs - right.startMs || left.originalIndex - right.originalIndex,
  );

  return normalized.map(({ text, startMs, durationMs }) => ({
    text,
    startMs,
    durationMs,
  }));
}

function timestamp(milliseconds: number, separator: "," | "."): string {
  const rounded = Math.round(milliseconds);
  const hours = Math.floor(rounded / 3_600_000);
  const minutes = Math.floor((rounded % 3_600_000) / 60_000);
  const seconds = Math.floor((rounded % 60_000) / 1_000);
  const millis = rounded % 1_000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

function cueText(text: string, escapeHtml: boolean): string {
  const normalized = normalizeNewlines(text);
  const escaped = escapeHtml
    ? normalized
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
    : normalized;
  return escaped.replace(/\n/g, "\r\n");
}

export function serializeSubtitles(
  cues: readonly SubtitleCue[],
  format: SubtitlesFormat,
): string {
  if (format === "json") {
    return `${JSON.stringify(cues, null, 2)}\n`;
  }

  const separator = format === "srt" ? "," : ".";
  const blocks = cues.map((cue, index) => {
    const timing = `${timestamp(cue.startMs, separator)} --> ${timestamp(cue.startMs + cue.durationMs, separator)}`;
    const text = cueText(cue.text, format === "vtt");
    return format === "srt"
      ? `${index + 1}\r\n${timing}\r\n${text}`
      : `${timing}\r\n${text}`;
  });

  if (format === "vtt") {
    return `WEBVTT\r\n\r\n${blocks.join("\r\n\r\n")}${blocks.length === 0 ? "" : "\r\n"}`;
  }
  return blocks.length === 0 ? "" : `${blocks.join("\r\n\r\n")}\r\n`;
}
