PRAGMA foreign_keys=OFF;

CREATE TABLE "Disclosure" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "year" INTEGER NOT NULL,
  "publishedAt" DATETIME NOT NULL,
  "disclosureType" TEXT NOT NULL,
  "committee" TEXT,
  "title" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "sourceSite" TEXT NOT NULL,
  "documentHash" TEXT,
  "parserVersion" TEXT,
  "ingestionStatus" TEXT NOT NULL DEFAULT 'DISCOVERED',
  "ingestedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Disclosure_sourceUrl_key" ON "Disclosure"("sourceUrl");
CREATE INDEX "Disclosure_year_publishedAt_idx" ON "Disclosure"("year", "publishedAt");

CREATE TABLE "SourceDocument" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "disclosureId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT,
  "localPath" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "byteSize" BIGINT NOT NULL,
  "downloadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "extractionStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "extractedTextPath" TEXT,
  CONSTRAINT "SourceDocument_disclosureId_fkey" FOREIGN KEY ("disclosureId") REFERENCES "Disclosure" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SourceDocument_sha256_key" ON "SourceDocument"("sha256");
CREATE INDEX "SourceDocument_disclosureId_idx" ON "SourceDocument"("disclosureId");

CREATE TABLE "DisclosureOfficial" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "disclosureId" TEXT NOT NULL,
  "officialId" TEXT NOT NULL,
  "nameAtDisclosure" TEXT NOT NULL,
  "agencyAtDisclosure" TEXT NOT NULL,
  "titleAtDisclosure" TEXT NOT NULL,
  "grossAssets" BIGINT NOT NULL,
  "liabilities" BIGINT NOT NULL,
  "netWorth" BIGINT NOT NULL,
  "identityConfidence" REAL,
  CONSTRAINT "DisclosureOfficial_disclosureId_fkey" FOREIGN KEY ("disclosureId") REFERENCES "Disclosure" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DisclosureOfficial_officialId_fkey" FOREIGN KEY ("officialId") REFERENCES "Official" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DisclosureOfficial_disclosureId_officialId_key" ON "DisclosureOfficial"("disclosureId", "officialId");
CREATE INDEX "DisclosureOfficial_officialId_disclosureId_idx" ON "DisclosureOfficial"("officialId", "disclosureId");

CREATE TABLE "RawAsset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "disclosureId" TEXT NOT NULL,
  "officialName" TEXT NOT NULL,
  "agency" TEXT,
  "title" TEXT,
  "ownerRaw" TEXT,
  "categoryRaw" TEXT NOT NULL,
  "detailRaw" TEXT NOT NULL,
  "amountRaw" TEXT,
  "amountValue" BIGINT,
  "sourceLocator" TEXT,
  "rowHash" TEXT NOT NULL,
  "parsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "parserVersion" TEXT NOT NULL,
  CONSTRAINT "RawAsset_disclosureId_fkey" FOREIGN KEY ("disclosureId") REFERENCES "Disclosure" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RawAsset_disclosureId_rowHash_key" ON "RawAsset"("disclosureId", "rowHash");
CREATE INDEX "RawAsset_disclosureId_officialName_idx" ON "RawAsset"("disclosureId", "officialName");

ALTER TABLE "Asset" ADD COLUMN "disclosureId" TEXT;
ALTER TABLE "Asset" ADD COLUMN "rawAssetId" TEXT;
ALTER TABLE "Asset" ADD COLUMN "normalizedCategory" TEXT;
ALTER TABLE "Asset" ADD COLUMN "normalizedSubcategory" TEXT;
ALTER TABLE "Asset" ADD COLUMN "confidence" REAL;
ALTER TABLE "Asset" ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'UNREVIEWED';
ALTER TABLE "Asset" ADD COLUMN "sourceLocator" TEXT;
ALTER TABLE "Asset" ADD COLUMN "assetKey" TEXT;
CREATE INDEX "Asset_officialId_category_idx" ON "Asset"("officialId", "category");
CREATE INDEX "Asset_disclosureId_idx" ON "Asset"("disclosureId");
CREATE INDEX "Asset_assetKey_idx" ON "Asset"("assetKey");

CREATE TABLE "SecurityInstrument" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "canonicalName" TEXT NOT NULL,
  "ticker" TEXT,
  "market" TEXT,
  "country" TEXT,
  "aliasesJson" TEXT
);
CREATE UNIQUE INDEX "SecurityInstrument_canonicalName_ticker_market_key" ON "SecurityInstrument"("canonicalName", "ticker", "market");
CREATE INDEX "SecurityInstrument_ticker_idx" ON "SecurityInstrument"("ticker");
CREATE TABLE "SecurityHolding" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "assetId" TEXT NOT NULL,
  "instrumentId" TEXT NOT NULL,
  "quantity" REAL,
  "declaredValuation" BIGINT,
  "allocationMethod" TEXT,
  "confidence" REAL NOT NULL,
  "sourceText" TEXT NOT NULL,
  CONSTRAINT "SecurityHolding_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SecurityHolding_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "SecurityInstrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SecurityHolding_assetId_instrumentId_sourceText_key" ON "SecurityHolding"("assetId", "instrumentId", "sourceText");
CREATE INDEX "SecurityHolding_instrumentId_idx" ON "SecurityHolding"("instrumentId");

CREATE TABLE "CryptoInstrument" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "canonicalName" TEXT NOT NULL,
  "ticker" TEXT,
  "aliasesJson" TEXT
);
CREATE UNIQUE INDEX "CryptoInstrument_canonicalName_ticker_key" ON "CryptoInstrument"("canonicalName", "ticker");
CREATE INDEX "CryptoInstrument_ticker_idx" ON "CryptoInstrument"("ticker");
CREATE TABLE "CryptoHolding" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "assetId" TEXT NOT NULL,
  "instrumentId" TEXT NOT NULL,
  "quantity" REAL,
  "declaredValuation" BIGINT,
  "allocationMethod" TEXT,
  "confidence" REAL NOT NULL,
  "sourceText" TEXT NOT NULL,
  CONSTRAINT "CryptoHolding_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CryptoHolding_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "CryptoInstrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CryptoHolding_assetId_instrumentId_sourceText_key" ON "CryptoHolding"("assetId", "instrumentId", "sourceText");
CREATE INDEX "CryptoHolding_instrumentId_idx" ON "CryptoHolding"("instrumentId");

ALTER TABLE "AssetHistory" ADD COLUMN "fromDisclosureId" TEXT;
ALTER TABLE "AssetHistory" ADD COLUMN "toDisclosureId" TEXT;
ALTER TABLE "AssetHistory" ADD COLUMN "previousAmount" BIGINT;
ALTER TABLE "AssetHistory" ADD COLUMN "currentAmount" BIGINT;
ALTER TABLE "AssetHistory" ADD COLUMN "confidence" REAL;
ALTER TABLE "AssetHistory" ADD COLUMN "matchMethod" TEXT;
ALTER TABLE "AssetHistory" ADD COLUMN "sourceAssetKey" TEXT;
CREATE INDEX "AssetHistory_officialId_year_idx" ON "AssetHistory"("officialId", "year");

PRAGMA foreign_keys=ON;
