import React, { Suspense, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useSearchParams, Link } from 'react-router-dom';
import { Menu, Moon, Search, Sun, X } from 'lucide-react';
import './index.css';

// Components
import Sidebar from './components/Sidebar';
import { routeNavigation } from './config/navigation';

// Lazy-loaded Pages (Code Splitting for Performance)
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const OfficialDetail = React.lazy(() => import('./pages/OfficialDetail'));
const OfficialsList = React.lazy(() => import('./pages/OfficialsList'));
const Rankings = React.lazy(() => import('./pages/Rankings'));
const loadMapPage = () => import('./pages/MapPage');
const MapPage = React.lazy(loadMapPage);
const HotspotExplorer = React.lazy(() => import('./pages/HotspotExplorer'));
const RealEstate = React.lazy(() => import('./pages/analysis/RealEstate'));
const Securities = React.lazy(() => import('./pages/analysis/Securities'));
const Crypto = React.lazy(() => import('./pages/analysis/Crypto'));
const NewAssets = React.lazy(() => import('./pages/NewAssets'));
const Guide = React.lazy(() => import('./pages/Guide'));
const About = React.lazy(() => import('./pages/About'));
const Support = React.lazy(() => import('./pages/Support'));
const Policy = React.lazy(() => import('./pages/Policy'));

class PageErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(previousProps: React.PropsWithChildren) {
    if (previousProps.children !== this.props.children && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="glass-card" style={{ padding: '32px' }}>
          <h2 style={{ marginTop: 0 }}>화면을 불러오지 못했습니다</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            데이터 응답 형식이 변경되었거나 일시적인 오류가 발생했습니다. 다른 메뉴는 계속 이용할 수 있습니다.
          </p>
          <button onClick={() => window.location.reload()}>다시 불러오기</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppLayout() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedYear = searchParams.get('year') || 'recent';
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('kwhale-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return 'dark';
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const routeMeta = routeNavigation(location.pathname);
  const HeaderIcon = routeMeta.icon;
  const sidebarCompact = location.pathname === '/map';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('kwhale-theme', theme);
  }, [theme]);

  useEffect(() => {
    const preloadTimer = window.setTimeout(() => {
      void loadMapPage()
        .then((module) => module.preloadMapData('recent'))
        .catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(preloadTimer);
  }, []);

  const changeYear = (year: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('year', year);
    setSearchParams(next);
  };

  return (
    <div className="kwhale-app">
      {/* [Limitless Edition] 10+ 앰비언트 골드 템플릿 (선형, 점발산형, 방사형 펄스 조합) */}
      <div className="gold-beam-container">
        {/* 선형 빔 (Sweeping Beams) */}
        <div className="gold-beam"></div>
        <div className="gold-beam"></div>
        <div className="gold-beam"></div>
        <div className="gold-beam"></div>
        <div className="gold-beam"></div>
        
        {/* 발산형 오브 (Glowing Orbs) */}
        <div className="gold-orb"></div>
        <div className="gold-orb"></div>
        <div className="gold-orb"></div>
        
        {/* 방사형 펄스 (Radiating Pulse) */}
        <div className="gold-pulse"></div>
        <div className="gold-pulse"></div>
      </div>
      
      <Sidebar
        className={mobileNavOpen ? 'mobile-open' : ''}
        compact={sidebarCompact}
        showCompactToggle={false}
        onNavigate={() => setMobileNavOpen(false)}
      />
      {mobileNavOpen && <button className="mobile-nav-scrim" aria-label="메뉴 닫기" onClick={() => setMobileNavOpen(false)} />}
      <main className="main-content">
        {/* Top Navigation Bar */}
        <div className="top-toolbar">
          <div className="header-identity" style={{ '--header-accent': routeMeta.accent } as React.CSSProperties}>
            <span className="header-route-icon"><HeaderIcon size={20} /></span>
            <h1 className="header-title gold-shimmer-text" style={{ margin: 0 }}>{routeMeta.title}</h1>
          </div>
          <div className="top-toolbar-actions">
            <button
              type="button"
              className="mobile-menu-toggle"
              aria-label={mobileNavOpen ? '메뉴 닫기' : '메뉴 열기'}
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              {mobileNavOpen ? <X size={19} /> : <Menu size={19} />}
            </button>
            <div className="year-control" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700 }}>기준 연도</span>
              <select
                aria-label="기준 연도"
                value={selectedYear}
                onChange={(event) => changeYear(event.target.value)}
                style={{ background: '#111a33', color: '#fff', border: '1px solid rgba(56,189,248,0.45)', borderRadius: '8px', padding: '7px 10px', fontWeight: 800 }}
              >
                {[
                  { value: 'recent', label: '최신 통합 · 6,641명' },
                  { value: '2026', label: '2026년 · 475건' },
                  { value: '2025', label: '2025년 · 6,328건' },
                  { value: '2024', label: '2024년 · 6,507건' },
                  { value: '2023', label: '2023년 · 5,887건' },
                  { value: '2022', label: '2022년 · 2건' },
                  { value: 'all', label: '전체 인물 최신 · 7,792명' },
                ].map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {selectedYear === '2026' && (
                <span style={{ fontSize: '11px', color: '#fbbf24', fontWeight: 800 }}>진행 중</span>
              )}
              {selectedYear === 'all' && (
                <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 800 }}>인물별 최신</span>
              )}
              {selectedYear === 'recent' && (
                <span title="2025년 완결 모집단 + 2026년 공개분 최신 반영" style={{ fontSize: '11px', color: '#34d399', fontWeight: 800 }}>추천</span>
              )}
            </div>
            <div title="원본 파일과 체크섬은 보존됐으며, 공식 원문 건별 대조는 진행 중입니다." style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderRadius: '12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24', fontSize: '11px', fontWeight: 800 }}>
              원문 검증 진행 중
            </div>
            <button
              type="button"
              className="theme-toggle"
              aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
              title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
              onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <Link to={`/officials?year=${selectedYear}`} aria-label="공직자 검색" className="table-row-hover" style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', cursor: 'pointer' }}>
              <Search size={20} color="var(--text-muted)" />
            </Link>
          </div>
        </div>

        {/* Dynamic Route Content with Suspense Loading */}
        <PageErrorBoundary key={location.pathname}>
          <Suspense fallback={<div style={{ textAlign: 'center', padding: '100px', color: 'var(--accent-sky)' }}>컴포넌트 및 알고리즘 최적화 로딩 중...</div>}>
            <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/officials/:id" element={<OfficialDetail />} />
            <Route path="/officials" element={<OfficialsList />} />
            <Route path="/rankings/yield" element={<Rankings type="yield" />} />
            <Route path="/rankings/profit" element={<Rankings type="profit" />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/hotspot" element={<HotspotExplorer />} />
            <Route path="/real-estate" element={<RealEstate />} />
            <Route path="/securities" element={<Securities />} />
            <Route path="/virtual-assets" element={<Crypto />} />
            <Route path="/analysis/new-assets" element={<NewAssets />} />
            <Route path="/guide" element={<Guide />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Support mode="contact" />} />
            <Route path="/participate" element={<Support mode="participate" />} />
            <Route path="/privacy" element={<Policy mode="privacy" />} />
            <Route path="/terms" element={<Policy mode="terms" />} />
            <Route path="*" element={<div style={{ padding: '40px' }}>준비 중인 프리미엄 리포트입니다.</div>} />
            </Routes>
          </Suspense>
        </PageErrorBoundary>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <AppLayout />
    </Router>
  );
}
