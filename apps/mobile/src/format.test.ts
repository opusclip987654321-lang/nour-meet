import { describe, expect, it } from "vitest";
import { categoryColor, money, when, dayLabel, timeLabel, imgUrl } from "./format";

describe("money", () => {
  it("formats cents as euros with a comma decimal separator", () => {
    expect(money(3500)).toBe("35,00 €");
  });
  it("handles zero", () => {
    expect(money(0)).toBe("0,00 €");
  });
  it("rounds to two decimal places", () => {
    expect(money(1999)).toBe("19,99 €");
  });
});

describe("when / dayLabel / timeLabel", () => {
  const iso = "2026-10-01T19:00:00.000Z";
  it("when() includes weekday, day, month, hour and minute", () => {
    const result = when(iso);
    expect(result).toMatch(/\d{1,2}:\d{2}/);
    expect(result.length).toBeGreaterThan(5);
  });
  it("dayLabel() omits the time", () => {
    expect(dayLabel(iso)).not.toMatch(/\d{1,2}:\d{2}/);
  });
  it("timeLabel() is only the time", () => {
    expect(timeLabel(iso)).toMatch(/^\d{1,2}:\d{2}$/);
  });
});

describe("categoryColor", () => {
  it("returns a distinct color for Speed dating and Networking", () => {
    expect(categoryColor("Speed dating")).not.toBe(categoryColor("Networking"));
  });
  it("falls back to the gold default for an unknown category", () => {
    expect(categoryColor("Some future category nobody configured yet")).toBe("#cba969");
  });
});

describe("imgUrl", () => {
  it("prefixes a relative path with API_URL", () => {
    expect(imgUrl("/static/uploads/events/foo.jpg")).toBe("http://localhost:4000/static/uploads/events/foo.jpg");
  });
  it("leaves an absolute URL untouched", () => {
    expect(imgUrl("https://example.com/foo.jpg")).toBe("https://example.com/foo.jpg");
  });
});
