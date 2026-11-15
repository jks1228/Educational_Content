import type { Metadata } from 'next'
import './globals.css'
import './motion.css'
// 화면 스타일은 화면마다: 랜딩(/)은 landing.css, 진단(/start/)은 screen.css (클래스 이름이 겹쳐서 따로 불러옴)

export const metadata: Metadata = {
  title: '공부길',
  description: '성적과 약하다고 느끼는 단원을 체크하면, 수준에 맞는 무료 강의와 책을 찾아 드려요.',
  // 썸네일은 학생 브라우저가 YouTube·카카오에서 바로 받음 → 어떤 페이지에서 왔는지는 보내지 않음 (사용자 결정 2026-11-15)
  referrer: 'no-referrer',
  icons: { icon: { url: '/icons/favicon.svg', type: 'image/svg+xml' } }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
