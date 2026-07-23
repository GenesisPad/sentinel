ALTER TYPE "ScanRequestSource" ADD VALUE IF NOT EXISTS 'UNKNOWN';

UPDATE "ScanRequest"
SET "source" = 'UNKNOWN'
WHERE "id" LIKE 'backfill-%'
  AND "source" = 'API';
