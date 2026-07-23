import { describe, expect, it, vi } from "vitest";
import type { ScanRepository } from "@genesis-sentinel/database";
import type { ScanQueue } from "@genesis-sentinel/queue";
import { submitScanRequest } from "./scan-service.js";

describe("submitScanRequest source attribution", () => {
  it("records every request source even when the scan job is reused", async () => {
    const recordScanRequest = vi.fn(() => Promise.resolve());
    const scans = {
      createOrGetQueuedScan: vi.fn(() =>
        Promise.resolve({
          created: false,
          scan: {
            scanId: "scan-1",
            chainId: 4663,
            address: "0x0000000000000000000000000000000000000001",
            state: "COMPLETED",
            scannerVersion: "test",
            submittedAt: new Date().toISOString(),
            message: "Complete"
          }
        })
      ),
      recordScanRequest
    } as unknown as ScanRepository;
    const enqueueScan = vi.fn();
    const queue = { enqueueScan, close: vi.fn() } as unknown as ScanQueue;

    await submitScanRequest(
      {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000001",
        idempotencyKey: "web-scan",
        source: "WEB"
      },
      { scans, queue }
    );

    expect(recordScanRequest).toHaveBeenCalledWith("scan-1", "WEB");
    expect(enqueueScan).not.toHaveBeenCalled();
  });
});
