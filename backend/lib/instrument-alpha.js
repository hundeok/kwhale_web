const ALPHA_ENGINE_VERSION = '1.0.0';

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function money(value) {
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}조`;
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
  if (value >= 10_000) return `${(value / 10_000).toLocaleString('ko-KR')}만`;
  return Math.round(value).toLocaleString('ko-KR');
}

function coverage(item) {
  return clamp(number(item.holderCoverage));
}

function confidence(item) {
  return clamp(number(item.confidenceScore));
}

function changeTotal(item) {
  return number(item.acquiredPositions) + number(item.increasedPositions) +
    number(item.decreasedPositions);
}

function inflow(item) {
  return number(item.acquiredPositions) + number(item.increasedPositions) -
    number(item.decreasedPositions);
}

function topShare(item) {
  return number(item.valuation) > 0 ? clamp(number(item.topHolderVal) / number(item.valuation)) : 1;
}

function deterministicPick(items, score, direction = 'desc') {
  return [...items].sort((left, right) => {
    const scoreDifference = score(right) - score(left);
    if (Math.abs(scoreDifference) > Number.EPSILON) {
      return direction === 'desc' ? scoreDifference : -scoreDifference;
    }
    const sampleDifference = number(right.count) - number(left.count);
    if (sampleDifference) return sampleDifference;
    return String(left.name).localeCompare(String(right.name), 'ko');
  })[0] || null;
}

function evidenceConfidence(item, sampleSize, extraQuality = 0) {
  const sampleStrength = clamp(Math.log10(Math.max(1, sampleSize) + 1) / 2);
  return clamp(
    0.2 + sampleStrength * 0.35 + coverage(item) * 0.2 +
    confidence(item) * 0.2 + extraQuality * 0.05
  );
}

function grade(value) {
  if (value >= 0.8) return 'HIGH';
  if (value >= 0.62) return 'MEDIUM';
  return 'EXPLORATORY';
}

function buildInsight(spec, universe) {
  const candidates = universe.filter(spec.filter);
  const winner = deterministicPick(candidates, spec.score, spec.direction);
  if (!winner) return null;
  const sampleSize = Math.max(0, Math.round(spec.sample(winner)));
  const evidence = evidenceConfidence(winner, sampleSize, spec.extraQuality?.(winner) || 0);
  return {
    key: spec.key,
    title: spec.title,
    name: winner.name,
    detail: spec.detail(winner),
    score: spec.score(winner),
    sampleSize,
    confidence: Number(evidence.toFixed(4)),
    confidenceGrade: grade(evidence),
    methodology: spec.methodology,
    caveat: spec.caveat,
  };
}

function buildInstrumentAlpha(items = [], noun = '종목') {
  const active = items.filter((item) => number(item.count) > 0);
  const specs = [
    {
      key: 'acquisition-leader', title: '신규 취득 신호 최다',
      filter: (x) => number(x.acquiredPositions) > 0,
      score: (x) => number(x.acquiredPositions), sample: (x) => number(x.acquiredPositions),
      detail: (x) => `${number(x.acquiredPositions).toLocaleString('ko-KR')}개 신규 관계`,
      methodology: '현재 보유수량과 증가수량이 같거나 원문이 신규로 표시된 관계 수',
      caveat: '신고서의 수량 변동 신호이며 실제 거래 체결 시점과 다를 수 있음',
    },
    {
      key: 'increase-leader', title: '보유 증가 신호 최다',
      filter: (x) => number(x.increasedPositions) > 0,
      score: (x) => number(x.increasedPositions), sample: (x) => number(x.increasedPositions),
      detail: (x) => `${number(x.increasedPositions).toLocaleString('ko-KR')}개 증가 관계`,
      methodology: '신규 취득을 제외한 보유수량 증가 관계 수',
      caveat: '수량 증가 원인을 시장 매수로 단정하지 않음',
    },
    {
      key: 'decrease-leader', title: '보유 감소 신호 최다',
      filter: (x) => number(x.decreasedPositions) > 0,
      score: (x) => number(x.decreasedPositions), sample: (x) => number(x.decreasedPositions),
      detail: (x) => `${number(x.decreasedPositions).toLocaleString('ko-KR')}개 감소 관계`,
      methodology: '보유수량 감소 관계 수',
      caveat: '감소에는 매도 외 이전·합병·신고변경이 포함될 수 있음',
    },
    {
      key: 'net-inflow', title: '순유입 모멘텀 1위',
      filter: (x) => changeTotal(x) >= 5,
      score: inflow, sample: changeTotal,
      detail: (x) => `순증가 신호 ${inflow(x).toLocaleString('ko-KR')}`,
      methodology: '신규 관계 + 증가 관계 - 감소 관계',
      caveat: '관계 수 기반 신호이며 투자금액 기반 자금흐름이 아님',
    },
    {
      key: 'disposal-pressure', title: '처분 압력 1위',
      filter: (x) => changeTotal(x) >= 5,
      score: (x) => number(x.decreasedPositions) / changeTotal(x), sample: changeTotal,
      detail: (x) => `감소 신호 비중 ${(number(x.decreasedPositions) / changeTotal(x) * 100).toFixed(1)}%`,
      methodology: '감소 관계 / 전체 변동 관계, 최소 표본 5건',
      caveat: '소규모 표본의 극단값은 신뢰등급으로 제한',
    },
    {
      key: 'valued-breadth', title: '금액 확인 보유자 최다',
      filter: (x) => number(x.valuedHolderCount) > 0,
      score: (x) => number(x.valuedHolderCount), sample: (x) => number(x.valuedHolderCount),
      detail: (x) => `${number(x.valuedHolderCount).toLocaleString('ko-KR')}명 금액 확인`,
      methodology: '해당 자산에 신고가액을 직접 귀속할 수 있는 고유 보유자 수',
      caveat: '복수 자산 합산 신고 보유자는 제외',
    },
    {
      key: 'unallocated-breadth', title: '미배분 관계 최다',
      filter: (x) => number(x.unallocatedHolderCount) > 0,
      score: (x) => number(x.unallocatedHolderCount), sample: (x) => number(x.unallocatedHolderCount),
      detail: (x) => `${number(x.unallocatedHolderCount).toLocaleString('ko-KR')}명 추가 분석 대상`,
      methodology: '자산명은 식별됐지만 개별 신고가액을 귀속하지 못한 고유 보유자 수',
      caveat: '보유 사실 신호이며 해당 자산의 금액으로 합산하지 않음',
    },
    {
      key: 'coverage-high', title: '금액 확인률 최고',
      filter: (x) => number(x.count) >= 10,
      score: coverage, sample: (x) => number(x.count),
      detail: (x) => `${(coverage(x) * 100).toFixed(1)}% · 보유자 10명+`,
      methodology: '금액 확인 보유자 / 전체 식별 보유자, 최소 10명',
      caveat: '원문 신고 형식에 따른 데이터 완성도 지표',
    },
    {
      key: 'coverage-low', title: '금액 확인률 최저',
      filter: (x) => number(x.count) >= 10,
      score: coverage, direction: 'asc', sample: (x) => number(x.count),
      detail: (x) => `${(coverage(x) * 100).toFixed(1)}% · 보유자 10명+`,
      methodology: '금액 확인 보유자 / 전체 식별 보유자, 최소 10명',
      caveat: '낮은 값은 투자 부진이 아니라 원문 금액 배분 한계를 뜻함',
    },
    {
      key: 'parser-high', title: '명칭 파서 신뢰도 최고',
      filter: (x) => number(x.count) >= 5,
      score: confidence, sample: (x) => number(x.count),
      detail: (x) => `${(confidence(x) * 100).toFixed(1)}% · 표본 5명+`,
      methodology: '명칭·티커 정규화 신뢰도 평균, 최소 5명',
      caveat: '시장 데이터의 종목코드 검증률과는 별도',
    },
    {
      key: 'parser-review', title: '명칭 검토 우선',
      filter: (x) => number(x.count) >= 5,
      score: confidence, direction: 'asc', sample: (x) => number(x.count),
      detail: (x) => `${(confidence(x) * 100).toFixed(1)}% · 정규화 후보`,
      methodology: '명칭 정규화 신뢰도가 낮은 다수 보유 자산',
      caveat: '알파 기회가 아니라 데이터 품질 검토 우선순위',
    },
    {
      key: 'popular-verified', title: '대중성 × 검증력 1위',
      filter: (x) => number(x.count) >= 5,
      score: (x) => number(x.count) * coverage(x), sample: (x) => number(x.count),
      detail: (x) => `보유 ${number(x.count).toLocaleString('ko-KR')}명 · 확인 ${(coverage(x) * 100).toFixed(1)}%`,
      methodology: '전체 보유자 수 × 금액 확인률',
      caveat: '보유 저변과 데이터 완성도의 결합 신호',
    },
    {
      key: 'value-breadth', title: '신고가액 × 저변 1위',
      filter: (x) => number(x.valuation) > 0,
      score: (x) => number(x.valuation) * Math.log2(number(x.count) + 1), sample: (x) => number(x.count),
      detail: (x) => `${money(number(x.valuation))} · ${number(x.count).toLocaleString('ko-KR')}명`,
      methodology: '직접 귀속 신고가액 × log2(보유자 수 + 1)',
      caveat: '대규모 단일 보유와 광범위 소액 보유의 균형 지표',
    },
    {
      key: 'value-dispersion', title: '고액·분산 균형 1위',
      filter: (x) => number(x.valuation) > 0 && number(x.valuedHolderCount) >= 3,
      score: (x) => number(x.valuation) * (1 - topShare(x)), sample: (x) => number(x.valuedHolderCount),
      detail: (x) => `${money(number(x.valuation))} · 최대 보유자 ${(topShare(x) * 100).toFixed(1)}%`,
      methodology: '직접 귀속 신고가액 × (1 - 최대 보유자 비중), 확인 보유자 3명+',
      caveat: '미배분 금액은 포함하지 않음',
    },
    {
      key: 'unallocated-research', title: '미배분 탐사 후보 1위',
      filter: (x) => number(x.valuation) === 0 && number(x.unallocatedHolderCount) > 0,
      score: (x) => number(x.unallocatedHolderCount), sample: (x) => number(x.unallocatedHolderCount),
      detail: (x) => `${number(x.unallocatedHolderCount).toLocaleString('ko-KR')}명 · 개별 금액 미제공`,
      methodology: '직접 귀속액은 없지만 식별 보유자가 많은 자산',
      caveat: '금액 추정 금지, 원문 재파싱 우선 대상',
    },
    {
      key: 'data-completeness', title: '데이터 완성도 리더',
      filter: (x) => number(x.valuation) > 0 && number(x.unallocatedPositions) === 0,
      score: (x) => coverage(x) * 0.6 + confidence(x) * 0.4 +
        Math.min(1, Math.log10(number(x.count) + 1) / 2),
      sample: (x) => number(x.count), extraQuality: () => 1,
      detail: (x) => `확인 ${(coverage(x) * 100).toFixed(1)}% · 신뢰 ${(confidence(x) * 100).toFixed(1)}%`,
      methodology: '금액 확인률 60% + 명칭 신뢰도 40% + 표본 보정',
      caveat: `현재 ${noun} 데이터에서 분석 재현성이 가장 높은 후보`,
    },
  ];

  const insights = specs.map((spec) => buildInsight(spec, active)).filter(Boolean);
  return {
    engineVersion: ALPHA_ENGINE_VERSION,
    deterministic: true,
    inputItems: active.length,
    insightCount: insights.length,
    methodology: '공식 신고 변화·직접 귀속·표본·파서 신뢰도를 결합하며 시장가격과 미래수익률은 추정하지 않음',
    insights,
  };
}

module.exports = { ALPHA_ENGINE_VERSION, buildInstrumentAlpha };
