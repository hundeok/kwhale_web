import { ArrowRight, BookOpenCheck, CircleDollarSign, Database, Filter, Fingerprint, Gauge, Search, ShieldCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

const journeys = [
  { icon: Search, step: '01', title: '인물에서 시작', text: '공직자 전체에서 이름·소속을 검색하고 렌즈와 정렬을 조합합니다. 카드를 다시 누르면 필터가 해제됩니다.', link: '/officials' },
  { icon: Gauge, step: '02', title: '변화를 비교', text: '재산 급변 탐지는 변화율, 고액 자산 이동은 절대 증감액을 봅니다. 서로 다른 질문에 답하는 별도 화면입니다.', link: '/rankings/yield' },
  { icon: CircleDollarSign, step: '03', title: '자산군을 해부', text: '증권·가상자산·부동산에서 전체 신고액과 직접 귀속 가능한 금액을 구분해 읽습니다.', link: '/securities' },
  { icon: Fingerprint, step: '04', title: '원문까지 검증', text: '인물 상세의 데이터 계보, 원본 레코드와 해시를 확인하고 중요한 사실은 전자관보 원문과 대조합니다.', link: '/about' },
];

export default function Guide() {
  const [params] = useSearchParams();
  const year = params.get('year') || 'recent';
  return (
    <div className="product-page">
      <section className="product-hero guide-hero has-brand-art">
        <img className="product-hero-logo" src="/icon.png" alt="" aria-hidden="true" />
        <div className="eyebrow">START WITH CONFIDENCE</div>
        <h2>숫자를 빠르게 찾고, 정확하게 읽는 법</h2>
        <p>K-Whale은 순위를 보여주는 데서 끝나지 않습니다. 기준 시점, 신고 범위, 직접 귀속 여부와 원문 계보를 함께 읽을 때 분석이 완성됩니다.</p>
        <div className="hero-actions">
          <Link className="primary-action" to={`/officials?year=${year}`}>공직자 탐색 시작 <ArrowRight size={16} /></Link>
          <Link className="secondary-action" to={`/about?year=${year}`}>데이터 원칙 보기</Link>
        </div>
      </section>

      <section className="journey-grid">
        {journeys.map(({ icon: Icon, step, title, text, link }) => (
          <Link to={`${link}?year=${year}`} className="journey-card" key={step}>
            <div className="journey-step">{step}</div>
            <Icon size={25} />
            <h3>{title}</h3>
            <p>{text}</p>
            <span>바로 가기 <ArrowRight size={14} /></span>
          </Link>
        ))}
      </section>

      <section className="reading-grid">
        <article>
          <Filter size={23} /><div><h3>연도 필터의 의미</h3><p><b>최신 통합</b>은 완결 모집단에 새 공개분을 보완한 추천 화면이고, 연도 선택은 그해 공개된 스냅샷만 봅니다. <b>전체 인물 최신</b>은 인물별 가장 최근 신고를 한 번씩 선택합니다.</p></div>
        </article>
        <article>
          <Database size={23} /><div><h3>합계와 배분액은 다릅니다</h3><p>공식 신고총액은 신고 행의 평가액입니다. 여러 종목이 한 금액으로 묶인 경우 K-Whale은 종목별로 임의 배분하지 않으므로 종목 랭킹 합계가 더 작을 수 있습니다.</p></div>
        </article>
        <article>
          <BookOpenCheck size={23} /><div><h3>알파 카드는 탐색 신호</h3><p>상위 집중도, 저변, 신규·증가·감소 신호를 조합해 다음 탐색 대상을 제안합니다. 시장수익률 예측이나 가치 판단이 아닙니다.</p></div>
        </article>
        <article>
          <ShieldCheck size={23} /><div><h3>신뢰등급 읽기</h3><p>표본 수, 금액 직접 확인률, 파서 신뢰도를 함께 보세요. 소표본과 미배분 관계는 화면에 숨기지 않고 제한 조건으로 표시합니다.</p></div>
        </article>
      </section>
    </div>
  );
}
