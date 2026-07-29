const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const {
  PARSER_VERSION,
  normalizeCategory,
  normalizeOwner,
  rowHash,
  calculateTotals
} = require('../lib/normalizer');
const { makeAssetKey, compareSnapshots } = require('../lib/change-engine');
const { extractSecurityHoldings, extractCryptoHoldings } = require('../lib/holding-extractor');

const prisma = new PrismaClient();
const sourcePath = path.resolve(
  process.env.KWHALE_DATA_PATH || path.join(__dirname, '../../assets/kwhale_data.json')
);
const chunkSize = 500;

function stableId(namespace, value) {
  const digest = crypto.createHash('sha256').update(`${namespace}|${value}`).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function assetIdentity(person, asset, year, index) {
  return [
    year, person.name, person.org, person.title, person.registeredDate,
    asset.owner, asset.type, asset.subType, asset.detail, asset.valuation, index
  ].join('|');
}

function geoLookupKey(person, asset) {
  return [
    person.name, person.org, person.title, person.registeredDate,
    asset.type, asset.subType, asset.detail, asset.valuation ?? 0, asset.owner
  ].join('|');
}

async function createManyInChunks(model, rows) {
  for (let index = 0; index < rows.length; index += chunkSize) {
    await model.createMany({ data: rows.slice(index, index + chunkSize) });
  }
}

async function resetV2Tables() {
  await prisma.$transaction([
    prisma.securityHolding.deleteMany(),
    prisma.cryptoHolding.deleteMany(),
    prisma.securityInstrument.deleteMany(),
    prisma.cryptoInstrument.deleteMany(),
    prisma.assetHistory.deleteMany(),
    prisma.asset.deleteMany(),
    prisma.rawAsset.deleteMany(),
    prisma.disclosureOfficial.deleteMany(),
    prisma.sourceDocument.deleteMany(),
    prisma.disclosure.deleteMany(),
    prisma.official.deleteMany()
  ]);
}

async function main() {
  if (!fs.existsSync(sourcePath)) throw new Error(`연도별 export를 찾을 수 없습니다: ${sourcePath}`);
  console.log(`연도별 export 로딩: ${sourcePath}`);
  const sourceBytes = fs.readFileSync(sourcePath);
  const sourceHash = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  const exportData = JSON.parse(sourceBytes);
  const yearlyData = exportData.yearlyData;
  if (!yearlyData || typeof yearlyData !== 'object') throw new Error('yearlyData가 없는 export입니다.');

  const geoMap = new Map();
  for (const item of exportData.allAssets || []) {
    const person = {
      name: item.personName,
      org: item.personOrg,
      title: item.personTitle,
      registeredDate: item.registeredDate
    };
    const asset = {
      type: item.assetType,
      subType: item.assetSubType,
      detail: item.assetDetail,
      valuation: item.valuation,
      owner: item.owner
    };
    geoMap.set(geoLookupKey(person, asset), {
      address: item.address || null,
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null
    });
  }

  await resetV2Tables();

  const officialMap = new Map();
  const disclosures = [];
  const disclosureOfficialMap = new Map();
  const rawAssets = [];
  const assets = [];
  const securityInstruments = new Map();
  const cryptoInstruments = new Map();
  const securityHoldingMap = new Map();
  const cryptoHoldingMap = new Map();
  const assetsByOfficialYear = new Map();

  for (const [yearText, people] of Object.entries(yearlyData)) {
    const year = Number(yearText);
    const disclosureId = stableId('disclosure', `legacy-export-${year}`);
    const dates = people.map(person => person.disclosureDate || person.registeredDate).filter(Boolean).sort();
    const publishedAt = dates.at(-1) || `${year}-12-31T00:00:00.000Z`;
    disclosures.push({
      id: disclosureId,
      year,
      publishedAt: new Date(publishedAt),
      disclosureType: 'MIXED_REGULAR_AND_ADHOC',
      committee: null,
      title: `${year}년 기존 연도별 export`,
      sourceUrl: `local-export://kwhale_data.json/${year}`,
      sourceSite: 'LEGACY_REAL_SIGNAL_EXPORT',
      documentHash: sourceHash,
      parserVersion: PARSER_VERSION,
      ingestionStatus: 'IMPORTED_SOURCE_URL_PENDING',
      ingestedAt: new Date()
    });

    for (const person of people) {
      const officialKey = `${person.name}|${person.org}`;
      let official = officialMap.get(officialKey);
      if (!official) {
        official = {
          id: stableId('official', officialKey),
          name: person.name,
          agency: person.org || '미상',
          title: person.title || '미상',
          totalAssets: 0n,
          netWorth: 0n,
          lastUpdated: new Date(person.disclosureDate || person.registeredDate || publishedAt)
        };
        officialMap.set(officialKey, official);
      }

      const normalizedForTotals = (person.assets || []).map(asset => ({
        category: normalizeCategory(asset.type).category === '채무' ? '채무' : asset.type,
        valuation: BigInt(asset.valuation || 0)
      }));
      const totals = calculateTotals(normalizedForTotals);
      if (new Date(person.disclosureDate || person.registeredDate || publishedAt) >= official.lastUpdated) {
        official.agency = person.org || official.agency;
        official.title = person.title || official.title;
        official.totalAssets = totals.grossAssets;
        official.netWorth = totals.netWorth;
        official.lastUpdated = new Date(person.disclosureDate || person.registeredDate || publishedAt);
      }
      disclosureOfficialMap.set(`${disclosureId}|${official.id}`, {
        id: stableId('disclosure-official', `${disclosureId}|${official.id}`),
        disclosureId,
        officialId: official.id,
        nameAtDisclosure: person.name,
        agencyAtDisclosure: person.org || '미상',
        titleAtDisclosure: person.title || '미상',
        grossAssets: totals.grossAssets,
        liabilities: totals.liabilities,
        netWorth: totals.netWorth,
        identityConfidence: 0.85
      });

      const snapshotKey = `${official.id}|${year}`;
      const snapshotAssets = [];
      for (const [assetIndex, asset] of (person.assets || []).entries()) {
        const identity = assetIdentity(person, asset, year, assetIndex);
        const rawId = stableId('raw-asset', identity);
        const assetId = stableId('asset', identity);
        const category = normalizeCategory(asset.type);
        const owner = normalizeOwner(asset.owner);
        const geo = geoMap.get(geoLookupKey(person, asset)) || {};
        const rawRecord = {
          disclosureId,
          officialName: person.name,
          agency: person.org,
          title: person.title,
          ownerRaw: asset.owner,
          categoryRaw: asset.type,
          detailRaw: asset.detail || '',
          amountRaw: asset.valuation === undefined ? null : String(asset.valuation),
        };
        const sourceLocator = `yearlyData.${year}[${people.indexOf(person)}].assets[${assetIndex}]`;
        rawAssets.push({
          id: rawId,
          ...rawRecord,
          amountValue: asset.valuation === undefined ? null : BigInt(asset.valuation),
          sourceLocator,
          rowHash: crypto.createHash('sha256').update(`${rowHash(rawRecord)}|${sourceLocator}`).digest('hex'),
          parserVersion: PARSER_VERSION
        });
        const normalizedAsset = {
          id: assetId,
          officialId: official.id,
          category: asset.type || '기타',
          detailType: asset.subType || asset.type || '기타',
          address: geo.address || asset.detail || null,
          owner: owner.value,
          latitude: geo.latitude ?? null,
          longitude: geo.longitude ?? null,
          valuation: BigInt(asset.valuation || 0),
          disclosureId,
          rawAssetId: rawId,
          normalizedCategory: category.category,
          normalizedSubcategory: asset.subType || asset.type || '기타',
          confidence: Math.min(category.confidence, owner.confidence || 1),
          reviewStatus: category.confidence >= 0.9 ? 'AUTO_CLASSIFIED' : 'NEEDS_REVIEW',
          sourceLocator
        };
        normalizedAsset.assetKey = makeAssetKey(normalizedAsset);
        assets.push(normalizedAsset);
        snapshotAssets.push(normalizedAsset);

        if (category.category === '증권') {
          for (const holding of extractSecurityHoldings(asset.detail, asset.valuation)) {
            const instrumentKey = `${holding.canonicalName}|${holding.ticker || ''}|${asset.subType || ''}`;
            const instrumentId = stableId('security-instrument', instrumentKey);
            securityInstruments.set(instrumentKey, {
              id: instrumentId,
              canonicalName: holding.canonicalName,
              ticker: holding.ticker,
              market: asset.subType || null,
              country: null,
              aliasesJson: JSON.stringify([holding.sourceText])
            });
            securityHoldingMap.set(`${assetId}|${instrumentId}|${holding.sourceText}`, {
              id: stableId('security-holding', `${assetId}|${instrumentId}|${holding.sourceText}`),
              assetId,
              instrumentId,
              quantity: holding.quantity,
              declaredValuation: holding.declaredValuation,
              allocationMethod: holding.allocationMethod,
              confidence: holding.confidence,
              sourceText: holding.sourceText
            });
          }
        }
        if (category.category === '가상자산') {
          for (const holding of extractCryptoHoldings(asset.detail, asset.valuation)) {
            const instrumentKey = `${holding.canonicalName}|${holding.ticker || ''}`;
            const instrumentId = stableId('crypto-instrument', instrumentKey);
            cryptoInstruments.set(instrumentKey, {
              id: instrumentId,
              canonicalName: holding.canonicalName,
              ticker: holding.ticker,
              aliasesJson: JSON.stringify([holding.sourceText])
            });
            cryptoHoldingMap.set(`${assetId}|${instrumentId}|${holding.sourceText}`, {
              id: stableId('crypto-holding', `${assetId}|${instrumentId}|${holding.sourceText}`),
              assetId,
              instrumentId,
              quantity: holding.quantity,
              declaredValuation: holding.declaredValuation,
              allocationMethod: holding.allocationMethod,
              confidence: holding.confidence,
              sourceText: holding.sourceText
            });
          }
        }
      }
      assetsByOfficialYear.set(snapshotKey, snapshotAssets);
    }
  }

  await createManyInChunks(prisma.disclosure, disclosures);
  await createManyInChunks(prisma.official, [...officialMap.values()]);
  await createManyInChunks(prisma.disclosureOfficial, [...disclosureOfficialMap.values()]);
  await createManyInChunks(prisma.rawAsset, rawAssets);
  await createManyInChunks(prisma.asset, assets);
  await createManyInChunks(prisma.securityInstrument, [...securityInstruments.values()]);
  await createManyInChunks(prisma.cryptoInstrument, [...cryptoInstruments.values()]);
  await createManyInChunks(prisma.securityHolding, [...securityHoldingMap.values()]);
  await createManyInChunks(prisma.cryptoHolding, [...cryptoHoldingMap.values()]);

  const historyRows = [];
  const years = Object.keys(yearlyData).map(Number).sort();
  for (const official of officialMap.values()) {
    for (let index = 1; index < years.length; index++) {
      const previousYear = years[index - 1];
      const currentYear = years[index];
      const before = assetsByOfficialYear.get(`${official.id}|${previousYear}`);
      const after = assetsByOfficialYear.get(`${official.id}|${currentYear}`);
      if (!before || !after) continue;
      for (const change of compareSnapshots(before, after)) {
        if (change.action === 'UNCHANGED') continue;
        historyRows.push({
          id: stableId('asset-history', `${official.id}|${currentYear}|${change.assetKey}`),
          officialId: official.id,
          year: currentYear,
          action: change.action,
          description: change.assetKey,
          amountChange: change.amountChange,
          fromDisclosureId: stableId('disclosure', `legacy-export-${previousYear}`),
          toDisclosureId: stableId('disclosure', `legacy-export-${currentYear}`),
          previousAmount: change.previousAmount,
          currentAmount: change.currentAmount,
          confidence: change.confidence,
          matchMethod: change.matchMethod,
          sourceAssetKey: change.assetKey
        });
      }
    }
  }
  await createManyInChunks(prisma.assetHistory, historyRows);

  const summary = {
    sourcePath,
    sourceHash,
    years: Object.fromEntries(Object.entries(yearlyData).map(([year, people]) => [year, people.length])),
    officials: officialMap.size,
    disclosureOfficials: disclosureOfficialMap.size,
    rawAssets: rawAssets.length,
    assets: assets.length,
    securityInstruments: securityInstruments.size,
    securityHoldings: securityHoldingMap.size,
    cryptoInstruments: cryptoInstruments.size,
    cryptoHoldings: cryptoHoldingMap.size,
    historyRows: historyRows.length
  };
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
