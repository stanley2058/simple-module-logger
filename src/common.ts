import type { TimerOptions } from "./duration";

export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

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

export interface ITimer extends AbstractLogger {}

export interface ILogger extends AbstractLogger {
  setLogLevel(level: LogLevel): void;
  setModule(module: string): void;
  timer(options?: TimerOptions): ITimer;
}
