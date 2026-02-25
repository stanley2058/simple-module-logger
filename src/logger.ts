import { inspect } from "util";
import { COLORS, LEVEL_COLORS, moduleToTruecolor } from "./color";
import {
  formatDuration,
  type TimerFormat,
  type TimerOptions,
} from "./duration";
import { LOG_LEVELS, type ILogger, type ITimer, type LogLevel } from "./common";
import { createNullWriteStream } from "./null";

/** Minimal writable stream interface (compatible with NodeJS.WriteStream). */
export interface WriteStream {
  write(chunk: string): unknown;
}

// Stream routing: debug/info -> stdout, warn/error/fatal -> stderr
const STDOUT_LEVELS: LogLevel[] = ["debug", "info"];
const OUTPUT_FORMATS = ["text", "jsonl"] as const;

export type LoggerOutputFormat = (typeof OUTPUT_FORMATS)[number];

interface JsonLogContext {
  duration?: string;
  durationMs?: number;
}

// Extract error message from an Error object
function formatErrorMessage(error: Error): string {
  // Check explicitly for empty string since it's falsy but valid
  if (error.message !== undefined && error.message !== "") {
    return error.message;
  }
  // Fallback to error name (e.g., "TypeError", "RangeError")
  return error.name || "Error";
}

// Get the cause chain from an error (with circular reference protection)
function getErrorCauses(error: Error): Error[] {
  const causes: Error[] = [];
  const seen = new Set<Error>([error]);
  let current = error.cause;
  while (current instanceof Error) {
    if (seen.has(current)) break; // Circular reference detected
    seen.add(current);
    causes.push(current);
    current = current.cause;
  }
  return causes;
}

// Capture native stack trace
function captureNativeStack(): string {
  const err = new Error();
  const stack = err.stack || "";
  const lines = stack.split("\n");
  // Remove first line ("Error")
  return lines.slice(1).join("\n");
}

/** Configuration options for creating a Logger instance. */
export interface LoggerOptions {
  /** Minimum log level to output. Defaults to "info". */
  logLevel?: LogLevel;
  /** Module name shown in log prefix. */
  module?: string;
  /**
   * Output format for each log line.
   * - "text": human-readable output with colors and prefixes
   * - "jsonl": newline-delimited JSON records for log ingestion
   *
   * Defaults to "text".
   */
  outputFormat?: LoggerOutputFormat;
  /**
   * Stream routing behavior for "jsonl" output.
   *
   * Defaults to false, which writes all levels to stdout as one unified stream.
   * Set to true to keep split routing (debug/info -> stdout, warn/error/fatal -> stderr).
   */
  jsonlSplitStreams?: boolean;
  /**
   * Output stream for debug/info logs in text mode.
   * In jsonl mode this is the default unified stream for all levels.
   */
  stdout?: WriteStream;
  /**
   * Output stream for warn/error/fatal logs in text mode.
   * In jsonl mode this is used only when jsonlSplitStreams is true.
   */
  stderr?: WriteStream;
}

/**
 * A configurable logger with module tagging, colored output, and timer support.
 *
 * @example
 * ```ts
 * const logger = new Logger({ module: "api", logLevel: "debug" });
 * logger.info("Server started", { port: 3000 });
 * logger.error("Request failed", new Error("timeout"));
 * ```
 */
export class Logger implements ILogger {
  private logLevel: LogLevel;
  private module: string;
  private useColor: boolean;
  private useTruecolor: boolean;
  private moduleColor: string;
  private stdout: WriteStream;
  private stderr: WriteStream;
  private outputFormat: LoggerOutputFormat;
  private jsonlSplitStreams: boolean;

  constructor({
    logLevel = "info",
    module = "",
    outputFormat = "text",
    jsonlSplitStreams = false,
    stdout = process.env.NODE_ENV === "test"
      ? createNullWriteStream()
      : process.stdout,
    stderr = process.env.NODE_ENV === "test"
      ? createNullWriteStream()
      : process.stderr,
  }: LoggerOptions = {}) {
    if (!LOG_LEVELS.includes(logLevel)) {
      throw new Error(
        `Invalid log level: "${logLevel}". Valid levels: ${LOG_LEVELS.join(", ")}`,
      );
    }
    if (!OUTPUT_FORMATS.includes(outputFormat)) {
      throw new Error(
        `Invalid output format: "${outputFormat}". Valid formats: ${OUTPUT_FORMATS.join(", ")}`,
      );
    }
    this.logLevel = logLevel;
    this.module = module;
    this.outputFormat = outputFormat;
    this.jsonlSplitStreams = jsonlSplitStreams;
    this.stdout = stdout;
    this.stderr = stderr;
    this.useColor = this.detectColorSupport();
    this.useTruecolor = this.detectTruecolorSupport();
    this.moduleColor = this.computeModuleColor();
  }

  private detectColorSupport(): boolean {
    if (process.env["NO_COLOR"] !== undefined) return false;
    if (process.env["FORCE_COLOR"] !== undefined) return true;
    if (typeof Bun === "undefined") return process.stdout.isTTY;
    return Bun.enableANSIColors;
  }

  private detectTruecolorSupport(): boolean {
    if (!this.useColor) return false;
    const colorterm = process.env["COLORTERM"];
    return colorterm === "truecolor" || colorterm === "24bit";
  }

  private computeModuleColor(): string {
    if (!this.module) return "";
    return this.useTruecolor ? moduleToTruecolor(this.module) : COLORS.magenta;
  }

  private colorize(text: string, color: string): string {
    if (!this.useColor) return text;
    return `${color}${text}${COLORS.reset}`;
  }

  // Format a value for logging, avoiding [object Object]
  private formatValue(value: unknown): string {
    if (typeof value === "string") return value;
    if (value instanceof Error) return formatErrorMessage(value);
    return inspect(value, { depth: 10, colors: this.useColor });
  }

  // Format all args into a single string
  private formatArgs(args: any[]): string {
    if (args.length === 0) return "";
    return " " + args.map((arg) => this.formatValue(arg)).join(" ");
  }

  // Build the log prefix (timestamp + level + module)
  private buildPrefix(level: LogLevel): string {
    const timestamp = this.colorize(new Date().toISOString(), COLORS.dim);
    const levelTag = this.colorize(
      `[${level.toUpperCase()}]`.padEnd(7),
      LEVEL_COLORS[level],
    );
    const moduleTag = this.module
      ? this.colorize(`[${this.module}]`, this.moduleColor) + " "
      : "";
    // Fixed spacing: timestamp + 2 spaces + levelTag (padded to 7) + 2 spaces + moduleTag + message
    return `${timestamp}  ${levelTag}  ${moduleTag}`;
  }

  // Write a line to the appropriate stream
  private writeLine(level: LogLevel, message: string): void {
    const useUnifiedJsonStream =
      this.outputFormat === "jsonl" && !this.jsonlSplitStreams;
    const stream = useUnifiedJsonStream
      ? this.stdout
      : STDOUT_LEVELS.includes(level)
        ? this.stdout
        : this.stderr;
    stream.write(message + "\n");
  }

  private serializeError(error: Error): Record<string, unknown> {
    const details: Record<string, unknown> = {
      name: error.name || "Error",
      message: formatErrorMessage(error),
    };
    if (error.stack) {
      details["stack"] = error.stack;
    }

    const causes = getErrorCauses(error);
    if (causes.length > 0) {
      details["causes"] = causes.map((cause) => ({
        name: cause.name || "Error",
        message: formatErrorMessage(cause),
        stack: cause.stack,
      }));
    }

    return details;
  }

  private stringifyJsonRecord(record: Record<string, unknown>): string {
    const recordBuilder = this;
    const ancestors: object[] = [];
    return JSON.stringify(record, function (this: unknown, _key, value: unknown): unknown {
      if (value instanceof Error) {
        return recordBuilder.serializeError(value);
      }
      if (typeof value === "bigint") {
        return value.toString();
      }
      if (typeof value === "function" || typeof value === "symbol") {
        return inspect(value, { depth: 1, colors: false });
      }
      if (typeof value === "undefined") {
        return null;
      }
      if (typeof value === "object" && value !== null) {
        while (
          ancestors.length > 0 &&
          ancestors[ancestors.length - 1] !== this &&
          this !== undefined
        ) {
          ancestors.pop();
        }
        if (ancestors.includes(value)) {
          return "[Circular]";
        }
        ancestors.push(value);
      }
      return value;
    });
  }

  private buildJsonRecord(
    level: LogLevel,
    message: unknown,
    args: unknown[],
    context?: JsonLogContext,
  ): Record<string, unknown> {
    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (this.module) {
      record["module"] = this.module;
    }
    if (args.length > 0) {
      record["args"] = args;
    }
    if (context?.duration !== undefined) {
      record["duration"] = context.duration;
    }
    if (context?.durationMs !== undefined) {
      record["durationMs"] = context.durationMs;
    }

    if (level === "error" || level === "fatal") {
      const errors = [message, ...args].filter((v): v is Error => v instanceof Error);
      if (errors.length > 0) {
        record["errors"] = errors.map((error) => this.serializeError(error));
      }
      record["nativeStack"] = captureNativeStack();
    }

    return record;
  }

  // Log error cause chain as separate lines
  private logCauseChain(level: LogLevel, error: Error): void {
    const causes = getErrorCauses(error);
    const prefix = this.buildPrefix(level);
    for (const cause of causes) {
      this.writeLine(
        level,
        `${prefix}  Caused by: ${formatErrorMessage(cause)}`,
      );
    }
  }

  // Log stack trace
  private logStack(level: LogLevel, stack: string, indent: string = ""): void {
    const prefix = this.buildPrefix(level);
    const lines = stack.split("\n").filter((line) => line.trim());
    for (const line of lines) {
      this.writeLine(level, `${prefix}${indent}${line}`);
    }
  }

  /**
   * Log a message at the specified level.
   * @param level - Log level (debug, info, warn, error, fatal)
   * @param message - Primary message or value to log
   * @param args - Additional values to log
   */
  log(level: LogLevel, message: any, ...args: any[]): void {
    this.logInternal(level, message, args);
  }

  /** @internal */
  isJsonlOutput(): boolean {
    return this.outputFormat === "jsonl";
  }

  /** @internal */
  logWithContext(
    level: LogLevel,
    message: unknown,
    args: unknown[],
    context?: JsonLogContext,
  ): void {
    this.logInternal(level, message, args, context);
  }

  private logInternal(
    level: LogLevel,
    message: unknown,
    args: unknown[],
    context?: JsonLogContext,
  ): void {
    if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(this.logLevel)) return;

    if (this.outputFormat === "jsonl") {
      const jsonRecord = this.buildJsonRecord(level, message, args, context);
      this.writeLine(level, this.stringifyJsonRecord(jsonRecord));

      if (level === "fatal") {
        process.exit(1);
      }
      return;
    }

    const prefix = this.buildPrefix(level);
    const formattedMessage = this.formatValue(message);
    const formattedArgs = this.formatArgs(args);
    const outputMessage = `${prefix}${formattedMessage}${formattedArgs}`;

    this.writeLine(level, outputMessage);

    // Handle error/fatal stack traces
    if (level === "error" || level === "fatal") {
      // Find all Error objects in message and args
      const allValues = [message, ...args];
      const errors = allValues.filter((v): v is Error => v instanceof Error);

      // Log cause chains and stacks for any Error objects
      for (const error of errors) {
        this.logCauseChain(level, error);
        if (error.stack) {
          this.logStack(level, error.stack, "  ");
        }
      }

      // Always append native stack trace at the end
      const nativeStack = captureNativeStack();
      if (nativeStack) {
        this.writeLine(level, `${prefix}  Stack trace:`);
        this.logStack(level, nativeStack, "  ");
      }
    }

    // Handle fatal: exit after logging
    if (level === "fatal") {
      process.exit(1);
    }
  }

  /** Log at debug level. */
  logDebug(message: any, ...args: any[]): void {
    this.log("debug", message, ...args);
  }

  /** Log at info level. */
  logInfo(message: any, ...args: any[]): void {
    this.log("info", message, ...args);
  }

  /** Log at warn level. */
  logWarn(message: any, ...args: any[]): void {
    this.log("warn", message, ...args);
  }

  /** Log at error level. Includes stack traces for Error objects. */
  logError(message: any, ...args: any[]): void {
    this.log("error", message, ...args);
  }

  /** Log at fatal level and exit the process. */
  logFatal(message: any, ...args: any[]): void {
    this.log("fatal", message, ...args);
  }

  /** Alias for {@link logDebug}. */
  debug(message: any, ...args: any[]): void {
    this.logDebug(message, ...args);
  }

  /** Alias for {@link logInfo}. */
  info(message: any, ...args: any[]): void {
    this.logInfo(message, ...args);
  }

  /** Alias for {@link logWarn}. */
  warn(message: any, ...args: any[]): void {
    this.logWarn(message, ...args);
  }

  /** Alias for {@link logError}. */
  error(message: any, ...args: any[]): void {
    this.logError(message, ...args);
  }

  /** Alias for {@link logFatal}. */
  fatal(message: any, ...args: any[]): void {
    this.logFatal(message, ...args);
  }

  /**
   * Change the minimum log level at runtime.
   * @throws Error if level is invalid
   */
  setLogLevel(level: LogLevel): void {
    if (!LOG_LEVELS.includes(level)) {
      throw new Error(
        `Invalid log level: "${level}". Valid levels: ${LOG_LEVELS.join(", ")}`,
      );
    }
    this.logLevel = level;
  }

  /** Change the module name shown in log prefix. */
  setModule(module: string): void {
    this.module = module;
    this.moduleColor = this.computeModuleColor();
  }

  /**
   * Create a timer that prepends elapsed time to log messages.
   * @example
   * ```ts
   * const timer = logger.timer();
   * // ... do work ...
   * timer.info("Operation complete"); // [1.2s] Operation complete
   * ```
   */
  timer(options?: TimerOptions): ITimer {
    return new Timer(this, options);
  }

  /** @internal Format a duration tag for timer logs. */
  formatDurationTag(durationStr: string): string {
    return this.colorize(`[${durationStr}]`, COLORS.blue);
  }
}

class Timer implements ITimer {
  private startTime: number;
  private logger: Logger;
  private format: TimerFormat;

  constructor(logger: Logger, options?: TimerOptions) {
    this.startTime = performance.now();
    this.logger = logger;
    this.format = options?.format ?? "narrow";
  }

  private getElapsedDuration(): { elapsedMs: number; formatted: string } {
    const elapsed = performance.now() - this.startTime;
    const formatted = formatDuration(elapsed, this.format);
    return { elapsedMs: elapsed, formatted };
  }

  private prependDurationTag(message: any): string {
    const { formatted } = this.getElapsedDuration();
    const durationTag = this.logger.formatDurationTag(formatted);
    // Use inspect for objects to avoid [object Object]
    const messageStr =
      typeof message === "string"
        ? message
        : inspect(message, { depth: 10, colors: false });
    return `${durationTag} ${messageStr}`;
  }

  log(level: LogLevel, message: any, ...args: any[]): void {
    if (this.logger.isJsonlOutput()) {
      const { elapsedMs, formatted } = this.getElapsedDuration();
      this.logger.logWithContext(level, message, args, {
        duration: formatted,
        durationMs: Math.round(elapsedMs),
      });
      return;
    }
    this.logger.log(level, this.prependDurationTag(message), ...args);
  }

  logDebug(message: any, ...args: any[]): void {
    this.log("debug", message, ...args);
  }

  logInfo(message: any, ...args: any[]): void {
    this.log("info", message, ...args);
  }

  logWarn(message: any, ...args: any[]): void {
    this.log("warn", message, ...args);
  }

  logError(message: any, ...args: any[]): void {
    this.log("error", message, ...args);
  }

  logFatal(message: any, ...args: any[]): void {
    this.log("fatal", message, ...args);
  }

  debug(message: any, ...args: any[]): void {
    this.logDebug(message, ...args);
  }

  info(message: any, ...args: any[]): void {
    this.logInfo(message, ...args);
  }

  warn(message: any, ...args: any[]): void {
    this.logWarn(message, ...args);
  }

  error(message: any, ...args: any[]): void {
    this.logError(message, ...args);
  }

  fatal(message: any, ...args: any[]): void {
    this.logFatal(message, ...args);
  }
}
