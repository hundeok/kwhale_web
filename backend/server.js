const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = 3333;

app.use(cors());
app.use(express.json());

// Helper: Serialize BigInt
const serialize = (obj) => JSON.parse(JSON.stringify(obj, (key, value) => typeof value === 'bigint' ? value.toString() : value));

app.get('/api/meta/methodology', async (req, res) => {
  try {
    const disclosures = await prisma.disclosure.findMany({
      select: { year: true, publishedAt: true, title: true, sourceUrl: true, sourceSite: true, ingestionStatus: true },
      orderBy: [{ year: 'desc' }, { publishedAt: 'desc' }]
    });
    const [assets, linkedAssets, histories] = await Promise.all([
      prisma.asset.count(),
      prisma.asset.count({ where: { disclosureId: { not: null } } }),
      prisma.assetHistory.count()
    ]);
    const verifiedDisclosures = disclosures.filter((item) =>
      /^https:\/\/(www\.)?(peti\.go\.kr|gwanbo\.go\.kr)\//.test(item.sourceUrl || '') &&
      !String(item.ingestionStatus || '').includes('PENDING')
    );
    res.json({
      success: true,
      data: {
        disclosures,
        quality: {
          assets,
          sourceLinkedAssets: linkedAssets,
          lineageCoverage: assets ? linkedAssets / assets : 0,
          yearlyChanges: histories,
          verifiedOfficialDisclosures: verifiedDisclosures.length,
          publishableRankings: new Set(verifiedDisclosures.map(item => item.year)).size > 1 &&
            histories > 0 && linkedAssets === assets
        },
        formulas: {
          grossAssets: '부채가 아닌 양수 자산 합계',
          liabilities: '채무 평가액 절댓값 합계',
          netWorth: '총자산 - 채무',
          profit: '현재 연도 순자산 - 이전 연도 순자산',
          yield: '순자산 증감액 / 이전 연도 순자산 × 100'
        },
        guarantees: {
          randomValues: false,
          duplicatedMultiInstrumentValuation: false,
          officialSourceRequiredForYearlyComparison: true
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 1. 대시보드 요약
app.get('/api/dashboard', async (req, res) => {
  try {
    const totalCount = await prisma.official.count();
    const totalAssetsObj = await prisma.official.aggregate({ _sum: { totalAssets: true } });
    const topOfficials = await prisma.official.findMany({ orderBy: { netWorth: 'desc' }, take: 5 });
    
    // 포트폴리오 비중 (부동산, 예금, 증권, 가상자산)
    const categorySums = await prisma.asset.groupBy({
      by: ['category'],
      _sum: { valuation: true },
    });
    
    // 가상자산 보유자 수
    const cryptoOwners = await prisma.asset.findMany({
      where: { category: '가상자산', valuation: { gt: 0 } },
      select: { officialId: true },
      distinct: ['officialId']
    });

    res.json({ 
      success: true, 
      data: {
        totalPersons: totalCount,
        totalAssetsValuation: totalAssetsObj._sum.totalAssets ? totalAssetsObj._sum.totalAssets.toString() : "0",
        topRankings: serialize(topOfficials),
        categorySums: serialize(categorySums),
        cryptoOwnersCount: cryptoOwners.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 1-1. 익스트림 엣지 지표 (영끌왕, 코인고래 등)
app.get('/api/dashboard/edgy-stats', async (req, res) => {
  try {
    const getTopByCategory = async (category, count = 5) => {
      const grouped = await prisma.asset.groupBy({
        by: ['officialId'],
        where: { category },
        _sum: { valuation: true },
        orderBy: { _sum: { valuation: 'desc' } },
        take: count
      });
      const offIds = grouped.map(g => g.officialId);
      const officials = await prisma.official.findMany({ 
        where: { id: { in: offIds } },
        select: { id: true, name: true, agency: true }
      });
      return grouped.map(g => ({
        ...officials.find(o => o.id === g.officialId),
        valuation: g._sum.valuation
      }));
    };

    const topDebtors = await getTopByCategory('채무');
    const topCryptoWhales = await getTopByCategory('가상자산');
    const topCashKings = await getTopByCategory('예금');
    const topBuildingKings = await getTopByCategory('건물');

    res.json({
      success: true,
      data: serialize({ topDebtors, topCryptoWhales, topCashKings, topBuildingKings })
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 2. 공직자 전체 검색 (Pagination & Search)
app.get('/api/officials', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const search = String(req.query.search || '').trim();
  const sort = req.query.sort || 'netWorth';
  const direction = req.query.direction === 'asc' ? 'asc' : 'desc';
  const agency = String(req.query.agency || '').trim();
  const category = String(req.query.category || '').trim();
  const minNetWorth = req.query.minNetWorth ? BigInt(req.query.minNetWorth) : undefined;
  const maxNetWorth = req.query.maxNetWorth ? BigInt(req.query.maxNetWorth) : undefined;

  try {
    const whereClause = {
      AND: [
        search ? { OR: [
        { name: { contains: search } },
        { agency: { contains: search } },
        { title: { contains: search } }
        ] } : {},
        agency ? { agency: { contains: agency } } : {},
        category ? { assets: { some: { category } } } : {},
        minNetWorth !== undefined || maxNetWorth !== undefined
          ? { netWorth: { ...(minNetWorth !== undefined ? { gte: minNetWorth } : {}), ...(maxNetWorth !== undefined ? { lte: maxNetWorth } : {}) } }
          : {}
      ]
    };

    const total = await prisma.official.count({ where: whereClause });
    
    const sortable = new Set(['name', 'agency', 'title', 'netWorth', 'totalAssets', 'lastUpdated']);
    const sortField = sortable.has(sort) ? sort : 'netWorth';
    const orderByClause = { [sortField]: sortField === 'name' && !req.query.direction ? 'asc' : direction };
    
    const officials = await prisma.official.findMany({
      where: whereClause,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: orderByClause,
      select: { id: true, name: true, agency: true, title: true, netWorth: true, totalAssets: true }
    });
    
    res.json({
      success: true,
      data: serialize(officials),
      meta: {
        total, page, limit, totalPages: Math.ceil(total / limit),
        sort: { field: sortField, direction: orderByClause[sortField] },
        filters: { search, agency, category, minNetWorth: req.query.minNetWorth || null, maxNetWorth: req.query.maxNetWorth || null }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 3. 공직자 상세
app.get('/api/officials/:id', async (req, res) => {
  try {
    const official = await prisma.official.findUnique({
      where: { id: req.params.id },
      include: { assets: true, history: true }
    });
    if (!official) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: serialize(official) });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 3-1. 공식 연도 스냅샷 기반 수익금 / 수익률 랭킹 엔진
app.get('/api/rankings/:mode', async (req, res) => {
  try {
    const mode = req.params.mode;
    if (!['profit', 'yield'].includes(mode)) {
      return res.status(400).json({ success: false, error: 'mode는 profit 또는 yield여야 합니다.' });
    }
    const years = await prisma.disclosure.findMany({
      where: {
        sourceUrl: { startsWith: 'https://' },
        NOT: { ingestionStatus: { contains: 'PENDING' } }
      },
      distinct: ['year'],
      select: { year: true },
      orderBy: { year: 'desc' },
      take: 2
    });
    if (years.length < 2) {
      return res.status(409).json({
        success: false,
        code: 'YEARLY_SNAPSHOTS_REQUIRED',
        data: [],
        methodology: {
          status: 'UNAVAILABLE',
          reason: '비교 가능한 공식 연도 스냅샷이 2개 이상 필요합니다.',
          fabricatedValues: false
        }
      });
    }
    const [currentYear, previousYear] = years.map(item => item.year);
    const snapshots = await prisma.disclosureOfficial.findMany({
      where: { disclosure: { year: { in: [currentYear, previousYear] } } },
      include: {
        official: { select: { id: true, name: true, agency: true, title: true } },
        disclosure: { select: { year: true, sourceUrl: true } }
      }
    });
    const byOfficial = new Map();
    for (const snapshot of snapshots) {
      const value = byOfficial.get(snapshot.officialId) ?? { official: snapshot.official };
      value[snapshot.disclosure.year] = snapshot;
      byOfficial.set(snapshot.officialId, value);
    }
    const ranked = [...byOfficial.values()]
      .filter(item => item[currentYear] && item[previousYear])
      .map(item => {
        const current = item[currentYear];
        const previous = item[previousYear];
        const profit = current.netWorth - previous.netWorth;
        const profitRate = previous.netWorth > 0n
          ? Number(profit * 10000n / previous.netWorth) / 100
          : null;
        return {
          id: item.official.id,
          name: item.official.name,
          agency: item.official.agency,
          title: item.official.title,
          previousNetWorth: previous.netWorth,
          finalNetWorth: current.netWorth,
          profit,
          profitRate,
          sources: [previous.disclosure.sourceUrl, current.disclosure.sourceUrl]
        };
      })
      .sort((a, b) => {
        if (mode === 'yield') return (b.profitRate ?? -Infinity) - (a.profitRate ?? -Infinity);
        return a.profit === b.profit ? a.name.localeCompare(b.name, 'ko') : (a.profit > b.profit ? -1 : 1);
      })
      .slice(0, 100);
    res.json({
      success: true,
      data: serialize(ranked),
      methodology: {
        status: 'OFFICIAL_SNAPSHOT_COMPARISON',
        currentYear,
        previousYear,
        formula: mode === 'yield'
          ? '(현재 순자산 - 이전 순자산) / 이전 순자산 × 100'
          : '현재 순자산 - 이전 순자산',
        debtTreatment: '총자산에서 채무 절댓값 차감',
        fabricatedValues: false
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 4. 자산 딥다이브 분석 (부동산, 증권, 가상자산)
// 5. 하이퍼 로컬 (초정밀 지역) 분석 엔진
app.get('/api/analysis/hyperlocal', async (req, res) => {
  try {
    const assets = await prisma.asset.findMany({
      where: { category: { in: ['건물', '토지'] } },
      select: {
        address: true,
        valuation: true,
        official: { select: { id: true, name: true, agency: true, title: true } }
      }
    });

    const tree = {};
    const validSidoList = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주', '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시', '세종특별자치시', '경기도', '강원특별자치도', '강원도', '충청북도', '충청남도', '전라북도', '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도'];

    assets.forEach(asset => {
      if (!asset.address) return;
      const parts = asset.address.trim().split(' ').filter(Boolean);
      if (parts.length < 2) return;

      let sido = parts[0];
      let gu = parts[1];
      let dong = parts.length > 2 ? parts[2] : '상세_미상';

      // Filter foreign or malformed addresses
      if (!validSidoList.includes(sido)) {
        sido = '해외_기타지역';
        gu = '미분류';
        dong = '전체';
      }

      if (!tree[sido]) tree[sido] = { location: sido, level: 'sido', totalAssets: 0, totalValuation: 0, children: {}, agencies: {}, personsSet: new Set() };
      tree[sido].totalAssets += 1;
      tree[sido].totalValuation += Number(asset.valuation || 0);
      if (asset.official) tree[sido].personsSet.add(asset.official.id);

      if (!tree[sido].children[gu]) tree[sido].children[gu] = { location: gu, level: 'gu', totalAssets: 0, totalValuation: 0, children: {}, agencies: {}, personsSet: new Set() };
      tree[sido].children[gu].totalAssets += 1;
      tree[sido].children[gu].totalValuation += Number(asset.valuation || 0);
      if (asset.official) tree[sido].children[gu].personsSet.add(asset.official.id);

      if (dong) {
        if (!tree[sido].children[gu].children[dong]) tree[sido].children[gu].children[dong] = { location: dong, level: 'dong', totalAssets: 0, totalValuation: 0, persons: [], agencies: {}, personsSet: new Set() };
        tree[sido].children[gu].children[dong].totalAssets += 1;
        tree[sido].children[gu].children[dong].totalValuation += Number(asset.valuation || 0);
        if (asset.official) tree[sido].children[gu].children[dong].personsSet.add(asset.official.id);
        
        if (asset.official) {
          const org = asset.official.agency || '기타';
          tree[sido].children[gu].children[dong].agencies[org] = (tree[sido].children[gu].children[dong].agencies[org] || 0) + 1;
          tree[sido].children[gu].children[dong].persons.push({
            id: asset.official.id,
            name: asset.official.name,
            title: asset.official.title,
            org: org,
            valuation: Number(asset.valuation || 0)
          });
        }
      }
    });

    const formatTree = (obj, isDong = false) => {
      return Object.values(obj).map(node => {
        let topAgency = null;
        if (node.agencies) {
          const sorted = Object.entries(node.agencies).sort((a, b) => b[1] - a[1]);
          if (sorted.length > 0) topAgency = sorted[0][0];
        }

        const formatted = {
          location: node.location,
          level: node.level,
          totalAssets: node.totalAssets,
          totalValuation: node.totalValuation,
          totalPersons: node.personsSet ? node.personsSet.size : 0,
          topAgency: topAgency
        };

        if (node.children) formatted.children = formatTree(node.children, node.level === 'gu').sort((a, b) => b.totalValuation - a.totalValuation);
        if (node.persons) {
          const personMap = {};
          node.persons.forEach(p => {
            if (!personMap[p.id]) personMap[p.id] = { id: p.id, name: p.name, org: p.org, title: p.title, assetCount: 0, totalValuation: 0 };
            personMap[p.id].assetCount += 1;
            personMap[p.id].totalValuation += p.valuation;
          });
          formatted.persons = Object.values(personMap).sort((a, b) => b.totalValuation - a.totalValuation).slice(0, 50);
        }
        return formatted;
      }).sort((a, b) => b.totalValuation - a.totalValuation);
    };

    const finalData = formatTree(tree);
    return res.json({ success: true, data: finalData });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/api/analysis/:type', async (req, res) => {
  const type = req.params.type; 
  const filter = req.query.filter; // 'all', 'land', 'building', 'apt', 'commercial'
  
  if (type === 'new-assets') {
    try {
      const movements = await prisma.assetHistory.findMany({
        where: { action: { in: ['ACQUIRED', '신규취득'] }, amountChange: { gt: 0 } },
        orderBy: { amountChange: 'desc' },
        take: 500,
        include: { official: { select: { id: true, name: true, agency: true, title: true } } }
      });
      if (!movements.length) {
        return res.status(409).json({
          success: false,
          code: 'YEARLY_ASSET_MATCH_REQUIRED',
          data: { stats: null, timeline: [] },
          methodology: {
            status: 'UNAVAILABLE',
            reason: '공식 연도별 자산 매칭이 완료되어야 신규 취득 자산을 표시할 수 있습니다.',
            fabricatedValues: false
          }
        });
      }
      const totalNewCapital = movements.reduce((sum, item) => sum + item.amountChange, 0n);
      const timeline = movements.map(item => ({
        id: item.id,
        category: '신규취득',
        detailType: item.action,
        address: item.description,
        valuation: item.amountChange,
        confidence: item.confidence,
        sourceAssetKey: item.sourceAssetKey,
        official: item.official
      }));
      return res.json({
        success: true,
        data: serialize({
          stats: {
            totalNewCapital,
            acquisitionCount: movements.length,
            averageAssetSize: totalNewCapital / BigInt(movements.length)
          },
          timeline
        }),
        methodology: {
          status: 'OFFICIAL_YEARLY_ASSET_MATCH',
          formula: '현재 연도에만 존재하며 정규화 자산키로 검증된 자산',
          fabricatedValues: false
        }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: String(error) });
    }
  }

  let whereClause = {};
  if (type === 'real-estate') {
    if (filter === 'land') whereClause = { category: '토지' };
    else if (filter === 'building') whereClause = { category: '건물' };
    else if (filter === 'apt') whereClause = { category: '건물', address: { contains: '아파트' } };
    else if (filter === 'commercial') whereClause = { category: '건물', NOT: { address: { contains: '아파트' } } };
    else if (filter === 'gangnam') whereClause = { category: { in: ['건물', '토지'] }, OR: [{ address: { contains: '강남구' } }, { address: { contains: '서초구' } }, { address: { contains: '송파구' } }] };
    else if (filter === 'luxury') whereClause = { category: { in: ['건물', '토지'] }, valuation: { gte: 3000000000 } };
    else if (filter === 'second_home') whereClause = { category: { in: ['건물', '토지'] }, OR: [{ address: { contains: '제주' } }, { address: { contains: '강원' } }] };
    else whereClause = { category: { in: ['건물', '토지'] } };
  } else if (type === 'securities') {
    whereClause = { category: '증권' };
  } else if (type === 'virtual-assets') {
    whereClause = { category: '가상자산' };
  }

  try {
    // 알고리즘 최적화: 수만 개의 자산을 메모리에 올리지 않고, DB 단에서 GroupBy + Sum 처리
    const grouped = await prisma.asset.groupBy({
      by: ['officialId'],
      where: whereClause,
      _sum: { valuation: true },
      orderBy: { _sum: { valuation: 'desc' } },
      take: 50
    });

    const officialIds = grouped.map(g => g.officialId);
    
    // Top 50명의 기본 정보 및 상위 자산 5개 함께 조회
    const officials = await prisma.official.findMany({
      where: { id: { in: officialIds } },
      select: { 
        id: true, name: true, agency: true, title: true,
        assets: {
          where: whereClause,
          orderBy: { valuation: 'desc' },
          take: 5
        }
      }
    });

    // 병합 및 직렬화
    const ranked = grouped.map(g => {
      const off = officials.find(o => o.id === g.officialId);
      return {
        ...off,
        categoryTotal: g._sum.valuation
      };
    });

    // 전체 통계 계산
    const totalVolume = grouped.reduce((acc, curr) => acc + Number(curr._sum.valuation || 0), 0);
    const officialsCount = grouped.length;
    
    const stats = {
      totalVolume,
      averageVolume: officialsCount > 0 ? totalVolume / officialsCount : 0,
      officialsCount
    };

    res.json({ success: true, data: serialize(ranked), stats: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 5. 맵 데이터 (실제 좌표가 있는 부동산 500개 샘플링)
app.get('/api/map', async (req, res) => {
  try {
    const properties = await prisma.asset.findMany({
      where: {
        category: { in: ['건물', '토지'] },
        latitude: { not: null },
        longitude: { not: null },
        valuation: { gt: 0 }
      },
      take: 500, // For performance map rendering limit
      orderBy: { valuation: 'desc' },
      include: { official: { select: { id: true, name: true, agency: true } } }
    });
    res.json({ success: true, data: serialize(properties) });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// [신규] 원시 데이터 재가공(Edge) API: 공직자 선호 주식 종목 추출
app.get('/api/stats/stocks', async (req, res) => {
  try {
    const assets = await prisma.asset.findMany({
      where: { category: '증권', address: { not: null } },
      select: { address: true, valuation: true, official: { select: { name: true } } }
    });
    
    const stockMap = {};
    assets.forEach(a => {
      let cleanText = a.address.replace(/(\d)\s*[\n\r]+\s*(\d)/g, '$1,$2');
      const items = cleanText.split(/[\n\r]+|,\s+/);
      items.forEach(item => {
        let name = item.trim();
        name = name.replace(/[0-9,]+\s*(주|좌|구|달러|원|만원).*$/, '');
        name = name.replace(/^(상장주식|비상장주식|주식|해외주식|국내주식|증권|채권|회사채|국채|지방채)\s+/, '');
        name = name.replace(/\([a-zA-Z\s]+\)/, '');
        name = name.trim();
        
        if (name.length > 0 && name !== '기타 종목' && name !== '-') {
          if (!stockMap[name]) stockMap[name] = { count: 0, valuation: 0, holders: [] };
          stockMap[name].count += 1;
          stockMap[name].valuation += Number(a.valuation || 0);
          if (a.official) {
            stockMap[name].holders.push({ name: a.official.name, val: Number(a.valuation || 0) });
          }
        }
      });
    });
    
    const sorted = Object.entries(stockMap)
      .map(([name, data]) => {
        const topHolder = data.holders.sort((a, b) => b.val - a.val)[0];
        return { 
          name, 
          count: data.count, 
          valuation: data.valuation,
          topHolder: topHolder ? topHolder.name : '-',
          topHolderVal: topHolder ? topHolder.val : 0
        };
      })
      .sort((a, b) => b.valuation - a.valuation)
      .filter(s => s.valuation > 0 || s.count > 0);
      
    res.json({ success: true, data: sorted });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// [신규] 특정 종목 보유 공직자 리스트 (역추적)
app.get('/api/stats/stocks/:name', async (req, res) => {
  try {
    const stockName = req.params.name;
    const assets = await prisma.asset.findMany({
      where: { category: '증권', address: { contains: stockName } },
      select: { address: true, valuation: true, official: { select: { id: true, name: true, agency: true, title: true } } }
    });

    const holders = [];
    assets.forEach(a => {
      // 파싱해서 정확히 일치하는지 확인 (선택 사항)
      if (a.official) {
        holders.push({
          id: a.official.id,
          name: a.official.name,
          agency: a.official.agency,
          title: a.official.title,
          valuation: Number(a.valuation || 0),
          rawAddress: a.address
        });
      }
    });

    // 사람별로 병합 (동일인이 여러 번 신고한 경우 합산)
    const merged = {};
    holders.forEach(h => {
      if (!merged[h.id]) merged[h.id] = { ...h };
      else merged[h.id].valuation += h.valuation;
    });

    const sortedHolders = Object.values(merged).sort((a, b) => b.valuation - a.valuation);
    res.json({ success: true, data: sortedHolders });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// [신규] 원시 데이터 재가공(Edge) API: 가상자산 종목 추출
app.get('/api/stats/crypto', async (req, res) => {
  try {
    const assets = await prisma.asset.findMany({
      where: { category: '가상자산', address: { not: null } },
      select: { address: true, valuation: true, official: { select: { name: true } } }
    });
    
    const cryptoMap = {};
    assets.forEach(a => {
      let cleanText = a.address.replace(/(\d)\s*[\n\r]+\s*(\d)/g, '$1,$2');
      const items = cleanText.split(/[\n\r]+|,\s+/);
      items.forEach(item => {
        let name = item.trim();
        // 가상자산 정제: "123.45개", "비트코인(BTC) 1.5개" 등
        name = name.replace(/[0-9,.]+\s*(개|주|달러|원|만원|토큰).*$/, '');
        name = name.replace(/\([a-zA-Z0-9\s]+\)/, ''); // (BTC) 등 괄호 티커 제거
        name = name.replace(/^(가상자산|코인|암호화폐)\s+/, '');
        name = name.trim();
        
        if (name.length > 0 && name !== '기타 종목' && name !== '-') {
          if (!cryptoMap[name]) cryptoMap[name] = { count: 0, valuation: 0, holders: [] };
          cryptoMap[name].count += 1;
          cryptoMap[name].valuation += Number(a.valuation || 0);
          if (a.official) {
            cryptoMap[name].holders.push({ name: a.official.name, val: Number(a.valuation || 0) });
          }
        }
      });
    });
    
    const sorted = Object.entries(cryptoMap)
      .map(([name, data]) => {
        const topHolder = data.holders.sort((a, b) => b.val - a.val)[0];
        return { 
          name, 
          count: data.count, 
          valuation: data.valuation,
          topHolder: topHolder ? topHolder.name : '-',
          topHolderVal: topHolder ? topHolder.val : 0
        };
      })
      .sort((a, b) => b.valuation - a.valuation)
      .filter(s => s.valuation > 0 || s.count > 0);
      
    res.json({ success: true, data: sorted });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// [신규] 특정 가상자산 보유 공직자 리스트 (역추적)
app.get('/api/stats/crypto/:name', async (req, res) => {
  try {
    const coinName = req.params.name;
    const assets = await prisma.asset.findMany({
      where: { category: '가상자산', address: { contains: coinName } },
      select: { address: true, valuation: true, official: { select: { id: true, name: true, agency: true, title: true } } }
    });

    const holders = [];
    assets.forEach(a => {
      if (a.official) {
        holders.push({
          id: a.official.id,
          name: a.official.name,
          agency: a.official.agency,
          title: a.official.title,
          valuation: Number(a.valuation || 0),
          rawAddress: a.address
        });
      }
    });

    const merged = {};
    holders.forEach(h => {
      if (!merged[h.id]) merged[h.id] = { ...h };
      else merged[h.id].valuation += h.valuation;
    });

    const sortedHolders = Object.values(merged).sort((a, b) => b.valuation - a.valuation);
    res.json({ success: true, data: sortedHolders });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// [신규] 원시 데이터 재가공(Edge) API: 공직자 선호 부동산 지역 추출
app.get('/api/stats/regions', async (req, res) => {
  try {
    const assets = await prisma.asset.findMany({
      where: { category: { in: ['건물', '토지'] }, address: { not: null } },
      select: { address: true }
    });
    
    const regionMap = {};
    assets.forEach(a => {
      // "서울특별시 강남구 도곡동..." -> "서울특별시 강남구"
      const parts = a.address.trim().split(' ');
      if (parts.length >= 2) {
        const region = `${parts[0]} ${parts[1]}`;
        // 필터링: 이상한 주소 제외
        if (region.includes('시') || region.includes('도') || region.includes('구') || region.includes('군')) {
          regionMap[region] = (regionMap[region] || 0) + 1;
        }
      }
    });
    
    const sorted = Object.entries(regionMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 15);
    res.json({ success: true, data: sorted });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// [신규 독자 알고리즘] K-Whale Alpha Engine (스마트머니 디커플링 & 엣지 엔진)
app.get('/api/alpha-engine', async (req, res) => {
  try {
    // 1. 최상위 1% 부자 100명 (Smart Money) 식별
    const top100 = await prisma.official.findMany({
      orderBy: { netWorth: 'desc' }, take: 100, select: { id: true }
    });
    const top100Ids = top100.map(o => o.id);
    
    // 2. 전체 상장주식 포트폴리오 파싱
    const stocks = await prisma.asset.findMany({
      where: { category: '증권', detailType: '상장주식', address: { not: null } },
      select: { officialId: true, address: true }
    });
    
    const smartMoneyStocks = {};
    const publicStocks = {};
    
    stocks.forEach(a => {
      let cleanText = a.address.replace(/(\d)\s*[\n\r]+\s*(\d)/g, '$1,$2');
      const items = cleanText.split(/[\n\r]+|,\s+/);
      items.forEach(item => {
        const match = item.trim().match(/(.+?)\s+([0-9,\.]+)주/);
        if (match) {
          const name = match[1].trim();
          if (name.length < 2) return;
          if (top100Ids.includes(a.officialId)) {
            smartMoneyStocks[name] = (smartMoneyStocks[name] || 0) + 1;
          } else {
            publicStocks[name] = (publicStocks[name] || 0) + 1;
          }
        }
      });
    });

    const alphaStocks = Object.keys(smartMoneyStocks).map(name => {
      const sRate = smartMoneyStocks[name] / 100;
      const pRate = (publicStocks[name] || 1) / 6885;
      const alpha = sRate / pRate;
      return { 
        name, 
        smartHolders: smartMoneyStocks[name], 
        publicHolders: publicStocks[name] || 0, 
        alphaScore: parseFloat(alpha.toFixed(1)) 
      };
    }).filter(s => s.smartHolders >= 3)
      .sort((a, b) => b.alphaScore - a.alphaScore)
      .slice(0, 5); // 5개로 확장

    // 3. 부동산 알파 스코어 (부자들의 은밀한 핫스팟)
    const realEstates = await prisma.asset.findMany({
      where: { category: { in: ['건물', '토지'] }, address: { not: null } },
      select: { officialId: true, address: true }
    });
    
    const smartMoneyRegions = {};
    const publicRegions = {};
    
    realEstates.forEach(a => {
      const parts = a.address.trim().split(' ');
      if (parts.length >= 3) {
        // "서울특별시 강남구 압구정동"
        const region = `${parts[0]} ${parts[1]} ${parts[2]}`;
        if (region.includes('시') || region.includes('도') || region.includes('구') || region.includes('군')) {
          if (top100Ids.includes(a.officialId)) {
            smartMoneyRegions[region] = (smartMoneyRegions[region] || 0) + 1;
          } else {
            publicRegions[region] = (publicRegions[region] || 0) + 1;
          }
        }
      }
    });

    const alphaRegions = Object.keys(smartMoneyRegions).map(name => {
      const sRate = smartMoneyRegions[name] / 100;
      const pRate = (publicRegions[name] || 1) / 6885;
      const alpha = sRate / pRate;
      return { 
        name, 
        smartHolders: smartMoneyRegions[name], 
        publicHolders: publicRegions[name] || 0, 
        alphaScore: parseFloat(alpha.toFixed(1)) 
      };
    }).filter(s => s.smartHolders >= 2) // 최소 2명
      .sort((a, b) => b.alphaScore - a.alphaScore)
      .slice(0, 5);

    // 4. 서학개미 챔피언 (In-Memory Processing for extreme speed)
    const usStocksKeywords = ['애플', '테슬라', '엔비디아', '마이크로소프트', '알파벳', '아마존', 'QQQ', 'SPY'];
    const usBullIds = new Set();
    
    stocks.forEach(a => {
      const addr = a.address || '';
      for (let k of usStocksKeywords) {
        // 단어 경계를 사용하여 '애플리케이션' 등 오탐지 방지
        const regex = new RegExp(`(?:^|\\s|,|\\(|"|')${k}(?:\\s|\\)|"|'|주|$)`);
        if (regex.test(addr)) {
          usBullIds.add(a.officialId);
          break;
        }
      }
    });

    const usStockBulls = await prisma.official.findMany({
      where: { id: { in: Array.from(usBullIds) } },
      select: { id: true, name: true, agency: true, netWorth: true },
      orderBy: { netWorth: 'desc' },
      take: 3
    });

    // 5. 슈퍼카 콜렉터 (최고가 자동차 보유)
    // 카테고리가 '자동차'가 아니라 '동산'이며 detailType이 '자동차'임
    const luxuryCars = await prisma.asset.findMany({
      where: { category: '동산', detailType: '자동차' },
      select: { officialId: true, valuation: true, address: true }
    });
    const carValuations = {};
    luxuryCars.forEach(c => { 
      // 페라리, 포르쉐, 벤츠 등 특정 키워드에 가중치를 줄 수도 있지만, 일단 가액 기준으로 정렬
      carValuations[c.officialId] = Math.max(carValuations[c.officialId] || 0, Number(c.valuation)); 
    });
    const topCarIds = Object.entries(carValuations).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]);
    const superCarOfficials = await prisma.official.findMany({ where: { id: { in: topCarIds } }, select: { id: true, name: true, agency: true }});
    const supercars = superCarOfficials.map(p => ({ ...p, valuation: carValuations[p.id] })).sort((a,b)=>b.valuation - a.valuation);

    // 6. VIP 회원권 큰손 (골프/헬스 등)
    const memberships = await prisma.asset.groupBy({
      by: ['officialId'], where: { category: { contains: '회원권' } }, _sum: { valuation: true }, orderBy: { _sum: { valuation: 'desc' } }, take: 3
    });
    const vipOfficials = await prisma.official.findMany({ where: { id: { in: memberships.map(m=>m.officialId) } }, select: { id: true, name: true, agency: true }});
    const vipMembers = memberships.map(m => ({ ...vipOfficials.find(o => o.id === m.officialId), valuation: m._sum.valuation }));

    // 7. 엔젤 투자자 (비상장주식 큰손)
    const unlistedStocks = await prisma.asset.groupBy({
      by: ['officialId'], where: { category: '증권', detailType: { contains: '비상장주식' } }, _sum: { valuation: true }, orderBy: { _sum: { valuation: 'desc' } }, take: 3
    });
    const angelOfficials = await prisma.official.findMany({ where: { id: { in: unlistedStocks.map(u=>u.officialId) } }, select: { id: true, name: true, agency: true }});
    const angelInvestors = unlistedStocks.map(u => ({ ...angelOfficials.find(o => o.id === u.officialId), valuation: u._sum.valuation }));

    // 8. 국채/채권 고래 
    // DB의 '채권' 카테고리 고래 + 증권 내 국채 키워드 보유자
    const bonds = await prisma.asset.groupBy({
      by: ['officialId'], where: { category: '채권' }, _sum: { valuation: true }, orderBy: { _sum: { valuation: 'desc' } }, take: 3
    });
    const bondOfficials = await prisma.official.findMany({ where: { id: { in: bonds.map(b=>b.officialId) } }, select: { id: true, name: true, agency: true }});
    const bondWhales = bonds.map(b => ({ ...bondOfficials.find(o => o.id === b.officialId), valuation: b._sum.valuation }));

    // 9. 진짜 부자들의 취미 (금/보석/예술품)
    // DB 카테고리명 정확히 매칭: '금 및 백금', '보석류', '골동품 및 예술품'
    const precious = await prisma.asset.groupBy({
      by: ['officialId'], where: { category: { in: ['금 및 백금', '보석류', '골동품 및 예술품'] } }, _sum: { valuation: true }, orderBy: { _sum: { valuation: 'desc' } }, take: 3
    });
    const preciousOfficials = await prisma.official.findMany({ where: { id: { in: precious.map(p=>p.officialId) } }, select: { id: true, name: true, agency: true }});
    const preciousCollectors = precious.map(p => ({ ...preciousOfficials.find(o => o.id === p.officialId), valuation: p._sum.valuation }));

    // 10. 외화/달러 고래 (환차익 노리는 스마트머니)
    // 예금 및 증권(외화RP 등)에서 USD, 외화 키워드 추출
    const fxAssets = await prisma.asset.findMany({
      where: { 
        OR: [
          { category: '예금', address: { contains: 'USD' } },
          { category: '예금', address: { contains: '달러' } },
          { category: '예금', address: { contains: '외화' } },
          { category: '증권', address: { contains: 'USD' } }
        ]
      }, 
      select: { officialId: true, valuation: true }
    });
    const fxIds = {};
    fxAssets.forEach(d => { fxIds[d.officialId] = (fxIds[d.officialId] || 0) + Number(d.valuation); });
    const topFxIds = Object.entries(fxIds).sort((a,b)=>b[1]-a[1]).slice(0,3);
    const fxOfficials = await prisma.official.findMany({ where: { id: { in: topFxIds.map(f=>f[0]) } }, select: { id: true, name: true, agency: true }});
    const fxWhales = topFxIds.map(f => ({ ...fxOfficials.find(o => o.id === f[0]), valuation: f[1] }));
      
    res.json({ success: true, data: { 
      alphaStocks, 
      alphaRegions, 
      usStockBulls: serialize(usStockBulls),
      supercars: serialize(supercars),
      vipMembers: serialize(vipMembers),
      angelInvestors: serialize(angelInvestors),
      bondWhales: serialize(bondWhales),
      preciousCollectors: serialize(preciousCollectors),
      fxWhales: serialize(fxWhales)
    } });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});



app.listen(PORT, () => console.log(`🚀 K-Whale Backend API is running on http://localhost:${PORT}`));
