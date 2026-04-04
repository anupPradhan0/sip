/**
 * Lightweight structured logging. In production, defaults to one JSON line per event
 * for easier searching in journals / log aggregators. Set LOG_FORMAT=pretty for human-readable.
 */

import { env } from "../config/env";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function envLevel(): LogLevel {
  const raw = env.logLevel?.toLowerCase().trim();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

const minRank = () => LEVEL_RANK[envLevel()];

function useJsonLines(): boolean {
  if (env.logFormat?.toLowerCase() === "pretty") return false;
  return process.env.NODE_ENV === "production";
}

export function serializeError(err: unknown): Record<string, string | undefined> {
  if (err instanceof Error) {
    return {
      errName: err.name,
      errMessage: err.message,
      errStack: err.stack,
    };
  }
  return { errMessage: typeof err === "string" ? err : JSON.stringify(err) };
}

function emit(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] < minRank()) {
    return;
  }
  const ts = new Date().toISOString();
  const base = { ts, level, msg, ...meta };

  if (useJsonLines()) {
    const line = JSON.stringify(base);
    if (level === "error") {
      // eslint-disable-next-line no-console
      console.error(line);
    } else if (level === "warn") {
      // eslint-disable-next-line no-console
      console.warn(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
    return;
  }

  const metaStr =
    meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  const line = `[${ts}] ${level.toUpperCase()} ${msg}${metaStr}`;
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(line);
  } else if (level === "warn") {
    // eslint-disable-next-line no-console
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export const logger = {
  debug(msg: string, meta?: Record<string, unknown>): void {
    emit("debug", msg, meta);
  },
  info(msg: string, meta?: Record<string, unknown>): void {
    emit("info", msg, meta);
  },
  warn(msg: string, meta?: Record<string, unknown>): void {
    emit("warn", msg, meta);
  },
  error(msg: string, meta?: Record<string, unknown> & { err?: unknown }): void {
    const { err, ...rest } = meta ?? {};
    const errFields = err !== undefined ? serializeError(err) : {};
    emit("error", msg, { ...rest, ...errFields });
  },
};
