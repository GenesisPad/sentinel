import sharp from "sharp";

export type TelegramChartRange = "24h" | "7d" | "30d" | "all";
export type TelegramChartKind = "activity" | "scans" | "users";

export interface TelegramAnalyticsEvent {
  at: Date;
}

export interface TelegramAnalytics {
  generatedAt: Date;
  users: number;
  chats: number;
  trackedContracts: number;
  totalScans: number;
  completedScans: number;
  failedScans: number;
  webScans: number;
  telegramScans: number;
  apiScans: number;
  unknownScans: number;
  webActivities: number;
  telegramActivities: number;
  activities: TelegramAnalyticsEvent[];
  webActivityEvents: TelegramAnalyticsEvent[];
  scans: TelegramAnalyticsEvent[];
  webScanEvents: TelegramAnalyticsEvent[];
  telegramScanEvents: TelegramAnalyticsEvent[];
  apiScanEvents: TelegramAnalyticsEvent[];
  unknownScanEvents: TelegramAnalyticsEvent[];
  registrations: TelegramAnalyticsEvent[];
}

export function telegramRangeStart(
  range: TelegramChartRange,
  now: Date,
  allEvents: TelegramAnalyticsEvent[]
): Date {
  if (range === "24h") return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (range === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (range === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const earliest = allEvents.reduce(
    (minimum, event) => (event.at < minimum ? event.at : minimum),
    now
  );
  return earliest;
}

export function buildTelegramSeries(
  events: TelegramAnalyticsEvent[],
  range: TelegramChartRange,
  now = new Date(),
  cumulative = false
): { labels: string[]; values: number[] } {
  const start = telegramRangeStart(range, now, events);
  const hourly = range === "24h";
  const duration = Math.max(1, now.getTime() - start.getTime());
  const desiredBuckets = hourly ? 24 : range === "7d" ? 7 : range === "30d" ? 30 : 14;
  const bucketMs = hourly
    ? 60 * 60 * 1000
    : Math.max(24 * 60 * 60 * 1000, Math.ceil(duration / desiredBuckets));
  const bucketCount = Math.max(1, Math.min(desiredBuckets, Math.ceil(duration / bucketMs)));
  const values = Array.from({ length: bucketCount }, () => 0);

  for (const event of events) {
    if (event.at < start || event.at > now) continue;
    const index = Math.min(
      bucketCount - 1,
      Math.floor((event.at.getTime() - start.getTime()) / bucketMs)
    );
    values[index] = (values[index] ?? 0) + 1;
  }

  if (cumulative) {
    const prior = events.filter((event) => event.at < start).length;
    let running = prior;
    values.forEach((value, index) => {
      running += value;
      values[index] = running;
    });
  }

  const labels = values.map((_value, index) => {
    const date = new Date(start.getTime() + index * bucketMs);
    return hourly
      ? date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
      : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  });
  return { labels, values };
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function renderTelegramChart(input: {
  title: string;
  subtitle: string;
  labels: string[];
  values: number[];
  line?: boolean;
  datasets?: Array<{ label: string; values: number[] }>;
}): Promise<Buffer> {
  const width = 1280;
  const height = 720;
  const left = 100;
  const right = 70;
  const top = 170;
  const bottom = 110;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maximum = Math.max(
    1,
    ...input.values,
    ...(input.datasets?.flatMap((dataset) => dataset.values) ?? [])
  );
  const step = input.values.length > 1 ? plotWidth / (input.values.length - 1) : plotWidth;
  const points = input.values.map((value, index) => {
    const x = left + (input.values.length === 1 ? plotWidth / 2 : index * step);
    const y = top + plotHeight - (value / maximum) * plotHeight;
    return { x, y, value, label: input.labels[index] ?? "" };
  });
  const grid = Array.from({ length: 5 }, (_, index) => {
    const y = top + (plotHeight / 4) * index;
    const value = Math.round(maximum * (1 - index / 4));
    return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="grid"/><text x="${left - 22}" y="${y + 6}" text-anchor="end" class="axis">${value}</text>`;
  }).join("");
  const shownEvery = Math.max(1, Math.ceil(points.length / 7));
  const labels = points
    .filter((_point, index) => index % shownEvery === 0 || index === points.length - 1)
    .map(
      (point) =>
        `<text x="${point.x}" y="${height - 55}" text-anchor="middle" class="axis">${xml(point.label)}</text>`
    )
    .join("");
  const palette = ["#7fa4ff", "#55d6be", "#f2b84b", "#9aa6b8"];
  const marks = input.datasets
    ? input.datasets
        .flatMap((dataset, datasetIndex) =>
          dataset.values.map((value, index) => {
            const groupWidth = plotWidth / Math.max(1, input.values.length);
            const barWidth = Math.max(5, Math.min(28, (groupWidth - 10) / input.datasets!.length));
            const groupStart = left + index * groupWidth;
            const x =
              groupStart +
              (groupWidth - barWidth * input.datasets!.length) / 2 +
              datasetIndex * barWidth;
            const barHeight = Math.max(3, (value / maximum) * plotHeight);
            return `<rect x="${x}" y="${top + plotHeight - barHeight}" width="${barWidth - 2}" height="${barHeight}" rx="5" fill="${palette[datasetIndex] ?? "#7fa4ff"}"/>`;
          })
        )
        .join("")
    : input.line
      ? `<polyline points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="none" stroke="#7fa4ff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="6" fill="#0c121c" stroke="#a9bdff" stroke-width="4"/>`).join("")}`
      : points
          .map((point, index) => {
            const barWidth = Math.max(
              10,
              Math.min(70, plotWidth / Math.max(1, points.length) - 12)
            );
            const x = left + (index + 0.5) * (plotWidth / points.length) - barWidth / 2;
            const barHeight = Math.max(3, plotHeight - (point.y - top));
            return `<rect x="${x}" y="${top + plotHeight - barHeight}" width="${barWidth}" height="${barHeight}" rx="8" fill="#7fa4ff"/><text x="${x + barWidth / 2}" y="${top + plotHeight - barHeight - 12}" text-anchor="middle" class="value">${point.value}</text>`;
          })
          .join("");

  const legend = (input.datasets ?? [])
    .map(
      (dataset, index) =>
        `<circle cx="${left + index * 180}" cy="145" r="6" fill="${palette[index] ?? "#7fa4ff"}"/><text x="${left + 14 + index * 180}" y="151" class="legend">${xml(dataset.label)}</text>`
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" rx="28" fill="#0c121c"/>
  <circle cx="74" cy="72" r="9" fill="#7fa4ff"/>
  <text x="102" y="84" class="title">${xml(input.title)}</text>
  <text x="74" y="124" class="subtitle">${xml(input.subtitle.toUpperCase())}</text>
  ${legend}${grid}${marks}${labels}
  <text x="${width - 70}" y="84" text-anchor="end" class="brand">GENESIS SENTINEL</text>
  <style>
  .title{font:700 34px Arial,sans-serif;fill:#eef3ff}.subtitle{font:600 15px Arial,sans-serif;letter-spacing:2px;fill:#8d9bb1}
  .brand{font:700 14px Arial,sans-serif;letter-spacing:2px;fill:#69778e}.grid{stroke:#202c3d;stroke-width:1}
  .axis{font:500 15px Arial,sans-serif;fill:#8492a8}.value{font:700 15px Arial,sans-serif;fill:#d8e2ff}.legend{font:600 15px Arial,sans-serif;fill:#b8c4d8}
  </style></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
