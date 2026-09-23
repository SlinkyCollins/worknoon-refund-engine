/*
  Warnings:

  - You are about to drop the column `confidenceScore` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `promptTokensUsed` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `rawPayload` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `riskLevel` on the `Customer` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "confidenceScore",
DROP COLUMN "promptTokensUsed",
DROP COLUMN "rawPayload";

-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "riskLevel";

-- DropEnum
DROP TYPE "RiskLevel";
