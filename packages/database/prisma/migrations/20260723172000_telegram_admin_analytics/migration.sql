CREATE TABLE "TelegramActivity" (
    "id" TEXT NOT NULL,
    "telegramUserId" BIGINT,
    "telegramChatId" BIGINT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TelegramActivity_createdAt_idx"
ON "TelegramActivity"("createdAt");

CREATE INDEX "TelegramActivity_telegramUserId_createdAt_idx"
ON "TelegramActivity"("telegramUserId", "createdAt");

CREATE INDEX "TelegramActivity_telegramChatId_createdAt_idx"
ON "TelegramActivity"("telegramChatId", "createdAt");
