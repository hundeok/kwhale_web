import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, ArrowUpRight, Building2, CheckCircle2, ChevronDown,
  Clock3, Coins, Gem, Landmark, Search, ShieldCheck, Sparkles,
  TrendingUp, UserRound, WalletCards, X,
} from 'lucide-react';
import AssetDetailView from '../components/AssetDetailView';

type EventType = 'ACQUIRED' | 'INCREASED' | 'ACQUIRED_SIGNAL' | 'INCREASED_SIGNAL';

type AssetEvent = {
  id: string;
  category: string;
  detailType: string;
  address: string;
  owner: string;
  valuation: number;
  difference: number | null;
  eventType: EventType;
  year: number;
  disclosedAt: string;
  disclosureId: string;
  sourceRecordIndex: number;
  sourceRecordHash: string;
  sourceUrl: string;
  fileSha256: string;
  official: {
    id: string;
    name: string;
    agency: string;
    title: string;
  };
};

type Stats = {
  totalDifference: number;
  eventCount: number;
  officialsCount: number;
  acquiredCount: number;
  increasedCount: number;
  acquiredDifference: number;
  increasedDifference: number;
  averageDifference: number;
  displayed: number;
  truncated: boolean;
  reconciliationPass: boolean;
  amountConfirmedCount: number;
  signalOnlyCount: number;
};

type CategoryBreakdown = {
  category: string;
  eventCount: number;
  officialsCount: number;
  totalDifference: number;
  amountConfirmedCount: number;
  signalOnlyCount: number;
};

type TaxonomyBreakdown = {
  category: string;
  subcategory: string;
  eventCount: number;
  officialsCount: number;
  totalDifference: number;
  signalOnlyCount: number;
};

type RegionBreakdown = {
  name: string;
  eventCount: number;
  buildingCount: number;
  landCount: number;
  amountConfirmedCount: number;
};

type Methodology = {
  eventDefinition: string;
  acquiredDefinition: string;
  increasedDefinition: string;
  exclusions: string[];
  valuationPolicy: string;
  realEstateDifferencePolicy?: string;
};

type EventMeta = {
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number;
};

const formatCurrency = (amount: number) => {
  const value = Number(amount || 0);
  if (Math.abs(value) >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}조 원`;
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억 원`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만 원`;
  return `${value.toLocaleString('ko-KR')}원`;
};

const categoryCatalog = [
  { id: 'all', label: '전체 자산' },
  { id: '건물', label: '건물' },
  { id: '토지', label: '토지' },
  { id: '예금', label: '예금' },
  { id: '증권', label: '증권' },
  { id: '가상자산', label: '가상자산' },
  { id: '동산', label: '차량·동산' },
];

const eventLenses = [
  { id: 'all', label: '전체 증가', description: '금액 확정 이벤트와 원문 증가 신호 전체' },
  { id: 'ACQUIRED', label: '신규 취득 후보', description: '현재액=증가액 또는 건물·토지의 신규 면적·지분 증가 신호' },
  { id: 'INCREASED', label: '기존 자산 증가', description: '공식 차액 또는 원문에 기존 자산 증가가 명시된 행' },
];

const categoryColor = (category: string) => {
  if (category === '건물') return '#60a5fa';
  if (category === '토지') return '#34d399';
  if (category === '예금') return '#a78bfa';
  if (category === '증권') return '#fbbf24';
  if (category === '가상자산') return '#fb7185';
  if (category === '동산') return '#22d3ee';
  return '#94a3b8';
};

const CategoryIcon = ({ category, size = 17 }: { category: string; size?: number }) => {
  if (category === '건물' || category === '토지') return <Building2 size={size} />;
  if (category === '증권') return <TrendingUp size={size} />;
  if (category === '가상자산') return <Coins size={size} />;
  if (category === '예금') return <Landmark size={size} />;
  return <Gem size={size} />;
};

function MetricCard({ label, value, detail, color, icon }: {
  label: string; value: string; detail: string; color: string; icon: React.ReactNode;
}) {
  return (
    <div className="new-assets-metric" style={{ '--event-accent': color } as React.CSSProperties}>
      <div className="new-assets-metric-head"><span>{label}</span><i>{icon}</i></div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export default function NewAssets() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const year = searchParams.get('year') || 'recent';
  const [events, setEvents] = useState<AssetEvent[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [breakdown, setBreakdown] = useState<CategoryBreakdown[]>([]);
  const [taxonomy, setTaxonomy] = useState<TaxonomyBreakdown[]>([]);
  const [regions, setRegions] = useState<RegionBreakdown[]>([]);
  const [methodology, setMethodology] = useState<Methodology | null>(null);
  const [meta, setMeta] = useState<EventMeta>({ total: 0, hasMore: false, offset: 0, limit: 50 });
  const [category, setCategory] = useState('all');
  const [subcategory, setSubcategory] = useState('all');
  const [region, setRegion] = useState('all');
  const [eventLens, setEventLens] = useState('all');
  const [sort, setSort] = useState('difference');
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadEvents = useCallback((offset = 0, append = false) => {
    const controller = new AbortController();
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    const query = new URLSearchParams({
      year, category, subcategory, region, eventType: eventLens, sort, search,
      limit: '50', offset: String(offset),
    });
    fetch(`/api/analysis/new-assets?${query}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '자산 증가 데이터를 계산할 수 없습니다.');
        const nextEvents = Array.isArray(result.data?.timeline) ? result.data.timeline : [];
        setEvents(current => append ? [...current, ...nextEvents] : nextEvents);
        setStats(result.data?.stats || null);
        setBreakdown(Array.isArray(result.data?.categoryBreakdown) ? result.data.categoryBreakdown : []);
        setTaxonomy(Array.isArray(result.data?.taxonomyBreakdown) ? result.data.taxonomyBreakdown : []);
        setRegions(Array.isArray(result.data?.regionBreakdown) ? result.data.regionBreakdown : []);
        setMethodology(result.data?.methodology || null);
        setMeta(result.data?.meta || { total: nextEvents.length, hasMore: false, offset, limit: 50 });
        setLoading(false);
        setLoadingMore(false);
      })
      .catch(reason => {
        if (reason.name !== 'AbortError') {
          setError(reason.message || '자산 증가 데이터를 불러오지 못했습니다.');
          setLoading(false);
          setLoadingMore(false);
        }
      });
    return () => controller.abort();
  }, [category, eventLens, region, search, sort, subcategory, year]);

  // The callback owns request cancellation and updates state around async I/O.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => loadEvents(), [loadEvents]);

  useEffect(() => {
    // Year-scoped exploration controls intentionally return to their defaults.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCategory('all');
    setSubcategory('all');
    setRegion('all');
    setEventLens('all');
    setSearch('');
    setDraftSearch('');
  }, [year]);

  const activeLens = eventLenses.find(item => item.id === eventLens) || eventLenses[0];
  const categoryMap = new Map(breakdown.map(item => [item.category, item]));
  const visibleCategories = categoryCatalog.filter(item => item.id === 'all' || categoryMap.has(item.id));
  const visibleSubcategories = taxonomy.filter(item => category !== 'all' && item.category === category);
  const realEstateSelected = category === '건물' || category === '토지';
  const visibleRegions = regions
    .map(item => ({
      ...item,
      selectedCount: category === '건물' ? item.buildingCount : item.landCount,
    }))
    .filter(item => item.name !== '기타·국외' && item.selectedCount > 0);
  const subcategoryLabel = (value: string) => {
    if (value === '미분류') return category === '가상자산' ? '가상자산 세부유형 미기재' : '세부유형 미기재';
    return value
      .replace(/^복합건물주택\+상가/, '복합건물(주택·상가)')
      .replace(/^자동차관련시설/, '자동차 관련 시설')
      .replace(/^기타채권$/, '기타 채권');
  };
  const toggleCategory = (next: string) => {
    setCategory(current => current === next && next !== 'all' ? 'all' : next);
    setSubcategory('all');
    setRegion('all');
  };
  const toggleEventLens = (next: string) => {
    setEventLens(current => current === next && next !== 'all' ? 'all' : next);
  };

  return (
    <div className="new-assets-page">
      <section className="glass-card new-assets-hero">
        <div className="new-assets-heading">
          <div className="new-assets-title">
            <div>
              <h2>자산 증가 이벤트</h2>
              <p>신고서의 공식 양(+) 차액을 시간순으로 추적하고 신규 취득 후보와 기존 자산 증가를 분리합니다.</p>
            </div>
          </div>
          <span className={`ranking-pass ${stats?.reconciliationPass ? 'pass' : 'check'}`}>
            <CheckCircle2 size={15} /> 증가액 회계대사 {stats?.reconciliationPass ? 'PASS' : 'CHECK'}
          </span>
        </div>

        <div className="new-assets-method">
          <span><ShieldCheck size={14} /> 추정 배분 없음</span>
          <span>채무 증가 제외</span>
          <span>현재 평가액 ≠ 공식 증가액</span>
          <span title={methodology?.valuationPolicy}>인물별 선택 스냅샷 기준</span>
        </div>

        <form className="new-assets-search" onSubmit={event => { event.preventDefault(); setSearch(draftSearch.trim()); }}>
          <Search size={18} />
          <input value={draftSearch} onChange={event => setDraftSearch(event.target.value)}
            placeholder="공직자·소속·자산명·주소·명의자 복합 검색" />
          {draftSearch && <button type="button" aria-label="검색어 지우기" onClick={() => setDraftSearch('')}><X size={15} /></button>}
          <button type="submit">검색</button>
        </form>
      </section>

      {stats && (
        <section className="new-assets-metrics">
          <MetricCard label="공식 자산 증가액" value={formatCurrency(stats.totalDifference)}
            detail={`금액 확인 ${Number(stats.amountConfirmedCount).toLocaleString()}건 · 원문 신호 ${Number(stats.signalOnlyCount).toLocaleString()}건`} color="#38bdf8" icon={<WalletCards size={16} />} />
          <MetricCard label="증가 신고 공직자" value={`${Number(stats.officialsCount).toLocaleString()}명`}
            detail="인물별 선택 스냅샷 중복 제거" color="#a78bfa" icon={<UserRound size={16} />} />
          <MetricCard label="신규 취득 후보" value={`${Number(stats.acquiredCount).toLocaleString()}건`}
            detail={`금액 확정 ${(Number(stats.acquiredCount) - Number(stats.signalOnlyCount)).toLocaleString()}건 · 부동산 신호 ${Number(stats.signalOnlyCount).toLocaleString()}건`}
            color="#34d399" icon={<Sparkles size={16} />} />
          <MetricCard label="기존 자산 증가" value={`${Number(stats.increasedCount).toLocaleString()}건`}
            detail={`${formatCurrency(stats.increasedDifference)} · 가액·보유량 증가`} color="#fbbf24" icon={<ArrowUpRight size={16} />} />
        </section>
      )}

      <section className="glass-card new-assets-explorer">
        <div className="new-assets-filter-block">
          <div className="new-assets-filter-label">이벤트 렌즈</div>
          <div className="new-assets-pills">
            {eventLenses.map(item => (
              <button key={item.id} type="button" aria-pressed={eventLens === item.id}
                onClick={() => toggleEventLens(item.id)}>{item.label}</button>
            ))}
          </div>
          <small>{activeLens.description}</small>
        </div>

        <div className="new-assets-filter-block">
          <div className="new-assets-filter-label">자산군</div>
          <div className="new-assets-categories">
            {visibleCategories.map(item => {
              const selected = category === item.id;
              const info = item.id === 'all' ? null : categoryMap.get(item.id);
              return (
                <button key={item.id} type="button" aria-pressed={selected}
                  onClick={() => toggleCategory(item.id)}
                  style={{ '--category-accent': categoryColor(item.id) } as React.CSSProperties}>
                  <span>{item.id === 'all' ? <Activity size={15} /> : <CategoryIcon category={item.id} size={15} />}{item.label}</span>
                  {info && <small>{Number(info.eventCount).toLocaleString()}건 · {
                    Number(info.signalOnlyCount) > 0 && Number(info.totalDifference) === 0
                      ? `증가액 미분리 ${Number(info.signalOnlyCount).toLocaleString()}건`
                      : formatCurrency(info.totalDifference)
                  }</small>}
                </button>
              );
            })}
          </div>
        </div>

        {visibleSubcategories.length > 0 && (
          <div className="new-assets-filter-block new-assets-subcategory-block">
            <div className="new-assets-filter-label">소분류 · {category}</div>
            <div className="new-assets-subcategories">
              <button type="button" aria-pressed={subcategory === 'all'}
                onClick={() => setSubcategory('all')}>전체 소분류</button>
              {visibleSubcategories.map(item => (
                <button key={`${item.category}-${item.subcategory}`} type="button"
                  aria-pressed={subcategory === item.subcategory}
                  onClick={() => setSubcategory(current => current === item.subcategory ? 'all' : item.subcategory)}>
                  <strong>{subcategoryLabel(item.subcategory)}</strong>
                  <span>{Number(item.eventCount).toLocaleString()}건</span>
                  <small>{Number(item.signalOnlyCount) > 0
                    ? `증가액 미분리 ${Number(item.signalOnlyCount).toLocaleString()}건`
                    : formatCurrency(item.totalDifference)}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        {realEstateSelected && visibleRegions.length > 0 && (
          <div className="new-assets-filter-block new-assets-region-block">
            <div className="new-assets-filter-label">지역별 · {category}</div>
            <div className="new-assets-region-pills">
              <button type="button" aria-pressed={region === 'all'}
                onClick={() => setRegion('all')}>전국</button>
              {visibleRegions.map(item => (
                <button key={item.name} type="button" aria-pressed={region === item.name}
                  onClick={() => setRegion(current => current === item.name ? 'all' : item.name)}>
                  <strong>{item.name}</strong>
                  <span>{Number(item.selectedCount).toLocaleString()}건</span>
                </button>
              ))}
            </div>
            <small>주소 원문에서 시·도 단위를 직접 추출합니다. 금액이 아닌 취득·면적 증가 이벤트 건수 기준이며 국외·주소 미식별 건은 전국에만 포함합니다.</small>
          </div>
        )}

        <div className="new-assets-toolbar">
          <div>
            <Clock3 size={18} />
            <strong>공식 자산행 변화 타임라인</strong>
            <span>{Number(meta.total).toLocaleString()}건 · 현재 {events.length.toLocaleString()}건 표시</span>
          </div>
          <label>정렬
            <select value={sort} onChange={event => setSort(event.target.value)}>
              <option value="difference">공식 증가액 큰 순</option>
              <option value="date">최근 공개 순</option>
              <option value="valuation">현재 평가액 큰 순</option>
            </select>
          </label>
        </div>

        {error ? <div className="new-assets-empty error">{error}</div> :
          loading ? <div className="new-assets-empty"><Activity className="spin-animation" />공식 자산행을 계산하는 중입니다…</div> :
          events.length === 0 ? <div className="new-assets-empty">현재 조건에 맞는 자산 증가 이벤트가 없습니다.</div> : (
            <div className="new-assets-timeline">
              {events.map(event => {
                const color = categoryColor(event.category);
                const acquired = event.eventType === 'ACQUIRED' || event.eventType === 'ACQUIRED_SIGNAL';
                const amountConfirmed = Number(event.difference) > 0;
                const expanded = expandedId === event.id;
                return (
                  <article key={event.id} className="new-assets-event"
                    style={{ '--event-accent': color } as React.CSSProperties}
                    onClick={() => setExpandedId(current => current === event.id ? null : event.id)}
                    tabIndex={0}
                    onKeyDown={keyEvent => { if (keyEvent.key === 'Enter') setExpandedId(current => current === event.id ? null : event.id); }}>
                    <div className="new-assets-dot"><CategoryIcon category={event.category} /></div>
                    <div className="new-assets-event-card">
                      <div className="new-assets-event-top">
                        <div>
                          <div className="new-assets-event-badges">
                            <span>{event.category}</span>
                            <em className={acquired ? 'acquired' : 'increased'}>
                              {acquired ? '신규 취득 후보' : '기존 자산 증가'}
                            </em>
                            <small>{event.year}년</small>
                          </div>
                          <strong className="new-assets-event-title">{subcategoryLabel(event.detailType || event.category)}</strong>
                          <div className="new-assets-person">
                            <b>{event.official.name}</b>
                            <span>{event.official.agency || '소속 미기재'} · {event.official.title || '직위 미기재'}</span>
                            {event.owner && <i>명의 {event.owner}</i>}
                          </div>
                        </div>
                        <div className="new-assets-values">
                          <small>공식 증가액</small>
                          <strong title={!amountConfirmed ? methodology?.realEstateDifferencePolicy : undefined}>
                            {amountConfirmed ? `+${formatCurrency(Number(event.difference))}` : '증가액 미분리'}
                          </strong>
                          <span>현재 평가액 {formatCurrency(event.valuation)}</span>
                        </div>
                      </div>
                      {event.address && (
                        <div className="new-assets-detail">
                          <AssetDetailView text={event.address} category={event.category} initialLimit={7} />
                        </div>
                      )}
                      <div className="new-assets-event-foot">
                        <span>{event.disclosedAt ? `${event.disclosedAt.slice(0, 10)} 공개` : `${event.year}년 공개`}</span>
                        <span>{amountConfirmed ? '공식 difference 직접 사용' : '원문 상세 확인 · 증가액 미추정'}</span>
                      </div>
                      {expanded && (
                        <div className="new-assets-expanded" onClick={clickEvent => clickEvent.stopPropagation()}>
                          <div>
                            <span>자산 대분류<strong>{event.category}</strong></span>
                            <span>자산 소분류<strong>{subcategoryLabel(event.detailType || '미분류')}</strong></span>
                            <span>명의자<strong>{event.owner || '미기재'}</strong></span>
                            <span>분류 상태<strong>{acquired ? '신규 취득 후보' : '기존 자산 증가'}</strong></span>
                          </div>
                          <div className="new-assets-expanded-detail">
                            <b>원문 자산 상세</b>
                            {event.address
                              ? <AssetDetailView text={event.address} category={event.category} initialLimit={12} />
                              : '상세 미기재'}
                          </div>
                          <div className="new-assets-lineage">
                            <span>원본 레코드 #{Number(event.sourceRecordIndex).toLocaleString()}</span>
                            <span>레코드 해시 {event.sourceRecordHash?.slice(0, 16)}…</span>
                            <span>파일 SHA-256 {event.fileSha256?.slice(0, 16)}…</span>
                          </div>
                          <div className="new-assets-expanded-actions">
                            <button type="button" onClick={() => navigate(`/officials/${event.official.id}?year=${year}`)}>인물 전체 자산 보기</button>
                            {event.sourceUrl && <a href={event.sourceUrl} target="_blank" rel="noreferrer">보존 원본 출처</a>}
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

        {meta.hasMore && (
          <button type="button" className="new-assets-more"
            disabled={loadingMore}
            onClick={() => loadEvents(events.length, true)}>
            {loadingMore ? '불러오는 중…' : '이벤트 더 보기'}
            <span>{Math.max(0, meta.total - events.length).toLocaleString()}건 남음</span><ChevronDown size={17} />
          </button>
        )}
      </section>
    </div>
  );
}
