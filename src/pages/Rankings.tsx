import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, CheckCircle2, Search,
  ShieldCheck, SlidersHorizontal, X,
} from 'lucide-react';

type RankingRow = {
  id: string;
  name: string;
  agency: string;
  title: string;
  currentYear: number;
  previousYear: number;
  currentNetWorth: number;
  previousNetWorth: number;
  profit: number;
  profitRate: number;
  intervalYears: number;
  reliable: boolean;
  confidence: 'A' | 'B' | 'C';
  drivers: Array<{
    id: string;
    category: string;
    subcategory: string;
    detail: string;
    owner: string;
    valuation: number;
    difference: number;
    netWorthImpact: number;
    signal: string;
  }>;
};

type RankingInsights = {
  comparedPersons: number;
  increasedPersons: number;
  decreasedPersons: number;
  unchangedPersons: number;
  medianProfit: number;
  medianRate: number;
  positiveShare: number;
  absoluteMovement: number;
  increaseMovement: number;
  decreaseMovement: number;
  top10MovementShare: number;
  spikePersons: number;
  plungePersons: number;
  largeIncreasePersons: number;
  largeDecreasePersons: number;
};

type RankingQuality = {
  reconciliationPass: boolean;
  eligiblePersons: number;
  reliablePersons: number;
  smallBasePersons: number;
  multiYearPersons: number;
  driverCoveragePersons: number;
  minimumReliableBase: number;
};

type RankingMethodology = {
  previousYear: string | number;
  currentYear: string | number;
  formula: string;
  rankingPolicy: string;
  driverPolicy: string;
  aggregateInsights: RankingInsights;
  quality: RankingQuality;
};

type RankingMeta = {
  total: number;
  shown: number;
};

const formatCurrency = (amount: number | null | undefined): string => {
  const value = Number(amount || 0);
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000_000) return `${sign}${(absolute / 1_000_000_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}조 원`;
  if (absolute >= 100_000_000) return `${sign}${(absolute / 100_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억 원`;
  return `${sign}${Math.round(absolute / 10_000).toLocaleString('ko-KR')}만 원`;
};

const formatSignedCurrency = (amount: number) => `${amount > 0 ? '+' : ''}${formatCurrency(amount)}`;
const formatRate = (value: number) => `${value > 0 ? '+' : ''}${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;

const yieldLensOptions = [
  { id: 'reliable', label: '신뢰 비교', color: '#34d399', description: '직전 순자산 1억+ · 정확히 1년 간격' },
  { id: 'all', label: '전체 원시값', color: '#94a3b8', description: '양수 직전 순자산 전체' },
  { id: 'spike', label: '100%+ 급증', color: '#f59e0b', description: '신뢰 비교 중 순자산이 100% 이상 증가한 급변 사례' },
  { id: 'plunge', label: '50%+ 급감', color: '#fb7185', description: '신뢰 비교 중 순자산이 50% 이상 감소한 급변 사례' },
  { id: 'rise', label: '신뢰 상승', color: '#22c55e', description: '신뢰 비교 중 순자산 증가' },
  { id: 'fall', label: '신뢰 하락', color: '#f43f5e', description: '신뢰 비교 중 순자산 감소' },
  { id: 'smallbase', label: '소분모 주의', color: '#f97316', description: '직전 순자산 1억 미만' },
  { id: 'multiyear', label: '다년 간격', color: '#a78bfa', description: '비교 간격 2년 이상' },
];

const profitLensOptions = [
  { id: 'all', label: '전체 이동', color: '#94a3b8', description: '비교 가능한 전체 인물의 순자산 증감액' },
  { id: 'largeup', label: '10억+ 증가', color: '#22c55e', description: '순자산이 10억 원 이상 증가한 고액 이동' },
  { id: 'largedown', label: '10억+ 감소', color: '#fb7185', description: '순자산이 10억 원 이상 감소한 고액 이동' },
  { id: 'rise', label: '자산 유입', color: '#34d399', description: '순자산 증감액이 양수인 인물' },
  { id: 'fall', label: '자산 유출', color: '#f43f5e', description: '순자산 증감액이 음수인 인물' },
  { id: 'reliable', label: '1년 정기 비교', color: '#38bdf8', description: '직전 순자산 1억+ · 정확히 1년 간격' },
  { id: 'smallbase', label: '소규모 기저', color: '#f97316', description: '직전 순자산 1억 미만인 비교' },
  { id: 'multiyear', label: '다년 누적 이동', color: '#a78bfa', description: '비교 간격 2년 이상인 누적 변화' },
];

const sortOptions = [
  { value: 'profitRate:desc', label: '증감률 높은 순' },
  { value: 'profitRate:asc', label: '증감률 낮은 순' },
  { value: 'profit:desc', label: '증감액 높은 순' },
  { value: 'profit:asc', label: '증감액 낮은 순' },
  { value: 'currentNetWorth:desc', label: '현재 순자산 높은 순' },
  { value: 'previousNetWorth:desc', label: '이전 순자산 높은 순' },
  { value: 'name:asc', label: '이름 가나다순' },
];

function StatCard({ label, value, detail, color }: { label: string; value: string; detail: string; color: string }) {
  return (
    <div className="glass-card ranking-stat-card" style={{ '--ranking-accent': color } as React.CSSProperties}>
      <span className="ranking-stat-glow" aria-hidden="true" />
      <div className="ranking-stat-label">{label}</div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export default function Rankings({ type }: { type: 'yield' | 'profit' }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const year = searchParams.get('year') || 'recent';
  const defaultLens = type === 'yield' ? 'reliable' : 'all';
  const defaultSort = type === 'yield' ? 'profitRate:desc' : 'profit:desc';
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [methodology, setMethodology] = useState<RankingMethodology | null>(null);
  const [meta, setMeta] = useState<RankingMeta | null>(null);
  const [lens, setLens] = useState(defaultLens);
  const [sortValue, setSortValue] = useState(defaultSort);
  const [draftSearch, setDraftSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Route mode/year changes intentionally reset the local exploration state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLens(defaultLens);
    setSortValue(defaultSort);
    setDraftSearch('');
    setAppliedSearch('');
  }, [defaultLens, defaultSort, type, year]);

  const load = useCallback(() => {
    const controller = new AbortController();
    const [sort, direction] = sortValue.split(':');
    const query = new URLSearchParams({ year, lens, sort, direction, search: appliedSearch });
    setLoading(true);
    setError('');
    fetch(`/api/rankings/${type}?${query}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '랭킹을 계산할 수 없습니다.');
        setRows(Array.isArray(result.data) ? result.data : []);
        setMethodology(result.methodology || null);
        setMeta(result.meta || null);
        setLoading(false);
      })
      .catch(reason => {
        if (reason.name !== 'AbortError') {
          setError(reason.message || '비교 데이터를 불러오지 못했습니다.');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [appliedSearch, lens, sortValue, type, year]);

  // The callback owns its AbortController cleanup and all state changes occur
  // around the asynchronous request lifecycle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => load(), [load]);

  const insight = methodology?.aggregateInsights;
  const quality = methodology?.quality;
  const lensOptions = type === 'yield' ? yieldLensOptions : profitLensOptions;
  const activeLens = lensOptions.find(option => option.id === lens) || lensOptions[0];
  const title = type === 'yield' ? '재산 급변 탐지' : '고액 자산 이동';
  const subtitle = type === 'yield'
    ? '비교 가능한 공직자의 상대적 급증·급감과 분모 왜곡 위험을 함께 탐지합니다.'
    : '공직자 순자산의 원화 기준 이동 규모와 신고서상 변동 신호를 추적합니다.';
  const medianRate = Number(insight?.medianRate || 0);
  const reliableShare = Number(quality?.eligiblePersons)
    ? Number(quality?.reliablePersons) / Number(quality?.eligiblePersons)
    : 0;
  const maxAbsoluteRate = useMemo(() =>
    Math.max(1, ...rows.map(row => Math.abs(Number(row.profitRate)))), [rows]);

  const toggleLens = (nextLens: string) => {
    setLens(current => {
      const resolved = current === nextLens && nextLens !== 'all' ? 'all' : nextLens;
      if (type === 'yield') {
        setSortValue(resolved === 'plunge' || resolved === 'fall' ? 'profitRate:asc' : 'profitRate:desc');
      } else {
        setSortValue(resolved === 'largedown' || resolved === 'fall' ? 'profit:asc' : 'profit:desc');
      }
      return resolved;
    });
  };

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault();
    setAppliedSearch(draftSearch.trim());
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
      <section className="glass-card ranking-hero">
        <div className="ranking-heading">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div>
              <h2>{title}</h2>
              <p>{subtitle}</p>
            </div>
          </div>
          <span title={methodology?.rankingPolicy} className={`ranking-pass ${quality?.reconciliationPass ? 'pass' : 'check'}`}>
            <CheckCircle2 size={15} /> 증감 회계대사 {quality?.reconciliationPass ? 'PASS' : 'CHECK'}
          </span>
        </div>
        {methodology && (
          <div className="ranking-method">
            <strong>{methodology.previousYear} → {methodology.currentYear}</strong>
            <span>{methodology.formula}</span>
            <span>채무 차감 후 순자산 · 시장수익률 예측 아님</span>
          </div>
        )}

        <form onSubmit={applySearch} className="ranking-controls-search">
          <Search size={18} color="#fbbf24" />
          <input value={draftSearch} onChange={event => setDraftSearch(event.target.value)}
            placeholder="이름·신고 당시 소속·직위 복합 검색" />
          {draftSearch && <button type="button" aria-label="검색어 지우기" onClick={() => setDraftSearch('')}><X size={15} /></button>}
          <button type="submit">검색</button>
        </form>

        <div style={{ marginTop: '17px' }}>
          <div className="ranking-lens-label"><SlidersHorizontal size={14} /> {type === 'yield' ? '급변 탐지 렌즈' : '자산 이동 렌즈'}</div>
          <div className="ranking-lenses">
            {lensOptions.map(option => {
              const selected = lens === option.id;
              return (
                <button key={option.id} type="button" aria-pressed={selected}
                  title={`${option.description}${selected && option.id !== 'all' ? ' · 다시 눌러 해제' : ''}`}
                  onClick={() => toggleLens(option.id)}
                  style={{ color: selected ? '#fff' : option.color, borderColor: selected ? option.color : `${option.color}35`, background: selected ? `${option.color}28` : 'rgba(255,255,255,.025)' }}>
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="ranking-lens-description">{activeLens.description}</p>
        </div>
      </section>

      {insight && (
        <section className="ranking-stat-grid">
          {type === 'yield' ? <>
            <StatCard label="탐지 대상" value={`${Number(insight.comparedPersons).toLocaleString()}명`}
              detail={`조건 일치 · 상위 ${Number(meta?.shown || 0).toLocaleString()}명 표시`} color="#38bdf8" />
            <StatCard label="100%+ 급증" value={`${Number(insight.spikePersons).toLocaleString()}명`}
              detail={`50%+ 급감 ${Number(insight.plungePersons).toLocaleString()}명`} color="#f59e0b" />
            <StatCard label="증감률 중앙값" value={formatRate(medianRate)}
              detail={`증감액 중앙값 ${formatSignedCurrency(Number(insight.medianProfit))}`} color="#fbbf24" />
            <StatCard label="신뢰 비교 커버리지" value={`${(reliableShare * 100).toFixed(1)}%`}
              detail={`${Number(quality?.reliablePersons || 0).toLocaleString()} / ${Number(quality?.eligiblePersons || 0).toLocaleString()}명`} color="#a78bfa" />
          </> : <>
            <StatCard label="총 절대 이동 규모" value={formatCurrency(Number(insight.absoluteMovement))}
              detail={`${Number(insight.comparedPersons).toLocaleString()}명 증감 절댓값 합계`} color="#38bdf8" />
            <StatCard label="순자산 증가 흐름" value={formatCurrency(Number(insight.increaseMovement))}
              detail={`10억+ 증가 ${Number(insight.largeIncreasePersons).toLocaleString()}명`} color="#34d399" />
            <StatCard label="순자산 감소 흐름" value={formatCurrency(Number(insight.decreaseMovement))}
              detail={`10억+ 감소 ${Number(insight.largeDecreasePersons).toLocaleString()}명`} color="#fb7185" />
            <StatCard label="상위 10명 이동 집중도" value={`${(Number(insight.top10MovementShare) * 100).toFixed(1)}%`}
              detail={`현재 조건 절대 이동액 기준`} color="#a78bfa" />
          </>}
        </section>
      )}

      {quality && (
        <section className="ranking-quality-strip">
          <span><ShieldCheck size={14} color="#34d399" /> 산식 대사 <strong>100%</strong></span>
          <span>신뢰 기준 <strong>직전 순자산 {formatCurrency(quality.minimumReliableBase)}+</strong></span>
          <span>{type === 'yield' ? '소분모 제외 대상' : '소규모 기저'} <strong>{Number(quality.smallBasePersons).toLocaleString()}명</strong></span>
          <span>다년 간격 <strong>{Number(quality.multiYearPersons).toLocaleString()}명</strong></span>
          <span title={methodology?.driverPolicy}>변동 신호 확인 <strong>{Number(quality.driverCoveragePersons).toLocaleString()} / {rows.length.toLocaleString()}명</strong></span>
        </section>
      )}

      <section className="glass-card ranking-results">
        <div className="ranking-results-toolbar">
          <div><strong>{activeLens.label}</strong><span>{Number(meta?.total || 0).toLocaleString()}명 중 {rows.length.toLocaleString()}명 표시</span></div>
          <label>
            정렬
            <select aria-label="순자산 변화 정렬" value={sortValue} onChange={event => setSortValue(event.target.value)}>
              {sortOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        {error ? (
          <div className="ranking-empty error">{error}<button type="button" onClick={load}>다시 시도</button></div>
        ) : loading ? (
          <div className="ranking-empty"><Activity className="spin-animation" size={30} />공식 신고 이력을 비교하는 중입니다…</div>
        ) : rows.length === 0 ? (
          <div className="ranking-empty">현재 조건에 맞는 비교 인물이 없습니다.</div>
        ) : (
          <div className="ranking-table-wrap">
            <table className="ranking-table">
              <thead><tr>
                <th>{type === 'yield' ? '급변 순위' : '이동 순위'}</th><th>공직자</th><th>비교 구간</th>
                <th className="number">이전 순자산</th><th className="number">현재 순자산</th>
                <th className="number">증감액</th><th className="number">증감률</th>
                <th>공식 변동 신호</th><th>품질</th>
              </tr></thead>
              <tbody>
                {rows.map((person, index) => {
                  const positive = Number(person.profit) >= 0;
                  const barWidth = Math.min(100, Math.abs(Number(person.profitRate)) / maxAbsoluteRate * 100);
                  return (
                    <tr key={person.id} onClick={() => navigate(`/officials/${person.id}?year=${year}`)} tabIndex={0}
                      onKeyDown={event => { if (event.key === 'Enter') navigate(`/officials/${person.id}?year=${year}`); }}>
                      <td><strong className="ranking-rank">#{index + 1}</strong></td>
                      <td><strong className="ranking-name">{person.name}</strong><span className="ranking-agency">{person.agency || '소속 미기재'} · {person.title || '직위 미기재'}</span></td>
                      <td>
                        <div className="ranking-period">
                          <span>{person.previousYear}</span><i aria-hidden="true" /><strong>{person.currentYear}</strong>
                          <small>{person.intervalYears === 1 ? '정기 비교 · 1년' : `누적 비교 · ${person.intervalYears}년`}</small>
                        </div>
                      </td>
                      <td className="number secondary"><span className="ranking-money previous">{formatCurrency(person.previousNetWorth)}</span></td>
                      <td className="number"><span className="ranking-money current">{formatCurrency(person.currentNetWorth)}</span></td>
                      <td className={`number change ${positive ? 'positive' : 'negative'}`}>
                        <span className="ranking-change-pill">{formatSignedCurrency(person.profit)}</span>
                      </td>
                      <td className={`number rate ${positive ? 'positive' : 'negative'}`}>
                        <strong className="ranking-rate-value">{formatRate(person.profitRate)}</strong>
                        <span><i style={{ width: `${barWidth}%` }} /></span>
                      </td>
                      <td>
                        <div className="ranking-drivers">
                          {person.drivers?.length ? person.drivers.slice(0, 3).map(driver => (
                            <div key={driver.id} title={`${driver.detail || driver.subcategory || driver.category} · 순자산 영향 ${formatSignedCurrency(driver.netWorthImpact)}`}>
                              <span className={driver.netWorthImpact >= 0 ? 'positive' : 'negative'}>{driver.signal}</span>
                              <div className="ranking-driver-detail">
                                <strong>{driver.detail || driver.subcategory || driver.category}</strong>
                              </div>
                              <small>{driver.category} · {formatSignedCurrency(driver.netWorthImpact)}</small>
                            </div>
                          )) : <small>현재 신고서에 개별 증감액 미기재</small>}
                        </div>
                      </td>
                      <td><span className={`confidence confidence-${person.confidence}`}>{person.confidence}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
