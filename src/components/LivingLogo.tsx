import React, { useState, useEffect } from 'react';
import './LivingLogo.css';

// 10가지의 극단적이고 도전적인 골드 전용 테마 로테이션
const GOLDEN_THEMES = [
  'theme-gold-pulse',    // 기본 심장박동
  'theme-gold-wave',     // 유려한 파도
  'theme-gold-elastic',  // 탄성 변형 (찌그러짐)
  'theme-gold-glitch',   // 사이버 럭셔리 글리치
  'theme-gold-breathe',  // 자간 팽창/수축 호흡
  'theme-gold-flip',     // 3D 180도 회전
  'theme-gold-blur',     // 신비로운 포커스 블러
  'theme-gold-swing',    // 좌우 진자 운동
  'theme-gold-bounce',   // 물리엔진 바운스
  'theme-gold-shatter'   // 날카로운 사선 스큐
];

export default function LivingLogo({ text = "K-Whale", size = "34px", isSidebar = false }) {
  const [themeIdx, setThemeIdx] = useState(0);

  useEffect(() => {
    // 4초마다 쉴 새 없이 변이하는 극강의 다이나믹 로고
    const interval = setInterval(() => {
      setThemeIdx((prev) => (prev + 1) % GOLDEN_THEMES.length);
    }, 4000); 
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={`living-logo-container ${GOLDEN_THEMES[themeIdx]}`} style={{ fontSize: size }}>
      {text.split('').map((char, i) => (
        <span 
          key={i} 
          className="living-char" 
          style={{ 
            animationDelay: `${i * (isSidebar ? 0.08 : 0.12)}s`,
            marginRight: char === '-' ? '2px' : '1px' 
          }}
        >
          {char}
        </span>
      ))}
    </div>
  );
}
