import {
  AppError,
  EXIT_CODES,
  type AppErrorCode,
  type AppExitCode,
} from "./contracts";

export { AppError, EXIT_CODES } from "./contracts";

export interface SuccessEnvelopeInput {
  operation: string;
  helperVersion: string;
  votVersion: string;
  data: unknown;
}

export interface ErrorEnvelopeContext {
  operation?: string;
  helperVersion: string;
  votVersion: string;
}

export interface SuccessEnvelope {
  schemaVersion: 1;
  ok: true;
  operation: string;
  helperVersion: string;
  votVersion: string;
  data: JsonValue;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ErrorPayload {
  code: AppErrorCode;
  message: string;
  details?: JsonValue;
}

export interface ErrorEnvelope {
  schemaVersion: 1;
  ok: false;
  operation?: string;
  helperVersion: string;
  votVersion: string;
  error: ErrorPayload;
}

export type ResultEnvelope = SuccessEnvelope | ErrorEnvelope;

export interface NormalizedError {
  exitCode: AppExitCode;
  envelope: ErrorEnvelope;
}

const UNEXPECTED_MESSAGE = "An unexpected error occurred.";
const CIRCULAR_VALUE = "[Circular]";
const UNSERIALIZABLE_PROPERTY = "[Unserializable property]";
const SECRET_VALUE = "$1[REDACTED]";
const SECRET_PATTERNS = [
  /\b((?:OAuth|Bearer)\s+)[^\s,;]+/gi,
  /\b(VOT_API_TOKEN\s*=\s*)[^\s,;]+/gi,
  /\b(Session_id\s*=\s*)[^\s,;]+/gi,
] as const;

export function successEnvelope(input: SuccessEnvelopeInput): SuccessEnvelope {
  return {
    schemaVersion: 1,
    ok: true,
    operation: input.operation,
    helperVersion: input.helperVersion,
    votVersion: input.votVersion,
    data: redactSecrets(input.data),
  };
}

function redactString(value: string): string {
  return SECRET_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, SECRET_VALUE),
    value,
  );
}

function sanitizeValue(
  value: unknown,
  ancestors: WeakSet<object>,
): JsonValue | undefined {
  switch (typeof value) {
    case "string":
      return redactString(value);
    case "number":
      return Number.isFinite(value) ? value : null;
    case "boolean":
      return value;
    case "bigint":
      return value.toString(10);
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
    case "object":
      break;
  }

  if (value === null) {
    return null;
  }

  try {
    if (value instanceof Date) {
      return Date.prototype.toISOString.call(value);
    }

    if (ancestors.has(value)) {
      return CIRCULAR_VALUE;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    ancestors.add(value);

    try {
      if (Array.isArray(value)) {
        const lengthDescriptor = descriptors.length;
        const length =
          lengthDescriptor !== undefined &&
          "value" in lengthDescriptor &&
          typeof lengthDescriptor.value === "number"
            ? lengthDescriptor.value
            : 0;
        const result: JsonValue[] = [];

        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined) {
            result.push(null);
          } else if (!("value" in descriptor)) {
            result.push(UNSERIALIZABLE_PROPERTY);
          } else {
            result.push(
              sanitizeValue(descriptor.value, ancestors) ?? null,
            );
          }
        }

        return result;
      }

      const result: { [key: string]: JsonValue } = {};
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          key === "toJSON"
        ) {
          continue;
        }

        if (!("value" in descriptor)) {
          result[key] = UNSERIALIZABLE_PROPERTY;
          continue;
        }

        const sanitized = sanitizeValue(descriptor.value, ancestors);
        if (sanitized !== undefined) {
          result[key] = sanitized;
        }
      }

      return result;
    } finally {
      ancestors.delete(value);
    }
  } catch {
    return UNSERIALIZABLE_PROPERTY;
  }
}

export function redactSecrets(value: unknown): JsonValue {
  return sanitizeValue(value, new WeakSet()) ?? null;
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
      message: redactString(error.message),
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
