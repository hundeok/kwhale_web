import { FileText, LockKeyhole, Scale } from 'lucide-react';

const sections = {
  privacy: [
    ['1. 처리하는 정보', 'K-Whale은 현재 회원가입, 댓글, 결제 기능을 운영하지 않으며 이용자의 이름·연락처를 직접 수집하지 않습니다. 서버 운영 과정에서 보안과 장애 분석을 위한 최소 접속 기록이 일시적으로 생성될 수 있습니다.'],
    ['2. 공개 인물 데이터', '서비스에 표시되는 공직자 재산 정보는 공개기관이 법령에 따라 공개한 자료를 검색·분석 가능한 형태로 가공한 것입니다. 비공개 출처의 개인정보를 결합하지 않습니다.'],
    ['3. 로컬 저장', '화면 테마 선택은 브라우저의 로컬 저장소에만 보관됩니다. 광고 식별자나 행동 프로파일을 만들기 위한 용도로 사용하지 않습니다.'],
    ['4. 외부 서비스', '전자관보, 국회청원, 지도 등 외부 사이트로 이동하면 해당 서비스의 정책이 적용됩니다. 외부 링크는 정보 확인을 위한 편의 기능입니다.'],
    ['5. 정정과 문의', '공식 원문이 정정되었거나 서비스 표시가 원문과 다른 경우 문의 페이지를 통해 근거와 함께 검토를 요청할 수 있습니다.'],
  ],
  terms: [
    ['1. 서비스의 성격', 'K-Whale은 공개 재산 자료의 탐색과 분석을 돕는 정보 서비스입니다. 법률·세무·투자 자문이나 공식 증명서를 제공하지 않습니다.'],
    ['2. 데이터 해석', '금액과 순위는 선택한 연도, 정규화 규칙, 금액 직접 귀속 가능 여부에 따라 달라질 수 있습니다. 중요한 판단 전에는 반드시 연결된 공식 원문을 확인해야 합니다.'],
    ['3. 허용되는 이용', '공익적 검증, 연구, 보도, 교육을 위한 합리적 이용을 환영합니다. 서비스 안정성을 해치는 자동 요청, 원문 맥락을 제거한 오도, 개인 괴롭힘 목적의 이용은 허용되지 않습니다.'],
    ['4. 정확성과 변경', '회계 검증과 품질 게이트를 운영하지만 모든 원문 행이 무오류임을 보증하지 않습니다. 오류는 릴리스 단위로 수정하며 분류와 화면은 개선 과정에서 변경될 수 있습니다.'],
    ['5. 권리와 책임', '공식 원문의 권리는 각 제공기관에 있습니다. K-Whale의 편집 구조, 정규화 체계, 분석 화면은 별도 권리의 대상이 될 수 있습니다.'],
  ],
};

export default function Policy({ mode }: { mode: 'privacy' | 'terms' }) {
  const privacy = mode === 'privacy';
  return (
    <div className="product-page policy-page">
      <section className="product-hero compact">
        <div className="eyebrow">{privacy ? 'PRIVACY NOTICE' : 'SERVICE TERMS'}</div>
        <h2>{privacy ? '개인정보처리방침' : '서비스 이용약관'}</h2>
        <p>시행일 2026년 7월 29일 · 제품 정식 공개 전 운영 초안</p>
      </section>
      <div className="policy-notice">
        {privacy ? <LockKeyhole size={22} /> : <Scale size={22} />}
        <span>{privacy ? '필요 이상의 정보를 수집하지 않는 것을 기본값으로 삼습니다.' : '공식 원문과 분석 결과의 경계를 명확히 표시합니다.'}</span>
      </div>
      <section className="policy-stack">
        {sections[mode].map(([title, body]) => (
          <article key={title}>
            <FileText size={18} />
            <div><h3>{title}</h3><p>{body}</p></div>
          </article>
        ))}
      </section>
    </div>
  );
}
