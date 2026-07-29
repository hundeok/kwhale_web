const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const { calculateTotals, normalizeCategory } = require('./lib/normalizer');

const prisma = new PrismaClient();

async function main() {
  console.log('📡 125MB 원본 JSON 데이터 로딩 중...');
  const configuredPath = process.env.KWHALE_DATA_PATH;
  const localPath = path.resolve(__dirname, '../assets/kwhale_data.json');
  const rawPath = configuredPath ? path.resolve(configuredPath) : localPath;
  if (!fs.existsSync(rawPath)) {
    throw new Error(`원본 JSON을 찾을 수 없습니다: ${rawPath}. KWHALE_DATA_PATH를 지정하세요.`);
  }
  const rawData = fs.readFileSync(rawPath, 'utf-8');
  const data = JSON.parse(rawData);

  console.log('⚙️ 공직자 자산 데이터 그룹화 및 정제 중...');
  const officialsMap = new Map();

  // 실제 서비스: 125MB 전체 데이터 처리
  const sampleAssets = data.allAssets; 

  for (const asset of sampleAssets) {
    const key = `${asset.personName}_${asset.personOrg}`;
    if (!officialsMap.has(key)) {
      officialsMap.set(key, {
        name: asset.personName,
        agency: asset.personOrg,
        title: asset.personTitle || '기타직위',
        totalAssets: 0n,
        netWorth: 0n,
        assets: []
      });
    }
    
    const official = officialsMap.get(key);
    
    const val = BigInt(Math.floor(asset.valuation || 0));
    const normalized = normalizeCategory(asset.assetType || '기타');
    if (normalized.group === '부채') {
      official.netWorth -= val < 0n ? -val : val;
    } else if (val > 0n) {
      official.totalAssets += val;
      official.netWorth += val;
    }
    
    official.assets.push({
      category: asset.assetType || '기타',
      detailType: asset.assetSubType || asset.assetType || '기타',
      address: asset.address || asset.assetDetail || null,
      owner: asset.owner || '본인',
      latitude: asset.latitude ? parseFloat(asset.latitude) : null,
      longitude: asset.longitude ? parseFloat(asset.longitude) : null,
      valuation: val
    });
  }

  console.log(`✅ ${officialsMap.size}명의 공직자 데이터 정규화 완료. Prisma DB Insert 시작...`);
  
  let count = 0;
  for (const [key, official] of officialsMap.entries()) {
    await prisma.official.create({
      data: {
        name: official.name,
        agency: official.agency,
        title: official.title,
        totalAssets: official.totalAssets,
        netWorth: official.netWorth,
        assets: {
          create: official.assets
        }
      }
    });
    count++;
    if (count % 20 === 0) console.log(`💾 DB Insert 진행 중... (${count}/${officialsMap.size})`);
  }
  
  console.log('🚀 Seed Migration 완료! K-Whale DB 세팅이 모두 끝났습니다.');
}

main()
  .catch(e => {
    console.error('Migration Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
