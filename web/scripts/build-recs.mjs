// 1-B 빌드: 과목·단원마다 추천 JSON을 미리 만든다 (docs/1b-design.md 2-1)
// 계산은 미리보기 서버와 같은 computeRecs(server/api.cjs) → 규칙이 한 곳에만 있음
// 목적·학년은 화면에서 거르므로 여기서는 넉넉히(수능 대비 포함, 학년 거르기 없음, 최대 8개) 만든다
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..', '..')
const OUT = join(here, '..', 'public', 'recs')
const require = createRequire(import.meta.url)
const H = require(join(ROOT, 'server', 'api.cjs')).helpers

const read = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'))
let chStats = {}
try { chStats = JSON.parse(readFileSync(join(ROOT, 'data', 'youtube-cache', 'channel-stats.json'), 'utf8')).channels || {} } catch {}
const data = { src: read('sources.json'), curriculum: read('curriculum.json'), items: read('recommendations.json').items, chStats }

// 과목 id → 학교급 (보이는 과목만)
const schoolOf = {}
for (const [grade, subjects] of Object.entries(data.curriculum.offer)) {
  for (const ids of Object.values(subjects)) for (const id of ids) schoolOf[id] = grade[0] === 'm' ? 'middle' : 'high'
}

// 화면이 거를 때 쓰는 값: 책은 수능 교재인지, 중학 책은 맞는 학년
const forScreen = (r) => ({
  videos: r.videos,
  examVideos: r.examVideos,
  books: r.books.map((b) => ({ ...b, examBook: H.isExamBook(b.title), okGrades: ['1', '2', '3'].filter((n) => H.bookGradeOk(b.title, n)) }))
})

// 화면이 쓰는 과목·단원 목록과 아이콘을 public/ 으로 (원본은 data/·design/icons/, 빌드 산출물이라 커밋 안 함)
const PUB = join(here, '..', 'public')
mkdirSync(join(PUB, 'data'), { recursive: true })
mkdirSync(join(PUB, 'icons'), { recursive: true })
copyFileSync(join(ROOT, 'data', 'curriculum.json'), join(PUB, 'data', 'curriculum.json'))
for (const f of ['icons.svg', 'favicon.svg']) copyFileSync(join(ROOT, 'design', 'icons', f), join(PUB, 'icons', f))

// 서점 '상품이미지 없음' 자리표시 표지 거르기 (썸네일 A안: 브라우저가 직접 받으므로 빌드 때 그림 지문으로 표시, 사용자 결정 2026-11-15)
// 받은 지문은 data/youtube-cache/cover-hash.json 에 남겨 다음 빌드에서 다시 받지 않음. 인터넷이 안 되면 건너뜀
const HASH_FILE = join(ROOT, 'data', 'youtube-cache', 'cover-hash.json')
let coverHash = {}
try { coverHash = JSON.parse(readFileSync(HASH_FILE, 'utf8')) } catch {}
const placeholders = new Set((data.src.images && data.src.images.placeholderHashes) || [])
async function hashCovers (urls) {
  const todo = urls.filter((u) => !coverHash[u])
  let i = 0
  const worker = async () => {
    while (i < todo.length) {
      const u = todo[i++]
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(15000) })
        if (r.ok) coverHash[u] = createHash('sha1').update(Buffer.from(await r.arrayBuffer())).digest('hex')
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  if (todo.length) { mkdirSync(dirname(HASH_FILE), { recursive: true }); writeFileSync(HASH_FILE, JSON.stringify(coverHash)) }
  return todo.length
}

rmSync(OUT, { recursive: true, force: true })
let files = 0, bytes = 0
const pending = []
for (const course of data.curriculum.courses) {
  if (course.hidden || !schoolOf[course.id]) continue
  const dir = join(OUT, course.id)
  mkdirSync(dir, { recursive: true })
  // 'all' = 과목 전체, 0..n = 단원 순서 (단원 이름 대신 번호로 파일 이름을 짧고 안전하게)
  const units = [['all', '*']].concat(course.units.map((u, i) => [String(i), u]))
  for (const [name, unit] of units) {
    const r = H.computeRecs({ courses: [course.id], unit, school: schoolOf[course.id], purpose: 'both', grade: '', max: 8 }, data)
    pending.push({ file: join(dir, name + '.json'), head: { course: course.id, unit }, body: forScreen(r) })
  }
}
// 책 표지 지문을 한꺼번에 확인한 뒤 자리표시면 noCover
const bookCovers = [...new Set(pending.flatMap((p) => p.body.books.map((b) => b.thumbnail)).filter((u) => /^https:\/\//.test(u || '')))]
const fetched = await hashCovers(bookCovers)
let noCover = 0
for (const p of pending) {
  for (const b of p.body.books) if (placeholders.has(coverHash[b.thumbnail])) { b.noCover = true; noCover += 1 }
  const body = JSON.stringify({ ...p.head, ...p.body })
  writeFileSync(p.file, body)
  files += 1; bytes += Buffer.byteLength(body)
}
console.log(`recs: ${files}개 파일, ${(bytes / 1024).toFixed(0)}KB → web/public/recs/ · 표지 지문 새로 받음 ${fetched}, 자리표시 표지 ${noCover}곳`)
