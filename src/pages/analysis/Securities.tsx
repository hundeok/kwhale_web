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

export default function Securities() {
  const [stocks, setStocks] = useState<any[]>([]);
  const [assetClass, setAssetClass] = useState<'listed' | 'unlisted' | 'bonds' | 'all'>('listed');
  const [quality, setQuality] = useState<any>(null);
  const [alpha, setAlpha] = useState<any>(null);
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
    setExpandedRow(null);
    setHoldersMap({});
    fetch(`/api/stats/stocks?year=${year}&class=${assetClass}`)
      .then(r => r.json())
      .then(json => {
        setStocks(json.data || []);
        setQuality(json.quality || null);
        setAlpha(json.alpha || null);
        setLoading(false);
      });
  }, [year, assetClass]);

  const fetchHolders = async (stockName: string) => {
    if (holdersMap[stockName]) return;
    setLoadingHolders(prev => ({ ...prev, [stockName]: true }));
    try {
      const res = await fetch(`/api/stats/stocks/${encodeURIComponent(stockName)}?year=${year}&class=${assetClass}`);
      const json = await res.json();
      setHoldersMap(prev => ({ ...prev, [stockName]: json.data || [] }));
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingHolders(prev => ({ ...prev, [stockName]: false }));
    }
  };

  const toggleRow = (stockName: string) => {
    if (expandedRow === stockName) {
      setExpandedRow(null);
    } else {
      setExpandedRow(stockName);
      fetchHolders(stockName);
    }
  };

  // --- 16 스마트 퀀트 메트릭 추출 (정확도 검증 포함) ---
  const validStocks = stocks.filter(s => s.valuation > 0);
  const totalMarketCap = validStocks.reduce((sum, s) => sum + s.valuation, 0);
  const totalHolders = validStocks.reduce((sum, s) => sum + (s.valuedHolderCount || 0), 0);
  const uniqueAssetsCount = validStocks.length;
  const officialTotal = Number(quality?.sourceValuation || 0);
  const unallocatedTotal = Number(quality?.unallocatedValuation || Math.max(0, officialTotal - totalMarketCap));
  const directCoverage = officialTotal > 0 ? totalMarketCap / officialTotal : 0;
  
  const topValuationStock = validStocks.length > 0 ? validStocks[0] : null;
  const mostHoldersStock = validStocks.length > 0 ? [...validStocks].sort((a, b) => b.count - a.count)[0] : null;
  
  // 1. 슈퍼 리치 픽 (최소 2명 이상, 1인당 평균액 최고)
  const superRichPick = [...validStocks].filter(s => s.valuedHolderCount >= 2)
    .sort((a, b) => (b.valuation / b.valuedHolderCount) - (a.valuation / a.valuedHolderCount))[0];
  
  // 2. 단일 최대 잭팟 (1인 최다 보유액)
  const biggestBagStock = [...validStocks].sort((a, b) => (b.topHolderVal || 0) - (a.topHolderVal || 0))[0];
  
  // 3. 나홀로 잭팟 (단독 보유자 중 최고액)
  const hiddenGemStock = [...validStocks].filter(s => s.count === 1).sort((a, b) => b.valuation - a.valuation)[0];
  
  // 4. 개미 군단 픽 (최소 5명 이상, 1인당 평균액 최저)
  const antsPickStock = [...validStocks].filter(s => s.valuedHolderCount >= 5)
    .sort((a, b) => (a.valuation / a.valuedHolderCount) - (b.valuation / b.valuedHolderCount))[0];
  
  // 5. 대장주 독점도
  const monopolyWeight = topValuationStock && totalMarketCap > 0 ? ((topValuationStock.valuation / totalMarketCap) * 100).toFixed(1) : '0.0';
  
  // 6. 상위 10개 블루칩 장악력
  const top10Valuation = validStocks.slice(0, 10).reduce((sum, s) => sum + s.valuation, 0);
  const blueChipDominance = totalMarketCap > 0 ? ((top10Valuation / totalMarketCap) * 100).toFixed(1) : '0.0';
  
  // 7. 고래 독식 종목 (최소 3명 이상, 최대주주 지분율 최고)
  const whaleMonopoly = [...validStocks].filter(s => s.valuedHolderCount >= 3)
    .sort((a, b) => (b.topHolderVal / b.valuation) - (a.topHolderVal / a.valuation))[0];
  
  // 8. 완벽한 분산 투자 (최소 10명 이상, 최대주주 지분율 최저)
  const truePublicStock = [...validStocks].filter(s => s.valuedHolderCount >= 10)
    .sort((a, b) => (a.topHolderVal / a.valuation) - (b.topHolderVal / b.valuation))[0];

  let filteredStocks = stocks.map(s => ({
    ...s,
    avg: s.valuedHolderCount > 0 ? s.valuation / s.valuedHolderCount : null,
    weight: totalMarketCap > 0 ? (s.valuation / totalMarketCap) * 100 : 0
  })).filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

  filteredStocks.sort((a, b) => {
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
    requestAnimationFrame(() => document.getElementById('securities-instrument-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
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
    <div className="securities-page" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="glass-card" style={{ padding: '32px' }}>
        
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '32px' }}>
          <div>
            <h2 style={{ fontSize: '28px', fontWeight: 800, margin: 0 }}>증권 인텔리전스 뷰</h2>
            <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)' }}>신고서에서 분리한 종목별 보유 현황과 집중도 지표입니다.</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {([
            ['listed', '상장주식'],
            ['unlisted', '비상장주식'],
            ['bonds', '전체 채권'],
            ['all', '주식 전체'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setAssetClass(value)}
              style={{
                border: `1px solid ${assetClass === value ? '#f59e0b' : 'rgba(255,255,255,.12)'}`,
                background: assetClass === value ? 'rgba(245,158,11,.16)' : 'rgba(255,255,255,.03)',
                color: assetClass === value ? '#fbbf24' : '#94a3b8',
                borderRadius: '999px',
                padding: '8px 14px',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ marginBottom: '24px', padding: '14px 16px', borderRadius: '10px', background: 'rgba(245,158,11,0.08)', color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.6 }}>
          <strong style={{ color: '#fbbf24' }}>분류 정책:</strong> 상장주식·비상장주식을 분리하고, 전체 채권 탭은 증권 내부 채권성 상품과 최상위 채권 자산군을 함께 보여줍니다. 전량 처분된 0수량 종목은 현재 보유자에서 제외합니다.
          종목별 금액은 단일 종목 신고만 합산하며 복수 종목 신고는 임의 배분하지 않습니다.
          <div style={{ marginTop: '6px', color: '#94a3b8' }}>
            품질등급 A: 명칭 신뢰·전액 직접귀속 · B: 일부 직접귀속 · C: 명칭 식별·금액 미배분 · D: 명칭 검토 필요
          </div>
          {quality && (
            <div style={{ marginTop: '8px', fontFamily: 'monospace', color: '#cbd5e1' }}>
              parser {quality.parserVersion} · 원본 {quality.sourceAssets.toLocaleString()}건 · 활성 종목관계 {quality.activeComponents.toLocaleString()}건 ·
              0수량 제외 {quality.excludedZeroQuantity.toLocaleString()}건 · 신고가액 직접귀속률 {(quality.valuationCoverage * 100).toFixed(1)}%
              · 회계대사 {quality.reconciliationPass ? 'PASS' : 'FAIL'}
            </div>
          )}
        </div>

        {loading ? <div style={{ padding: '40px', textAlign: 'center' }}>데이터 정밀 검증 및 분석 중...</div> : (
          <>
            {/* 👑 16-CARD EDGE DASHBOARD */}
            <div className="analysis-metric-grid">
              
              <Card title="공식 증권 신고총액" icon={<Briefcase size={14}/>} value={formatCurrency(officialTotal)} subtext={`${quality?.sourceAssets?.toLocaleString() || 0}개 원본 신고 행`} color="#94a3b8"
                tooltip="공식 신고서의 증권 자산 행 평가액 전체 합계입니다. 종목별로 금액을 나눌 수 없는 복수 종목 신고도 포함합니다." />
              <Card title="종목별 직접 귀속액" icon={<Coins size={14}/>} value={formatCurrency(totalMarketCap)} subtext="원문 근거 단일 종목 합계 · 전체가치 아님" color="#38bdf8"
                tooltip="전체 증권 가치가 아닙니다. 원문에서 특정 종목 하나에 평가액을 직접 귀속할 수 있는 신고만 합산한 확정 금액입니다." />
              <Card title="종목별 미배분 잔액" icon={<Layers size={14}/>} value={formatCurrency(unallocatedTotal)} subtext="복수 종목 등 개별 귀속 불가" color="#f59e0b"
                tooltip="공식 총액에는 포함되지만 복수 종목 묶음 등으로 개별 종목에 안전하게 나눌 수 없는 금액입니다. 임의 추정하지 않습니다." />
              <Card title="금액 직접 귀속률" icon={<Crosshair size={14}/>} value={`${(directCoverage * 100).toFixed(1)}%`} subtext="직접 귀속액 / 공식 신고총액" color="#10b981"
                tooltip="공식 증권 신고총액 중 개별 종목에 금액을 직접 연결할 수 있는 비율입니다. 종목 식별률이나 전체 데이터 정확도를 뜻하지 않습니다." />

              <Card title="배분 신고가액 1위" icon={<Crown size={14}/>} value={topValuationStock?.name || '-'} subtext={`${formatCurrency(topValuationStock?.valuation || 0)} 합계`} color="#f59e0b" />
              <Card title="신고 보유자 최다" icon={<Users size={14}/>} value={mostHoldersStock?.name || '-'} subtext={`${Number(mostHoldersStock?.count || 0).toLocaleString('ko-KR')}명 보유`} color="#10b981" />
              <Card title="금액 확인 보유자 평균 1위" icon={<Zap size={14}/>} value={superRichPick?.name || '-'} subtext={`평균 ${formatCurrency(superRichPick ? superRichPick.valuation / superRichPick.valuedHolderCount : 0)}`} color="#8b5cf6" />
              <Card title="개별 배분가액 1위" icon={<Target size={14}/>} value={biggestBagStock?.name || '-'} subtext={`${formatCurrency(biggestBagStock?.topHolderVal || 0)} (${biggestBagStock?.topHolder})`} color="#ef4444" />

              <Card title="단독 신고 최고가액" icon={<Gem size={14}/>} value={hiddenGemStock?.name || '-'} subtext={`${formatCurrency(hiddenGemStock?.valuation || 0)} · 보유자 1명`} color="#0ea5e9" />
              <Card title="금액 확인 5명+ 최저 평균" icon={<Activity size={14}/>} value={antsPickStock?.name || '-'} subtext={`평균 ${formatCurrency(antsPickStock ? antsPickStock.valuation / antsPickStock.valuedHolderCount : 0)}`} color="#14b8a6" />
              <Card title="직접귀속액 집중도 1위" icon={<Scale size={14}/>} value={whaleMonopoly?.name || '-'} subtext={`최대 보유자 ${(whaleMonopoly ? (whaleMonopoly.topHolderVal / whaleMonopoly.valuation) * 100 : 0).toFixed(1)}% · 확인 3명+`} color="#f43f5e" />
              <Card title="직접귀속액 분산도 1위" icon={<Fingerprint size={14}/>} value={truePublicStock?.name || '-'} subtext={`최대 보유자 ${(truePublicStock ? (truePublicStock.topHolderVal / truePublicStock.valuation) * 100 : 0).toFixed(1)}% · 확인 10명+`} color="#8b5cf6" />

              <Card title="1위 종목 쏠림도" icon={<PieIcon size={14}/>} value={`${monopolyWeight}%`} subtext={`대장주 단일 지배력`} color="#f97316" />
              <Card title="상위 10종목 집중도" icon={<BarChart3 size={14}/>} value={`${blueChipDominance}%`} subtext={`직접 귀속액 기준`} color="#3b82f6" />
              <Card title="금액 직접귀속 종목" icon={<Search size={14}/>} value={`${uniqueAssetsCount.toLocaleString()}개`} subtext="직접 귀속액이 1원 이상인 종목" color="#a8a29e" />
              <Card title="금액 확인 보유관계" icon={<Wallet size={14}/>} value={`${totalHolders.toLocaleString()}건`} subtext="종목별 금액을 확인한 관계" color="#64748b" />
              
            </div>

            <AlphaInsightDeck instruments={stocks} alpha={alpha} noun="종목" accent="#f59e0b" onSelect={selectInsightInstrument} />

            {/* 검색 및 테이블 툴바 (Split Layout) */}
            <div id="securities-instrument-table" className="securities-table-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', background: 'rgba(0,0,0,0.2)', padding: '12px 20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: '14px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Target size={16} color="var(--accent-gold)" />
                <span>총 <strong style={{ color: '#fff', fontFamily: 'monospace', fontSize: '16px' }}>{filteredStocks.length.toLocaleString('ko-KR')}</strong>개의 종목 필터링 됨</span>
              </div>
              
              <div style={{ position: 'relative', width: '300px' }}>
                <Search size={16} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  className="securities-table-search"
                  type="text" 
                  placeholder="종목 검색 (예: 삼성전자)" 
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
                  onFocus={(e) => e.target.style.border = '1px solid var(--accent-gold)'}
                  onBlur={(e) => e.target.style.border = '1px solid rgba(255,255,255,0.1)'}
                />
              </div>
            </div>

            {/* 고밀도 데이터 테이블 */}
            <div className="securities-table-shell" style={{ border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', overflow: 'hidden', background: 'rgba(0,0,0,0.2)' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
                  <thead className="securities-table-head" style={{ background: '#111827', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <tr>
                      <th style={{ padding: '16px', color: 'var(--text-muted)', fontWeight: 500, width: '60px' }}>Rank</th>
                      <th style={{ padding: '16px', color: 'var(--text-muted)', fontWeight: 500 }}>종목명</th>
                      <th onClick={() => handleSort('valuation')} style={{ padding: '16px', color: 'var(--text-muted)', fontWeight: 500, cursor: 'pointer', textAlign: 'right' }}>
                        <div title="전체 종목 가치가 아닌, 원문에서 해당 종목에 직접 귀속 가능한 확정 신고가액입니다." style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>배분 신고가액 <SortIcon field="valuation" /></div>
                      </th>
                      <th onClick={() => handleSort('count')} style={{ padding: '16px', color: 'var(--text-muted)', fontWeight: 500, cursor: 'pointer', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>보유자 <SortIcon field="count" /></div>
                      </th>
                      <th style={{ padding: '16px', color: 'var(--text-muted)', fontWeight: 500, textAlign: 'right' }}>금액 확인 / 미배분</th>
                      <th onClick={() => handleSort('avg')} style={{ padding: '16px', color: 'var(--text-muted)', fontWeight: 500, cursor: 'pointer', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>확인 보유자 평균 <SortIcon field="avg" /></div>
                      </th>
                      <th style={{ padding: '16px', color: 'var(--text-muted)', fontWeight: 500, textAlign: 'center' }}>품질</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStocks.slice(0, visibleCount).map((stock: any, idx: number) => (
                      <React.Fragment key={idx}>
                        <tr 
                          onClick={() => toggleRow(stock.name)}
                          className="table-row-hover securities-stock-row"
                          style={{ 
                            borderBottom: '1px solid rgba(255,255,255,0.03)', 
                            cursor: 'pointer',
                            background: expandedRow === stock.name ? 'rgba(245, 158, 11, 0.05)' : 'transparent'
                          }}
                        >
                          <td style={{ padding: '16px', color: 'var(--text-muted)' }}>{idx + 1}</td>
                          <td style={{ padding: '16px', fontWeight: 600, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {stock.name} 
                            {expandedRow === stock.name ? <ChevronUp size={16} color="var(--accent-gold)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
                          </td>
                          <td style={{ padding: '16px', textAlign: 'right', fontFamily: 'monospace', color: '#f59e0b', fontWeight: 600, fontSize: '15px' }}>
                            {stock.allocatedPositions > 0 ? formatCurrency(stock.valuation) : '금액 미배분'}
                          </td>
                          <td style={{ padding: '16px', textAlign: 'right', color: '#94a3b8' }}>
                            {stock.count.toLocaleString()}명
                          </td>
                          <td style={{ padding: '16px', textAlign: 'right', color: '#94a3b8', fontFamily: 'monospace' }}>
                            <span style={{ color: '#38bdf8' }}>{stock.valuedHolderCount.toLocaleString()}</span>
                            <span style={{ color: '#475569' }}> / </span>
                            <span style={{ color: '#f59e0b' }}>{stock.unallocatedHolderCount.toLocaleString()}</span>
                            <div style={{ fontSize: '10px', color: '#64748b' }}>
                              금액확인 {(stock.holderCoverage * 100).toFixed(1)}%
                            </div>
                          </td>
                          <td style={{ padding: '16px', textAlign: 'right', fontFamily: 'monospace', color: '#38bdf8' }}>
                            {formatCurrency(stock.avg)}
                          </td>
                          <td style={{ padding: '16px', textAlign: 'center' }}>
                            <span title={`파서 신뢰도 ${(stock.confidenceScore * 100).toFixed(1)}% · 직접귀속액 비중 ${stock.weight.toFixed(2)}%`}
                              style={{
                                display: 'inline-block', minWidth: '28px', padding: '4px 7px', borderRadius: '6px',
                                fontWeight: 900, fontFamily: 'monospace',
                                color: stock.dataGrade === 'A' ? '#34d399' : stock.dataGrade === 'B' ? '#38bdf8' : stock.dataGrade === 'C' ? '#fbbf24' : '#fb7185',
                                background: 'rgba(255,255,255,0.05)',
                              }}>
                              {stock.dataGrade}
                            </span>
                          </td>
                        </tr>
                        
                        {expandedRow === stock.name && (
                          <tr className="securities-expanded-row" style={{ background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                            <td colSpan={7} style={{ padding: '24px' }}>
                              <h4 style={{ margin: '0 0 16px 0', color: 'var(--accent-gold)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Users size={18} /> [{stock.name}] 심층 보유자 명단
                              </h4>
                              {loadingHolders[stock.name] ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
                                  <Loader2 size={16} className="spinner" /> 공직자 연결 기록 추적 중...
                                </div>
                              ) : holdersMap[stock.name] ? (
                                <div className="securities-holder-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                                  {holdersMap[stock.name].map((h, i) => (
                                    <div 
                                      key={i} 
                                      onClick={(e) => { e.stopPropagation(); navigate(`/officials/${h.id}?year=${year}`); }}
                                      style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.05)' }}
                                      className="table-row-hover securities-holder-card"
                                    >
                                      <div style={{ background: 'rgba(245, 158, 11, 0.2)', padding: '8px', borderRadius: '6px' }}>
                                        <User size={16} color="#f59e0b" />
                                      </div>
                                      <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{h.name}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{h.agency} • {h.title}</div>
                                      </div>
                                      <div style={{ fontWeight: 'bold', fontFamily: 'monospace', color: '#f59e0b' }}>
                                        {formatCurrency(h.valuation)}
                                        {h.hasUnallocated && (
                                          <div style={{ color: '#94a3b8', fontSize: '10px', textAlign: 'right' }}>복수종목 금액 미배분 포함</div>
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

              {visibleCount < filteredStocks.length && (
                <div 
                  onClick={() => setVisibleCount(v => v + 50)}
                  style={{ padding: '16px', textAlign: 'center', color: '#38bdf8', cursor: 'pointer', fontWeight: 600, background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.05)' }}
                  className="table-row-hover securities-load-more"
                >
                  더 보기 ({Math.max(0, filteredStocks.length - visibleCount).toLocaleString('ko-KR')}개 남음)
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
