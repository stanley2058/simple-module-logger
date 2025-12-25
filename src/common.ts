import type { TimerOptions } from "./duration";

/** Available log levels in order of severity (lowest to highest). */
export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

/** Log severity level. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Base logging interface shared by Logger and Timer. */
export interface AbstractLogger {
  log(level: LogLevel, message: any, ...args: any[]): void;
  logDebug(message: any, ...args: any[]): void;
  logInfo(message: any, ...args: any[]): void;
  logWarn(message: any, ...args: any[]): void;
  logError(message: any, ...args: any[]): void;
  logFatal(message: any, ...args: any[]): void;
  debug(message: any, ...args: any[]): void;
  info(message: any, ...args: any[]): void;
  warn(message: any, ...args: any[]): void;
  error(message: any, ...args: any[]): void;
  fatal(message: any, ...args: any[]): void;
}

/** Timer instance that prepends elapsed time to log messages. */
export interface ITimer extends AbstractLogger {}

/** Logger instance with configuration methods and timer support. */
export interface ILogger extends AbstractLogger {
  setLogLevel(level: LogLevel): void;
  setModule(module: string): void;
  timer(options?: TimerOptions): ITimer;
}
