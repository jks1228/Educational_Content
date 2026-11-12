# 목업 미리보기 (npm run dev)

디자인 목업(`design/` 폴더)을 브라우저로 바로 보고, 파일을 고치면 저절로 새로고침되게 하는 개발용 서버입니다. 실제 앱(Next.js, ROADMAP 1-B)은 아직 아닙니다.

## 실행
```bash
npm ci        # 처음 한 번만 (package-lock.json 그대로 설치)
npm run dev
```
그다음 Windows 브라우저에서 **http://localhost:3000** 을 엽니다. 랜딩 목업으로 바로 이동합니다.
3000번을 다른 프로그램이 쓰고 있으면 3001처럼 다음 번호로 바뀝니다. 그때는 **터미널에 찍힌 `Local:` 주소**를 여세요 (아래 표의 3000도 그 번호로 바꿔 읽으면 됩니다).

| 주소 | 화면 |
|------|------|
| http://localhost:3000/mockups/landing.html | 랜딩 (시작 화면) |
| http://localhost:3000/mockups/index.html | 진단 화면 S1~S5 |
| http://localhost:3000/mockups/icons-motion.html | 아이콘·모션 시트 |

- `design/` 안의 파일을 저장하면 열린 브라우저가 자동으로 새로고침됩니다.
- 끄기: 서버를 켠 터미널에서 `Ctrl + C`.
- 개발 팀(dev-build)이 대신 켜 둔 서버는 사용자 터미널에 보이지 않습니다. 그 서버를 끄려면 operator에게 "미리보기 서버 꺼 줘"라고 요청하세요. 직접 `npm run dev`를 켜고 싶은데 3000번이 이미 쓰이고 있다면, 위 안내대로 다음 번호 주소로 열립니다.

## 설정 요약 (`bs-config.cjs`)
| 항목 | 값 | 이유 |
|------|-----|------|
| 도구 | browser-sync **3.0.4** (버전 고정, 개발용 설치) | 정적 파일 서버 + 자동 새로고침을 한 번에 |
| 띄우는 폴더 | `design/` | 목업, 아이콘, 스크린샷 |
| 주소 | `localhost:3000` (사용 중이면 다음 번호) | 이 컴퓨터 안에서만 열림. 같은 와이파이의 다른 기기에서는 접속 불가 |
| 변경 감지 | 0.5초마다 확인(polling) | WSL의 `/mnt/c` 폴더는 Windows 편집기로 바꾼 내용을 바로 알아채지 못할 때가 있어서 |
| 꺼 둔 기능 | 자동으로 브라우저 열기, 화면 알림, 관리 화면(ui), 여러 기기 동기화(ghostMode), 외부 연결 확인(online) | 필요 없고, 바깥으로 나가는 연결을 줄이기 위해 |

## 확인한 것 (2026-11-10)
- `npm run dev` → `127.0.0.1:3000`에서만 대기 (`ss`로 확인). `http://localhost:3000/` 은 랜딩으로 302 이동.
- Windows 쪽(PowerShell)에서 `http://localhost:3000/mockups/landing.html` 요청 → 200.
- 목업 파일의 수정 시각만 바꿨을 때(`touch`) 서버가 "Reloading Browsers"를 출력하고, 열려 있던 Playwright 브라우저가 실제로 새로고침됨.
- Windows 편집기(VS Code)로 저장했을 때의 감지는 직접 확인하지 못했습니다. polling 방식이라 감지될 것으로 보지만, 안 되면 알려 주세요.
