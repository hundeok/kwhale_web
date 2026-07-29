import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

type Instrument = {
  name: string;
  valuation: number;
  count: number;
  valuedHolderCount: number;
  unallocatedHolderCount?: number;
  holderCoverage?: number;
  confidenceScore?: number;
  topHolderVal?: number;
  allocatedPositions?: number;
  unallocatedPositions?: number;
  acquiredPositions?: number;
  increasedPositions?: number;
  decreasedPositions?: number;
};

const money = (value: number) => {
  if (!Number.isFinite(value)) return '-';
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}조`;
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
  if (value >= 10_000) return `${(value / 10_000).toLocaleString()}만`;
  return Math.round(value).toLocaleString();
};

const maxBy = (items: Instrument[], score: (item: Instrument) => number) =>
  [...items].sort((a, b) => score(b) - score(a))[0];
const minBy = (items: Instrument[], score: (item: Instrument) => number) =>
  [...items].sort((a, b) => score(a) - score(b))[0];

export default function AlphaInsightDeck({
  instruments,
  alpha,
  noun,
  accent,
  onSelect,
}: {
  instruments: Instrument[];
  alpha?: {
    engineVersion: string;
    methodology: string;
    insights: Array<{
      key: string; title: string; name: string; detail: string;
      confidence: number; confidenceGrade: string; sampleSize: number;
      methodology: string; caveat: string;
    }>;
  } | null;
  noun: '종목' | '코인';
  accent: string;
  onSelect: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const insights = useMemo(() => {
    if (alpha?.insights?.length) {
      return alpha.insights.map((insight) => ({
        title: insight.title,
        item: { name: insight.name } as Instrument,
        detail: () => insight.detail,
        meta: insight,
      }));
    }
    const active = instruments.filter((item) => item.count > 0);
    const valued = active.filter((item) => item.valuation > 0);
    const broad = active.filter((item) => item.count >= 10);
    const changed = active.filter((item) =>
      (item.acquiredPositions || 0) + (item.increasedPositions || 0) + (item.decreasedPositions || 0) >= 5
    );
    const distributed = valued.filter((item) => item.valuedHolderCount >= 3);
    const directOnly = valued.filter((item) => (item.unallocatedPositions || 0) === 0);
    const unallocatedOnly = active.filter((item) => item.valuation === 0 && (item.unallocatedHolderCount || 0) > 0);
    const coverage = (item: Instrument) => item.holderCoverage ?? 0;
    const confidence = (item: Instrument) => item.confidenceScore ?? 0;
    const topShare = (item: Instrument) => item.valuation > 0 ? (item.topHolderVal || 0) / item.valuation : 1;
    const inflow = (item: Instrument) =>
      (item.acquiredPositions || 0) + (item.increasedPositions || 0) - (item.decreasedPositions || 0);
    const changeTotal = (item: Instrument) =>
      (item.acquiredPositions || 0) + (item.increasedPositions || 0) + (item.decreasedPositions || 0);

    const rows = [
      { title: '신규 취득 신호 최다', item: maxBy(active, x => x.acquiredPositions || 0), detail: (x: Instrument) => `${(x.acquiredPositions || 0).toLocaleString()}개 신규 관계` },
      { title: '보유 증가 신호 최다', item: maxBy(active, x => x.increasedPositions || 0), detail: (x: Instrument) => `${(x.increasedPositions || 0).toLocaleString()}개 증가 관계` },
      { title: '보유 감소 신호 최다', item: maxBy(active, x => x.decreasedPositions || 0), detail: (x: Instrument) => `${(x.decreasedPositions || 0).toLocaleString()}개 감소 관계` },
      { title: '순유입 모멘텀 1위', item: maxBy(changed, inflow), detail: (x: Instrument) => `순증가 신호 ${inflow(x).toLocaleString()}` },
      { title: '처분 압력 1위', item: maxBy(changed, x => (x.decreasedPositions || 0) / Math.max(1, changeTotal(x))), detail: (x: Instrument) => `감소 신호 비중 ${(((x.decreasedPositions || 0) / Math.max(1, changeTotal(x))) * 100).toFixed(1)}%` },
      { title: '금액 확인 보유자 최다', item: maxBy(active, x => x.valuedHolderCount || 0), detail: (x: Instrument) => `${(x.valuedHolderCount || 0).toLocaleString()}명 금액 확인` },
      { title: '미배분 관계 최다', item: maxBy(active, x => x.unallocatedHolderCount || 0), detail: (x: Instrument) => `${(x.unallocatedHolderCount || 0).toLocaleString()}명 추가 분석 대상` },
      { title: '금액 확인률 최고', item: maxBy(broad, coverage), detail: (x: Instrument) => `${(coverage(x) * 100).toFixed(1)}% · 보유자 10명+` },
      { title: '금액 확인률 최저', item: minBy(broad, coverage), detail: (x: Instrument) => `${(coverage(x) * 100).toFixed(1)}% · 보유자 10명+` },
      { title: '명칭 파서 신뢰도 최고', item: maxBy(active.filter(x => x.count >= 5), confidence), detail: (x: Instrument) => `${(confidence(x) * 100).toFixed(1)}% · 표본 5명+` },
      { title: '명칭 검토 우선', item: minBy(active.filter(x => x.count >= 5), confidence), detail: (x: Instrument) => `${(confidence(x) * 100).toFixed(1)}% · 정규화 후보` },
      { title: '대중성 × 검증력 1위', item: maxBy(active, x => x.count * coverage(x)), detail: (x: Instrument) => `보유 ${x.count.toLocaleString()}명 · 확인 ${(coverage(x) * 100).toFixed(1)}%` },
      { title: '신고가액 × 저변 1위', item: maxBy(valued, x => x.valuation * Math.log2(x.count + 1)), detail: (x: Instrument) => `${money(x.valuation)} · ${x.count.toLocaleString()}명` },
      { title: '고액·분산 균형 1위', item: maxBy(distributed, x => x.valuation * (1 - topShare(x))), detail: (x: Instrument) => `${money(x.valuation)} · 최대 보유자 ${(topShare(x) * 100).toFixed(1)}%` },
      { title: '미배분 탐사 후보 1위', item: maxBy(unallocatedOnly, x => x.unallocatedHolderCount || 0), detail: (x: Instrument) => `${(x.unallocatedHolderCount || 0).toLocaleString()}명 · 개별 금액 미제공` },
      { title: '데이터 완성도 리더', item: maxBy(directOnly, x => coverage(x) * 0.6 + confidence(x) * 0.4 + Math.min(1, Math.log10(x.count + 1) / 2)), detail: (x: Instrument) => `확인 ${(coverage(x) * 100).toFixed(1)}% · 신뢰 ${(confidence(x) * 100).toFixed(1)}%` },
    ];
    return rows.filter((row) => row.item).map((row) => ({ ...row, meta: null }));
  }, [alpha, instruments]);
  const additionalCount = insights.length;
  const totalCardCount = 16 + additionalCount;

  return (
    <div style={{ marginBottom: '32px' }}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 18px', borderRadius: '12px', cursor: 'pointer',
          border: `1px solid ${accent}55`, background: `${accent}12`, color: '#e2e8f0', fontWeight: 800,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          <Sparkles size={18} color={accent} /> 알파 인사이트 {additionalCount.toLocaleString()}개 {expanded ? '접기' : '더 보기'}
        </span>
        <span style={{ color: accent, fontFamily: 'monospace' }}>
          16 → {expanded ? totalCardCount.toLocaleString() : `+${additionalCount.toLocaleString()}`}
          {' '}{expanded ? <ChevronUp size={18} style={{ verticalAlign: 'middle' }} /> : <ChevronDown size={18} style={{ verticalAlign: 'middle' }} />}
        </span>
      </button>
      {expanded && (
        <>
          <div style={{ margin: '10px 2px 14px', color: '#64748b', fontSize: '12px' }}>
            신고서의 취득·증가·감소, 금액 확인률과 파서 품질을 조합한 탐색 신호입니다. 시장수익률 예측이 아니며 카드를 누르면 해당 {noun}으로 이동합니다.
            {alpha && <span style={{ marginLeft: '8px', fontFamily: 'monospace' }}>engine {alpha.engineVersion} · deterministic</span>}
          </div>
          <div className="analysis-insight-grid">
            {insights.map(({ title, item, detail, meta }) => (
              <button key={title} type="button" onClick={() => onSelect(item.name)}
                style={{
                  textAlign: 'left', padding: '16px', borderRadius: '12px', cursor: 'pointer',
                  background: `linear-gradient(180deg, ${accent}12, rgba(255,255,255,.02))`,
                  border: '1px solid rgba(255,255,255,.07)', borderTop: `1px solid ${accent}77`,
                }}>
                <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 800 }}>{title}</div>
                <div style={{ marginTop: '8px', color: '#fff', fontSize: '18px', fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                <div style={{ marginTop: '5px', color: accent, fontSize: '12px', fontFamily: 'monospace' }}>{detail(item)}</div>
                {meta && (
                  <div title={`${meta.methodology} · ${meta.caveat}`} style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '10px', fontFamily: 'monospace' }}>
                    <span>표본 {meta.sampleSize.toLocaleString()}</span>
                    <span style={{ color: meta.confidenceGrade === 'HIGH' ? '#34d399' : meta.confidenceGrade === 'MEDIUM' ? '#38bdf8' : '#fbbf24' }}>
                      {meta.confidenceGrade} {(meta.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
