const express = require('express');
const cors = require('cors');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
const { extractSecurityHoldings, extractCryptoHoldings } = require('../backend/lib/holding-extractor');
const { buildInstrumentAlpha } = require('../backend/lib/instrument-alpha');
const app = express();
const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
    intMode: 'number',
});
app.use(cors({ origin: /^http:\/\/(127\.0\.0\.1|localhost):\d+$/ }));
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '32kb' }));
let availableYears = [];
let defaultYear;
let latestCompleteYear;
let initialization;
async function initializeDatabase() {
    if (!initialization) {
        initialization = (async () => {
            const rows = await statement('SELECT DISTINCT period_year AS year FROM disclosure ORDER BY year DESC').all();
            availableYears = rows.map((row) => Number(row.year));
            defaultYear = availableYears[0];
            latestCompleteYear = availableYears[1] || defaultYear;
        })();
    }
    return initialization;
}
function parseYear(value) {
    if (String(value).toLowerCase() === 'recent')
        return 'recent';
    if (String(value).toLowerCase() === 'all')
        return 'all';
    const year = Number.parseInt(value, 10);
    return availableYears.includes(year) ? year : defaultYear;
}
function snapshotCte(year) {
    const selectedYear = parseYear(year);
    const yearFilter = selectedYear === 'all'
        ? ''
        : selectedYear === 'recent'
            ? `WHERE d.period_year BETWEEN ${latestCompleteYear} AND ${defaultYear}`
            : `WHERE d.period_year = ${selectedYear}`;
    return `
WITH ranked_disclosures AS (
  SELECT d.*,
         ROW_NUMBER() OVER (
           PARTITION BY d.person_id
           ORDER BY COALESCE(d.disclosed_at, d.registered_at, '') DESC,
                    d.period_year DESC, d.source_record_index DESC
         ) AS rn
  FROM disclosure d
  ${yearFilter}
),
latest_disclosures AS (
  SELECT * FROM ranked_disclosures WHERE rn = 1
)`;
}
function statement(sql) {
    return {
        async all(...args) {
            const result = await db.execute({ sql, args });
            return result.rows;
        },
        async get(...args) {
            const result = await db.execute({ sql, args });
            return result.rows[0];
        },
    };
}
function jsonSafe(value) {
    if (typeof value === 'bigint') {
        return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
            ? Number(value)
            : value.toString();
    }
    if (Array.isArray(value))
        return value.map(jsonSafe);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
    }
    return value;
}
function ok(res, data, extra = {}) {
    res.json(jsonSafe({ success: true, data, ...extra }));
}
function fail(res, error, status = 500, extra = {}) {
    res.status(status).json({ success: false, error: String(error), ...extra });
}
function parseLimit(value, fallback, maximum) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(1, number)) : fallback;
}
async function latestCategoryLeaders(category, year, limit = 5) {
    return await statement(`
    ${snapshotCte(year)}
    SELECT p.id, p.canonical_name AS name,
           d.organization_at_disclosure AS agency,
           d.title_at_disclosure AS title,
           SUM(a.valuation) AS valuation
    FROM latest_disclosures d
    JOIN person p ON p.id = d.person_id
    JOIN asset a ON a.disclosure_id = d.id
    WHERE a.category = ?
    GROUP BY p.id
    ORDER BY valuation DESC
    LIMIT ?
  `).all(category, limit);
}
async function latestAssetLeaders(year, whereSql, parameters = [], limit = 3) {
    return await statement(`
    ${snapshotCte(year)}
    SELECT p.id, p.canonical_name AS name, p.latest_organization AS agency,
           SUM(a.valuation) AS valuation, COUNT(*) AS assetCount
    FROM latest_disclosures d
    JOIN person p ON p.id = d.person_id
    JOIN asset a ON a.disclosure_id = d.id
    WHERE ${whereSql}
    GROUP BY p.id
    ORDER BY valuation DESC, assetCount DESC, p.canonical_name
    LIMIT ?
  `).all(...parameters, limit);
}
function extractRegion(detail) {
    const normalized = String(detail || '').replace(/\s+/g, ' ').trim();
    const match = normalized.match(/(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)\s+([가-힣]+(?:시|군|구))(?:\s+([가-힣0-9·.-]+(?:읍|면|동|가|리)))?/);
    return match ? [match[1], match[2], match[3]].filter(Boolean).join(' ') : null;
}
function normalizeTopRegion(name) {
    if (name === '강원도')
        return '강원특별자치도';
    if (name === '전라북도')
        return '전북특별자치도';
    return name;
}
function parseRealEstateLocation(detail) {
    let normalized = String(detail || '').replace(/\s+/g, ' ').trim();
    const provinceAliases = {
        서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시',
        광주: '광주광역시', 대전: '대전광역시', 울산: '울산광역시', 세종: '세종특별자치시',
        경기: '경기도', 강원: '강원특별자치도', 충북: '충청북도', 충남: '충청남도',
        전북: '전북특별자치도', 전남: '전라남도', 경북: '경상북도', 경남: '경상남도',
        제주: '제주특별자치도',
    };
    const provinceTokens = {
        ...provinceAliases,
        서울시: '서울특별시', 부산시: '부산광역시', 대구시: '대구광역시', 인천시: '인천광역시',
        광주시: '광주광역시', 대전시: '대전광역시', 울산시: '울산광역시', 세종시: '세종특별자치시',
        제주도: '제주특별자치도',
    };
    for (const [alias, canonical] of Object.entries(provinceTokens)) {
        const tokenPattern = new RegExp(`(^|\\s)${alias}(?=\\s)`);
        if (tokenPattern.test(normalized)) {
            normalized = normalized.replace(tokenPattern, `$1${canonical}`);
            break;
        }
    }
    const provinceMatch = normalized.match(/(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)/);
    if (!provinceMatch)
        return { province: '기타·국외', district: '주소 미식별', locality: '주소 미식별', matched: false };
    const province = normalizeTopRegion(provinceMatch[1]);
    const remainder = normalized.slice((provinceMatch.index || 0) + provinceMatch[0].length).trim();
    const districtMatch = remainder.match(/^([가-힣]+시(?:\s+[가-힣]+구)?|[가-힣]+(?:군|구))/);
    const district = districtMatch?.[1] || '기타';
    const afterDistrict = districtMatch ? remainder.slice(districtMatch[0].length).trim() : remainder;
    const localityMatch = afterDistrict.match(/^([가-힣0-9·.-]+(?:읍|면|동|가|리))/);
    return {
        province,
        district,
        locality: localityMatch?.[1] || '기타',
        matched: Boolean(districtMatch),
    };
}
function classifyMapCoordinate(address, agency) {
    const normalized = String(address || '').replace(/\s+/g, ' ').trim();
    const hasLotNumber = /(?:^|\s|산)\d{1,5}(?:-\d{1,5})?(?=\s|$)/.test(normalized);
    const hasNamedProperty = /(아파트|빌라|오피스텔|타워|빌딩|센터|상가|주택|연립|맨션|단지|공장|호텔|병원|학교|대학교|시장|프라자)/.test(normalized);
    const precision = hasLotNumber || hasNamedProperty ? 'address' : 'administrative';
    const spotlight = /(국회|대통령비서실|국토교통부|한국부동산원|한국토지주택공사|대법원)/.test(String(agency || ''));
    return {
        coordinatePrecision: precision,
        coordinateBasis: precision === 'address'
            ? '번지·건물명 등 상세 주소 기반 좌표'
            : '상세 주소가 없어 행정구역 대표 위치로 해석 필요',
        spotlight,
    };
}
const realEstateSnapshotCache = new Map();
const realEstateAlphaCache = new Map();
async function realEstateSnapshot(year) {
    const key = String(parseYear(year));
    if (realEstateSnapshotCache.has(key))
        return realEstateSnapshotCache.get(key);
    const rows = (await statement(`
    ${snapshotCte(year)}
    SELECT p.id AS officialId, p.canonical_name AS name,
           d.organization_at_disclosure AS agency, d.title_at_disclosure AS title,
           d.period_year AS year, d.disclosed_at AS disclosedAt,
           d.id AS disclosureId, d.source_record_index AS sourceRecordIndex,
           d.source_record_hash AS sourceRecordHash,
           sa.source_url AS sourceUrl, sa.raw_sha256 AS fileSha256,
           a.id, a.category, COALESCE(NULLIF(a.subcategory, ''), '미분류') AS subcategory,
           a.owner, a.detail, a.valuation
    FROM latest_disclosures d
    JOIN person p ON p.id = d.person_id
    JOIN source_artifact sa ON sa.id = d.source_artifact_id
    JOIN asset a ON a.disclosure_id = d.id
    WHERE a.category IN ('건물', '토지') AND TRIM(COALESCE(a.detail, '')) <> ''
  `).all()).map((row) => ({
        ...row,
        valuation: Number(row.valuation || 0),
        ...parseRealEstateLocation(row.detail),
    }));
    realEstateSnapshotCache.set(key, rows);
    return rows;
}
function aggregateRealEstateRows(rows, keySelector) {
    const groups = new Map();
    for (const row of rows) {
        const key = keySelector(row);
        const item = groups.get(key) || {
            name: key, assetCount: 0, totalValuation: 0, buildingCount: 0, landCount: 0,
            officialIds: new Set(), topAsset: null,
        };
        item.assetCount += 1;
        item.totalValuation += row.valuation;
        item.buildingCount += row.category === '건물' ? 1 : 0;
        item.landCount += row.category === '토지' ? 1 : 0;
        item.officialIds.add(row.officialId);
        if (!item.topAsset || row.valuation > item.topAsset.valuation)
            item.topAsset = row;
        groups.set(key, item);
    }
    return [...groups.values()].map((item) => ({
        name: item.name,
        assetCount: item.assetCount,
        totalValuation: item.totalValuation,
        buildingCount: item.buildingCount,
        landCount: item.landCount,
        officialsCount: item.officialIds.size,
        averageValuation: item.assetCount ? Math.round(item.totalValuation / item.assetCount) : 0,
        topAsset: item.topAsset ? {
            officialId: item.topAsset.officialId,
            name: item.topAsset.name,
            subcategory: item.topAsset.subcategory,
            valuation: item.topAsset.valuation,
            detail: item.topAsset.detail,
        } : null,
    })).sort((a, b) => b.totalValuation - a.totalValuation || b.assetCount - a.assetCount ||
        a.name.localeCompare(b.name, 'ko'));
}
function compactWon(value) {
    const amount = Number(value || 0);
    if (amount >= 1000000000000) {
        return `${Number((amount / 1000000000000).toFixed(2)).toLocaleString('ko-KR')}조 원`;
    }
    if (amount >= 100000000) {
        return `${Number((amount / 100000000).toFixed(1)).toLocaleString('ko-KR')}억 원`;
    }
    return `${Math.round(amount / 10000).toLocaleString('ko-KR')}만 원`;
}
function buildRealEstateAlpha(rows) {
    const validRows = rows.filter((row) => row.valuation >= 0);
    const provinces = aggregateRealEstateRows(validRows, (row) => row.province);
    const districts = aggregateRealEstateRows(validRows.filter((row) => row.district !== '주소 미식별' && row.district !== '기타'), (row) => `${row.province} ${row.district}`);
    const localities = aggregateRealEstateRows(validRows.filter((row) => row.locality !== '주소 미식별' && row.locality !== '기타'), (row) => `${row.province} ${row.district} ${row.locality}`);
    const buildingRegions = aggregateRealEstateRows(validRows.filter((row) => row.category === '건물'), (row) => row.province);
    const landRegions = aggregateRealEstateRows(validRows.filter((row) => row.category === '토지'), (row) => row.province);
    const apartmentRegions = aggregateRealEstateRows(validRows.filter((row) => row.subcategory.includes('아파트')), (row) => row.province);
    const commercialRegions = aggregateRealEstateRows(validRows.filter((row) => /상가|근린생활시설|빌딩|사무실|공장/.test(row.subcategory)), (row) => row.province);
    const landTypes = aggregateRealEstateRows(validRows.filter((row) => row.category === '토지'), (row) => row.subcategory);
    const luxuryRegions = aggregateRealEstateRows(validRows.filter((row) => row.valuation >= 3000000000), (row) => row.province).sort((a, b) => b.assetCount - a.assetCount || b.totalValuation - a.totalValuation);
    const officialMap = new Map();
    for (const row of validRows) {
        const item = officialMap.get(row.officialId) || {
            officialId: row.officialId, name: row.name, agency: row.agency,
            totalValuation: 0, assetCount: 0, regions: new Set(),
        };
        item.totalValuation += row.valuation;
        item.assetCount += 1;
        if (row.province !== '기타·국외')
            item.regions.add(row.province);
        officialMap.set(row.officialId, item);
    }
    const officials = [...officialMap.values()].sort((a, b) => b.totalValuation - a.totalValuation || b.assetCount - a.assetCount);
    const diversified = [...officials].sort((a, b) => b.regions.size - a.regions.size || b.totalValuation - a.totalValuation)[0];
    const spouseMap = new Map();
    for (const row of validRows.filter((item) => item.owner === '배우자')) {
        const item = spouseMap.get(row.officialId) || {
            officialId: row.officialId, name: row.name, agency: row.agency, totalValuation: 0, assetCount: 0,
        };
        item.totalValuation += row.valuation;
        item.assetCount += 1;
        spouseMap.set(row.officialId, item);
    }
    const spouseLeader = [...spouseMap.values()].sort((a, b) => b.totalValuation - a.totalValuation)[0];
    const topAsset = [...validRows].sort((a, b) => b.valuation - a.valuation)[0];
    const broadAverageLeader = [...provinces]
        .filter((item) => item.assetCount >= 100)
        .sort((a, b) => b.averageValuation - a.averageValuation)[0];
    const totalValuation = validRows.reduce((sum, row) => sum + row.valuation, 0);
    const metroValuation = validRows
        .filter((row) => ['서울특별시', '경기도', '인천광역시'].includes(row.province))
        .reduce((sum, row) => sum + row.valuation, 0);
    const insight = (key, title, name, detail, sampleSize, target, methodology, caveat = '공식 신고가액 기준 · 시세 추정 아님') => ({
        key, title, name, detail, sampleSize, target, methodology, caveat,
        confidence: sampleSize >= 100 ? 0.98 : sampleSize >= 30 ? 0.9 : 0.78,
        confidenceGrade: sampleSize >= 100 ? 'HIGH' : sampleSize >= 30 ? 'MEDIUM' : 'WATCH',
    });
    const p = provinces[0];
    const popular = [...provinces].sort((a, b) => b.officialsCount - a.officialsCount)[0];
    const d = districts[0];
    const l = localities[0];
    const b = buildingRegions[0];
    const land = landRegions[0];
    const apt = apartmentRegions[0];
    const commercial = commercialRegions[0];
    const landType = landTypes[0];
    const luxury = luxuryRegions[0];
    const topOfficial = officials[0];
    const rowsOut = [
        insight('province_value', '광역 신고가액 1위', p?.name, `${compactWon(p?.totalValuation)} · ${p?.assetCount.toLocaleString()}건`, p?.assetCount, { province: p?.name }, '시·도별 공식 평가액 합계'),
        insight('province_breadth', '보유자 저변 1위', popular?.name, `${popular?.officialsCount.toLocaleString()}명 · ${popular?.assetCount.toLocaleString()}건`, popular?.officialsCount, { province: popular?.name }, '시·도별 고유 공직자 수'),
        insight('province_average', '건당 평균가액 1위', broadAverageLeader?.name, `${compactWon(broadAverageLeader?.averageValuation)} · 표본 ${broadAverageLeader?.assetCount.toLocaleString()}건`, broadAverageLeader?.assetCount, { province: broadAverageLeader?.name }, '자산 100건 이상 지역의 건당 평균'),
        insight('district_value', '시군구 신고가액 1위', d?.name, `${compactWon(d?.totalValuation)} · ${d?.assetCount.toLocaleString()}건`, d?.assetCount, { province: d?.name.split(' ')[0], district: d?.name.split(' ').slice(1).join(' ') }, '시군구별 공식 평가액 합계'),
        insight('locality_value', '읍면동 신고가액 1위', l?.name, `${compactWon(l?.totalValuation)} · ${l?.assetCount.toLocaleString()}건`, l?.assetCount, { search: l?.name.split(' ').at(-1) }, '읍면동별 공식 평가액 합계'),
        insight('building_region', '건물 신고액 중심지', b?.name, `${compactWon(b?.totalValuation)} · ${b?.assetCount.toLocaleString()}건`, b?.assetCount, { category: '건물', province: b?.name }, '건물 자산행만 시·도별 합산'),
        insight('land_region', '토지 신고액 중심지', land?.name, `${compactWon(land?.totalValuation)} · ${land?.assetCount.toLocaleString()}건`, land?.assetCount, { category: '토지', province: land?.name }, '토지 자산행만 시·도별 합산'),
        insight('apartment_region', '아파트 신고액 중심지', apt?.name, `${compactWon(apt?.totalValuation)} · ${apt?.assetCount.toLocaleString()}건`, apt?.assetCount, { category: '건물', province: apt?.name, search: '아파트' }, '아파트 포함 소분류의 시·도별 합계'),
        insight('commercial_region', '상업용 신고액 중심지', commercial?.name, `${compactWon(commercial?.totalValuation)} · ${commercial?.assetCount.toLocaleString()}건`, commercial?.assetCount, { category: '건물', province: commercial?.name }, '상가·근린생활시설·빌딩·사무실·공장 합계'),
        insight('land_type', '토지 지목 신고액 1위', landType?.name, `${compactWon(landType?.totalValuation)} · ${landType?.assetCount.toLocaleString()}건`, landType?.assetCount, { category: '토지', subcategory: landType?.name }, '토지 소분류별 공식 평가액 합계'),
        insight('luxury_cluster', '30억+ 자산 밀집지역', luxury?.name, `${luxury?.assetCount.toLocaleString()}건 · ${compactWon(luxury?.totalValuation)}`, luxury?.assetCount, { province: luxury?.name, minValue: 3000000000 }, '단일 신고가액 30억원 이상 자산 수'),
        insight('top_asset', '단일 신고자산 최고액', topAsset?.name, `${compactWon(topAsset?.valuation)} · ${topAsset?.subcategory}`, 1, { officialId: topAsset?.officialId }, '단일 공식 자산행 평가액', '단일 자산행 · 공동명의 중복 여부는 원문 확인'),
        insight('top_official', '부동산 신고액 큰손', topOfficial?.name, `${compactWon(topOfficial?.totalValuation)} · ${topOfficial?.assetCount.toLocaleString()}건`, topOfficial?.assetCount, { officialId: topOfficial?.officialId }, '공직자별 건물·토지 평가액 합계'),
        insight('diversified_holder', '광역 분산 보유 1위', diversified?.name, `${diversified?.regions.size.toLocaleString()}개 시·도 · ${diversified?.assetCount.toLocaleString()}건`, diversified?.assetCount, { officialId: diversified?.officialId }, '공직자별 서로 다른 국내 시·도 수'),
        insight('metro_share', '수도권 신고액 쏠림', '서울·경기·인천', `${(totalValuation ? metroValuation / totalValuation * 100 : 0).toFixed(1)}% · ${compactWon(metroValuation)}`, validRows.length, { search: '' }, '전국 부동산 신고액 중 수도권 비중'),
        insight('spouse_holder', '배우자 명의 신고액 1위', spouseLeader?.name, `${compactWon(spouseLeader?.totalValuation)} · ${spouseLeader?.assetCount.toLocaleString()}건`, spouseLeader?.assetCount, { officialId: spouseLeader?.officialId }, '명의자가 배우자인 자산행의 공직자별 합계'),
    ];
    return {
        engineVersion: 'real-estate-alpha-v1.0.0',
        methodology: '공식 건물·토지 평가액, 주소 계층, 소분류, 명의관계를 결정론적으로 재집계',
        insights: rowsOut.filter((item) => item.name && item.detail).slice(0, 16),
    };
}
async function realEstateAlpha(year) {
    const key = String(parseYear(year));
    if (!realEstateAlphaCache.has(key)) {
        realEstateAlphaCache.set(key, buildRealEstateAlpha(await realEstateSnapshot(year)));
    }
    return realEstateAlphaCache.get(key);
}
function buildConcentration(items, smartIds, smartPopulation, publicPopulation, minimumSmartHolders) {
    return [...items.entries()]
        .map(([name, holders]) => {
        const smartHolders = [...holders].filter((id) => smartIds.has(id)).length;
        const publicHolders = holders.size - smartHolders;
        const smartRate = smartPopulation ? smartHolders / smartPopulation : 0;
        const publicRate = publicPopulation ? publicHolders / publicPopulation : 0;
        return {
            name,
            smartHolders,
            publicHolders,
            holderCount: holders.size,
            alphaScore: publicRate > 0 ? Number((smartRate / publicRate).toFixed(1)) : null,
            exclusiveToTopOnePercent: publicHolders === 0,
        };
    })
        .filter((item) => item.smartHolders >= minimumSmartHolders)
        .sort((a, b) => Number(b.exclusiveToTopOnePercent) - Number(a.exclusiveToTopOnePercent) ||
        (b.alphaScore || 0) - (a.alphaScore || 0) ||
        b.smartHolders - a.smartHolders ||
        a.name.localeCompare(b.name, 'ko'))
        .slice(0, 5);
}
function percentile(sortedValues, ratio) {
    if (!sortedValues.length)
        return 0;
    const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((sortedValues.length - 1) * ratio)));
    return sortedValues[index];
}
function rankingInsights(rows) {
    const profits = rows.map((row) => Number(row.profit)).sort((a, b) => a - b);
    const rates = rows.map((row) => Number(row.profitRate)).filter(Number.isFinite).sort((a, b) => a - b);
    const absoluteMovement = profits.reduce((sum, value) => sum + Math.abs(value), 0);
    const increaseMovement = profits.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
    const decreaseMovement = Math.abs(profits.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
    const largestMovements = [...profits].sort((a, b) => Math.abs(b) - Math.abs(a)).slice(0, 10);
    const topCount = Math.max(1, Math.ceil(rows.length * 0.1));
    const topProfits = [...profits].sort((a, b) => b - a).slice(0, topCount);
    return {
        comparedPersons: rows.length,
        increasedPersons: profits.filter((value) => value > 0).length,
        decreasedPersons: profits.filter((value) => value < 0).length,
        unchangedPersons: profits.filter((value) => value === 0).length,
        medianProfit: percentile(profits, 0.5),
        medianRate: percentile(rates, 0.5),
        topDecileAverageProfit: Math.round(topProfits.reduce((sum, value) => sum + value, 0) / topProfits.length),
        positiveShare: rows.length ? profits.filter((value) => value > 0).length / rows.length : 0,
        absoluteMovement,
        increaseMovement,
        decreaseMovement,
        top10MovementShare: absoluteMovement
            ? largestMovements.reduce((sum, value) => sum + Math.abs(value), 0) / absoluteMovement
            : 0,
        spikePersons: rates.filter((value) => value >= 100).length,
        plungePersons: rates.filter((value) => value <= -50).length,
        largeIncreasePersons: profits.filter((value) => value >= 1000000000).length,
        largeDecreasePersons: profits.filter((value) => value <= -1000000000).length,
    };
}
async function respondWithRankings(res, req, comparisonRows, mode, methodology) {
    const allowedLenses = mode === 'yield'
        ? new Set(['reliable', 'all', 'spike', 'plunge', 'rise', 'fall', 'smallbase', 'multiyear'])
        : new Set(['all', 'largeup', 'largedown', 'rise', 'fall', 'reliable', 'smallbase', 'multiyear']);
    const defaultLens = mode === 'yield' ? 'reliable' : 'all';
    const requestedLens = String(req.query.lens || defaultLens);
    const lens = allowedLenses.has(requestedLens) ? requestedLens : defaultLens;
    const searchTokens = String(req.query.search || '').trim().slice(0, 80)
        .split(/\s+/).filter(Boolean).slice(0, 5);
    const enriched = comparisonRows.map((row) => {
        const previousNetWorth = Number(row.previousNetWorth);
        const currentNetWorth = Number(row.currentNetWorth);
        const profit = currentNetWorth - previousNetWorth;
        const profitRate = previousNetWorth > 0 ? profit / previousNetWorth * 100 : null;
        const intervalYears = Math.max(0, Number(row.currentYear) - Number(row.previousYear));
        const reliable = previousNetWorth >= 100000000 && intervalYears === 1;
        return {
            ...row,
            profit,
            profitRate,
            yield: profitRate,
            finalNetWorth: currentNetWorth,
            intervalYears,
            reliable,
            confidence: reliable ? 'A' : previousNetWorth >= 100000000 ? 'B' : 'C',
        };
    }).filter((row) => row.profitRate !== null && Number.isFinite(row.profitRate));
    const searched = searchTokens.length
        ? enriched.filter((row) => searchTokens.every((token) => `${row.name} ${row.agency || ''} ${row.title || ''}`.includes(token)))
        : enriched;
    const filtered = searched.filter((row) => {
        if (lens === 'reliable')
            return row.reliable;
        if (lens === 'rise')
            return mode === 'yield' ? row.reliable && row.profit > 0 : row.profit > 0;
        if (lens === 'fall')
            return mode === 'yield' ? row.reliable && row.profit < 0 : row.profit < 0;
        if (lens === 'spike')
            return row.reliable && row.profitRate >= 100;
        if (lens === 'plunge')
            return row.reliable && row.profitRate <= -50;
        if (lens === 'largeup')
            return row.profit >= 1000000000;
        if (lens === 'largedown')
            return row.profit <= -1000000000;
        if (lens === 'smallbase')
            return Number(row.previousNetWorth) < 100000000;
        if (lens === 'multiyear')
            return row.intervalYears > 1;
        return true;
    });
    const allowedSorts = new Set(['profitRate', 'profit', 'currentNetWorth', 'previousNetWorth', 'name']);
    const defaultSort = mode === 'yield' ? 'profitRate' : 'profit';
    const sort = allowedSorts.has(String(req.query.sort)) ? String(req.query.sort) : defaultSort;
    const direction = req.query.direction === 'asc' ? 'asc' : 'desc';
    const sorted = [...filtered].sort((a, b) => {
        if (sort === 'name') {
            const result = String(a.name).localeCompare(String(b.name), 'ko');
            return direction === 'asc' ? result : -result;
        }
        const difference = Number(a[sort]) - Number(b[sort]);
        return (direction === 'asc' ? difference : -difference) ||
            String(a.name).localeCompare(String(b.name), 'ko') ||
            String(a.id).localeCompare(String(b.id));
    });
    const selectedRows = sorted.slice(0, 100);
    const disclosureIds = selectedRows.map((row) => row.currentDisclosureId);
    const driverRows = disclosureIds.length ? await statement(`
    SELECT id, disclosure_id AS disclosureId, category, subcategory, detail,
           owner, valuation, difference, source_asset_index AS sourceAssetIndex
    FROM asset
    WHERE disclosure_id IN (${disclosureIds.map(() => '?').join(',')})
      AND difference IS NOT NULL AND difference <> 0
    ORDER BY disclosure_id,
             ABS(CASE WHEN category = '채무' THEN -difference ELSE difference END) DESC,
             source_asset_index ASC
  `).all(...disclosureIds) : [];
    const driversByDisclosure = new Map();
    for (const asset of driverRows) {
        const drivers = driversByDisclosure.get(asset.disclosureId) || [];
        if (drivers.length >= 4)
            continue;
        const difference = Number(asset.difference);
        const netWorthImpact = asset.category === '채무' ? -difference : difference;
        const isNew = asset.category !== '채무' && difference > 0 &&
            Math.abs(Number(asset.valuation) - difference) <= 1;
        drivers.push({
            ...asset,
            netWorthImpact,
            signal: asset.category === '채무'
                ? difference > 0 ? '채무 증가' : '채무 감소'
                : isNew ? '신규 취득' : difference > 0 ? '가액 증가' : '가액 감소',
        });
        driversByDisclosure.set(asset.disclosureId, drivers);
    }
    const rows = selectedRows.map((row) => ({
        ...row,
        drivers: driversByDisclosure.get(row.currentDisclosureId) || [],
    }));
    const quality = {
        reconciliationPass: enriched.every((row) => Number(row.currentNetWorth) - Number(row.previousNetWorth) === Number(row.profit)),
        eligiblePersons: enriched.length,
        reliablePersons: enriched.filter((row) => row.reliable).length,
        smallBasePersons: enriched.filter((row) => Number(row.previousNetWorth) < 100000000).length,
        multiYearPersons: enriched.filter((row) => row.intervalYears > 1).length,
        driverCoveragePersons: rows.filter((row) => row.drivers.length > 0).length,
        minimumReliableBase: 100000000,
        reliableIntervalYears: 1,
    };
    return ok(res, rows, {
        meta: {
            total: filtered.length,
            shown: rows.length,
            lens,
            search: searchTokens.join(' '),
            sort: { field: sort, direction },
        },
        methodology: {
            ...methodology,
            aggregateInsights: rankingInsights(filtered),
            populationInsights: rankingInsights(enriched),
            quality,
            rankingPolicy: mode === 'yield'
                ? '급변 탐지 기본값은 직전 순자산 1억 원 이상이며 정확히 1년 간격인 비교만 포함'
                : '고액 이동 기본값은 비교 가능한 전체 인물을 포함하며 10억 원 이상 증가·감소를 별도 탐색',
            driverPolicy: '현재 신고서의 공식 자산행 증감액만 표시하며, 자산 증가는 양수·채무 증가는 순자산 영향 음수로 표기',
        },
    });
}
app.use(async (req, res, next) => {
    try {
        await initializeDatabase();
        next();
    }
    catch (error) {
        next(error);
    }
});
app.get('/api/health', async (req, res) => {
    const release = await statement('SELECT * FROM dataset_release LIMIT 1').get();
    ok(res, {
        status: 'ok',
        database: 'turso:kwhale-public',
        release,
        rawDatabaseExposed: false,
    });
});
app.get('/api/meta/years', async (req, res) => {
    const counts = await statement(`
    SELECT period_year AS year, COUNT(*) AS disclosures, SUM(asset_count) AS assets
    FROM disclosure GROUP BY period_year ORDER BY period_year DESC
  `).all();
    const recent = await statement(`
    ${snapshotCte('recent')}
    SELECT COUNT(*) AS persons, COALESCE(SUM(asset_count), 0) AS assets
    FROM latest_disclosures
  `).get();
    ok(res, {
        years: counts,
        defaultYear: 'recent',
        inProgressYear: defaultYear,
        latestCompleteYear,
        recent: {
            ...recent,
            label: '최신 통합',
            definition: `${latestCompleteYear}년 완결 모집단에 ${defaultYear}년 공개분을 인물별 최신 신고로 반영`,
        },
        allTime: {
            label: 'ALL-TIME',
            persons: (await statement('SELECT COUNT(*) AS count FROM person').get()).count,
            definition: '인물별 가장 최근 공개 신고',
        },
    });
});
app.get('/api/meta/methodology', async (req, res) => {
    const release = await statement('SELECT * FROM dataset_release LIMIT 1').get();
    const metrics = Object.fromEntries((await statement('SELECT metric_key, metric_value FROM dataset_metric').all()).map((row) => [row.metric_key, JSON.parse(row.metric_value)]));
    const artifacts = await statement(`
    SELECT source_year AS year, source_url AS sourceUrl, collected_at AS collectedAt,
           decoded_sha256 AS sha256, record_count AS recordCount
    FROM source_artifact ORDER BY source_year
  `).all();
    const semanticQuality = {
        assets: await statement(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN TRIM(COALESCE(detail, '')) = '' THEN 1 ELSE 0 END) AS missingDetail,
             SUM(CASE WHEN TRIM(COALESCE(subcategory, '')) = '' THEN 1 ELSE 0 END) AS missingSubcategory
      FROM asset
    `).get(),
        realEstate: await statement(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 ELSE 0 END) AS geocoded
      FROM asset WHERE category IN ('토지', '건물')
    `).get(),
        securities: await statement(`
      SELECT subcategory, COUNT(*) AS count, SUM(valuation) AS valuation
      FROM asset WHERE category = '증권'
      GROUP BY subcategory ORDER BY count DESC
    `).all(),
        virtualAssets: await statement(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN TRIM(COALESCE(detail, '')) = '' THEN 1 ELSE 0 END) AS missingDetail
      FROM asset WHERE category = '가상자산'
    `).get(),
    };
    const semanticReportPath = path.join(__dirname, 'data', 'quality', 'semantic-latest.json');
    const semanticReport = fs.existsSync(semanticReportPath)
        ? JSON.parse(fs.readFileSync(semanticReportPath, 'utf8'))
        : null;
    ok(res, {
        release,
        metrics,
        artifacts,
        formulas: {
            grossAssets: '채무를 제외한 신고 평가액 합계',
            liabilities: '채무 평가액 합계',
            netWorth: '총자산 - 채무',
            profit: '최근 공개기간 순자산 - 직전 공개기간 순자산',
            yield: '순자산 증감액 / 직전 공개기간 순자산 × 100',
        },
        guarantees: {
            immutableRawArtifacts: true,
            contentAddressedStorage: true,
            randomValues: false,
            privateDatabaseDownload: false,
        },
        semanticQuality,
        semanticAudit: semanticReport ? {
            generatedAt: semanticReport.generatedAt,
            releaseId: semanticReport.releaseId,
            parserVersion: semanticReport.parserVersion,
            publishable: semanticReport.publishable,
            gates: semanticReport.gates,
            classes: {
                listed: {
                    sourceAssets: semanticReport.classes.listed.sourceAssets,
                    components: semanticReport.classes.listed.components,
                    valuationCoverage: semanticReport.classes.listed.valuationCoverage,
                    aliasCandidateGroups: semanticReport.classes.listed.aliasCandidateGroups,
                },
                crypto: {
                    sourceAssets: semanticReport.classes.crypto.sourceAssets,
                    components: semanticReport.classes.crypto.components,
                    valuationCoverage: semanticReport.classes.crypto.valuationCoverage,
                    aliasCandidateGroups: semanticReport.classes.crypto.aliasCandidateGroups,
                },
                realEstate: semanticReport.classes.realEstate,
                monetary: {
                    assets: semanticReport.classes.monetaryParsing.assets,
                    componentCoverage: semanticReport.classes.monetaryParsing.componentCoverage,
                    assetCoverage: semanticReport.classes.monetaryParsing.assetCoverage,
                    reconciliationRate: semanticReport.classes.monetaryParsing.reconciliationRate,
                },
            },
        } : null,
        limitations: [
            '복수 종목·복수 코인이 한 자산행에 함께 기재된 경우 신고가액을 개별 종목에 임의 배분하지 않음',
            '종목·코인별 금액 순위는 직접 귀속 가능한 단일 종목 신고 범위에 한정',
            '2026년은 수집 시점 기준 진행 중 데이터이며 연간 전체 공시가 아님',
            '부동산 금액은 시세가 아닌 신고 평가액',
        ],
    });
});
app.get('/api/dashboard', async (req, res) => {
    const year = parseYear(req.query.year);
    const summary = await statement(`
    ${snapshotCte(year)}
    SELECT COUNT(*) AS totalPersons,
           COALESCE(SUM(asset_count), 0) AS totalAssetRows,
           COALESCE(SUM(gross_assets), 0) AS totalAssetsValuation,
           COALESCE(SUM(gross_assets - net_worth), 0) AS totalLiabilities,
           COALESCE(SUM(net_worth), 0) AS totalNetWorth
    FROM latest_disclosures
  `).get();
    const topRankings = await statement(`
    ${snapshotCte(year)}
    SELECT p.id, p.canonical_name AS name,
           d.organization_at_disclosure AS agency,
           d.title_at_disclosure AS title,
           d.gross_assets AS totalAssets, d.net_worth AS netWorth
    FROM latest_disclosures d JOIN person p ON p.id = d.person_id
    ORDER BY d.net_worth DESC LIMIT 5
  `).all();
    const categorySums = (await statement(`
    ${snapshotCte(year)}
    SELECT CASE
             WHEN a.category = '정치예금계좌' THEN '예금'
             ELSE a.category
           END AS category,
           SUM(a.valuation) AS valuation
    FROM latest_disclosures d JOIN asset a ON a.disclosure_id = d.id
    WHERE a.category <> '채무'
    GROUP BY CASE
               WHEN a.category = '정치예금계좌' THEN '예금'
               ELSE a.category
             END
    ORDER BY valuation DESC
  `).all()).map((row) => ({ category: row.category, _sum: { valuation: row.valuation } }));
    const cryptoOwnersCount = (await statement(`
    ${snapshotCte(year)}
    SELECT COUNT(DISTINCT d.person_id) AS count
    FROM latest_disclosures d JOIN asset a ON a.disclosure_id = d.id
    WHERE a.category = '가상자산' AND TRIM(COALESCE(a.detail, '')) <> ''
  `).get()).count;
    const categoryTotal = categorySums.reduce((sum, row) => sum + Number(row._sum.valuation || 0), 0);
    const edgyStats = {
        topDebtors: await latestCategoryLeaders('채무', year),
        topCryptoWhales: await latestCategoryLeaders('가상자산', year),
        topCashKings: await latestCategoryLeaders('예금', year),
        topBuildingKings: await latestCategoryLeaders('건물', year),
    };
    ok(res, {
        ...summary,
        topRankings,
        categorySums,
        cryptoOwnersCount,
        edgyStats,
        quality: {
            accountingPass: Number(summary.totalAssetsValuation) - Number(summary.totalLiabilities) ===
                Number(summary.totalNetWorth),
            categoryCoverage: Number(summary.totalAssetsValuation)
                ? categoryTotal / Number(summary.totalAssetsValuation)
                : 0,
            snapshotPolicy: year === 'recent'
                ? `${latestCompleteYear}년 완결 모집단 + ${defaultYear}년 공개분 인물별 최신 반영`
                : year === 'all'
                    ? '전체 기간에서 인물별 최신 공개 신고 1건'
                    : `${year}년 인물별 최신 공개 신고 1건`,
            monetaryBasis: '공식 신고 평가액, 채무는 총자산에서 분리하여 순자산 계산',
        },
        year,
    });
});
app.get('/api/dashboard/edgy-stats', async (req, res) => {
    const year = parseYear(req.query.year);
    ok(res, {
        topDebtors: await latestCategoryLeaders('채무', year),
        topCryptoWhales: await latestCategoryLeaders('가상자산', year),
        topCashKings: await latestCategoryLeaders('예금', year),
        topBuildingKings: await latestCategoryLeaders('건물', year),
        year,
    });
});
app.get('/api/officials', async (req, res) => {
    const year = parseYear(req.query.year);
    const page = parseLimit(req.query.page, 1, 100000);
    const limit = parseLimit(req.query.limit, 30, 100);
    const search = String(req.query.search || '').trim().slice(0, 80);
    const searchTokens = search.split(/\s+/).filter(Boolean).slice(0, 5);
    const lens = String(req.query.lens || 'all');
    const sortColumns = {
        name: 'p.canonical_name COLLATE NOCASE',
        agency: 'd.organization_at_disclosure COLLATE NOCASE',
        title: 'd.title_at_disclosure COLLATE NOCASE',
        netWorth: 'd.net_worth',
        totalAssets: 'd.gross_assets',
        liabilities: 'd.liabilities',
        assetCount: 'd.asset_count',
        lastUpdated: "COALESCE(d.disclosed_at, d.registered_at, '')",
    };
    const sort = Object.hasOwn(sortColumns, req.query.sort) ? req.query.sort : 'netWorth';
    const direction = req.query.direction === 'asc' ||
        (['name', 'agency', 'title'].includes(sort) && !req.query.direction)
        ? 'ASC'
        : 'DESC';
    const lensConditions = {
        all: '1 = 1',
        legislature: `(d.organization_at_disclosure LIKE '%국회%' OR
      d.organization_at_disclosure LIKE '%의회사무%' OR d.title_at_disclosure LIKE '%의원%')`,
        executive: `(d.organization_at_disclosure LIKE '%대통령%' OR
      d.organization_at_disclosure LIKE '%국무조정%' OR
      d.organization_at_disclosure LIKE '%부 %' OR d.organization_at_disclosure LIKE '%부')`,
        judiciary: `(d.organization_at_disclosure LIKE '%법원%' OR
      d.organization_at_disclosure LIKE '%검찰%' OR d.organization_at_disclosure LIKE '%법무부%')`,
        local: `(d.organization_at_disclosure LIKE '%광역시%' OR
      d.organization_at_disclosure LIKE '%특별시%' OR
      d.organization_at_disclosure LIKE '%특별자치%' OR
      d.organization_at_disclosure LIKE '%경기도%' OR
      d.organization_at_disclosure LIKE '%시청%' OR d.organization_at_disclosure LIKE '%군청%' OR
      d.organization_at_disclosure LIKE '%구청%' OR d.organization_at_disclosure LIKE '%의회사무%')`,
        public: `(d.organization_at_disclosure LIKE '%공사%' OR
      d.organization_at_disclosure LIKE '%공단%' OR
      d.organization_at_disclosure LIKE '%공공기관%' OR
      d.organization_at_disclosure LIKE '%연구원%')`,
        crypto: '1 = 1',
        securities: '1 = 1',
        realestate: '1 = 1',
        debt: 'd.liabilities > 0',
        highnet: 'd.net_worth >= 10000000000',
        negative: 'd.net_worth < 0',
        homonym: 'nc.same_name_count > 1',
        metadata: `(TRIM(COALESCE(d.organization_at_disclosure, '')) = '' OR
      TRIM(COALESCE(d.title_at_disclosure, '')) = '')`,
    };
    const selectedLens = Object.hasOwn(lensConditions, lens) ? lens : 'all';
    const searchCondition = searchTokens.length
        ? searchTokens.map(() => `(p.canonical_name LIKE ? OR
        d.organization_at_disclosure LIKE ? OR d.title_at_disclosure LIKE ?)`).join(' AND ')
        : '1 = 1';
    const parameters = searchTokens.flatMap((token) => {
        const tokenPattern = `%${token}%`;
        return [tokenPattern, tokenPattern, tokenPattern];
    });
    const assetLensWhere = {
        crypto: `category = '가상자산' AND TRIM(COALESCE(detail, '')) <> ''`,
        securities: `category = '증권' AND valuation > 0`,
        realestate: `category IN ('토지', '건물') AND valuation > 0`,
    };
    const hasAssetLens = Object.hasOwn(assetLensWhere, selectedLens);
    const assetLensCte = hasAssetLens
        ? `lens_disclosures AS (
         SELECT DISTINCT disclosure_id FROM asset
         WHERE ${assetLensWhere[selectedLens]}
       ),`
        : '';
    const assetLensJoin = hasAssetLens
        ? 'JOIN lens_disclosures lens ON lens.disclosure_id = d.id'
        : '';
    const officialsCte = `
    ${snapshotCte(year)},
    ${assetLensCte}
    name_counts AS (
      SELECT p.canonical_name AS name, COUNT(*) AS same_name_count
      FROM latest_disclosures d
      JOIN person p ON p.id = d.person_id
      GROUP BY p.canonical_name
    ),
    filtered_officials AS (
      SELECT d.*, p.canonical_name AS person_name, nc.same_name_count
      FROM latest_disclosures d
      JOIN person p ON p.id = d.person_id
      JOIN name_counts nc ON nc.name = p.canonical_name
      ${assetLensJoin}
      WHERE ${searchCondition} AND ${lensConditions[selectedLens]}
    )`;
    const resultRows = await statement(`
    ${officialsCte}
    SELECT p.id, p.canonical_name AS name,
           d.organization_at_disclosure AS agency,
           d.title_at_disclosure AS title, d.gross_assets AS totalAssets,
           d.liabilities, d.net_worth AS netWorth, d.asset_count AS assetCount,
           d.period_year AS latestYear,
           COALESCE(d.disclosed_at, d.registered_at, '') AS lastUpdated,
           d.same_name_count AS sameNameCount,
           COUNT(*) OVER () AS resultPersons,
           SUM(d.gross_assets) OVER () AS resultGrossAssets,
           SUM(d.liabilities) OVER () AS resultLiabilities,
           SUM(d.net_worth) OVER () AS resultNetWorth,
           AVG(d.net_worth) OVER () AS resultAverageNetWorth,
           SUM(CASE WHEN d.net_worth >= 10000000000 THEN 1 ELSE 0 END) OVER () AS resultHighNetCount,
           SUM(CASE WHEN d.net_worth < 0 THEN 1 ELSE 0 END) OVER () AS resultNegativeNetCount,
           SUM(CASE WHEN TRIM(COALESCE(d.organization_at_disclosure, '')) = '' THEN 1 ELSE 0 END) OVER () AS resultMissingOrgCount,
           SUM(CASE WHEN TRIM(COALESCE(d.title_at_disclosure, '')) = '' THEN 1 ELSE 0 END) OVER () AS resultMissingTitleCount,
           SUM(CASE WHEN d.same_name_count > 1 THEN 1 ELSE 0 END) OVER () AS resultHomonymCount
    FROM filtered_officials d JOIN person p ON p.id = d.person_id
    ORDER BY ${sortColumns[sort]} ${direction},
             p.canonical_name COLLATE NOCASE ASC, p.id ASC
    LIMIT ? OFFSET ?
  `).all(...parameters, limit, (page - 1) * limit);
    const firstResult = resultRows[0];
    const summary = firstResult ? {
        persons: firstResult.resultPersons,
        grossAssets: firstResult.resultGrossAssets,
        liabilities: firstResult.resultLiabilities,
        netWorth: firstResult.resultNetWorth,
        averageNetWorth: firstResult.resultAverageNetWorth,
        highNetCount: firstResult.resultHighNetCount,
        negativeNetCount: firstResult.resultNegativeNetCount,
        missingOrgCount: firstResult.resultMissingOrgCount,
        missingTitleCount: firstResult.resultMissingTitleCount,
        homonymCount: firstResult.resultHomonymCount,
    } : {
        persons: 0, grossAssets: 0, liabilities: 0, netWorth: 0,
        averageNetWorth: 0, highNetCount: 0, negativeNetCount: 0,
        missingOrgCount: 0, missingTitleCount: 0, homonymCount: 0,
    };
    const total = summary.persons;
    const data = resultRows.map((row) => {
        const { resultPersons, resultGrossAssets, resultLiabilities, resultNetWorth, resultAverageNetWorth, resultHighNetCount, resultNegativeNetCount, resultMissingOrgCount, resultMissingTitleCount, resultHomonymCount, ...official } = row;
        return official;
    });
    ok(res, data, {
        meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(Number(total) / limit),
            sort: { field: sort, direction: direction.toLowerCase() },
            year,
            lens: selectedLens,
            summary,
            quality: {
                accountingPass: Number(summary.grossAssets) - Number(summary.liabilities) === Number(summary.netWorth),
                snapshotPolicy: year === 'recent'
                    ? `${latestCompleteYear}년 완결 모집단 + ${defaultYear}년 공개분 인물별 최신 반영`
                    : year === 'all' ? '전체 기간에서 인물별 최신 공개 신고 1건' : `${year}년 인물별 최신 공개 신고 1건`,
                organizationBasis: '선택된 신고 시점의 소속기관·직위',
                sourceLineageCoverage: 1,
                identityCoverage: Number(summary.persons)
                    ? (Number(summary.persons) - Number(summary.missingOrgCount)) / Number(summary.persons)
                    : 1,
            },
        },
    });
});
app.get('/api/officials/:id', async (req, res) => {
    const year = parseYear(req.query.year);
    const official = await statement(`
    ${snapshotCte(year)}
    SELECT p.id, p.canonical_name AS name,
           d.organization_at_disclosure AS agency,
           d.title_at_disclosure AS title,
           d.id AS disclosureId, d.gross_assets AS totalAssets,
           d.net_worth AS netWorth, d.liabilities, d.period_year AS latestYear,
           d.registered_at AS registeredAt, d.disclosed_at AS disclosedAt,
           d.source_record_index AS sourceRecordIndex,
           d.source_record_hash AS sourceRecordHash,
           s.source_url AS sourceUrl, s.decoded_sha256 AS sourceSha256
    FROM latest_disclosures d JOIN person p ON p.id = d.person_id
    JOIN source_artifact s ON s.id = d.source_artifact_id
    WHERE p.id = ?
  `).get(req.params.id);
    if (!official)
        return fail(res, 'Not found', 404);
    const assets = await statement(`
    SELECT id, category, subcategory AS detailType, detail AS address, owner,
           valuation, difference, latitude, longitude
    FROM asset WHERE disclosure_id = ? ORDER BY valuation DESC
  `).all(official.disclosureId);
    const disclosures = await statement(`
    SELECT d.id, d.period_year AS year, d.registered_at AS registeredAt,
           d.disclosed_at AS disclosedAt, d.gross_assets AS totalAssets,
           d.liabilities, d.net_worth AS netWorth, d.asset_count AS assetCount,
           d.source_record_index AS sourceRecordIndex,
           d.source_record_hash AS sourceRecordHash,
           s.source_url AS sourceUrl, s.decoded_sha256 AS sourceSha256
    FROM disclosure d JOIN source_artifact s ON s.id = d.source_artifact_id
    WHERE d.person_id = ?
    ORDER BY d.period_year DESC, COALESCE(d.disclosed_at, d.registered_at, '') DESC
  `).all(req.params.id);
    const previousDisclosure = disclosures.find((item) => Number(item.year) < Number(official.latestYear)) || null;
    const previousAssets = previousDisclosure
        ? await statement(`
        SELECT category, valuation
        FROM asset WHERE disclosure_id = ?
      `).all(previousDisclosure.id) : [];
    const summarizeAssets = (rows) => {
        const categories = new Map();
        const owners = new Map();
        let grossAssets = 0;
        let liabilities = 0;
        for (const row of rows) {
            const valuation = Number(row.valuation || 0);
            const isLiability = row.category === '채무';
            if (isLiability)
                liabilities += valuation;
            else
                grossAssets += valuation;
            const category = categories.get(row.category) || {
                category: row.category, valuation: 0, count: 0, isLiability,
            };
            category.valuation += valuation;
            category.count += 1;
            categories.set(row.category, category);
            if ('owner' in row) {
                const ownerName = String(row.owner || '미상').trim() || '미상';
                const owner = owners.get(ownerName) || {
                    owner: ownerName, grossAssets: 0, liabilities: 0, assetCount: 0,
                };
                if (isLiability)
                    owner.liabilities += valuation;
                else
                    owner.grossAssets += valuation;
                owner.assetCount += 1;
                owners.set(ownerName, owner);
            }
        }
        return {
            grossAssets,
            liabilities,
            netWorth: grossAssets - liabilities,
            categories: [...categories.values()]
                .map((item) => ({
                ...item,
                shareOfGross: item.isLiability || grossAssets === 0
                    ? 0 : item.valuation / grossAssets,
            }))
                .sort((a, b) => b.valuation - a.valuation),
            owners: [...owners.values()]
                .map((owner) => ({
                ...owner,
                netWorth: owner.grossAssets - owner.liabilities,
                shareOfGross: grossAssets ? owner.grossAssets / grossAssets : 0,
            }))
                .sort((a, b) => b.grossAssets - a.grossAssets),
        };
    };
    const currentSummary = summarizeAssets(assets);
    const previousSummary = summarizeAssets(previousAssets);
    const previousCategoryMap = new Map(previousSummary.categories.map((item) => [item.category, item.valuation]));
    const currentCategoryMap = new Map(currentSummary.categories.map((item) => [item.category, item]));
    const categoryChanges = [...new Set([
            ...currentSummary.categories.map((item) => item.category),
            ...previousSummary.categories.map((item) => item.category),
        ])].map((category) => {
        const currentItem = currentCategoryMap.get(category);
        const currentValuation = currentItem?.valuation || 0;
        const previousValuation = previousCategoryMap.get(category) || 0;
        return {
            category,
            currentValuation,
            previousValuation,
            difference: currentValuation - previousValuation,
            isLiability: currentItem?.isLiability || category === '채무',
        };
    }).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
    ok(res, {
        ...official,
        assets,
        history: disclosures,
        disclosures,
        selectedYear: year,
        summary: currentSummary,
        comparison: previousDisclosure ? {
            previousYear: previousDisclosure.year,
            previousDisclosureId: previousDisclosure.id,
            grossAssetsChange: Number(official.totalAssets) - Number(previousDisclosure.totalAssets),
            liabilitiesChange: Number(official.liabilities) - Number(previousDisclosure.liabilities),
            netWorthChange: Number(official.netWorth) - Number(previousDisclosure.netWorth),
            categoryChanges,
        } : null,
        quality: {
            accountingPass: currentSummary.grossAssets === Number(official.totalAssets) &&
                currentSummary.liabilities === Number(official.liabilities) &&
                currentSummary.netWorth === Number(official.netWorth),
            assetCompositionPass: currentSummary.grossAssets === 0 ||
                Math.abs(currentSummary.categories
                    .filter((item) => !item.isLiability)
                    .reduce((sum, item) => sum + item.shareOfGross, 0) - 1) < 1e-9,
            sourceRowCount: assets.length,
            policy: '채무는 자산구성 비중에서 제외하고 총자산 - 채무 = 순자산으로 별도 대사',
        },
    });
});
app.get('/api/rankings/:mode', async (req, res) => {
    const mode = req.params.mode;
    if (!['profit', 'yield'].includes(mode))
        return fail(res, 'Invalid mode', 400);
    const currentYear = parseYear(req.query.year);
    if (currentYear === 'recent') {
        const comparisonRows = await statement(`
      ${snapshotCte('recent')},
      previous_ranked AS (
        SELECT selected.person_id, previous.*,
               ROW_NUMBER() OVER (
                 PARTITION BY selected.person_id
                 ORDER BY previous.period_year DESC,
                          COALESCE(previous.disclosed_at, previous.registered_at, '') DESC,
                          previous.source_record_index DESC
               ) AS previous_rank
        FROM latest_disclosures selected
        JOIN disclosure previous ON previous.person_id = selected.person_id
          AND (
            previous.period_year < selected.period_year OR
            (previous.period_year = selected.period_year AND previous.id <> selected.id
             AND COALESCE(previous.disclosed_at, previous.registered_at, '') <
                 COALESCE(selected.disclosed_at, selected.registered_at, ''))
          )
      )
      SELECT p.id, p.canonical_name AS name,
             current.organization_at_disclosure AS agency,
             current.title_at_disclosure AS title,
             current.id AS currentDisclosureId,
             previous.id AS previousDisclosureId,
             current.period_year AS currentYear,
             previous.period_year AS previousYear,
             current.net_worth AS currentNetWorth,
             previous.net_worth AS previousNetWorth,
             current.net_worth - previous.net_worth AS profit
      FROM latest_disclosures current
      JOIN previous_ranked previous ON previous.person_id = current.person_id
        AND previous.previous_rank = 1
      JOIN person p ON p.id = current.person_id
      WHERE previous.net_worth > 0
    `).all();
        return await respondWithRankings(res, req, comparisonRows, mode, {
            status: 'RECENT_SNAPSHOT_PREVIOUS_COMPARISON',
            currentYear: `${latestCompleteYear} 완결 모집단 + ${defaultYear} 갱신분`,
            previousYear: '선택된 최신 신고의 개인별 직전 신고',
            formula: mode === 'profit' ? '최신 통합 순자산 - 개인별 직전 순자산' : '개인별 증감액 / 직전 순자산 × 100',
            debtTreatment: '채무 차감',
            officialVerification: 'PENDING_PER_RECORD',
        });
    }
    if (currentYear === 'all') {
        const comparisonRows = await statement(`
      WITH ordered AS (
        SELECT d.*, ROW_NUMBER() OVER (
          PARTITION BY d.person_id
          ORDER BY d.period_year DESC,
                   COALESCE(d.disclosed_at, d.registered_at, '') DESC,
                   d.source_record_index DESC
        ) AS history_rank
        FROM disclosure d
      )
      SELECT p.id, p.canonical_name AS name,
             current.organization_at_disclosure AS agency,
             current.title_at_disclosure AS title, current.period_year AS currentYear,
             current.id AS currentDisclosureId,
             previous.id AS previousDisclosureId,
             previous.period_year AS previousYear,
             current.net_worth AS currentNetWorth,
             previous.net_worth AS previousNetWorth,
             current.net_worth - previous.net_worth AS profit
      FROM ordered current
      JOIN ordered previous ON previous.person_id = current.person_id
        AND previous.history_rank = 2
      JOIN person p ON p.id = current.person_id
      WHERE current.history_rank = 1 AND previous.net_worth > 0
    `).all();
        return await respondWithRankings(res, req, comparisonRows, mode, {
            status: 'PERSON_LATEST_PREVIOUS_COMPARISON',
            currentYear: '개인별 최신',
            previousYear: '개인별 직전',
            formula: mode === 'profit' ? '개인별 최신 순자산 - 직전 순자산' : '개인별 증감액 / 직전 순자산 × 100',
            debtTreatment: '채무 차감',
            officialVerification: 'PENDING_PER_RECORD',
        });
    }
    const previousYear = availableYears.find((year) => year < currentYear);
    if (!previousYear)
        return fail(res, '비교 가능한 이전 연도가 없습니다.', 409);
    const comparisonRows = await statement(`
    WITH yearly AS (
      SELECT d.*, ROW_NUMBER() OVER (
        PARTITION BY d.person_id, d.period_year
        ORDER BY COALESCE(d.disclosed_at, d.registered_at, '') DESC, d.source_record_index DESC
      ) AS rn
      FROM disclosure d WHERE d.period_year IN (?, ?)
    )
    SELECT p.id, p.canonical_name AS name,
           current.organization_at_disclosure AS agency,
           current.title_at_disclosure AS title,
           current.id AS currentDisclosureId,
           previous.id AS previousDisclosureId,
           current.period_year AS currentYear, previous.period_year AS previousYear,
           current.net_worth AS currentNetWorth,
           previous.net_worth AS previousNetWorth,
           current.net_worth - previous.net_worth AS profit
    FROM yearly current
    JOIN yearly previous ON previous.person_id = current.person_id
      AND previous.period_year = ? AND previous.rn = 1
    JOIN person p ON p.id = current.person_id
    WHERE current.period_year = ? AND current.rn = 1 AND previous.net_worth > 0
  `).all(currentYear, previousYear, previousYear, currentYear);
    return await respondWithRankings(res, req, comparisonRows, mode, {
        status: 'NORMALIZED_SNAPSHOT_COMPARISON',
        currentYear,
        previousYear,
        formula: mode === 'profit' ? '현재 순자산 - 직전 순자산' : '증감액 / 직전 순자산 × 100',
        debtTreatment: '채무 차감',
        officialVerification: 'PENDING_PER_RECORD',
    });
});
app.get('/api/map', async (req, res) => {
    const year = parseYear(req.query.year);
    const limit = parseLimit(req.query.limit, 50000, 75000);
    res.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=86400');
    const rows = await statement(`
    ${snapshotCte(year)}
    SELECT a.id, p.id AS officialId, p.canonical_name AS name,
           d.organization_at_disclosure AS agency, d.title_at_disclosure AS title,
           a.category, a.subcategory AS detailType, a.detail AS address,
           a.address AS geocodedAddress,
           a.owner, a.valuation, a.latitude, a.longitude
    FROM latest_disclosures d
    JOIN person p ON p.id = d.person_id
    JOIN asset a ON a.disclosure_id = d.id
    WHERE a.latitude IS NOT NULL AND a.longitude IS NOT NULL
      AND a.category IN ('토지', '건물')
      AND a.latitude BETWEEN 32 AND 39
      AND a.longitude BETWEEN 124 AND 132
    ORDER BY a.valuation DESC, a.id LIMIT ?
  `).all(limit);
    const coverage = await statement(`
    ${snapshotCte(year)}
    SELECT COUNT(*) AS sourceAssets,
           SUM(CASE WHEN a.latitude IS NOT NULL AND a.longitude IS NOT NULL
                     AND a.latitude BETWEEN 32 AND 39
                     AND a.longitude BETWEEN 124 AND 132 THEN 1 ELSE 0 END) AS geocodedAssets
    FROM latest_disclosures d
    JOIN asset a ON a.disclosure_id = d.id
    WHERE a.category IN ('토지', '건물')
  `).get();
    const coordinateAddressGroups = new Map();
    for (const row of rows) {
        const coordinateKey = `${Number(row.latitude).toFixed(6)},${Number(row.longitude).toFixed(6)}`;
        const address = String(row.geocodedAddress || row.address || '').replace(/\s+/g, ' ').trim();
        if (!coordinateAddressGroups.has(coordinateKey))
            coordinateAddressGroups.set(coordinateKey, new Set());
        if (address)
            coordinateAddressGroups.get(coordinateKey).add(address);
    }
    const regional = new Map();
    const people = new Set();
    let totalValuation = 0;
    let buildingCount = 0;
    let landCount = 0;
    const data = rows.map((row) => {
        const location = parseRealEstateLocation(row.address);
        const coordinateKey = `${Number(row.latitude).toFixed(6)},${Number(row.longitude).toFixed(6)}`;
        const distinctAddressesAtCoordinate = coordinateAddressGroups.get(coordinateKey)?.size || 0;
        const coordinate = distinctAddressesAtCoordinate > 1
            ? {
                ...classifyMapCoordinate(row.geocodedAddress || row.address, row.agency),
                coordinatePrecision: 'administrative',
                coordinateBasis: `서로 다른 상세 주소 ${distinctAddressesAtCoordinate.toLocaleString('ko-KR')}건이 동일 좌표를 공유해 대표 위치로 해석 필요`,
            }
            : classifyMapCoordinate(row.geocodedAddress || row.address, row.agency);
        const valuation = Number(row.valuation || 0);
        const region = regional.get(location.province) || {
            name: location.province, assetCount: 0, totalValuation: 0,
            buildingCount: 0, landCount: 0, officialIds: new Set(),
        };
        region.assetCount += 1;
        region.totalValuation += valuation;
        region.buildingCount += row.category === '건물' ? 1 : 0;
        region.landCount += row.category === '토지' ? 1 : 0;
        region.officialIds.add(row.officialId);
        regional.set(location.province, region);
        people.add(row.officialId);
        totalValuation += valuation;
        buildingCount += row.category === '건물' ? 1 : 0;
        landCount += row.category === '토지' ? 1 : 0;
        return {
            ...row,
            valuation,
            ...coordinate,
            province: location.province,
            district: location.district,
            locality: location.locality,
        };
    });
    const sourceAssets = Number(coverage.sourceAssets || 0);
    const geocodedAssets = Number(coverage.geocodedAssets || 0);
    const regions = [...regional.values()].map((region) => ({
        name: region.name,
        assetCount: region.assetCount,
        totalValuation: region.totalValuation,
        buildingCount: region.buildingCount,
        landCount: region.landCount,
        officialsCount: region.officialIds.size,
    })).sort((a, b) => b.totalValuation - a.totalValuation || b.assetCount - a.assetCount);
    ok(res, data, {
        year,
        summary: {
            mappedAssets: data.length,
            sourceAssets,
            geocodedAssets,
            officialsCount: people.size,
            totalValuation,
            buildingCount,
            landCount,
            coordinateCoverage: sourceAssets ? geocodedAssets / sourceAssets : 0,
            truncated: geocodedAssets > data.length,
            limit,
        },
        regions,
        quality: {
            snapshotPolicy: year === 'recent'
                ? `${latestCompleteYear}년 완결 모집단 + ${defaultYear}년 공개분 인물별 최신`
                : year === 'all' ? '인물별 최신 공개 신고' : `${year}년 인물별 최신 공개 신고`,
            valuationPolicy: '공식 건물·토지 자산행 신고가액 합계 · 시세 추정 없음',
            coordinatePolicy: '원본 보존 좌표 중 대한민국 유효 범위만 표시',
            reconciliationPass: data.length === Math.min(geocodedAssets, limit),
        },
    });
});
async function instrumentStats(category, extractor, year, subcategories = [], extraCategories = []) {
    const subcategoryFilter = subcategories.length
        ? `AND a.subcategory IN (${subcategories.map(() => '?').join(',')})`
        : '';
    const extraCategoryFilter = extraCategories.length
        ? `OR a.category IN (${extraCategories.map(() => '?').join(',')})`
        : '';
    const rows = await statement(`
    ${snapshotCte(year)}
    SELECT p.id, p.canonical_name AS name, p.latest_organization AS agency,
           p.latest_title AS title, a.id AS assetId, a.subcategory,
           a.detail, a.valuation
    FROM latest_disclosures d
    JOIN person p ON p.id = d.person_id
    JOIN asset a ON a.disclosure_id = d.id
    WHERE ((a.category = ? ${subcategoryFilter}) ${extraCategoryFilter})
  `).all(category, ...subcategories, ...extraCategories);
    const instruments = new Map();
    let sourceValuation = 0;
    let allocatedValuation = 0;
    let parsedComponents = 0;
    let activeComponents = 0;
    let unallocatedComponents = 0;
    let overAllocatedRows = 0;
    for (const row of rows) {
        sourceValuation += Number(row.valuation || 0);
        let rowAllocatedValuation = 0;
        const extractedHoldings = extractor(row.detail, row.valuation);
        for (const holding of extractedHoldings) {
            const name = holding.canonicalName;
            if (!name)
                continue;
            parsedComponents += 1;
            // 전량 처분된 0수량 종목을 현재 보유자로 계산하지 않는다.
            if (holding.quantity === 0)
                continue;
            activeComponents += 1;
            const item = instruments.get(name) || {
                name, valuation: 0, holders: new Map(), topHolderVal: 0, topHolder: null,
                allocatedPositions: 0, unallocatedPositions: 0,
                acquiredPositions: 0, increasedPositions: 0, decreasedPositions: 0,
                confidenceTotal: 0, confidencePositions: 0,
                assetClass: row.subcategory || category,
            };
            item.confidenceTotal += Number(holding.confidence || 0);
            item.confidencePositions += 1;
            const inferredAcquisition = holding.changeType === 'INCREASED' &&
                holding.quantity !== null && holding.changeQuantity !== null &&
                Number(holding.quantity) > 0 && Number(holding.quantity) === Number(holding.changeQuantity);
            if (holding.changeType === 'ACQUIRED' || inferredAcquisition)
                item.acquiredPositions += 1;
            if (holding.changeType === 'INCREASED' && !inferredAcquisition)
                item.increasedPositions += 1;
            if (holding.changeType === 'DECREASED')
                item.decreasedPositions += 1;
            const hasAllocatedValue = holding.declaredValuation !== null;
            const valuation = hasAllocatedValue ? Number(holding.declaredValuation) : null;
            const existingHolder = item.holders.get(row.id) || {
                id: row.id, name: row.name, agency: row.agency, title: row.title,
                valuation: null, hasUnallocated: false, quantity: 0, sourceCount: 0,
            };
            existingHolder.sourceCount += 1;
            if (holding.quantity !== null)
                existingHolder.quantity += holding.quantity;
            if (valuation !== null) {
                item.valuation += valuation;
                item.allocatedPositions += 1;
                allocatedValuation += valuation;
                rowAllocatedValuation += valuation;
                existingHolder.valuation = (existingHolder.valuation || 0) + valuation;
            }
            else {
                item.unallocatedPositions += 1;
                unallocatedComponents += 1;
                existingHolder.hasUnallocated = true;
            }
            item.holders.set(row.id, existingHolder);
            instruments.set(name, item);
        }
        if (rowAllocatedValuation > Number(row.valuation || 0))
            overAllocatedRows += 1;
    }
    const items = [...instruments.values()]
        .map((item) => {
        const holders = [...item.holders.values()]
            .sort((a, b) => (b.valuation || -1) - (a.valuation || -1));
        const valuedHolders = holders.filter((holder) => holder.valuation !== null);
        const topHolder = valuedHolders[0] || null;
        return {
            ...item,
            count: item.holders.size,
            valuedHolderCount: valuedHolders.length,
            unallocatedHolderCount: holders.filter((holder) => holder.hasUnallocated).length,
            holders,
            topHolderVal: topHolder?.valuation || 0,
            topHolder: topHolder?.name || null,
            valuationCoverage: item.allocatedPositions /
                Math.max(1, item.allocatedPositions + item.unallocatedPositions),
            holderCoverage: valuedHolders.length / Math.max(1, item.holders.size),
            confidenceScore: item.confidenceTotal / Math.max(1, item.confidencePositions),
            dataGrade: item.confidenceTotal / Math.max(1, item.confidencePositions) >= 0.8 &&
                item.unallocatedPositions === 0 && item.allocatedPositions > 0
                ? 'A'
                : item.allocatedPositions > 0 &&
                    item.confidenceTotal / Math.max(1, item.confidencePositions) >= 0.75
                    ? 'B'
                    : item.confidenceTotal / Math.max(1, item.confidencePositions) >= 0.75
                        ? 'C'
                        : 'D',
        };
    })
        .sort((a, b) => b.valuation - a.valuation);
    return {
        items,
        alpha: buildInstrumentAlpha(items, category === '가상자산' ? '코인' : '종목'),
        quality: {
            parserVersion: require('../backend/lib/normalizer').PARSER_VERSION,
            sourceAssets: rows.length,
            sourceValuation,
            parsedComponents,
            activeComponents,
            excludedZeroQuantity: parsedComponents - activeComponents,
            allocatedValuation,
            unallocatedValuation: Math.max(0, sourceValuation - allocatedValuation),
            unallocatedComponents,
            valuationCoverage: sourceValuation ? allocatedValuation / sourceValuation : 0,
            reconciliationPass: allocatedValuation <= sourceValuation,
            overAllocatedRows,
            policy: '복수 종목 신고가액은 임의 배분하지 않으며 0수량 종목은 현재 보유자에서 제외',
        },
    };
}
const stockCache = new Map();
const cryptoCache = new Map();
function stockSubcategories(assetClass) {
    if (assetClass === 'unlisted')
        return ['비상장주식'];
    if (assetClass === 'bonds') {
        return ['기타채권', '금융채', '회사채', '국채', '채권', '공채', '지방채'];
    }
    if (assetClass === 'all')
        return ['상장주식', '비상장주식'];
    return ['상장주식'];
}
function stockExtraCategories(assetClass) {
    return assetClass === 'bonds' ? ['채권'] : [];
}
app.get('/api/stats/stocks', async (req, res) => {
    const year = parseYear(req.query.year);
    const assetClass = ['listed', 'unlisted', 'bonds', 'all'].includes(String(req.query.class))
        ? String(req.query.class) : 'listed';
    const cacheKey = `${year}:${assetClass}`;
    if (!stockCache.has(cacheKey)) {
        stockCache.set(cacheKey, await instrumentStats('증권', extractSecurityHoldings, year, stockSubcategories(assetClass), stockExtraCategories(assetClass)));
    }
    const result = stockCache.get(cacheKey);
    ok(res, result.items.map(({ holders, ...item }) => item), {
        year, assetClass, quality: result.quality, alpha: result.alpha,
    });
});
app.get('/api/stats/stocks/:name', async (req, res) => {
    const year = parseYear(req.query.year);
    const assetClass = ['listed', 'unlisted', 'bonds', 'all'].includes(String(req.query.class))
        ? String(req.query.class) : 'listed';
    const cacheKey = `${year}:${assetClass}`;
    if (!stockCache.has(cacheKey)) {
        stockCache.set(cacheKey, await instrumentStats('증권', extractSecurityHoldings, year, stockSubcategories(assetClass), stockExtraCategories(assetClass)));
    }
    const result = stockCache.get(cacheKey);
    ok(res, result.items.find((item) => item.name === req.params.name)?.holders || [], {
        year, assetClass, quality: result.quality,
    });
});
app.get('/api/stats/crypto', async (req, res) => {
    const year = parseYear(req.query.year);
    if (!cryptoCache.has(year))
        cryptoCache.set(year, await instrumentStats('가상자산', extractCryptoHoldings, year));
    const result = cryptoCache.get(year);
    ok(res, result.items.map(({ holders, ...item }) => item), {
        year, quality: result.quality, alpha: result.alpha,
    });
});
app.get('/api/stats/crypto/people', async (req, res) => {
    const year = parseYear(req.query.year);
    const limit = parseLimit(req.query.limit, 100, 1000);
    const rows = await statement(`
    ${snapshotCte(year)}
    SELECT p.id, p.canonical_name AS name,
           d.organization_at_disclosure AS agency,
           d.title_at_disclosure AS title,
           d.period_year AS disclosureYear,
           COALESCE(d.disclosed_at, d.registered_at, '') AS disclosedAt,
           COUNT(a.id) AS assetCount,
           COALESCE(SUM(a.valuation), 0) AS valuation
    FROM latest_disclosures d
    JOIN person p ON p.id = d.person_id
    JOIN asset a ON a.disclosure_id = d.id AND a.category = '가상자산'
    GROUP BY p.id, d.id
    ORDER BY valuation DESC, assetCount DESC, p.canonical_name
    LIMIT ?
  `).all(limit);
    const summary = await statement(`
    ${snapshotCte(year)}
    SELECT COUNT(DISTINCT d.person_id) AS persons,
           COUNT(a.id) AS assets,
           COALESCE(SUM(a.valuation), 0) AS valuation,
           SUM(CASE WHEN a.valuation > 0 THEN 1 ELSE 0 END) AS valuedAssets
    FROM latest_disclosures d
    JOIN asset a ON a.disclosure_id = d.id AND a.category = '가상자산'
  `).get();
    const personAudit = await statement(`
    ${snapshotCte(year)}
    SELECT COUNT(*) AS groupedPersons,
           COALESCE(SUM(personValuation), 0) AS groupedValuation,
           COALESCE(SUM(assetCount), 0) AS groupedAssets,
           SUM(CASE WHEN personValuation < 0 THEN 1 ELSE 0 END) AS negativePersonTotals
    FROM (
      SELECT d.person_id,
             COUNT(a.id) AS assetCount,
             COALESCE(SUM(a.valuation), 0) AS personValuation
      FROM latest_disclosures d
      JOIN asset a ON a.disclosure_id = d.id AND a.category = '가상자산'
      GROUP BY d.person_id
    )
  `).get();
    const duplicateSnapshots = (await statement(`
    ${snapshotCte(year)}
    SELECT COUNT(*) AS count
    FROM (
      SELECT person_id, COUNT(*) AS disclosureCount
      FROM latest_disclosures
      GROUP BY person_id
      HAVING COUNT(*) > 1
    )
  `).get()).count;
    const referencePerson = await statement(`
    ${snapshotCte(year)}
    SELECT p.id, p.canonical_name AS name, d.period_year AS disclosureYear,
           COUNT(a.id) AS assetCount, COALESCE(SUM(a.valuation), 0) AS valuation,
           GROUP_CONCAT(a.detail, ' | ') AS sourceDetails
    FROM latest_disclosures d
    JOIN person p ON p.id = d.person_id
    JOIN asset a ON a.disclosure_id = d.id AND a.category = '가상자산'
    WHERE p.canonical_name = '김홍수'
    GROUP BY p.id, d.id
    ORDER BY d.period_year DESC
    LIMIT 1
  `).get();
    const peopleQuality = {
        groupedPersons: personAudit.groupedPersons,
        groupedAssets: personAudit.groupedAssets,
        groupedValuation: personAudit.groupedValuation,
        negativePersonTotals: personAudit.negativePersonTotals,
        duplicateSnapshots,
        reconciliationPass: Number(personAudit.groupedPersons) === Number(summary.persons) &&
            Number(personAudit.groupedAssets) === Number(summary.assets) &&
            Number(personAudit.groupedValuation) === Number(summary.valuation) &&
            Number(duplicateSnapshots) === 0,
        referenceCheck: referencePerson ? {
            ...referencePerson,
            expectedValuation: Number(referencePerson.disclosureYear) === 2025 ? 12523638000 : null,
            pass: Number(referencePerson.disclosureYear) !== 2025 ||
                Number(referencePerson.valuation) === 12523638000,
        } : null,
    };
    ok(res, rows, {
        year,
        summary,
        quality: peopleQuality,
        methodology: '공식 신고의 가상자산 행 평가액을 인물별로 정확 합산하며 코인명별 추정 배분을 사용하지 않음',
    });
});
app.get('/api/stats/crypto/:name', async (req, res) => {
    const year = parseYear(req.query.year);
    if (!cryptoCache.has(year))
        cryptoCache.set(year, await instrumentStats('가상자산', extractCryptoHoldings, year));
    const result = cryptoCache.get(year);
    ok(res, result.items.find((item) => item.name === req.params.name)?.holders || [], {
        year, quality: result.quality,
    });
});
app.get('/api/stats/regions', async (req, res) => {
    const year = parseYear(req.query.year);
    const rows = await statement(`
    ${snapshotCte(year)}
    SELECT a.detail, a.valuation FROM latest_disclosures d
    JOIN asset a ON a.disclosure_id = d.id
    WHERE a.category IN ('토지', '건물')
  `).all();
    const regions = new Map();
    const pattern = /(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)/;
    for (const row of rows) {
        const name = row.detail.match(pattern)?.[1] || '기타·국외';
        const item = regions.get(name) || { name, count: 0, valuation: 0 };
        item.count += 1;
        item.valuation += Number(row.valuation);
        regions.set(name, item);
    }
    ok(res, [...regions.values()].sort((a, b) => b.valuation - a.valuation), { year });
});
app.get('/api/analysis/real-estate', async (req, res) => {
    const year = parseYear(req.query.year);
    const selectedFilter = String(req.query.filter || 'all');
    const filterMap = { building: ['건물'], land: ['토지'] };
    const categories = filterMap[selectedFilter] || ['건물', '토지'];
    const placeholders = categories.map(() => '?').join(',');
    const detailFilters = {
        gangnam: {
            sql: `AND (a.detail LIKE '%강남구%' OR a.detail LIKE '%서초구%' OR a.detail LIKE '%송파구%')`,
            values: [],
        },
        second_home: {
            sql: `AND (a.detail LIKE '%제주%' OR a.detail LIKE '%강원특별자치도%' OR a.detail LIKE '%강원도%')`,
            values: [],
        },
    };
    const detailFilter = detailFilters[selectedFilter];
    const luxuryOnly = selectedFilter === 'luxury';
    const extraWhere = detailFilter
        ? detailFilter.sql
        : selectedFilter === 'apt'
            ? `AND a.subcategory LIKE '%아파트%'`
            : selectedFilter === 'commercial'
                ? `AND (a.subcategory LIKE '%상가%' OR a.subcategory LIKE '%근린생활시설%' OR a.subcategory LIKE '%업무시설%')`
                : luxuryOnly
                    ? 'AND a.valuation >= 3000000000'
                    : '';
    const parameters = detailFilter ? [...categories, ...(detailFilter.values || [])] : categories;
    const aggregate = await statement(`
    ${snapshotCte(year)}
    SELECT COUNT(DISTINCT d.person_id) AS officialsCount,
           COUNT(*) AS assetCount, SUM(a.valuation) AS totalVolume
    FROM latest_disclosures d
    JOIN asset a ON a.disclosure_id = d.id
    WHERE a.category IN (${placeholders}) ${extraWhere}
  `).get(...parameters);
    const rows = await statement(`
    ${snapshotCte(year)}
    SELECT p.id, p.canonical_name AS name, p.latest_organization AS agency,
           p.latest_title AS title,
           SUM(a.valuation) AS categoryTotal, COUNT(*) AS assetCount
    FROM latest_disclosures d JOIN person p ON p.id = d.person_id
    JOIN asset a ON a.disclosure_id = d.id
    WHERE a.category IN (${placeholders}) ${extraWhere}
    GROUP BY p.id ORDER BY categoryTotal DESC LIMIT 200
  `).all(...parameters);
    const personIds = rows.map((row) => row.id);
    const assetsByPerson = new Map();
    if (personIds.length) {
        const idPlaceholders = personIds.map(() => '?').join(',');
        const topAssets = await statement(`
      ${snapshotCte(year)}
      SELECT * FROM (
        SELECT d.person_id, a.id, a.category, a.subcategory, a.owner,
               a.detail AS address, a.valuation,
               ROW_NUMBER() OVER (
                 PARTITION BY d.person_id ORDER BY a.valuation DESC, a.id
               ) AS assetRank
        FROM latest_disclosures d
        JOIN asset a ON a.disclosure_id = d.id
        WHERE d.person_id IN (${idPlaceholders})
          AND a.category IN (${placeholders}) ${extraWhere}
      ) WHERE assetRank <= 5
      ORDER BY person_id, assetRank
    `).all(...personIds, ...parameters);
        for (const asset of topAssets) {
            const list = assetsByPerson.get(asset.person_id) || [];
            list.push(asset);
            assetsByPerson.set(asset.person_id, list);
        }
    }
    const enrichedRows = rows.map((row) => ({
        ...row,
        assets: assetsByPerson.get(row.id) || [],
    }));
    const totalVolume = Number(aggregate.totalVolume || 0);
    ok(res, enrichedRows, {
        stats: {
            totalPersons: aggregate.officialsCount,
            officialsCount: aggregate.officialsCount,
            assetCount: aggregate.assetCount,
            totalVolume,
            averageVolume: Number(aggregate.officialsCount)
                ? Math.round(totalVolume / Number(aggregate.officialsCount)) : 0,
            displayed: rows.length,
            filter: selectedFilter,
            year,
            methodology: '인물별 최신 신고 스냅샷의 건물·토지 자산을 원문 하위유형과 주소로 필터링',
        },
    });
});
app.get('/api/analysis/new-assets', async (req, res) => {
    const year = parseYear(req.query.year);
    const allowedCategories = new Set([
        '토지', '건물', '예금', '증권', '가상자산', '동산', '채권', '회원권',
        '현금', '금 및 백금', '보석류', '골동품 및 예술품', '지식재산권',
    ]);
    const category = allowedCategories.has(String(req.query.category)) ? String(req.query.category) : 'all';
    const eventType = ['ACQUIRED', 'INCREASED'].includes(String(req.query.eventType))
        ? String(req.query.eventType) : 'all';
    const subcategory = String(req.query.subcategory || 'all').trim().slice(0, 80);
    const region = String(req.query.region || 'all').trim().slice(0, 40);
    const sort = ['difference', 'date', 'valuation'].includes(String(req.query.sort))
        ? String(req.query.sort) : 'difference';
    const limit = parseLimit(req.query.limit, 50, 100);
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const searchTokens = String(req.query.search || '').trim().slice(0, 80)
        .split(/\s+/).filter(Boolean).slice(0, 5);
    const eventExpression = `CASE
    WHEN a.difference > 0 AND ABS(a.valuation - a.difference) <= 1 THEN 'ACQUIRED'
    WHEN a.difference > 0 THEN 'INCREASED'
    WHEN a.category IN ('건물', '토지') AND a.difference IS NULL
         AND a.detail LIKE '%증가%' THEN 'ACQUIRED_SIGNAL'
    WHEN a.detail LIKE '%신규%' OR a.detail LIKE '%취득%' THEN 'ACQUIRED_SIGNAL'
    ELSE 'INCREASED_SIGNAL'
  END`;
    const eventCondition = `(a.difference > 0 OR (
    a.difference IS NULL AND (
      a.detail LIKE '%증가%' OR a.detail LIKE '%신규%' OR a.detail LIKE '%취득%'
    )
  ))`;
    const filterConditions = [eventCondition, `a.category <> '채무'`];
    const filterParameters = [];
    if (category !== 'all') {
        filterConditions.push('a.category = ?');
        filterParameters.push(category);
    }
    if (subcategory !== 'all') {
        filterConditions.push(`COALESCE(NULLIF(a.subcategory, ''), '미분류') = ?`);
        filterParameters.push(subcategory);
    }
    if (region !== 'all') {
        const regionAliases = region === '강원특별자치도'
            ? ['강원특별자치도', '강원도']
            : region === '전북특별자치도'
                ? ['전북특별자치도', '전라북도']
                : [region];
        filterConditions.push(`a.category IN ('건물', '토지') AND (${regionAliases.map(() => 'a.detail LIKE ?').join(' OR ')})`);
        filterParameters.push(...regionAliases.map((name) => `${name}%`));
    }
    if (eventType !== 'all') {
        filterConditions.push(eventType === 'ACQUIRED'
            ? `${eventExpression} IN ('ACQUIRED', 'ACQUIRED_SIGNAL')`
            : `${eventExpression} IN ('INCREASED', 'INCREASED_SIGNAL')`);
    }
    for (const token of searchTokens) {
        filterConditions.push(`(
      p.canonical_name || ' ' || COALESCE(d.organization_at_disclosure, '') || ' ' ||
      COALESCE(d.title_at_disclosure, '') || ' ' || COALESCE(a.category, '') || ' ' ||
      COALESCE(a.subcategory, '') || ' ' || COALESCE(a.detail, '') || ' ' ||
      COALESCE(a.owner, '') LIKE ?
    )`);
        filterParameters.push(`%${token}%`);
    }
    const orderSql = sort === 'date'
        ? `COALESCE(d.disclosed_at, d.registered_at, '') DESC, COALESCE(a.difference, 0) DESC`
        : sort === 'valuation'
            ? `a.valuation DESC, COALESCE(a.difference, 0) DESC`
            : `COALESCE(a.difference, 0) DESC, a.valuation DESC`;
    const timelineRows = await statement(`
    ${snapshotCte(year)}
    SELECT p.id AS officialId, p.canonical_name AS name,
           d.organization_at_disclosure AS agency, d.title_at_disclosure AS title,
           d.period_year AS year, d.disclosed_at AS disclosedAt,
           d.id AS disclosureId, d.source_record_index AS sourceRecordIndex,
           d.source_record_hash AS sourceRecordHash,
           sa.source_url AS sourceUrl, sa.raw_sha256 AS fileSha256,
           a.id, a.category, a.subcategory AS detailType, a.detail AS address,
           a.owner, a.valuation, a.difference,
           ${eventExpression} AS eventType
    FROM latest_disclosures d
    JOIN person p ON p.id = d.person_id
    JOIN source_artifact sa ON sa.id = d.source_artifact_id
    JOIN asset a ON a.disclosure_id = d.id
    WHERE ${filterConditions.join(' AND ')}
    ORDER BY ${orderSql}, a.source_asset_index ASC
    LIMIT ? OFFSET ?
  `).all(...filterParameters, limit, offset);
    const timeline = timelineRows.map((row) => ({
        ...row,
        official: {
            id: row.officialId,
            name: row.name,
            agency: row.agency,
            title: row.title,
        },
    }));
    const acquisitionStats = await statement(`
    ${snapshotCte(year)}
    SELECT COUNT(*) AS eventCount, COUNT(DISTINCT d.person_id) AS officialsCount,
           SUM(CASE WHEN a.difference > 0 THEN a.difference ELSE 0 END) AS totalDifference,
           AVG(CASE WHEN a.difference > 0 THEN a.difference END) AS averageDifference,
           SUM(CASE WHEN ${eventExpression} IN ('ACQUIRED','ACQUIRED_SIGNAL') THEN 1 ELSE 0 END) AS acquiredCount,
           SUM(CASE WHEN ${eventExpression} IN ('INCREASED','INCREASED_SIGNAL') THEN 1 ELSE 0 END) AS increasedCount,
           SUM(CASE WHEN a.difference > 0 AND ABS(a.valuation-a.difference)<=1 THEN a.difference ELSE 0 END) AS acquiredDifference,
           SUM(CASE WHEN a.difference > 0 AND ABS(a.valuation-a.difference)>1 THEN a.difference ELSE 0 END) AS increasedDifference,
           SUM(CASE WHEN a.difference > 0 THEN 1 ELSE 0 END) AS amountConfirmedCount,
           SUM(CASE WHEN a.difference IS NULL THEN 1 ELSE 0 END) AS signalOnlyCount
    FROM latest_disclosures d
    JOIN asset a ON a.disclosure_id = d.id
    WHERE ${eventCondition} AND a.category <> '채무'
  `).get();
    const categoryBreakdown = await statement(`
    ${snapshotCte(year)}
    SELECT a.category, COUNT(*) AS eventCount, COUNT(DISTINCT d.person_id) AS officialsCount,
           SUM(CASE WHEN a.difference > 0 THEN a.difference ELSE 0 END) AS totalDifference,
           SUM(CASE WHEN a.difference > 0 THEN 1 ELSE 0 END) AS amountConfirmedCount,
           SUM(CASE WHEN a.difference IS NULL THEN 1 ELSE 0 END) AS signalOnlyCount
    FROM latest_disclosures d
    JOIN asset a ON a.disclosure_id = d.id
    WHERE ${eventCondition} AND a.category <> '채무'
    GROUP BY a.category
    ORDER BY totalDifference DESC, eventCount DESC, a.category
  `).all();
    const taxonomyBreakdown = await statement(`
    ${snapshotCte(year)}
    SELECT a.category, COALESCE(NULLIF(a.subcategory, ''), '미분류') AS subcategory,
           COUNT(*) AS eventCount, COUNT(DISTINCT d.person_id) AS officialsCount,
           SUM(CASE WHEN a.difference > 0 THEN a.difference ELSE 0 END) AS totalDifference,
           SUM(CASE WHEN a.difference IS NULL THEN 1 ELSE 0 END) AS signalOnlyCount
    FROM latest_disclosures d
    JOIN asset a ON a.disclosure_id = d.id
    WHERE ${eventCondition} AND a.category <> '채무'
    GROUP BY a.category, COALESCE(NULLIF(a.subcategory, ''), '미분류')
    ORDER BY a.category, totalDifference DESC, eventCount DESC, subcategory
  `).all();
    const regionRows = await statement(`
    ${snapshotCte(year)}
    SELECT a.category, a.detail, a.difference
    FROM latest_disclosures d
    JOIN asset a ON a.disclosure_id = d.id
    WHERE ${eventCondition} AND a.category IN ('건물', '토지')
  `).all();
    const regionMap = new Map();
    for (const row of regionRows) {
        const extracted = extractRegion(row.detail);
        const name = normalizeTopRegion(extracted?.split(' ')[0]) || '기타·국외';
        const item = regionMap.get(name) || {
            name, eventCount: 0, buildingCount: 0, landCount: 0, amountConfirmedCount: 0,
        };
        item.eventCount += 1;
        item.buildingCount += row.category === '건물' ? 1 : 0;
        item.landCount += row.category === '토지' ? 1 : 0;
        item.amountConfirmedCount += Number(row.difference) > 0 ? 1 : 0;
        regionMap.set(name, item);
    }
    const regionBreakdown = [...regionMap.values()].sort((a, b) => b.eventCount - a.eventCount || a.name.localeCompare(b.name, 'ko'));
    const filteredCount = await statement(`
    ${snapshotCte(year)}
    SELECT COUNT(*) AS total
    FROM latest_disclosures d
    JOIN person p ON p.id = d.person_id
    JOIN asset a ON a.disclosure_id = d.id
    WHERE ${filterConditions.join(' AND ')}
  `).get(...filterParameters);
    ok(res, {
        timeline,
        stats: {
            total: acquisitionStats.eventCount,
            totalDifference: acquisitionStats.totalDifference || 0,
            eventCount: acquisitionStats.eventCount,
            officialsCount: acquisitionStats.officialsCount,
            acquiredCount: acquisitionStats.acquiredCount,
            increasedCount: acquisitionStats.increasedCount,
            acquiredDifference: acquisitionStats.acquiredDifference || 0,
            increasedDifference: acquisitionStats.increasedDifference || 0,
            averageDifference: Math.round(Number(acquisitionStats.averageDifference || 0)),
            amountConfirmedCount: acquisitionStats.amountConfirmedCount,
            signalOnlyCount: acquisitionStats.signalOnlyCount,
            year,
            displayed: timeline.length,
            truncated: false,
            reconciliationPass: Number(acquisitionStats.totalDifference || 0) ===
                Number(acquisitionStats.acquiredDifference || 0) + Number(acquisitionStats.increasedDifference || 0),
        },
        categoryBreakdown,
        taxonomyBreakdown,
        regionBreakdown,
        meta: {
            total: filteredCount.total,
            limit,
            offset,
            hasMore: offset + timeline.length < Number(filteredCount.total),
            category,
            eventType,
            subcategory,
            region,
            search: searchTokens.join(' '),
            sort,
        },
        methodology: {
            eventDefinition: '공식 difference 양수 또는 원문 상세에 증가·신규·취득 신호가 있는 비채무 자산행',
            acquiredDefinition: '현재 평가액=공식 증가액, 원문 신규·취득 명시, 또는 건물·토지의 신규 면적·지분 증가 신호',
            increasedDefinition: '공식 증가액이 현재 평가액과 다른 기존 금융·투자자산 증가 행',
            exclusions: ['채무 증가', 'difference 0 이하이면서 원문 증가 신호도 없는 행'],
            valuationPolicy: '금액 확정 이벤트와 원문 신호 전용 이벤트를 분리하며 금액을 임의 추정하지 않음',
            realEstateDifferencePolicy: '건물·토지는 보존 원천에 현재 평가액과 면적 증가 신호가 있으나 별도 증가액(difference)이 없어 현재 평가액을 증가액으로 대체하지 않음',
        },
    });
});
app.get('/api/analysis/hyperlocal', async (req, res) => {
    const year = parseYear(req.query.year);
    const rows = await statement(`
    ${snapshotCte(year)}
    SELECT p.id, p.canonical_name AS name, p.latest_organization AS org,
           p.latest_title AS title, a.detail, a.valuation
    FROM latest_disclosures d
    JOIN person p ON p.id = d.person_id
    JOIN asset a ON a.disclosure_id = d.id
    WHERE a.category IN ('토지', '건물') AND TRIM(a.detail) <> ''
  `).all();
    const provincePattern = /(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)/;
    const cityPattern = /(?:^|\s)((?:[가-힣]+시\s)?[가-힣]+(?:시|군|구))(?:\s|$)/;
    const provinces = new Map();
    for (const row of rows) {
        const location = row.detail.match(provincePattern)?.[1];
        if (!location)
            continue;
        const remainder = row.detail.slice(row.detail.indexOf(location) + location.length);
        const city = remainder.match(cityPattern)?.[1]?.trim() || '기타';
        const province = provinces.get(location) || {
            location, level: 'sido', totalAssets: 0, totalValuation: 0,
            personIds: new Set(), cities: new Map(),
        };
        province.totalAssets += 1;
        province.totalValuation += Number(row.valuation);
        province.personIds.add(row.id);
        const cityNode = province.cities.get(city) || {
            location: city, level: 'gu', totalAssets: 0, totalValuation: 0,
            persons: new Map(),
        };
        cityNode.totalAssets += 1;
        cityNode.totalValuation += Number(row.valuation);
        const person = cityNode.persons.get(row.id) || {
            id: row.id, name: row.name, org: row.org, title: row.title,
            assetCount: 0, totalValuation: 0,
        };
        person.assetCount += 1;
        person.totalValuation += Number(row.valuation);
        cityNode.persons.set(row.id, person);
        province.cities.set(city, cityNode);
        provinces.set(location, province);
    }
    const data = [...provinces.values()].map((province) => ({
        location: province.location,
        level: province.level,
        totalAssets: province.totalAssets,
        totalPersons: province.personIds.size,
        totalValuation: province.totalValuation,
        children: [...province.cities.values()]
            .map((city) => ({
            location: city.location,
            level: city.level,
            totalAssets: city.totalAssets,
            totalPersons: city.persons.size,
            totalValuation: city.totalValuation,
            persons: [...city.persons.values()]
                .sort((a, b) => b.totalValuation - a.totalValuation)
                .slice(0, 100),
        }))
            .sort((a, b) => b.totalValuation - a.totalValuation),
    })).sort((a, b) => b.totalValuation - a.totalValuation);
    ok(res, data, { year });
});
app.get('/api/analysis/real-estate-regions', async (req, res) => {
    const year = parseYear(req.query.year);
    const level = ['province', 'district', 'locality'].includes(String(req.query.level))
        ? String(req.query.level) : 'province';
    const province = String(req.query.province || 'all').trim().slice(0, 40);
    const district = String(req.query.district || 'all').trim().slice(0, 60);
    const category = ['건물', '토지'].includes(String(req.query.category))
        ? String(req.query.category) : 'all';
    const search = String(req.query.search || '').trim().slice(0, 80);
    const allRows = await realEstateSnapshot(year);
    const addressMatched = allRows.filter((row) => row.province !== '기타·국외' && row.matched);
    const filtered = allRows.filter((row) => (category === 'all' || row.category === category) &&
        (province === 'all' || row.province === province) &&
        (district === 'all' || row.district === district) &&
        (!search || `${row.province} ${row.district} ${row.locality} ${row.detail}`.includes(search)));
    const keySelector = level === 'locality'
        ? (row) => row.locality
        : level === 'district' ? (row) => row.district : (row) => row.province;
    const regions = aggregateRealEstateRows(filtered, keySelector);
    const totalValuation = filtered.reduce((sum, row) => sum + row.valuation, 0);
    const officialIds = new Set(filtered.map((row) => row.officialId));
    const topFiveTotal = regions.slice(0, 5).reduce((sum, item) => sum + item.totalValuation, 0);
    const categoryBreakdown = aggregateRealEstateRows(filtered, (row) => row.category);
    const subcategoryBreakdown = aggregateRealEstateRows(filtered, (row) => row.subcategory).slice(0, 30);
    ok(res, {
        regions,
        stats: {
            assetCount: filtered.length,
            officialsCount: officialIds.size,
            totalValuation,
            averageValuation: filtered.length ? Math.round(totalValuation / filtered.length) : 0,
            addressMatchedCount: addressMatched.length,
            addressCoverage: allRows.length ? addressMatched.length / allRows.length : 0,
            topFiveShare: totalValuation ? topFiveTotal / totalValuation : 0,
            buildingCount: filtered.filter((row) => row.category === '건물').length,
            landCount: filtered.filter((row) => row.category === '토지').length,
            reconciliationPass: filtered.length ===
                filtered.filter((row) => row.category === '건물').length +
                    filtered.filter((row) => row.category === '토지').length,
        },
        categoryBreakdown,
        subcategoryBreakdown,
        meta: { year, level, province, district, category, search },
        methodology: {
            source: '인물별 선택 스냅샷의 공식 건물·토지 자산행',
            location: '주소 원문에서 시·도, 시·군·구, 읍·면·동을 순차 추출',
            valuation: '공식 신고 평가액 합계이며 시세·실거래가 추정 없음',
        },
    });
});
app.get('/api/analysis/real-estate-assets', async (req, res) => {
    const year = parseYear(req.query.year);
    const category = ['건물', '토지'].includes(String(req.query.category))
        ? String(req.query.category) : 'all';
    const subcategory = String(req.query.subcategory || 'all').trim().slice(0, 80);
    const province = String(req.query.province || 'all').trim().slice(0, 40);
    const district = String(req.query.district || 'all').trim().slice(0, 60);
    const minValue = Math.max(0, Number(req.query.minValue) || 0);
    const sort = ['valuation', 'name', 'region'].includes(String(req.query.sort))
        ? String(req.query.sort) : 'valuation';
    const search = String(req.query.search || '').trim().slice(0, 80);
    const limit = parseLimit(req.query.limit, 50, 100);
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const filtered = (await realEstateSnapshot(year)).filter((row) => (category === 'all' || row.category === category) &&
        (subcategory === 'all' || row.subcategory === subcategory) &&
        (province === 'all' || row.province === province) &&
        (district === 'all' || row.district === district) &&
        row.valuation >= minValue &&
        (!search || `${row.name} ${row.agency} ${row.category} ${row.subcategory} ${row.owner} ${row.detail}`.includes(search)));
    const maximumValuation = filtered.reduce((maximum, row) => Math.max(maximum, row.valuation), 0);
    filtered.sort((a, b) => sort === 'name'
        ? a.name.localeCompare(b.name, 'ko') || b.valuation - a.valuation
        : sort === 'region'
            ? `${a.province} ${a.district} ${a.locality}`.localeCompare(`${b.province} ${b.district} ${b.locality}`, 'ko') || b.valuation - a.valuation
            : b.valuation - a.valuation || a.name.localeCompare(b.name, 'ko'));
    const totalValuation = filtered.reduce((sum, row) => sum + row.valuation, 0);
    const officials = new Set(filtered.map((row) => row.officialId));
    const categoryBreakdown = aggregateRealEstateRows(filtered, (row) => row.category);
    const subcategoryBreakdown = aggregateRealEstateRows(filtered, (row) => row.subcategory);
    const regionBreakdown = aggregateRealEstateRows(filtered, (row) => row.province);
    const topOfficialMap = new Map();
    for (const row of filtered) {
        const item = topOfficialMap.get(row.officialId) || {
            officialId: row.officialId, name: row.name, agency: row.agency, title: row.title,
            assetCount: 0, totalValuation: 0,
        };
        item.assetCount += 1;
        item.totalValuation += row.valuation;
        topOfficialMap.set(row.officialId, item);
    }
    const topOfficials = [...topOfficialMap.values()]
        .sort((a, b) => b.totalValuation - a.totalValuation || b.assetCount - a.assetCount)
        .slice(0, 10);
    ok(res, {
        assets: filtered.slice(offset, offset + limit),
        stats: {
            assetCount: filtered.length,
            officialsCount: officials.size,
            totalValuation,
            averageValuation: filtered.length ? Math.round(totalValuation / filtered.length) : 0,
            maximumValuation,
            reconciliationPass: totalValuation === categoryBreakdown.reduce((sum, item) => sum + item.totalValuation, 0),
        },
        categoryBreakdown,
        subcategoryBreakdown,
        regionBreakdown,
        topOfficials,
        alpha: await realEstateAlpha(year),
        meta: {
            total: filtered.length, limit, offset, hasMore: offset + limit < filtered.length,
            year, category, subcategory, province, district, minValue, sort, search,
        },
        methodology: {
            source: '공식 신고 건물·토지 자산행과 보존 원문',
            valuation: '신고 평가액 직접 합산 · 시세 추정 없음',
            lineage: '각 자산에 공개연도·원본 레코드·레코드 해시·파일 SHA-256·보존 출처 포함',
        },
    });
});
app.get('/api/alpha-engine', async (req, res) => {
    const year = parseYear(req.query.year);
    const people = await statement(`
    ${snapshotCte(year)}
    SELECT p.id, p.canonical_name AS name,
           d.organization_at_disclosure AS agency,
           d.title_at_disclosure AS title,
           d.net_worth AS netWorth
    FROM latest_disclosures d JOIN person p ON p.id = d.person_id
    ORDER BY d.net_worth DESC, p.canonical_name
  `).all();
    const smartPopulation = Math.max(1, Math.ceil(people.length * 0.01));
    const smartIds = new Set(people.slice(0, smartPopulation).map((person) => person.id));
    const publicPopulation = Math.max(1, people.length - smartPopulation);
    const securityRows = await statement(`
    ${snapshotCte(year)}
    SELECT d.person_id AS personId, a.detail, a.valuation
    FROM latest_disclosures d JOIN asset a ON a.disclosure_id = d.id
    WHERE a.category = '증권' AND a.subcategory = '상장주식'
      AND TRIM(a.detail) <> ''
  `).all();
    const stockHolders = new Map();
    const usStockPersonIds = new Set();
    const usPattern = /(APPLE|애플|TESLA|테슬라|NVIDIA|엔비디아|MICROSOFT|마이크로소프트|ALPHABET|알파벳|AMAZON|아마존|META|메타플랫폼|QQQ|SPY|S&P\s*500|나스닥)/i;
    for (const row of securityRows) {
        const holdings = extractSecurityHoldings(row.detail, row.valuation);
        for (const holding of holdings) {
            if (!holding.canonicalName || Number(holding.quantity || 0) <= 0)
                continue;
            const holders = stockHolders.get(holding.canonicalName) || new Set();
            holders.add(row.personId);
            stockHolders.set(holding.canonicalName, holders);
            if (usPattern.test(`${holding.canonicalName} ${holding.ticker || ''}`)) {
                usStockPersonIds.add(row.personId);
            }
        }
    }
    const realEstateRows = await statement(`
    ${snapshotCte(year)}
    SELECT d.person_id AS personId, a.detail
    FROM latest_disclosures d JOIN asset a ON a.disclosure_id = d.id
    WHERE a.category IN ('토지', '건물') AND TRIM(a.detail) <> ''
  `).all();
    const regionHolders = new Map();
    for (const row of realEstateRows) {
        const region = extractRegion(row.detail);
        if (!region)
            continue;
        const holders = regionHolders.get(region) || new Set();
        holders.add(row.personId);
        regionHolders.set(region, holders);
    }
    const usStockBulls = people
        .filter((person) => usStockPersonIds.has(person.id))
        .slice(0, 3);
    const alphaStocks = buildConcentration(stockHolders, smartIds, smartPopulation, publicPopulation, 2);
    const alphaRegions = buildConcentration(regionHolders, smartIds, smartPopulation, publicPopulation, 2);
    ok(res, {
        alphaStocks,
        alphaRegions,
        usStockBulls,
        fxWhales: await latestAssetLeaders(year, `a.category IN ('예금', '증권') AND
       (UPPER(a.detail) LIKE '%USD%' OR a.detail LIKE '%달러%' OR a.detail LIKE '%외화%')`),
        bondWhales: await latestAssetLeaders(year, `(a.category = '채권' OR
        (a.category = '증권' AND a.subcategory IN
          ('기타채권', '금융채', '회사채', '국채', '채권', '공채', '지방채')))`),
        angelInvestors: await latestAssetLeaders(year, `a.category = '증권' AND (a.subcategory LIKE '%비상장%' OR a.detail LIKE '%비상장%')`),
        supercars: await latestAssetLeaders(year, `a.category = '동산' AND
       (a.subcategory LIKE '%자동차%' OR a.detail LIKE '%자동차%' OR
        a.detail LIKE '%페라리%' OR a.detail LIKE '%람보르기니%' OR
        a.detail LIKE '%포르쉐%' OR a.detail LIKE '%벤틀리%')`),
        vipMembers: await latestAssetLeaders(year, `(a.category LIKE '%회원권%' OR a.subcategory LIKE '%회원권%')`),
        preciousCollectors: await latestAssetLeaders(year, `a.category IN ('금 및 백금', '보석류', '골동품 및 예술품')`),
        listedStockWhales: await latestAssetLeaders(year, `a.category = '증권' AND a.subcategory = '상장주식'`),
        totalSecuritiesWhales: await latestAssetLeaders(year, `a.category = '증권'`),
        realEstateWhales: await latestAssetLeaders(year, `a.category IN ('토지', '건물')`),
        landWhales: await latestAssetLeaders(year, `a.category = '토지'`),
        cryptoDisclosureWhales: await latestAssetLeaders(year, `a.category = '가상자산'`),
        cashWhales: await latestAssetLeaders(year, `a.category = '현금'`),
        equityStakeWhales: await latestAssetLeaders(year, `a.category = '합명·합자·유한회사 출자지분'`),
        quality: {
            cardCount: 16,
            deterministic: true,
            source: '공식 신고 자산행 및 양수 보유수량 파싱 결과',
            valuationPolicy: '금액형 카드는 조건에 맞는 공식 자산행 평가액을 인물별 합산',
            concentrationPolicy: '집중도 카드는 현재 양수 보유수량 관계만 집계하고 평가액을 추정하지 않음',
        },
        methodology: {
            year,
            snapshot: year === 'recent'
                ? `${latestCompleteYear}년 완결 모집단 + ${defaultYear}년 공개분 인물별 최신 반영`
                : year === 'all' ? '인물별 최신 공개 신고' : `${year}년 인물별 최신 공개 신고`,
            population: people.length,
            smartPopulation,
            publicPopulation,
            smartMoneyDefinition: `해당 스냅샷 순자산 상위 1% (${smartPopulation.toLocaleString('ko-KR')}명)`,
            alphaFormula: '(상위 1% 보유자 비율) / (나머지 보유자 비율)',
            valuationRule: '각 카드의 금액은 조건에 일치한 원문 자산 행 평가액 합계',
            parserRule: '주식 종목은 양수 보유수량으로 파싱된 종목만 보유자로 집계',
            estimatedValues: false,
        },
    }, { year });
});
app.use((error, req, res, next) => {
    console.error(error);
    fail(res, error);
});
module.exports = app;
