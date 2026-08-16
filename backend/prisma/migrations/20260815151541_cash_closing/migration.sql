-- CreateTable
CREATE TABLE "cash_closings" (
    "id" TEXT NOT NULL,
    "businessDate" VARCHAR(10) NOT NULL,
    "closedByUserId" TEXT NOT NULL,
    "closedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedCents" INTEGER NOT NULL,
    "expectedBs" DECIMAL(18,2) NOT NULL,
    "paymentCount" INTEGER NOT NULL,
    "expectedCashBs" DECIMAL(18,2) NOT NULL,
    "countedCashBs" DECIMAL(18,2) NOT NULL,
    "differenceBs" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "cash_closings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_closings_closedAt_idx" ON "cash_closings"("closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "cash_closings_businessDate_key" ON "cash_closings"("businessDate");

-- AddForeignKey
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
