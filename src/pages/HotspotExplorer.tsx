import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, Building2, CheckCircle2, ChevronRight, LandPlot,
  Search, ShieldCheck, Target, UsersRound, X,
} from 'lucide-react';

type RegionNode = {
  name: string;
  assetCount: number;
  totalValuation: number;
  buildingCount: number;
  landCount: number;
  officialsCount: number;
  averageValuation: number;
  topAsset: null | {
    officialId: string;
    name: string;
    subcategory: string;
    valuation: number;
    detail: string;
  };
};

type RegionStats = {
  assetCount: number;
  officialsCount: number;
  totalValuation: number;
  averageValuation: number;
  addressMatchedCount: number;
  addressCoverage: number;
  topFiveShare: number;
  buildingCount: number;
  landCount: number;
  reconciliationPass: boolean;
};

type Breakdown = RegionNode;

const formatCurrency = (amount: number) => {
  const value = Number(amount || 0);
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}조 원`;
  if (value >= 100_000_000) return `${(value / 100_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억 원`;
  return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만 원`;
};

const displaySubtype = (value: string) => value
  .replace(/^복합건물주택\+상가/, '복합건물(주택·상가)')
  .replace(/^자동차관련시설/, '자동차 관련 시설');

export default function HotspotExplorer() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const year = searchParams.get('year') || 'recent';
  const [level, setLevel] = useState<'province' | 'district' | 'locality'>('province');
  const [province, setProvince] = useState('all');
  const [district, setDistrict] = useState('all');
  const [category, setCategory] = useState('all');
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [regions, setRegions] = useState<RegionNode[]>([]);
  const [stats, setStats] = useState<RegionStats | null>(null);
  const [subcategoryBreakdown, setSubcategoryBreakdown] = useState<Breakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    // Request lifecycle state is intentionally synchronized with this query effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ year, level, province, district, category, search });
    fetch(`/api/analysis/real-estate-regions?${query}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '지역 데이터를 계산할 수 없습니다.');
        setRegions(Array.isArray(result.data?.regions) ? result.data.regions : []);
        setStats(result.data?.stats || null);
        setSubcategoryBreakdown(Array.isArray(result.data?.subcategoryBreakdown) ? result.data.subcategoryBreakdown : []);
        setLoading(false);
      })
      .catch(reason => {
        if (reason.name !== 'AbortError') {
          setError(reason.message || '지역 분석 데이터를 불러오지 못했습니다.');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [category, district, level, province, search, year]);

  useEffect(() => {
    // Year-scoped drill-down controls intentionally return to the national view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLevel('province');
    setProvince('all');
    setDistrict('all');
    setCategory('all');
    setSearch('');
    setDraftSearch('');
  }, [year]);

  const maxValuation = useMemo(
    () => Math.max(1, ...regions.map(item => Number(item.totalValuation))),
    [regions],
  );

  const resetRegion = () => {
    setLevel('province');
    setProvince('all');
    setDistrict('all');
  };

  const selectRegion = (item: RegionNode) => {
    if (level === 'province') {
      setProvince(item.name);
      setDistrict('all');
      setLevel('district');
    } else if (level === 'district') {
      setDistrict(item.name);
      setLevel('locality');
    } else {
      navigate(`/real-estate?year=${year}&province=${encodeURIComponent(province)}&district=${encodeURIComponent(district)}&search=${encodeURIComponent(item.name)}`);
    }
  };

  const toggleCategory = (value: string) => {
    setCategory(current => current === value && value !== 'all' ? 'all' : value);
  };

  return (
    <div className="property-page region-intelligence">
      <section className="glass-card property-hero">
        <div className="property-heading">
          <div className="property-title">
            <div>
              <h2>부동산 지역 인텔리전스</h2>
              <p>시·도에서 시군구·읍면동까지, 공식 신고가액과 보유 밀도를 같은 기준으로 비교합니다.</p>
            </div>
          </div>
          <span className={`ranking-pass ${stats?.reconciliationPass ? 'pass' : 'check'}`}>
            <CheckCircle2 size={15} /> 건물·토지 회계대사 {stats?.reconciliationPass ? 'PASS' : 'CHECK'}
          </span>
        </div>
        <div className="property-method">
          <span><ShieldCheck size={14} /> 시세 추정 없음</span>
          <span>주소 원문 단계별 파싱</span>
          <span>인물별 선택 스냅샷</span>
          <span>주소 커버리지 {((stats?.addressCoverage || 0) * 100).toFixed(1)}%</span>
        </div>
        <form className="property-search" onSubmit={event => { event.preventDefault(); setSearch(draftSearch.trim()); }}>
          <Search size={17} />
          <input value={draftSearch} onChange={event => setDraftSearch(event.target.value)}
            placeholder="지역명·읍면동·주소 원문 검색" />
          {draftSearch && <button type="button" aria-label="검색어 지우기" onClick={() => { setDraftSearch(''); setSearch(''); }}><X size={15} /></button>}
          <button type="submit">지역 검색</button>
        </form>
      </section>

      {stats && (
        <section className="property-metrics">
          <article><span><Building2 size={16} /> 공식 부동산 신고액</span><strong>{formatCurrency(stats.totalValuation)}</strong><small>건물+토지 공식 평가액</small></article>
          <article><span><UsersRound size={16} /> 신고 공직자</span><strong>{stats.officialsCount.toLocaleString()}명</strong><small>현재 탐색 범위 중복 제거</small></article>
          <article><span><Target size={16} /> 포착 자산</span><strong>{stats.assetCount.toLocaleString()}건</strong><small>건물 {stats.buildingCount.toLocaleString()} · 토지 {stats.landCount.toLocaleString()}</small></article>
          <article><span><LandPlot size={16} /> 상위 5지역 집중도</span><strong>{(stats.topFiveShare * 100).toFixed(1)}%</strong><small>선택 범위 신고가액 기준</small></article>
        </section>
      )}

      <section className="glass-card property-workbench">
        <div className="property-filter-row">
          <div>
            <b>자산 렌즈</b>
            <span>같은 지역에서 건물과 토지 구성을 분리합니다.</span>
          </div>
          <div className="property-pills">
            {[['all', '전체 부동산'], ['건물', '건물'], ['토지', '토지']].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={category === id} onClick={() => toggleCategory(id)}>{label}</button>
            ))}
          </div>
        </div>

        <div className="property-breadcrumbs">
          <button type="button" onClick={resetRegion} aria-current={level === 'province'}>전국</button>
          {province !== 'all' && <><ChevronRight size={14} /><button type="button" onClick={() => { setLevel('district'); setDistrict('all'); }}>{province}</button></>}
          {district !== 'all' && <><ChevronRight size={14} /><button type="button" onClick={() => setLevel('locality')}>{district}</button></>}
          <span>{level === 'province' ? '시·도 비교' : level === 'district' ? '시·군·구 비교' : '읍·면·동 비교'}</span>
        </div>

        {error ? <div className="property-empty error">{error}</div> :
          loading ? <div className="property-empty">공식 주소 자산행을 지역별로 집계하는 중입니다…</div> :
            regions.length === 0 ? <div className="property-empty">현재 조건에 맞는 지역 자산이 없습니다.</div> : (
              <div className="region-rank-grid">
                {regions.map((item, index) => {
                  const buildingShare = item.assetCount ? item.buildingCount / item.assetCount * 100 : 0;
                  return (
                    <button key={item.name} type="button" className="region-rank-card" onClick={() => selectRegion(item)}>
                      <div className="region-rank-head">
                        <span>#{index + 1}</span>
                        <div><strong>{item.name}</strong><small>{item.officialsCount.toLocaleString()}명 · {item.assetCount.toLocaleString()}건</small></div>
                        <ArrowRight size={16} />
                      </div>
                      <div className="region-rank-value">
                        <strong>{formatCurrency(item.totalValuation)}</strong>
                        <span>건당 평균 {formatCurrency(item.averageValuation)}</span>
                      </div>
                      <div className="region-composition">
                        <i style={{ width: `${buildingShare}%` }} />
                      </div>
                      <div className="region-composition-label">
                        <span>건물 {item.buildingCount.toLocaleString()}</span><span>토지 {item.landCount.toLocaleString()}</span>
                      </div>
                      <div className="region-scale"><i style={{ width: `${Math.max(4, item.totalValuation / maxValuation * 100)}%` }} /></div>
                      {item.topAsset && (
                        <div className="region-top-asset">
                          <span>최고 신고 자산</span>
                          <strong>{item.topAsset.name} · {formatCurrency(item.topAsset.valuation)}</strong>
                          <small>{displaySubtype(item.topAsset.subcategory)} · {item.topAsset.detail}</small>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

        {subcategoryBreakdown.length > 0 && (
          <div className="property-breakdown">
            <div className="property-section-head"><div><b>자산 유형 구성</b><span>현재 지역 범위의 공식 소분류</span></div></div>
            <div className="property-breakdown-grid">
              {subcategoryBreakdown.slice(0, 12).map(item => (
                <div key={item.name}><strong>{displaySubtype(item.name)}</strong><span>{item.assetCount.toLocaleString()}건</span><small>{formatCurrency(item.totalValuation)}</small></div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
