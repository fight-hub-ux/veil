-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PersonTier" AS ENUM ('MARQUEE', 'SELF_SERVE');

-- CreateEnum
CREATE TYPE "VerificationProvider" AS ENUM ('SUMSUB', 'REP_SIGNOFF');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "Modality" AS ENUM ('FACE', 'VOICE', 'VIDEO_PERFORMANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "LicenseeVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UseType" AS ENUM ('ADVERTISING', 'VOICE_SYNTHESIS', 'FILM_DOUBLE', 'POSTHUMOUS', 'OTHER');

-- CreateEnum
CREATE TYPE "Exclusivity" AS ENUM ('NON_EXCLUSIVE', 'EXCLUSIVE', 'SOLE');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'GBP', 'EUR');

-- CreateEnum
CREATE TYPE "GrantStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "LicenseInstanceStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "Representative" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "firm" TEXT NOT NULL,
    "authorityRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Representative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "tier" "PersonTier" NOT NULL,
    "representativeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityVerification" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "provider" "VerificationProvider" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "evidenceRef" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LikenessAsset" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "modality" "Modality" NOT NULL,
    "referenceHash" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LikenessAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Licensee" (
    "id" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT NOT NULL,
    "status" "LicenseeVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Licensee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grant" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "useTypes" "UseType"[],
    "territory" TEXT[],
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "priceMicros" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL,
    "exclusivity" "Exclusivity" NOT NULL DEFAULT 'NON_EXCLUSIVE',
    "licenseeId" TEXT,
    "hardExclusions" JSONB NOT NULL DEFAULT '{}',
    "status" "GrantStatus" NOT NULL DEFAULT 'DRAFT',
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrantAsset" (
    "grantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrantAsset_pkey" PRIMARY KEY ("grantId","assetId")
);

-- CreateTable
CREATE TABLE "LicenseInstance" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "licenseeId" TEXT NOT NULL,
    "status" "LicenseInstanceStatus" NOT NULL DEFAULT 'PENDING',
    "exercisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProvenanceRecord" (
    "id" TEXT NOT NULL,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "grantId" TEXT,
    "licenseInstanceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProvenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Person_representativeId_idx" ON "Person"("representativeId");

-- CreateIndex
CREATE INDEX "Person_tier_idx" ON "Person"("tier");

-- CreateIndex
CREATE INDEX "IdentityVerification_personId_idx" ON "IdentityVerification"("personId");

-- CreateIndex
CREATE INDEX "IdentityVerification_status_idx" ON "IdentityVerification"("status");

-- CreateIndex
CREATE INDEX "LikenessAsset_personId_idx" ON "LikenessAsset"("personId");

-- CreateIndex
CREATE INDEX "LikenessAsset_modality_idx" ON "LikenessAsset"("modality");

-- CreateIndex
CREATE INDEX "LikenessAsset_referenceHash_idx" ON "LikenessAsset"("referenceHash");

-- CreateIndex
CREATE INDEX "Licensee_status_idx" ON "Licensee"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Grant_supersedesId_key" ON "Grant"("supersedesId");

-- CreateIndex
CREATE INDEX "Grant_personId_idx" ON "Grant"("personId");

-- CreateIndex
CREATE INDEX "Grant_licenseeId_idx" ON "Grant"("licenseeId");

-- CreateIndex
CREATE INDEX "Grant_status_idx" ON "Grant"("status");

-- CreateIndex
CREATE INDEX "Grant_startsAt_endsAt_idx" ON "Grant"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "GrantAsset_assetId_idx" ON "GrantAsset"("assetId");

-- CreateIndex
CREATE INDEX "LicenseInstance_grantId_idx" ON "LicenseInstance"("grantId");

-- CreateIndex
CREATE INDEX "LicenseInstance_licenseeId_idx" ON "LicenseInstance"("licenseeId");

-- CreateIndex
CREATE INDEX "LicenseInstance_status_idx" ON "LicenseInstance"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProvenanceRecord_hash_key" ON "ProvenanceRecord"("hash");

-- CreateIndex
CREATE INDEX "ProvenanceRecord_grantId_idx" ON "ProvenanceRecord"("grantId");

-- CreateIndex
CREATE INDEX "ProvenanceRecord_licenseInstanceId_idx" ON "ProvenanceRecord"("licenseInstanceId");

-- CreateIndex
CREATE INDEX "ProvenanceRecord_prevHash_idx" ON "ProvenanceRecord"("prevHash");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_actorType_actorId_idx" ON "AuditLog"("actorType", "actorId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_representativeId_fkey" FOREIGN KEY ("representativeId") REFERENCES "Representative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityVerification" ADD CONSTRAINT "IdentityVerification_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LikenessAsset" ADD CONSTRAINT "LikenessAsset_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_licenseeId_fkey" FOREIGN KEY ("licenseeId") REFERENCES "Licensee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Grant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantAsset" ADD CONSTRAINT "GrantAsset_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantAsset" ADD CONSTRAINT "GrantAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "LikenessAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseInstance" ADD CONSTRAINT "LicenseInstance_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseInstance" ADD CONSTRAINT "LicenseInstance_licenseeId_fkey" FOREIGN KEY ("licenseeId") REFERENCES "Licensee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProvenanceRecord" ADD CONSTRAINT "ProvenanceRecord_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProvenanceRecord" ADD CONSTRAINT "ProvenanceRecord_licenseInstanceId_fkey" FOREIGN KEY ("licenseInstanceId") REFERENCES "LicenseInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

