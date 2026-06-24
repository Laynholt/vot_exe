import {
  AppError,
  EXIT_CODES,
  type AppErrorCode,
  type AppExitCode,
} from "./contracts";

export { AppError, EXIT_CODES } from "./contracts";

export interface SuccessEnvelopeInput<T> {
  operation: string;
  helperVersion: string;
  votVersion: string;
  data: T;
}

export interface ErrorEnvelopeContext {
  operation?: string;
  helperVersion: string;
  votVersion: string;
}

export interface SuccessEnvelope<T> {
  schemaVersion: 1;
  ok: true;
  operation: string;
  helperVersion: string;
  votVersion: string;
  data: T;
}

export interface ErrorPayload {
  code: AppErrorCode;
  message: string;
  details?: unknown;
}

export interface ErrorEnvelope {
  schemaVersion: 1;
  ok: false;
  operation?: string;
  helperVersion: string;
  votVersion: string;
  error: ErrorPayload;
}

export type ResultEnvelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

export interface NormalizedError {
  exitCode: AppExitCode;
  envelope: ErrorEnvelope;
}

const UNEXPECTED_MESSAGE = "An unexpected error occurred.";
const SECRET_VALUE = "$1[REDACTED]";
const SECRET_PATTERNS = [
  /\b((?:OAuth|Bearer)\s+)[^\s,;]+/gi,
  /\b(VOT_API_TOKEN\s*=\s*)[^\s,;]+/gi,
  /\b(Session_id\s*=\s*)[^\s,;]+/gi,
] as const;

export function successEnvelope<T>(
  input: SuccessEnvelopeInput<T>,
): SuccessEnvelope<T> {
  return {
    schemaVersion: 1,
    ok: true,
    operation: input.operation,
    helperVersion: input.helperVersion,
    votVersion: input.votVersion,
    data: input.data,
  };
}

function redactString(value: string): string {
  return SECRET_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, SECRET_VALUE),
    value,
  );
}

export function redactSecrets<T>(value: T): T {
  if (typeof value === "string") {
    return redactString(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item)) as T;
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactSecrets(item)]),
    ) as T;
  }

  return value;
}

function makeErrorEnvelope(
  context: ErrorEnvelopeContext,
  error: ErrorPayload,
): ErrorEnvelope {
  return {
    schemaVersion: 1,
    ok: false,
    ...(context.operation === undefined
      ? {}
      : { operation: context.operation }),
    helperVersion: context.helperVersion,
    votVersion: context.votVersion,
    error,
  };
}

export function normalizeError(
  error: unknown,
  context: ErrorEnvelopeContext,
): NormalizedError {
  if (error instanceof AppError) {
    const payload: ErrorPayload = {
      code: error.code,
      message: redactSecrets(error.message),
      ...(error.details === undefined
        ? {}
        : { details: redactSecrets(error.details) }),
    };

    return {
      exitCode: error.exitCode,
      envelope: makeErrorEnvelope(context, payload),
    };
  }

  return {
    exitCode: EXIT_CODES.unexpected,
    envelope: makeErrorEnvelope(context, {
      code: "unexpected",
      message: UNEXPECTED_MESSAGE,
    }),
  };
}

export function errorEnvelope(
  error: unknown,
  context: ErrorEnvelopeContext,
): ErrorEnvelope {
  return normalizeError(error, context).envelope;
}

export function serializeEnvelope(envelope: ResultEnvelope): string {
  return `${JSON.stringify(envelope)}\n`;
}
