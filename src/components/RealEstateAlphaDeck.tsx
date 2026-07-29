import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useState } from 'react';

export type RealEstateAlphaTarget = {
  category?: string;
  subcategory?: string;
  province?: string;
  district?: string;
  minValue?: number;
  search?: string;
  officialId?: string;
};

export type RealEstateAlpha = {
  engineVersion: string;
  methodology: string;
  insights: Array<{
    key: string;
    title: string;
    name: string;
    detail: string;
    confidence: number;
    confidenceGrade: string;
    sampleSize: number;
    methodology: string;
    caveat: string;
    target: RealEstateAlphaTarget;
  }>;
};

export default function RealEstateAlphaDeck({
  alpha,
  onSelect,
}: {
  alpha: RealEstateAlpha | null;
  onSelect: (target: RealEstateAlphaTarget) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const insights = alpha?.insights || [];

  return (
    <section className="property-alpha">
      <button type="button" className="property-alpha-toggle" aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}>
        <span><Sparkles size={17} /> 부동산 알파 인사이트 <b>{insights.length.toLocaleString()}개</b> {expanded ? '접기' : '더 보기'}</span>
        <span>{expanded ? 'INSIGHT GRID OPEN' : '공식 신고 기반 탐색 신호'}{expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</span>
      </button>
      {expanded && (
        <>
          <div className="property-alpha-note">
            공식 신고가액·주소 계층·자산 유형·명의관계를 결정론적으로 재집계한 탐색 신호입니다.
            시세 상승이나 투자수익률 예측이 아니며 카드를 누르면 해당 조건으로 원장을 좁힙니다.
            {alpha && <code>{alpha.engineVersion} · deterministic</code>}
          </div>
          <div className="property-alpha-grid">
            {insights.map(insight => (
              <button key={insight.key} type="button" onClick={() => onSelect(insight.target)}
                title={`${insight.methodology} · ${insight.caveat}`}>
                <span>{insight.title}</span>
                <strong>{insight.name}</strong>
                <b>{insight.detail}</b>
                <small>
                  <span>표본 {Number(insight.sampleSize).toLocaleString()}</span>
                  <em className={`grade-${insight.confidenceGrade.toLowerCase()}`}>
                    {insight.confidenceGrade} {(Number(insight.confidence) * 100).toFixed(0)}%
                  </em>
                </small>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
