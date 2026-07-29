import { useEffect, useState } from 'react';
import { Database, FileCheck2, ShieldCheck, AlertTriangle, ArrowUpRight, HeartHandshake, Mail, Scale, Landmark, FileSearch } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

type MethodologyMeta = {
  metrics?: { persons: number; disclosures: number; assets: number };
  release?: { id: string; schema_version: string; status: string; minimum_year: number; maximum_year: number };
  semanticQuality?: {
    assets: { missingDetail: number; missingSubcategory: number };
    realEstate: { geocoded: number; total: number };
    securities: Array<{ subcategory?: string; count: number }>;
  };
  artifacts?: unknown[];
  limitations?: string[];
  semanticAudit?: {
    publishable: boolean;
    parserVersion: string;
    releaseId: string;
    classes: { monetary: { assets: number; componentCoverage: number; assetCoverage: number; reconciliationRate: number } };
    gates: Record<string, boolean>;
  };
};

export default function About() {
  const currentYear = new Date().getFullYear();
  const [params] = useSearchParams();
  const year = params.get('year') || 'recent';
  const [meta, setMeta] = useState<MethodologyMeta | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/meta/methodology', { cache: 'no-store' })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok || !json.success) throw new Error(json.error || '메타데이터를 불러오지 못했습니다.');
        setMeta(json.data);
      })
      .catch((reason) => setError(reason.message));
  }, []);

  const metrics = meta?.metrics;
  const release = meta?.release;
  const quality = meta?.semanticQuality;

  return (
    <div className="product-page about-page">
      <div className="product-hero about-hero has-brand-art">
        <img className="product-hero-logo" src="/icon.png" alt="" aria-hidden="true" />
        <div style={{ color: 'var(--accent-gold)', fontWeight: 800, fontSize: '13px' }}>PUBLIC ASSET DATA PRODUCT</div>
        <h2>
          공개된 기록을 검증 가능한 인텔리전스로
        </h2>
        <p>
          K-Whale은 흩어진 공직자 재산 공개 자료를 원본·인물·신고·자산의 계보로 연결합니다.
          숫자를 자극적으로 소비하는 대신, 어떤 원문이 어떤 규칙을 거쳐 화면의 한 줄이 되었는지
          추적할 수 있는 공공 데이터 제품을 만듭니다.
        </p>
      </div>

      {error && <div className="glass-card" style={{ padding: '18px', color: '#fca5a5' }}>{error}</div>}

      {metrics && (
        <div className="about-metric-grid">
          {[
            ['정규화 인물', `${Number(metrics.persons).toLocaleString()}명`],
            ['연도별 신고', `${Number(metrics.disclosures).toLocaleString()}건`],
            ['자산 원문 행', `${Number(metrics.assets).toLocaleString()}건`],
            ['수록 기간', release ? `${release.minimum_year}–${release.maximum_year}` : '확인 중'],
          ].map(([label, value]) => (
            <div key={label} className="glass-card" style={{ padding: '22px' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{label}</div>
              <div style={{ fontSize: '26px', fontWeight: 900, marginTop: '8px' }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="about-pillar-grid">
        {[
          {
            icon: <Database size={26} color="#38bdf8" />,
            title: '재현 가능한 릴리스',
            text: `현재 릴리스 ${release?.id?.slice(0, 12) || '-'} · 스키마 ${release?.schema_version || '-'} · 상태 ${release?.status || '-'}`,
          },
          {
            icon: <FileCheck2 size={26} color="#fbbf24" />,
            title: '연도별 원본과 SHA-256',
            text: `${Number(meta?.artifacts?.length || 0).toLocaleString('ko-KR')}개 연도 원본의 주소·수집 시각·체크섬·레코드 수를 함께 보존합니다.`,
          },
          {
            icon: <ShieldCheck size={26} color="#34d399" />,
            title: '비공개 데이터 계층',
            text: '브라우저에는 필요한 API 결과만 전달하고 원본 파일과 SQLite 데이터베이스는 직접 노출하지 않습니다.',
          },
        ].map((item) => (
          <div key={item.title} className="glass-card" style={{ padding: '28px' }}>
            {item.icon}
            <h3 style={{ margin: '16px 0 10px' }}>{item.title}</h3>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.7, margin: 0 }}>{item.text}</p>
          </div>
        ))}
      </div>

      <div className="glass-card" style={{ padding: '28px', border: '1px solid rgba(245,158,11,.35)' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', color: '#fbbf24', fontWeight: 800 }}>
          <AlertTriangle size={22} /> 검증 상태와 한계
        </div>
        <ul style={{ color: 'var(--text-muted)', lineHeight: 1.9, marginBottom: 0 }}>
          {(meta?.limitations || []).map((item: string) => <li key={item}>{item}</li>)}
          <li>현재 연도별 데이터 파일은 보존·체크섬 검증됐지만 모든 행의 공식 관보 대조는 진행 중입니다.</li>
          <li>‘증감률’은 신고 순자산 변화이며 주식·부동산의 시장 수익률을 의미하지 않습니다.</li>
        </ul>
      </div>

      {quality && (
        <div className="glass-card" style={{ padding: '28px' }}>
          <h3 style={{ marginTop: 0 }}>의미 품질 현황</h3>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.7 }}>
            구조 검증 통과와 별개로 파싱·분류 품질을 수치로 공개합니다. 빈 상세
            {Number(quality.assets.missingDetail).toLocaleString()}건, 빈 하위유형
            {Number(quality.assets.missingSubcategory).toLocaleString()}건이며, 부동산 좌표 커버리지는
            {' '}{((Number(quality.realEstate.geocoded) / Math.max(1, Number(quality.realEstate.total))) * 100).toFixed(1)}%입니다.
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {quality.securities.map((item) => (
              <span key={item.subcategory || '미분류'} style={{ padding: '7px 10px', borderRadius: '8px', background: 'rgba(255,255,255,.05)', color: '#cbd5e1', fontSize: '12px' }}>
                {item.subcategory || '미분류'} {Number(item.count).toLocaleString()}건
              </span>
            ))}
          </div>
        </div>
      )}

      {meta?.semanticAudit && (
        <div className="glass-card" style={{ padding: '28px', border: `1px solid ${meta.semanticAudit.publishable ? 'rgba(52,211,153,.35)' : 'rgba(248,113,113,.45)'}` }}>
          <h3 style={{ marginTop: 0 }}>파서 릴리스 게이트</h3>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.7 }}>
            parser {meta.semanticAudit.parserVersion} · 릴리스 {meta.semanticAudit.releaseId.slice(0, 12)} ·
            {' '}{meta.semanticAudit.publishable ? '모든 의미 품질 게이트 통과' : '배포 차단'}
          </p>
          <p style={{ color: '#cbd5e1', lineHeight: 1.7, fontFamily: 'monospace', fontSize: '13px' }}>
            금전자산 {Number(meta.semanticAudit.classes.monetary.assets).toLocaleString()}행 ·
            구성요소 파싱 {(meta.semanticAudit.classes.monetary.componentCoverage * 100).toFixed(3)}% ·
            자산행 커버리지 {(meta.semanticAudit.classes.monetary.assetCoverage * 100).toFixed(3)}% ·
            신고가액 합계 대조 {(meta.semanticAudit.classes.monetary.reconciliationRate * 100).toFixed(3)}%
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '10px' }}>
            {Object.entries(meta.semanticAudit.gates).map(([name, passed]) => (
              <div key={name} style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(255,255,255,.04)', color: passed ? '#34d399' : '#f87171', fontSize: '12px' }}>
                {passed ? 'PASS' : 'FAIL'} · {name}
              </div>
            ))}
          </div>
        </div>
      )}

      <section className="about-principles">
        <article><FileSearch size={24} /><h3>원문 우선</h3><p>가공 통계보다 공식 원문이 우선합니다. 원문 식별자와 체크섬을 보존해 결과를 다시 만들 수 있게 합니다.</p></article>
        <article><Scale size={24} /><h3>추정과 확정의 분리</h3><p>복수 자산의 합산 금액을 임의로 나누지 않습니다. 직접 확인 가능한 값과 파생 지표를 화면에서 구분합니다.</p></article>
        <article><ShieldCheck size={24} /><h3>품질을 제품 기능으로</h3><p>회계 대조, 중복 방지, 파서 회귀 테스트를 릴리스 게이트로 운영하고 한계도 함께 공개합니다.</p></article>
      </section>

      <section className="about-links">
        <div>
          <span className="eyebrow">CUSTOMER CARE</span>
          <h3>고객지원과 참여</h3>
          <Link to={`/contact?year=${year}`}><Mail size={18} /> 문의하기 <ArrowUpRight size={15} /></Link>
          <Link to={`/participate?year=${year}`}><HeartHandshake size={18} /> 참여하기 <ArrowUpRight size={15} /></Link>
        </div>
        <div>
          <span className="eyebrow">POLICY</span>
          <h3>약관 및 정책</h3>
          <Link to={`/privacy?year=${year}`}><ShieldCheck size={18} /> 개인정보처리방침 <ArrowUpRight size={15} /></Link>
          <Link to={`/terms?year=${year}`}><Scale size={18} /> 서비스 이용약관 <ArrowUpRight size={15} /></Link>
        </div>
        <div>
          <span className="eyebrow">OFFICIAL SOURCES</span>
          <h3>공식 정보 확인</h3>
          <a href="https://gwanbo.go.kr/" target="_blank" rel="noreferrer"><Landmark size={18} /> 대한민국 전자관보 <ArrowUpRight size={15} /></a>
          <a href="https://petitions.assembly.go.kr/" target="_blank" rel="noreferrer"><FileSearch size={18} /> 국회청원 <ArrowUpRight size={15} /></a>
        </div>
      </section>

      <footer className="product-footer">
        <div className="product-footer-brand">
          <img src="/icon.png" alt="" aria-hidden="true" />
          <div><strong>K-Whale</strong><span>Public Asset Intelligence</span></div>
        </div>
        <p>© {currentYear} K-Whale. All rights reserved.</p>
      </footer>
    </div>
  );
}
