import type { LogLevel } from "./common";

// ANSI color codes
export const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m", // for timestamp
  gray: "\x1b[90m", // for debug
  cyan: "\x1b[36m", // for info
  yellow: "\x1b[33m", // for warn
  red: "\x1b[31m", // for error
  brightRed: "\x1b[91m", // for fatal
  magenta: "\x1b[35m", // for module (fallback)
  blue: "\x1b[34m", // for duration tag
} as const;

export const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.gray,
  info: COLORS.cyan,
  warn: COLORS.yellow,
  error: COLORS.red,
  fatal: COLORS.brightRed,
};

// Simple hash function for consistent module colors
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// Convert HSL to RGB (h: 0-360, s: 0-1, l: 0-1)
export function hslToRgb(
  h: number,
  s: number,
  l: number,
): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

// Generate truecolor escape code from module name
export function moduleToTruecolor(module: string): string {
  const hue = hashString(module) % 360;
  const [r, g, b] = hslToRgb(hue, 0.7, 0.6); // Fixed saturation/lightness for readability
  return `\x1b[38;2;${r};${g};${b}m`;
}
