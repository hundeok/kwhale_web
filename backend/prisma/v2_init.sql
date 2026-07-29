-- CreateTable
CREATE TABLE "Official" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "agency" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "totalAssets" BIGINT NOT NULL,
    "netWorth" BIGINT NOT NULL,
    "lastUpdated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "officialId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "detailType" TEXT NOT NULL,
    "address" TEXT,
    "owner" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "valuation" BIGINT NOT NULL,
    "disclosureId" TEXT,
    "rawAssetId" TEXT,
    "normalizedCategory" TEXT,
    "normalizedSubcategory" TEXT,
    "confidence" REAL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'UNREVIEWED',
    "sourceLocator" TEXT,
    "assetKey" TEXT,
    CONSTRAINT "Asset_officialId_fkey" FOREIGN KEY ("officialId") REFERENCES "Official" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Asset_disclosureId_fkey" FOREIGN KEY ("disclosureId") REFERENCES "Disclosure" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Asset_rawAssetId_fkey" FOREIGN KEY ("rawAssetId") REFERENCES "RawAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SecurityInstrument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalName" TEXT NOT NULL,
    "ticker" TEXT,
    "market" TEXT,
    "country" TEXT,
    "aliasesJson" TEXT
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "CryptoInstrument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalName" TEXT NOT NULL,
    "ticker" TEXT,
    "aliasesJson" TEXT
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "AssetHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "officialId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountChange" BIGINT NOT NULL,
    "fromDisclosureId" TEXT,
    "toDisclosureId" TEXT,
    "previousAmount" BIGINT,
    "currentAmount" BIGINT,
    "confidence" REAL,
    "matchMethod" TEXT,
    "sourceAssetKey" TEXT,
    CONSTRAINT "AssetHistory_officialId_fkey" FOREIGN KEY ("officialId") REFERENCES "Official" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE INDEX "Asset_officialId_category_idx" ON "Asset"("officialId", "category");

-- CreateIndex
CREATE INDEX "Asset_disclosureId_idx" ON "Asset"("disclosureId");

-- CreateIndex
CREATE INDEX "Asset_assetKey_idx" ON "Asset"("assetKey");

-- CreateIndex
CREATE INDEX "SecurityInstrument_ticker_idx" ON "SecurityInstrument"("ticker");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityInstrument_canonicalName_ticker_market_key" ON "SecurityInstrument"("canonicalName", "ticker", "market");

-- CreateIndex
CREATE INDEX "SecurityHolding_instrumentId_idx" ON "SecurityHolding"("instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityHolding_assetId_instrumentId_sourceText_key" ON "SecurityHolding"("assetId", "instrumentId", "sourceText");

-- CreateIndex
CREATE INDEX "CryptoInstrument_ticker_idx" ON "CryptoInstrument"("ticker");

-- CreateIndex
CREATE UNIQUE INDEX "CryptoInstrument_canonicalName_ticker_key" ON "CryptoInstrument"("canonicalName", "ticker");

-- CreateIndex
CREATE INDEX "CryptoHolding_instrumentId_idx" ON "CryptoHolding"("instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "CryptoHolding_assetId_instrumentId_sourceText_key" ON "CryptoHolding"("assetId", "instrumentId", "sourceText");

-- CreateIndex
CREATE INDEX "AssetHistory_officialId_year_idx" ON "AssetHistory"("officialId", "year");

-- CreateIndex
CREATE INDEX "Disclosure_year_publishedAt_idx" ON "Disclosure"("year", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Disclosure_sourceUrl_key" ON "Disclosure"("sourceUrl");

-- CreateIndex
CREATE INDEX "SourceDocument_disclosureId_idx" ON "SourceDocument"("disclosureId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_sha256_key" ON "SourceDocument"("sha256");

-- CreateIndex
CREATE INDEX "DisclosureOfficial_officialId_disclosureId_idx" ON "DisclosureOfficial"("officialId", "disclosureId");

-- CreateIndex
CREATE UNIQUE INDEX "DisclosureOfficial_disclosureId_officialId_key" ON "DisclosureOfficial"("disclosureId", "officialId");

-- CreateIndex
CREATE INDEX "RawAsset_disclosureId_officialName_idx" ON "RawAsset"("disclosureId", "officialName");

-- CreateIndex
CREATE UNIQUE INDEX "RawAsset_disclosureId_rowHash_key" ON "RawAsset"("disclosureId", "rowHash");
