const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { extractSecurityHoldings, extractCryptoHoldings } = require('../lib/holding-extractor');
const { PARSER_VERSION } = require('../lib/normalizer');
const { parseAssetRecord } = require('../lib/asset-parser');

const backendRoot = path.resolve(__dirname, '..');
const privateRoot = path.resolve(process.env.KWHALE_PRIVATE_ROOT || path.join(backendRoot, 'private-data'));
const pointer = JSON.parse(fs.readFileSync(path.join(privateRoot, 'releases', 'latest-release.json'), 'utf8'));
const databasePath = path.join(privateRoot, pointer.database);
const outputPath = path.resolve(
  process.env.KWHALE_SEMANTIC_REPORT || path.join(backendRoot, 'data', 'quality', 'semantic-latest.json')
);

const db = new DatabaseSync(databasePath, { readOnly: true });
db.exec('PRAGMA query_only = ON');

function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

function one(sql, ...params) {
  return db.prepare(sql).get(...params);
}

function ratio(value, total) {
  return total ? Number((Number(value) / Number(total)).toFixed(6)) : 0;
}

function fingerprint(name = '') {
  return String(name)
    .normalize('NFKC')
    .toUpperCase()
    .replace(/(주식회사|유한회사|㈜|\(주\)|회사|보통주|보통주식)/g, '')
    .replace(/[^0-9A-Z가-힣]/g, '');
}

function auditInstruments(category, subcategories, extractor) {
  const includesNull = subcategories.includes(null);
  const concreteSubcategories = subcategories.filter((value) => value !== null);
  const placeholders = concreteSubcategories.map(() => '?').join(',');
  const subcategorySql = [
    includesNull ? 'subcategory IS NULL' : '',
    concreteSubcategories.length ? `subcategory IN (${placeholders})` : '',
  ].filter(Boolean).join(' OR ');
  const rows = all(
    `SELECT id, subcategory, detail, valuation
     FROM asset WHERE category = ? AND (${subcategorySql})`,
    category,
    ...concreteSubcategories
  );
  const names = new Map();
  const fingerprintGroups = new Map();
  const suspicious = [];
  let components = 0;
  let activeComponents = 0;
  let allocatedComponents = 0;
  let unallocatedComponents = 0;
  let zeroQuantity = 0;
  let sourceValuation = 0;
  let allocatedValuation = 0;

  for (const row of rows) {
    sourceValuation += Number(row.valuation || 0);
    const holdings = extractor(row.detail, row.valuation);
    for (const holding of holdings) {
      components += 1;
      if (holding.quantity === 0) {
        zeroQuantity += 1;
        continue;
      }
      activeComponents += 1;
      if (holding.declaredValuation === null) {
        unallocatedComponents += 1;
      } else {
        allocatedComponents += 1;
        allocatedValuation += Number(holding.declaredValuation);
      }
      names.set(holding.canonicalName, (names.get(holding.canonicalName) || 0) + 1);
      const key = fingerprint(holding.canonicalName);
      const group = fingerprintGroups.get(key) || new Set();
      group.add(holding.canonicalName);
      fingerprintGroups.set(key, group);

      const reasons = [];
      if (holding.canonicalName.length > 60) reasons.push('LONG_NAME');
      if (/^(회사|주식회사|㈜|\(주\))/.test(holding.canonicalName)) reasons.push('LEGAL_PREFIX_REMAINS');
      if (/[\d,.]+\s*(주|개|좌|구)(?:\s|$)/.test(holding.canonicalName)) reasons.push('QUANTITY_REMAINS');
      if (/(증가|감소|신규)$/.test(holding.canonicalName)) reasons.push('CHANGE_TOKEN_REMAINS');
      if (reasons.length && suspicious.length < 200) {
        suspicious.push({
          assetId: row.id,
          subcategory: row.subcategory,
          canonicalName: holding.canonicalName,
          sourceText: holding.sourceText,
          reasons,
        });
      }
    }
  }

  const aliasCandidates = [...fingerprintGroups.entries()]
    .filter(([, variants]) => variants.size > 1)
    .map(([key, variants]) => ({ key, variants: [...variants] }))
    .sort((a, b) => b.variants.length - a.variants.length)
    .slice(0, 200);

  return {
    sourceAssets: rows.length,
    sourceValuation,
    components,
    activeComponents,
    zeroQuantity,
    allocatedComponents,
    unallocatedComponents,
    allocatedValuation,
    valuationCoverage: ratio(allocatedValuation, sourceValuation),
    uniqueNames: names.size,
    aliasCandidateGroups: aliasCandidates.length,
    aliasCandidates,
    suspiciousCount: suspicious.length,
    suspicious,
  };
}

function auditMonetaryAssets() {
  const rows = all(`
    SELECT id, category, subcategory, owner, detail, valuation, difference
    FROM asset
    WHERE category IN ('예금', '정치예금계좌', '채무', '채권', '현금')
  `);
  let components = 0;
  let parsedComponents = 0;
  let assetsWithParsedComponent = 0;
  let reconciledAssets = 0;
  const byCategory = new Map();

  for (const row of rows) {
    const parsed = parseAssetRecord({
      type: row.category,
      subType: row.subcategory,
      owner: row.owner,
      detail: row.detail,
      valuation: row.valuation,
      difference: row.difference,
    });
    const parts = parsed.components || [];
    const parsedParts = parts.filter((part) => part.amount !== null);
    components += parts.length;
    parsedComponents += parsedParts.length;
    if (parsedParts.length) assetsWithParsedComponent += 1;
    const sum = parsedParts.reduce((total, part) => total + part.amount, 0n);
    const valuation = BigInt(row.valuation || 0);
    const delta = sum > valuation ? sum - valuation : valuation - sum;
    const reconciled = valuation === 0n ? sum === 0n : delta * 100n <= valuation;
    if (parsedParts.length && reconciled) reconciledAssets += 1;

    const category = byCategory.get(row.category) || {
      assets: 0, components: 0, parsedComponents: 0, reconciledAssets: 0,
    };
    category.assets += 1;
    category.components += parts.length;
    category.parsedComponents += parsedParts.length;
    if (parsedParts.length && reconciled) category.reconciledAssets += 1;
    byCategory.set(row.category, category);
  }
  return {
    assets: rows.length,
    components,
    parsedComponents,
    assetsWithParsedComponent,
    reconciledAssets,
    componentCoverage: ratio(parsedComponents, components),
    assetCoverage: ratio(assetsWithParsedComponent, rows.length),
    reconciliationRate: ratio(reconciledAssets, assetsWithParsedComponent),
    byCategory: Object.fromEntries(byCategory),
  };
}

function main() {
  const structural = one(`
    SELECT COUNT(*) AS totalAssets,
           SUM(CASE WHEN TRIM(COALESCE(detail, '')) = '' THEN 1 ELSE 0 END) AS missingDetail,
           SUM(CASE WHEN TRIM(COALESCE(owner, '')) = '' THEN 1 ELSE 0 END) AS missingOwner,
           SUM(CASE WHEN valuation < 0 THEN 1 ELSE 0 END) AS negativeValuation
    FROM asset
  `);
  const realEstate = one(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN TRIM(COALESCE(detail, '')) = '' THEN 1 ELSE 0 END) AS missingDetail,
           SUM(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 ELSE 0 END) AS geocoded,
           SUM(CASE WHEN detail LIKE '%㎡%' THEN 1 ELSE 0 END) AS withAreaToken
    FROM asset WHERE category IN ('토지', '건물')
  `);
  const monetary = all(`
    SELECT category, COUNT(*) AS total,
           SUM(CASE WHEN TRIM(COALESCE(detail, '')) = '' THEN 1 ELSE 0 END) AS missingDetail,
           SUM(valuation) AS valuation
    FROM asset
    WHERE category IN ('예금', '정치예금계좌', '채무', '채권', '현금')
    GROUP BY category ORDER BY total DESC
  `);
  const monetaryParsing = auditMonetaryAssets();
  const categories = all(`
    SELECT category, subcategory, COUNT(*) AS total, SUM(valuation) AS valuation
    FROM asset GROUP BY category, subcategory ORDER BY category, total DESC
  `);
  const listed = auditInstruments('증권', ['상장주식'], extractSecurityHoldings);
  const unlisted = auditInstruments('증권', ['비상장주식'], extractSecurityHoldings);
  const bondSecurities = auditInstruments(
    '증권',
    ['기타채권', '금융채', '회사채', '국채', '채권', '공채', '지방채'],
    extractSecurityHoldings
  );
  const crypto = auditInstruments('가상자산', [null, '', '가상자산'], extractCryptoHoldings);

  const report = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    releaseId: pointer.releaseId,
    databaseSha256: pointer.databaseSha256,
    parserVersion: PARSER_VERSION,
    structural,
    classes: { listed, unlisted, bondSecurities, crypto, realEstate, monetary, monetaryParsing },
    categories,
    gates: {
      noNegativeValuation: Number(structural.negativeValuation) === 0,
      missingDetailRate: ratio(structural.missingDetail, structural.totalAssets) <= 0.001,
      realEstateGeocodeCoverage: ratio(realEstate.geocoded, realEstate.total) >= 0.95,
      realEstateAreaTokenCoverage: ratio(realEstate.withAreaToken, realEstate.total) >= 0.9,
      listedSuspiciousNameRate: ratio(listed.suspiciousCount, listed.activeComponents) <= 0.005,
      cryptoSuspiciousNameRate: ratio(crypto.suspiciousCount, crypto.activeComponents) <= 0.005,
      listedAliasCandidateRate: ratio(listed.aliasCandidateGroups, listed.uniqueNames) <= 0.02,
      cryptoAliasCandidateRate: ratio(crypto.aliasCandidateGroups, crypto.uniqueNames) <= 0.05,
      monetaryAssetCoverage: monetaryParsing.assetCoverage >= 0.9,
      monetaryReconciliationRate: monetaryParsing.reconciliationRate >= 0.9,
    },
  };
  report.publishable = Object.values(report.gates).every(Boolean);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    outputPath,
    releaseId: report.releaseId,
    parserVersion: report.parserVersion,
    publishable: report.publishable,
    gates: report.gates,
    summary: {
      assets: structural.totalAssets,
      listed: {
        sourceAssets: listed.sourceAssets,
        components: listed.components,
        valuationCoverage: listed.valuationCoverage,
        aliasCandidateGroups: listed.aliasCandidateGroups,
      },
      crypto: {
        sourceAssets: crypto.sourceAssets,
        components: crypto.components,
        valuationCoverage: crypto.valuationCoverage,
        aliasCandidateGroups: crypto.aliasCandidateGroups,
      },
    },
  }, null, 2));
  if (!report.publishable) {
    console.error('의미 품질 게이트 실패: 데이터 릴리스를 중단합니다.');
    process.exitCode = 1;
  }
}

try {
  main();
} finally {
  db.close();
}
