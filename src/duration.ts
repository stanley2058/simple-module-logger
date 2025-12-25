/**
 * Duration format style for timer output.
 * - `raw`: Raw milliseconds (e.g., "1234ms")
 * - `long`: Full words (e.g., "1 second, 234 milliseconds")
 * - `short`: Abbreviated (e.g., "1 sec, 234 ms")
 * - `narrow`: Compact (e.g., "1s 234ms")
 * - `digital`: Clock-style (e.g., "0:01:234")
 */
export type TimerFormat = "raw" | "long" | "short" | "narrow" | "digital";

/** Options for configuring a timer instance. */
export interface TimerOptions {
  /** Duration format style. Defaults to "narrow". */
  format?: TimerFormat;
}

// Type declarations for Intl.DurationFormat (not yet in standard TypeScript lib)
declare namespace Intl {
  interface DurationFormatOptions {
    style?: "long" | "short" | "narrow" | "digital";
    years?: "long" | "short" | "narrow";
    months?: "long" | "short" | "narrow";
    weeks?: "long" | "short" | "narrow";
    days?: "long" | "short" | "narrow";
    hours?: "long" | "short" | "narrow" | "numeric" | "2-digit";
    minutes?: "long" | "short" | "narrow" | "numeric" | "2-digit";
    seconds?: "long" | "short" | "narrow" | "numeric" | "2-digit";
    milliseconds?: "long" | "short" | "narrow" | "numeric";
    fractionalDigits?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  }

  interface DurationInput {
    years?: number;
    months?: number;
    weeks?: number;
    days?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
    milliseconds?: number;
    microseconds?: number;
    nanoseconds?: number;
  }

  class DurationFormat {
    constructor(locales?: string | string[], options?: DurationFormatOptions);
    format(duration: DurationInput): string;
  }
}

/** @internal Convert milliseconds to duration object for Intl.DurationFormat. */
export function msToDuration(ms: number): Intl.DurationInput {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = Math.round(ms % 1000);
  return { hours, minutes, seconds, milliseconds };
}

/** Format a duration in milliseconds according to the specified style. */
export function formatDuration(ms: number, format: TimerFormat): string {
  if (format === "raw") {
    return `${Math.round(ms)}ms`;
  }
  const duration = msToDuration(ms);
  return new Intl.DurationFormat(undefined, { style: format }).format(duration);
}
