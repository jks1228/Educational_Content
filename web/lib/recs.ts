// 추천 화면 거르기·묶기 (design/prototype/app.js 와 같은 규칙)
// - 미리 만든 파일(public/recs)은 목적·학년과 상관없이 넉넉히 들어 있음 → 여기서 목적·학년으로 거름
// - 과목 탭 안에서 같은 영상·책(시리즈)은 한 번만, 한 카드에 같은 채널은 2개까지
// - 같은 추천을 공유하는 단원은 카드 하나로 (사용자 요청 2026-11-15)
import type { Purpose, RecFile, RecItem } from './types.ts'

export const MAX_VIDEOS = 3
export const MAX_BOOKS = 2
export type Field = 'videos' | 'examVideos' | 'books'
export type Lists = Record<Field, RecItem[]>

// 과목 id·단원 번호 → 파일 주소. 과목 전체는 'all'
export const recPath = (courseId: string, unitIndex: number | 'all') => '/recs/' + courseId + '/' + unitIndex + '.json'

// 여러 과목 전체(모두 자신 있음 + 과목을 여럿 고름): 과목마다 번갈아 넣고 같은 주소는 한 번
export function mergeFiles(files: RecFile[]): Lists {
  const out: Lists = { videos: [], examVideos: [], books: [] }
  for (const f of ['videos', 'examVideos', 'books'] as Field[]) {
    const seen = new Set<string>()
    const longest = Math.max(0, ...files.map((x) => x[f].length))
    for (let i = 0; i < longest; i++) for (const x of files) {
      const it = x[f][i]
      if (it && !seen.has(it.url)) { seen.add(it.url); out[f].push(it) }
    }
  }
  return out
}

// 목적·학년으로 거르기 (서버 /api/recs 와 같은 결과)
export function filterLists(l: Lists, ctx: { grade: string | null; purpose: Purpose | null; examCourse: boolean }): Lists {
  const high = !!ctx.grade && ctx.grade[0] === 'h'
  const wantsExam = ctx.purpose === 'suneung' || ctx.purpose === 'both'
  return {
    videos: l.videos,
    // 수능 대비 강의: 수능 대비·둘 다 고등학생만
    examVideos: high && wantsExam ? l.examVideos : [],
    books: l.books.filter((b) => {
      // 수능 연계·기출 교재는 수능 대비 학생만 (수능 과목은 예외)
      if (high && !wantsExam && !ctx.examCourse && b.examBook) return false
      // 여러 학년이 같은 과목(중학 국어·영어): 이 학년 표시가 아닌 책은 뺌
      if (ctx.grade && ctx.grade[0] === 'm' && b.okGrades && !b.okGrades.includes(ctx.grade[1])) return false
      return true
    })
  }
}

type Slot = { key: string; title: string }

// 과목 탭 안에서 같은 영상·책은 한 번만. 순서: 이 단원 강의·채널마다 1개 → 같은 채널 2개까지 → 과목 강의 → 나머지
export function dedupe(slots: Slot[], lists: Record<string, Lists>, field: Field, max: number, unitFirst: boolean) {
  const seen: Record<string, string> = {}
  const out: Record<string, RecItem[]> = {}
  for (const s of slots) out[s.key] = []
  const idOf = (it: RecItem) => (it.series ? 'series:' + it.series : it.url)
  const chOf = (it: RecItem) => (it.kind === 'course' ? 'ebsi-course' : it.channelId || it.provider || it.url)
  const take = (onlyUnit: boolean, cap: number) => {
    for (const s of slots) {
      const list = out[s.key]
      for (const it of lists[s.key]?.[field] ?? []) {
        if (list.length >= max || seen[it.url] || seen[idOf(it)] || (onlyUnit && !it.forUnit)) continue
        if (list.filter((x) => chOf(x) === chOf(it)).length >= cap) continue
        seen[it.url] = seen[idOf(it)] = s.title
        list.push(it)
      }
    }
  }
  if (unitFirst) { take(true, 1); take(true, 2); take(false, 1); take(false, 2) }
  take(false, Infinity)
  for (const s of slots) {
    const all = lists[s.key]?.[field] ?? []
    out[s.key].sort((a, b) => (unitFirst ? Number(!!b.forUnit) - Number(!!a.forUnit) : 0) || all.indexOf(a) - all.indexOf(b))
  }
  const notes: Record<string, string> = {}
  for (const s of slots) {
    const first = lists[s.key]?.[field]?.[0]
    if (!out[s.key].length && first) notes[s.key] = seen[first.url] || ''
  }
  return { lists: out, notes }
}

export type Entry<E> = { key: string; entry: E }
export type Card<E> = { id: string; key: string; entries: E[]; items: RecItem[] }

// 같은 추천을 공유하는 단원은 카드 하나로: ① 목록이 똑같은 단원끼리 ② 겹치는 항목은 한 번만 ③ 그래서 빈 카드는 그 항목이 보이는 카드에 합침
export function groupCards<E>(entries: Entry<E>[], lists: Record<string, Lists>, field: Field, max: number, unitFirst: boolean): Card<E>[] {
  type G = Card<E> & { at: string; mergedInto?: G }
  const groups: G[] = []
  const bySig: Record<string, G> = {}
  for (const e of entries) {
    const sig = (lists[e.key]?.[field] ?? []).map((it) => it.url).join('\n')
    if (sig && bySig[sig]) { bySig[sig].entries.push(e.entry); continue }
    const g: G = { id: 'g' + groups.length, key: e.key, entries: [e.entry], items: [], at: '' }
    if (sig) bySig[sig] = g
    groups.push(g)
  }
  const d = dedupe(groups.map((g) => ({ key: g.key, title: g.id })), lists, field, max, unitFirst)
  for (const g of groups) { g.items = d.lists[g.key]; g.at = d.notes[g.key] || '' }
  const byId: Record<string, G> = {}
  for (const g of groups) byId[g.id] = g
  for (const g of groups) {
    if (g.items.length || !g.at || !byId[g.at] || byId[g.at] === g) continue
    let host = byId[g.at]
    while (host.mergedInto) host = host.mergedInto
    host.entries = host.entries.concat(g.entries)
    g.mergedInto = host
  }
  return groups.filter((g) => !g.mergedInto).map(({ id, key, entries, items }) => ({ id, key, entries, items }))
}

// 합친 카드의 책 설명: 첫 단원 기준 문구("문법 단원: 교과서 문법 내용을…")를 묶인 단원 전체로
export function mergedReason(reason: string, first: string, titles: string[]): string {
  const head = first + ' 단원: '
  if (!reason.startsWith(head)) return reason
  return reason.slice(head.length).split(first).join(titles.join('·'))
}

// 대체 안내: 단원 강의가 하나도 없을 때만 '준비하는 동안', 일부만 대체면 몇 개인지. 여러 단원 카드는 같은 추천이라 생략
export function scopeNote(items: RecItem[], hidden: Record<string, boolean>, merged: boolean): string {
  const subst = items.filter((it) => !it.forUnit && !hidden[it.id]).length
  const own = items.filter((it) => it.forUnit && !hidden[it.id]).length
  if (merged || !subst) return ''
  return !own ? '이 단원만 다루는 강의를 준비하는 동안, 같은 과목의 강의를 보여 줘요.' : '이 가운데 ' + subst + '개는 같은 과목의 다른 단원 강의예요.'
}
