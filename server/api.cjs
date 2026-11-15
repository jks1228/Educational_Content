// 미리보기 서버(browser-sync)에 붙는 로컬 엔드포인트 (docs/api-decision.md)
//
// 학생 화면용 (바깥 API를 부르지 않음 → 할당량 0)
//   GET  /api/recs?course=<코스 id[,id…]>&unit=<단원 | *>  → 승인(approved)된 추천만, 추천순
//   GET  /api/img?u=<이미지 주소>                          → 허용 도메인 이미지만 중계 (학생 IP가 바깥으로 안 나감)
// 내부 확인 페이지용 (이 컴퓨터의 미리보기 화면에서만: Origin 검사)
//   POST /api/collect {grade, courseId, unit}             → 허용 채널·출판사에서 후보 찾기 → candidate로 저장
//   POST /api/review  {id, status, reason?}               → 승인 / 제외 / 후보로 되돌리기 (이유는 비면 자동 생성)
//
// 키는 프로젝트 루트 .env.local 에서 서버만 읽고, 응답·로그에 넣지 않음. 새 npm 패키지 없이 Node 내장 fetch만 씀.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.join(__dirname, '..')
const ENV_FILE = path.join(ROOT, '.env.local')
const DATA = {
  curriculum: path.join(ROOT, 'data', 'curriculum.json'),
  sources: path.join(ROOT, 'data', 'sources.json'),
  recs: path.join(ROOT, 'data', 'recommendations.json')
}
const TIMEOUT_MS = 8000
const CACHE_DAY_MS = 24 * 60 * 60 * 1000
const ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000']
// Q-3 승인 흐름: 사용자 [승인] 한 번 (리뷰어 확인 단계 생략, 사용자 결정 2026-11-11)
const STATUSES = ['candidate', 'approved', 'retired']

/* ---------- 파일 ---------- */
function readJson (file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }
let writing = Promise.resolve()
// 쓰기는 하나씩 차례로, 임시 파일에 쓴 뒤 이름 바꾸기 (중간에 끊겨도 파일이 깨지지 않게)
// 한 번 실패해도 그 요청만 실패하고, 다음 쓰기는 이어짐 (리뷰 권장 1)
function writeRecs (mutate) {
  const run = writing.catch(function () {}).then(function () {
    const data = readJson(DATA.recs)
    const out = mutate(data)
    if (typeof out === 'string' && out) return out // 거절(오류 이유)이면 파일을 쓰지 않음
    const tmp = DATA.recs + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
    fs.renameSync(tmp, DATA.recs)
    return out
  })
  writing = run.catch(function () {})
  return run
}

// .env.local 읽기: CRLF 줄 끝(\r)과 따옴표를 떼어 냄. 파일이 없으면 빈 값.
function readKeys () {
  const keys = {}
  let text = ''
  try { text = fs.readFileSync(ENV_FILE, 'utf8') } catch (e) { return keys }
  text.split('\n').forEach(function (line) {
    const clean = line.replace(/\r$/, '').trim()
    if (!clean || clean.startsWith('#')) return
    const eq = clean.indexOf('=')
    if (eq < 1) return
    keys[clean.slice(0, eq).trim()] = clean.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
  })
  return keys
}

/* ---------- 순수 함수 (tests/에서 모의 응답으로 확인) ---------- */
function decodeEntities (s) {
  return String(s || '').trim()
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)) })
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    // 일부 제목은 한글이 자모로 풀린 꼴(NFD)이라 단원·차단어 비교가 안 됨 → 표준 꼴(NFC)로 (확인 2026-11-12, EBSi 등 18건)
    .normalize('NFC')
}

// ISO 8601 길이(PT1H2M3S) → 분
function isoMinutes (iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '')
  if (!m) return 0
  return Math.round((Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) / 60)
}

// 제목 거르기: 쇼츠·홍보 같은 말, 학년이 안 맞는 말
function blocked (title, school, filters) {
  const t = String(title || '').normalize('NFC').toLowerCase()
  if ((filters.titleBlockWords || []).some(function (w) { return t.includes(w.toLowerCase()) })) return true
  return ((filters.gradeBlockWords || {})[school] || []).some(function (w) { return t.includes(w.toLowerCase()) })
}

// 추천순 점수 (docs/api-decision.md "추천순 기준")
//  1) 단원·과목 이름이 제목에 있는가 (단원 +3, 과목 +2)
//  2) 강좌 단위 재생목록 우선 (+2), 강의 수 5개 이상 (+1)
//  3) 긴 강의 (20분 이상 +1)
//  4) 조회수 보조 (0~1)
function rankScore (item, unit, courseName) {
  const t = String(item.title || '')
  let s = 0
  if (unit && t.includes(unit)) s += 3
  if (courseName && t.includes(courseName)) s += 2
  if (item.kind === 'playlist') s += 2 + ((item.itemCount || 0) >= 5 ? 1 : 0)
  if (item.kind === 'video' && (item.durationMin || 0) >= 20) s += 1
  if (item.views) s += Math.min(1, Math.log10(item.views + 1) / 7)
  if (item.kind === 'book' && item.year) s += Math.min(1, Math.max(0, (Number(item.year) - 2015) / 10))
  return Math.round(s * 100) / 100
}

function sortRecs (list) {
  return list.slice().sort(function (a, b) {
    const ra = typeof a.rank === 'number' ? a.rank : 999, rb = typeof b.rank === 'number' ? b.rank : 999
    if (ra !== rb) return ra - rb // 사람이 정한 순서가 있으면 먼저
    if (a.isFree !== b.isFree) return a.isFree ? -1 : 1 // 무료 먼저 (F-4.5)
    return (b.score || 0) - (a.score || 0)
  })
}

// 바꿀 수 있는 상태인가: 후보·승인·제외만 (승인은 [승인] 한 번, 이유는 비어 있으면 자동으로 만듦)
function canSetStatus (item, status) {
  if (STATUSES.indexOf(status) === -1) return 'bad-status'
  return ''
}

// 출판사 정식 이름 (카카오 자료의 '천재교육사'·'미래엔에듀'·'EBS한국교육방송공사' 등 → 화면용, 운영 지적 2026-11-13)
const PUBLISHER_NAMES = { '천재교육사': '천재교육', '미래엔에듀': '미래엔', 'EBS한국교육방송공사': 'EBS', '한국교육방송공사(EBSi)': 'EBS', '한국교육방송공사': 'EBS' }
function pubName (p) {
  const s = String(p || '').trim()
  return PUBLISHER_NAMES[s] || s
}

// 책 종류 (제목에서): 자습서 / 평가문제집 / 문제집 / 개념서 / 교재
function bookType (title) {
  const t = String(title || '')
  if (/자습서/.test(t)) return '자습서'
  if (/평가문제/.test(t)) return '평가문제집'
  if (/문제집|유형|쎈|RPM|\d+제/.test(t)) return '문제집'
  if (/개념|기본서/.test(t)) return '개념서'
  return '교재'
}

// 추천 이유 자동 생성 (F-4.4): 사실만 짧게. 광고·평가 문구(최고, 1등, 강추 등)는 넣지 않음
// 예) "삼각함수 단원 · EBSi 무료 강의 · 59분", "대수 과목 · EBS 교재"
function autoReason (item, courseLabel) {
  const parts = []
  // 책은 과목 단위로 보여 주므로 단원 이름을 쓰지 않음 (다른 단원에도 나오기 때문 — 리뷰 필수 1)
  if (item.kind !== 'book' && item.unit && item.unit !== '*') parts.push(item.unit + ' 단원')
  else if (courseLabel) parts.push(courseLabel + ' 과목')
  if (item.kind === 'book') {
    // 'EBS 교재'는 EBS 책에만. 시중 교재는 출판사 이름 그대로 + 책 종류 (사용자 캡처 2026-11-13: 지학사·미래엔 책에 'EBS 교재'로 나옴)
    const pub = pubName(item.provider)
    if (/EBS|한국교육방송/.test(pub)) parts.push('EBS 교재')
    else parts.push((pub ? pub + ' ' : '') + bookType(item.title))
  } else {
    parts.push(String(item.provider || 'EBS').trim() + ' 무료 강의')
    if (item.kind === 'playlist' && item.itemCount) parts.push(item.itemCount + '강 재생목록')
    if (item.kind === 'video' && item.durationMin) parts.push(item.durationMin + '분')
  }
  return parts.join(' · ')
}

// 이미지 중계 허용: https·허용 호스트이면서, recommendations.json 에 저장된 항목의 썸네일 주소와 정확히 같을 때만.
// (카카오 썸네일 서버는 fname=<아무 주소> 를 대신 받아 오므로, 호스트 검사만으로는 열린 프록시가 됨 — 리뷰 권장 2)
function imgAllowed (raw, hosts, known) {
  let u
  try { u = new URL(raw) } catch (e) { return null }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  if (hosts.indexOf(u.hostname) === -1) return null
  return known && known.has(raw) ? u : null
}

function originOk (req) {
  const o = req.headers.origin || ''
  return ALLOWED_ORIGINS.indexOf(o) !== -1
}

// YouTube 응답 → 항목
function playlistItems (searchJson, detailJson, ctx) {
  const detail = {}
  ;(detailJson.items || []).forEach(function (p) { detail[p.id] = p })
  return (searchJson.items || []).filter(function (it) { return it.id && it.id.playlistId }).map(function (it) {
    const id = it.id.playlistId, sn = it.snippet || {}, d = detail[id] || {}
    const th = (sn.thumbnails || {})
    return {
      kind: 'playlist', sourceId: id, title: decodeEntities(sn.title), provider: decodeEntities(sn.channelTitle),
      channelId: sn.channelId, year: (sn.publishedAt || '').slice(0, 4),
      thumbnail: (th.medium || th.default || {}).url || '',
      url: 'https://www.youtube.com/playlist?list=' + encodeURIComponent(id),
      itemCount: (d.contentDetails || {}).itemCount || 0
    }
  }).filter(function (x) { return ctx.channelIds.indexOf(x.channelId) !== -1 && !blocked(x.title, ctx.school, ctx.filters) })
}

// 다른 선생님·유명 강사 무료 강의 (EBS 외, 사용자 결정 2026-11-12 v3)
// 조건: EBS 허용 채널이 아님, 사용자가 끈 채널 아님, 20분 이상, 제목에 단원 이름, 홍보·맛보기·팁 말 없음, 연도·예비과정 규칙, 해설강의 아님
function otherVideoItems (searchJson, detailJson, ctx) {
  const off = ctx.otherOff || {}
  const blockWords = (ctx.filters.otherBlockWords || []).map(normTitle)
  return videoItemsRaw(searchJson, detailJson).filter(function (x) {
    const t = normTitle(x.title)
    return (ctx.ebsAll || ctx.channelIds).indexOf(x.channelId) === -1 && !off[x.channelId] &&
      x.durationMin >= (ctx.minMinutes || ctx.filters.minVideoMinutes || 20) && !!ctx.unit &&
      (titleHasUnit(x.title, ctx.unit) || (ctx.altWords || []).some(function (w) { return t.includes(normTitle(w)) })) &&
      !blockWords.some(function (w) { return t.includes(w) }) && !blocked(x.title, ctx.school, ctx.filters) &&
      !videoRuleFails(x, ctx.filters, ctx.curriculum) && !isExam(x.title, ctx.filters) && !gradeConflict(x.title, ctx.gradeLabel) && !termConflict(x.title, ctx.gradeLabel, ctx.term) &&
      !courseNameConflict(x.title, ctx.otherKeys) &&
      !(ctx.extraBlock || []).some(function (w) { return t.includes(normTitle(w)) })
  }).map(function (x) { x.channelGroup = 'other'; x.unitMatch = true; return x })
}

function videoItemsRaw (searchJson, detailJson) {
  const detail = {}
  ;(detailJson.items || []).forEach(function (v) { detail[v.id] = v })
  return (searchJson.items || []).filter(function (it) { return it.id && it.id.videoId }).map(function (it) {
    const id = it.id.videoId, sn = it.snippet || {}, d = detail[id] || {}
    const th = (sn.thumbnails || {})
    return {
      kind: 'video', sourceId: id, title: decodeEntities(sn.title), provider: decodeEntities(sn.channelTitle),
      channelId: sn.channelId, year: (sn.publishedAt || '').slice(0, 4),
      thumbnail: (th.medium || th.default || {}).url || '',
      url: 'https://www.youtube.com/watch?v=' + encodeURIComponent(id),
      durationMin: isoMinutes((d.contentDetails || {}).duration),
      views: Number((d.statistics || {}).viewCount || 0)
    }
  })
}

function videoItems (searchJson, detailJson, ctx) {
  const detail = {}
  ;(detailJson.items || []).forEach(function (v) { detail[v.id] = v })
  return (searchJson.items || []).filter(function (it) { return it.id && it.id.videoId }).map(function (it) {
    const id = it.id.videoId, sn = it.snippet || {}, d = detail[id] || {}
    const th = (sn.thumbnails || {})
    return {
      kind: 'video', sourceId: id, title: decodeEntities(sn.title), provider: decodeEntities(sn.channelTitle),
      channelId: sn.channelId, year: (sn.publishedAt || '').slice(0, 4),
      thumbnail: (th.medium || th.default || {}).url || '',
      url: 'https://www.youtube.com/watch?v=' + encodeURIComponent(id),
      durationMin: isoMinutes((d.contentDetails || {}).duration),
      views: Number((d.statistics || {}).viewCount || 0)
    }
  }).filter(function (x) {
    return ctx.channelIds.indexOf(x.channelId) !== -1 && x.durationMin >= (ctx.minMinutes || ctx.filters.minVideoMinutes || 20) && !blocked(x.title, ctx.school, ctx.filters) && !videoRuleFails(x, ctx.filters, ctx.curriculum)
  })
}

// 카카오 책 응답 → 항목 (허용 출판사만, 학년 안 맞는 제목 제외)
function bookItems (kakaoJson, ctx) {
  return (kakaoJson.documents || []).map(function (d) {
    return {
      kind: 'book', sourceId: d.isbn || d.url, title: d.title, provider: pubName(d.publisher),
      authors: cleanAuthors((d.authors || []).join(', ')), year: (d.datetime || '').slice(0, 4),
      thumbnail: d.thumbnail || '', url: d.url || ''
    }
  }).filter(function (b) {
    const okPub = ctx.publishers.some(function (p) { return p.match.some(function (m) { return b.provider.includes(m) }) })
    return okPub && /^https:\/\//.test(b.url) && !blocked(b.title, ctx.school, ctx.filters)
  })
}

/* ---------- 바깥 API (내부 확인 페이지의 '후보 찾기'에서만) ---------- */
async function getJson (url, headers) {
  const r = await fetch(url, { headers: headers || {}, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!r.ok) throw new Error('upstream ' + r.status)
  return r.json()
}

const YT = 'https://www.googleapis.com/youtube/v3/'
const PLAYLIST_PAGES_MAX = 40 // 채널 재생목록 최대 2,000개 (50개씩 40쪽 = 40 units)
const channelPlaylists = new Map() // 채널 id → { at, items } (하루 캐시)

// 채널의 재생목록 전체: playlists.list 는 50개당 1 unit (search 100 units보다 훨씬 쌈 — EBS 조사 추천 2)
async function listChannelPlaylists (channelId, key, usage) {
  const hit = channelPlaylists.get(channelId)
  if (hit && Date.now() - hit.at < CACHE_DAY_MS) return hit.items
  let items = []
  let token = ''
  for (let page = 0; page < PLAYLIST_PAGES_MAX; page++) {
    const j = await getJson(YT + 'playlists?part=snippet,contentDetails&maxResults=50&channelId=' + encodeURIComponent(channelId) +
      (token ? '&pageToken=' + encodeURIComponent(token) : '') + '&key=' + encodeURIComponent(key))
    usage.units += 1
    items = items.concat(j.items || [])
    token = j.nextPageToken
    if (!token) break
  }
  channelPlaylists.set(channelId, { at: Date.now(), items: items })
  return items
}

// 제목 비교용: 띄어쓰기 없애고, 로마 숫자 Ⅰ·Ⅱ를 1·2로
// (로마 숫자를 먼저 바꿈: toLowerCase가 Ⅱ를 ⅱ로 바꾸기 때문. 소문자 ⅰ·ⅱ도 함께)
function normTitle (s) { return String(s || '').normalize('NFC').replace(/[Ⅰⅰ]/g, '1').replace(/[Ⅱⅱ]/g, '2').toLowerCase().replace(/\s+/g, '') }

// 영상·재생목록 규칙 (사용자 결정 2026-11-12): 게시 연도가 기준보다 이전이거나 제목에 '예비과정' 류 말이 있으면 뺌
// 숫자·말은 data/sources.json filters.minVideoYear / prepCourseWords. 책에는 적용하지 않음
// 교육과정별 최소 게시 연도 (filters.minVideoYearByCurriculum, 예: 2015 → 2018)
function minYearFor (filters, curriculum) {
  const f = filters || {}
  const by = f.minVideoYearByCurriculum || {}
  return by[curriculum] || f.minVideoYear || 0
}

// 영상 규칙에 쓸 교육과정 열쇠: 영상이 거의 없는 진로·융합 과목(relaxedVideo)은 'relaxed'(예전 강의 허용, 사용자 요청 2026-11-15)
function ruleCurriculum (course) {
  if (!course) return ''
  return course.relaxedVideo ? 'relaxed' : course.curriculum
}
// 예전 교육과정 강의 표시: relaxed 과목의 2024년 이전 영상(2022 진로·융합 과목은 2025년부터 배움)
function oldCurriculumVideo (course, item) {
  return !!(course && course.relaxedVideo && item.kind !== 'book' && item.kind !== 'course' && Number(item.year) && Number(item.year) < 2024)
}

function videoRuleFails (item, filters, curriculum) {
  if (!item || item.kind === 'book') return ''
  const f = filters || {}
  const year = Number(item.year || 0)
  const minYear = minYearFor(f, curriculum)
  if (minYear && year && year < minYear) return 'old'
  const t = normTitle(item.title)
  if ((f.prepCourseWords || []).some(function (w) { return t.includes(normTitle(w)) })) return 'prep'
  return ''
}

// 여러 과목이 섞인 재생목록인가: 서로 다른 과목 이름이 2개 이상 (예: "수학 (확률과통계, 미적분, 기하와벡터)")
function mixedCourses (title, filters) {
  const t = normTitle(title)
  const words = ((filters && filters.mixedCourseWords) || []).map(normTitle)
  // "기하와벡터" 안의 "기하"처럼 겹치는 말은 하나로 셈
  const hits = words.filter(function (w) { return t.includes(w) })
  const distinct = hits.filter(function (w) { return !hits.some(function (o) { return o !== w && o.includes(w) }) })
  return distinct.length >= 2
}

// 제목에 단원 이름이 있는가: 단원 전체, 또는 '와/과'로 나눈 부분(2글자 이상) 하나 (예: "지수함수와 로그함수" → 지수함수 / 로그함수)
function titleHasUnit (title, unit) {
  const t = normTitle(title)
  const parts = [unit].concat(String(unit || '').split(/와 |과 |·/)).map(normTitle).filter(function (p) { return p.length >= 2 })
  return parts.some(function (p) { return t.includes(p) })
}

// 과목 이름 없는 '전 과목 시험 해설' 재생목록 (예: EBSi "2024학년도 고3 6월 모의평가 해설" — 국어부터 모든 과목이 섞임, 1-B 시나리오 확인 2026-11-15)
function mixedExamPlaylist (title) {
  const t = String(title || '')
  const subj = /국어|영어|수학|화법|작문|언어|매체|독서|문학|듣기|독해|어휘|문법|대수|미적분|확률|기하|공통/
  return /(모의평가|학력평가|대학수학능력시험|수능)\s*해설/.test(t) && !subj.test(t.replace(/대학수학능력시험/g, ''))
}

// 채널 재생목록에서 과목 이름(별칭 포함)이 제목에 있는 것만 → 항목. 단원 이름까지 있으면 unitMatch
function matchPlaylists (list, names, unit, ctx, excludes) {
  const ns = names.map(normTitle).filter(Boolean)
  // 다른 과목 제목에 걸리지 않게 (예: '수학Ⅰ' 별칭이 '공통수학1'에, '미적분'이 '미적분Ⅰ'에 걸리는 것)
  const ex = (excludes || []).map(normTitle).filter(Boolean)
  const u = unit ? normTitle(unit) : ''
  return (list || []).map(function (p) {
    const sn = p.snippet || {}, th = sn.thumbnails || {}
    return {
      kind: 'playlist', sourceId: p.id, title: decodeEntities(sn.title), provider: decodeEntities(sn.channelTitle),
      channelId: sn.channelId, year: (sn.publishedAt || '').slice(0, 4),
      thumbnail: (th.medium || th.default || {}).url || '',
      url: 'https://www.youtube.com/playlist?list=' + encodeURIComponent(p.id),
      itemCount: (p.contentDetails || {}).itemCount || 0
    }
  }).filter(function (x) {
    const t = normTitle(x.title)
    return ctx.channelIds.indexOf(x.channelId) !== -1 && x.itemCount >= 2 && ns.some(function (n) { return t.includes(n) }) &&
      !ex.some(function (e) { return t.includes(e) }) && !mixedCourses(x.title, ctx.filters) && !blocked(x.title, ctx.school, ctx.filters) && !videoRuleFails(x, ctx.filters, ctx.curriculum) &&
      !gradeConflict(x.title, ctx.gradeLabel) && !termConflict(x.title, ctx.gradeLabel, ctx.term) && !courseNameConflict(x.title, ctx.otherKeys) &&
      !mixedExamPlaylist(x.title)
  }).map(function (x) { x.unitMatch = !!unit && titleHasUnit(x.title, unit); return x })
    // 중학교 학기 과목의 과목 전체('*') 재생목록은 제목에 그 학년·학기 표시가 있어야 함
    // (과목 이름이 '수학'뿐이라 다른 학년에 걸림, 표본 검사 권장 1). 학기 없는 과목(중학 영어 등)은 다른 학년 표시만 뺌
    .filter(function (x) { return x.unitMatch || !ctx.term || gradeMarked(x.title, ctx.gradeLabel, ctx.term) })
    // 단원 이름이 있는 것 → 강의 수 많은 것 → 최근 것
    .sort(function (a, b) { return (b.unitMatch - a.unitMatch) || (b.itemCount - a.itemCount) || (Number(b.year) - Number(a.year)) })
}

// 단원 영상: 20분 넘는 영상 검색 1번(100 units) + 상세 1번(1 unit)
async function searchLongVideos (q, ctx, key, usage) {
  const common = '&part=snippet&maxResults=10&safeSearch=strict&regionCode=KR&relevanceLanguage=ko&channelId=' + encodeURIComponent(ctx.channelIds[0]) + '&q=' + encodeURIComponent(q) + '&key=' + encodeURIComponent(key)
  // 기준 연도 이후에 올라온 영상만 검색 (사용자 결정 2026-11-12, 교육과정별 filters.minVideoYearByCurriculum)
  const minYear = minYearFor(ctx.filters, ctx.curriculum)
  const after = minYear ? '&publishedAfter=' + encodeURIComponent(minYear + '-01-01T00:00:00Z') : ''
  const vs = await getJson(YT + 'search?type=video&videoDuration=long' + after + common)
  usage.units += 100
  const vIds = (vs.items || []).map(function (i) { return i.id && i.id.videoId }).filter(Boolean)
  let vDetail = { items: [] }
  if (vIds.length) { vDetail = await getJson(YT + 'videos?part=contentDetails,statistics&id=' + vIds.join(',') + '&key=' + encodeURIComponent(key)); usage.units += 1 }
  // 제목에 단원 이름이 있을 때만 그 단원 영상으로 (없으면 과목 전체 '*' — 리뷰 권장 3). 해설강의는 표시
  return videoItems(vs, vDetail, ctx).map(function (v) {
    v.unitMatch = !!ctx.unit && titleHasUnit(v.title, ctx.unit)
    v.examSolution = isExam(v.title, ctx.filters)
    return v
  })
}

// 다른 선생님 강의 검색: 채널 제한 없이 20분 넘는 영상 1번(100 units) + 상세(1 unit)
async function searchOtherVideos (q, ctx, key, usage) {
  const minYear = minYearFor(ctx.filters, ctx.curriculum)
  const after = minYear ? '&publishedAfter=' + encodeURIComponent(minYear + '-01-01T00:00:00Z') : ''
  // 짧은 단원(영어 어휘·듣기 등, minVideoMinutesByUnit)은 길이 제한 없이 찾고 아래에서 분으로 거름
  const dur = (ctx.minMinutes || 20) < 20 ? 'any' : 'long'
  const vs = await getJson(YT + 'search?type=video&videoDuration=' + dur + after + '&part=snippet&maxResults=15&safeSearch=strict&regionCode=KR&relevanceLanguage=ko&q=' +
    encodeURIComponent(q + ' 강의') + '&key=' + encodeURIComponent(key))
  usage.units += 100
  const vIds = (vs.items || []).map(function (i) { return i.id && i.id.videoId }).filter(Boolean)
  let vDetail = { items: [] }
  if (vIds.length) { vDetail = await getJson(YT + 'videos?part=contentDetails,statistics&id=' + vIds.join(',') + '&key=' + encodeURIComponent(key)); usage.units += 1 }
  return otherVideoItems(vs, vDetail, ctx)
}

// 새로 만난 다른 선생님 채널을 sources.json otherChannels 에 기록 (사용자가 enabled:false 로 끌 수 있게)
function recordOtherChannels (items) {
  const others = items.filter(function (x) { return x.channelGroup === 'other' && x.channelId })
  if (!others.length) return
  const src = readJson(DATA.sources)
  src.otherChannels = src.otherChannels || []
  let changed = false
  others.forEach(function (x) {
    if (src.otherChannels.some(function (c) { return c.id === x.channelId })) return
    src.otherChannels.push({ id: x.channelId, name: x.provider, enabled: true, addedAt: today() })
    changed = true
  })
  if (changed) {
    const tmp = DATA.sources + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(src, null, 2) + '\n')
    fs.renameSync(tmp, DATA.sources)
  }
}

/* ---------- 할당량 적은 방식: 채널 목록 캐시 (사용자 요청 2026-11-12, qitem-20261112001208-51b80fae) ----------
   허용 채널의 업로드 목록 전체를 playlistItems.list(50개당 1 unit)로 받아 data/youtube-cache/<채널 id>.json 에 저장.
   단원 맞추기는 서버 안에서(0 unit). 영상 길이는 맞은 것만 videos.list(50개당 1 unit). search.list(100 units)는 쓰지 않음.
   캐시는 YouTube에서 받은 자료라 커밋하지 않음(.gitignore). 하루 한 번 새 영상만 이어 받음. */
const CACHE_DIR = path.join(ROOT, 'data', 'youtube-cache')
const UPLOAD_PAGES_PER_CALL = 400 // 한 번에 최대 20,000개(400 units). 넘으면 다음 호출에서 이어 받음
const DAILY_UNIT_LIMIT = 7000 // 하루 10,000 units의 70% (사용자 기준)

function validChannelId (id) { return /^UC[A-Za-z0-9_-]{22}$/.test(String(id || '')) }
function uploadsPlaylistId (channelId) { return validChannelId(channelId) ? 'UU' + channelId.slice(2) : '' }
function cacheFile (channelId) { return path.join(CACHE_DIR, channelId + '.json') }
function readCache (channelId) {
  try { return JSON.parse(fs.readFileSync(cacheFile(channelId), 'utf8')) } catch (e) { return null }
}
function writeJsonFile (file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(obj) + '\n')
  fs.renameSync(tmp, file)
}

// 할당량은 태평양 시간 자정에 다시 채워짐 → 사용량도 태평양 날짜로 셈
function quotaDay () { return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Los_Angeles' }) }
function usageFile () { return path.join(CACHE_DIR, 'usage.json') }
function usedToday () {
  try { return Number((JSON.parse(fs.readFileSync(usageFile(), 'utf8')).days || {})[quotaDay()] || 0) } catch (e) { return 0 }
}
function addUsage (units) {
  if (!units) return usedToday()
  let u = { days: {} }
  try { u = JSON.parse(fs.readFileSync(usageFile(), 'utf8')) } catch (e) {}
  u.days = u.days || {}
  u.days[quotaDay()] = Number(u.days[quotaDay()] || 0) + units
  writeJsonFile(usageFile(), u)
  return u.days[quotaDay()]
}

// playlistItems 응답 → 짧은 기록 {v: 영상 id, t: 제목, d: 게시일}. 비공개·삭제 영상은 뺌
function uploadRows (json) {
  return (json.items || []).map(function (it) {
    const sn = it.snippet || {}, cd = it.contentDetails || {}
    const v = cd.videoId || (sn.resourceId || {}).videoId
    return { v: v, t: decodeEntities(sn.title), d: String(cd.videoPublishedAt || sn.publishedAt || '').slice(0, 10) }
  }).filter(function (r) { return r.v && r.t && r.t !== 'Private video' && r.t !== 'Deleted video' })
}

// 새로 받은 것 + 예전 것 (같은 영상은 하나로, 새것 먼저)
function mergeUploads (fresh, old) {
  const seen = {}
  return fresh.concat(old || []).filter(function (r) { if (seen[r.v]) return false; seen[r.v] = true; return true })
}

// 다른 학년 표시가 제목에 있으면 뺌 (예: 중2 단원인데 제목이 "중3 …")
// 중학교면 초등·고등 표시도 뺌 (표본 검사 2026-11-12: "공통수학 1"·"RPM 수학1"·"초5"·"공통국어2"가 중학 과목에 걸림)
const OTHER_LEVEL = /초[1-6]|초등|고[1-3]|고등|공통(수학|국어|영어)|수학(Ⅰ|Ⅱ|II|I|[12])(?![0-9\-학단강장부회권차편])/
function gradeConflict (title, gradeLabel) {
  if (!gradeLabel) return false
  const t = String(title || '').replace(/\s+/g, '')
  if (gradeLabel[0] === '중' && OTHER_LEVEL.test(t)) return true
  const m = (t.match(/중등?([123])/g) || []).map(function (x) { return x.replace('중등', '중') })
  if (!m.length) return false
  return m.indexOf(gradeLabel.replace(/\s+/g, '')) === -1
}

// 같은 교과의 다른 과목 이름(4글자 이상, 내 이름과 겹치지 않는 것): 예) 영어Ⅱ 과목에 '독해와작문'·'공통영어', 중학 수학에 '확률과통계'
// 과목에 allowOtherNames가 있으면 그 이름은 허용 (예: 공통수학1의 경우의 수 ← 2015 '확률과 통계' 강의, 운영 표본 2026-11-13)
function courseKey (c) { return normTitle(String(c.search || c.label).replace(/^(영어|국어|수학) (?=\S)/, '')) }
function otherCourseKeys (courses, own) {
  const mine = [own.label, own.search].concat(own.searchAlias || [], own.allowOtherNames || []).filter(Boolean).map(normTitle).concat([courseKey(own)])
  const out = []
  courses.forEach(function (c) {
    if (c.subject !== own.subject || c.id === own.id) return
    const k = courseKey(c)
    if (k.length >= 4 && !mine.some(function (m) { return m.includes(k) || k.includes(m) }) && out.indexOf(k) === -1) out.push(k)
  })
  return out
}
function courseNameConflict (title, keys) {
  const t = normTitle(title)
  return (keys || []).some(function (k) { return t.includes(k) })
}

// 학기 과목인데 제목에 같은 학년의 다른 학기 표시가 있는가 (예: 중2 1학기 과목에 "중2수학 … 2학기 1차고사", 운영 표본 2026-11-12)
function termConflict (title, gradeLabel, term) {
  if (!term || !gradeLabel) return false
  const n = gradeLabel.slice(-1)
  const t = String(title || '').replace(/\s+/g, '')
  if (gradeTerms(t).some(function (x) { return x.g === n && x.s !== term })) return true
  return (String(title || '').match(/(?<![0-9-])[12](?=\s*학기)/g) || []).some(function (x) { return x !== term })
}

// 학년-학기 표시 ("수학 2-1", "중등2-2" → [{g:'2', s:'1'}])
function gradeTerms (t) {
  const out = []
  const re = /(?:수학|국어|영어|중등?|학년)([123])-([12])(?![0-9])/g
  let m
  while ((m = re.exec(t))) out.push({ g: m[1], s: m[2] })
  return out
}

// 제목에 이 학년(학기 과목이면 이 학기까지) 표시가 있는가. 중2 1학기 → "중2", "2학년", "수학 2-1" 통과, "중등2-2"·"2학기"는 안 됨
function gradeMarked (title, gradeLabel, term) {
  if (!gradeLabel) return true
  const t = String(title || '').replace(/\s+/g, '')
  const n = gradeLabel.slice(-1)
  const gts = gradeTerms(t).filter(function (x) { return x.g === n })
  if (term && gts.some(function (x) { return x.s !== term })) return false
  // 학기는 공백을 지우기 전 제목에서 ("중2 2학기"가 "중22학기"로 붙지 않게)
  if (term && (String(title || '').match(/(?<![0-9-])[12](?=\s*학기)/g) || []).some(function (x) { return x !== term })) return false
  return t.includes(gradeLabel) || t.includes('중등' + n) || t.includes(n + '학년') || gts.length > 0
}

// 캐시된 업로드 목록에서 이 과목·단원 영상 고르기 (0 unit). 단원 이름이 제목에 있어야 함
function matchUploads (rows, names, unit, ctx, excludes) {
  if (!unit) return []
  const ns = names.map(normTitle).filter(Boolean)
  const ex = (excludes || []).map(normTitle).filter(Boolean)
  return (rows || []).filter(function (r) {
    const t = normTitle(r.t)
    const item = { kind: 'video', title: r.t, year: r.d.slice(0, 4) }
    return titleHasUnit(r.t, unit) && ns.some(function (n) { return t.includes(n) }) && !ex.some(function (e) { return t.includes(e) }) &&
      !blocked(r.t, ctx.school, ctx.filters) && !videoRuleFails(item, ctx.filters, ctx.curriculum) && !gradeConflict(r.t, ctx.gradeLabel) &&
      !termConflict(r.t, ctx.gradeLabel, ctx.term) && !courseNameConflict(r.t, ctx.otherKeys) &&
      !mixedCourses(r.t, ctx.filters)
  }).sort(function (a, b) { return b.d.localeCompare(a.d) })
}

// YouTube 주소 → {type, id}. 허용: youtube.com/watch?v=, youtu.be/, youtube.com/playlist?list=, youtube.com/shorts는 안 받음
function parseYouTubeUrl (raw) {
  let u
  try { u = new URL(String(raw || '').trim()) } catch (e) { return null }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  const host = u.hostname.replace(/^www\.|^m\./, '')
  const vid = /^[A-Za-z0-9_-]{11}$/, list = /^[A-Za-z0-9_-]{10,64}$/
  if (host === 'youtu.be') { const id = u.pathname.slice(1); return vid.test(id) ? { type: 'video', id: id } : null }
  if (host !== 'youtube.com') return null
  if (u.pathname === '/watch' && vid.test(u.searchParams.get('v') || '')) return { type: 'video', id: u.searchParams.get('v') }
  if (u.pathname === '/playlist' && list.test(u.searchParams.get('list') || '')) return { type: 'playlist', id: u.searchParams.get('list') }
  return null
}

// 채널 주소·핸들 → {id} 또는 {handle}
function parseChannelRef (raw) {
  const s = String(raw || '').trim()
  if (validChannelId(s)) return { id: s }
  if (/^@[A-Za-z0-9._-]{3,30}$/.test(s)) return { handle: s }
  let u
  try { u = new URL(s) } catch (e) { return null }
  if (u.protocol !== 'https:' || u.hostname.replace(/^www\.|^m\./, '') !== 'youtube.com') return null
  const m1 = /^\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/.exec(u.pathname)
  if (m1) return { id: m1[1] }
  const m2 = /^\/(@[A-Za-z0-9._-]{3,30})\/?/.exec(u.pathname)
  return m2 ? { handle: m2[1] } : null
}

// 채널 하나의 업로드 목록·재생목록을 캐시에 받기. 하루 한 번, 새 영상만 이어 받음
async function syncChannel (channelId, name, key, usage, budget, force) {
  const c = readCache(channelId) || { channelId: channelId, name: name, uploads: [], playlists: [], details: {}, syncedAt: '', resumeToken: '', complete: false }
  if (!force && c.complete && c.syncedAt === today()) return { id: channelId, name: c.name, skipped: true, uploads: c.uploads.length, complete: true, units: 0 }
  const start = usage.units
  const list = uploadsPlaylistId(channelId)
  const page = async function (token) {
    const j = await getJson(YT + 'playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=' + encodeURIComponent(list) +
      (token ? '&pageToken=' + encodeURIComponent(token) : '') + '&key=' + encodeURIComponent(key))
    usage.units += 1
    return j
  }
  const known = {}
  c.uploads.forEach(function (r) { known[r.v] = true })
  let pages = 0
  let top = []
  const left = function () { return pages < UPLOAD_PAGES_PER_CALL && usage.units - start < budget }
  // 1) 맨 앞(최신)부터: 이미 받은 영상을 만나면 멈춤. 처음(또는 전체 다시 받기)이면 끝까지(또는 한도까지)
  let token = ''
  let hitKnown = false
  const firstTime = !c.uploads.length || c.fullRescan === true
  try {
    while (left()) {
      const j = await page(token)
      pages += 1
      const rows = uploadRows(j)
      const fresh = rows.filter(function (r) { return !known[r.v] })
      top = top.concat(fresh)
      if (!firstTime && fresh.length < rows.length) { hitKnown = true; break }
      token = j.nextPageToken || ''
      if (!token) break
    }
  } catch (e) {
    // 맨 앞부터 받다가 오류: 받은 것까지만 합치고, 다음에 다시 시도 (리뷰 권장 4)
    c.uploads = mergeUploads(top, c.uploads)
    writeJsonFile(cacheFile(channelId), c)
    throw e
  }
  let resume = c.resumeToken || ''
  if (firstTime) { resume = token; c.complete = !token; c.fullRescan = false }
  // 새 영상을 받다가 이미 받은 곳에 닿기 전에 한도에서 멈춤 → 멈춘 곳을 기억해 다음에 이어 받음 (리뷰 권장 3)
  if (!firstTime && !hitKnown && token) c.gapToken = token
  c.uploads = mergeUploads(top, c.uploads)
  // 1-2) 지난번에 멈춘 '새 영상 사이' 이어 받기: 이미 받은 영상을 만나면 끝
  if (!firstTime && c.gapToken && left()) {
    let g = c.gapToken
    try {
      while (g && left()) {
        const j = await page(g)
        pages += 1
        const rows = uploadRows(j)
        const fresh = rows.filter(function (r) { return !known[r.v] })
        c.uploads = mergeUploads([], c.uploads.concat(fresh))
        if (fresh.length < rows.length) { g = ''; break }
        g = j.nextPageToken || ''
      }
    } catch (e) { g = ''; c.fullRescan = true } // 토큰이 깨졌으면 다음에 전체 다시 받기
    c.gapToken = g
  }
  // 2) 처음 받다가 한도에서 멈춘 경우: 멈춘 곳부터 이어 받기
  if (!firstTime && resume && left()) {
    let t = resume
    try {
      while (t && left()) {
        const j = await page(t)
        pages += 1
        c.uploads = mergeUploads([], c.uploads.concat(uploadRows(j)))
        t = j.nextPageToken || ''
      }
      c.complete = !t
    } catch (e) {
      // 이어 받기 토큰이 만료·오류면 같은 곳에서 계속 실패하지 않게 비우고, 다음에 전체 다시 받기 (리뷰 권장 4)
      t = ''
      c.complete = false
      c.fullRescan = true
    }
    resume = t
  }
  c.resumeToken = resume
  // 재생목록 목록 (50개당 1 unit): 하루 한 번. 남은 예산이 재생목록 최대 쪽수보다 적으면 다음으로 미룸 (리뷰 권장 5)
  if ((c.syncedAt !== today() || !c.playlists.length) && budget - (usage.units - start) >= PLAYLIST_PAGES_MAX) {
    const pls = await listChannelPlaylists(channelId, key, usage)
    c.playlists = pls.map(function (p) {
      const sn = p.snippet || {}, th = sn.thumbnails || {}
      return { id: p.id, t: decodeEntities(sn.title), d: String(sn.publishedAt || '').slice(0, 10), n: (p.contentDetails || {}).itemCount || 0, th: (th.medium || th.default || {}).url || '', ch: sn.channelTitle || name }
    })
  }
  c.name = c.name || name
  c.syncedAt = today()
  writeJsonFile(cacheFile(channelId), c)
  return { id: channelId, name: c.name, uploads: c.uploads.length, playlists: c.playlists.length, complete: c.complete, units: usage.units - start }
}

// 캐시 재생목록 → matchPlaylists가 받는 모양
function cachedPlaylistsAsApi (c) {
  return (c.playlists || []).map(function (p) {
    return { id: p.id, snippet: { title: p.t, channelId: c.channelId, channelTitle: p.ch || c.name, publishedAt: p.d, thumbnails: { medium: { url: p.th } } }, contentDetails: { itemCount: p.n } }
  })
}

// 맞은 영상의 길이·조회수: 캐시에 없는 것만 videos.list 50개씩(1 unit)
async function fillDetails (c, ids, key, usage) {
  c.details = c.details || {}
  const need = ids.filter(function (id) { return !c.details[id] })
  for (let i = 0; i < need.length; i += 50) {
    const chunk = need.slice(i, i + 50)
    const j = await getJson(YT + 'videos?part=contentDetails,statistics&id=' + chunk.join(',') + '&key=' + encodeURIComponent(key))
    usage.units += 1
    ;(j.items || []).forEach(function (v) {
      c.details[v.id] = { m: isoMinutes((v.contentDetails || {}).duration), views: Number((v.statistics || {}).viewCount || 0) }
    })
    chunk.forEach(function (id) { if (!c.details[id]) c.details[id] = { m: 0, views: 0 } })
  }
  if (need.length) writeJsonFile(cacheFile(c.channelId), c)
}

// 캐시에서 후보 찾기 (재생목록 0 unit, 영상 길이만 1 unit/50개)
async function collectFromCache (channels, names, unit, ctx, excludes, key, usage) {
  const out = { pls: [], vids: [], missing: [] }
  for (const ch of channels) {
    const c = readCache(ch.id)
    if (!c) { out.missing.push(ch.name || ch.id); continue }
    const other = ch.group === 'other'
    const otherBlock = (ctx.filters.otherBlockWords || []).map(normTitle)
    const okOther = function (title) { const t = normTitle(title); return !otherBlock.some(function (w) { return t.includes(w) }) }
    const chCtx = Object.assign({}, ctx, { channelIds: [ch.id] })
    matchPlaylists(cachedPlaylistsAsApi(c), names, unit, chCtx, excludes).slice(0, 5).forEach(function (p) {
      if (other && !okOther(p.title)) return
      if (other) p.channelGroup = 'other'
      out.pls.push(p)
    })
    const rows = matchUploads(c.uploads, names, unit, ctx, excludes).filter(function (r) { return !other || okOther(r.t) }).slice(0, 15)
    if (!rows.length) continue
    await fillDetails(c, rows.map(function (r) { return r.v }), key, usage)
    rows.forEach(function (r) {
      const d = c.details[r.v] || {}
      if ((d.m || 0) < (ctx.minMinutes || ctx.filters.minVideoMinutes || 20)) return
      const v = {
        kind: 'video', sourceId: r.v, title: r.t, provider: c.name, channelId: ch.id, year: r.d.slice(0, 4),
        thumbnail: 'https://i.ytimg.com/vi/' + r.v + '/mqdefault.jpg', url: 'https://www.youtube.com/watch?v=' + r.v,
        durationMin: d.m, views: d.views || 0, unitMatch: true, examSolution: isExam(r.t, ctx.filters)
      }
      if (other) { if (v.examSolution) return; v.channelGroup = 'other' }
      out.vids.push(v)
    })
  }
  return out
}

// 검색어마다 모아서 (EBS 교재만 찾던 때는 첫 검색어에서 멈췄음). 같은 책은 하나로, 과목·학년·판이 맞는 것만
async function collectBooks (queries, ctx, key) {
  const out = [], seen = {}
  for (const q of queries) {
    const j = await getJson('https://dapi.kakao.com/v3/search/book?size=10&target=title&query=' + encodeURIComponent(q), { Authorization: 'KakaoAK ' + key })
    bookItems(j, ctx).forEach(function (b) {
      if (seen[b.sourceId] || (ctx.bookCourse && !bookFitsCourse(b, ctx.bookCourse))) return
      seen[b.sourceId] = true
      out.push(b)
    })
    if (out.length >= 12) break
  }
  return out
}

// 책이 이 과목에 맞는가 (사용자 요청 2026-11-12 '책도 찾아줘': EBS 외 시중 개념서·자습서 허용)
// bc = { names, excludes, school, curriculum, term, grades, exam }
//  - 제목에 과목 이름(별칭)이 있어야 함. 중학교는 '중학/중등' + 과목, 학기 과목은 학년-학기("수학 2-1")까지
//  - 중학 책의 학년 표시는 그 과목 학년 중 하나여야 함. 고등 과목에 중학 책은 안 됨
//  - 판: 2022 과목은 2024년 이후 책, 제목에 '2015'가 있으면 안 됨. 2015 과목은 2018년 이후, 제목에 '2022'가 있으면 안 됨
//  - 기출·모의고사 문제집은 수능 과목에서만 (수능 대비 학생만 보게)
function bookFitsCourse (b, bc) {
  const raw = String(b.title || '')
  const t = normTitle(raw)
  const y = Number(b.year) || 0
  // 제목의 판 연도 "(2027)"와 "(2027 수능대비)"
  const ed = Math.max.apply(null, [0].concat((raw.match(/\((20\d\d)\)/g) || []).map(function (x) { return Number(x.replace(/\D/g, '')) })))
  const sat = (raw.match(/(20\d\d)\s*수능\s*대비/) || [])[1]
  // 2022 과목: 2024년 이후 책. 2027학년도 수능까지는 2015 교육과정이라 그 수능 대비 교재는 뺌
  // 진로·융합 과목(relaxed)은 같은 이름의 2015 판 교재도 허용 (2015년 이후)
  if (bc.relaxed && y && y < 2015) return false
  // 중학 국어·영어(학년 공통 과목)의 독해·문법·어휘 실력서는 교과서와 무관 → 2018년 이후 판 허용 (중2 영어 독해 책 0권, 2026-11-15)
  const skillBook = bc.school === 'middle' && !bc.term && !/자습서|교과서|평가/.test(raw)
  if (skillBook && y && y < 2018) return false
  if (!bc.relaxed && !skillBook && bc.curriculum === '2022' && (y < 2024 || t.includes('2015') || t.includes('15개정') || (sat && Number(sat) <= 2027))) return false
  if (bc.curriculum === '2015' && t.includes('22개정')) return false
  // 2015 과목: 2018~2024년 책 (같은 이름의 2022 과목 새 판이 2025년부터 나옴). '2015'가 제목에 있으면 연도 무관. 2027년 이후 판은 안 됨
  // '2015'는 '2015 개정'·'15개정'일 때만 교육과정 표시로 봄 (판 연도 "(2015)"는 2009 교육과정 책, 2026-11-15)
  if (bc.curriculum === '2015' && (t.includes('2022') || ed >= 2027 || (!/2015개정|15개정/.test(t) && (y < 2018 || y >= 2025)))) return false
  if (!bc.exam && /기출|모의고사/.test(t) && !(bc.school === 'middle' && t.includes('듣기'))) return false
  if ((bc.excludes || []).some(function (e) { const n = normTitle(e); return n && t.includes(n) })) return false
  if (bc.school === 'middle') {
    if (!/중학|중등|중[123]/.test(t) || !t.includes(normTitle(bc.subjLabel))) return false
    const gts = gradeTerms(t)
    const marks = gts.map(function (x) { return x.g }).concat((t.match(/중등?([123])|([123])학년/g) || []).map(function (x) { return x.replace(/\D/g, '') }))
    if (marks.some(function (g) { return bc.grades.indexOf(g) === -1 })) return false
    if (bc.term) return gts.some(function (x) { return bc.grades.indexOf(x.g) !== -1 && x.s === bc.term })
    return true
  }
  if (/중학|중등/.test(t)) return false
  const ebs = /EBS|한국교육방송/.test(String(b.provider || '') + raw)
  return (bc.names || []).some(function (n) {
    const m = normTitle(n)
    if (!m || BOOK_BROAD.indexOf(m) !== -1) return false
    // 2015 과목 이름(수학Ⅰ·화법과 작문 등)을 별칭으로 쓰는 2022 과목: 그 이름으로는 EBS 교재만 (시중 교재는 2015 판)
    if ((bc.oldNames || []).indexOf(m) !== -1 && !ebs) return false
    // '영어1'이 '공통영어1' 안에서 걸리지 않게 (과목 이름이 '공통'으로 시작하지 않으면)
    if (!/^공통/.test(m) && t.split('공통' + m).join('|').indexOf(m) === -1) return false
    return t.includes(m)
  })
}
// 다른 과목 책에도 걸리는 넓은 말 (예: '경제' → 사회 경제, '통계' → 확률과 통계). 책 맞추기에는 안 씀
const BOOK_BROAD = ['경제', '통계', '인공지능', '수학탐구', '영어독해']

// 책 검색어: EBS 교재 + 시중 개념서·자습서·문제집 (카카오 책 검색, YouTube 할당량과 무관)
function bookQueries (course, name, unit, grades) {
  const subj = { korean: '국어', english: '영어', math: '수학' }[course.subject]
  const qs = ['EBS ' + name + (unit ? ' ' + unit : ''), 'EBS ' + name].concat((course.bookSearch || []).map(function (q) { return 'EBS ' + q }))
  if (course.group === 'term') {
    const gt = grades[0] + '-' + String(course.label).charAt(0)
    return qs.concat(['개념원리 중학 수학 ' + gt, '쎈 중등 수학 ' + gt, '중학 수학 ' + gt, '체크체크 수학 ' + gt, '개념쎈 중등 수학 ' + gt])
  }
  if (course.group === 'all') {
    const more = []
    grades.forEach(function (g) { more.push('중학 ' + subj + ' ' + g + '-1 자습서', '중학 ' + subj + ' ' + g + '-2 자습서', '중학 ' + subj + ' ' + g) })
    if (unit) more.unshift('중학 ' + subj + ' ' + unit)
    return qs.concat(more, subj === '국어' ? ['중학 국어 문법', '중학 국어 비문학', '중학 국어 문학'] : ['중학 영어 독해', '중학 영문법', '중학 영단어', '중학 영어듣기'])
  }
  const names = [name].concat(course.searchAlias || [], course.bookSearch || [])
  const more = []
  if (unit) more.push(name + ' ' + unit)
  names.forEach(function (n) {
    more.push(n + ' 자습서', '고등 ' + n)
    // 정확도순이라 옛 판에 밀리는 새 판 (확인 2026-11-12: '고등 영어1 자습서'에 2026년 판이 안 보임 → 연도를 붙이면 나옴)
    if (course.curriculum === '2022') more.push('고등 ' + n + ' 자습서 ' + new Date().getFullYear())
    if (subj === '수학') more.push('개념원리 ' + n, '쎈 ' + n)
  })
  // 카카오 책 검색은 로마 숫자(Ⅰ·Ⅱ)로는 찾지 못함 → '1'·'2'로 바꾼 검색어 (확인 2026-11-12: "미적분Ⅰ 자습서" 0건, "미적분1 자습서" 13건)
  const all = qs.concat(more)
  const out = []
  all.concat(all.map(function (q) { return q.replace(/Ⅰ/g, '1').replace(/Ⅱ/g, '2') })).forEach(function (q) { if (out.indexOf(q) === -1) out.push(q) })
  return out.filter(function (q) { return !/[ⅠⅡ]/.test(q) })
}

/* ---------- 응답 ---------- */
function send (res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody (req) {
  return new Promise(function (resolve, reject) {
    let size = 0
    const chunks = []
    req.on('data', function (c) { size += c.length; if (size > 10240) { reject(new Error('too-big')); req.destroy() } else chunks.push(c) })
    req.on('end', function () {
      let v
      try { v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch (e) { v = undefined }
      // 객체가 아니면(깨진 JSON, null, 배열, 숫자) 입력 오류 400
      if (!v || typeof v !== 'object' || Array.isArray(v)) { const err = new Error('bad-input'); err.badInput = true; return reject(err) }
      resolve(v)
    })
    req.on('error', reject)
  })
}

// 날짜는 한국 시간 기준 (서버 시간대가 UTC여도 한국 날짜로 기록)
function today () { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) }

// 학생 화면에 보낼 모양 (내부 필드는 빼고)
function publicItem (it) {
  return {
    id: it.id, kind: it.kind, title: it.title, provider: it.provider, authors: cleanAuthors(it.authors), year: it.year || '',
    url: it.url, thumbnail: it.thumbnail, durationMin: it.durationMin || 0, itemCount: it.itemCount || 0,
    teacher: it.teacher || '', channelGroup: it.channelGroup || (it.kind === 'course' ? 'ebsi' : it.kind === 'book' ? '' : 'ebs'),
    // 학생 화면의 "확인한 날" = 사람이 승인한 날 (후보 찾기를 다시 돌린 날이 아님 — 리뷰 권장 3)
    isFree: !!it.isFree, reason: it.reason || '', lastCheckedAt: (it.review && it.review.approvedAt) || it.lastCheckedAt || '',
    // 화면이 채널마다 1개씩 고르고(같은 채널 3개 방지), 같은 시리즈 책을 한 번만 보이게 쓰는 열쇠 (사용자 캡처 2026-11-15)
    channelId: it.kind === 'book' ? '' : (it.channelId || ''), series: it.kind === 'book' ? seriesKey(it.title) : ''
  }
}

// 단원마다 다른 책 설명 (사용자 요청 2026-11-15: 같은 책이 여러 단원에 같은 문구로 나옴). 사실만, 광고·평가 문구 없음
// 예) "문법 단원: 교과서 문법 내용을 다시 정리할 때 보는 동아출판 자습서"
function bookUnitReason (it, unit) {
  const type = bookType(it.title)
  const pub = pubName(it.provider)
  const by = pub ? pub + ' ' : ''
  const desc = {
    자습서: '교과서 ' + unit + ' 내용을 다시 정리할 때 보는 ' + by + '자습서',
    평가문제집: '학교 시험 전에 ' + unit + ' 문제를 풀어 보는 ' + by + '평가문제집',
    문제집: unit + ' 유형 문제를 연습하는 ' + by + '문제집',
    개념서: unit + ' 개념을 처음부터 정리하는 ' + by + '개념서',
    교재: unit + ' 내용을 함께 공부할 수 있는 ' + by + '교재'
  }[type]
  return unit + ' 단원: ' + desc
}

/* ---------- 이미지 중계 ---------- */
const imgCache = new Map()
// 자리표시 표지인가 (images.placeholderHashes: 그림 내용의 SHA-1. 여러 책에 똑같이 쓰인 그림을 확인해 넣음)
function isPlaceholderCover (buf, cfg) {
  const list = (cfg && cfg.placeholderHashes) || []
  if (!list.length) return false
  return list.indexOf(crypto.createHash('sha1').update(buf).digest('hex')) !== -1
}

// 책 저자 칸: 카카오 자리표시 값('미사용인물코드', '저자 미상' 등)은 뺌 (운영 지적 2026-11-15)
function cleanAuthors (s) {
  return String(s || '').split(',').map(function (a) { return a.trim() })
    .filter(function (a) { return a && !/^(미사용인물코드|저자\s*미상|작자\s*미상|미상|unknown)$/i.test(a) }).join(', ')
}

async function handleImg (u, res, cfg) {
  const known = new Set(readJson(DATA.recs).items.map(function (it) { return it.thumbnail }).filter(Boolean))
  const target = imgAllowed(u.searchParams.get('u') || '', cfg.allowedHosts, known)
  if (!target) return send(res, 400, { reason: 'not-allowed' })
  const ck = target.href
  const hit = imgCache.get(ck)
  if (hit && hit.none) return send(res, 404, { reason: 'no-cover' })
  if (hit) { res.writeHead(200, { 'Content-Type': hit.type, 'Cache-Control': 'private, max-age=86400' }); return res.end(hit.buf) }
  try {
    // 넘겨주기(redirect)는 따라가지 않음: 허용 도메인 밖으로 나가는 것을 막음
    const r = await fetch(target.href, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
    const type = r.headers.get('content-type') || ''
    if (r.status !== 200 || !/^image\/(jpeg|png|webp|gif)$/.test(type.split(';')[0].trim())) return send(res, 502, { reason: 'upstream' })
    // 크기: 알려 준 길이를 먼저 보고, 받는 도중에도 넘으면 끊음
    if (Number(r.headers.get('content-length') || 0) > cfg.maxBytes) return send(res, 502, { reason: 'too-big' })
    const chunks = []
    let size = 0
    for await (const c of r.body) {
      size += c.length
      if (size > cfg.maxBytes) return send(res, 502, { reason: 'too-big' })
      chunks.push(c)
    }
    const buf = Buffer.concat(chunks)
    if (imgCache.size >= cfg.cacheMax) imgCache.delete(imgCache.keys().next().value)
    // 서점의 '제공된 상품이미지가 없습니다' 그림은 표지가 아님 → 없음으로 알려 화면이 책 아이콘을 보이게 (운영 지적 2026-11-15)
    if (isPlaceholderCover(buf, cfg)) { imgCache.set(ck, { none: true }); return send(res, 404, { reason: 'no-cover' }) }
    imgCache.set(ck, { type: type, buf: buf })
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' })
    res.end(buf)
  } catch (e) { send(res, 502, { reason: 'upstream' }) }
}

// 영상 출처 묶음 (정보용). 표시 순서에는 더 쓰지 않음 — 사용자 결정 2026-11-12: EBS 우선순위 폐지
function sourceGroup (it) { return it.kind === 'course' ? 0 : it.channelGroup === 'other' ? 2 : 1 }

// 제목이 해설강의인가 (수능 대비 학생에게만 '수능 해설'로 따로)
function isExam (title, filters) {
  const t = normTitle(title)
  return ((filters && filters.examWords) || []).some(function (w) { return t.includes(normTitle(w)) })
}

// 책이 이 단원에 맞는가: 이 단원 말이 제목에 있으면 맞음, 같은 과목의 다른 단원 말만 있으면 안 맞음, 단원 말이 없으면(과목 전체 책) 맞음
function unitWordList (u, filters) {
  const map = (filters && filters.unitWords) || {}
  return (map[u] || [u]).map(normTitle).filter(function (w) { return w.length >= 2 })
}
function bookFitsUnit (title, unit, units, filters, courseNames) {
  if (!unit || unit === '*') return true
  const own = unitWordList(unit, filters)
  const others = (units || []).filter(function (u) { return u !== unit })
  const otherWords = [].concat.apply([], others.map(function (u) { return unitWordList(u, filters) }))
  // 과목 이름은 먼저 지움 ('확률과 통계'의 '통계', '언어와 매체'의 '매체'가 단원 말로 잡히지 않게)
  let base = normTitle(title)
  ;(courseNames || []).map(normTitle).filter(Boolean).sort(function (a, b) { return b.length - a.length })
    .forEach(function (n) { base = base.split(n).join('|') })
  // '비문학'처럼 이 단원 말(문학)을 품은 다른 단원 말은 먼저 지움
  let t = base
  otherWords.filter(function (o) { return own.some(function (w) { return o !== w && o.includes(w) }) })
    .forEach(function (o) { t = t.split(o).join('|') })
  if (own.some(function (w) { return t.includes(w) })) return true
  return !otherWords.some(function (w) { return base.includes(w) })
}
// EBS 수능 연계 강의 제목: 수능특강·수특·수능완성·수완, 'ebs27'·'27 수특'처럼 연도 붙은 연계 표시
function isEbsLinked (title) {
  const t = String(title || '').toLowerCase().replace(/\s+/g, '')
  return /수능특강|수특|수능완성|수완|ebs연계|연계교재|ebs2\d|2\d수특|2\d수완/.test(t)
}

// 수능 연계·기출 교재 (수능 대비 학생에게만, 운영 결정 2026-11-12)
function isExamBook (title) {
  return /수능특강|수능완성|기출|모의고사|수능\s*대비/.test(String(title || ''))
}

// 중학 책의 학년 표시가 이 학년인가 (표시가 없으면 통과). "중학 국어 2-1"·"중2"·"2학년"·"중학 영어1"
function bookGradeOk (title, n) {
  const t = String(title || '').replace(/\s+/g, '')
  const marks = gradeTerms(t).map(function (x) { return x.g })
    .concat((t.match(/중등?([123])|([123])학년/g) || []).map(function (x) { return x.replace(/\D/g, '') }))
    .concat((t.match(/(국어|영어|수학)([123])(?![0-9\-])/g) || []).map(function (x) { return x.replace(/\D/g, '') }))
  return !marks.length || marks.indexOf(String(n)) !== -1
}

// 책 순서 점수: 단원 말 +3, 대표 출판사 +1, 최근 판(2018 → 0 … 2026 → 1), 자습서·개념서·교과서 +0.5
const MAIN_BOOK_PUBLISHERS = ['개념원리', '신사고', '비상', '천재', '미래엔', '능률', '쎄듀', '마더텅', '동아출판', '지학사', 'EBS', '한국교육방송']
function bookScore (it, unit, units, filters, names) {
  let s = 0
  if (unit && unit !== '*') {
    const own = unitWordList(unit, filters)
    let t = normTitle(it.title)
    ;(names || []).map(normTitle).filter(Boolean).forEach(function (n) { t = t.split(n).join('|') })
    if (own.some(function (w) { return t.includes(w) })) s += 3
  }
  const p = String(it.provider || '') + ' ' + String(it.title || '')
  if (MAIN_BOOK_PUBLISHERS.some(function (m) { return p.includes(m) })) s += 1
  s += Math.min(1, Math.max(0, (Number(it.year) - 2018) / 8))
  if (/자습서|개념|교과서|기본서/.test(String(it.title || ''))) s += 0.5
  return s
}

// 같은 시리즈의 다른 판(괄호 안 연도, '완성 2000제' 등)을 하나로 보는 열쇠
function seriesKey (title) {
  // 단계만 다른 같은 시리즈(기본·실력·완성·Level 1 등)도 하나로 (중2 영어 독해 '수작 … 기본/완성', 2026-11-15)
  return normTitle(String(title || '').replace(/\([^)]*\)/g, '')).replace(/level|lv\.?/g, '').replace(/\d+제?/g, '')
    .replace(/완성|기본|실력|심화|입문|발전|국어|영어|수학/g, '')
}

/* ---------- 승인된 추천 ---------- */
// 미리보기 서버: 주소에서 값을 읽고 파일을 연 뒤 computeRecs 결과를 보냄
function handleRecs (u, res) {
  const courses = (u.searchParams.get('course') || '').split(',').filter(Boolean)
  if (!courses.length) return send(res, 400, { reason: 'no-course' })
  send(res, 200, computeRecs({
    courses: courses, unit: u.searchParams.get('unit') || '*', school: u.searchParams.get('school') || '',
    purpose: u.searchParams.get('purpose') || '', grade: u.searchParams.get('grade') || '', max: u.searchParams.get('max')
  }, { src: readJson(DATA.sources), curriculum: readJson(DATA.curriculum), items: readJson(DATA.recs).items, chStats: readStats().channels || {} }))
}

// 추천 계산 (순수 함수: 파일·요청을 직접 다루지 않음). 미리보기 서버와 1-B 빌드 스크립트가 같이 씀 (docs/1b-design.md 2-1)
// q = { courses: [과목 id…], unit, school: 'middle'|'high', purpose, grade: 'm1'…'h3', max }
// data = { src: sources.json, curriculum: curriculum.json, items: recommendations.json items, chStats: 채널 id → { subs } }
function computeRecs (q, data) {
  const courses = q.courses
  const unit = q.unit || '*'
  const src = data.src
  const filters = src.filters
  // 사용자가 끈 다른 선생님 채널 (sources.otherChannels enabled:false)
  const offOther = {}
  ;(src.otherChannels || []).forEach(function (c) { if (c.enabled === false) offOther[c.id] = true })
  // 수능 해설은 학습 목적이 '수능 대비'·'둘 다'인 학생에게만
  const purpose = q.purpose || ''
  const wantsExam = purpose === 'suneung' || purpose === 'both'
  // 코스 id → 교육과정 (연도 기준이 교육과정마다 다름)
  const curOf = {}, courseOf = {}
  data.curriculum.courses.forEach(function (c) { curOf[c.id] = c.curriculum; courseOf[c.id] = c })
  const usable = function (it) {
    if (!it.review || it.review.status !== 'approved' || courses.indexOf(it.courseId) === -1) return false
    // 규칙 위반(오래된·예비과정) 영상, 사용자가 끈 채널은 승인돼 있어도 내보내지 않음
    if (videoRuleFails(it, filters, ruleCurriculum(courseOf[it.courseId]))) return false
    if (it.channelGroup === 'other' && offOther[it.channelId]) return false
    return true
  }
  // 2022 과목의 EBS 수능 연계 강의(수능특강·수특·수능완성·'ebs27' 등)도 수능 대비 묶음으로 (운영 표본 2026-11-12: 고2 문학 개념 칸이 고3 수능특강 강의로 채워짐)
  // 2015 고3 과목은 그대로 개념 칸 (사용자 결정 2026-11-12 '고3 2015 수능특강·수능완성은 개념')
  const exam = function (it) {
    if (it.kind === 'book') return false
    if (it.examSolution || isExam(it.title, filters)) return true
    return curOf[it.courseId] === '2022' && isEbsLinked(it.title)
  }
  // 영상은 그 단원·과목 전체, 책은 과목 단위라 단원과 상관없이 그 과목(코스) 것
  const all = data.items.filter(function (it) {
    if (!usable(it)) return false
    return it.kind === 'book' || unit === '*' || it.unit === unit || it.unit === '*'
  })
  // 이 단원 항목 먼저 → 같은 묶음 안에서는 추천순 (출처 구분 없음, 사용자 결정 2026-11-12 EBS 우선순위 폐지)
  // 인기도(조회수·채널 구독자수·최근성)를 추천 점수에 더함 (사용자 요청 2026-11-12)
  const chStats = data.chStats || {}
  const order = function (list) {
    const sorted = sortRecs(list.map(function (it) {
      const subs = (chStats[it.channelId] || {}).subs
      // 단원 일치(아래 rank) 다음은 인기도가 순서를 정함. 기존 추천 점수(재생목록·길이 등)는 0.3배로만 (운영 지시 2026-11-12)
      return Object.assign({}, it, { score: popScore(it, subs) + 0.3 * (it.score || 0) })
    }))
    // 사용자 결정 2026-11-12(EBS 우선순위 폐지, "다른 강의/강사 EBS 고집할 필요 없음"): 출처와 관계없이
    // 이 단원 강의 먼저 → 같은 묶음 안에서는 추천순(단원·과목 일치, 재생목록, 길이, 조회수)
    const rank = function (it) { return unit !== '*' && it.unit === unit ? 0 : 10 }
    return sorted.map(function (it, i) { return { it: it, i: i } })
      .sort(function (a, b) { return (rank(a.it) - rank(b.it)) || (a.i - b.i) })
      .map(function (x) { return x.it })
  }
  const show = src.display || {}
  // EBSi 강좌 링크는 최대 maxCourseLinks개(기본 2)까지만. 이 단원 영상이 있으면 1개만 (리뷰 권장 1 (가), 사용자 확인 요청 중)
  const hasUnitVideos = unit !== '*' && all.some(function (it) { return (it.kind === 'playlist' || it.kind === 'video') && it.unit === unit && !exam(it) })
  const maxCourse = hasUnitVideos ? 1 : (show.maxCourseLinks || 2)
  const uniq = function (list, max) {
    const seen = {}
    let nCourse = 0
    const cand = list.filter(function (it) {
      if (seen[it.url]) return false
      if (it.kind === 'course' && ++nCourse > maxCourse) return false
      seen[it.url] = true
      return true
    })
    // 여러 선생님 강의가 고루 나오게: 1차로 채널마다 1개씩(추천순 유지), 남은 칸은 나머지로 채움
    // (EBS 우선순위 폐지 뒤 한 채널의 과목 재생목록이 모든 단원을 채우던 문제 — 리뷰 권장 1)
    const chKey = function (it) { return it.kind === 'course' ? 'ebsi-course' : (it.channelId || it.provider || it.url) }
    const used = {}
    const first = [], rest = []
    cand.forEach(function (it) {
      const k = chKey(it)
      if (!used[k]) { used[k] = true; first.push(it) } else rest.push(it)
    })
    const picked = first.slice(0, max)
    if (picked.length < max) picked.push.apply(picked, rest.slice(0, max - picked.length))
    // 고른 것은 원래 추천순으로 다시 정렬
    // forUnit: 이 단원 전용 강의인지 (화면이 과목 탭 안에서 중복을 뺄 때 단원 전용을 먼저 배치하는 데 씀)
    return picked.sort(function (a, b) { return cand.indexOf(a) - cand.indexOf(b) }).map(function (it) {
      const p = publicItem(it)
      p.forUnit = unit !== '*' && it.unit === unit
      // 진로·융합 과목에 넣은 예전 교육과정 강의는 화면에 작게 표시 (사용자 요청 2026-11-15)
      if (oldCurriculumVideo(courseOf[it.courseId], it)) p.oldCurriculum = true
      return p
    })
  }
  const pick = function (kinds, max, filterFn) {
    return uniq(order(all.filter(function (it) { return kinds.indexOf(it.kind) !== -1 && (!filterFn || filterFn(it)) })), max)
  }
  const school = q.school === 'middle' ? 'middle' : 'high'
  const link = (src.siteLinks || {})[school]
  // max: 화면이 과목 탭 안에서 중복을 뺀 뒤 다음 후보로 채울 수 있게 여유분을 받을 때 (최대 8). 화면이 3개·2권으로 다시 줄임
  const askMax = Math.min(Math.max(Number(q.max) || 0, 0), 8)
  const maxV = askMax || show.maxVideosPerArea || 3
  const VKINDS = ['course', 'playlist', 'video']
  // 영역당 강의 최대 3개, 책 최대 2권 (사용자 결정 2026-11-12, data/sources.json display). 해설강의는 빼고
  let videos = pick(VKINDS, maxV, function (it) { return !exam(it) })
  // 이 단원 강의가 아직 없으면: 같은 과목의 다른 단원 승인 강의로 대체 (사용자 피드백: 대수 '수열'이 비어 보임)
  if (!videos.length && unit !== '*') {
    videos = uniq(order(data.items.filter(function (it) {
      return usable(it) && VKINDS.indexOf(it.kind) !== -1 && !exam(it)
    })), maxV)
  }
  // 수능 해설: 수능 대비 학생에게만, 개념 강의와 따로
  const examVideos = wantsExam ? pick(VKINDS, maxV, exam) : []
  // 'unit' = 이 단원 강의가 맨 앞, 'course' = 과목 전체·다른 단원 강의로 채움, 'none' = 없음
  const unitIds = {}
  all.forEach(function (it) { if (it.unit === unit) unitIds[it.id] = true })
  // EBSi 강좌 링크가 맨 앞에 와도, 이 단원 강의가 하나라도 있으면 'unit'
  const videosScope = !videos.length ? 'none' : (unit !== '*' && videos.some(function (v) { return unitIds[v.id] }) ? 'unit' : 'course')
  // 책: 단원에 맞게 (사용자 요청 2026-11-12). 같은 시리즈의 다른 판은 한 권만
  function pickBooks () {
    const units = [], names = []
    data.curriculum.courses.forEach(function (c) {
      if (courses.indexOf(c.id) === -1) return
      units.push.apply(units, c.units)
      names.push.apply(names, [c.label].concat(c.searchAlias || []))
    })
    const seenSeries = {}
    const g = /^[mh][123]$/.test(q.grade || '') ? q.grade : ''
    const examCourse = data.curriculum.courses.some(function (c) { return courses.indexOf(c.id) !== -1 && c.group === 'exam' })
    const ok = function (it) {
      // 수능 연계·기출 교재는 수능 대비 학생만 (수능 과목은 예외)
      if (school === 'high' && !wantsExam && !examCourse && isExamBook(it.title)) return false
      // 여러 학년이 같은 과목(중학 국어·영어): 다른 학년 표시가 있는 책은 뺌
      if (g && g[0] === 'm' && !bookGradeOk(it.title, g[1])) return false
      if (!bookFitsUnit(it.title, unit, units, filters, names)) return false
      const k = seriesKey(it.title)
      if (seenSeries[k]) return false
      seenSeries[k] = true
      return true
    }
    // 순서: 단원 일치 → 대표 출판사 → 최근 판 → 자습서·개념서 (EBS·시중 교재 구분 없음, 사용자 결정 2026-11-12)
    const books = all.filter(function (it) { return it.kind === 'book' })
      .map(function (it, i) { return { it: it, s: bookScore(it, unit, units, filters, names, src.publishers), i: i } })
      .sort(function (a, b) { return (b.s - a.s) || (a.i - b.i) })
      .map(function (x) { return x.it })
    return uniq(books.filter(ok), askMax || show.maxBooksPerArea || 2).map(function (p) {
      if (unit !== '*') p.reason = bookUnitReason(p, unit)
      return p
    })
  }
  return {
    videos: videos,
    videosScope: videosScope,
    examVideos: examVideos,
    books: pickBooks(),
    siteLink: link ? { label: link.label, url: link.url } : null
  }
}

/* ---------- 후보 찾기 ---------- */
async function handleCollect (req, res) {
  const body = await readBody(req)
  const cur = readJson(DATA.curriculum), src = readJson(DATA.sources)
  const course = cur.courses.filter(function (c) { return c.id === body.courseId })[0]
  const grade = String(body.grade || '')
  if (!course || !/^[mh][123]$/.test(grade) || ((cur.offer[grade] || {})[course.subject] || []).indexOf(course.id) === -1) return send(res, 400, { reason: 'bad-course' })
  const unit = course.units.indexOf(body.unit) !== -1 ? body.unit : null
  const school = grade[0] === 'h' ? 'high' : 'middle'
  const subjLabel = { korean: '국어', english: '영어', math: '수학' }[course.subject]
  const name = course.group === 'term' || course.group === 'all' ? subjLabel : (course.search || course.label)
  const gradeLabel = (grade[0] === 'h' ? '고' : '중') + grade[1]
  const ctx = {
    school: school, filters: src.filters, publishers: src.publishers, unit: unit, curriculum: ruleCurriculum(course),
    channelIds: src.youtubeChannels.filter(function (c) { return c.school === school }).map(function (c) { return c.id }),
    // 모든 EBS 채널(다른 선생님 강의와 구분용), 사용자가 끈 다른 선생님 채널
    ebsAll: src.youtubeChannels.map(function (c) { return c.id }),
    otherOff: (src.otherChannels || []).reduce(function (m, c) { if (c.enabled === false) m[c.id] = true; return m }, {})
  }
  const keys = readKeys()
  // booksOnly: 책만 찾기 (카카오만, YouTube 할당량 0)
  const booksOnly = body.booksOnly === true
  if (!keys.KAKAO_REST_API_KEY || (!booksOnly && !keys.YOUTUBE_API_KEY)) return send(res, 503, { reason: 'no-key' })
  // 검색어: 학년·과목·단원 이름만 (개인정보 없음)
  const q = (school === 'middle' ? gradeLabel + ' ' + subjLabel : name) + (unit ? ' ' + unit : '')
  // 재생목록 제목과 맞출 이름: 과목 이름 + 별칭(2022 과목의 2015 이름 등, EBS 조사 추천 1)
  const names = [name].concat(course.searchAlias || [])
  const usage = { units: 0 }
  let found = []
  let missing = []
  // 기본은 채널 목록 캐시 방식(할당량 적음). search.list는 body.useSearch === true 일 때만 (원칙적으로 쓰지 않음)
  const useSearch = body.useSearch === true
  ctx.gradeLabel = school === 'middle' ? gradeLabel : ''
  // 중학교 학기 과목: '1학기' → '1' (과목 전체 재생목록의 학년·학기 표시 확인용)
  ctx.term = school === 'middle' && course.group === 'term' ? String(course.label || '').charAt(0) : ''
  // 같은 교과 다른 과목 이름이 제목에 있으면 뺌 (과목명 혼동, 운영 표본 2026-11-13)
  // 진로·융합(relaxed) 과목은 단원 주제가 같은 다른 과목 강의(예: 통계적 탐구 ← 확률과 통계 통계 단원)도 허용 (사용자 요청 2026-11-15)
  ctx.otherKeys = course.relaxedVideo ? [] : otherCourseKeys(cur.courses, course)
  // 원래 짧은 유형의 단원은 최소 길이를 낮춤 (예: 영어 어휘·듣기 10분, filters.minVideoMinutesByUnit)
  const shortRule = ((src.filters.minVideoMinutesByUnit || {})[course.subject] || {})
  if (unit && shortRule[unit]) ctx.minMinutes = shortRule[unit]
  // 영상이 거의 없는 진로·융합 과목: 10분 이상, 대학 전공·공무원·자격증 강의는 뺌 (사용자 요청 2026-11-15, filters.relaxedVideo)
  const relaxed = course.relaxedVideo ? (src.filters.relaxedVideo || {}) : null
  if (relaxed) { ctx.minMinutes = relaxed.minMinutes || 10; ctx.extraBlock = relaxed.blockWords || [] }
  try {
    let pls = [], vids = [], others = []
    if (!booksOnly && !useSearch && body.searchOther !== true) {
      if (usedToday() >= DAILY_UNIT_LIMIT) return send(res, 429, { reason: 'daily-limit', usedToday: usedToday() })
      // 과목 이름(중학교는 '수학'·'국어'·'영어')이 제목에 있어야 함. 학년(중2)만으로는 맞추지 않음
      // (학년만으로 맞추면 다른 과목 재생목록이 걸림 — 2026-11-12 확인. 다른 학년 표시는 gradeConflict가 뺌)
      const cacheNames = names
      const channels = src.youtubeChannels.filter(function (c) { return c.school === school }).map(function (c) { return { id: c.id, name: c.name, group: 'ebs' } })
        .concat((src.otherChannels || []).filter(function (c) { return c.enabled !== false && (!c.school || c.school === school) }).map(function (c) { return { id: c.id, name: c.name, group: 'other' } }))
      const r = await collectFromCache(channels, cacheNames, unit, ctx, course.searchExclude, keys.YOUTUBE_API_KEY, usage)
      pls = r.pls
      vids = r.vids
      missing = r.missing
    }
    // 다른 선생님 검색만 (EBS 채널은 캐시에 이미 있음, 단원당 101 units): body.searchOther === true
    if (!booksOnly && body.searchOther === true && unit) {
      if (usedToday() >= DAILY_UNIT_LIMIT) return send(res, 429, { reason: 'daily-limit', usedToday: usedToday() })
      // 진로·융합(relaxed) 과목만: 다른 검색어(altQuery, 40자)와 단원 대신 맞출 말(altWords, 6개) 허용 (빈 단원 재검색, 사용자 요청 2026-11-15)
      let sq = q
      if (course.relaxedVideo) {
        if (typeof body.altQuery === 'string' && body.altQuery.trim()) sq = body.altQuery.trim().slice(0, 40)
        if (Array.isArray(body.altWords)) ctx.altWords = body.altWords.filter(function (w) { return typeof w === 'string' && w.trim().length >= 2 }).slice(0, 6).map(function (w) { return w.trim().slice(0, 20) })
      }
      others = await searchOtherVideos(sq, ctx, keys.YOUTUBE_API_KEY, usage)
      recordOtherChannels(others)
    }
    if (!booksOnly && useSearch) {
      const all = await listChannelPlaylists(ctx.channelIds[0], keys.YOUTUBE_API_KEY, usage)
      pls = matchPlaylists(all, names, unit, ctx, course.searchExclude).slice(0, 5)
      vids = await searchLongVideos(q, ctx, keys.YOUTUBE_API_KEY, usage)
      // EBS에서 이 단원 개념 강의를 3개 못 채우면 다른 선생님 무료 강의도 찾음 (사용자 결정 2026-11-12 v3)
      const goodEbs = pls.filter(function (p) { return p.unitMatch }).length + vids.filter(function (v) { return v.unitMatch && !v.examSolution }).length
      if (unit && goodEbs < 3 && body.skipOther !== true) {
        others = await searchOtherVideos(q, ctx, keys.YOUTUBE_API_KEY, usage)
        recordOtherChannels(others)
      }
    }
    // 책 검색어: 기본 + 과목에 적어 둔 다른 표기(bookSearch, 예: '미적분Ⅱ' → '미적분 2', '경제 수학' → '경제수학')
    // 이 과목을 듣는 학년들 (중학 '국어'·'영어'는 여러 학년이 같은 과목)
    const grades = Object.keys(cur.offer).filter(function (g) { return g[0] === grade[0] && ((cur.offer[g] || {})[course.subject] || []).indexOf(course.id) !== -1 }).map(function (g) { return g[1] })
    ctx.bookCourse = {
      names: [name].concat(course.searchAlias || [], course.bookSearch || []), excludes: course.searchExclude || [], school: school,
      curriculum: course.curriculum, term: course.group === 'term' ? String(course.label).charAt(0) : '', grades: grades,
      exam: course.group === 'exam', subjLabel: subjLabel, relaxed: !!course.relaxedVideo,
      // 2015 과목 이름 중 이 과목 자기 이름이 아닌 것 (문학·기하처럼 두 교육과정에 같은 이름이 있으면 자기 이름은 그대로 씀)
      oldNames: course.curriculum === '2022' ? cur.courses.filter(function (c) { return c.curriculum === '2015' }).map(function (c) { return normTitle(c.label) })
        .filter(function (n) { return n !== normTitle(name) }) : []
    }
    const books = await collectBooks(bookQueries(course, name, unit, grades), ctx, keys.KAKAO_REST_API_KEY)
    found = pls.concat(vids, others, books)
  } catch (e) { addUsage(usage.units); return send(res, 502, { reason: 'upstream', units: usage.units }) }
  const used = addUsage(usage.units)
  const added = await writeRecs(function (data) {
    let n = 0
    found.forEach(function (f) {
      // 책, 제목에 단원 이름이 없는 재생목록·영상은 과목 단위(unit '*'). 제목에 단원 이름이 있을 때만 그 단원
      const itemUnit = f.kind === 'book' || !f.unitMatch ? '*' : (unit || '*')
      const id = course.id + '|' + itemUnit + '|' + f.kind + ':' + f.sourceId
      const exist = data.items.filter(function (x) { return x.id === id })[0]
      const fresh = Object.assign({}, f, {
        id: id, courseId: course.id, unit: itemUnit, isFree: f.kind !== 'book',
        // 2022 개정 과목은 2024년 이후 영상을 우선 (preferVideoYearByCurriculum, 추천순 +2)
        score: rankScore(f, f.kind === 'book' ? null : unit, name) +
          (f.kind !== 'book' && Number(f.year) >= ((src.filters.preferVideoYearByCurriculum || {})[course.curriculum] || 9999) ? 2 : 0),
        lastCheckedAt: today()
      })
      delete fresh.sourceId
      delete fresh.unitMatch
      if (exist) {
        // 승인했거나 제외한 항목은 덮지 않음 (사용자가 확인한 내용·날짜를 지킴)
        if (exist.review.status === 'approved' || exist.review.status === 'retired') return
        Object.assign(exist, fresh, { review: exist.review, reason: exist.reason, rank: exist.rank })
        return
      }
      fresh.reason = ''
      fresh.review = { status: 'candidate', checkedBy: null, approvedAt: null }
      data.items.push(fresh)
      n += 1
    })
    return n
  })
  send(res, 200, { query: q, found: found.length, added: added, units: usage.units, usedToday: used, mode: useSearch ? 'search' : 'cache', notSynced: missing })
}

// 코스·학년 확인 (후보 찾기·주소 추가 공통)
function pickCourse (cur, body) {
  const course = cur.courses.filter(function (c) { return c.id === body.courseId })[0]
  const grade = String(body.grade || '')
  if (!course || !/^[mh][123]$/.test(grade) || ((cur.offer[grade] || {})[course.subject] || []).indexOf(course.id) === -1) return null
  return { course: course, grade: grade, unit: course.units.indexOf(body.unit) !== -1 ? body.unit : '*' }
}

// 채널 목록 받기: POST /api/sync {channelId?, maxUnits?, force?} — 채널 id가 없으면 허용 채널 전부
async function handleSync (req, res) {
  const body = await readBody(req)
  const src = readJson(DATA.sources)
  const key = readKeys().YOUTUBE_API_KEY
  if (!key) return send(res, 503, { reason: 'no-key' })
  const all = src.youtubeChannels.map(function (c) { return { id: c.id, name: c.name } })
    .concat((src.otherChannels || []).filter(function (c) { return c.enabled !== false }).map(function (c) { return { id: c.id, name: c.name } }))
  const list = body.channelId ? all.filter(function (c) { return c.id === body.channelId }) : all
  if (!list.length) return send(res, 400, { reason: 'unknown-channel' })
  // 하루 70% 안에서만 (오늘 이미 쓴 만큼 뺌)
  const room = DAILY_UNIT_LIMIT - usedToday()
  const want = Math.max(1, Math.min(Number(body.maxUnits) || 2000, 5000))
  let budget = Math.min(want, room)
  if (budget <= 0) return send(res, 429, { reason: 'daily-limit', usedToday: usedToday() })
  const usage = { units: 0 }
  const results = []
  try {
    for (const c of list) {
      if (usage.units >= budget) { results.push({ id: c.id, name: c.name, skipped: 'budget' }); continue }
      results.push(await syncChannel(c.id, c.name, key, usage, budget - usage.units, body.force === true))
    }
  } catch (e) {
    addUsage(usage.units)
    return send(res, 502, { reason: 'upstream', units: usage.units, results: results })
  }
  send(res, 200, { units: usage.units, usedToday: addUsage(usage.units), results: results })
}

// 주소 직접 추가: POST /api/add-url {url, grade, courseId, unit}
// YouTube oEmbed(키·할당량 없음)로 제목·채널·썸네일. 키가 있으면 영상은 videos.list 1 unit로 게시 연도·길이도 확인
async function handleAddUrl (req, res) {
  const body = await readBody(req)
  const cur = readJson(DATA.curriculum), src = readJson(DATA.sources)
  const p = pickCourse(cur, body)
  if (!p) return send(res, 400, { reason: 'bad-course' })
  const ref = parseYouTubeUrl(body.url)
  if (!ref) return send(res, 400, { reason: 'bad-url' })
  const canon = ref.type === 'video' ? 'https://www.youtube.com/watch?v=' + ref.id : 'https://www.youtube.com/playlist?list=' + ref.id
  let o
  try { o = await getJson('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(canon)) } catch (e) { return send(res, 502, { reason: 'oembed' }) }
  const thumb = /^https:\/\/i\.ytimg\.com\//.test(o.thumbnail_url || '') ? o.thumbnail_url : ''
  const item = {
    kind: ref.type, title: decodeEntities(o.title).slice(0, 200), provider: decodeEntities(o.author_name).slice(0, 80),
    year: '', thumbnail: thumb, url: canon, isFree: true, addedBy: 'url'
  }
  // EBS 여부는 채널 '이름'이 아니라 실제 채널 id로 정함 (이름은 누구나 같게 지을 수 있음 — 리뷰 권장 2)
  // 영상은 videos.list, 재생목록은 playlists.list (각 1 unit)로 채널 id·게시 연도를 확인. 확인 못 하면 'other'
  const usage = { units: 0 }
  const key = readKeys().YOUTUBE_API_KEY
  if (key) {
    try {
      const j = await getJson(YT + (ref.type === 'video' ? 'videos?part=snippet,contentDetails,statistics&id=' : 'playlists?part=snippet,contentDetails&id=') +
        ref.id + '&key=' + encodeURIComponent(key))
      usage.units += 1
      const v = (j.items || [])[0]
      if (v) {
        item.year = String((v.snippet || {}).publishedAt || '').slice(0, 4)
        item.channelId = (v.snippet || {}).channelId || ''
        if (ref.type === 'video') {
          item.durationMin = isoMinutes((v.contentDetails || {}).duration)
          item.views = Number((v.statistics || {}).viewCount || 0)
        } else item.itemCount = (v.contentDetails || {}).itemCount || 0
      }
    } catch (e) { /* 채널 id·연도는 비워 둠 → 'other' */ }
    addUsage(usage.units)
  }
  const ebs = item.channelId ? src.youtubeChannels.filter(function (c) { return c.id === item.channelId })[0] : null
  item.channelGroup = ebs ? 'ebs' : 'other'
  // 연도를 모르면 규칙(교육과정 기준 연도) 확인이 안 되므로 승인할 때 보이게 표시
  if (!item.year) item.yearUnknown = true
  if (videoRuleFails(item, src.filters, p.course.curriculum)) return send(res, 400, { reason: 'video-rule', title: item.title })
  if (item.channelGroup === 'other' && item.channelId) recordOtherChannels([item])
  const id = p.course.id + '|' + p.unit + '|' + ref.type + ':' + ref.id
  const added = await writeRecs(function (data) {
    if (data.items.some(function (x) { return x.id === id })) return 'exists'
    data.items.push(Object.assign(item, {
      id: id, courseId: p.course.id, unit: p.unit, score: rankScore(item, p.unit === '*' ? null : p.unit, p.course.label) + 1,
      lastCheckedAt: today(), reason: '', review: { status: 'candidate', checkedBy: null, approvedAt: null }
    }))
    return ''
  })
  if (added === 'exists') return send(res, 409, { reason: 'exists' })
  send(res, 200, { ok: true, id: id, title: item.title, provider: item.provider, channelGroup: item.channelGroup, units: usage.units })
}

// 다른 선생님 채널 추가: POST /api/add-channel {channel, school?} — @핸들·채널 주소·채널 id, channels.list 1 unit
async function handleAddChannel (req, res) {
  const body = await readBody(req)
  const ref = parseChannelRef(body.channel)
  if (!ref) return send(res, 400, { reason: 'bad-channel' })
  const key = readKeys().YOUTUBE_API_KEY
  if (!key) return send(res, 503, { reason: 'no-key' })
  let j
  try {
    j = await getJson(YT + 'channels?part=snippet&' + (ref.id ? 'id=' + ref.id : 'forHandle=' + encodeURIComponent(ref.handle)) + '&key=' + encodeURIComponent(key))
  } catch (e) { return send(res, 502, { reason: 'upstream' }) }
  addUsage(1)
  const ch = (j.items || [])[0]
  if (!ch || !validChannelId(ch.id)) return send(res, 404, { reason: 'no-channel' })
  const src = readJson(DATA.sources)
  if (src.youtubeChannels.some(function (c) { return c.id === ch.id })) return send(res, 409, { reason: 'is-ebs' })
  src.otherChannels = src.otherChannels || []
  const school = body.school === 'middle' || body.school === 'high' ? body.school : ''
  const exist = src.otherChannels.filter(function (c) { return c.id === ch.id })[0]
  if (exist) { exist.enabled = true; if (school) exist.school = school } else {
    src.otherChannels.push({ id: ch.id, name: decodeEntities((ch.snippet || {}).title).slice(0, 80), handle: ref.handle || '', school: school, enabled: true, addedAt: today() })
  }
  const tmp = DATA.sources + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(src, null, 2) + '\n')
  fs.renameSync(tmp, DATA.sources)
  send(res, 200, { ok: true, id: ch.id, name: decodeEntities((ch.snippet || {}).title) })
}

/* ---------- 인기도 (사용자 요청 2026-11-12: "추천순이나 인기 많은 순·구독자수 등으로 판별") ----------
   채널 구독자수(channels.list 50개당 1 unit)는 data/youtube-cache/channel-stats.json 에 (YouTube 자료라 커밋하지 않음).
   영상 조회수(videos.list 50개당 1 unit)는 승인 항목의 views 를 새로 고침. 재생목록은 조회수가 없어 채널 구독자수만 씀. */
const STATS_FILE = path.join(CACHE_DIR, 'channel-stats.json')
function readStats () {
  try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) } catch (e) { return { channels: {} } }
}
const SMALL_CHANNEL = 1000 // 구독자 이보다 적은 채널은 뒤로 (운영 지시 2026-11-12, 빼지는 않음)

// 인기도 점수: 조회수(10만 회 ≈ 1.25, 최대 1.5) + 구독자수(100만 명 ≈ 1, 최대 1) + 최근성(최대 0.5). 작은 채널 -1
// EBSi 강좌 링크는 조회수·채널 값이 없어 중간값 1.5
function popScore (it, subs) {
  if (it.kind === 'book') return 0
  if (it.kind === 'course') return 1.5
  let s = 0
  if (it.views) s += Math.min(1.5, Math.log10(it.views + 1) / 4)
  // 재생목록은 조회수가 없어 중간값(조회 1천 회 정도)
  else if (it.kind === 'playlist') s += 0.75
  if (typeof subs === 'number') {
    s += Math.min(1, Math.log10(subs + 1) / 6)
    if (subs < SMALL_CHANNEL) s -= 1
  }
  const y = Number(it.year) || 0
  if (y) s += Math.min(0.5, Math.max(0, (y - 2018) / 16))
  return Math.round(s * 100) / 100
}

function videoIdOf (it) {
  const m = String(it.url || '').match(/[?&]v=([A-Za-z0-9_-]{11})/)
  return m ? m[1] : ''
}

async function handleStats (req, res) {
  await readBody(req)
  const keys = readKeys()
  if (!keys.YOUTUBE_API_KEY) return send(res, 503, { reason: 'no-key' })
  const data = readJson(DATA.recs)
  const approved = data.items.filter(function (it) { return it.review && it.review.status === 'approved' })
  const chIds = [], vIds = []
  approved.forEach(function (it) {
    if (validChannelId(it.channelId) && chIds.indexOf(it.channelId) === -1) chIds.push(it.channelId)
    const v = it.kind === 'video' ? videoIdOf(it) : ''
    if (v && vIds.indexOf(v) === -1) vIds.push(v)
  })
  const need = Math.ceil(chIds.length / 50) + Math.ceil(vIds.length / 50)
  if (usedToday() + need > DAILY_UNIT_LIMIT) return send(res, 429, { reason: 'daily-limit', usedToday: usedToday(), need: need })
  const usage = { units: 0 }
  const stats = readStats()
  stats.channels = stats.channels || {}
  const views = {}
  try {
    for (let i = 0; i < chIds.length; i += 50) {
      const j = await getJson(YT + 'channels?part=statistics&id=' + chIds.slice(i, i + 50).join(',') + '&key=' + encodeURIComponent(keys.YOUTUBE_API_KEY))
      usage.units += 1
      ;(j.items || []).forEach(function (c) {
        const st = c.statistics || {}
        stats.channels[c.id] = { subs: st.hiddenSubscriberCount ? null : Number(st.subscriberCount || 0), at: today() }
      })
    }
    for (let i = 0; i < vIds.length; i += 50) {
      const j = await getJson(YT + 'videos?part=statistics&id=' + vIds.slice(i, i + 50).join(',') + '&key=' + encodeURIComponent(keys.YOUTUBE_API_KEY))
      usage.units += 1
      ;(j.items || []).forEach(function (v) { views[v.id] = Number((v.statistics || {}).viewCount || 0) })
    }
  } catch (e) { addUsage(usage.units); return send(res, 502, { reason: 'upstream', units: usage.units }) }
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(STATS_FILE + '.tmp', JSON.stringify(stats) + '\n')
  fs.renameSync(STATS_FILE + '.tmp', STATS_FILE)
  const updated = await writeRecs(function (d) {
    let n = 0
    d.items.forEach(function (it) {
      const v = it.kind === 'video' ? videoIdOf(it) : ''
      if (v && typeof views[v] === 'number') { it.views = views[v]; n += 1 }
    })
    return n
  })
  const used = addUsage(usage.units)
  send(res, 200, { channels: Object.keys(stats.channels).length, videos: updated, units: usage.units, usedToday: used })
}

function handleUsage (res) {
  const src = readJson(DATA.sources)
  const chans = src.youtubeChannels.map(function (c) { return { id: c.id, name: c.name, group: 'ebs' } })
    .concat((src.otherChannels || []).map(function (c) { return { id: c.id, name: c.name, group: 'other', enabled: c.enabled !== false } }))
  send(res, 200, {
    usedToday: usedToday(), limit: DAILY_UNIT_LIMIT,
    channels: chans.map(function (c) {
      const k = readCache(c.id)
      return Object.assign(c, { uploads: k ? k.uploads.length : 0, complete: !!(k && k.complete), syncedAt: k ? k.syncedAt : '' })
    })
  })
}

async function handleReview (req, res) {
  const body = await readBody(req)
  if (typeof body.id !== 'string' || typeof body.status !== 'string') return send(res, 400, { reason: 'bad-input' })
  const cur = readJson(DATA.curriculum)
  const srcFilters = readJson(DATA.sources).filters
  const result = await writeRecs(function (data) {
    const it = data.items.filter(function (x) { return x.id === body.id })[0]
    if (!it) return 'not-found'
    const why = canSetStatus(it, body.status)
    if (why) return why
    // 2020년 이전·예비과정 영상은 승인할 수 없음 (사용자 결정 2026-11-12)
    const itCourse = cur.courses.filter(function (x) { return x.id === it.courseId })[0]
    if (body.status === 'approved' && videoRuleFails(it, srcFilters, ruleCurriculum(itCourse))) return 'video-rule'
    // 제외 사유(선택, 100자): 내부 기록용
    if (typeof body.note === 'string' && body.note.trim()) it.review.note = body.note.trim().slice(0, 100)
    // 이유 고치기(선택): 글을 보냈으면 그것을, 아니면 승인할 때 비어 있으면 자동으로
    if (typeof body.reason === 'string' && body.reason.trim()) it.reason = body.reason.trim().slice(0, 200)
    if (body.status === 'approved' && !String(it.reason || '').trim()) {
      const c = cur.courses.filter(function (x) { return x.id === it.courseId })[0]
      it.reason = autoReason(it, c && c.label)
    }
    // 승인일은 처음 승인할 때만 기록 (이유만 고칠 때는 그대로)
    if (body.status === 'approved') it.review.approvedAt = it.review.status === 'approved' && it.review.approvedAt ? it.review.approvedAt : today()
    else it.review.approvedAt = null
    it.review.status = body.status
    return ''
  })
  if (result) return send(res, result === 'not-found' ? 404 : 400, { reason: result })
  send(res, 200, { ok: true })
}

// browser-sync middleware: (req, res, next)
async function apiMiddleware (req, res, next) {
  const u = new URL(req.url, 'http://localhost')
  try {
    if (u.pathname === '/api/recs' && req.method === 'GET') return handleRecs(u, res)
    if (u.pathname === '/api/img' && req.method === 'GET') return await handleImg(u, res, readJson(DATA.sources).images)
    const POSTS = { '/api/collect': handleCollect, '/api/review': handleReview, '/api/sync': handleSync, '/api/add-url': handleAddUrl, '/api/add-channel': handleAddChannel, '/api/stats': handleStats }
    if (POSTS[u.pathname]) {
      // 다른 웹사이트가 이 컴퓨터의 미리보기 서버로 요청을 보내 할당량을 쓰거나 파일을 바꾸지 못하게
      if (req.method !== 'POST') return send(res, 405, { reason: 'method' })
      if (!originOk(req) || !/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 403, { reason: 'origin' })
      return await POSTS[u.pathname](req, res)
    }
    // 내부 확인 페이지용 사용량·채널 캐시 현황 (같은 컴퓨터 화면에서만)
    if (u.pathname === '/api/usage' && req.method === 'GET') {
      if (req.headers.origin && !originOk(req)) return send(res, 403, { reason: 'origin' })
      return handleUsage(res)
    }
    if (u.pathname.indexOf('/api/') === 0) return send(res, 404, { reason: 'not-found' })
  } catch (e) {
    return send(res, e && e.badInput ? 400 : 500, { reason: e && e.badInput ? 'bad-input' : 'server' })
  }
  next()
}

module.exports = apiMiddleware
module.exports.helpers = { bookFitsUnit, seriesKey, uploadsPlaylistId, uploadRows, mergeUploads, gradeConflict, gradeMarked, bookFitsCourse, bookQueries, isExamBook, bookGradeOk, bookScore, popScore, videoIdOf, termConflict, isEbsLinked, pubName, bookType, computeRecs, mixedExamPlaylist, otherCourseKeys, courseNameConflict, bookUnitReason, ruleCurriculum, oldCurriculumVideo, cleanAuthors, isPlaceholderCover, matchUploads, parseYouTubeUrl, parseChannelRef, validChannelId, quotaDay, today,sourceGroup, isExam, otherVideoItems, videoRuleFails, normTitle, matchPlaylists, mixedCourses, titleHasUnit, isoMinutes, blocked, rankScore, sortRecs, canSetStatus, autoReason, imgAllowed, playlistItems, videoItems, bookItems, publicItem }
