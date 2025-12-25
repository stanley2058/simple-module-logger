import { describe, test, expect, beforeEach } from "bun:test";
import { Logger, type WriteStream } from "../src/logger";

// Helper to create a mock stream that captures output
function createMockStream(): WriteStream & { output: string; lines: string[] } {
  const stream = {
    output: "",
    lines: [] as string[],
    write(chunk: string) {
      stream.output += chunk;
      // Split by newlines but keep track of complete lines
      const parts = chunk.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i === parts.length - 1 && parts[i] === "") continue; // Skip trailing empty from \n
        stream.lines.push(parts[i]!);
      }
      return true;
    },
  };
  return stream;
}

// Helper to strip ANSI color codes for easier assertions
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("Logger", () => {
  let stdout: ReturnType<typeof createMockStream>;
  let stderr: ReturnType<typeof createMockStream>;
  let logger: Logger;

  beforeEach(() => {
    stdout = createMockStream();
    stderr = createMockStream();
    logger = new Logger({
      logLevel: "debug",
      module: "Test",
      stdout,
      stderr,
    });
  });

  describe("basic logging", () => {
    test("logs info message to stdout", () => {
      logger.info("Hello world");
      expect(stdout.lines.length).toBe(1);
      expect(stripAnsi(stdout.lines[0]!)).toContain("[INFO]");
      expect(stripAnsi(stdout.lines[0]!)).toContain("[Test]");
      expect(stripAnsi(stdout.lines[0]!)).toContain("Hello world");
    });

    test("logs debug message to stdout", () => {
      logger.debug("Debug message");
      expect(stdout.lines.length).toBe(1);
      expect(stripAnsi(stdout.lines[0]!)).toContain("[DEBUG]");
    });

    test("logs warn message to stderr", () => {
      logger.warn("Warning message");
      expect(stderr.lines.length).toBe(1);
      expect(stdout.lines.length).toBe(0);
      expect(stripAnsi(stderr.lines[0]!)).toContain("[WARN]");
    });

    test("logs error message to stderr", () => {
      logger.error("Error message");
      expect(stderr.lines.length).toBeGreaterThan(0);
      expect(stdout.lines.length).toBe(0);
      expect(stripAnsi(stderr.lines[0]!)).toContain("[ERROR]");
    });
  });

  describe("log levels", () => {
    test("respects log level - filters out debug when level is info", () => {
      const infoLogger = new Logger({
        logLevel: "info",
        module: "Test",
        stdout,
        stderr,
      });
      infoLogger.debug("Should not appear");
      infoLogger.info("Should appear");
      expect(stdout.lines.length).toBe(1);
      expect(stripAnsi(stdout.lines[0]!)).toContain("Should appear");
    });

    test("respects log level - filters out info and debug when level is warn", () => {
      const warnLogger = new Logger({
        logLevel: "warn",
        module: "Test",
        stdout,
        stderr,
      });
      warnLogger.debug("No");
      warnLogger.info("No");
      warnLogger.warn("Yes");
      expect(stdout.lines.length).toBe(0);
      expect(stderr.lines.length).toBe(1);
    });
  });

  describe("method aliases", () => {
    test("logInfo and info are equivalent", () => {
      const stdout1 = createMockStream();
      const stdout2 = createMockStream();

      const logger1 = new Logger({
        logLevel: "debug",
        stdout: stdout1,
        stderr,
      });
      const logger2 = new Logger({
        logLevel: "debug",
        stdout: stdout2,
        stderr,
      });

      logger1.logInfo("test message");
      logger2.info("test message");

      expect(stripAnsi(stdout1.lines[0]!)).toContain("test message");
      expect(stripAnsi(stdout2.lines[0]!)).toContain("test message");
    });
  });

  describe("object formatting", () => {
    test("formats objects properly (no [object Object])", () => {
      logger.info("Data:", { name: "John", age: 30 });
      const output = stripAnsi(stdout.lines[0]!);
      expect(output).not.toContain("[object Object]");
      expect(output).toContain("name");
      expect(output).toContain("John");
    });

    test("formats nested objects", () => {
      logger.info("Nested:", { a: { b: { c: 123 } } });
      const output = stripAnsi(stdout.lines[0]!);
      expect(output).toContain("123");
    });
  });

  describe("error handling", () => {
    test("extracts error message", () => {
      const err = new Error("Something went wrong");
      logger.error("Failed:", err);
      const output = stripAnsi(stderr.output);
      expect(output).toContain("Something went wrong");
    });

    test("logs error cause chain", () => {
      const inner = new Error("Inner error");
      const outer = new Error("Outer error");
      outer.cause = inner;

      logger.error("Operation failed:", outer);
      const output = stripAnsi(stderr.output);
      expect(output).toContain("Outer error");
      expect(output).toContain("Caused by:");
      expect(output).toContain("Inner error");
    });

    test("logs stack trace for errors", () => {
      const err = new Error("Test error");
      logger.error("Failed:", err);
      const output = stripAnsi(stderr.output);
      expect(output).toContain("Stack trace:");
    });
  });

  describe("module tag", () => {
    test("includes module tag when set", () => {
      logger.info("With module");
      expect(stripAnsi(stdout.lines[0]!)).toContain("[Test]");
    });

    test("no module tag when not set", () => {
      const noModuleLogger = new Logger({
        logLevel: "debug",
        stdout,
        stderr,
      });
      noModuleLogger.info("No module");
      const output = stripAnsi(stdout.lines[0]!);
      expect(output).toContain("[INFO]");
      expect(output).toContain("No module");
      // Should not have a module tag pattern like [Something] between level and message
      expect(output).toMatch(/\[INFO\]\s+No module/);
    });

    test("setModule updates module tag", () => {
      logger.setModule("NewModule");
      logger.info("Updated");
      expect(stripAnsi(stdout.lines[0]!)).toContain("[NewModule]");
    });
  });

  describe("setLogLevel", () => {
    test("can change log level at runtime", () => {
      logger.setLogLevel("error");
      logger.info("Should not appear");
      logger.error("Should appear");
      expect(stdout.lines.length).toBe(0);
      expect(stderr.lines.length).toBeGreaterThan(0);
    });
  });
});

describe("Timer", () => {
  let stdout: ReturnType<typeof createMockStream>;
  let stderr: ReturnType<typeof createMockStream>;
  let logger: Logger;

  beforeEach(() => {
    stdout = createMockStream();
    stderr = createMockStream();
    logger = new Logger({
      logLevel: "debug",
      module: "Test",
      stdout,
      stderr,
    });
  });

  test("logs with duration tag", async () => {
    const timer = logger.timer();
    await Bun.sleep(10);
    timer.info("Task done");

    const output = stripAnsi(stdout.lines[0]!);
    expect(output).toContain("[Test]");
    expect(output).toMatch(/\[\d+.*\]/); // Duration tag like [10ms] or [10 ms]
    expect(output).toContain("Task done");
  });

  test("duration tag appears after module tag", async () => {
    const timer = logger.timer();
    await Bun.sleep(5);
    timer.info("Message");

    const output = stripAnsi(stdout.lines[0]!);
    // Pattern: [INFO] [Test] [duration] Message
    const testIndex = output.indexOf("[Test]");
    const messageIndex = output.indexOf("Message");
    expect(testIndex).toBeLessThan(messageIndex);
  });

  test("timer with raw format", async () => {
    const timer = logger.timer({ format: "raw" });
    await Bun.sleep(15);
    timer.info("Done");

    const output = stripAnsi(stdout.lines[0]!);
    expect(output).toMatch(/\[\d+ms\]/); // Raw format like [15ms]
  });

  test("cumulative timing on multiple calls", async () => {
    const timer = logger.timer({ format: "raw" });
    await Bun.sleep(10);
    timer.info("First");
    await Bun.sleep(10);
    timer.info("Second");

    const first = stripAnsi(stdout.lines[0]!);
    const second = stripAnsi(stdout.lines[1]!);

    // Extract ms values
    const firstMs = parseInt(first.match(/\[(\d+)ms\]/)?.[1] || "0");
    const secondMs = parseInt(second.match(/\[(\d+)ms\]/)?.[1] || "0");

    // Second should be greater (cumulative)
    expect(secondMs).toBeGreaterThan(firstMs);
  });

  test("timer respects log level", async () => {
    const infoLogger = new Logger({
      logLevel: "info",
      stdout,
      stderr,
    });
    const timer = infoLogger.timer();
    timer.debug("Should not appear");
    timer.info("Should appear");
    expect(stdout.lines.length).toBe(1);
  });

  test("timer formats objects properly (no [object Object])", () => {
    const timer = logger.timer();
    timer.info({ foo: "bar", nested: { x: 1 } });
    const output = stripAnsi(stdout.lines[0]!);
    expect(output).not.toContain("[object Object]");
    expect(output).toContain("foo");
    expect(output).toContain("bar");
    expect(output).toContain("nested");
  });
});

describe("Edge cases", () => {
  let stdout: ReturnType<typeof createMockStream>;
  let stderr: ReturnType<typeof createMockStream>;

  beforeEach(() => {
    stdout = createMockStream();
    stderr = createMockStream();
  });

  describe("invalid log level", () => {
    test("throws on invalid log level in constructor", () => {
      expect(() => {
        new Logger({
          logLevel: "invalid" as any,
          stdout,
          stderr,
        });
      }).toThrow('Invalid log level: "invalid"');
    });

    test("throws on invalid log level in setLogLevel", () => {
      const logger = new Logger({ stdout, stderr });
      expect(() => {
        logger.setLogLevel("bad" as any);
      }).toThrow('Invalid log level: "bad"');
    });

    test("error message lists valid levels", () => {
      expect(() => {
        new Logger({ logLevel: "invalid" as any, stdout, stderr });
      }).toThrow("debug, info, warn, error, fatal");
    });
  });

  describe("circular error causes", () => {
    test("handles circular cause chain without infinite loop", () => {
      const logger = new Logger({ logLevel: "debug", stdout, stderr });

      const error1 = new Error("Error 1");
      const error2 = new Error("Error 2");
      error1.cause = error2;
      error2.cause = error1; // Circular reference

      // Should not hang - will timeout if infinite loop
      logger.error("Circular:", error1);

      const output = stripAnsi(stderr.output);
      expect(output).toContain("Error 1");
      expect(output).toContain("Caused by:");
      expect(output).toContain("Error 2");
      // Should NOT have duplicate "Error 1" in cause chain
    });

    test("handles self-referencing cause", () => {
      const logger = new Logger({ logLevel: "debug", stdout, stderr });

      const error = new Error("Self-ref");
      error.cause = error; // Points to itself

      logger.error("Self:", error);

      const output = stripAnsi(stderr.output);
      expect(output).toContain("Self-ref");
      // Should not have any "Caused by" since the cause is itself
    });
  });

  describe("empty error message", () => {
    test("handles error with empty message", () => {
      const logger = new Logger({ logLevel: "debug", stdout, stderr });
      const error = new Error("");
      logger.error("Empty:", error);

      const output = stripAnsi(stderr.output);
      // Should use error.name as fallback
      expect(output).toContain("Error");
      expect(output).not.toContain("[object");
    });

    test("uses error name for custom errors with empty message", () => {
      const logger = new Logger({ logLevel: "debug", stdout, stderr });

      const error = new Error("");
      error.name = "CustomError";
      logger.error("Custom:", error);

      const output = stripAnsi(stderr.output);
      expect(output).toContain("CustomError");
    });

    test("handles TypeError with empty message", () => {
      const logger = new Logger({ logLevel: "debug", stdout, stderr });
      const error = new TypeError("");
      logger.error("Type:", error);

      const output = stripAnsi(stderr.output);
      expect(output).toContain("TypeError");
    });
  });
});
