import { describe, expect, it } from "vitest";
import { buildTelegramSeries, renderTelegramChart } from "./telegram-charts.js";

describe("Telegram admin charts", () => {
  it("uses real UTC date labels and counts events by day", () => {
    const now = new Date("2026-07-23T12:00:00.000Z");
    const series = buildTelegramSeries(
      [
        { at: new Date("2026-07-22T10:00:00.000Z") },
        { at: new Date("2026-07-23T10:00:00.000Z") }
      ],
      "7d",
      now
    );
    expect(series.labels.some((label) => label.includes("Jul"))).toBe(true);
    expect(series.values.reduce((sum, value) => sum + value, 0)).toBe(2);
  });

  it("renders a Telegram-compatible PNG", async () => {
    const image = await renderTelegramChart({
      title: "Sentinel scans",
      subtitle: "Last 7d · UTC",
      labels: ["17 Jul", "18 Jul", "19 Jul"],
      values: [1, 4, 2]
    });
    expect(image.subarray(1, 4).toString()).toBe("PNG");
  });
});
