# 1-B 설계: Next.js 정적 웹앱 (문서만, 패키지 설치 전)

aeb2945f 단계 E. ROADMAP 1-B(Next.js App Router·정적 내보내기·TypeScript·Tailwind, PRD 12장)를 지금 프로토타입에서 옮기는 방법. **패키지는 아직 설치하지 않았다.** 설치가 필요한 시점과 목록은 맨 아래 "승인 요청"에 있다.

작성: 2026-11-15 · 기준 커밋: b0b91bc 이후 작업 트리

## 1. 무엇을 옮기고 무엇을 남기나

| 지금(프로토타입) | 1-B에서 | 이유 |
|---|---|---|
| 학생 화면 `design/prototype/` (app.js·index.html) | **Next.js 정적 웹앱으로 옮김** | 1-B 목표 |
| 추천 API `/api/recs` (browser-sync 미들웨어) | **빌드할 때 미리 계산한 JSON 파일**로 바꿈 | 정적 내보내기에는 서버가 없음 |
| 이미지 중계 `/api/img` | 없어짐 → 아래 2-3 결정 필요 | 서버가 없음 |
| 후보 찾기·검수·통계(`/api/collect`·`review`·`sync`·`stats`, `design/admin/`) | **로컬 미리보기 서버에 그대로 남김** | 키·할당량을 쓰는 내부 도구. 공개 사이트에 넣지 않음(1-C 보호 원칙) |
| 데이터 `data/curriculum.json`·`sources.json`·`recommendations.json` | 그대로 원본. 빌드가 읽음 | 데이터로 규칙을 읽기(R-3) |

## 2. 핵심 설계

### 2-1. 추천을 빌드 때 미리 계산

- `server/api.cjs`의 `handleRecs`에서 계산 부분만 떼어 **순수 함수 `computeRecs(params, data)`** 로 만든다(요청·응답과 무관). 미리보기 서버와 빌드 스크립트가 같은 함수를 쓴다 → 규칙이 한 곳에만 있다.
- 빌드 스크립트 `web/scripts/build-recs.mjs`가 보이는 과목·단원마다 `web/public/recs/<과목 id>/<단원 번호>.json`을 만든다. 각 파일에는 여유 후보(영상·수능 대비·책 각 최대 8개)와 화면이 거를 때 쓰는 값(이 단원 전용 `forUnit`, 채널 id, 책 시리즈 열쇠, 책 학년 표시, '예전 교육과정 강의')을 넣는다.
- **학습 목적·학년은 화면에서 거른다.** 수능 대비 강의는 목적이 '수능 대비'·'둘 다'일 때만 보이고, 중학 국어·영어 책은 학년 표시로 거른다. 그래서 파일 수는 과목×단원만큼(지금 약 180개 + 과목 전체 47개)이고, 목적·학년마다 따로 만들지 않는다.
- '모두 자신 있음'처럼 과목 전체를 보여 줄 때는 고른 과목들의 `*.json`을 화면에서 합친다.
- 크기: 승인 원본은 4.4MB지만 단원 파일은 각 수 KB라 첫 화면이 가볍다. 성적 값은 어디에도 보내지 않는다(파일을 받기만 함).

### 2-2. 수준 계산·추천 규칙

- `app.js`의 수준 계산(점수·성취도·등급 → 상/중/하)과 방향표(약함·보통 × 수준 → 강의·책 유형)를 `web/lib/rules.ts`로 옮긴다. README 표가 기준이다.
- 단위 테스트는 **Node 24의 TypeScript 바로 실행(타입 지우기)** 과 지금처럼 `node --test`로 돌린다 → 테스트용 패키지가 따로 필요 없다. ROADMAP 완료 기준인 "학년 × 입력 방식 × 학습 목적 × 6칸 × 모두 자신 있음" 전부를 표로 만들어 돌린다.

### 2-3. 표지·썸네일 (결정 필요)

정적 사이트에는 이미지 중계가 없다. 선택지:

| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| **A (권장)** | 학생 브라우저가 YouTube·카카오 이미지 주소를 바로 받음. `referrerpolicy="no-referrer"`, `loading="lazy"`, 자리표시 표지는 빌드 때 지문으로 걸러 `noCover` 표시 | 단순, 약관 문제 없음 | 학생 브라우저가 그 이미지 서버에 접속함(어떤 페이지에서 왔는지는 안 보냄). 개인정보 고지에 한 줄 |
| B | 빌드 때 이미지를 내려받아 함께 배포 | 외부 접속 없음 | 남의 이미지를 복사해 배포 — 약관·저작권 검토 필요 |
| C | 썸네일 없이 아이콘만 | 외부 접속 없음 | 고르기 어려워짐 |

### 2-4. 폴더 구조

프로토타입은 그대로 두고 `web/`에 새 앱을 만든다(패키지도 `web/package.json`에 따로).

```
web/
  app/                 화면 (App Router, 'use client' 화면 하나 + 단계별 컴포넌트)
    layout.tsx         글꼴 스택·색 토큰·skip link
    page.tsx           1~5단계 (지금 해시 주소 #/info … #/recommend 그대로)
  components/          SubjectTabs, RecKindTabs, ItemCard, ScoreField …
  lib/
    rules.ts           수준 계산·방향표 (README 표)
    recs.ts            화면 거르기: 목적·학년·채널 분산·시리즈 중복 제거·대체 안내
    curriculum.ts      curriculum.json 읽기 (빌드 때 복사)
  scripts/build-recs.mjs   computeRecs로 public/recs/*.json 생성
  public/recs/         (빌드 산출물, 커밋 안 함)
  tests/               rules·recs 단위 테스트 (node --test)
  next.config.ts       output: 'export'
```

- 디자인 기준(색 토큰, 글씨 크기, 탭, 카드, 움직임·reduced-motion)은 `design/prototype/index.html`의 CSS를 Tailwind 테마(색·글꼴·크기)와 몇 개의 컴포넌트 클래스로 옮긴다. 화면 모양은 지금 스크린샷(`design/screenshots/v3/`)과 같게 만든다.
- 브라우저 확인은 지금 쓰는 Playwright(MCP)로 대표 사용 상황 1~3을 휴대폰·PC 크기에서 끝까지 돌린다.

### 2-5. 옮기는 순서

1. (승인 후) `web/` 만들기, 패키지 설치, 빈 화면이 정적 내보내기로 나오는지
2. `computeRecs` 떼어 내기 → 미리보기 서버가 같은 결과를 내는지 기존 `npm test`로 확인
3. `build-recs` → JSON 파일 생성, 파일 수·크기 확인
4. `rules.ts` + 단위 테스트(README 모든 경우)
5. 화면 1~5단계 옮기기, 프로토타입 스크린샷과 나란히 비교
6. 개인정보 고지·만족도 버튼(Q-6 결정 전이면 지표 수집은 끔)
7. Playwright 흐름 확인, 성적 값이 밖으로 나가지 않는지(네트워크 요청 목록) 확인

## 3. 1-B 전에 사용자 결정이 필요한 것

- **Q-6** 익명 집계 분석 도구(쓰지 않으면 지표 수집 없이 만든다)
- **2-3 표지·썸네일** A/B/C
- **Q-10** 저장소가 GitHub에 올라가 있으므로, 공개 저장소라면 코드 라이선스
- **패키지 설치 승인**(아래)

## 4. 승인 요청: 패키지 설치

- **시점:** 2-5의 1번(`web/` 만들 때). 그 전까지는 이 문서와 `computeRecs` 떼어 내기(패키지 없이 가능)만 한다.
- **위치:** `web/package.json` (프로토타입 `package.json`은 그대로)
- **목록:** 버전은 설치 직전에 `npm view <이름> time`으로 확인해 **배포 2주 이상 지난 버전 중 최신을 정확한 번호로 고정**한다(`^` 없이). 아래 숫자는 지금 알고 있는 후보이고, 설치 전에 다시 보고한다.

| 패키지 | 용도 | 후보 버전 |
|---|---|---|
| next | 앱 틀, 정적 내보내기 | 15.3.x (16이 나왔으면 안정판 확인 후 보고) |
| react, react-dom | 화면 | 19.1.x |
| typescript | 타입 검사 | 5.8.x |
| @types/react, @types/react-dom, @types/node | 타입 | react·node 버전에 맞춤 |
| tailwindcss, @tailwindcss/postcss, postcss | 스타일 (ROADMAP 지정) | 4.1.x / 4.1.x / 8.5.x |

- **넣지 않는 것:** 테스트 프레임워크(node --test로 충분), 상태 관리·UI 라이브러리, 분석 도구(Q-6 전), 웹폰트(시스템 글꼴 사용).
- 선택(필요하면 따로 승인): `eslint` + `eslint-config-next`(코드 검사), `@playwright/test`(CI에서 브라우저 확인을 돌릴 때).

## 5. 진행 상황 (2026-11-15)

- **설치:** web/package.json 10개 정확한 버전(next 16.4.3, react·react-dom 19.3.1, typescript 6.0.3 — 7은 기존 컴파일러 API가 없어 제외, @types/node 24.19.2 — Node 24에 맞춤, tailwindcss·@tailwindcss/postcss 4.3.3, postcss 8.5.32, @types/react·react-dom 19.3.0).
- **computeRecs:** server/api.cjs 에서 떼어 냄. 전·후 350가지 응답 바이트 동일.
- **빌드 준비(scripts/build-recs.mjs):** 47과목 × (과목 전체 + 단원) 225개 JSON, curriculum.json·아이콘 복사, 책 표지 지문으로 자리표시 표지 `noCover`(지문은 data/youtube-cache/cover-hash.json 에 남김).
- **lib/rules.ts + tests/rules.test.ts:** README 모든 경우(학년 × 입력 방식 × 학습 목적 × 6칸 × 모두 자신 있음) 단위 테스트 8개 통과.
- **lib/recs.ts:** 목적·학년 거르기, 과목 탭 안 중복 제거·채널 분산, 같은 추천 카드 합치기(프로토타입과 같은 규칙).
- **app/Diagnosis.tsx:** 1~5단계 화면. 마크업·클래스를 프로토타입과 같게 하고 스타일은 design/prototype/index.html 의 `<style>`을 그대로 옮긴 app/screen.css(어긋나면 루트 npm test가 알려 줌). Tailwind는 preflight 없이 테마·유틸리티만.
- **확인:** next dev -p 3001 -H 127.0.0.1(로컬만)에서 1440·360 흐름 끝까지(빈 입력 오류·초점, 단계 이동 초점, 수준, 전체 탭 방향키, 카드 합치기, 가로 넘침 없음, 페이지 오류 0), 정적 빌드 성공. 스크린샷 design/screenshots/v3/31-web-*.
- **알아 둘 것:** 프로젝트가 /mnt/c(윈도우 드라이브)에 있어 next dev가 파일 변경을 감지하지 못할 때가 있음 → CSS·설정을 바꾸면 개발 서버를 다시 시작.
- **랜딩·주소:** 랜딩은 `/`(design/mockups/landing.html 을 옮김, 스타일은 landing.css 로 랜딩에서만), 진단은 `/start/`(screen.css 는 진단에서만 — 두 화면의 클래스 이름이 겹쳐서). 1단계 '뒤로'는 랜딩으로. 랜딩 개인정보 안내에 '썸네일·표지는 YouTube·카카오에서 바로 불러오고 어느 화면에서 왔는지는 보내지 않음' 한 문장 추가, '무료 강의와 교재(EBS·시중 자습서·개념서)'로 문구 정정(목업도).
- **대표 사용 상황 확인(2026-11-15, 1440):** ① 중2 수학 68점·일차함수 약함 → 수준 하, '개념 기초 강의, 쉬운 개념서', 영상 3·책 2 ② 고1 내신 대비 국어 내신 3등급·문법 약함 → 수준 중(5등급제), '개념 정리 강의, 유형별 문제집', 영상 3·책 2 ③ 고3 둘 다 내신 2·모의 4·영어 독해 약함 → 수준 중(낮은 쪽), '개념 정리 강의, 유형별 문제집', 영상 3·책 2 ④ 항목 숨기기(3 → 2, 초점은 '다시 보기') 뒤 인쇄 화면: 탭·버튼·사이드 숨김, 영상·수능 대비·책 묶음 모두 펼침.
- **네트워크 확인:** 위 흐름의 요청 122개 — POST 0, 로컬은 페이지·/_next·아이콘·/data/curriculum.json·/recs/*.json(GET)만, 외부는 i.ytimg.com 11·search1.kakaocdn.net 6(썸네일·표지)이며 referer 0, 주소·본문 어디에도 성적 값 없음.
- **시나리오에서 찾아 고친 것:** 고3 영어Ⅰ 수능 대비에 EBSi '2024학년도 고3 6월 모의평가 해설'(국어부터 전 과목이 섞인 재생목록)이 나옴 → 과목 이름 없는 전 과목 시험 해설 재생목록 7건과 국어 과목에 붙은 영어 독해 교재 강의 2건 제외, 수집 규칙(`mixedExamPlaylist`) 추가.
- **남은 것:** 사용성 확인(1-C, 보호자 동의 등 진행 방식 결정 필요), 배포 플랫폼(Q-8), 연락처(Q-9), Umami 계정 연결. 브라우저 흐름 확인은 지금 MCP로 수동(@playwright/test는 넣지 않기로 함).
