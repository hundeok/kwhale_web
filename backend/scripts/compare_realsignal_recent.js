const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { extractCryptoHoldings } = require('../lib/holding-extractor');

const backendRoot = path.resolve(__dirname, '..');
const privateRoot = path.resolve(process.env.KWHALE_PRIVATE_ROOT || path.join(backendRoot, 'private-data'));
const sourcePath = path.resolve(process.argv[2] || process.env.KWHALE_REALSIGNAL_RECENT || '');
if (!sourcePath || !fs.existsSync(sourcePath)) {
  throw new Error('사용법: node scripts/compare_realsignal_recent.js /path/to/recent.json');
}

const pointer = JSON.parse(fs.readFileSync(path.join(privateRoot, 'releases', 'latest-release.json'), 'utf8'));
const databasePath = path.join(privateRoot, pointer.database);
const sourceBytes = fs.readFileSync(sourcePath);
const sourceSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
const source = JSON.parse(sourceBytes);
const db = new DatabaseSync(databasePath, { readOnly: true });
db.exec('PRAGMA query_only = ON');

function norm(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function identityKey(person, year) {
  return [norm(person.name), norm(person.org), norm(person.title), Number(year)].join('|');
}

function assetSignature(asset, person, year) {
  return [
    identityKey(person, year),
    norm(asset.type ?? asset.category),
    norm(asset.subType ?? asset.subcategory),
    norm(asset.detail),
    Number(asset.valuation || 0),
    norm(asset.owner),
    asset.difference === null || asset.difference === undefined ? '' : Number(asset.difference),
  ].join('|');
}

function addCount(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function categorySummary(rows, fields) {
  const result = new Map();
  for (const row of rows) {
    const category = norm(row[fields.category]);
    const item = result.get(category) || { category, assets: 0, valuation: 0 };
    item.assets += 1;
    item.valuation += Number(row[fields.valuation] || 0);
    result.set(category, item);
  }
  return [...result.values()].sort((a, b) => b.assets - a.assets);
}

function diffSummary(left, right) {
  let exact = 0;
  let leftOnly = 0;
  let rightOnly = 0;
  for (const [key, count] of left) {
    const other = right.get(key) || 0;
    exact += Math.min(count, other);
    leftOnly += Math.max(0, count - other);
  }
  for (const [key, count] of right) {
    rightOnly += Math.max(0, count - (left.get(key) || 0));
  }
  return { exact, externalOnly: leftOnly, internalOnly: rightOnly };
}

function main() {
  const externalPeople = [];
  const externalAssets = [];
  for (const [yearText, people] of Object.entries(source.yearlyData || {})) {
    const year = Number(yearText);
    for (const person of people) {
      externalPeople.push({ ...person, year });
      for (const asset of person.assets || []) {
        externalAssets.push({ ...asset, person, year });
      }
    }
  }

  const internalPeople = db.prepare(`
    WITH ranked AS (
      SELECT d.*,
             ROW_NUMBER() OVER (
               PARTITION BY person_id
               ORDER BY period_year DESC,
                        COALESCE(disclosed_at, registered_at, '') DESC,
                        source_record_index DESC
             ) rn
      FROM disclosure d WHERE period_year IN (2025, 2026)
    )
    SELECT id, person_id, name_at_disclosure AS name,
           organization_at_disclosure AS org, title_at_disclosure AS title,
           period_year AS year, registered_at AS registeredDate, asset_count AS assetCount
    FROM ranked WHERE rn = 1
  `).all();
  const disclosureIds = internalPeople.map((person) => person.id);
  const internalAssets = [];
  for (let offset = 0; offset < disclosureIds.length; offset += 500) {
    const ids = disclosureIds.slice(offset, offset + 500);
    const placeholders = ids.map(() => '?').join(',');
    internalAssets.push(...db.prepare(`
      SELECT a.*, d.name_at_disclosure AS personName,
             d.organization_at_disclosure AS personOrg,
             d.title_at_disclosure AS personTitle, d.period_year AS year
      FROM asset a JOIN disclosure d ON d.id = a.disclosure_id
      WHERE a.disclosure_id IN (${placeholders})
    `).all(...ids));
  }

  const externalIdentity = new Map();
  for (const person of externalPeople) addCount(externalIdentity, identityKey(person, person.year));
  const internalIdentity = new Map();
  for (const person of internalPeople) addCount(internalIdentity, identityKey(person, person.year));
  const externalSignatures = new Map();
  for (const asset of externalAssets) addCount(
    externalSignatures,
    assetSignature(asset, asset.person, asset.year)
  );
  const internalSignatures = new Map();
  for (const asset of internalAssets) addCount(
    internalSignatures,
    assetSignature(
      asset,
      { name: asset.personName, org: asset.personOrg, title: asset.personTitle },
      asset.year
    )
  );

  const internalOnlyPeople = internalPeople.filter(
    (person) => !externalIdentity.has(identityKey(person, person.year))
  ).map((person) => ({
    name: person.name,
    organization: person.org,
    title: person.title,
    year: person.year,
    assetCount: person.assetCount,
  }));
  const externalOnlyPeople = externalPeople.filter(
    (person) => !internalIdentity.has(identityKey(person, person.year))
  ).map((person) => ({
    name: person.name,
    organization: person.org,
    title: person.title,
    year: person.year,
    assetCount: person.assets?.length || 0,
  }));

  const externalCryptoAssets = externalAssets.filter((asset) => asset.type === '가상자산');
  const internalCryptoAssets = internalAssets.filter((asset) => asset.category === '가상자산');
  let duplicatedInstrumentValuation = 0;
  let activeCryptoComponents = 0;
  let directlyAllocatedValuation = 0;
  for (const asset of externalCryptoAssets) {
    const holdings = extractCryptoHoldings(asset.detail, asset.valuation)
      .filter((holding) => holding.quantity !== 0);
    for (const holding of holdings) {
      activeCryptoComponents += 1;
      duplicatedInstrumentValuation += Number(asset.valuation || 0);
      if (holding.declaredValuation !== null) {
        directlyAllocatedValuation += Number(holding.declaredValuation);
      }
    }
  }
  const externalCryptoValuation = externalCryptoAssets.reduce(
    (sum, asset) => sum + Number(asset.valuation || 0), 0
  );
  const internalCryptoValuation = internalCryptoAssets.reduce(
    (sum, asset) => sum + Number(asset.valuation || 0), 0
  );

  const report = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    source: {
      path: sourcePath,
      sha256: sourceSha256,
      bytes: sourceBytes.length,
      metadata: source.metadata || null,
    },
    internalRelease: {
      releaseId: pointer.releaseId,
      databaseSha256: pointer.databaseSha256,
    },
    population: {
      externalPersons: externalPeople.length,
      internalPersons: internalPeople.length,
      ...diffSummary(externalIdentity, internalIdentity),
      externalOnlyPeople,
      internalOnlyPeople,
    },
    assets: {
      externalAssets: externalAssets.length,
      internalAssets: internalAssets.length,
      ...diffSummary(externalSignatures, internalSignatures),
      externalCategories: categorySummary(externalAssets, { category: 'type', valuation: 'valuation' }),
      internalCategories: categorySummary(internalAssets, { category: 'category', valuation: 'valuation' }),
    },
    crypto: {
      externalAssets: externalCryptoAssets.length,
      internalAssets: internalCryptoAssets.length,
      externalValuation: externalCryptoValuation,
      internalValuation: internalCryptoValuation,
      exactAssetValuationMatch: externalCryptoValuation === internalCryptoValuation,
      activeComponents: activeCryptoComponents,
      directlyAllocatedValuation,
      directValuationCoverage: externalCryptoValuation
        ? directlyAllocatedValuation / externalCryptoValuation : 0,
      duplicatedFullRowValuation: duplicatedInstrumentValuation,
      duplicatedInflationFactor: externalCryptoValuation
        ? duplicatedInstrumentValuation / externalCryptoValuation : 0,
      policy: '복수 코인 행의 전체 평가액을 각 코인에 반복 귀속하지 않음',
    },
    externalConsistency: {
      metadataPersonsMatchesYearlyData:
        Number(source.metadata?.totalPersons) === externalPeople.length,
      allAssetsMatchesYearlyAssets:
        Number(source.allAssets?.length || 0) === externalAssets.length,
      notes: [
        '외부 export는 비교 기준이며 공식 원문을 대체하지 않음',
        '불일치는 원문·수집시점·신원해소 차이를 확인한 뒤에만 반영',
      ],
    },
  };
  report.gates = {
    identityMatchRate: report.population.exact / Math.max(1, report.population.externalPersons),
    assetMatchRate: report.assets.exact / Math.max(1, report.assets.externalAssets),
    identityMatchPass:
      report.population.exact / Math.max(1, report.population.externalPersons) >= 0.999,
    assetMatchPass:
      report.assets.exact / Math.max(1, report.assets.externalAssets) >= 0.9999,
    cryptoCountPass: report.crypto.externalAssets === report.crypto.internalAssets,
    cryptoValuationPass: report.crypto.exactAssetValuationMatch,
  };
  report.gates.allPass = Object.entries(report.gates)
    .filter(([key]) => key.endsWith('Pass'))
    .every(([, value]) => value === true);

  const outputDir = path.join(privateRoot, 'lineage', 'comparisons');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `realsignal-recent-${sourceSha256.slice(0, 16)}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    outputPath,
    population: report.population,
    assets: {
      externalAssets: report.assets.externalAssets,
      internalAssets: report.assets.internalAssets,
      exact: report.assets.exact,
      externalOnly: report.assets.externalOnly,
      internalOnly: report.assets.internalOnly,
    },
    crypto: report.crypto,
    gates: report.gates,
  }, null, 2));
  if (process.env.KWHALE_COMPARE_STRICT === '1' && !report.gates.allPass) {
    process.exitCode = 2;
  }
}

try {
  main();
} finally {
  db.close();
}
