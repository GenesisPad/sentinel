CREATE TYPE "ScanRequestSource" AS ENUM ('WEB', 'TELEGRAM', 'API');

CREATE TABLE "ScanRequest" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "source" "ScanRequestSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScanRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebActivity" (
    "id" TEXT NOT NULL,
    "visitorHash" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScanRequest_source_createdAt_idx" ON "ScanRequest"("source", "createdAt");
CREATE INDEX "ScanRequest_scanId_createdAt_idx" ON "ScanRequest"("scanId", "createdAt");
CREATE INDEX "WebActivity_createdAt_idx" ON "WebActivity"("createdAt");
CREATE INDEX "WebActivity_action_createdAt_idx" ON "WebActivity"("action", "createdAt");

ALTER TABLE "ScanRequest"
ADD CONSTRAINT "ScanRequest_scanId_fkey"
FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed one attributable request for existing scans. Historical Telegram scans are identifiable
-- from requestedBy; older anonymous web and direct-API scans cannot be separated reliably, so
-- they remain conservatively classified as API instead of inventing web traffic.
INSERT INTO "ScanRequest" ("id", "scanId", "source", "createdAt")
SELECT
    'backfill-' || id,
    id,
    CASE
        WHEN "requestedBy" LIKE 'telegram:%' THEN 'TELEGRAM'::"ScanRequestSource"
        ELSE 'API'::"ScanRequestSource"
    END,
    "queuedAt"
FROM "Scan";
