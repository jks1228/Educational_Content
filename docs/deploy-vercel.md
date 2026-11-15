# Vercel 배포 준비 (사용자 결정 2026-11-15: Q-8 = Vercel)

공부길 1-B(`web/`, Next.js 정적 웹앱)를 Vercel에 올리기 위한 준비와 사용자가 할 일. **아직 배포하지 않았고, 계정·프로젝트 연결도 하지 않았다.**

## 1. 무엇이 올라가나

| 올라감 (공개 사이트) | 올라가지 않음 |
|---|---|
| 랜딩 `/`, 진단 `/start/` (정적 HTML·JS·CSS) | 미리보기 서버 `server/api.cjs` 와 `/api/*` (후보 찾기·검수·통계 — 키를 쓰는 로컬 도구) |
| 단원별 추천 `/recs/*.json`, 과목 목록 `/data/curriculum.json`, 아이콘 | 관리 화면 `design/admin/`, 프로토타입 `design/prototype/` |
| | `.env.local` (YouTube·카카오 키) — 빌드에 쓰지 않음 |

- 추천은 빌드할 때 `data/recommendations.json` 의 **승인된 항목**에서 미리 계산한다(`web/scripts/build-recs.mjs`, 미리보기 서버와 같은 `computeRecs`). 사이트는 서버 없이 이 파일만 읽는다.
- 강의 썸네일·책 표지는 학생 브라우저가 YouTube·카카오에서 바로 받는다(어느 화면에서 왔는지는 보내지 않음 — `referrer: no-referrer`, 응답 헤더 `Referrer-Policy: no-referrer`).

## 2. 준비해 둔 설정 (`web/vercel.json`, `web/package.json`)

| 항목 | 값 |
|---|---|
| Root Directory (Vercel 프로젝트 설정에서 입력) | `web` |
| Framework | Next.js |
| Install Command | `npm ci` |
| Build Command | `npm run build` (= 추천 JSON·과목 목록·아이콘을 `data/`·`design/icons/`에서 다시 만든 뒤 `next build`) |
| Output Directory | `out` (정적 내보내기) |
| Node.js | 24.x (`engines`) |
| 응답 헤더 | `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(), microphone=(), geolocation=()` |

- `web/public/recs`·`data`·`icons` 는 git에 올리지 않는다(.gitignore). Vercel 빌드 때 위 Build Command가 다시 만든다.
- 빌드 스크립트는 저장소의 `data/`·`server/`·`design/icons/` 를 읽는다(Root Directory `web` 밖). Vercel 프로젝트 설정 **"Include source files outside of the Root Directory in the Build Step"** 이 켜져 있어야 한다(새 프로젝트는 기본으로 켜져 있음).
- 자리표시 표지 거르기를 위해 빌드 때 책 표지(약 270개)를 인터넷에서 받아 지문을 만든다. 받지 못하면 그 표지는 그대로 두고 빌드는 계속된다(화면에서는 못 불러온 표지를 아이콘으로 바꿈).
- **환경 변수는 하나도 넣지 않는다.** 키가 필요한 일은 로컬 미리보기 서버에서만 한다.

## 3. 확인한 것 (2026-11-15)

- 이 저장소를 **깨끗하게 새로 받은 곳**에서 Vercel과 같은 순서(`cd web` → `npm ci` → `npm run build`)로 빌드 성공: 페이지 `/`·`/start`, 추천 파일 225개, 결과물 약 3.2MB.
- 결과물 258개 파일에 API 키 모양 문자열·`.env.local` 의 실제 값·키 이름·이 PC 경로·`/api/` 참조 0건.
- 결과물만 단순 정적 서버로 띄워(서버 코드·`/api` 없음) 랜딩 → 진단 → 추천까지 동작, `/api/` 요청 0·POST 0·오류 응답 0.

## 4. 사용자가 할 일 (순서대로)

1. **GitHub에 최신 커밋 올리기(push)** — Vercel은 GitHub 저장소에서 코드를 받는다. 지금 로컬 `master` 가 GitHub보다 앞서 있으니, 올려도 될 때 요청해 주세요(push는 요청할 때만 함).
2. **Vercel 계정 만들기** — https://vercel.com 에서 "Sign Up" → "Continue with GitHub". 개인 무료 요금제(Hobby)는 **비상업적 개인 사용**만 허용한다(공부길은 비영리 라이선스라 맞음 — 다만 학교·기관 이름으로 운영하면 요금제 조건을 다시 확인).
3. **프로젝트 만들기** — 대시보드 "Add New… → Project" → `Educational_Content` 저장소 "Import".
4. **설정 입력** — "Root Directory" 옆 "Edit" → `web` 선택. Framework는 Next.js로 자동 인식(아니면 직접 선택). Build·Install·Output은 `web/vercel.json` 값을 쓰므로 바꾸지 않음. **Environment Variables는 비워 둠.**
5. **Deploy** 누르기 → 1~3분 뒤 `https://<프로젝트 이름>.vercel.app` 주소가 생김.
6. 주소를 알려 주시면, 배포된 사이트에서 대표 사용 상황·네트워크 확인을 다시 하겠습니다.

## 5. 아직 정하지 않은 것 (1-C 전)

- 사용성 확인 진행 방식, 연락처(Q-9 — 랜딩 하단 '〈연락처〉'), Umami 계정(분석 — 지금은 꺼 둔 자리만 있음).
- 도메인(기본 `*.vercel.app` 로 충분하면 그대로).
- 데이터가 바뀌면(추천 승인·제외) 커밋·push 하면 Vercel이 자동으로 다시 빌드한다.
