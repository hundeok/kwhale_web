# K-Whale 데이터 플랫폼

## 목표

K-Whale은 외부 사이트의 현재 응답에 의존하지 않고, 모든 입력 파일과 변환
이력을 재현할 수 있는 자체 데이터베이스를 구축한다. 외부 정제 데이터는 초기
적재와 비교에 사용하고 PETI·전자관보 원문으로 검증한다.

## 데이터 계층

1. `backend/private-data/snapshots`: 과거 K-Whale 스냅샷 불변 보관
2. `backend/private-data/sources`: 응답 원본과 해제된 JSON의 콘텐츠 주소 저장
3. `backend/private-data/lineage`: 수집 URL·헤더·시각·해시·검증 결과
4. `backend/private-data/releases`: 정규화한 불변 SQLite 릴리스
5. `backend/public-data`: Turso 업로드 전용으로 생성한 로컬 공개 projection
6. Turso `kwhale-public`: Vercel API만 접근하는 공개 서비스 데이터 계층

`private-data`는 Git, Vite `public`, Express 정적 파일 경로에 포함하지 않는다.
프런트엔드는 원본 파일이 아닌 백엔드의 제한된 API만 사용해야 한다.

## 최초 구축

```bash
cd backend
python3 scripts/realsignal_acquire.py \
  --legacy-snapshot ../assets/kwhale_data.json
python3 scripts/build_dataset.py
python3 scripts/dataset_audit.py
python3 -m unittest discover -s test -p 'test_*.py'
```

수집기는 공개 매니페스트에서 사용 가능한 모든 연도를 자동으로 찾는다. 연도를
제한해야 할 때만 `--year 2025 --year 2026`처럼 지정한다.

## 불변성과 재실행

- 수집 원본은 SHA-256을 경로로 사용하며 덮어쓰지 않는다.
- 실행마다 별도의 acquisition manifest를 생성한다.
- DB 릴리스는 acquisition run ID에서 결정한 고유 경로에 생성한다.
- 같은 릴리스가 이미 존재하면 빌드를 중단한다.
- `latest-release.json`은 최신 릴리스의 포인터일 뿐 원본을 복제하지 않는다.

## 연도 의미

CDN 매니페스트의 연도는 데이터 배포 기간이다. `registeredDate`와
`disclosureDate`는 별도로 보존한다. 화면의 “신고 기준 연도”와 “공개 기준
연도”는 섞지 말고 명시적으로 선택해야 한다.

## 출처 우선순위

1. 전자관보 원문
2. PETI 공개 자료
3. 리얼시그널 정제 데이터
4. 과거 K-Whale 스냅샷

낮은 순위 자료를 삭제하지 않고 비교 증거로 보존한다. 값이 충돌하면 높은
순위의 출처를 공개값으로 선택하고 충돌 기록을 남긴다.

## 배포 금지 항목

- 외부 응답 원본
- 수집 응답 헤더와 내부 경로
- 전체 비공개 acquisition manifest
- 데이터베이스 파일 직접 다운로드
- 별도 검토 없이 개인 단위 원문 전체 덤프

공개 산출물은 집계, 검색 인덱스, 페이지 단위 API projection으로 한정한다.

## 공개 projection과 Turso 배포

```bash
cd backend
npm run data:build-public
turso db create kwhale-public \
  --from-file public-data/kwhale-public.sqlite \
  --group default --wait
```

`data:build-public`은 다음을 자동 검증한다.

- 원본과 공개 DB의 테이블별 행 수 일치
- 신고 총자산·채무·순자산·자산행 합계 일치
- 자산 평가액 회계 합계 일치
- SQLite 무결성
- `asset.raw_json` 전량 제거
- 내부 `source_object_key` 전량 제거
- Turso import용 WAL 모드
- 공개 DB SHA-256 manifest 생성

Turso 토큰은 저장소나 `.env`에 커밋하지 않고 Vercel의 Sensitive Environment
Variable `TURSO_AUTH_TOKEN`으로만 관리한다. DB 주소는
`TURSO_DATABASE_URL`에 둔다.

## 품질 게이트

`dataset_audit.py`는 다음 조건을 모두 통과해야 `publishable: true`를 기록한다.

- SQLite 무결성 및 외래키 검사
- 수집 manifest의 모든 객체와 레코드 적재
- 2022~2026 연도 존재
- DB 파일 SHA-256 일치
- 이름 누락·음수 평가액·잘못된 좌표·고아 레코드·출처 위치 중복 없음

소속기관 누락처럼 원천 데이터에서 비롯된 보완 가능 항목은 경고로 남기고
PETI·전자관보 검증 큐에 보낸다. 경고는 숨기지 않지만 구조적으로 안전한
릴리스의 생성 자체를 막지는 않는다.

전체 갱신은 `npm run data:refresh`로 실행한다. 특정 연도만 수집하려면
`npm run data:refresh -- --year 2026`처럼 인자를 전달한다. 연도 제한 릴리스는
전체 공개 릴리스로 승격하지 않는다.
