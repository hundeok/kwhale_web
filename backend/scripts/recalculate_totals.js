const { PrismaClient } = require('@prisma/client');
const { calculateTotals } = require('../lib/normalizer');

const prisma = new PrismaClient();

async function main() {
  const batchSize = 100;
  let cursor;
  let updated = 0;
  while (true) {
    const officials = await prisma.official.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      include: { assets: { select: { category: true, valuation: true } } }
    });
    if (!officials.length) break;
    for (const official of officials) {
      const totals = calculateTotals(official.assets);
      await prisma.official.update({
        where: { id: official.id },
        data: { totalAssets: totals.grossAssets, netWorth: totals.netWorth }
      });
      updated++;
    }
    cursor = officials[officials.length - 1].id;
    console.log(`재계산 완료: ${updated}`);
  }
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
