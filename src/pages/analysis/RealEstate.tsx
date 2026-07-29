import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowUpRight, Building2, CheckCircle2, ChevronDown, Database,
  Search, ShieldCheck, SlidersHorizontal, UsersRound, X,
} from 'lucide-react';
import AssetDetailView from '../../components/AssetDetailView';
import RealEstateAlphaDeck, {
  type RealEstateAlpha,
  type RealEstateAlphaTarget,
} from '../../components/RealEstateAlphaDeck';

type AssetRow = {
  id: string;
  officialId: string;
  name: string;
  agency: string;
  title: string;
  category: string;
  subcategory: string;
  owner: string;
  detail: string;
  valuation: number;
  province: string;
  district: string;
  locality: string;
  year: number;
  disclosedAt: string;
  sourceRecordIndex: number;
  sourceRecordHash: string;
  sourceUrl: string;
  fileSha256: string;
};

type Breakdown = {
  name: string;
  assetCount: number;
  totalValuation: number;
  officialsCount: number;
};

type OfficialSummary = {
  officialId: string;
  name: string;
  agency: string;
  title: string;
  assetCount: number;
  totalValuation: number;
};

type Stats = {
  assetCount: number;
  officialsCount: number;
  totalValuation: number;
  averageValuation: number;
  maximumValuation: number;
  reconciliationPass: boolean;
};

const formatCurrency = (amount: number) => {
  const value = Number(amount || 0);
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}조 원`;
  if (value >= 100_000_000) return `${(value / 100_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억 원`;
  return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만 원`;
};

const valueLenses = [
  { id: 0, label: '전체 가액' },
  { id: 1_000_000_000, label: '10억+' },
  { id: 3_000_000_000, label: '30억+' },
  { id: 5_000_000_000, label: '50억+' },
];

const displaySubtype = (value: string) => value
  .replace(/^복합건물주택\+상가/, '복합건물(주택·상가)')
  .replace(/^자동차관련시설/, '자동차 관련 시설');

export default function RealEstate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const year = searchParams.get('year') || 'recent';
  const [category, setCategory] = useState('all');
  const [subcategory, setSubcategory] = useState('all');
  const [province, setProvince] = useState(searchParams.get('province') || 'all');
  const [district, setDistrict] = useState(searchParams.get('district') || 'all');
  const [minValue, setMinValue] = useState(0);
  const [sort, setSort] = useState('valuation');
  const [draftSearch, setDraftSearch] = useState(searchParams.get('search') || '');
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [subcategories, setSubcategories] = useState<Breakdown[]>([]);
  const [regions, setRegions] = useState<Breakdown[]>([]);
  const [districts, setDistricts] = useState<Breakdown[]>([]);
  const [topOfficials, setTopOfficials] = useState<OfficialSummary[]>([]);
  const [alpha, setAlpha] = useState<RealEstateAlpha | null>(null);
  const [meta, setMeta] = useState({ total: 0, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadAssets = useCallback((offset = 0, append = false) => {
    const controller = new AbortController();
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    const query = new URLSearchParams({
      year, category, subcategory, province, district, minValue: String(minValue),
      sort, search, limit: '50', offset: String(offset),
    });
    fetch(`/api/analysis/real-estate-assets?${query}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '부동산 자산을 계산할 수 없습니다.');
        const next = Array.isArray(result.data?.assets) ? result.data.assets : [];
        setAssets(current => append ? [...current, ...next] : next);
        setStats(result.data?.stats || null);
        if (subcategory === 'all') {
          setSubcategories(Array.isArray(result.data?.subcategoryBreakdown) ? result.data.subcategoryBreakdown : []);
        }
        if (province === 'all') {
          setRegions(Array.isArray(result.data?.regionBreakdown) ? result.data.regionBreakdown : []);
        }
        setTopOfficials(Array.isArray(result.data?.topOfficials) ? result.data.topOfficials : []);
        setAlpha(result.data?.alpha || null);
        setMeta(result.data?.meta || { total: next.length, hasMore: false });
        setLoading(false);
        setLoadingMore(false);
      })
      .catch(reason => {
        if (reason.name !== 'AbortError') {
          setError(reason.message || '부동산 데이터를 불러오지 못했습니다.');
          setLoading(false);
          setLoadingMore(false);
        }
      });
    return () => controller.abort();
  }, [category, district, minValue, province, search, sort, subcategory, year]);

  // The callback owns request cancellation and loading state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => loadAssets(), [loadAssets]);

  useEffect(() => {
    const query = new URLSearchParams({ year, level: 'district', province, district: 'all', category, search: '' });
    if (province === 'all') {
      // District options are invalid without a selected province.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDistricts([]);
      return;
    }
    fetch(`/api/analysis/real-estate-regions?${query}`)
      .then(response => response.json())
      .then(result => setDistricts(Array.isArray(result.data?.regions) ? result.data.regions : []))
      .catch(() => setDistricts([]));
  }, [category, province, year]);

  useEffect(() => {
    // Year-scoped filters intentionally reset to the full snapshot.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCategory('all');
    setSubcategory('all');
    setProvince('all');
    setDistrict('all');
    setMinValue(0);
    setSearch('');
    setDraftSearch('');
  }, [year]);

  const maxOfficialValue = useMemo(
    () => Math.max(1, ...topOfficials.map(item => Number(item.totalValuation))),
    [topOfficials],
  );
  const toggleCategory = (value: string) => {
    setCategory(current => current === value && value !== 'all' ? 'all' : value);
    setSubcategory('all');
  };
  const applyAlphaTarget = (target: RealEstateAlphaTarget) => {
    if (target.officialId) {
      navigate(`/officials/${target.officialId}?year=${year}`);
      return;
    }
    setCategory(target.category || 'all');
    setSubcategory(target.subcategory || 'all');
    setProvince(target.province || 'all');
    setDistrict(target.district || 'all');
    setMinValue(Number(target.minValue || 0));
    const nextSearch = target.search || '';
    setSearch(nextSearch);
    setDraftSearch(nextSearch);
  };

  return (
    <div className="property-page property-deepdive">
      <section className="glass-card property-hero deepdive-hero">
        <div className="property-heading">
          <div className="property-title">
            <div><h2>부동산 딥다이브</h2><p>지역·유형·가액을 교차해 개별 자산과 보유자, 원본 계보까지 추적합니다.</p></div>
          </div>
          <span className={`ranking-pass ${stats?.reconciliationPass ? 'pass' : 'check'}`}>
            <CheckCircle2 size={15} /> 자산군 합계 {stats?.reconciliationPass ? 'PASS' : 'CHECK'}
          </span>
        </div>
        <div className="property-method">
          <span><ShieldCheck size={14} /> 공식 신고 평가액</span><span>시세·수익률 추정 없음</span>
          <span>원문 자산행 단위</span><span>데이터 계보 보존</span>
        </div>
        <form className="property-search" onSubmit={event => { event.preventDefault(); setSearch(draftSearch.trim()); }}>
          <Search size={17} />
          <input value={draftSearch} onChange={event => setDraftSearch(event.target.value)}
            placeholder="공직자·소속·주소·건물명·명의자 검색" />
          {draftSearch && <button type="button" aria-label="검색어 지우기" onClick={() => { setDraftSearch(''); setSearch(''); }}><X size={15} /></button>}
          <button type="submit">정밀 검색</button>
        </form>
      </section>

      {stats && (
        <section className="property-metrics">
          <article><span><Building2 size={16} /> 필터 신고가액</span><strong>{formatCurrency(stats.totalValuation)}</strong><small>현재 조건 공식 평가액</small></article>
          <article><span><UsersRound size={16} /> 보유 공직자</span><strong>{stats.officialsCount.toLocaleString()}명</strong><small>인물 중복 제거</small></article>
          <article><span><Database size={16} /> 자산 원문</span><strong>{stats.assetCount.toLocaleString()}건</strong><small>현재 50건 단위 탐색</small></article>
          <article><span><ArrowUpRight size={16} /> 최고 신고 자산</span><strong>{formatCurrency(stats.maximumValuation)}</strong><small>단일 자산행 기준</small></article>
        </section>
      )}

      <RealEstateAlphaDeck alpha={alpha} onSelect={applyAlphaTarget} />

      <section className="glass-card property-workbench">
        <div className="deepdive-filters">
          <div className="property-filter-row">
            <div><b>자산군</b><span>건물과 토지를 독립적으로 비교합니다.</span></div>
            <div className="property-pills">
              {[['all', '전체 부동산'], ['건물', '건물'], ['토지', '토지']].map(([id, label]) => (
                <button key={id} type="button" aria-pressed={category === id} onClick={() => toggleCategory(id)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="property-filter-row">
            <div><b>신고가액 렌즈</b><span>단일 자산행의 공식 평가액 하한입니다.</span></div>
            <div className="property-pills">
              {valueLenses.map(item => <button key={item.id} type="button" aria-pressed={minValue === item.id}
                onClick={() => setMinValue(current => current === item.id && item.id !== 0 ? 0 : item.id)}>{item.label}</button>)}
            </div>
          </div>
          {subcategories.length > 0 && (
            <div className="property-filter-row stacked">
              <div><b>자산 소분류</b><span>원문 분류를 보존한 유형 필터</span></div>
              <div className="property-facet-scroll">
                <button type="button" aria-pressed={subcategory === 'all'} onClick={() => setSubcategory('all')}>전체 유형</button>
                {subcategories.slice(0, 24).map(item => <button key={item.name} type="button"
                  aria-pressed={subcategory === item.name}
                  onClick={() => setSubcategory(current => current === item.name ? 'all' : item.name)}>
                  {displaySubtype(item.name)}<span>{item.assetCount.toLocaleString()}</span>
                </button>)}
              </div>
            </div>
          )}
          <div className="property-filter-row stacked">
            <div><b>지역</b><span>시·도와 시군구를 교차 선택합니다.</span></div>
            <div className="property-select-row">
              <label>시·도<select value={province} onChange={event => { setProvince(event.target.value); setDistrict('all'); }}>
                <option value="all">전국</option>{regions.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
              </select></label>
              <label>시·군·구<select value={district} onChange={event => setDistrict(event.target.value)} disabled={province === 'all'}>
                <option value="all">전체 시군구</option>{districts.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
              </select></label>
              <label>정렬<select value={sort} onChange={event => setSort(event.target.value)}>
                <option value="valuation">신고가액 큰 순</option><option value="region">지역 순</option><option value="name">공직자 이름 순</option>
              </select></label>
            </div>
          </div>
        </div>

        {topOfficials.length > 0 && (
          <div className="deepdive-leaders">
            <div className="property-section-head"><div><b>필터 범위 부동산 큰손</b><span>선택 조건 자산행을 인물별로 재합산</span></div></div>
            <div className="leader-strip">
              {topOfficials.slice(0, 5).map((item, index) => (
                <button key={item.officialId} type="button" onClick={() => navigate(`/officials/${item.officialId}?year=${year}`)}>
                  <span>#{index + 1}</span><div><strong>{item.name}</strong><small>{item.agency}</small></div>
                  <b>{formatCurrency(item.totalValuation)}</b>
                  <i><em style={{ width: `${item.totalValuation / maxOfficialValue * 100}%` }} /></i>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="property-section-head asset-result-head">
          <div><b>공식 부동산 자산 원장</b><span>{meta.total.toLocaleString()}건 · 현재 {assets.length.toLocaleString()}건 표시</span></div>
          <span><SlidersHorizontal size={14} /> 모든 필터 서버 집계</span>
        </div>

        {error ? <div className="property-empty error">{error}</div> :
          loading ? <div className="property-empty">공식 부동산 원장을 질의하는 중입니다…</div> :
            assets.length === 0 ? <div className="property-empty">현재 조건에 맞는 부동산 자산이 없습니다.</div> : (
              <div className="property-asset-list">
                {assets.map((asset, index) => {
                  const expanded = expandedId === asset.id;
                  return (
                    <article key={asset.id} className="property-asset-row">
                      <button type="button" className="property-asset-main" onClick={() => setExpandedId(current => current === asset.id ? null : asset.id)}>
                        <span className="property-asset-rank">#{index + 1}</span>
                        <div className="property-asset-copy">
                          <div><span>{asset.category}</span><em>{displaySubtype(asset.subcategory)}</em><small>{asset.owner || '명의 미기재'}</small></div>
                          <strong>{asset.name}<small>{asset.agency} · {asset.title || '직위 미기재'}</small></strong>
                          <AssetDetailView text={asset.detail} category={asset.category} initialLimit={3} compact />
                        </div>
                        <div className="property-asset-value"><strong>{formatCurrency(asset.valuation)}</strong><span>{asset.province} · {asset.district}</span></div>
                      </button>
                      {expanded && (
                        <div className="property-asset-expanded">
                          <div className="property-expanded-grid">
                            <span>공개연도<strong>{asset.year}년</strong></span><span>명의자<strong>{asset.owner || '미기재'}</strong></span>
                            <span>지역<strong>{asset.province} {asset.district} {asset.locality}</strong></span>
                            <span>공개일<strong>{asset.disclosedAt?.slice(0, 10) || '미기재'}</strong></span>
                          </div>
                          <div className="property-source-detail"><b>원문 자산 상세</b><AssetDetailView text={asset.detail} category={asset.category} initialLimit={12} /></div>
                          <div className="new-assets-lineage">
                            <span>원본 레코드 #{Number(asset.sourceRecordIndex).toLocaleString()}</span>
                            <span>레코드 해시 {asset.sourceRecordHash?.slice(0, 16)}…</span><span>파일 SHA-256 {asset.fileSha256?.slice(0, 16)}…</span>
                          </div>
                          <div className="new-assets-expanded-actions">
                            <button type="button" onClick={() => navigate(`/officials/${asset.officialId}?year=${year}`)}>인물 전체 자산 보기</button>
                            {asset.sourceUrl && <a href={asset.sourceUrl} target="_blank" rel="noreferrer">보존 원본 출처</a>}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

        {meta.hasMore && <button type="button" className="new-assets-more" disabled={loadingMore}
          onClick={() => loadAssets(assets.length, true)}>
          {loadingMore ? '불러오는 중…' : '자산 더 보기'}<span>{Math.max(0, meta.total - assets.length).toLocaleString()}건 남음</span><ChevronDown size={17} />
        </button>}
      </section>
    </div>
  );
}
