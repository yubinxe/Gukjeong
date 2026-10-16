# 국정 한눈에 3.0 · 전망 인텔리전스 모듈

## 프로젝트 개요
- 운영 사이트(https://gukjeong-hannune.vercel.app)에 증분 결합할 분석 계층. 이 저장소에는 운영 소스가 없다(README 'Phase 0 감사 결과').
- 흐름: FACT → MECHANISM → CONSENSUS → SCENARIO → FORECAST → VERIFICATION
- 현재 사례: 국민연금 리밸런싱(`outlook/data/nps-rebalancing-2026.json`), 확률 정책 C(정성).

## 기술 스택
- 순수 JavaScript ES 모듈(`.mjs`), 외부 의존성 0, Node >= 20.10 (JSON import attributes 사용)
- 정적 HTML/CSS/JS 화면 + Vercel 서버리스 함수 형태(`api/outlook/*.mjs`)

## 구조
| 경로 | 역할 |
|---|---|
| `outlook/data/*.json` · `outlook/data/index.mjs` | 이슈 데이터(근거 원장·시나리오·예측 원장)와 레지스트리 |
| `outlook/lib/engine.mjs` | 선별 점수·스키마 검증·확률 정책·회계 정합성·사후 재구성 |
| `outlook/index.html` · `outlook.js` · `outlook.css` | 분기점 목록·상세 화면 |
| `outlook/entry.js` | 기존 홈 진입 위젯 |
| `api/outlook/issues.mjs` | 목록·상세 읽기 전용 API |
| `api/outlook/forecast-performance.mjs` | 판정 완료 예측 집계 |
| `test/outlook.test.mjs` | 테스트 10개 |

## 명령 (package.json)
- `npm test` (= `node --test test/*.test.mjs`)
- 로컬 확인(README): `python3 -m http.server 8800` → `/outlook/`

## 작업 규칙
- 모든 변경은 브랜치 → PR. 기본 브랜치 병합·운영 배포는 사용자 승인 후에만. 배포는 Preview 먼저(README 절차).
- API 키·`.env`·개인정보·기밀 커밋 금지. 지어낸 수치·실적 금지.
- 근거에는 URL·발행일·기준일·단위·검증 상태·출처 경로를 남긴다(테스트가 누락을 실패 처리). 기관 원문 없는 컨센서스는 "없음".
- 확률(%)은 정책 A(검증 모형)일 때만. 사후 재구성은 공개 날짜 기준으로 `asOf` 이후 자료를 숨긴다.
- 사용자 보고는 한국어로 간결하게.

## 테스트·배포 정책
- 변경 후 `npm test` 전부 통과해야 완료.
- 이 저장소는 운영 소스가 아니므로 직접 배포 대상이 아니다. 운영 결합은 README '운영 소스에 붙이는 방법'을 PC에서 따른다.

## 세션 시작 시 할 일
- `docs/WORKLOG.md` 를 먼저 읽고 '진행 중'부터 이어간다. 작업을 마치면 WORKLOG를 갱신한다.

## 클라우드 환경 변수
- 코드에서 사용하는 환경 변수 없음(`process.env` 미사용). `.env.example` 없음.
