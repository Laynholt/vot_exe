import VOTClient, { VOTWorkerClient } from "@vot.js/node";
import { getVideoData } from "@vot.js/node/utils/videoData";
import packageJson from "../package.json" with { type: "json" };

import { parseArgs, HELP_TEXT } from "./args";
import { runCommand, type AppDeps } from "./app";
import {
  assertLivelyVoiceAllowed,
  createVotClient,
  readRuntimeConfig,
} from "./config";
import { AppError, ArgumentError, type ParsedCommand } from "./contracts";
import { normalizeError, serializeEnvelope } from "./result";

declare const VOT_HELPER_RELEASE: string | undefined;

function displayHelperVersion(release: string | undefined): string {
  const match = /^vot-(\d+\.\d+\.\d+)-r(\d+)$/.exec(release ?? "");
  if (match) {
    return `${match[1]}-R${match[2]}`;
  }
  return release ?? "development";
}

const HELPER_VERSION =
  displayHelperVersion(
    typeof VOT_HELPER_RELEASE === "string"
      ? VOT_HELPER_RELEASE
      : process.env.VOT_HELPER_RELEASE,
  );
const VOT_VERSION = packageJson.dependencies["@vot.js/node"];

function diagnostic(message: string): void {
  process.stderr.write(`${message}\n`);
}

function print(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

function operationFor(command: ParsedCommand): string {
  return command.kind;
}

function writeArgumentError(error: ArgumentError): number {
  diagnostic(error.message);
  const normalized = normalizeError(
    new AppError("invalidArguments", error.message),
    {
      operation: "arguments",
      helperVersion: HELPER_VERSION,
      votVersion: VOT_VERSION,
    },
  );
  process.stdout.write(serializeEnvelope(normalized.envelope));
  return normalized.exitCode;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new AppError(
      "subtitles",
      `Subtitle request failed with HTTP ${response.status}.`,
    );
  }
  return await response.json();
}

function makeDeps(client: unknown): AppDeps {
  return {
    getVideoData,
    client: client as never,
    getSubtitles: async (input: unknown) => {
      return await (client as { getSubtitles(input: unknown): Promise<unknown> })
        .getSubtitles(input);
    },
    fetchJson,
  };
}

async function main(argv: string[]): Promise<number> {
  let command: ParsedCommand;
  try {
    command = parseArgs(argv);
  } catch (error) {
    if (error instanceof ArgumentError) {
      return writeArgumentError(error);
    }
    throw error;
  }

  if (command.kind === "help") {
    print(HELP_TEXT);
    return 0;
  }
  if (command.kind === "version") {
    print(`vot-helper ${HELPER_VERSION}\n@vot.js/node ${VOT_VERSION}`);
    return 0;
  }

  const config = readRuntimeConfig(process.env);
  if (command.kind === "translate") {
    assertLivelyVoiceAllowed(config, command);
  }

  const client = createVotClient(config, { VOTClient, VOTWorkerClient });
  const result = await runCommand(
    command,
    {
      helperVersion: HELPER_VERSION,
      votVersion: VOT_VERSION,
      config,
    },
    makeDeps(client),
  );

  if (!result.envelope.ok) {
    diagnostic(result.envelope.error.message);
  }
  process.stdout.write(serializeEnvelope(result.envelope));
  return result.exitCode;
}

try {
  process.exitCode = await main(Bun.argv.slice(2));
} catch (error) {
  const normalized = normalizeError(error, {
    operation: "unexpected",
    helperVersion: HELPER_VERSION,
    votVersion: VOT_VERSION,
  });
  diagnostic(normalized.envelope.error.message);
  process.stdout.write(serializeEnvelope(normalized.envelope));
  process.exitCode = normalized.exitCode;
}
