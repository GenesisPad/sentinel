import { createHash } from "node:crypto";
import type { ScanRepository } from "@genesis-sentinel/database";
import type { ScanRequestSource } from "@genesis-sentinel/database";
import type { ScanQueue } from "@genesis-sentinel/queue";
import { createScanId, normalizeEvmAddress, type ScanProgress } from "@genesis-sentinel/shared";

export interface SubmitScanInput {
  chainId: 4663;
  address: `0x${string}`;
  idempotencyKey: string;
  requestedBy?: string;
  source?: ScanRequestSource;
}

export interface SubmitScanResult {
  scan: ScanProgress;
  created: boolean;
}

export async function submitScanRequest(
  input: SubmitScanInput,
  dependencies: {
    scans: ScanRepository;
    queue: ScanQueue;
  }
): Promise<SubmitScanResult> {
  const normalizedAddress = normalizeEvmAddress(input.address);
  const idempotencyKeyHash = hashIdempotencyKey(input.idempotencyKey);
  const scanId = createScanId(input.chainId, normalizedAddress, idempotencyKeyHash);
  const createInput = {
    id: scanId,
    chainId: input.chainId,
    address: normalizedAddress,
    idempotencyKeyHash
  };

  if (input.requestedBy) {
    Object.assign(createInput, { requestedBy: input.requestedBy });
  }

  const repositoryResult = await dependencies.scans.createOrGetQueuedScan(createInput);
  await dependencies.scans
    .recordScanRequest?.(repositoryResult.scan.scanId, input.source ?? "API")
    .catch(() => undefined);

  if (repositoryResult.created) {
    await dependencies.queue.enqueueScan({
      scanId,
      chainId: input.chainId,
      address: normalizedAddress
    });
  }

  return repositoryResult;
}

function hashIdempotencyKey(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey).digest("hex");
}
