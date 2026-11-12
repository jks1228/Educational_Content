// 목업 미리보기 서버 설정 (npm run dev)
// - design/ 폴더를 띄우고, 파일이 바뀌면 브라우저를 자동으로 새로고침합니다.
// - 이 컴퓨터 안에서만 열립니다 (localhost). 다른 기기에서는 접속할 수 없습니다.
// - 경로는 모두 상대 경로입니다 (PC 정보 없음).
// - /api/recs, /api/img, /api/collect, /api/review 는 server/api.cjs 가 처리합니다. 키는 .env.local 에서 서버만 읽습니다.

const apiMiddleware = require('./server/api.cjs')

module.exports = {
  server: {
    baseDir: 'design',
    // 과목·단원 데이터(data/curriculum.json)를 /data/ 주소로도 보여 줍니다 (프로토타입이 읽음)
    routes: { '/data': 'data' },
    // 주소창에 http://localhost:3000 만 치면 랜딩 목업으로 보냅니다
    middleware: [
      function (req, res, next) {
        if (req.url === '/' || req.url === '/index.html') {
          res.writeHead(302, { Location: '/mockups/landing.html' });
          res.end();
          return;
        }
        next();
      },
      apiMiddleware
    ]
  },
  // data/recommendations.json 은 내부 확인 페이지가 승인할 때마다 바뀌므로 감시하지 않음 (화면이 새로고침되지 않게)
  files: ['design/**/*', 'data/curriculum.json', 'data/sources.json'],
  // WSL의 /mnt/c 폴더는 Windows 편집기로 바꾼 내용을 바로 알아채지 못할 때가 있어서
  // 0.5초마다 직접 확인하는 방식(polling)으로 변경을 감지합니다.
  watchOptions: {
    usePolling: true,
    interval: 500,
    ignoreInitial: true
  },
  port: 3000,
  listen: 'localhost',
  open: false,
  notify: false,
  ui: false,
  ghostMode: false,
  online: false,
  reloadDebounce: 200,
  logPrefix: '미리보기'
};
