import {
  Activity,
  Bitcoin,
  BookOpenCheck,
  Building2,
  ChartNoAxesCombined,
  CircleDollarSign,
  FileText,
  Fingerprint,
  Info,
  Landmark,
  LayoutDashboard,
  MapPinned,
  Radar,
  Scale,
  ShieldCheck,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavigationItem = {
  path: string;
  label: string;
  title: string;
  icon: LucideIcon;
  accent: string;
};

export const navigationItems: NavigationItem[] = [
  { path: '/', label: '대시보드', title: 'K-Whale 프리미엄 대시보드', icon: LayoutDashboard, accent: '#38bdf8' },
  { path: '/officials', label: '공직자 전체', title: '공직자 전체 명단', icon: UsersRound, accent: '#60a5fa' },
  { path: '/rankings/yield', label: '재산 급변 탐지', title: '재산 급변 탐지', icon: Radar, accent: '#34d399' },
  { path: '/rankings/profit', label: '고액 자산 이동', title: '고액 자산 이동', icon: CircleDollarSign, accent: '#fbbf24' },
  { path: '/analysis/new-assets', label: '자산 증가 이벤트', title: '자산 증가 이벤트', icon: Activity, accent: '#22d3ee' },
  { path: '/map', label: '전국 자산 지도', title: '전국 자산 핫스팟 지도', icon: MapPinned, accent: '#fb7185' },
  { path: '/hotspot', label: '부동산 지역 분석', title: '하이퍼 로컬 부동산 인텔리전스', icon: Building2, accent: '#2dd4bf' },
  { path: '/real-estate', label: '부동산 딥다이브', title: '부동산 전문 딥다이브', icon: Landmark, accent: '#a78bfa' },
  { path: '/securities', label: '증권/주식 현황', title: '증권/주식 딥다이브', icon: ChartNoAxesCombined, accent: '#f59e0b' },
  { path: '/virtual-assets', label: '가상자산(코인)', title: '가상자산 특화 분석', icon: Bitcoin, accent: '#8b5cf6' },
  { path: '/guide', label: '이용 가이드', title: '플랫폼 이용 가이드', icon: BookOpenCheck, accent: '#0ea5e9' },
  { path: '/about', label: '프로젝트 소개', title: '프로젝트 소개', icon: Fingerprint, accent: '#c084fc' },
];

const auxiliaryItems: NavigationItem[] = [
  { path: '/contact', label: '지원 센터', title: 'K-Whale 지원 센터', icon: WalletCards, accent: '#38bdf8' },
  { path: '/participate', label: '참여 안내', title: 'K-Whale 참여 안내', icon: Info, accent: '#34d399' },
  { path: '/privacy', label: '개인정보처리방침', title: '개인정보처리방침', icon: ShieldCheck, accent: '#60a5fa' },
  { path: '/terms', label: '서비스 이용약관', title: '서비스 이용약관', icon: Scale, accent: '#fbbf24' },
];

export function routeNavigation(pathname: string): NavigationItem {
  if (pathname.startsWith('/officials/')) {
    return { ...navigationItems[1], title: '포트폴리오 정밀 분석' };
  }
  return [...navigationItems, ...auxiliaryItems]
    .sort((a, b) => b.path.length - a.path.length)
    .find((item) => item.path === '/' ? pathname === '/' : pathname.startsWith(item.path))
    || { path: pathname, label: 'K-Whale', title: 'K-Whale', icon: FileText, accent: '#38bdf8' };
}
