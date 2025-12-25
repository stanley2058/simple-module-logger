import { inspect } from "util";
import { COLORS, LEVEL_COLORS, moduleToTruecolor } from "./color";
import {
  formatDuration,
  type TimerFormat,
  type TimerOptions,
} from "./duration";
import { LOG_LEVELS, type ILogger, type ITimer, type LogLevel } from "./common";

// Minimal interface for writable streams (compatible with NodeJS.WriteStream)
export interface WriteStream {
  write(chunk: string): unknown;
}

// Stream routing: debug/info -> stdout, warn/error/fatal -> stderr
const STDOUT_LEVELS: LogLevel[] = ["debug", "info"];

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

export interface LoggerOptions {
  logLevel?: LogLevel;
  module?: string;
  stdout?: WriteStream;
  stderr?: WriteStream;
}

export class Logger implements ILogger {
  private logLevel: LogLevel;
  private module: string;
  private useColor: boolean;
  private useTruecolor: boolean;
  private moduleColor: string;
  private stdout: WriteStream;
  private stderr: WriteStream;

  constructor({
    logLevel = "info",
    module = "",
    stdout = process.stdout,
    stderr = process.stderr,
  }: LoggerOptions = {}) {
    if (!LOG_LEVELS.includes(logLevel)) {
      throw new Error(
        `Invalid log level: "${logLevel}". Valid levels: ${LOG_LEVELS.join(", ")}`,
      );
    }
    this.logLevel = logLevel;
    this.module = module;
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
    const stream = STDOUT_LEVELS.includes(level) ? this.stdout : this.stderr;
    stream.write(message + "\n");
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

  log(level: LogLevel, message: any, ...args: any[]): void {
    if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(this.logLevel)) return;

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

  // Short aliases
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

  setLogLevel(level: LogLevel): void {
    if (!LOG_LEVELS.includes(level)) {
      throw new Error(
        `Invalid log level: "${level}". Valid levels: ${LOG_LEVELS.join(", ")}`,
      );
    }
    this.logLevel = level;
  }

  setModule(module: string): void {
    this.module = module;
    this.moduleColor = this.computeModuleColor();
  }

  timer(options?: TimerOptions): ITimer {
    return new Timer(this, options);
  }

  // Format a duration tag for timer logs
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

  private prependDurationTag(message: any): string {
    const elapsed = performance.now() - this.startTime;
    const formatted = formatDuration(elapsed, this.format);
    const durationTag = this.logger.formatDurationTag(formatted);
    // Use inspect for objects to avoid [object Object]
    const messageStr =
      typeof message === "string"
        ? message
        : inspect(message, { depth: 10, colors: false });
    return `${durationTag} ${messageStr}`;
  }

  log(level: LogLevel, message: any, ...args: any[]): void {
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
