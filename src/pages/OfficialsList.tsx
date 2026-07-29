import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, ArrowDownAZ, ArrowUpRight, BadgeDollarSign, Bitcoin,
  Building2, CheckCircle2, ChevronLeft, ChevronRight, Download,
  Landmark, Scale, Search, ShieldCheck, SlidersHorizontal, TrendingUp,
  Users, WalletCards, X,
} from 'lucide-react';

type Official = {
  id: string;
  name: string;
  agency: string;
  title: string;
  totalAssets: number;
  liabilities: number;
  netWorth: number;
  assetCount: number;
  latestYear: number;
  lastUpdated: string;
  sameNameCount: number;
};

type Summary = {
  persons: number;
  grossAssets: number;
  liabilities: number;
  netWorth: number;
  averageNetWorth: number;
  highNetCount: number;
  negativeNetCount: number;
  missingOrgCount: number;
  missingTitleCount: number;
  homonymCount: number;
};

type Meta = {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  lens: string;
  summary?: Summary;
  quality?: {
    accountingPass: boolean;
    snapshotPolicy: string;
    organizationBasis: string;
    sourceLineageCoverage: number;
    identityCoverage: number;
  };
};

const PAGE_SIZE = 30;

const formatCurrency = (amount: number | null | undefined): string => {
  const value = Number(amount || 0);
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000_000) {
    return `${sign}${(absolute / 1_000_000_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}조 원`;
  }
  if (absolute >= 100_000_000) {
    return `${sign}${(absolute / 100_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억 원`;
  }
  return `${sign}${Math.round(absolute / 10_000).toLocaleString('ko-KR')}만 원`;
};

const lenses = [
  { id: 'all', label: '전체', icon: Users, color: '#38bdf8', group: 'scope' },
  { id: 'legislature', label: '국회·의회', icon: Landmark, color: '#a78bfa', group: 'scope' },
  { id: 'executive', label: '중앙행정', icon: ShieldCheck, color: '#60a5fa', group: 'scope' },
  { id: 'judiciary', label: '사법·법무', icon: Scale, color: '#fb7185', group: 'scope' },
  { id: 'local', label: '지방정부', icon: Building2, color: '#2dd4bf', group: 'scope' },
  { id: 'public', label: '공공기관', icon: Landmark, color: '#94a3b8', group: 'scope' },
  { id: 'highnet', label: '순자산 100억+', icon: TrendingUp, color: '#fbbf24', group: 'asset' },
  { id: 'debt', label: '채무 보유', icon: BadgeDollarSign, color: '#fb7185', group: 'asset' },
  { id: 'negative', label: '순자산 음수', icon: BadgeDollarSign, color: '#f43f5e', group: 'asset' },
  { id: 'crypto', label: '가상자산 신고', icon: Bitcoin, color: '#f59e0b', group: 'asset' },
  { id: 'securities', label: '증권 보유', icon: WalletCards, color: '#c084fc', group: 'asset' },
  { id: 'realestate', label: '부동산 보유', icon: Building2, color: '#38bdf8', group: 'asset' },
  { id: 'homonym', label: '동명이인', icon: Users, color: '#c084fc', group: 'quality' },
  { id: 'metadata', label: '메타데이터 점검', icon: ShieldCheck, color: '#f97316', group: 'quality' },
];

const sortOptions = [
  { value: 'netWorth:desc', label: '순자산 높은 순' },
  { value: 'netWorth:asc', label: '순자산 낮은 순' },
  { value: 'totalAssets:desc', label: '총자산 높은 순' },
  { value: 'liabilities:desc', label: '채무 높은 순' },
  { value: 'assetCount:desc', label: '신고 자산행 많은 순' },
  { value: 'name:asc', label: '이름 가나다순' },
  { value: 'agency:asc', label: '소속 가나다순' },
  { value: 'lastUpdated:desc', label: '최근 공개 순' },
];

function Metric({ label, value, detail, color }: { label: string; value: string; detail: string; color: string }) {
  return (
    <div style={{ minWidth: 0, padding: '16px', borderRadius: '13px', background: `${color}0c`, border: `1px solid ${color}24` }}>
      <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 800 }}>{label}</div>
      <strong style={{ display: 'block', marginTop: '7px', color, fontSize: 'clamp(20px,2.4vw,28px)', letterSpacing: '-.7px' }}>{value}</strong>
      <small style={{ display: 'block', marginTop: '5px', color: '#64748b', fontSize: '11px', lineHeight: 1.45 }}>{detail}</small>
    </div>
  );
}

export default function OfficialsList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const year = searchParams.get('year') || 'recent';
  const [rows, setRows] = useState<Official[]>([]);
  const [meta, setMeta] = useState<Meta>({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE, lens: 'all' });
  const [draftSearch, setDraftSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [lens, setLens] = useState('all');
  const [sortValue, setSortValue] = useState('netWorth:desc');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(() => {
    const controller = new AbortController();
    const [sort, direction] = sortValue.split(':');
    const query = new URLSearchParams({
      page: String(page), limit: String(PAGE_SIZE), search: appliedSearch,
      sort, direction, lens, year,
    });
    setLoading(true);
    setError('');
    fetch(`/api/officials?${query}`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`officials ${response.status}`);
        return response.json();
      })
      .then(result => {
        if (!result.success) throw new Error(result.error || 'officials response');
        setRows(Array.isArray(result.data) ? result.data : []);
        setMeta(result.meta);
        setLoading(false);
      })
      .catch(fetchError => {
        if (fetchError.name !== 'AbortError') {
          setError('공직자 명단을 불러오지 못했습니다.');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [appliedSearch, lens, page, sortValue, year]);

  useEffect(() => fetchData(), [fetchData]);
  useEffect(() => {
    setPage(1);
    setLens('all');
    setDraftSearch('');
    setAppliedSearch('');
  }, [year]);

  const activeLens = lenses.find(item => item.id === lens) || lenses[0];
  const summary = meta.summary;
  const from = meta.total ? (meta.page - 1) * meta.limit + 1 : 0;
  const to = Math.min(meta.page * meta.limit, meta.total);
  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(meta.page - 2, meta.totalPages - 4));
    return Array.from({ length: Math.min(5, meta.totalPages) }, (_, index) => start + index);
  }, [meta.page, meta.totalPages]);

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(draftSearch.trim());
  };

  const resetFilters = () => {
    setDraftSearch('');
    setAppliedSearch('');
    setLens('all');
    setSortValue('netWorth:desc');
    setPage(1);
  };

  const toggleLens = (nextLens: string) => {
    setLens(currentLens => currentLens === nextLens && nextLens !== 'all' ? 'all' : nextLens);
    setPage(1);
  };

  const downloadCsv = () => {
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csvRows = [
      ['기준', '필터', '순위', '이름', '신고시점 소속', '직위', '총자산', '채무', '순자산', '자산행'],
      ...rows.map((person, index) => [
        year, activeLens.label, from + index, person.name, person.agency, person.title,
        person.totalAssets, person.liabilities, person.netWorth, person.assetCount,
      ]),
    ];
    const url = URL.createObjectURL(new Blob(
      [`\uFEFF${csvRows.map(row => row.map(escape).join(',')).join('\n')}`],
      { type: 'text/csv;charset=utf-8' },
    ));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kwhale-officials-${year}-${lens}-page-${meta.page}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
      <section className="glass-card" style={{ padding: '26px', background: 'linear-gradient(145deg,rgba(15,23,42,.94),rgba(30,41,59,.42))' }}>
        <div className="officials-heading-row">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '28px', letterSpacing: '-1px' }}>공직자 데이터 탐색기</h2>
              <span style={{ color: activeLens.color, fontSize: '14px', fontWeight: 900 }}>{meta.total.toLocaleString()}명</span>
            </div>
            <p style={{ margin: '7px 0 0', color: '#94a3b8', fontSize: '13px', lineHeight: 1.55 }}>
              선택 신고 시점의 소속·직위와 공식 자산행을 기준으로 검색·분류합니다.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span title={meta.quality?.snapshotPolicy} style={{ color: meta.quality?.accountingPass ? '#34d399' : '#fb7185', fontSize: '11px', fontWeight: 900 }}>
              <CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: '5px' }} />
              회계대사 {meta.quality?.accountingPass ? 'PASS' : 'CHECK'}
            </span>
            <button type="button" onClick={downloadCsv} disabled={!rows.length} className="table-row-hover officials-action-button">
              <Download size={15} /> 현재 결과 CSV
            </button>
          </div>
        </div>

        <form onSubmit={applySearch} className="officials-search">
          <Search size={20} color="#fbbf24" />
          <input value={draftSearch} onChange={event => setDraftSearch(event.target.value)}
            placeholder="이름·소속·직위 복합 검색 (예: 김홍수 강릉, 국회 의원)" />
          {draftSearch && <button type="button" aria-label="검색어 지우기" onClick={() => setDraftSearch('')}><X size={16} /></button>}
          <button type="submit">검색</button>
        </form>

        <div style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px', color: '#94a3b8', fontSize: '12px', fontWeight: 900 }}>
            <SlidersHorizontal size={15} /> 기관 렌즈
          </div>
          <div className="officials-lens-row">
            {lenses.filter(item => item.group === 'scope').map(item => {
              const Icon = item.icon;
              const selected = lens === item.id;
              return <button key={item.id} type="button" onClick={() => toggleLens(item.id)}
                aria-pressed={selected}
                title={selected && item.id !== 'all' ? `${item.label} 렌즈 해제` : `${item.label} 렌즈 선택`}
                style={{ color: selected ? '#fff' : item.color, borderColor: selected ? item.color : `${item.color}35`, background: selected ? `${item.color}28` : 'rgba(255,255,255,.025)' }}>
                <Icon size={14} /> {item.label}
              </button>;
            })}
          </div>
        </div>

        <div style={{ marginTop: '15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px', color: '#94a3b8', fontSize: '12px', fontWeight: 900 }}>
            <BadgeDollarSign size={15} /> 자산 렌즈
          </div>
          <div className="officials-lens-row">
            {lenses.filter(item => item.group === 'asset').map(item => {
              const Icon = item.icon;
              const selected = lens === item.id;
              return <button key={item.id} type="button" onClick={() => toggleLens(item.id)}
                aria-pressed={selected}
                title={selected ? `${item.label} 렌즈 해제` : `${item.label} 렌즈 선택`}
                style={{ color: selected ? '#fff' : item.color, borderColor: selected ? item.color : `${item.color}35`, background: selected ? `${item.color}28` : 'rgba(255,255,255,.025)' }}>
                <Icon size={14} /> {item.label}
              </button>;
            })}
          </div>
        </div>

        <div style={{ marginTop: '15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px', color: '#94a3b8', fontSize: '12px', fontWeight: 900 }}>
            <ShieldCheck size={15} /> 품질 렌즈
          </div>
          <div className="officials-lens-row">
            {lenses.filter(item => item.group === 'quality').map(item => {
              const Icon = item.icon;
              const selected = lens === item.id;
              return <button key={item.id} type="button" onClick={() => toggleLens(item.id)}
                aria-pressed={selected}
                title={selected ? `${item.label} 렌즈 해제` : `${item.label} 렌즈 선택`}
                style={{ color: selected ? '#fff' : item.color, borderColor: selected ? item.color : `${item.color}35`, background: selected ? `${item.color}28` : 'rgba(255,255,255,.025)' }}>
                <Icon size={14} /> {item.label}
              </button>;
            })}
          </div>
        </div>
      </section>

      {summary && (
        <>
          <section className="officials-metric-grid">
            <Metric label="필터 결과 인원" value={`${Number(summary.persons).toLocaleString()}명`}
              detail={`${activeLens.label}${appliedSearch ? ` · “${appliedSearch}”` : ''}`} color="#38bdf8" />
            <Metric label="공식 신고 총자산" value={formatCurrency(summary.grossAssets)}
              detail={`채무 제외 · ${meta.quality?.snapshotPolicy || ''}`} color="#60a5fa" />
            <Metric label="공식 신고 순자산" value={formatCurrency(summary.netWorth)}
              detail={`총자산 - 채무 ${formatCurrency(summary.liabilities)}`} color="#34d399" />
            <Metric label="1인당 평균 순자산" value={formatCurrency(summary.averageNetWorth)}
              detail={`100억+ ${Number(summary.highNetCount).toLocaleString()}명 · 음수 ${Number(summary.negativeNetCount).toLocaleString()}명`} color="#fbbf24" />
          </section>
          <section className="officials-quality-strip" aria-label="현재 결과 데이터 품질">
            <span><CheckCircle2 size={14} color="#34d399" /> 자산 회계식 <strong>100%</strong></span>
            <span><ShieldCheck size={14} color="#38bdf8" /> 원본 계보 <strong>{(Number(meta.quality?.sourceLineageCoverage || 0) * 100).toFixed(0)}%</strong></span>
            <span><Users size={14} color="#c084fc" /> 동명이인 <strong>{Number(summary.homonymCount).toLocaleString()}명</strong></span>
            <span><Activity size={14} color="#f97316" /> 소속 누락 <strong>{Number(summary.missingOrgCount).toLocaleString()}명</strong> · 직위 누락 <strong>{Number(summary.missingTitleCount).toLocaleString()}명</strong></span>
          </section>
        </>
      )}

      <section className="glass-card officials-results-card">
        <div className="officials-results-toolbar">
          <div>
            <strong style={{ fontSize: '16px' }}>{activeLens.label}</strong>
            <span style={{ marginLeft: '8px', color: '#64748b', fontSize: '12px' }}>{from.toLocaleString()}–{to.toLocaleString()} / {meta.total.toLocaleString()}명</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {(lens !== 'all' || appliedSearch) && <button type="button" onClick={resetFilters} className="officials-reset"><X size={14} /> 초기화</button>}
            <label className="officials-sort">
              <ArrowDownAZ size={15} />
              <select aria-label="공직자 정렬" value={sortValue} onChange={event => { setSortValue(event.target.value); setPage(1); }}>
                {sortOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
        </div>

        {error ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#fb7185' }}>{error}<br /><button type="button" onClick={fetchData} style={{ marginTop: '12px' }}>다시 시도</button></div>
        ) : loading ? (
          <div style={{ padding: '70px', textAlign: 'center', color: '#fbbf24' }}><Activity size={32} className="spin-animation" /><div style={{ marginTop: '12px' }}>공식 신고 스냅샷을 조회하는 중입니다…</div></div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: '#94a3b8' }}><Search size={28} /><p>조건에 맞는 공직자가 없습니다.</p><button type="button" onClick={resetFilters}>필터 초기화</button></div>
        ) : (
          <div className="officials-table-wrap">
            <table className="officials-table">
              <thead><tr>
                <th>순위</th><th>공직자</th><th>신고 당시 소속·직위</th>
                <th className="number">총자산</th><th className="number">채무</th>
                <th className="number">순자산</th><th className="number">자산행</th><th aria-label="상세" />
              </tr></thead>
              <tbody>
                {rows.map((person, index) => {
                  const rank = from + index;
                  return (
                    <tr key={person.id} onClick={() => navigate(`/officials/${person.id}?year=${year}`)} tabIndex={0}
                      onKeyDown={event => { if (event.key === 'Enter') navigate(`/officials/${person.id}?year=${year}`); }}>
                      <td><strong style={{ color: rank <= 3 && sortValue === 'netWorth:desc' ? '#fbbf24' : '#64748b' }}>#{rank}</strong></td>
                      <td>
                        <strong className="official-name">{person.name}</strong>
                        {Number(person.sameNameCount) > 1 && <span className="homonym-badge" title={`현재 기준에 같은 이름의 서로 다른 공직자가 ${Number(person.sameNameCount).toLocaleString('ko-KR')}명 있습니다.`}>동명이인 {Number(person.sameNameCount).toLocaleString('ko-KR')}명</span>}
                        <small className="mobile-only">{person.latestYear}년</small>
                      </td>
                      <td><span className="agency">{person.agency || '소속 미기재'}</span><small>{person.title || '직위 미기재'} · {person.latestYear}년</small></td>
                      <td className="number secondary">{formatCurrency(person.totalAssets)}</td>
                      <td className="number debt">{person.liabilities ? formatCurrency(person.liabilities) : '-'}</td>
                      <td className={`number net ${person.netWorth < 0 ? 'negative' : ''}`}>{formatCurrency(person.netWorth)}</td>
                      <td className="number secondary">{Number(person.assetCount).toLocaleString()}건</td>
                      <td><ArrowUpRight size={16} color="#38bdf8" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {meta.totalPages > 1 && (
        <nav aria-label="공직자 목록 페이지" className="officials-pagination">
          <span>{from.toLocaleString()}–{to.toLocaleString()} / {meta.total.toLocaleString()}명</span>
          <div>
            <button type="button" disabled={meta.page <= 1} onClick={() => setPage(meta.page - 1)} aria-label="이전 페이지"><ChevronLeft size={16} /></button>
            {pageNumbers.map(number => <button key={number} type="button" aria-current={number === meta.page ? 'page' : undefined}
              onClick={() => setPage(number)}>{number}</button>)}
            <button type="button" disabled={meta.page >= meta.totalPages} onClick={() => setPage(meta.page + 1)} aria-label="다음 페이지"><ChevronRight size={16} /></button>
          </div>
        </nav>
      )}
    </div>
  );
}
