const { PrismaClient } = require('@prisma/client');
const taxonomy = require('../data/category-taxonomy.json');

const prisma = new PrismaClient();

async function main() {
  const categories = await prisma.asset.findMany({
    distinct: ['category'],
    select: { category: true }
  });
  let updated = 0;
  for (const { category } of categories) {
    const rule = taxonomy.rules.find(item => item.match.some(token => category.includes(token)));
    const result = await prisma.asset.updateMany({
      where: { category },
      data: {
        normalizedCategory: rule?.category ?? taxonomy.fallback.category,
        normalizedSubcategory: category,
        confidence: rule ? 1 : 0.25,
        reviewStatus: rule ? 'AUTO_CLASSIFIED' : 'NEEDS_REVIEW'
      }
    });
    updated += result.count;
    console.log(`${category} → ${rule?.group ?? taxonomy.fallback.group}/${rule?.category ?? taxonomy.fallback.category}: ${result.count}`);
  }
  console.log(`정규화 백필 완료: ${updated}`);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
