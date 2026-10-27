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
npm install
npm test
npm run dev                   # http://localhost:8800/briefing/ · /outlook/  (없는 경로는 운영 사이트로 넘김)
DEV_FAKE_AI=1 npm run dev     # API 키 없이 AI 화면 상태 점검(가짜 해석·가짜 답, 화면 검수 전용)
```

---

# 오늘의 브리핑 (2026-10-27)

`/briefing/` — 그날의 사안·시세·입법예고·해외 보도를 한 지면에 정리하고, AI 해석과 질의응답을 더한 화면. 위쪽 탭 줄·아래 탭 막대·전체 메뉴에서 들어간다.

재확인(2026-10-27): 운영 화면·정적 자산(`index.html`·`assets/app.js`·`assets/style.css`)·공개 API(`/api/dashboard` 등)는 이제 이 환경에서 읽힌다. 서버 함수 소스는 여전히 볼 수 없어, 브리핑은 **운영 `/api/dashboard` 출력(이미 수집·묶음·집계된 결과)을 원천으로** 삼는다. 새 수집을 일으키지 않는다.

```
briefing/
  index.html · briefing.css · briefing.js   채널(소식 흐름) + 브리핑 도우미(대화) — 사이트 style.css 토큰 위에 얹음
  lib/compose.mjs                           사실 층 조립 · 모델 입력(digest) · 수치 근거 검사 · 해석 정리 · 소식 찾기 (브라우저/Node 공용, 의존성 0)
api/briefing/
  today.mjs     GET  오늘의 브리핑(사실 + 해석), ?facts=1 은 사실만
  chat.mjs      POST 대화 → text/event-stream (meta · delta · done · error)
  _lib.mjs      원천 로딩·메모, Claude 호출, 프롬프트, 대화 정리, 요청 제한 (밑줄 파일 → 함수로 노출 안 됨)
scripts/integrate-briefing.mjs   운영 index.html·app.js 에 진입점 3곳을 넣는 패치(멱등)
scripts/dev.mjs                  로컬 서버
test/briefing.test.mjs · briefing-sdk.test.mjs   22개(사실 층·수치 검사·메모·API·SSE·SDK 실제 직렬화·통합 패치)
```

## 화면

- 채널(텔레그램 채널 문법): 채널 머리(판·기준 시각·기사 수) → 고정 메시지(오늘의 한 문장) → 날짜 알약 → 글. 글마다 원문 링크, 보도 흐름(첫 보도→후속), 언론사 수, `묻기`(텔레그램 답장처럼 인용해 질문), `공유`(iOS 공유 시트).
- 순서: 오늘의 한 문장·3줄 → 시세(20거래일 선) → 지금 확산 중 → 오늘의 연결 → 이어지는 사안 → 입법예고·세계가 본 한국·거시 지표.
- 브리핑 도우미(iOS 문법): 넓은 화면은 오른쪽 고정 창, 휴대폰은 아래에서 올라오는 시트(뒤로 가기·아래로 끌어 닫기, 화상 키보드 높이 추적). 답은 글자 단위로 흐르고, 근거 소식은 `S3` 칩 → 누르면 해당 글로 이동. 멈춤·새 대화·추천 질문. 대화는 그날 탭 안에서만 보관(sessionStorage).
- `듣기`: 기기 내 음성 합성(ko-KR)으로 오늘의 브리핑 낭독.
- 해석이 2.5초 안에 오지 않으면 사실 층부터 그리고, 도착하면 채운다. 브리핑 함수가 없는 배포에서는 `/api/dashboard`로 직접 사실 층을 만든다.

## AI 원칙(코드로 강제)

- 모델: `claude-opus-5-5`(Claude API, 공식 SDK). 해석은 effort `medium` + 구조화 출력(JSON 스키마, S번호 열거), 대화는 effort `low` + 스트리밍. 둘 다 서버측 대체 모델(`fallbacks: "default"`, `server-side-fallback-2026-07-01`)을 켜 두어 안전 분류기 거절 시 같은 호출 안에서 다른 모델이 이어받는다.
- 수치: 해석·답에 나온 숫자를 모델에 준 자료와 대조. 해석은 근거 없는 수치가 든 문장을 **싣지 않고** 개수를 공개, 대화는 답 아래에 "확인되지 않은 수치"로 표시.
- 사실/해석 분리: 해석 문장에는 모두 `해석 · AI` 표지. 정당·인물 평가, 매수·매도 권유 금지(프롬프트). 기사 문장은 자료이지 지시가 아님(프롬프트 주입 방어).
- 비용 상한: 해석은 판(새벽·아침·오후·저녁)이 바뀌거나 TTL(30분)이 지나고 상위 6개 사안 구성이 달라졌을 때만 새로 씀(인스턴스 메모 + CDN `s-maxage=600, stale-while-revalidate=3600`). 대화는 오늘의 자료 블록에 프롬프트 캐시 지점, 질문 1,200자·대화 9,000자·`max_tokens` 8,000, IP당 5분 10회.
- 원천 주소는 요청 Host 헤더로 만들지 않음(위조 Host 로 다른 서버의 글을 모델에 먹이는 것 차단). 대화 API 는 같은 출처 요청만.

## 운영에 붙이는 방법 (PC에서)

1. 운영 소스 폴더에 `briefing/`, `api/briefing/`을 복사하고 `package.json` 에 `"@anthropic-ai/sdk": "^1.3.0"` 의존성을 더한다(운영에서 첫 외부 라이브러리 — 서버 함수에서만 쓰고 화면에는 실리지 않음).
2. `node scripts/integrate-briefing.mjs <운영 소스 폴더> --dry` 로 확인 → 옵션 없이 다시 실행해 적용.
   위쪽 탭 줄·전체 메뉴에 '오늘의 브리핑'을 넣고, 아래 탭 막대는 iOS 권장 다섯 칸을 지키려고 '거시경제' 칸을 '브리핑'으로 바꾼다(거시경제는 위쪽 탭 줄·더보기에 그대로). 원래대로 여섯 칸을 원하면 탭 막대 부분만 되돌리고 `style.css`의 `repeat(5, 1fr)`을 6으로.
3. Vercel 환경 변수: `ANTHROPIC_API_KEY`(필수, 없으면 AI 없이 사실 층 + 소식 찾기로 동작). 선택: `BRIEFING_MODEL`, `BRIEFING_EFFORT`, `BRIEFING_CHAT_EFFORT`, `BRIEFING_INSIGHT_TTL_MIN`, `BRIEFING_CHAT_LIMIT`, `BRIEFING_SOURCE_URL`, `BRIEFING_AI=off`(즉시 끄기).
4. 권장: Vercel Firewall 에 `/api/briefing/chat` 요청 제한 규칙, Anthropic 콘솔 작업공간 지출 한도. 해석 생성은 수십 초 걸릴 수 있으니 함수 최대 실행 시간이 60초 이상인지 확인.
5. `npm test` → Preview 배포로 확인 → 승인 후 프로덕션.
