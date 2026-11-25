import { describe, expect, it } from "vitest";
import { formatBytes, formatBytesWithExact } from "./format";

describe("formatBytes", () => {
  it("handles zero, negative, and non-finite inputs safely", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-42)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });

  it("formats bytes across binary units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });
});

describe("formatBytesWithExact", () => {
  it("returns 0 B for non-positive values and includes exact bytes otherwise", () => {
    expect(formatBytesWithExact(0)).toBe("0 B");
    expect(formatBytesWithExact(2048)).toContain("2.0 KB");
    expect(formatBytesWithExact(2048)).toContain("B)");
  });
});
