import React, { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { CircleCheck, PanelLeftClose, PanelLeftOpen, Radio } from 'lucide-react';
import LivingLogo from './LivingLogo';
import { navigationItems } from '../config/navigation';

type ReleaseStatus = {
  release?: { minimum_year?: number; maximum_year?: number; id?: string };
  semanticAudit?: { publishable?: boolean };
};

export default function Sidebar({
  className = '',
  compact = false,
  showCompactToggle = true,
  onToggleCompact,
  onNavigate,
}: {
  className?: string;
  compact?: boolean;
  showCompactToggle?: boolean;
  onToggleCompact?: () => void;
  onNavigate?: () => void;
}) {
  const currentYear = new Date().getFullYear();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const year = searchParams.get('year') || 'recent';
  const [status, setStatus] = useState<ReleaseStatus | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/meta/methodology', { cache: 'no-store' })
      .then((response) => response.json())
      .then((json) => {
        if (alive && json?.success) setStatus(json.data);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  return (
    <>
    <aside className={`sidebar ${compact ? 'compact' : ''} ${className}`} style={{ overflowY: 'auto' }}>
      
      <div className="brand" style={{ marginBottom: '20px' }}>
        <img src="/icon.png" alt="Logo" className="brand-icon" />
        <LivingLogo text="K-Whale" size="24px" isSidebar={true} />
      </div>
      <nav className="nav-menu">
        {navigationItems.map((item) => {
          const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
          return (
            <Link to={`${item.path}?year=${year}`} key={item.path} style={{ textDecoration: 'none' }} onClick={onNavigate} title={compact ? item.label : undefined}>
              <div className={`nav-item ${isActive ? 'active' : ''}`} style={{ '--nav-accent': item.accent } as React.CSSProperties}>
                <span className="nav-icon-wrap"><item.icon className="nav-icon" size={19} /></span>
                <span className="nav-label">{item.label}</span>
              </div>
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-release" aria-label="데이터 업데이트 현황">
        <div className="sidebar-release-head">
          <span><Radio size={13} /> DATA PULSE</span>
          <strong>LIVE</strong>
        </div>
        <div className="sidebar-release-title">
          <span className="release-pulse" />
          최신 공개분 반영
        </div>
        <div className="release-track"><i /></div>
        <div className="sidebar-release-meta">
          <span>{status?.release ? `${status.release.minimum_year}–${status.release.maximum_year}` : '릴리스 확인 중'}</span>
          <span>{status?.semanticAudit?.publishable ? <><CircleCheck size={12} /> 품질 게이트 통과</> : '원문 대조 진행 중'}</span>
        </div>
        {status?.release?.id && <small>release {String(status.release.id).slice(0, 10)}</small>}
      </div>
      <div className="sidebar-legal">
        <Link to={`/privacy?year=${year}`}>개인정보</Link>
        <Link to={`/terms?year=${year}`}>이용약관</Link>
        <span>© {currentYear} K-Whale</span>
      </div>
    </aside>
      {showCompactToggle && <button
        type="button"
        className={`sidebar-compact-toggle ${compact ? 'compact' : ''}`}
        onClick={onToggleCompact}
        aria-label={compact ? '메뉴 펼치기' : '메뉴 접기'}
        title={compact ? '메뉴 펼치기' : '메뉴 접기'}
      >
        {compact ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
      </button>}
    </>
  );
}
