/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

const apiBaseUrl =
  process.env.SMOKE_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.WEB_PUBLIC_API_BASE_URL;
const webBaseUrl = process.env.SMOKE_WEB_BASE_URL;

if (!apiBaseUrl) {
  throw new Error("Set SMOKE_API_BASE_URL or NEXT_PUBLIC_API_BASE_URL before running smoke tests.");
}

const checks = [
  {
    name: "api health",
    url: new URL("/health", apiBaseUrl).toString(),
    expectedStatus: 200
  },
  {
    name: "api readiness",
    url: new URL("/ready", apiBaseUrl).toString(),
    expectedStatus: 200
  },
  {
    name: "api docs",
    url: new URL("/docs", apiBaseUrl).toString(),
    expectedStatus: 200
  }
];

if (webBaseUrl) {
  checks.push({
    name: "web home",
    url: new URL("/", webBaseUrl).toString(),
    expectedStatus: 200
  });
}

let failures = 0;

for (const check of checks) {
  const response = await fetch(check.url).catch((error) => error);

  if (response instanceof Error) {
    failures += 1;
    console.error(`[fail] ${check.name}: ${response.message}`);
    continue;
  }

  if (response.status !== check.expectedStatus) {
    failures += 1;
    console.error(`[fail] ${check.name}: expected ${check.expectedStatus}, got ${response.status}`);
    continue;
  }

  console.log(`[ok] ${check.name}`);
}

if (failures > 0) {
  process.exit(1);
}
