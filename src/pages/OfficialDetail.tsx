import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDownRight, ArrowLeft, ArrowUpRight, Bitcoin, Building2, CheckCircle2,
  ChevronDown, ChevronUp, ExternalLink, FileCheck2, Landmark, MapPin, Search,
  ShieldCheck, TrendingUp, UserRound, Users, Wallet,
} from 'lucide-react';
import AssetDetailView from '../components/AssetDetailView';

const detailCache = new Map<string, any>();

const formatCurrency = (amount: number | null | undefined): string => {
  const value = Number(amount || 0);
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000_000) return `${sign}${(absolute / 1_000_000_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}조 원`;
  if (absolute >= 100_000_000) return `${sign}${(absolute / 100_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억 원`;
  return `${sign}${Math.round(absolute / 10_000).toLocaleString('ko-KR')}만 원`;
};

const categoryColor = (category: string) => {
  if (category.includes('가상자산')) return '#ef4444';
  if (category.includes('건물')) return '#3b82f6';
  if (category.includes('토지')) return '#22c55e';
  if (category.includes('예금')) return '#8b5cf6';
  if (category.includes('증권')) return '#f59e0b';
  if (category.includes('채권')) return '#14b8a6';
  if (category.includes('채무')) return '#fb7185';
  if (category.includes('동산')) return '#d946ef';
  return '#64748b';
};

const categoryIcon = (category: string, size = 18) => {
  if (category.includes('가상자산')) return <Bitcoin size={size} />;
  if (category.includes('건물') || category.includes('토지')) return <Building2 size={size} />;
  if (category.includes('예금')) return <Wallet size={size} />;
  if (category.includes('증권')) return <TrendingUp size={size} />;
  if (category.includes('채권') || category.includes('채무')) return <Landmark size={size} />;
  return <FileCheck2 size={size} />;
};

function FinancialCard({ label, value, detail, color, icon, tooltip }: any) {
  return (
    <div title={tooltip} style={{
      padding: '18px', borderRadius: '14px', minWidth: 0,
      background: `linear-gradient(180deg, ${color}14, rgba(255,255,255,.018))`,
      border: '1px solid rgba(255,255,255,.07)', borderTop: `1px solid ${color}99`,
      cursor: tooltip ? 'help' : 'default',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', color: '#94a3b8', fontSize: '12px', fontWeight: 800 }}>
        {label}<span style={{ color }}>{icon}</span>
      </div>
      <div style={{ marginTop: '9px', fontSize: 'clamp(22px,2.4vw,32px)', fontWeight: 900, color: '#fff', letterSpacing: '-.8px' }}>{value}</div>
      <div style={{ marginTop: '5px', color, fontSize: '11px' }}>{detail}</div>
    </div>
  );
}

function LoadingProfile() {
  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div style={{ color: '#94a3b8', fontSize: '13px' }}>공식 신고 프로필을 불러오는 중입니다…</div>
      <div className="glass-card" style={{ height: '150px', opacity: .45 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: '12px' }}>
        {[1, 2, 3, 4].map(item => <div key={item} className="glass-card" style={{ height: '112px', opacity: .35 }} />)}
      </div>
    </div>
  );
}

export default function OfficialDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const year = searchParams.get('year') || 'recent';
  const cacheKey = `${id}:${year}`;
  const [data, setData] = useState<any>(() => detailCache.get(cacheKey) || null);
  const [loading, setLoading] = useState(!detailCache.has(cacheKey));
  const [error, setError] = useState('');
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('전체');
  const [assetSearch, setAssetSearch] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const cached = detailCache.get(cacheKey);
    setExpandedAssetId(null);
    setCategoryFilter('전체');
    setAssetSearch('');
    setError('');
    if (cached) {
      setData(cached);
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    fetch(`/api/officials/${id}?year=${year}`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`profile ${response.status}`);
        return response.json();
      })
      .then(result => {
        if (!result.success) throw new Error(result.error || 'profile response');
        detailCache.set(cacheKey, result.data);
        setData(result.data);
        setLoading(false);
      })
      .catch(fetchError => {
        if (fetchError.name !== 'AbortError') {
          setError('해당 신고 프로필을 불러오지 못했습니다.');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [cacheKey, id, year]);

  const filteredAssets = useMemo(() => {
    if (!data?.assets) return [];
    const query = assetSearch.trim().toLowerCase();
    return [...data.assets]
      .filter((asset: any) => categoryFilter === '전체' || asset.category === categoryFilter)
      .filter((asset: any) => !query || `${asset.category} ${asset.detailType || ''} ${asset.owner || ''} ${asset.address || ''}`.toLowerCase().includes(query))
      .sort((a: any, b: any) => Number(b.valuation) - Number(a.valuation));
  }, [data, categoryFilter, assetSearch]);

  if (loading && !data) return <LoadingProfile />;
  if (error || !data) return <div className="glass-card" style={{ padding: '28px', color: '#fb7185' }}>{error || '데이터를 찾을 수 없습니다.'}</div>;

  const summary = data.summary || {};
  const comparison = data.comparison;
  const quality = data.quality;
  const history = Array.isArray(data.disclosures)
    ? data.disclosures.filter(
        (item: any, index: number, rows: any[]) =>
          rows.findIndex(candidate => Number(candidate.year) === Number(item.year)) === index
      )
    : [];
  const assetCategories = ['전체', ...new Set(data.assets.map((asset: any) => asset.category))] as string[];
  const composition = (summary.categories || []).filter((item: any) => !item.isLiability && item.valuation > 0);
  const ownerSummary = summary.owners || [];
  const lineageReady = Number.isFinite(Number(data.sourceRecordIndex)) && data.sourceRecordHash && data.sourceSha256;
  const netChange = Number(comparison?.netWorthChange || 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => navigate(-1)} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8', background: 'transparent', border: 0, cursor: 'pointer', padding: 0 }}>
          <ArrowLeft size={20} /> 뒤로 가기
        </button>
        <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
          {history.map((item: any) => (
            <button key={item.id} type="button" onClick={() => navigate(`/officials/${id}?year=${item.year}`)}
              title={`${item.year}년 · 자산 ${Number(item.assetCount).toLocaleString()}건 · 순자산 ${formatCurrency(item.netWorth)}`}
              style={{
                padding: '7px 12px', borderRadius: '8px', cursor: 'pointer', fontWeight: 800,
                color: Number(item.year) === Number(data.latestYear) ? '#07111f' : '#cbd5e1',
                background: Number(item.year) === Number(data.latestYear) ? '#38bdf8' : 'rgba(255,255,255,.04)',
                border: '1px solid rgba(255,255,255,.1)',
              }}>{item.year}</button>
          ))}
        </div>
      </div>

      <section className="glass-card" style={{ padding: '26px', background: 'linear-gradient(135deg,rgba(15,23,42,.96),rgba(30,41,59,.52))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#38bdf8', fontSize: '12px', fontWeight: 900 }}>{data.latestYear}년 공식 재산신고</div>
            <h2 style={{ margin: '7px 0 6px', fontSize: 'clamp(30px,4vw,42px)', letterSpacing: '-1.2px' }}>{data.name}</h2>
            <div style={{ color: '#94a3b8', lineHeight: 1.5 }}><span style={{ color: '#cbd5e1' }}>{data.agency}</span> · {data.title || '직위 미기재'}</div>
          </div>
          <div title="자산행 합계와 신고서 총자산·채무·순자산을 대조한 결과입니다." style={{
            display: 'flex', alignItems: 'center', gap: '7px', padding: '8px 11px', borderRadius: '9px',
            color: quality?.accountingPass && quality?.assetCompositionPass ? '#34d399' : '#fb7185',
            background: quality?.accountingPass ? 'rgba(52,211,153,.08)' : 'rgba(251,113,133,.08)',
            border: `1px solid ${quality?.accountingPass ? 'rgba(52,211,153,.22)' : 'rgba(251,113,133,.22)'}`,
            fontSize: '11px', fontWeight: 900,
          }}><CheckCircle2 size={15} /> 회계·구성 대사 {quality?.accountingPass && quality?.assetCompositionPass ? 'PASS' : 'CHECK'}</div>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '12px' }}>
        <FinancialCard label="신고 총자산" value={formatCurrency(data.totalAssets)} detail={`${Number(quality?.sourceRowCount || data.assets.length).toLocaleString('ko-KR')}개 원본 자산행`} icon={<Wallet size={18} />} color="#38bdf8" tooltip="채무를 제외한 공식 신고 평가액 합계입니다." />
        <FinancialCard label="신고 채무" value={formatCurrency(data.liabilities)} detail={`총자산의 ${(Number(data.totalAssets) ? Number(data.liabilities) / Number(data.totalAssets) * 100 : 0).toFixed(1)}%`} icon={<Landmark size={18} />} color="#fb7185" tooltip="공식 신고 채무 합계이며 자산구성 비중에서는 제외합니다." />
        <FinancialCard label="신고 순자산" value={formatCurrency(data.netWorth)} detail="총자산 - 채무" icon={<ShieldCheck size={18} />} color="#fbbf24" tooltip="공식 총자산에서 신고 채무를 차감한 값입니다." />
        <FinancialCard label={comparison ? `${comparison.previousYear}년 대비 순자산` : '직전 신고 비교'} value={comparison ? `${netChange >= 0 ? '+' : ''}${formatCurrency(netChange)}` : '-'}
          detail={comparison ? `총자산 ${Number(comparison.grossAssetsChange) >= 0 ? '+' : ''}${formatCurrency(comparison.grossAssetsChange)} · 채무 ${Number(comparison.liabilitiesChange) >= 0 ? '+' : ''}${formatCurrency(comparison.liabilitiesChange)}` : '비교 가능한 이전 신고 없음'}
          icon={netChange >= 0 ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />} color={netChange >= 0 ? '#34d399' : '#fb7185'} />
      </section>

      <section className="profile-overview-grid">
        <div className="glass-card" style={{ padding: '22px', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', marginBottom: '17px' }}>
            <div><h3 style={{ margin: 0, fontSize: '17px' }}>자산 포트폴리오</h3><p style={{ margin: '5px 0 0', color: '#64748b', fontSize: '11px' }}>채무 제외 · 총자산 기준 · 합계 100%</p></div>
            <strong style={{ color: '#94a3b8', fontSize: '12px' }}>{composition.length.toLocaleString('ko-KR')}개 자산군</strong>
          </div>
          <div style={{ display: 'flex', height: '18px', overflow: 'hidden', borderRadius: '999px', background: 'rgba(255,255,255,.04)' }}>
            {composition.map((item: any) => <div key={item.category} title={`${item.category} ${(item.shareOfGross * 100).toFixed(1)}% · ${formatCurrency(item.valuation)}`} style={{ width: `${item.shareOfGross * 100}%`, background: categoryColor(item.category) }} />)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '10px', marginTop: '16px' }}>
            {composition.map((item: any) => (
              <div key={item.category} style={{ padding: '10px', borderRadius: '9px', background: 'rgba(255,255,255,.025)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: categoryColor(item.category), fontSize: '11px', fontWeight: 800 }}>{categoryIcon(item.category, 14)}{item.category}</div>
                <strong style={{ display: 'block', marginTop: '6px' }}>{(item.shareOfGross * 100).toFixed(1)}%</strong>
                <small style={{ color: '#64748b' }}>{formatCurrency(item.valuation)} · {Number(item.count).toLocaleString('ko-KR')}건</small>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card" style={{ padding: '22px', minWidth: 0 }}>
          <h3 style={{ margin: '0 0 5px', fontSize: '17px' }}>소유자별 구성</h3>
          <p style={{ margin: '0 0 14px', color: '#64748b', fontSize: '11px' }}>가족관계 표기는 신고서 원문 기준</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {ownerSummary.map((owner: any) => (
              <div key={owner.owner} style={{ padding: '10px', borderRadius: '9px', background: 'rgba(255,255,255,.025)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}><strong style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}><UserRound size={14} color="#38bdf8" />{owner.owner}</strong><strong style={{ fontSize: '12px' }}>{formatCurrency(owner.grossAssets)}</strong></div>
                <div style={{ marginTop: '7px', display: 'flex', justifyContent: 'space-between', gap: '10px', color: '#94a3b8', fontSize: '12px', lineHeight: 1.45 }}>
                  <span>총자산 {(owner.shareOfGross * 100).toFixed(1)}% · {Number(owner.assetCount).toLocaleString('ko-KR')}건</span>
                  {owner.liabilities > 0 && <span style={{ color: '#fb7185', fontWeight: 700 }}>채무 {formatCurrency(owner.liabilities)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {comparison && (
        <section className="glass-card" style={{ padding: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'flex-end', marginBottom: '15px', flexWrap: 'wrap' }}>
            <div><h3 style={{ margin: 0, fontSize: '17px' }}>{comparison.previousYear} → {data.latestYear} 자산군 변화</h3><p style={{ margin: '5px 0 0', color: '#64748b', fontSize: '11px' }}>절대 증감액이 큰 순서 · 채무 증가는 순자산에 부정적</p></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '10px' }}>
            {comparison.categoryChanges.slice(0, 6).map((change: any) => {
              const positiveForWealth = change.isLiability ? change.difference <= 0 : change.difference >= 0;
              return (
                <div key={change.category} title={`이전 ${formatCurrency(change.previousValuation)} → 현재 ${formatCurrency(change.currentValuation)}`} style={{ padding: '12px', borderRadius: '9px', background: 'rgba(255,255,255,.025)', borderLeft: `3px solid ${positiveForWealth ? '#34d399' : '#fb7185'}` }}>
                  <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 800 }}>{change.category}{change.isLiability ? ' (채무)' : ''}</div>
                  <strong style={{ display: 'block', marginTop: '6px', color: positiveForWealth ? '#34d399' : '#fb7185' }}>{change.difference >= 0 ? '+' : ''}{formatCurrency(change.difference)}</strong>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '13px' }}>
          <div><h3 style={{ margin: 0, fontSize: '19px' }}>보유 자산 명세</h3><p style={{ margin: '5px 0 0', color: '#64748b', fontSize: '11px' }}>공식 신고 평가액 내림차순 · 행을 누르면 원문 명세를 해석합니다.</p></div>
          <div style={{ position: 'relative', width: 'min(280px,100%)' }}>
            <Search size={15} style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
            <input value={assetSearch} onChange={event => setAssetSearch(event.target.value)} placeholder="자산명·소유자·원문 검색" style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px 9px 34px', borderRadius: '9px', border: '1px solid rgba(255,255,255,.1)', background: 'rgba(0,0,0,.22)', color: '#fff' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {assetCategories.map(category => (
            <button key={category} type="button" onClick={() => setCategoryFilter(category)} style={{ padding: '7px 10px', borderRadius: '999px', cursor: 'pointer', border: `1px solid ${categoryFilter === category ? categoryColor(category) : 'rgba(255,255,255,.1)'}`, background: categoryFilter === category ? `${categoryColor(category)}22` : 'rgba(255,255,255,.025)', color: categoryFilter === category ? '#fff' : '#94a3b8', fontSize: '11px', fontWeight: 800 }}>{category}</button>
          ))}
        </div>
        <div style={{ color: '#64748b', fontSize: '11px', marginBottom: '9px' }}>{filteredAssets.length.toLocaleString()}개 자산행</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filteredAssets.map((asset: any) => {
            const expanded = expandedAssetId === asset.id;
            return (
              <article key={asset.id} style={{ borderRadius: '12px', border: `1px solid ${expanded ? `${categoryColor(asset.category)}55` : 'rgba(255,255,255,.06)'}`, background: expanded ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.018)', overflow: 'hidden' }}>
                <button type="button" onClick={() => setExpandedAssetId(expanded ? null : asset.id)} style={{ width: '100%', display: 'grid', gridTemplateColumns: '38px minmax(0,1fr) auto 22px', gap: '11px', alignItems: 'center', padding: '14px', border: 0, background: 'transparent', color: '#e2e8f0', textAlign: 'left', cursor: 'pointer' }}>
                  <span style={{ display: 'grid', placeItems: 'center', width: '36px', height: '36px', borderRadius: '9px', color: '#fff', background: categoryColor(asset.category) }}>{categoryIcon(asset.category, 17)}</span>
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px' }}>
                      {asset.category}
                      <small style={{ padding: '3px 8px', borderRadius: '999px', color: '#cbd5e1', background: 'rgba(255,255,255,.08)', fontSize: '12px', lineHeight: 1.35 }}>
                        {asset.owner || '소유자 미상'}
                      </small>
                    </strong>
                    <small style={{
                      display: 'block', marginTop: '5px', color: '#94a3b8',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      fontSize: '13px', lineHeight: 1.55,
                    }}>
                      {asset.detailType || '세부유형 미기재'}{asset.address ? ` · ${asset.address}` : ''}
                    </small>
                  </span>
                  <strong style={{ color: asset.category === '채무' ? '#fb7185' : '#fff', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '15px', letterSpacing: '-.2px' }}>{formatCurrency(asset.valuation)}</strong>
                  {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
                {expanded && (
                  <div style={{ padding: '0 14px 15px 63px' }}>
                    <div style={{ paddingTop: '13px', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                      <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '10px', fontWeight: 700 }}>원문 명세 구조화 결과</div>
                      {asset.address
                        ? <AssetDetailView text={asset.address} category={asset.category} initialLimit={10} />
                        : <div style={{ color: '#94a3b8', fontSize: '12px' }}>공개된 상세 원문이 없습니다.</div>}
                      {(asset.category.includes('건물') || asset.category.includes('토지')) && asset.address && (
                        <a href={`https://map.kakao.com/link/search/${encodeURIComponent(asset.address)}`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '8px', color: '#38bdf8', fontSize: '11px', fontWeight: 800, textDecoration: 'none' }}><MapPin size={13} /> 지도에서 검색 <ExternalLink size={12} /></a>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="glass-card" style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '16px', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '7px', fontSize: '14px' }}><FileCheck2 size={17} color="#38bdf8" /> 데이터 계보</h3>
          {lineageReady ? <p style={{ margin: '7px 0 0', color: '#64748b', fontSize: '11px', lineHeight: 1.7 }}>원본 레코드 #{Number(data.sourceRecordIndex).toLocaleString()} · 레코드 해시 {data.sourceRecordHash.slice(0, 16)}…<br />파일 SHA-256 {data.sourceSha256.slice(0, 20)}… · 원본 보존 완료</p> : <p style={{ color: '#fbbf24', fontSize: '11px' }}>계보 메타데이터 점검 필요</p>}
        </div>
        {lineageReady && data.sourceUrl && <a href={data.sourceUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', fontSize: '12px', fontWeight: 800, textDecoration: 'none' }}>보존 원본 보기 <ExternalLink size={13} style={{ verticalAlign: 'middle' }} /></a>}
      </section>
    </div>
  );
}
