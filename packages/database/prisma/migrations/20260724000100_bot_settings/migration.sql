CREATE TABLE "BotSetting" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BotSetting_pkey" PRIMARY KEY ("key")
);
