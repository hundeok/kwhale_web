const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main() {
  const output = arg('--output', path.join(__dirname, '../data/quality/latest.json'));
  const prisma = new PrismaClient();
  try {
    const [officials, assets, histories, categories, missingSource, lowConfidence] = await Promise.all([
      prisma.official.count(),
      prisma.asset.count(),
      prisma.assetHistory.count(),
      prisma.asset.groupBy({ by: ['category'], _count: { _all: true } }),
      prisma.asset.count({ where: { disclosureId: null } }),
      prisma.asset.count({ where: { OR: [{ confidence: null }, { confidence: { lt: 0.7 } }] } })
    ]);
    const report = {
      generatedAt: new Date().toISOString(),
      counts: { officials, assets, histories },
      lineageCoverage: assets ? (assets - missingSource) / assets : 0,
      lowConfidenceRate: assets ? lowConfidence / assets : 0,
      categories: categories.map(item => ({ category: item.category, count: item._count._all })),
      gates: {
        hasYearlyHistory: histories > 0,
        fullSourceLineage: missingSource === 0,
        publishableRankings: histories > 0 && missingSource === 0
      }
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
