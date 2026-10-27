-- CreateEnum
CREATE TYPE "JurisdictionRole" AS ENUM ('REVIEW_OFFICER', 'APPROVING_AUTHORITY');

-- CreateEnum
CREATE TYPE "InstrumentType" AS ENUM ('SECURITY_DEPOSIT', 'BANK_GUARANTEE');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('OPEN', 'RESPONDED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "TaskType" ADD VALUE 'REPLACEMENT_ACCEPTANCE';

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SYSTEM_ADMIN';

-- DropIndex
DROP INDEX "OfficerJurisdiction_officerId_institutionId_key";

-- AlterTable
ALTER TABLE "Fdr" ADD COLUMN     "beneficiaryName" TEXT,
ADD COLUMN     "ifsc" TEXT,
ADD COLUMN     "instrumentType" "InstrumentType" NOT NULL DEFAULT 'SECURITY_DEPOSIT';

-- AlterTable
ALTER TABLE "FdrVersion" ADD COLUMN     "beneficiaryName" TEXT,
ADD COLUMN     "ifsc" TEXT,
ADD COLUMN     "instrumentType" "InstrumentType" NOT NULL DEFAULT 'SECURITY_DEPOSIT';

-- AlterTable
ALTER TABLE "Institution" ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "contactDesignation" TEXT,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "officialCode" TEXT,
ADD COLUMN     "postalCode" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "linkPath" TEXT;

-- AlterTable
ALTER TABLE "OfficerJurisdiction" ADD COLUMN     "role" "JurisdictionRole" NOT NULL DEFAULT 'REVIEW_OFFICER';

-- AlterTable
ALTER TABLE "ReleaseRequest" ADD COLUMN     "completedAmountMinor" BIGINT,
ADD COLUMN     "completionEvidenceDate" DATE,
ADD COLUMN     "completionEvidenceRef" TEXT,
ADD COLUMN     "completionEvidenceType" TEXT,
ADD COLUMN     "decisionStage" TEXT,
ADD COLUMN     "evidenceRef" TEXT,
ADD COLUMN     "evidenceType" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "designation" TEXT,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "VerificationCheck" ADD COLUMN     "dependentFields" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CorrectionRequest" (
    "id" SERIAL NOT NULL,
    "fdrId" INTEGER NOT NULL,
    "fdrVersionNo" INTEGER NOT NULL,
    "fields" JSONB NOT NULL,
    "note" TEXT,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'OPEN',
    "requestedById" INTEGER NOT NULL,
    "respondedById" INTEGER,
    "respondedVersionNo" INTEGER,
    "respondNote" TEXT,
    "respondedAt" TIMESTAMP(3),
    "cancelledById" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CorrectionRequest_fdrId_status_idx" ON "CorrectionRequest"("fdrId", "status");

-- CreateIndex
CREATE INDEX "CorrectionRequest_requestedById_idx" ON "CorrectionRequest"("requestedById");

-- CreateIndex
CREATE UNIQUE INDEX "Institution_officialCode_key" ON "Institution"("officialCode");

-- CreateIndex
CREATE UNIQUE INDEX "OfficerJurisdiction_officerId_institutionId_role_key" ON "OfficerJurisdiction"("officerId", "institutionId", "role");

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_fdrId_fkey" FOREIGN KEY ("fdrId") REFERENCES "Fdr"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_fdrId_fdrVersionNo_fkey" FOREIGN KEY ("fdrId", "fdrVersionNo") REFERENCES "FdrVersion"("fdrId", "versionNo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

