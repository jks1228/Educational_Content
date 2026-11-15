import type { NextConfig } from 'next'

// 정적 내보내기 (PRD 12장, docs/1b-design.md): 서버 없이 out/ 폴더만 올리면 되게
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // 개발 서버 화면 왼쪽 아래 Next.js 표시를 끔 (스크린샷·화면 확인이 프로토타입과 같게)
  devIndicators: false,
  // 저장소 상위 폴더의 package-lock.json 을 작업 공간 뿌리로 잘못 잡지 않게
  outputFileTracingRoot: import.meta.dirname
}

export default config
