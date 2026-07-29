import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, Banknote, Bitcoin, Building2, CheckCircle2, CircleDollarSign,
  Crown, Database, Landmark, MapPin, PieChart, ShieldCheck, TrendingUp,
  Users, Wallet, Zap,
} from 'lucide-react';

const dashboardCache = new Map<string, any>();
const alphaCache = new Map<string, any>();

const formatCurrency = (amount: number | null | undefined): string => {
  const value = Number(amount || 0);
  if (Math.abs(value) >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}조 원`;
  }
  if (Math.abs(value) >= 100_000_000) {
    return `${(value / 100_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억 원`;
  }
  return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만 원`;
};

const categoryColors: Record<string, string> = {
  건물: '#3b82f6',
  토지: '#60a5fa',
  예금: '#8b5cf6',
  '예금·보험': '#8b5cf6',
  증권: '#f59e0b',
  채권: '#06b6d4',
  가상자산: '#ef4444',
};

const categoryColor = (name: string) =>
  Object.entries(categoryColors).find(([key]) => name.includes(key))?.[1] || '#64748b';

function MetricCard({ title, value, detail, icon, color, tooltip }: any) {
  return (
    <div title={tooltip} style={{
      padding: '16px', borderRadius: '12px', minWidth: 0,
      background: `linear-gradient(180deg, ${color}15 0%, transparent 50%), rgba(255,255,255,.02)`,
      border: '1px solid rgba(255,255,255,.05)', borderTop: `1px solid ${color}80`,
      boxShadow: '0 4px 20px rgba(0,0,0,.1)', cursor: tooltip ? 'help' : 'default',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '8px' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 800 }}>{title}</span>
        <span style={{ display: 'grid', placeItems: 'center', padding: '4px', borderRadius: '6px', color, background: `${color}15` }}>{icon}</span>
      </div>
      <div style={{ color: '#fff', fontSize: 'clamp(20px, 2vw, 26px)', fontWeight: 900, letterSpacing: '-.6px' }}>{value}</div>
      <div style={{ marginTop: '4px', color, fontSize: '12px', lineHeight: 1.5, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</div>
    </div>
  );
}

function PersonRows({ rows, year, color, navigate, valueKey = 'valuation', limit = 3, compactSecondary = false }: any) {
  if (!rows?.length) return <div style={{ padding: '18px 0', color: '#64748b', fontSize: '13px' }}>해당 기준의 공개 데이터가 없습니다.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {rows.slice(0, limit).map((person: any, index: number) => (
        <button key={`${person.id}-${index}`} type="button" onClick={() => navigate(`/officials/${person.id}?year=${year}`)}
          style={{
            display: 'grid', gridTemplateColumns: '24px minmax(0,1fr) auto', gap: '9px',
            alignItems: 'center', padding: '10px', borderRadius: '9px', cursor: 'pointer',
            border: '1px solid rgba(255,255,255,.04)', background: 'rgba(255,255,255,.025)',
            color: '#e2e8f0', textAlign: 'left',
          }}>
          <span style={{ color, fontFamily: 'monospace', fontWeight: 900 }}>{index + 1}</span>
          <span style={{ minWidth: 0 }}>
            <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '14px', lineHeight: 1.45 }}>{person.name}</strong>
            <small style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#94a3b8', marginTop: compactSecondary ? '2px' : '3px', fontSize: compactSecondary ? '11px' : '12px', lineHeight: 1.45 }}>{person.agency}</small>
          </span>
          {person[valueKey] !== undefined && (
            <strong style={{ color, fontFamily: 'monospace', fontSize: '13px', lineHeight: 1.4, whiteSpace: 'nowrap' }}>{formatCurrency(person[valueKey])}</strong>
          )}
        </button>
      ))}
    </div>
  );
}

function LoadingDashboard() {
  return (
    <div aria-label="대시보드 데이터 로딩 중" style={{ display: 'grid', gap: '20px' }}>
      <div style={{ color: '#94a3b8', fontSize: '13px' }}>핵심 신고 지표를 불러오는 중입니다…</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: '14px' }}>
        {[1, 2, 3, 4].map(item => <div key={item} className="glass-card" style={{ height: '126px', opacity: .45 }} />)}
      </div>
      <div className="glass-card" style={{ height: '280px', opacity: .35 }} />
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const year = searchParams.get('year') || 'recent';
  const [data, setData] = useState<any>(() => dashboardCache.get(year) || null);
  const [alpha, setAlpha] = useState<any>(() => alphaCache.get(year) || null);
  const [loading, setLoading] = useState(!dashboardCache.has(year));
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const cached = dashboardCache.get(year);
    setError('');
    if (cached) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
      fetch(`/api/dashboard?year=${year}`, { signal: controller.signal })
        .then(response => {
          if (!response.ok) throw new Error(`dashboard ${response.status}`);
          return response.json();
        })
        .then(result => {
          if (!result.success) throw new Error(result.error || 'dashboard response');
          dashboardCache.set(year, result.data);
          setData(result.data);
          setLoading(false);
        })
        .catch(fetchError => {
          if (fetchError.name !== 'AbortError') {
            setError('핵심 대시보드 데이터를 불러오지 못했습니다.');
            setLoading(false);
          }
        });
    }

    const loadAlpha = () => {
      const alphaCached = alphaCache.get(year);
      if (alphaCached) return setAlpha(alphaCached);
      setAlpha(null);
      fetch(`/api/alpha-engine?year=${year}`, { signal: controller.signal })
        .then(response => response.ok ? response.json() : null)
        .then(result => {
          if (result?.success) {
            alphaCache.set(year, result.data);
            setAlpha(result.data);
          }
        })
        .catch(() => undefined);
    };
    const idleId = window.setTimeout(loadAlpha, 120);
    return () => {
      controller.abort();
      window.clearTimeout(idleId);
    };
  }, [year]);

  const categories = useMemo(() => {
    const rows = (data?.categorySums || []).map((row: any) => ({
      name: row.category,
      value: Number(row._sum.valuation || 0),
    }));
    const total = rows.reduce((sum: number, row: any) => sum + row.value, 0);
    return { rows, total };
  }, [data]);

  if (loading && !data) return <LoadingDashboard />;
  if (error && !data) {
    return <div className="glass-card" style={{ padding: '28px' }}><h2>대시보드를 불러오지 못했습니다</h2><p style={{ color: '#94a3b8' }}>{error}</p></div>;
  }

  const persons = Number(data?.totalPersons || 0);
  const grossAssets = Number(data?.totalAssetsValuation || 0);
  const liabilities = Number(data?.totalLiabilities || 0);
  const netWorth = Number(data?.totalNetWorth || 0);
  const averageNetWorth = persons ? netWorth / persons : 0;
  const netAssetRatio = grossAssets ? netWorth / grossAssets : 0;
  const liabilityRatio = grossAssets ? liabilities / grossAssets : 0;
  const quality = data?.quality;

  const leaderCards = [
    { title: '채무 신고액 상위', icon: <Banknote size={19} />, rows: data?.edgyStats?.topDebtors, color: '#fb7185' },
    { title: '가상자산 신고액 상위', icon: <Bitcoin size={19} />, rows: data?.edgyStats?.topCryptoWhales, color: '#f59e0b' },
    { title: '예금 신고액 상위', icon: <Wallet size={19} />, rows: data?.edgyStats?.topCashKings, color: '#34d399' },
    { title: '건물 신고액 상위', icon: <Building2 size={19} />, rows: data?.edgyStats?.topBuildingKings, color: '#60a5fa' },
  ];

  const alphaCards = alpha ? [
    { title: '상위 1% 선호 주식', color: '#f59e0b', icon: <TrendingUp size={18} />, rows: alpha.alphaStocks, concentration: true },
    { title: '상위 1% 부동산 집중지역', color: '#3b82f6', icon: <MapPin size={18} />, rows: alpha.alphaRegions, concentration: true },
    { title: '미국주식 보유 상위자산가', color: '#ef4444', icon: <Activity size={18} />, rows: alpha.usStockBulls },
    { title: '외화자산 신고액 상위', color: '#818cf8', icon: <CircleDollarSign size={18} />, rows: alpha.fxWhales },
    { title: '채권 신고액 상위', color: '#06b6d4', icon: <Landmark size={18} />, rows: alpha.bondWhales },
    { title: '비상장주식 신고액 상위', color: '#f97316', icon: <TrendingUp size={18} />, rows: alpha.angelInvestors },
    { title: '고가 차량 신고액 상위', color: '#d946ef', icon: <Activity size={18} />, rows: alpha.supercars },
    { title: '회원권 신고액 상위', color: '#10b981', icon: <Crown size={18} />, rows: alpha.vipMembers },
    { title: '금·보석·예술품 신고액 상위', color: '#eab308', icon: <ShieldCheck size={18} />, rows: alpha.preciousCollectors },
    { title: '상장주식 신고액 상위', color: '#fbbf24', icon: <TrendingUp size={18} />, rows: alpha.listedStockWhales },
    { title: '전체 증권 신고액 상위', color: '#fb923c', icon: <Activity size={18} />, rows: alpha.totalSecuritiesWhales },
    { title: '부동산 신고액 상위', color: '#60a5fa', icon: <Building2 size={18} />, rows: alpha.realEstateWhales },
    { title: '토지 신고액 상위', color: '#22d3ee', icon: <MapPin size={18} />, rows: alpha.landWhales },
    { title: '가상자산 신고액 상위', color: '#f87171', icon: <Bitcoin size={18} />, rows: alpha.cryptoDisclosureWhales },
    { title: '현금 신고액 상위', color: '#4ade80', icon: <Banknote size={18} />, rows: alpha.cashWhales },
    { title: '회사 출자지분 신고액 상위', color: '#c084fc', icon: <Landmark size={18} />, rows: alpha.equityStakeWhales },
  ] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <section style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '26px' }}>공직자 재산 스냅샷</h2>
          <p style={{ margin: '7px 0 0', color: '#94a3b8', fontSize: '13px' }}>{quality?.snapshotPolicy}</p>
        </div>
        <div title="총자산 - 채무 = 순자산 회계식과 원본 자산군 합계를 점검합니다." style={{
          display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', borderRadius: '10px',
          color: quality?.accountingPass ? '#34d399' : '#fb7185',
          border: `1px solid ${quality?.accountingPass ? 'rgba(52,211,153,.25)' : 'rgba(251,113,133,.25)'}`,
          background: quality?.accountingPass ? 'rgba(52,211,153,.07)' : 'rgba(251,113,133,.07)',
          fontSize: '12px', fontWeight: 800,
        }}>
          <CheckCircle2 size={16} /> 회계대사 {quality?.accountingPass ? 'PASS' : 'CHECK'}
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '14px' }}>
        <MetricCard title="공식 신고 총자산" value={formatCurrency(grossAssets)}
          detail={`${persons.toLocaleString()}명 · 원본 자산 ${Number(data?.totalAssetRows || 0).toLocaleString()}행`}
          icon={<Database size={19} />} color="#38bdf8"
          tooltip="채무를 제외한 공식 신고 평가액 합계입니다. 시장가격이나 운용자산(AUM)이 아닙니다." />
        <MetricCard title="공식 신고 순자산" value={formatCurrency(netWorth)}
          detail={`총자산 - 채무 ${formatCurrency(liabilities)}`}
          icon={<ShieldCheck size={19} />} color="#34d399"
          tooltip="모든 인물의 총자산에서 공식 신고 채무를 차감한 순자산 합계입니다." />
        <MetricCard title="1인당 평균 순자산" value={formatCurrency(averageNetWorth)}
          detail="순자산 합계 / 현재 스냅샷 인원"
          icon={<Users size={19} />} color="#f59e0b"
          tooltip="극단값의 영향을 받는 단순 평균입니다. 중앙값이 아님을 유의하세요." />
        <MetricCard title="순자산 비율" value={`${(netAssetRatio * 100).toFixed(1)}%`}
          detail={`채무 비율 ${(liabilityRatio * 100).toFixed(1)}% · ${formatCurrency(liabilities)}`}
          icon={<Landmark size={19} />} color="#a78bfa"
          tooltip="공식 신고 총자산 중 채무를 차감하고 남은 순자산의 비율입니다. 순자산 ÷ 총자산으로 계산합니다." />
      </section>

      <section className="dashboard-overview-grid">
        <div className="glass-card" style={{ padding: '24px', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginBottom: '20px' }}>
            <div>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '17px' }}><PieChart size={20} /> 총자산 구성</h3>
              <p style={{ margin: '5px 0 0', color: '#64748b', fontSize: '11px' }}>채무 제외 · 공식 신고 평가액 기준</p>
            </div>
            <strong style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: '12px' }}>원본 포괄률 {(Number(quality?.categoryCoverage || 0) * 100).toFixed(2)}%</strong>
          </div>
          <div style={{ display: 'flex', height: '18px', overflow: 'hidden', borderRadius: '999px', background: 'rgba(255,255,255,.04)' }}>
            {categories.rows.map((row: any) => {
              const share = categories.total ? row.value / categories.total : 0;
              return share < .001 ? null : <div key={row.name} title={`${row.name} ${(share * 100).toFixed(1)}% · ${formatCurrency(row.value)}`} style={{ width: `${share * 100}%`, background: categoryColor(row.name) }} />;
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: '12px', marginTop: '20px' }}>
            {categories.rows.slice(0, 8).map((row: any) => {
              const share = categories.total ? row.value / categories.total : 0;
              return (
                <div key={row.name} style={{ padding: '11px', borderRadius: '9px', background: 'rgba(255,255,255,.025)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: '#94a3b8', fontSize: '11px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: categoryColor(row.name) }} />{row.name}
                  </div>
                  <strong style={{ display: 'block', marginTop: '7px', fontSize: '17px' }}>{(share * 100).toFixed(1)}%</strong>
                  <small style={{ color: '#64748b' }}>{formatCurrency(row.value)}</small>
                </div>
              );
            })}
          </div>
        </div>

        <div className="glass-card" style={{ padding: '24px', minWidth: 0 }}>
          <h3 style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '17px' }}><Crown size={20} color="#fbbf24" /> 순자산 상위 5인</h3>
          <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: '11px' }}>총자산이 아닌 채무 차감 후 순자산 기준</p>
          <PersonRows rows={data?.topRankings} year={year} color="#fbbf24" navigate={navigate} valueKey="netWorth" limit={5} />
        </div>
      </section>

      <section>
        <div style={{ marginBottom: '13px' }}>
          <h3 style={{ margin: 0, fontSize: '18px' }}>자산군별 신고액 리더</h3>
          <p style={{ margin: '5px 0 0', color: '#64748b', fontSize: '11px' }}>공식 자산 행을 인물별 합산 · 추정 배분 없음</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(245px,1fr))', gap: '14px' }}>
          {leaderCards.map(card => (
            <div
              key={card.title}
              className="glass-card dashboard-glass-feature"
              style={{ padding: '18px', '--card-accent': card.color } as React.CSSProperties}
            >
              <h4 style={{ margin: '0 0 13px', display: 'flex', alignItems: 'center', gap: '7px', color: card.color, fontSize: '15px', lineHeight: 1.4 }}>{card.icon}{card.title}</h4>
              <PersonRows rows={card.rows} year={year} color={card.color} navigate={navigate} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: '#fbbf24', fontSize: '19px' }}><Zap size={20} /> K-Whale 알파 엔진</h3>
            <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: '11px' }}>
              집중배수 = 상위 1% 보유율 ÷ 나머지 인원 보유율 · 가격상승률이나 투자수익률 예측이 아님
            </p>
          </div>
          {alpha && <span style={{ color: '#64748b', fontSize: '11px' }}>{alpha.methodology?.smartMoneyDefinition} · 16개 검증 신호 · 추정값 없음</span>}
        </div>
        {!alpha ? (
          <div className="glass-card" style={{ padding: '22px', color: '#94a3b8', fontSize: '13px' }}>핵심 지표를 먼저 표시했습니다. 심층 알파 신호를 이어서 계산 중입니다…</div>
        ) : (
          <div className="dashboard-alpha-grid">
            {alphaCards.map(card => (
              <div
                key={card.title}
                className="glass-card dashboard-glass-feature dashboard-alpha-card"
                style={{ padding: '18px', minWidth: 0, '--card-accent': card.color } as React.CSSProperties}
              >
                <h4 style={{ margin: '0 0 13px', display: 'flex', alignItems: 'center', gap: '7px', color: card.color, fontSize: '15px', lineHeight: 1.4 }}>{card.icon}{card.title}</h4>
                {card.concentration ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {card.rows?.slice(0, 3).map((row: any, index: number) => (
                      <div key={`${row.name}-${index}`} className="dashboard-alpha-row" style={{ display: 'grid', gridTemplateColumns: '22px minmax(0,1fr) auto', gap: '8px', alignItems: 'center', padding: '10px', borderRadius: '9px' }}>
                        <strong style={{ color: card.color }}>{index + 1}</strong>
                        <span style={{ minWidth: 0 }}>
                          <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '14px', lineHeight: 1.45 }}>{row.name}</strong>
                          <small style={{ color: '#94a3b8', fontSize: '11px', lineHeight: 1.45 }}>
                            상위 1% {Number(row.smartHolders).toLocaleString('ko-KR')}명 · 전체 {Number(row.holderCount).toLocaleString('ko-KR')}명
                            {row.holderCount < 10 ? ' · 소표본' : ''}
                          </small>
                        </span>
                        <strong
                          title={row.exclusiveToTopOnePercent
                            ? `상위 1% ${row.smartHolders}/${alpha.methodology.smartPopulation}명, 나머지 0/${alpha.methodology.publicPopulation}명 보유. 현재 표본에서 상위 1%에만 관측됐다는 뜻입니다.`
                            : `(상위 1% ${row.smartHolders}/${alpha.methodology.smartPopulation}명) ÷ (나머지 ${row.publicHolders}/${alpha.methodology.publicPopulation}명) = ${row.alphaScore}배`}
                          style={{ color: card.color, fontFamily: 'monospace', cursor: 'help', fontSize: '14px' }}
                        >
                          {row.exclusiveToTopOnePercent ? '독점*' : `${row.alphaScore}×`}
                        </strong>
                      </div>
                    ))}
                  </div>
                ) : <PersonRows rows={card.rows} year={year} color={card.color} navigate={navigate} compactSecondary />}
              </div>
            ))}
          </div>
        )}
      </section>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b', fontSize: '11px', paddingBottom: '8px' }}>
        <CheckCircle2 size={14} color="#34d399" /> {quality?.monetaryBasis} · 카드를 누르면 해당 공직자 원문 기반 상세로 이동합니다.
      </div>
    </div>
  );
}
