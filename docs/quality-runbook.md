# 개발·검증·복구 런북

## 1. 시작 전

```bash
pwd
git status --short
```

작업 경로가 `kwhale_web_gpt`인지 확인한다. `kwhale_web`에서 수정 작업을
시작하지 않는다.

## 2. 로컬 실행

터미널 A:

```bash
npm run dev
```

터미널 B:

```bash
cd backend
npm run api:private
```

확인:

```bash
curl http://127.0.0.1:3340/api/meta/methodology
```

## 3. UI 변경 검증

1. `npm run build`
2. 변경 메뉴 직접 진입
3. `recent`, 개별 연도, 필요 시 `all` 확인
4. 다크·라이트 모드 확인
5. 필터 선택→재선택 해제 확인
6. 새로고침과 공유 URL 복원 확인
7. 빈 결과·작은 표본 확인
8. 콘솔 크래시와 `undefined`, `NaN` 확인

## 4. 데이터 변경 검증

```bash
cd backend
node --check server_private.js
npm test
python3 -m unittest discover -s test -p 'test_*.py'
npm run data:semantic-quality
npm run data:audit-dataset
```

확인해야 할 값:

- 레코드 수
- 인물 수
- 총자산·채무·순자산
- 직접 귀속·미배분 합계
- 연도별 표본
- 중복·고아 레코드
- 좌표 유효 범위와 중복 좌표

## 5. 지도 회귀 체크리스트

깨끗한 URL:

`http://127.0.0.1:5173/map?year=recent`

현재 기준 데이터에서 전국 기본 화면은 약 24개의 클러스터가 보인다. 데이터
릴리스가 바뀌면 숫자는 달라질 수 있으므로 절대값보다 다음 흐름을 본다.

- 전국 기본에서 여러 클러스터가 표시됨
- 1단계 확대 시 클러스터 수가 증가함
- 2단계 확대 시 더 세분화됨
- 확대·이동 중 표적이 지도보다 뒤늦게 따라가지 않음
- `전국` 클릭 시 필터와 뷰가 초기화됨
- 상세 주소와 대표 좌표 범례가 구분됨
- 선택 자산 URL 복원
- 인물 전국 자산 포커스와 해제

### 지도 그래픽 안전 구조

```text
MapLibre marker element  ← 좌표 transform 전용
└─ .asset-cluster-visual ← 그래픽·애니메이션 전용
```

바깥 요소에 `transform` transition을 넣지 않는다.

## 6. 로컬 API 재시작

기존 3340 프로세스를 확인하고 해당 K-Whale 프로세스만 종료한다. 다른 Node
프로세스를 일괄 종료하지 않는다.

```bash
lsof -nP -iTCP:3340 -sTCP:LISTEN
```

그 후:

```bash
cd backend
npm run api:private
```

## 7. 데이터 릴리스 갱신

전체 갱신:

```bash
cd backend
npm run data:refresh
```

특정 연도 실험:

```bash
npm run data:refresh -- --year 2026
```

연도 제한 릴리스를 전체 공개 릴리스로 자동 승격하지 않는다. 원본과 기존
릴리스를 덮어쓰지 않는다.

## 8. 장애 대응

### `undefined.toLocaleString`

- API 응답 필드 누락 여부 확인
- 숫자 포매터가 `null`/`undefined`를 안전하게 처리하는지 확인
- UI에서 임의로 0을 넣기 전에 데이터 의미를 확인

### `NaN`·해시 `undefined`

- lineage API와 릴리스 메타데이터 확인
- 레코드 번호를 배열 인덱스로 가정하지 않음
- 원본 해시가 없으면 “검증 진행 중”으로 명시

### 지도 원이 하나만 보임

- URL의 `x`, `y`, `z`, `official`, `province`, `agency`, `q`, `min` 확인
- 상단 `전국` 또는 하단 초기화 버튼 사용
- 깨끗한 URL에서 마커 수 재검증
- 렌더러 변경 전에 필터 상태를 먼저 배제

### 지도 좌표 흔들림

- 마커 바깥 요소의 CSS `transform`/transition 검사
- 베이스 타일·`tileSize` 변경 여부 검사
- 이전 마커 중복 보존 코드 검사
- 위경도 원본과 화면 좌표 신뢰등급을 분리

## 9. 완료 보고

완료 보고에는 다음을 포함한다.

- 무엇이 달라졌는지
- 어떤 수치를 검증했는지
- 어떤 테스트와 빌드가 통과했는지
- 아직 원문 대조 중인 부분
- 사용자가 확인할 로컬 URL

