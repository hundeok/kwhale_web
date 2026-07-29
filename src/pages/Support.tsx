import { Bug, DatabaseZap, Handshake, Mail, MessageSquareText, ShieldCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

type SupportItem = [LucideIcon, string, string];

export default function Support({ mode }: { mode: 'contact' | 'participate' }) {
  const [params] = useSearchParams();
  const year = params.get('year') || 'recent';
  const isContact = mode === 'contact';
  const items: SupportItem[] = isContact ? [
    [Bug, '데이터 오류 제보', '인물·기준 연도·자산 항목·공식 원문 주소를 함께 보내면 가장 빠르게 검토할 수 있습니다.'],
    [MessageSquareText, '제품 및 접근성 제안', '재현 경로, 사용 기기, 기대한 동작을 알려주세요.'],
    [ShieldCheck, '권리 및 개인정보 문의', '공개 원문의 정정·삭제 여부와 서비스 표시 범위를 함께 검토합니다.'],
  ] : [
    [DatabaseZap, '원문·데이터 기여', '전자관보 또는 공개기관 원문과 재현 절차가 있는 자료를 우선합니다.'],
    [Bug, '파서 회귀 사례', '명칭 오인식, 중복 배분, 금액 귀속 오류를 최소 입력으로 재현해 주세요.'],
    [Handshake, '연구·공익 협업', '사용 목적, 필요한 범위, 결과 공개 방식을 명확히 제안해 주세요.'],
  ];

  return (
    <div className="product-page">
      <section className="product-hero">
        <div className="eyebrow">{isContact ? 'SUPPORT DESK' : 'OPEN COLLABORATION'}</div>
        <h2>{isContact ? '데이터에 대한 질문을 남겨주세요' : '더 정확한 공개 데이터에 함께 기여하세요'}</h2>
        <p>
          {isContact
            ? '오류 제보, 원문 대조 요청, 기능 제안은 확인 가능한 근거와 함께 접수합니다. K-Whale은 숫자를 조용히 고치는 대신 수정 이유와 데이터 계보를 남기는 방식을 지향합니다.'
            : '공식 원문 링크, 정규화 제안, 파서 테스트 사례와 제품 개선 아이디어를 환영합니다. 개인 추정이나 출처가 불명확한 정보는 데이터베이스에 반영하지 않습니다.'}
        </p>
      </section>

      <section className="support-grid">
        {items.map(([Icon, title, text]) => (
          <article className="support-card" key={title}>
            <Icon size={24} />
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className="contact-panel">
        <Mail size={25} />
        <div>
          <strong>{isContact ? '문의 채널 준비 중' : '참여 채널 준비 중'}</strong>
          <p>정식 온보딩 전까지는 별도 연락처를 수집하지 않습니다. 공개 채널이 확정되면 이 페이지에 운영 주체와 응답 기준을 함께 고지합니다.</p>
        </div>
      </section>

      <div className="page-links">
        <Link to={`/about?year=${year}`}>프로젝트 원칙 보기</Link>
        <Link to={`/guide?year=${year}`}>이용 가이드 보기</Link>
      </div>
    </div>
  );
}
