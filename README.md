# K-Whale

공식 공직자 재산공개 원문을 연도별로 보존하고, 재현 가능한 정규화·비교 과정을 거쳐 검색·분류·랭킹을 제공하는 데이터 제품입니다.

새 작업자는 먼저 [작업 행동강령](AGENTS.md)과
[프로젝트 핸드북](docs/project-handbook.md)을 읽어주세요. 전체 문서 지도는
아래에 있습니다.

- [데이터 방법론](docs/data-methodology.md)
- [데이터 플랫폼](docs/data-platform.md)
- [데이터 거버넌스](docs/data-governance.md)
- [개발·검증·복구 런북](docs/quality-runbook.md)
- [주요 의사결정과 사고 기록](docs/decision-log.md)
- [로드맵](docs/roadmap.md)
- [현재 작업 상태](docs/current-state.md)

## 원칙

- 대한민국 전자관보를 장기 원문의 1차 출처로 사용합니다.
- PETI 공개목록은 제공 범위(2022년 8월~2023년 12월)의 보조 출처로 사용합니다.
- 모든 다운로드 파일은 SHA-256과 원본 URL을 저장합니다.
- 원문과 정규화 결과를 분리해 파서 변경 후에도 재처리할 수 있습니다.
- 채무는 원문 부호와 무관하게 부채로 분류하고 순자산에서 차감합니다.
- 연도 스냅샷이 없으면 수익금·수익률·신규취득 값을 추정하지 않습니다.
- 여러 종목이 한 원문 행에 들어 있으면 평가액을 종목마다 중복 배분하지 않습니다.

## 실행

```bash
npm install
npm run dev
```

별도 터미널에서 현재 제품 API를 실행합니다.

```bash
cd backend
npm install
npm run api:private
```

기본 프런트엔드는 `http://127.0.0.1:5173`, API는
`http://127.0.0.1:3340`입니다. `server.js`/3333은 레거시 경로이며 현재
Vite `/api` 프록시는 `server_private.js`/3340을 사용합니다.

## 공식자료 수집

PETI 통합공개 목록은 연도별로 자동 발견합니다.

```bash
cd backend
python3 scripts/peti_discover.py --year 2024 --year 2025 --year 2026
python3 scripts/peti_legacy_discover.py --year 2022 --year 2023
python3 scripts/gwanbo_discover.py --year 2020 --year 2021 --year 2022 \
  --year 2023 --year 2024 --year 2025 --year 2026
python3 scripts/gwanbo_download.py --year 2020 --year 2021 --year 2022 \
  --year 2023 --year 2024 --year 2025 --year 2026
python3 scripts/source_coverage_report.py --from-year 2020 --to-year 2026
```

결과는 `backend/data/discovery/peti-연도.json`에 저장됩니다. 정기공개
원문은 PETI가 제공한 RAONK 파일 토큰, 나머지는 PDF 생성용 등록번호로
구분해 보존합니다. PETI는 단순 파일 URL을 제공하지 않으므로 토큰을 URL로
추측하지 않습니다.

전자관보 수집기는 검색 결과의 `contentId`·`tocId`를 사용해 각 재산공개
항목 PDF를 직접 내려받습니다. 관보 전체 호를 중복 저장하지 않으며,
실패한 항목만 재실행할 수 있습니다.

전자관보처럼 검증된 직접 파일 URL이 있는 문서는
`backend/config/disclosures.example.json`을 복사해 manifest를 만든 뒤
다음 명령으로 내려받습니다.

```bash
cd backend
python3 scripts/official_ingest.py \
  --manifest config/disclosures.json \
  --year 2026 \
  --raw-dir data/raw
```

수집기는 허용된 공식 HTTPS 도메인 이외의 파일을 거부합니다. 다운로드한 파일은 연도별 디렉터리에 저장되고 SHA-256 메타데이터가 함께 생성됩니다.

월별 자동 실행은 `.github/workflows/official-data-monitor.yml`에 정의되어
있습니다. PETI 수집은 CSRF 세션과 사이트 대기열 정책을 준수하고, 직접
다운로드 URL이 없는 범위에서는 발견 레코드와 공식 파일 토큰을 먼저
보존한 뒤 다운로드 워커가 이어받습니다.

## 데이터베이스

새 스키마의 핵심 테이블:

- `Disclosure`: 공시 연도·공개일·위원회·출처
- `SourceDocument`: 다운로드 원문·해시·크기·추출 상태
- `DisclosureOfficial`: 공시 당시 소속/직위와 총자산·채무·순자산
- `RawAsset`: 파싱 전 원문 행
- `Asset`: 정규화 자산과 신뢰도·검수 상태
- `SecurityHolding`, `CryptoHolding`: 종목·수량·평가액 배분 근거
- `AssetHistory`: 연도별 동일 자산 매칭 결과

기존 DB는 반드시 백업 후 migration을 적용합니다.

```bash
cd backend
npm run prisma:generate
npm run db:migrate
npm run data:recalculate
npm run data:quality
```

## 테스트

```bash
cd backend
npm test
cd ..
npm run build
```

상세 계산 규칙과 공개 게이트는 [데이터 방법론](docs/data-methodology.md)을 참고하세요.
