# 국정 한눈에 3.0 — 전망 인텔리전스 모듈

운영 사이트(https://gukjeong-hannune.vercel.app, Vercel 프로젝트 `gukjeong` · `prj_4tUsWiOScsoReKyXpgjRod9udMtk`)에 **증분 결합**할 분석 계층입니다.
기존 사이트를 재구축하지 않습니다. 이 저장소에는 운영 소스가 없으므로(아래 감사 결과), 이 모듈은 운영 소스 루트에 그대로 복사해 붙이는 형태로 만들었습니다.

FACT → MECHANISM → CONSENSUS → SCENARIO → FORECAST → VERIFICATION

## Phase 0 감사 결과 (2026-10-16)

| 항목 | 확인 결과 | 근거 |
|---|---|---|
| GitHub `yubinxe/Gukjeong` | 커밋 0건(빈 저장소) — 운영 소스 아님 | `git clone` 결과 |
| 운영 배포 | `dpl_ByWiWg73rWZVmLmnLUPgS4y275Ng` · source `cli` · type LAMBDAS · framework 없음 · 지역 iad1 · Node 24.x | Vercel API(get_deployment·get_project) |
| 배포 소스 파일 | Vercel 파일 API 404 — 이 세션 권한으로 회수 불가 | list_deployment_files |
| 운영 화면 직접 확인 | 실행 환경 네트워크 정책이 `*.vercel.app` 차단 | agent proxy connect_rejected |
| 기존 구조(공개 정보) | 정적 프론트 + Vercel 서버리스 함수, 공개 뉴스 RSS·시세 수집, CDN 20분 캐시 + stale-while-revalidate, 실패 시 스냅샷 대체, 외부 라이브러리 0 | 포트폴리오 작업 카드(작성자 기록) |

→ 수집·정규화·클러스터 코드를 볼 수 없어 **뉴스 클러스터 연결은 미구현**. 모듈은 `clusterKeys`(이슈별 키워드)를 갖고 있어 운영 소스의 클러스터 출력에 붙일 자리를 마련해 두었습니다.

## 구성

```
outlook/
  data/nps-rebalancing-2026.json   이슈·근거 원장·기전·가설·시나리오·예측 원장(실증 사례)
  data/index.mjs                   이슈 레지스트리
  lib/engine.mjs                   선별 점수·스키마 검증·확률 정책·회계 정합성·사후 재구성(의존성 0, 브라우저/Node 공용)
  index.html · outlook.js · outlook.css   오늘의 분기점 목록 + 상세(A–H) 화면
  entry.js                         홈 진입 위젯(기존 홈에 2줄 추가)
api/outlook/issues.mjs             GET 목록·상세·view·asOf (읽기 전용, 캐시)
api/outlook/forecast-performance.mjs   판정 완료 예측 집계(표본 수·기간 동반)
test/outlook.test.mjs              10개 테스트
```

## 운영 소스에 붙이는 방법 (PC에서)

1. 운영 소스 폴더(현재 `vercel deploy`를 실행하는 곳)에 `outlook/`, `api/outlook/`, `test/outlook.test.mjs`를 복사.
2. 운영 소스의 `package.json`이 `"type": "module"`이 아니어도 동작하도록 함수·모듈은 `.mjs`로 작성됨. JSON import attributes(`with { type: "json" }`) 사용 → Node 20.10+ (프로젝트 설정 24.x 충족).
3. 홈 HTML의 핵심 콘텐츠 아래(첫 화면을 밀어내지 않는 위치)에:
   ```html
   <section id="outlook-entry" aria-label="오늘의 분기점"></section>
   <script type="module" src="/outlook/entry.js"></script>
   ```
4. `node --test test/outlook.test.mjs` 통과 확인 → **Preview 배포**(`vercel deploy`, `--prod` 없이)로 확인 → 승인 후 프로덕션.

## 분석 원칙(코드로 강제)

- 근거 없는 수치 금지: 모든 근거에 URL·발행일·기준일·단위·검증 상태·출처 경로. 테스트가 누락을 실패로 처리.
- 확률: 정책 A(검증 모형)만 퍼센트 허용, 모델 종류·학습기간·표본·백테스트·기준모형·보정 기록이 없으면 거부, 기준모형보다 나쁘면 거부. 현재 사례는 정책 C(정성).
- 사후 재구성: `asOf` 이후 **발행된** 자료는 숨김(사건 날짜가 아니라 공개 날짜 기준). 당시 실제 예측 기록과 분리 표시.
- 컨센서스: 기관 원문이 없으면 "없음"으로 표시. 재인용 보도는 원천 하나로 셈.
- 비용: 페이지 요청은 저장된 분석만 읽음 — LLM·외부 수집을 일으키지 않음.

## 로컬 실행

```
npm test
python3 -m http.server 8800   # http://localhost:8800/outlook/  (API 없이 정적 JSON 으로 동작)
```
