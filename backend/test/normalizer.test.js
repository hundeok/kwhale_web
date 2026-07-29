const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCategory,
  parseKrwAmount,
  normalizeSecurityName,
  calculateTotals
} = require('../lib/normalizer');
const { compareSnapshots, rankChanges } = require('../lib/change-engine');
const { extractSecurityHoldings, extractCryptoHoldings, splitItems } = require('../lib/holding-extractor');
const { parseMoneyComponents, parseRealEstate, parseVehicle } = require('../lib/asset-parser');
const { buildInstrumentAlpha } = require('../lib/instrument-alpha');

test('정치자금 예금은 금융자산/예금으로 통합한다', () => {
  assert.deepEqual(
    normalizeCategory('정치자금법에 따른 정치자금의 수입 및 지출을 위한 예금계좌의 예금').category,
    '예금·보험'
  );
});

test('공시 금액 단위를 원 단위 bigint로 변환한다', () => {
  assert.equal(parseKrwAmount('12,345천원'), 12_345_000n);
  assert.equal(parseKrwAmount('3.5억'), 350_000_000n);
});

test('채무는 양수 원문 금액이어도 순자산에서 차감한다', () => {
  assert.deepEqual(
    calculateTotals([
      { category: '예금', valuation: 100_000_000n },
      { category: '채무', valuation: 30_000_000n }
    ]),
    { grossAssets: 100_000_000n, liabilities: 30_000_000n, netWorth: 70_000_000n }
  );
});

test('종목명과 티커를 분리한다', () => {
  assert.deepEqual(normalizeSecurityName('해외주식 Apple (AAPL) 12주'), {
    name: 'Apple',
    ticker: 'AAPL',
    confidence: 0.95
  });
});

test('법인 표기와 대표 종목 별칭을 하나의 정규명으로 통합한다', () => {
  assert.equal(normalizeSecurityName('회사 에스케이하이닉스 10주').name, 'SK하이닉스');
  assert.equal(normalizeSecurityName('중소기업은행 10주').name, 'IBK기업은행');
  assert.equal(normalizeSecurityName('APPLE INC 10주').name, '애플');
  assert.equal(normalizeSecurityName('삼성전자보통주 10주').name, '삼성전자');
});

test('연도 스냅샷은 신규·처분·증감을 재현 가능하게 계산한다', () => {
  const result = compareSnapshots(
    [{ id: 'a', officialId: 'o', category: '예금', detailType: '은행', owner: '본인', address: 'A', valuation: 10n }],
    [
      { id: 'b', officialId: 'o', category: '예금', detailType: '은행', owner: '본인', address: 'A', valuation: 15n },
      { id: 'c', officialId: 'o', category: '증권', detailType: '주식', owner: '본인', address: 'B', valuation: 4n }
    ]
  );
  assert.deepEqual(result.map(item => item.action).sort(), ['ACQUIRED', 'INCREASED']);
});

test('수익률 정렬은 랜덤 값 없이 결정적이다', () => {
  const input = [
    { name: '가', previousNetWorth: 100n, currentNetWorth: 120n },
    { name: '나', previousNetWorth: 100n, currentNetWorth: 150n }
  ];
  assert.equal(rankChanges(input, 'yield')[0].name, '나');
});

test('여러 종목이 한 행에 있으면 전체 평가액을 각 종목에 중복 배분하지 않는다', () => {
  const holdings = extractSecurityHoldings('삼성전자 100주\n카카오 50주', 50_000_000n);
  assert.equal(holdings.length, 2);
  assert.equal(holdings[0].declaredValuation, null);
  assert.equal(holdings[1].declaredValuation, null);
  assert.equal(holdings[0].allocationMethod, 'UNALLOCATED_MULTI_INSTRUMENT');
});

test('안랩 단일 종목 신고는 전액 직접 귀속하고 회계 총액을 보존한다', () => {
  const valuation = 111_786_000_000n;
  const holdings = extractSecurityHoldings('안랩 1,860,000주', valuation);
  assert.equal(holdings.length, 1);
  assert.equal(holdings[0].canonicalName, '안랩');
  assert.equal(holdings[0].quantity, 1_860_000);
  assert.equal(holdings[0].declaredValuation, valuation);
  assert.equal(holdings[0].allocationMethod, 'SINGLE_INSTRUMENT_ASSET');
  assert.equal(holdings.reduce((sum, item) => sum + (item.declaredValuation || 0n), 0n), valuation);
});

test('복수 주식 신고는 종목명과 보유량만 추출하고 신고액을 중복 귀속하지 않는다', () => {
  const valuation = 225_747_000n;
  const holdings = extractSecurityHoldings(
    'LG에너지솔루션 38주, 강원랜드 1,302주, 동아엘텍 2,334주',
    valuation
  );
  assert.equal(holdings.length, 3);
  assert.deepEqual(holdings.map((item) => item.canonicalName), ['LG에너지솔루션', '강원랜드', '동아엘텍']);
  assert.deepEqual(holdings.map((item) => item.quantity), [38, 1302, 2334]);
  assert.ok(holdings.every((item) => item.declaredValuation === null));
  assert.equal(holdings.reduce((sum, item) => sum + (item.declaredValuation || 0n), 0n), 0n);
});

test('현재 수량과 증가 수량이 같으면 신규 취득 신호로 판정할 수 있다', () => {
  const [holding] = extractSecurityHoldings('엔비디아 11주(11주 증가)', 2_000_000n);
  assert.equal(holding.quantity, 11);
  assert.equal(holding.changeQuantity, 11);
  assert.equal(holding.changeType, 'INCREASED');
  assert.equal(holding.quantity === holding.changeQuantity, true);
});

test('알파 엔진은 결정론적이며 표본·신뢰도·산식을 함께 반환한다', () => {
  const fixtures = [
    {
      name: '알파', valuation: 100_000_000, count: 20, valuedHolderCount: 10,
      unallocatedHolderCount: 10, holderCoverage: 0.5, confidenceScore: 0.9,
      topHolderVal: 30_000_000, allocatedPositions: 10, unallocatedPositions: 10,
      acquiredPositions: 7, increasedPositions: 5, decreasedPositions: 2,
    },
    {
      name: '베타', valuation: 80_000_000, count: 15, valuedHolderCount: 12,
      unallocatedHolderCount: 3, holderCoverage: 0.8, confidenceScore: 0.82,
      topHolderVal: 20_000_000, allocatedPositions: 12, unallocatedPositions: 3,
      acquiredPositions: 3, increasedPositions: 2, decreasedPositions: 8,
    },
    {
      name: '감마', valuation: 0, count: 30, valuedHolderCount: 0,
      unallocatedHolderCount: 30, holderCoverage: 0, confidenceScore: 0.75,
      topHolderVal: 0, allocatedPositions: 0, unallocatedPositions: 30,
      acquiredPositions: 1, increasedPositions: 1, decreasedPositions: 3,
    },
  ];
  const first = buildInstrumentAlpha(fixtures, '종목');
  const second = buildInstrumentAlpha(fixtures, '종목');
  assert.deepEqual(first, second);
  assert.equal(first.engineVersion, '1.0.0');
  assert.equal(first.deterministic, true);
  assert.ok(first.insights.length >= 10);
  assert.ok(first.insights.every((item) =>
    item.sampleSize >= 0 &&
    item.confidence >= 0 && item.confidence <= 1 &&
    item.methodology && item.caveat
  ));
  assert.equal(
    first.insights.find((item) => item.key === 'acquisition-leader').name,
    '알파'
  );
});

test('천 단위 쉼표는 유지하고 종목 구분 쉼표만 분리한다', () => {
  assert.deepEqual(
    splitItems('SK스퀘어 0주(30주 감소), 동양철관 0주(3,100주 감소), 이스타코 2,517주(2,500주 증가)'),
    ['SK스퀘어 0주(30주 감소)', '동양철관 0주(3,100주 감소)', '이스타코 2,517주(2,500주 증가)']
  );
});

test('실제 증권 문자열에서 종목·수량·증감을 분리한다', () => {
  const holdings = extractSecurityHoldings(
    'NAVER보통주 0주(430주 감소), 카카오게임즈 1,000주, 카카오페이보통주 120주',
    24_618_000n
  );
  assert.deepEqual(
    holdings.map(item => ({
      name: item.canonicalName,
      quantity: item.quantity,
      changeQuantity: item.changeQuantity,
      changeType: item.changeType
    })),
    [
      { name: 'NAVER', quantity: 0, changeQuantity: 430, changeType: 'DECREASED' },
      { name: '카카오게임즈', quantity: 1000, changeQuantity: null, changeType: null },
      { name: '카카오페이', quantity: 120, changeQuantity: null, changeType: null }
    ]
  );
});

test('실제 가상자산 문자열에서 소수·천 단위 수량과 증감을 분리한다', () => {
  const holdings = extractCryptoHoldings(
    '도지코인 16,837.87152154개(16,837.87152154개 증가), 리플 401.90823363개',
    1_000_000n
  );
  assert.deepEqual(
    holdings.map(item => ({
      name: item.canonicalName,
      quantity: item.quantity,
      changeQuantity: item.changeQuantity,
      changeType: item.changeType
    })),
    [
      { name: '도지코인', quantity: 16837.87152154, changeQuantity: 16837.87152154, changeType: 'INCREASED' },
      { name: '리플', quantity: 401.90823363, changeQuantity: null, changeType: null }
    ]
  );
});

test('김홍수 복수 코인 신고는 총액을 어느 코인에도 임의 배분하지 않는다', () => {
  const valuation = 12_523_638_000n;
  const holdings = extractCryptoHoldings(
    'OES 195,565.732941개(10.352941개 증가), 도너클 240,000개',
    valuation
  );
  assert.deepEqual(holdings.map(item => item.canonicalName), ['OES', '도너클']);
  assert.deepEqual(holdings.map(item => item.quantity), [195565.732941, 240000]);
  assert.ok(holdings.every(item => item.declaredValuation === null));
  assert.ok(holdings.every(item => item.allocationMethod === 'UNALLOCATED_MULTI_INSTRUMENT'));
  assert.equal(holdings.reduce((sum, item) => sum + (item.declaredValuation || 0n), 0n), 0n);
});

test('비트코인 단일 코인 신고만 해당 코인에 전액 직접 귀속한다', () => {
  const valuation = 210_000_000n;
  const [holding] = extractCryptoHoldings('비트코인 1.25개', valuation);
  assert.equal(holding.canonicalName, '비트코인');
  assert.equal(holding.declaredValuation, valuation);
  assert.equal(holding.allocationMethod, 'SINGLE_INSTRUMENT_ASSET');
});

test('예금 기관별 잔액과 증감액을 원 단위로 추출한다', () => {
  const components = parseMoneyComponents('KB라이프생명보험 39,086(703 증가), 신한은행 540,100(100,688 증가)');
  assert.deepEqual(components.map(item => ({
    name: item.name,
    amount: item.amount,
    changeAmount: item.changeAmount,
    changeType: item.changeType
  })), [
    { name: 'KB라이프생명보험', amount: 39_086_000n, changeAmount: 703_000n, changeType: 'INCREASED' },
    { name: '신한은행', amount: 540_100_000n, changeAmount: 100_688_000n, changeType: 'INCREASED' }
  ]);
});

test('증감 표기가 없는 괄호형 예금 원문도 기관별 현재액을 분리한다', () => {
  const components = parseMoneyComponents(
    '(주)KEB하나은행 529(360 ), 농협은행 305,936(31,819 ), 한국교직원공제회 231,828(11,130 )'
  );
  assert.deepEqual(components.map(item => [item.name, item.amount]), [
    ['(주)KEB하나은행', 529_000n],
    ['농협은행', 305_936_000n],
    ['한국교직원공제회', 231_828_000n],
  ]);
});

test('부동산 지번과 전체·소유 면적을 분리한다', () => {
  assert.deepEqual(parseRealEstate('충청남도 홍성군 갈산면 운곡리 320번지 912.00㎡ 중 456.00㎡', '전'), {
    addressText: '충청남도 홍성군 갈산면 운곡리 320번지',
    lotNumber: '320번지',
    propertyType: '전',
    totalAreaSqm: 912,
    ownedAreaSqm: 456,
    confidence: 0.9
  });
});

test('자동차 연식·모델·배기량을 분리한다', () => {
  assert.deepEqual(parseVehicle('2011년식 AZERA 배기량(3,778cc)'), {
    modelYear: 2011,
    model: 'AZERA',
    displacementCc: 3778,
    confidence: 0.9
  });
});
