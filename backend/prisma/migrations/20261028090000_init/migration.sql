-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('COLLEGE_USER', 'REVIEW_OFFICER', 'APPROVING_AUTHORITY');

-- CreateEnum
CREATE TYPE "InstitutionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('draft', 'submitted', 'under_review', 'discrepancy', 'verified');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('none', 'requested', 'recommended', 'approved', 'rejected', 'completed');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('VERIFICATION_REVIEW', 'DOCUMENT_CORRECTION', 'RENEWAL_AFTER_MATURITY', 'RELEASE_RECOMMENDED', 'RELEASE_DECISION', 'GENERIC_REVIEW');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VerificationSource" AS ENUM ('SIMULATED_BANK_CHECK', 'MANUAL_OFFICER_REVIEW', 'DOCUMENT_FINGERPRINT');

-- CreateEnum
CREATE TYPE "VerificationOutcome" AS ENUM ('MATCH', 'MISMATCH', 'SOURCE_UNAVAILABLE', 'MANUAL_REQUIRED', 'NOT_YET_CHECKED');

-- CreateEnum
CREATE TYPE "ReleaseRequestStatus" AS ENUM ('OPEN', 'DECIDED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('OK', 'FAILED');

-- CreateTable
CREATE TABLE "Institution" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT true,
    "status" "InstitutionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "institutionId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invalidatedAt" TIMESTAMP(3),
    "createdIp" TEXT,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficerJurisdiction" (
    "id" SERIAL NOT NULL,
    "officerId" INTEGER NOT NULL,
    "institutionId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficerJurisdiction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fdr" (
    "id" SERIAL NOT NULL,
    "publicCode" TEXT NOT NULL,
    "institutionId" INTEGER NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankBranch" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "issueDate" DATE NOT NULL,
    "maturityDate" DATE NOT NULL,
    "remarks" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'draft',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "previousFdrId" INTEGER,
    "supersededByFdrId" INTEGER,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "Fdr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FdrVersion" (
    "id" SERIAL NOT NULL,
    "fdrId" INTEGER NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankBranch" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "maturityDate" DATE NOT NULL,
    "remarks" TEXT,
    "submittedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FdrVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" SERIAL NOT NULL,
    "fdrId" INTEGER NOT NULL,
    "fdrVersionNo" INTEGER,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "uploadedById" INTEGER,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededById" INTEGER,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationCheck" (
    "id" SERIAL NOT NULL,
    "fdrId" INTEGER NOT NULL,
    "fdrVersionNo" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "submittedValue" TEXT,
    "observedValue" TEXT,
    "source" "VerificationSource" NOT NULL,
    "outcome" "VerificationOutcome" NOT NULL,
    "reason" TEXT,
    "checkedById" INTEGER,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidatedAt" TIMESTAMP(3),
    "invalidatedVersionNo" INTEGER,
    "invalidatedReason" TEXT,

    CONSTRAINT "VerificationCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" SERIAL NOT NULL,
    "fdrId" INTEGER,
    "type" "TaskType" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeInstitutionId" INTEGER,
    "assigneeUserId" INTEGER,
    "dueDate" DATE NOT NULL,
    "deduplicationKey" TEXT,
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "lastEscalationStage" TEXT,
    "createdByJob" BOOLEAN NOT NULL DEFAULT false,
    "policyVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedNote" TEXT,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "institutionId" INTEGER,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseRequest" (
    "id" SERIAL NOT NULL,
    "fdrId" INTEGER NOT NULL,
    "requestedByUserId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReleaseRequestStatus" NOT NULL DEFAULT 'OPEN',
    "decision" "ReleaseStatus" DEFAULT 'none',
    "decidedById" INTEGER,
    "decisionNote" TEXT,
    "recommendedById" INTEGER,
    "recommendationNote" TEXT,
    "policyVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "completedById" INTEGER,
    "completedAt" TIMESTAMP(3),
    "completionNote" TEXT,

    CONSTRAINT "ReleaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "actorUserId" INTEGER,
    "institutionId" INTEGER,
    "fdrId" INTEGER,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "detail" JSONB,
    "requestIp" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "config" JSONB NOT NULL,
    "notes" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" SERIAL NOT NULL,
    "jobName" TEXT NOT NULL,
    "status" "JobRunStatus" NOT NULL DEFAULT 'OK',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "processed" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Institution_code_key" ON "Institution"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfficerJurisdiction_officerId_institutionId_key" ON "OfficerJurisdiction"("officerId", "institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "Fdr_publicCode_key" ON "Fdr"("publicCode");

-- CreateIndex
CREATE INDEX "Fdr_institutionId_status_idx" ON "Fdr"("institutionId", "status");

-- CreateIndex
CREATE INDEX "Fdr_maturityDate_idx" ON "Fdr"("maturityDate");

-- CreateIndex
CREATE INDEX "Fdr_previousFdrId_idx" ON "Fdr"("previousFdrId");

-- CreateIndex
CREATE INDEX "Fdr_supersededByFdrId_idx" ON "Fdr"("supersededByFdrId");

-- CreateIndex
CREATE UNIQUE INDEX "FdrVersion_fdrId_versionNo_key" ON "FdrVersion"("fdrId", "versionNo");

-- CreateIndex
CREATE INDEX "Document_fdrId_idx" ON "Document"("fdrId");

-- CreateIndex
CREATE INDEX "VerificationCheck_fdrId_fdrVersionNo_idx" ON "VerificationCheck"("fdrId", "fdrVersionNo");

-- CreateIndex
CREATE UNIQUE INDEX "Task_deduplicationKey_key" ON "Task"("deduplicationKey");

-- CreateIndex
CREATE INDEX "Task_assigneeInstitutionId_status_idx" ON "Task"("assigneeInstitutionId", "status");

-- CreateIndex
CREATE INDEX "Task_assigneeUserId_status_idx" ON "Task"("assigneeUserId", "status");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "ReleaseRequest_fdrId_status_idx" ON "ReleaseRequest"("fdrId", "status");

-- CreateIndex
CREATE INDEX "ReleaseRequest_requestedByUserId_idx" ON "ReleaseRequest"("requestedByUserId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_createdAt_idx" ON "AuditEvent"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_fdrId_createdAt_idx" ON "AuditEvent"("fdrId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_key_versionLabel_key" ON "PolicyVersion"("key", "versionLabel");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_userId_scope_key_key" ON "IdempotencyKey"("userId", "scope", "key");

-- CreateIndex
CREATE INDEX "JobRun_jobName_startedAt_idx" ON "JobRun"("jobName", "startedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficerJurisdiction" ADD CONSTRAINT "OfficerJurisdiction_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficerJurisdiction" ADD CONSTRAINT "OfficerJurisdiction_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fdr" ADD CONSTRAINT "Fdr_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fdr" ADD CONSTRAINT "Fdr_previousFdrId_fkey" FOREIGN KEY ("previousFdrId") REFERENCES "Fdr"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fdr" ADD CONSTRAINT "Fdr_supersededByFdrId_fkey" FOREIGN KEY ("supersededByFdrId") REFERENCES "Fdr"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FdrVersion" ADD CONSTRAINT "FdrVersion_fdrId_fkey" FOREIGN KEY ("fdrId") REFERENCES "Fdr"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FdrVersion" ADD CONSTRAINT "FdrVersion_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_fdrId_fkey" FOREIGN KEY ("fdrId") REFERENCES "Fdr"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCheck" ADD CONSTRAINT "VerificationCheck_fdrId_fkey" FOREIGN KEY ("fdrId") REFERENCES "Fdr"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCheck" ADD CONSTRAINT "VerificationCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCheck" ADD CONSTRAINT "VerificationCheck_fdrId_fdrVersionNo_fkey" FOREIGN KEY ("fdrId", "fdrVersionNo") REFERENCES "FdrVersion"("fdrId", "versionNo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_fdrId_fkey" FOREIGN KEY ("fdrId") REFERENCES "Fdr"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeInstitutionId_fkey" FOREIGN KEY ("assigneeInstitutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseRequest" ADD CONSTRAINT "ReleaseRequest_fdrId_fkey" FOREIGN KEY ("fdrId") REFERENCES "Fdr"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseRequest" ADD CONSTRAINT "ReleaseRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseRequest" ADD CONSTRAINT "ReleaseRequest_recommendedById_fkey" FOREIGN KEY ("recommendedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseRequest" ADD CONSTRAINT "ReleaseRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseRequest" ADD CONSTRAINT "ReleaseRequest_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_fdrId_fkey" FOREIGN KEY ("fdrId") REFERENCES "Fdr"("id") ON DELETE SET NULL ON UPDATE CASCADE;

