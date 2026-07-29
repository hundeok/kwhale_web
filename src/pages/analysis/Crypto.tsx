import React, { useState, useEffect } from 'react';
import { Search, ChevronDown, ChevronUp, Users, Crown, Loader2, User, Target, Gem, Briefcase, Zap, PieChart as PieIcon, Activity, Layers, Scale, Crosshair, BarChart3, Fingerprint, Coins, Wallet } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AlphaInsightDeck from '../../components/AlphaInsightDeck';

const formatCurrency = (amount: number | null | undefined) => {
  if (amount === null || amount === undefined) return '금액 미배분';
  if (!amount) return '0원';
  if (amount >= 1000000000000) return `${(amount / 1000000000000).toFixed(2)}조`;
  if (amount >= 100000000) return `${(amount / 100000000).toFixed(1)}억`;
  if (amount >= 10000) return `${(amount / 10000).toLocaleString()}만`;
  return amount.toLocaleString();
};

export default function Crypto() {
  const [cryptos, setCryptos] = useState<any[]>([]);
  const [quality, setQuality] = useState<any>(null);
  const [alpha, setAlpha] = useState<any>(null);
  const [people, setPeople] = useState<any[]>([]);
  const [peopleSummary, setPeopleSummary] = useState<any>(null);
  const [peopleQuality, setPeopleQuality] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<'valuation' | 'count' | 'avg'>('valuation');
  const [sortDesc, setSortDesc] = useState(true);
  
  const [visibleCount, setVisibleCount] = useState(50);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [holdersMap, setHoldersMap] = useState<Record<string, any[]>>({});
  const [loadingHolders, setLoadingHolders] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const year = searchParams.get('year') || 'recent';

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/stats/crypto?year=${year}`).then(r => r.json()),
      fetch(`/api/stats/crypto/people?year=${year}&limit=100`).then(r => r.json()),
    ]).then(([instruments, peopleResult]) => {
      setCryptos(instruments.data || []);
      setQuality(instruments.quality || null);
      setAlpha(instruments.alpha || null);
      setPeople(peopleResult.data || []);
      setPeopleSummary(peopleResult.summary || null);
      setPeopleQuality(peopleResult.quality || null);
      setLoading(false);
    });
  }, [year]);

  const fetchHolders = async (coinName: string) => {
    if (holdersMap[coinName]) return;
    setLoadingHolders(prev => ({ ...prev, [coinName]: true }));
    try {
      const res = await fetch(`/api/stats/crypto/${encodeURIComponent(coinName)}?year=${year}`);
      const json = await res.json();
      setHoldersMap(prev => ({ ...prev, [coinName]: json.data || [] }));
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingHolders(prev => ({ ...prev, [coinName]: false }));
    }
  };

  const toggleRow = (coinName: string) => {
    if (expandedRow === coinName) {
      setExpandedRow(null);
    } else {
      setExpandedRow(coinName);
      fetchHolders(coinName);
    }
  };

  // --- 16 스마트 퀀트 메트릭 추출 (가상자산 특화) ---
  const validCryptos = cryptos.filter(s => s.valuation > 0);
  const totalMarketCap = validCryptos.reduce((sum, s) => sum + s.valuation, 0);
  const totalHolders = validCryptos.reduce((sum, s) => sum + (s.valuedHolderCount || 0), 0);
  const uniqueAssetsCount = validCryptos.length;
  const officialTotal = Number(quality?.sourceValuation || 0);
  const unallocatedTotal = Number(quality?.unallocatedValuation || Math.max(0, officialTotal - totalMarketCap));
  const directCoverage = officialTotal > 0 ? totalMarketCap / officialTotal : 0;
  
  const topValuationCrypto = validCryptos.length > 0 ? validCryptos[0] : null;
  const mostHoldersCrypto = validCryptos.length > 0 ? [...validCryptos].sort((a, b) => b.count - a.count)[0] : null;
  
  const superRichPick = [...validCryptos].filter(s => s.valuedHolderCount >= 2)
    .sort((a, b) => (b.valuation / b.valuedHolderCount) - (a.valuation / a.valuedHolderCount))[0];
  const biggestBagCrypto = [...validCryptos].sort((a, b) => (b.topHolderVal || 0) - (a.topHolderVal || 0))[0];
  const hiddenGemCrypto = [...validCryptos].filter(s => s.count === 1).sort((a, b) => b.valuation - a.valuation)[0];
  const antsPickCrypto = [...validCryptos].filter(s => s.valuedHolderCount >= 5)
    .sort((a, b) => (a.valuation / a.valuedHolderCount) - (b.valuation / b.valuedHolderCount))[0];
  
  const monopolyWeight = topValuationCrypto && totalMarketCap > 0 ? ((topValuationCrypto.valuation / totalMarketCap) * 100).toFixed(1) : '0.0';
  
  const top10Valuation = validCryptos.slice(0, 10).reduce((sum, s) => sum + s.valuation, 0);
  const blueChipDominance = totalMarketCap > 0 ? ((top10Valuation / totalMarketCap) * 100).toFixed(1) : '0.0';
  
  const whaleMonopoly = [...validCryptos].filter(s => s.valuedHolderCount >= 3)
    .sort((a, b) => (b.topHolderVal / b.valuation) - (a.topHolderVal / a.valuation))[0];
  const truePublicCrypto = [...validCryptos].filter(s => s.valuedHolderCount >= 10)
    .sort((a, b) => (a.topHolderVal / a.valuation) - (b.topHolderVal / b.valuation))[0];

  let filteredCryptos = cryptos.map(s => ({
    ...s,
    avg: s.valuedHolderCount > 0 ? s.valuation / s.valuedHolderCount : null,
    weight: totalMarketCap > 0 ? (s.valuation / totalMarketCap) * 100 : 0
  })).filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

  filteredCryptos.sort((a, b) => {
    const vA = a[sortField];
    const vB = b[sortField];
    return sortDesc ? vB - vA : vA - vB;
  });

  const handleSort = (field: 'valuation' | 'count' | 'avg') => {
    if (sortField === field) setSortDesc(!sortDesc);
    else {
      setSortField(field);
      setSortDesc(true);
    }
    setVisibleCount(50);
  };

  const selectInsightInstrument = (name: string) => {
    setSearch(name);
    setVisibleCount(50);
    requestAnimationFrame(() => document.getElementById('crypto-instrument-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <span style={{ opacity: 0.2 }}>▼</span>;
    return sortDesc ? <ChevronDown size={14} /> : <ChevronUp size={14} />;
  };

  const Card = ({ title, icon, value, subtext, color, tooltip }: any) => (
    <div title={tooltip} style={{ 
      background: `linear-gradient(180deg, ${color}15 0%, transparent 50%), rgba(255,255,255,0.02)`, 
      padding: '16px', 
      borderRadius: '12px', 
      border: '1px solid rgba(255,255,255,0.05)',
      borderTop: `1px solid ${color}80`, 
      boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
      cursor: tooltip ? 'help' : 'default',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>{title}</div>
        <div style={{ background: `${color}15`, color: color, padding: '4px', borderRadius: '6px' }}>
          {icon}
        </div>
      </div>
      <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#fff' }}>{value}</div>
      <div style={{ fontSize: '12px', color, marginTop: '4px', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtext}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="glass-card" style={{ padding: '32px' }}>
        
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '32px' }}>
          <div>
            <h2 style={{ fontSize: '28px', fontWeight: 800, margin: 0 }}>가상자산 인텔리전스 뷰</h2>
            <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)' }}>신고서에서 분리한 가상자산별 보유 현황과 집중도 지표입니다.</p>
          </div>
        </div>
        <div style={{ marginBottom: '24px', padding: '14px 16px', borderRadius: '10px', background: 'rgba(239,68,68,0.08)', color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.6 }}>
          코인별 평가액은 단일 자산으로 금액을 배분할 수 있는 신고만 합산합니다. 복수 코인이 묶인 내역은 임의로 금액을 나누지 않으며 상세에서는 0원이 아닌 ‘금액 미배분’으로 표시합니다.
          <div style={{ marginTop: '6px', color: '#94a3b8' }}>
            품질등급 A: 명칭 신뢰·전액 직접귀속 · B: 일부 직접귀속 · C: 명칭 식별·금액 미배분 · D: 명칭 검토 필요
          </div>
          {quality && (
            <div style={{ marginTop: '8px', fontFamily: 'monospace', color: '#cbd5e1' }}>
              parser {quality.parserVersion} · 원본 {quality.sourceAssets.toLocaleString()}건 · 활성 코인관계 {quality.activeComponents.toLocaleString()}건 ·
              0수량 제외 {quality.excludedZeroQuantity.toLocaleString()}건 · 신고가액 직접귀속률 {(quality.valuationCoverage * 100).toFixed(1)}%
              · 회계대사 {quality.reconciliationPass && quality.overAllocatedRows === 0 ? 'PASS' : 'FAIL'}
            </div>
          )}
        </div>

        {loading ? <div style={{ padding: '40px', textAlign: 'center' }}>크립토 데이터 정밀 쿼리 중...</div> : (
          <>
            <div style={{ marginBottom: '32px', border: '1px solid rgba(52,211,153,0.2)', borderRadius: '12px', overflow: 'hidden', background: 'rgba(16,185,129,0.04)' }}>
              <div style={{ padding: '18px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px' }}>공직자별 가상자산 정확 신고총액</h3>
                  <div style={{ marginTop: '5px', color: 'var(--text-muted)', fontSize: '12px' }}>코인명별 임의 배분 없이 공식 가상자산 행 평가액만 인물별 합산</div>
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'monospace', color: '#34d399' }}>
                  <strong>{peopleSummary?.persons?.toLocaleString() || 0}명</strong>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{peopleSummary?.assets?.toLocaleString() || 0}건 · {formatCurrency(peopleSummary?.valuation)}</div>
                  <div style={{ fontSize: '11px', color: peopleQuality?.reconciliationPass ? '#34d399' : '#fb7185' }}>
                    인물·행·총액 교차대사 {peopleQuality?.reconciliationPass ? 'PASS' : 'FAIL'}
                  </div>
                  {peopleQuality?.referenceCheck && (
                    <div style={{ fontSize: '10px', color: peopleQuality.referenceCheck.pass ? '#64748b' : '#fb7185' }}>
                      기준사례 김홍수 {peopleQuality.referenceCheck.pass ? 'PASS' : 'FAIL'}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                {people.slice(0, 10).map((person, index) => (
                  <div key={person.id} onClick={() => navigate(`/officials/${person.id}?year=${year}`)} className="table-row-hover"
                    style={{ padding: '14px 18px', display: 'flex', gap: '12px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <div style={{ color: index < 3 ? '#fbbf24' : '#64748b', fontFamily: 'monospace', fontWeight: 800, width: '20px' }}>{index + 1}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>{person.name} <span style={{ color: '#64748b', fontSize: '11px' }}>· {person.disclosureYear}</span></div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{person.agency} · {person.title}</div>
                    </div>
                    <div style={{ color: '#34d399', fontFamily: 'monospace', fontWeight: 800, whiteSpace: 'nowrap' }}>{formatCurrency(person.valuation)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 👑 16-CARD EDGE DASHBOARD */}
            <div className="analysis-metric-grid">
              
              <Card title="공식 가상자산 신고총액" icon={<Briefcase size={14}/>} value={formatCurrency(officialTotal)} subtext={`${quality?.sourceAssets?.toLocaleString() || 0}개 원본 신고 행`} color="#94a3b8"
                tooltip="공식 신고서의 가상자산 행 평가액 전체 합계입니다. 코인별로 금액을 나눌 수 없는 복수 코인 신고도 포함합니다." />
              <Card title="코인별 직접 귀속액" icon={<Coins size={14}/>} value={formatCurrency(totalMarketCap)} subtext="원문 근거 단일 코인 합계 · 전체가치 아님" color="#38bdf8"
                tooltip="전체 코인 가치가 아닙니다. 원문에서 특정 코인 하나에 평가액을 직접 귀속할 수 있는 신고만 합산한 확정 금액입니다." />
              <Card title="코인별 미배분 잔액" icon={<Layers size={14}/>} value={formatCurrency(unallocatedTotal)} subtext="복수 코인 등 개별 귀속 불가" color="#f59e0b"
                tooltip="공식 총액에는 포함되지만 복수 코인 묶음 등으로 개별 코인에 안전하게 나눌 수 없는 금액입니다. 임의 추정하지 않습니다." />
              <Card title="금액 직접 귀속률" icon={<Crosshair size={14}/>} value={`${(directCoverage * 100).toFixed(1)}%`} subtext="직접 귀속액 / 공식 신고총액" color="#10b981"
                tooltip="공식 가상자산 신고총액 중 개별 코인에 금액을 직접 연결할 수 있는 비율입니다. 코인 식별률이나 전체 데이터 정확도를 뜻하지 않습니다." />

              <Card title="배분 신고가액 1위" icon={<Crown size={14}/>} value={topValuationCrypto?.name || '-'} subtext={`${formatCurrency(topValuationCrypto?.valuation || 0)} 합계`} color="#ef4444" />
              <Card title="신고 보유자 최다" icon={<Users size={14}/>} value={mostHoldersCrypto?.name || '-'} subtext={`${Number(mostHoldersCrypto?.count || 0).toLocaleString('ko-KR')}명 보유`} color="#10b981" />
              <Card title="금액 확인 보유자 평균 1위" icon={<Zap size={14}/>} value={superRichPick?.name || '-'} subtext={`평균 ${formatCurrency(superRichPick ? superRichPick.valuation / superRichPick.valuedHolderCount : 0)}`} color="#8b5cf6" />
              <Card title="개별 배분가액 1위" icon={<Target size={14}/>} value={biggestBagCrypto?.name || '-'} subtext={`${formatCurrency(biggestBagCrypto?.topHolderVal || 0)} (${biggestBagCrypto?.topHolder})`} color="#f59e0b" />

              <Card title="단독 신고 최고가액" icon={<Gem size={14}/>} value={hiddenGemCrypto?.name || '-'} subtext={`${formatCurrency(hiddenGemCrypto?.valuation || 0)} · 보유자 1명`} color="#0ea5e9" />
              <Card title="금액 확인 5명+ 최저 평균" icon={<Activity size={14}/>} value={antsPickCrypto?.name || '-'} subtext={`평균 ${formatCurrency(antsPickCrypto ? antsPickCrypto.valuation / antsPickCrypto.valuedHolderCount : 0)}`} color="#14b8a6" />
              <Card title="직접귀속액 집중도 1위" icon={<Scale size={14}/>} value={whaleMonopoly?.name || '-'} subtext={`최대 보유자 ${(whaleMonopoly ? (whaleMonopoly.topHolderVal / whaleMonopoly.valuation) * 100 : 0).toFixed(1)}% · 확인 3명+`} color="#f43f5e" />
              <Card title="직접귀속액 분산도 1위" icon={<Fingerprint size={14}/>} value={truePublicCrypto?.name || '-'} subtext={`최대 보유자 ${(truePublicCrypto ? (truePublicCrypto.topHolderVal / truePublicCrypto.valuation) * 100 : 0).toFixed(1)}% · 확인 10명+`} color="#8b5cf6" />

              <Card title="1위 코인 쏠림도" icon={<PieIcon size={14}/>} value={`${monopolyWeight}%`} subtext={`대장주 단일 지배력`} color="#f97316" />
              <Card title="상위 10코인 집중도" icon={<BarChart3 size={14}/>} value={`${blueChipDominance}%`} subtext="직접 귀속액 기준" color="#3b82f6" />
              <Card title="금액 직접확인 코인" icon={<Search size={14}/>} value={`${uniqueAssetsCount.toLocaleString()}종`} subtext="직접 귀속액이 1원 이상인 코인" color="#a8a29e" />
              <Card title="금액 확인 보유관계" icon={<Wallet size={14}/>} value={`${totalHolders.toLocaleString()}건`} subtext="코인별 금액을 확인한 관계" color="#64748b" />
              
            </div>

            <AlphaInsightDeck instruments={cryptos} alpha={alpha} noun="코인" accent="#ef4444" onSelect={selectInsightInstrument} />

            {/* 검색 및 테이블 툴바 (Split Layout) */}
            <div id="crypto-instrument-table" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', background: 'rgba(0,0,0,0.2)', padding: '12px 20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: '14px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Target size={16} color="#ef4444" />
                <span>총 <strong style={{ color: '#fff', fontFamily: 'monospace', fontSize: '16px' }}>{filteredCryptos.length.toLocaleString('ko-KR')}</strong>개의 가상자산 필터링 됨</span>
              </div>
              
              <div style={{ position: 'relative', width: '300px' }}>
                <Search size={16} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input 
                  type="text" 
                  placeholder="코인 검색 (예: 비트코인, 리플)" 
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setVisibleCount(50); }}
                  style={{
                    boxSizing: 'border-box',
                    width: '100%',
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    padding: '10px 16px 10px 42px',
                    color: '#fff',
                    outline: 'none',
                    fontSize: '14px',
                    transition: 'border 0.2s',
                  }}
                  onFocus={(e) => e.target.style.border = '1px solid #ef4444'}
                  onBlur={(e) => e.target.style.border = '1px solid rgba(255,255,255,0.1)'}
                />
              </div>
            </div>

            {/* 고밀도 데이터 테이블 */}
            <div style={{ border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', overflow: 'hidden', background: 'rgba(0,0,0,0.2)' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
                  <thead style={{ background: '#111827', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <tr>
                      <th style={{ padding: '16px', color: 'var(--text-muted)', fontWeight: 500, width: '60px' }}>Rank</th>
                      <th style={{ padding: '16px', color: 'var(--text-muted)', fontWeight: 500 }}>가상자산명</th>
                      <th onClick={() => handleSort('valuation')} style={{ padding: '16px', color: 'var(--text-muted)', fontWeight: 500, cursor: 'pointer', textAlign: 'right' }}>
                        <div title="전체 코인 가치가 아닌, 원문에서 해당 코인에 직접 귀속 가능한 확정 신고가액입니다." style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>배분 신고가액 <SortIcon field="valuation" /></div>
                      </th>
                      <th onClick={() => handleSort('count')} style={{ padding: '16px', color: 'var(--text-muted)', fontWeight: 500, cursor: 'pointer', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>보유자 <SortIcon field="count" /></div>
                      </th>
                      <th onClick={() => handleSort('avg')} style={{ padding: '16px', color: 'var(--text-muted)', fontWeight: 500, cursor: 'pointer', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>금액 확인 보유자 평균 <SortIcon field="avg" /></div>
                      </th>
                      <th style={{ padding: '16px', color: 'var(--text-muted)', fontWeight: 500, textAlign: 'right' }}>금액 확인 / 미배분</th>
                      <th style={{ padding: '16px', color: 'var(--text-muted)', fontWeight: 500, textAlign: 'center' }}>품질</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCryptos.slice(0, visibleCount).map((crypto: any, idx: number) => (
                      <React.Fragment key={idx}>
                        <tr 
                          onClick={() => toggleRow(crypto.name)}
                          className="table-row-hover" 
                          style={{ 
                            borderBottom: '1px solid rgba(255,255,255,0.03)', 
                            cursor: 'pointer',
                            background: expandedRow === crypto.name ? 'rgba(239, 68, 68, 0.05)' : 'transparent'
                          }}
                        >
                          <td style={{ padding: '16px', color: 'var(--text-muted)' }}>{idx + 1}</td>
                          <td style={{ padding: '16px', fontWeight: 600, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {crypto.name} 
                            {expandedRow === crypto.name ? <ChevronUp size={16} color="#ef4444" /> : <ChevronDown size={16} color="var(--text-muted)" />}
                          </td>
                          <td style={{ padding: '16px', textAlign: 'right', fontFamily: 'monospace', color: '#ef4444', fontWeight: 600, fontSize: '15px' }}>
                            {crypto.allocatedPositions > 0 ? formatCurrency(crypto.valuation) : '금액 미배분'}
                          </td>
                          <td style={{ padding: '16px', textAlign: 'right', color: '#94a3b8' }}>
                            {crypto.count.toLocaleString()}명
                            {crypto.valuedHolderCount < crypto.count && (
                              <div style={{ fontSize: '10px', color: '#64748b' }}>금액 확인 {crypto.valuedHolderCount.toLocaleString()}명</div>
                            )}
                          </td>
                          <td style={{ padding: '16px', textAlign: 'right', fontFamily: 'monospace', color: '#38bdf8' }}>
                            {formatCurrency(crypto.avg)}
                          </td>
                          <td style={{ padding: '16px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {crypto.valuedHolderCount.toLocaleString()} / {crypto.unallocatedHolderCount.toLocaleString()}명
                            <div style={{ fontSize: '10px', color: '#64748b' }}>확인률 {(crypto.holderCoverage * 100).toFixed(1)}%</div>
                          </td>
                          <td style={{ padding: '16px', textAlign: 'center' }}>
                            <span title={`명칭 신뢰 ${(crypto.confidenceScore * 100).toFixed(1)}% · 직접귀속 관계 ${(crypto.valuationCoverage * 100).toFixed(1)}%`}
                              style={{ display: 'inline-flex', minWidth: '28px', justifyContent: 'center', padding: '4px 7px', borderRadius: '6px', fontWeight: 800, color: crypto.dataGrade === 'A' ? '#34d399' : crypto.dataGrade === 'B' ? '#38bdf8' : crypto.dataGrade === 'C' ? '#fbbf24' : '#fb7185', background: 'rgba(255,255,255,.05)' }}>
                              {crypto.dataGrade}
                            </span>
                          </td>
                        </tr>
                        
                        {expandedRow === crypto.name && (
                          <tr style={{ background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                            <td colSpan={7} style={{ padding: '24px' }}>
                              <h4 style={{ margin: '0 0 16px 0', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Users size={18} /> [{crypto.name}] 심층 보유자 명단
                              </h4>
                              {loadingHolders[crypto.name] ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
                                  <Loader2 size={16} className="spinner" /> 공직자 지갑 추적 중...
                                </div>
                              ) : holdersMap[crypto.name] ? (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                                  {holdersMap[crypto.name].map((h, i) => (
                                    <div 
                                      key={i} 
                                      onClick={(e) => { e.stopPropagation(); navigate(`/officials/${h.id}?year=${year}`); }}
                                      style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.05)' }}
                                      className="table-row-hover"
                                    >
                                      <div style={{ background: 'rgba(239, 68, 68, 0.2)', padding: '8px', borderRadius: '6px' }}>
                                        <User size={16} color="#ef4444" />
                                      </div>
                                      <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{h.name}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{h.agency} • {h.title}</div>
                                      </div>
                                      <div style={{ fontWeight: 'bold', fontFamily: 'monospace', color: '#ef4444' }}>
                                        {formatCurrency(h.valuation)}
                                        {h.hasUnallocated && (
                                          <div style={{ color: '#94a3b8', fontSize: '10px', textAlign: 'right' }}>복수코인 금액 미배분 포함</div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div style={{ color: 'var(--text-muted)' }}>데이터를 찾을 수 없습니다.</div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {visibleCount < filteredCryptos.length && (
                <div 
                  onClick={() => setVisibleCount(v => v + 50)}
                  style={{ padding: '16px', textAlign: 'center', color: '#38bdf8', cursor: 'pointer', fontWeight: 600, background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.05)' }}
                  className="table-row-hover"
                >
                  더 보기 ({Math.max(0, filteredCryptos.length - visibleCount).toLocaleString('ko-KR')}개 남음)
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
