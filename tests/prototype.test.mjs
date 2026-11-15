// 프로토타입 확인 묶음 (npm test). node 내장 test·fetch만 사용, 새 패키지 없음.
// - 코드 문법, data/curriculum.json 형식·내용, 미리보기 서버 응답(켜져 있을 때만)
// - 외부 API(카카오·YouTube)는 부르지 않음 (할당량 절약). 키 값은 읽거나 출력하지 않음.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { createRequire } from 'node:module'

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const BASE = 'http://localhost:3000'

test('app.js, admin/review.js 문법 오류 없음', () => {
  for (const p of ['design/prototype/app.js', 'design/admin/review.js']) {
    assert.doesNotThrow(() => new Script(read(p), { filename: p }), p)
  }
})

test('server/api.cjs, bs-config.cjs 문법 오류 없음', () => {
  for (const p of ['server/api.cjs', 'bs-config.cjs']) {
    assert.doesNotThrow(() => new Script('(function(){' + read(p) + '\n})', { filename: p }), p)
  }
})

const cur = JSON.parse(read('data/curriculum.json'))
const GRADES = ['m1', 'm2', 'm3', 'h1', 'h2', 'h3']
const SUBJECTS = ['korean', 'english', 'math']

test('curriculum.json: 기본 필드', () => {
  assert.equal(cur.schemaVersion, 2)
  assert.equal(cur.schoolYear, 2026)
  assert.match(cur.checkedAt, /^\d{4}-\d{2}-\d{2}$/)
  for (const g of GRADES) assert.ok(['2015', '2022'].includes(cur.curriculumByGrade[g]), g)
})

test('curriculum.json: 과목(코스) 형식', () => {
  const ids = new Set()
  const groupIds = new Set(cur.groups.map((g) => g.id))
  for (const c of cur.courses) {
    assert.ok(!ids.has(c.id), '중복 id ' + c.id)
    ids.add(c.id)
    assert.ok(SUBJECTS.includes(c.subject), c.id + ' subject')
    assert.ok(['2015', '2022'].includes(c.curriculum), c.id + ' curriculum')
    assert.ok(groupIds.has(c.group), c.id + ' group')
    assert.ok(typeof c.label === 'string' && c.label.trim(), c.id + ' label')
    assert.ok(Array.isArray(c.units), c.id + ' units')
    for (const u of c.units) assert.ok(typeof u === 'string' && u.trim(), c.id + ' unit')
    assert.equal(new Set(c.units).size, c.units.length, c.id + ' 단원 중복')
    assert.ok(cur.sources[c.source], c.id + ' source')
    assert.equal(typeof c.verify, 'boolean', c.id + ' verify')
    // 공식 문서와 대조했다고 표시(verify=false)한 것은 공식 출처여야 함
    if (!c.verify) assert.equal(cur.sources[c.source].kind, 'official', c.id)
  }
})

test('curriculum.json: 학년마다 세 과목 모두 고를 것이 있고, 가리키는 코스가 실제로 있음', () => {
  const byId = new Map(cur.courses.map((c) => [c.id, c]))
  for (const g of GRADES) {
    for (const s of SUBJECTS) {
      const list = cur.offer[g] && cur.offer[g][s]
      assert.ok(Array.isArray(list) && list.length, g + '/' + s)
      for (const id of list) {
        const c = byId.get(id)
        assert.ok(c, g + '/' + s + ' 없는 코스 ' + id)
        assert.equal(c.subject, s, g + '/' + s + '/' + id)
      }
    }
  }
})

test('curriculum.json: 고등학교 수학은 과목을 여러 개 고를 수 있음 (사용자 피드백: 선택지 빈약)', () => {
  assert.ok(cur.offer.h2.math.length >= 5)
  assert.ok(cur.offer.h3.math.length >= 5)
  const labels = cur.offer.h2.math.map((id) => cur.courses.find((c) => c.id === id).label)
  for (const need of ['대수', '미적분Ⅰ', '확률과 통계', '미적분Ⅱ', '기하']) assert.ok(labels.includes(need), need)
})

test('curriculum.json: 학년에 나오는 코스는 그 학년 교육과정과 같음', () => {
  for (const g of GRADES) {
    for (const s of SUBJECTS) {
      for (const id of cur.offer[g][s]) {
        const c = cur.courses.find((x) => x.id === id)
        assert.equal(c.curriculum, cur.curriculumByGrade[g], g + '/' + id)
      }
    }
  }
})

test('curriculum.json: 리뷰 반영 (2015 실용 수학은 일반 선택, 고3에 고1 공통 과목 없음)', () => {
  assert.equal(cur.courses.find((c) => c.id === 'm15-prac').group, 'general')
  for (const s of SUBJECTS) {
    for (const id of cur.offer.h3[s]) assert.notEqual(cur.courses.find((c) => c.id === id).group, 'common', 'h3/' + id)
  }
})

test('curriculum.json: 단원 없는 과목은 숨김, 학생이 고를 수 있는 과목은 단원이 있고 학년·과목마다 하나 이상', () => {
  const byId = new Map(cur.courses.map((c) => [c.id, c]))
  for (const c of cur.courses) {
    if (!c.units.length) assert.equal(c.hidden, true, '단원 없는 과목은 hidden: ' + c.id)
    if (c.hidden) assert.equal(c.units.length, 0, 'hidden은 단원이 없는 과목에만: ' + c.id)
  }
  for (const g of GRADES) {
    for (const s of SUBJECTS) {
      const visible = cur.offer[g][s].map((id) => byId.get(id)).filter((c) => !c.hidden)
      assert.ok(visible.length >= 1, g + '/' + s + ' 고를 수 있는 과목이 있어야 함')
    }
  }
})

test('curriculum.json: 교재 상품명·출판사명이 없음 (광고 배제)', () => {
  const text = read('data/curriculum.json')
  for (const word of ['블랙라벨', '진학사', '쎈', '개념원리', 'EBS', '메가스터디', '대성마이맥', '이투스']) {
    assert.ok(!text.includes(word), word)
  }
})

// 미리보기 서버가 꺼져 있으면 아래는 건너뜀
async function serverUp () {
  try { const r = await fetch(BASE + '/prototype/index.html', { signal: AbortSignal.timeout(2000) }); return r.ok } catch { return false }
}

test('미리보기 서버: 프로토타입·과목 데이터 응답', async (t) => {
  if (!(await serverUp())) return t.skip('미리보기 서버가 꺼져 있음 (npm run dev)')
  const page = await fetch(BASE + '/prototype/index.html')
  assert.equal(page.status, 200)
  const data = await fetch(BASE + '/data/curriculum.json')
  assert.equal(data.status, 200)
  assert.deepEqual(await data.json(), cur)
})

function noKeyTrace (s, label) {
  assert.ok(!/KakaoAK/i.test(s), label + ' KakaoAK')
  assert.ok(!/key=/i.test(s), label + ' key=')
  assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(s), label + ' YouTube 키 형태')
}

test('미리보기 서버: 학생 화면용 /api/recs, 예전 검색 주소 없음, 응답에 키 흔적 없음', async (t) => {
  if (!(await serverUp())) return t.skip('미리보기 서버가 꺼져 있음 (npm run dev)')
  const bad = await fetch(BASE + '/api/recs')
  assert.equal(bad.status, 400)
  const ok = await fetch(BASE + '/api/recs?course=m22-alg&unit=' + encodeURIComponent('삼각함수') + '&school=high')
  assert.equal(ok.status, 200)
  const j = await ok.json()
  assert.ok(Array.isArray(j.videos) && Array.isArray(j.books))
  // 영역당 강의 최대 3개, 책 최대 2권 (사용자 결정 2026-11-12, '5개'를 대체)
  assert.ok(j.videos.length <= src.display.maxVideosPerArea && j.books.length <= src.display.maxBooksPerArea)
  assert.equal(src.display.maxVideosPerArea, 3)
  // 단원 강의가 아직 없으면 같은 과목 강의로 대신 보여 줌 (사용자 피드백: 대수 '수열'이 비어 보임)
  const algApproved = recs.items.some((it) => it.review.status === 'approved' && it.kind !== 'book' && it.courseId === 'm22-alg')
  if (algApproved) {
    const empty = recs.items.filter((it) => it.review.status === 'approved' && it.kind !== 'book' && it.courseId === 'm22-alg' && (it.unit === '수열' || it.unit === '*')).length === 0
    const js = await (await fetch(BASE + '/api/recs?course=m22-alg&unit=' + encodeURIComponent('수열') + '&school=high')).json()
    assert.ok(js.videos.length > 0, '대수 수열: 영상이 비면 안 됨')
    if (empty) assert.equal(js.videosScope, 'course', '단원 강의가 없을 때는 과목 단위 대체')
  }
  // 승인된 것만 나와야 함: 응답에는 상태 필드 자체가 없고, 파일에서 승인된 것과 대조
  const approved = new Set(recs.items.filter((it) => it.review.status === 'approved').map((it) => it.id))
  for (const it of j.videos.concat(j.books)) assert.ok(approved.has(it.id), it.id)
  for (const path of ['/api/books?q=x', '/api/videos?q=x']) assert.equal((await fetch(BASE + path)).status, 404, path)
  // 단원을 골라도 과목 전체('*')로 승인된 강의가 함께 나와야 함 (리뷰 필수, 2026-11-12)
  const wholeVid = recs.items.find((it) => it.review.status === 'approved' && it.kind !== 'book' && it.unit === '*')
  if (wholeVid) {
    const r2 = await fetch(BASE + '/api/recs?course=' + encodeURIComponent(wholeVid.courseId) + '&unit=' + encodeURIComponent('어떤 단원') + '&school=high')
    const j2 = await r2.json()
    assert.ok(j2.videos.length > 0, '단원 요청에도 과목 전체 강의가 와야 함: ' + wholeVid.courseId)
  }
  // 단원에 맞는 강의가 있으면 그것이 먼저
  const unitVid = recs.items.find((it) => it.review.status === 'approved' && it.kind !== 'book' && it.unit !== '*')
  if (unitVid) {
    const j3 = await (await fetch(BASE + '/api/recs?course=' + encodeURIComponent(unitVid.courseId) + '&unit=' + encodeURIComponent(unitVid.unit) + '&school=high')).json()
    const unitIds = new Set(recs.items.filter((it) => it.unit === unitVid.unit && it.courseId === unitVid.courseId).map((it) => it.id))
    assert.ok(unitIds.has(j3.videos[0].id), '단원 강의가 맨 앞')
  }
  for (const r of [bad, ok]) noKeyTrace(JSON.stringify([...r.headers]), 'headers')
  noKeyTrace(JSON.stringify(j), 'recs body')
})

test('미리보기 서버: 이미지 중계는 허용 도메인·https만 (열린 프록시 아님, 바깥 요청 없이 거절)', async (t) => {
  if (!(await serverUp())) return t.skip('미리보기 서버가 꺼져 있음 (npm run dev)')
  for (const u of ['https://evil.example/a.png', 'http://i.ytimg.com/vi/x/mqdefault.jpg', 'https://i.ytimg.com.evil.example/a.png', 'https://user@i.ytimg.com/a.png', 'file:///etc/passwd', '', 'https://i.ytimg.com/vi/not-saved/mqdefault.jpg', 'https://search1.kakaocdn.net/thumb/R120x174/?fname=http%3A%2F%2Fevil.example%2Fx']) {
    const r = await fetch(BASE + '/api/img?u=' + encodeURIComponent(u))
    assert.equal(r.status, 400, u)
  }
})

test('미리보기 서버: 후보 찾기·승인은 다른 웹사이트에서 보낼 수 없음 (할당량·파일 보호)', async (t) => {
  if (!(await serverUp())) return t.skip('미리보기 서버가 꺼져 있음 (npm run dev)')
  const body = JSON.stringify({ grade: 'h2', courseId: 'm22-alg', unit: '삼각함수', id: 'x', status: 'approved' })
  // Origin 없음 / 다른 Origin / JSON 아님 → 모두 403 (바깥 API를 부르기 전에 막힘)
  const cases = [
    { headers: { 'Content-Type': 'application/json' } },
    { headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' } },
    { headers: { 'Content-Type': 'text/plain', Origin: 'http://localhost:3000' } }
  ]
  for (const path of ['/api/collect', '/api/review', '/api/sync', '/api/add-url', '/api/add-channel']) {
    for (const c of cases) assert.equal((await fetch(BASE + path, { method: 'POST', body, headers: c.headers })).status, 403, path)
    assert.equal((await fetch(BASE + path)).status, 405, path + ' GET')
  }
  // 로컬에서 보내도 입력이 틀리면 거절 (파일은 바뀌지 않음)
  const local = { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }
  const before = read('data/recommendations.json')
  assert.equal((await fetch(BASE + '/api/review', { method: 'POST', headers: local, body: JSON.stringify({ id: 1, status: 'approved' }) })).status, 400)
  assert.equal((await fetch(BASE + '/api/review', { method: 'POST', headers: local, body: JSON.stringify({ id: recs.items[0] ? recs.items[0].id : 'x', status: 'reviewed' }) })).status, 400)
  // 규칙에 걸리는 영상은 로컬에서 보내도 승인 안 됨 (파일 안 바뀜)
  const ruled = recs.items.find((it) => it.kind !== 'book' && H.videoRuleFails(it, src.filters))
  if (ruled) {
    assert.equal((await fetch(BASE + '/api/review', { method: 'POST', headers: local, body: JSON.stringify({ id: ruled.id, status: 'approved' }) })).status, 400, '규칙 위반 승인 거절')
  }
  for (const bad of ['{"id":"x",', 'null', '[]', '42', '"x"']) {
    assert.equal((await fetch(BASE + '/api/review', { method: 'POST', headers: local, body: bad })).status, 400, bad)
  }
  assert.equal(read('data/recommendations.json'), before, '틀린 입력으로 파일이 바뀌면 안 됨')
})

/* ---------- 서버 순수 함수: 모의 응답으로 (바깥 API 안 부름) ---------- */
const require = createRequire(import.meta.url)
const H = require('../server/api.cjs').helpers
const src = JSON.parse(read('data/sources.json'))
const recs = JSON.parse(read('data/recommendations.json'))
const EBSI = src.youtubeChannels.find((c) => c.school === 'high').id
const ctxHigh = { school: 'high', filters: src.filters, publishers: src.publishers, channelIds: [EBSI] }

test('sources.json: 허용 채널·출판사·이미지 도메인 형식', () => {
  assert.ok(src.youtubeChannels.length >= 1)
  for (const c of src.youtubeChannels) {
    assert.match(c.id, /^UC[0-9A-Za-z_-]{22}$/, c.name)
    assert.ok(['high', 'middle'].includes(c.school), c.name)
    assert.ok(/EBS/.test(c.name), 'youtubeChannels 은 EBS 계열만 (다른 선생님은 otherChannels): ' + c.name)
  }
  assert.ok(src.publishers.every((p) => Array.isArray(p.match) && p.match.length))
  assert.deepEqual(src.images.allowedHosts.slice().sort(), ['i.ytimg.com', 'search1.kakaocdn.net'])
  assert.ok(src.filters.minVideoMinutes >= 20)
})

test('recommendations.json: 상태가 올바르고(후보·승인·제외), 책은 과목 단위, id 규칙, 승인된 항목은 추천 이유·확인 날짜·승인일이 있음', () => {
  assert.equal(new Set(recs.items.map((it) => it.id)).size, recs.items.length, 'id 중복 없음')
  for (const it of recs.items) {
    assert.ok(['candidate', 'approved', 'retired'].includes(it.review.status), it.id)
    if (it.kind === 'book') assert.equal(it.unit, '*', '책은 과목 단위: ' + it.id)
    assert.equal(it.provider, String(it.provider).trim(), '제공처 앞뒤 공백 없음: ' + it.id)
    assert.ok(it.id.startsWith(it.courseId + '|' + it.unit + '|'), 'id 규칙: ' + it.id)
    assert.match(it.lastCheckedAt, /^\d{4}-\d{2}-\d{2}$/, it.id)
    assert.ok(/^https:\/\//.test(it.url), it.id)
    if (it.review.status === 'approved') {
      assert.ok(it.reason && it.reason.trim(), it.id + ' 추천 이유')
      assert.match(it.review.approvedAt, /^\d{4}-\d{2}-\d{2}$/, it.id)
    }
  }
})

test('YouTube 재생목록: 허용 채널만, 쇼츠·홍보 제목 제외, 강의 수 반영', () => {
  const search = { items: [
    { id: { playlistId: 'PL1' }, snippet: { title: '[대수] 삼각함수 개념 완성', channelId: EBSI, channelTitle: 'EBSi', publishedAt: '2025-03-01T00:00:00Z', thumbnails: { medium: { url: 'https://i.ytimg.com/a.jpg' } } } },
    { id: { playlistId: 'PL2' }, snippet: { title: '삼각함수 특강', channelId: 'UCxxxxxxxxxxxxxxxxxxxxxx', channelTitle: '어느 학원' } },
    { id: { playlistId: 'PL3' }, snippet: { title: '삼각함수 #shorts 모음', channelId: EBSI, channelTitle: 'EBSi' } }
  ] }
  const detail = { items: [{ id: 'PL1', contentDetails: { itemCount: 12 } }] }
  const out = H.playlistItems(search, detail, ctxHigh)
  assert.deepEqual(out.map((x) => x.url), ['https://www.youtube.com/playlist?list=PL1'])
  assert.equal(out[0].itemCount, 12)
})

test('YouTube 영상: 20분 미만·다른 채널·학년 안 맞는 제목 제외', () => {
  const search = { items: [
    { id: { videoId: 'v1' }, snippet: { title: '대수 삼각함수 1강', channelId: EBSI, channelTitle: 'EBSi' } },
    { id: { videoId: 'v2' }, snippet: { title: '삼각함수 3분 정리', channelId: EBSI, channelTitle: 'EBSi' } },
    { id: { videoId: 'v3' }, snippet: { title: '중학 수학 삼각비', channelId: EBSI, channelTitle: 'EBSi' } },
    { id: { videoId: 'v4' }, snippet: { title: '삼각함수 강의', channelId: 'UCyyyyyyyyyyyyyyyyyyyyyy', channelTitle: '상업 인강' } }
  ] }
  const detail = { items: [
    { id: 'v1', contentDetails: { duration: 'PT48M10S' }, statistics: { viewCount: '12000' } },
    { id: 'v2', contentDetails: { duration: 'PT3M' } },
    { id: 'v3', contentDetails: { duration: 'PT40M' } },
    { id: 'v4', contentDetails: { duration: 'PT1H' } }
  ] }
  const out = H.videoItems(search, detail, ctxHigh)
  assert.deepEqual(out.map((x) => x.url), ['https://www.youtube.com/watch?v=v1'])
  assert.equal(out[0].durationMin, 48)
  assert.equal(H.isoMinutes('PT1H2M30S'), 63)
})

test('채널 재생목록 맞추기: 과목 이름·별칭(2015 이름), 제외어, 단원 일치 우선', () => {
  const pl = (id, title, itemCount, channelId = EBSI) => ({ id, snippet: { title, channelId, channelTitle: 'EBSi', publishedAt: '2025-01-01T00:00:00Z' }, contentDetails: { itemCount } })
  const list = [
    pl('A', '[2026 수능특강] 수학Ⅰ', 30),
    pl('B', '[올림포스] 공통수학1 (2022 개정)', 25),
    pl('C', '수학Ⅰ 수열 개념 완성', 12),
    pl('D', '대수 지수함수와 로그함수', 10),
    pl('E', '수학Ⅰ 예고편 모음', 5),
    pl('F', '수학Ⅰ 특강', 1),
    pl('G', '수학Ⅰ 강좌', 20, 'UCxxxxxxxxxxxxxxxxxxxxxx')
  ]
  const out = H.matchPlaylists(list, ['대수', '수학Ⅰ'], '수열', ctxHigh, ['공통수학'])
  const ids = out.map((x) => x.sourceId)
  assert.ok(!ids.includes('B'), '공통수학1은 제외어로 빠짐')
  assert.ok(!ids.includes('E'), '예고 제목 제외')
  assert.ok(!ids.includes('F'), '강의 1개짜리 제외')
  assert.ok(!ids.includes('G'), '허용 채널 아님')
  assert.equal(ids[0], 'C', '단원 이름이 있는 재생목록이 먼저')
  assert.ok(ids.includes('A') && ids.includes('D'))
  assert.equal(out[0].unitMatch, true)
  assert.equal(H.normTitle('수학 Ⅱ'), '수학2')
})

test('리뷰 반영: "대수능"은 대수 재생목록이 아님, 여러 과목 섞인 재생목록 제외, 단원 이름이 제목에 있을 때만 단원 배정', () => {
  const cur2 = JSON.parse(read('data/curriculum.json'))
  const alg = cur2.courses.find((c) => c.id === 'm22-alg')
  const pl = (id, title) => ({ id, snippet: { title, channelId: EBSI, channelTitle: 'EBSi' }, contentDetails: { itemCount: 10 } })
  const out = H.matchPlaylists([pl('X', '2016학년도 대수능 해설강의'), pl('Y', '대수 수열 완성')], ['대수'].concat(alg.searchAlias), '수열', ctxHigh, alg.searchExclude)
  assert.deepEqual(out.map((x) => x.sourceId), ['Y'])
  assert.ok(H.mixedCourses('[EBS 수능길잡이] 수학 (확률과통계, 미적분, 기하와벡터)', src.filters))
  assert.ok(!H.mixedCourses('[수능특강] 미적분', src.filters))
  assert.ok(!H.mixedCourses('기하와 벡터 개념', src.filters), '기하와벡터 하나는 섞인 것이 아님')
  assert.ok(H.titleHasUnit('[대수] 로그함수의 그래프', '지수함수와 로그함수'))
  assert.ok(H.titleHasUnit('수열의 합 완성', '수열'))
  assert.ok(!H.titleHasUnit('곱셈공식과 인수분해', '방정식과 부등식'))
})

test('영상 규칙 (사용자 결정 2026-11-12, 교육과정 기준): 2015·2022 과목 모두 2018년 이후, 예비과정 제외, 책은 적용 안 함, 승인된 영상은 모두 규칙 통과', () => {
  const f = src.filters
  // relaxed: 진로·융합 수학 6과목만 2014년 이후 (사용자 요청 2026-11-15)
  assert.deepEqual(f.minVideoYearByCurriculum, { 2015: 2018, 2022: 2018, relaxed: 2014 })
  assert.equal(f.preferVideoYearByCurriculum['2022'], 2024)
  assert.equal(H.videoRuleFails({ kind: 'video', year: '2016', title: '수열 1강' }, f, '2015'), 'old')
  assert.equal(H.videoRuleFails({ kind: 'video', year: '2017', title: '수열 1강' }, f, '2022'), 'old')
  assert.equal(H.videoRuleFails({ kind: 'video', year: '2018', title: '수열 1강' }, f, '2015'), '')
  assert.equal(H.videoRuleFails({ kind: 'video', year: '2019', title: '수열 1강' }, f, '2022'), '', '2022 과목도 부족하면 2018년 이후 허용')
  assert.equal(H.videoRuleFails({ kind: 'playlist', year: '2024', title: '[고등예비과정 수학Ⅱ] 수열' }, f, '2022'), 'prep')
  assert.equal(H.videoRuleFails({ kind: 'video', year: '2025', title: '예비 고1 공통수학 특강' }, f, '2022'), 'prep')
  assert.equal(H.videoRuleFails({ kind: 'book', year: '2010', title: '고등예비과정 교재' }, f, '2022'), '', '책은 적용 안 함')
  const curOf = Object.fromEntries(cur.courses.map((c) => [c.id, c.curriculum]))
  for (const it of recs.items.filter((x) => x.review.status === 'approved')) {
    assert.equal(H.videoRuleFails(it, f, curOf[it.courseId]), '', '승인된 영상이 규칙을 어김: ' + it.id + ' ' + it.year + ' ' + it.title)
  }
})

test('출처 구분 없이 단원·추천순 (사용자 결정 2026-11-12: EBS 우선순위 폐지), 해설강의 구분, 다른 선생님 강의 거르기', () => {
  assert.ok(!/\+ sourceGroup\(it\)/.test(read('server/api.cjs')), '학생 화면 순서에 출처 묶음을 쓰지 않음')
  assert.equal(H.sourceGroup({ kind: 'course' }), 0)
  assert.equal(H.sourceGroup({ kind: 'video' }), 1)
  assert.equal(H.sourceGroup({ kind: 'video', channelGroup: 'other' }), 2)
  assert.ok(H.isExam('[2025학년도 고3 9월 모의평가 해설강의] 미적분', src.filters))
  assert.ok(!H.isExam('[대수] 수열의 합 개념', src.filters))
  const OTHER = 'UCzzzzzzzzzzzzzzzzzzzzzz'
  const search = { items: [
    { id: { videoId: 'o1' }, snippet: { title: '수열의 합 완벽 정리 1강', channelId: OTHER, channelTitle: '어느 선생님', publishedAt: '2024-03-01T00:00:00Z' } },
    { id: { videoId: 'o2' }, snippet: { title: '수열 맛보기 강의', channelId: OTHER, channelTitle: '어느 학원', publishedAt: '2024-03-01T00:00:00Z' } },
    { id: { videoId: 'o3' }, snippet: { title: '삼각함수 그래프', channelId: OTHER, channelTitle: '어느 선생님', publishedAt: '2024-03-01T00:00:00Z' } },
    { id: { videoId: 'o4' }, snippet: { title: '수열 강의', channelId: EBSI, channelTitle: 'EBSi', publishedAt: '2024-03-01T00:00:00Z' } },
    { id: { videoId: 'o5' }, snippet: { title: '수열 강의', channelId: 'UCoffoffoffoffoffoffoffo', channelTitle: '끈 채널', publishedAt: '2024-03-01T00:00:00Z' } }
  ] }
  const detail = { items: ['o1', 'o2', 'o3', 'o4', 'o5'].map((id) => ({ id, contentDetails: { duration: 'PT40M' } })) }
  const ctx = { ...ctxHigh, unit: '수열', curriculum: '2022', ebsAll: [EBSI], otherOff: { UCoffoffoffoffoffoffoffo: true } }
  const out = H.otherVideoItems(search, detail, ctx)
  assert.deepEqual(out.map((x) => x.sourceId), ['o1'], '맛보기·다른 단원·EBS·끈 채널 제외')
  assert.equal(out[0].channelGroup, 'other')
  assert.ok(Array.isArray(src.otherChannels))
  for (const c of src.otherChannels) assert.match(c.id, /^UC[0-9A-Za-z_-]{22}$/, c.name)
})

test('카카오 책: 허용 출판사(EBS)만, 초등·중학 교재 제외(고등)', () => {
  const j = { documents: [
    { title: 'EBS 수능특강 수학영역 대수', publisher: '한국교육방송공사(EBSi)', authors: ['EBS'], datetime: '2026-01-10T00:00:00.000+09:00', isbn: '1', url: 'https://search.daum.net/search?q=1', thumbnail: 'https://search1.kakaocdn.net/thumb/a' },
    { title: '초등 수학 대수 기초', publisher: '한국교육방송공사', authors: [], isbn: '2', url: 'https://search.daum.net/search?q=2' },
    { title: '고등 대수 자습서', publisher: '어느 출판사', authors: [], isbn: '3', url: 'https://search.daum.net/search?q=3' }
  ] }
  const out = H.bookItems(j, ctxHigh)
  assert.deepEqual(out.map((b) => b.sourceId), ['1'])
})

test('추천순: 단원 관련도 → 재생목록 → 길이·조회수, 무료 먼저, 사람이 정한 순서가 최우선', () => {
  const pl = { kind: 'playlist', title: '대수 삼각함수 강좌', itemCount: 10 }
  const v = { kind: 'video', title: '대수 삼각함수 1강', durationMin: 50, views: 100000 }
  const other = { kind: 'video', title: '대수 총정리', durationMin: 50, views: 1000000 }
  const s = (x) => H.rankScore(x, '삼각함수', '대수')
  assert.ok(s(pl) > s(v), '재생목록 우선')
  assert.ok(s(v) > s(other), '단원 이름이 있는 것이 조회수보다 우선')
  const sorted = H.sortRecs([
    { id: 'a', isFree: false, score: 9 }, { id: 'b', isFree: true, score: 1 }, { id: 'c', isFree: true, score: 5 }, { id: 'd', isFree: false, score: 0, rank: 1 }
  ])
  assert.deepEqual(sorted.map((x) => x.id), ['d', 'c', 'b', 'a'])
})

test('승인 규칙: [승인] 한 번 (리뷰어 확인 단계 없음, 사용자 결정 2026-11-11)', () => {
  const item = (status) => ({ review: { status }, reason: '' })
  assert.equal(H.canSetStatus(item('candidate'), 'approved'), '')
  assert.equal(H.canSetStatus(item('candidate'), 'retired'), '')
  assert.equal(H.canSetStatus(item('approved'), 'candidate'), '')
  for (const bad of ['reviewed', 'published', '']) assert.equal(H.canSetStatus(item('candidate'), bad), 'bad-status', bad)
})

test('추천 이유 자동 생성: 사실만 짧게, 광고 문구 없음', () => {
  const v = H.autoReason({ kind: 'video', unit: '삼각함수', provider: 'EBSi', durationMin: 59 }, '대수')
  assert.equal(v, '삼각함수 단원 · EBSi 무료 강의 · 59분')
  const p = H.autoReason({ kind: 'playlist', unit: '수열', provider: 'EBSi', itemCount: 12 }, '대수')
  assert.equal(p, '수열 단원 · EBSi 무료 강의 · 12강 재생목록')
  const b = H.autoReason({ kind: 'book', unit: '*', provider: '한국교육방송공사' }, '대수')
  assert.equal(b, '대수 과목 · EBS 교재')
  // 예전 방식으로 단원 아래 저장된 책이라도, 책은 과목 단위로 보여 주므로 단원 이름을 쓰지 않음
  assert.equal(H.autoReason({ kind: 'book', unit: '삼각함수', provider: 'EBS' }, '대수'), '대수 과목 · EBS 교재')
  for (const s of [v, p, b]) {
    for (const ad of ['최고', '1등', '강추', '필수', '할인', '구매', '추천합니다', '!']) assert.ok(!s.includes(ad), s + ' / ' + ad)
  }
})

test('이미지 중계 주소 검사: 저장된 추천 항목의 썸네일과 정확히 같은 주소만 (열린 프록시 아님)', () => {
  const hosts = src.images.allowedHosts
  const yt = 'https://i.ytimg.com/vi/x/mqdefault.jpg'
  const kk = 'https://search1.kakaocdn.net/thumb/R120x174/?fname=http%3A%2F%2Ft1.daumcdn.net%2Fa'
  const known = new Set([yt, kk])
  assert.ok(H.imgAllowed(yt, hosts, known))
  assert.ok(H.imgAllowed(kk, hosts, known))
  // 허용 호스트라도 저장된 주소가 아니면 거절 (카카오 썸네일 서버로 아무 이미지나 받아 오는 길 차단)
  assert.equal(H.imgAllowed('https://search1.kakaocdn.net/thumb/R120x174/?fname=http%3A%2F%2Fevil.example%2Fx', hosts, known), null)
  for (const bad of ['http://i.ytimg.com/a.jpg', 'https://i.ytimg.com:8443/a.jpg', 'https://a@i.ytimg.com/a.jpg', 'https://evil.example/a.jpg', 'https://i.ytimg.com.evil.example/a', 'javascript:alert(1)', 'not a url']) {
    assert.equal(H.imgAllowed(bad, hosts, new Set([bad])), null, bad)
  }
})

test('날짜는 한국 시간 기준 (YYYY-MM-DD)', () => {
  const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  assert.equal(H.today(), kst)
})

test('학생 화면의 "확인한 날"은 승인일 (후보 찾기를 다시 돌린 날이 아님)', () => {
  const p = H.publicItem({ id: 'x', kind: 'book', title: 't', url: 'https://a', lastCheckedAt: '2026-12-01', review: { status: 'approved', approvedAt: '2026-11-11' } })
  assert.equal(p.lastCheckedAt, '2026-11-11')
})

test('학생 화면 응답에는 내부 필드(검토 상태·점수·조회수) 없음', () => {
  const p = H.publicItem({ id: 'x', kind: 'video', title: 't', provider: 'EBSi', url: 'https://www.youtube.com/watch?v=1', thumbnail: '', score: 5, views: 10, review: { status: 'approved' }, reason: 'r', lastCheckedAt: '2026-11-11', isFree: true })
  assert.equal(p.review, undefined)
  assert.equal(p.score, undefined)
  assert.equal(p.views, undefined)
})

test('할당량 적은 방식: 채널 업로드 목록 캐시·서버 안 단원 맞추기·주소 직접 추가 검사 (search 없음)', () => {
  assert.equal(H.uploadsPlaylistId('UCDkTanNuZGwYtf-Y6_xBmqw'), 'UUDkTanNuZGwYtf-Y6_xBmqw')
  assert.equal(H.uploadsPlaylistId('bad'), '')
  const rows = H.uploadRows({ items: [
    { snippet: { title: '[대수] 삼각함수의 그래프 개념', resourceId: { videoId: 'aaaaaaaaaaa' } }, contentDetails: { videoId: 'aaaaaaaaaaa', videoPublishedAt: '2025-03-01T00:00:00Z' } },
    { snippet: { title: 'Private video', resourceId: { videoId: 'bbbbbbbbbbb' } }, contentDetails: { videoId: 'bbbbbbbbbbb' } }
  ] })
  assert.deepEqual(rows, [{ v: 'aaaaaaaaaaa', t: '[대수] 삼각함수의 그래프 개념', d: '2025-03-01' }], '비공개 영상은 뺌')
  assert.equal(H.mergeUploads([{ v: 'x', t: 'new', d: '' }], [{ v: 'x', t: 'old', d: '' }, { v: 'y', t: 'y', d: '' }]).length, 2, '같은 영상은 하나로')
  const ctx = { school: 'high', filters: src.filters, curriculum: '2022' }
  const up = [
    { v: '1', t: '[대수] 삼각함수 개념 완성', d: '2025-01-01' },
    { v: '2', t: '[대수] 수열 개념', d: '2025-01-01' },
    { v: '3', t: '[대수] 삼각함수 예비과정', d: '2025-01-01' },
    { v: '4', t: '[대수] 삼각함수', d: '2016-01-01' },
    { v: '5', t: '[미적분Ⅰ] 삼각함수', d: '2025-01-01' }
  ]
  assert.deepEqual(H.matchUploads(up, ['대수'], '삼각함수', ctx).map((r) => r.v), ['1'], '단원·과목 이름, 예비과정·연도 규칙')
  assert.deepEqual(H.matchUploads(up, ['대수'], null, ctx), [], '단원 없이는 업로드 영상을 고르지 않음')
  assert.equal(H.gradeConflict('[중3 수학] 이차함수', '중2'), true)
  assert.equal(H.gradeConflict('[중2 수학] 일차함수', '중2'), false)
  assert.equal(H.gradeConflict('일차함수 개념', '중2'), false)
  // 표본 검사(2026-11-12) 불량 사례: 중학 과목에 고등·초등 재생목록
  for (const t of ['공통수학 1 전체 강의', 'RPM 수학1 문제풀이', '초5 수학 1주일 완성?', '[공통국어2-고전소설] 춘향전', '잠깐수학 중1-2 중간고사']) {
    assert.equal(H.gradeConflict(t, '중2'), true, t)
  }
  for (const t of ['중2 수학 2-1 일차함수', '수학 2-1 1단원', '중학 수학1학기 개념', '수학 1강 소인수분해']) {
    assert.equal(H.gradeConflict(t, '중2'), false, t)
  }
  assert.equal(H.gradeConflict('수학Ⅰ 지수함수', '고2'), false, '고등학교는 수학Ⅰ 표시로 빼지 않음')
  assert.equal(H.gradeMarked('중2 수학 개념', '중2'), true)
  assert.equal(H.gradeMarked('수학 2-2 전체 강의', '중2'), true)
  assert.equal(H.gradeMarked('2학년 국어 교과서', '중2'), true)
  assert.equal(H.gradeMarked('수학 개념 총정리', '중2'), false, '과목 전체 재생목록은 학년 표시 필요')
  assert.equal(H.gradeMarked('수학 1-2 강의', '중2'), false)
  assert.equal(H.gradeConflict('중등1-2수학 짧개념', '중2'), true, '중등N도 학년 표시')
  assert.equal(H.gradeMarked('중등2-2수학 짧개념&문제풀이', '중2', '2'), true)
  assert.equal(H.gradeMarked('중등2-2수학 짧개념&문제풀이', '중2', '1'), false, '다른 학기')
  assert.equal(H.gradeMarked('중2 2학기 기말 대비', '중2', '1'), false, '다른 학기')
  assert.equal(H.gradeMarked('원리가 보이는 5분 중학 수학', '중1', '1'), false)
  // 책: 시중 교재 허용, 과목·학년·학기·판 맞춤 (사용자 요청 2026-11-12 '책도 찾아줘')
  const term21 = { school: 'middle', curriculum: '2022', term: '1', grades: ['2'], subjLabel: '수학', exam: false }
  assert.equal(H.bookFitsCourse({ title: '개념원리 중학 수학 2-1 (2025년)', year: '2024' }, term21), true)
  assert.equal(H.bookFitsCourse({ title: '개념원리 중학 수학 2-2 (2025년)', year: '2024' }, term21), false, '다른 학기')
  assert.equal(H.bookFitsCourse({ title: '쎈 중등 수학 1-1', year: '2024' }, term21), false, '다른 학년')
  assert.equal(H.bookFitsCourse({ title: '개념원리 중학 수학 2-1', year: '2019' }, term21), false, '2022 과목에 옛 판')
  const midKo = { school: 'middle', curriculum: '2022', term: '', grades: ['1', '2'], subjLabel: '국어', exam: false }
  assert.equal(H.bookFitsCourse({ title: '중학 국어 비문학 독해 1', year: '2025' }, midKo), true)
  assert.equal(H.bookFitsCourse({ title: '중학 국어 3-1 자습서', year: '2025' }, midKo), false, '그 과목 학년이 아님')
  // 중학 국어·영어 실력서는 2018년 이후 판 허용, 자습서는 그대로 2024년 이후
  const midEn = { school: 'middle', curriculum: '2022', term: '', grades: ['1', '2'], subjLabel: '영어', exam: false }
  assert.equal(H.bookFitsCourse({ title: '수작 중학 비문학 영어 독해 기본', year: '2023' }, midEn), true)
  assert.equal(H.bookFitsCourse({ title: '중학 영어2 자습서(윤정미 외)', year: '2019' }, midEn), false)
  assert.equal(H.bookFitsCourse({ title: '중학 영어 독해 완성 Level 3', year: '2015' }, midEn), false)
  const alg = { school: 'high', curriculum: '2022', names: ['대수', '수학Ⅰ'], excludes: ['공통수학', '대수능'], exam: false }
  assert.equal(H.bookFitsCourse({ title: '개념원리 고등 대수 (2025년)', year: '2025' }, alg), true)
  assert.equal(H.bookFitsCourse({ title: '개념원리 공통수학1', year: '2025' }, alg), false)
  assert.equal(H.bookFitsCourse({ title: '자이스토리 대수 기출', year: '2025' }, alg), false, '기출 문제집은 수능 과목에서만')
  assert.equal(H.bookFitsCourse({ title: '중등 수학 대수', year: '2025' }, alg), false, '고등 과목에 중학 책')
  const alg2 = Object.assign({}, alg, { oldNames: ['수학1'] })
  assert.equal(H.bookFitsCourse({ title: '쎈 고등 수학1', year: '2024', provider: '좋은책신사고' }, alg2), false, '2015 이름 시중 교재')
  assert.equal(H.bookFitsCourse({ title: 'EBS 올림포스 수학1', year: '2024', provider: 'EBS한국교육방송공사' }, alg2), true)
  const st15 = { school: 'high', curriculum: '2015', names: ['확률과 통계'], exam: false }
  assert.equal(H.bookFitsCourse({ title: '고등 확률과 통계 자습서(이준열)', year: '2019' }, st15), true)
  assert.equal(H.bookFitsCourse({ title: '고등 확률과 통계 자습서(김원경)(2026)', year: '2026' }, st15), false, '2022 새 판')
  const mid3 = { school: 'middle', curriculum: '2015', term: '1', grades: ['3'], subjLabel: '수학', exam: false }
  assert.equal(H.bookFitsCourse({ title: '개념원리 중학 수학 3-1(2026)', year: '2022' }, mid3), true)
  assert.equal(H.bookFitsCourse({ title: '개념원리 중학 수학 3-1(2027)', year: '2025' }, mid3), false, '2027 판은 2022 교육과정')
  const calc2 = { school: 'high', curriculum: '2022', names: ['미적분Ⅱ', '미적분', '미적분 2'], exam: false }
  assert.equal(H.bookFitsCourse({ title: 'EBS 수능완성 수학영역 수학1·수학2·미적분(2026)(2027 수능대비)', year: '2026', provider: '한국교육방송공사' }, calc2), false)
  assert.equal(H.bookFitsCourse({ title: '실용 통계 고등 확률과 통계', year: '2026' }, { school: 'high', curriculum: '2022', names: ['통계'], exam: false }), false, '넓은 말')
  assert.deepEqual(H.parseYouTubeUrl('https://www.youtube.com/watch?v=DF4Jj5JPOVs&t=10'), { type: 'video', id: 'DF4Jj5JPOVs' })
  assert.deepEqual(H.parseYouTubeUrl('https://youtu.be/DF4Jj5JPOVs'), { type: 'video', id: 'DF4Jj5JPOVs' })
  assert.deepEqual(H.parseYouTubeUrl('https://www.youtube.com/playlist?list=PL1234567890ab'), { type: 'playlist', id: 'PL1234567890ab' })
  for (const bad of ['http://www.youtube.com/watch?v=DF4Jj5JPOVs', 'https://evil.example/watch?v=DF4Jj5JPOVs', 'https://www.youtube.com/shorts/DF4Jj5JPOVs', 'https://www.youtube.com.evil.example/watch?v=DF4Jj5JPOVs', 'javascript:alert(1)', '']) {
    assert.equal(H.parseYouTubeUrl(bad), null, bad)
  }
  assert.deepEqual(H.parseChannelRef('@someteacher'), { handle: '@someteacher' })
  assert.deepEqual(H.parseChannelRef('https://www.youtube.com/channel/UCDkTanNuZGwYtf-Y6_xBmqw'), { id: 'UCDkTanNuZGwYtf-Y6_xBmqw' })
  assert.equal(H.parseChannelRef('https://evil.example/@x'), null)
  assert.match(H.quotaDay(), /^\d{4}-\d{2}-\d{2}$/)
  // 기본 후보 찾기는 search.list를 부르지 않음 (useSearch:true일 때만)
  const code = read('server/api.cjs')
  assert.match(code, /const useSearch = body\.useSearch === true/)
  assert.ok(!/useSearch/.test(read('design/admin/review.js')), '내부 확인 페이지는 search 방식을 쓰지 않음')
})

test('EBSi 강좌 링크: 강좌 상세 주소 형식, 근거·확인 날짜, 과목 전체 또는 그 과목 단원', () => {
  const byId = new Map(cur.courses.map((c) => [c.id, c]))
  const courses = recs.items.filter((it) => it.kind === 'course')
  assert.ok(courses.length >= 10, 'EBSi 강좌 링크 ' + courses.length + '개')
  for (const it of courses) {
    assert.match(it.url, /^https:\/\/(www\.ebsi\.co\.kr\/ebs\/lms\/lmsx\/retrieveSbjtDtl\.ebs\?courseId=S\d{11}|mid\.ebs\.co\.kr\/course\/view\?courseId=\d{6,12})$/, it.id)
    assert.ok(it.id.endsWith('course:' + it.url.split('courseId=')[1]), it.id)
    assert.ok(it.evidence && it.lastCheckedAt, it.id)
    const c = byId.get(it.courseId)
    assert.ok(c && (it.unit === '*' || c.units.includes(it.unit)), it.id)
    assert.ok(['EBSi', 'EBS 중학'].includes(it.provider), it.id)
  }
})

test('PC 넓은 레이아웃 (사용자 요청 2026-11-12): 1024px 이상 2단·최대 폭 1200px, 휴대폰은 그대로, 단계 목록은 nav + aria-current', () => {
  const html = read('design/prototype/index.html')
  assert.match(html, /@media \(min-width: 1024px\)/)
  assert.match(html, /max-width: 1200px/)
  assert.match(html, /<aside class="side" id="side"><\/aside>/)
  assert.match(html, /\.shell \{ max-width: 480px;/, '휴대폰 기본 폭은 그대로')
  const app = read('design/prototype/app.js')
  assert.match(app, /<section aria-labelledby="side-title">/)
  assert.match(html, /scroll-padding-top/)
  assert.match(app, /aria-current="step"/)
  assert.match(read('design/mockups/landing.html'), /@media \(min-width: 1024px\)/)
  assert.match(read('design/admin/review.html'), /@media \(min-width: 1024px\)/)
})

test('추천 화면: 한 과목 탭 안에서 같은 영상·책은 한 번만 (사용자 요청 2026-11-12), 단원 전용 강의가 먼저, 겹쳐서 빈 영역은 안내', () => {
  const app = read('design/prototype/app.js')
  const start = app.indexOf('function dedupe(')
  const end = app.indexOf('function groupCards(')
  assert.ok(start > 0 && end > start, 'dedupe 함수가 app.js에 있어야 함')
  const ctx = { remote: {}, out: null }
  new Script('var remote = this.remote; ' + app.slice(start, end) + '; this.dedupe = dedupe;').runInNewContext(ctx)
  const slot = (key, title) => ({ getAttribute: (n) => (n === 'data-key' ? key : title) })
  const v = (url, forUnit) => ({ url, forUnit })
  // 문학·쓰기 두 영역이 같은 과목 대체 영상 3개를 받은 상황 (사용자 캡처) + 문학 전용 강의 1개
  ctx.remote.lit = { videos: [v('A', false), v('B', false), v('C', false), v('U1', true)] }
  ctx.remote.write = { videos: [v('A', false), v('B', false), v('C', false)] }
  ctx.remote.read = { videos: [v('U2', true), v('A', false)] }
  const r = ctx.dedupe([slot('lit', '문학'), slot('write', '쓰기'), slot('read', '읽기')], 'videos', 3, true)
  const all = [].concat(r.lists.lit, r.lists.write, r.lists.read).map((x) => x.url)
  assert.equal(new Set(all).size, all.length, '탭 안에서 중복 없음: ' + all.join(','))
  assert.equal(r.lists.lit[0].url, 'U1', '단원 전용 강의가 먼저')
  assert.equal(r.lists.read[0].url, 'U2')
  assert.ok(r.lists.lit.length <= 3 && r.lists.write.length <= 3)
  if (!r.lists.write.length) assert.ok(r.notes.write, '겹쳐서 빈 영역은 어디에 있는지 안내')
})

test('미리보기 서버: /api/recs 여유 후보(max ≤ 8)와 단원 전용 표시(forUnit)', async (t) => {
  if (!(await serverUp())) return t.skip('미리보기 서버가 꺼져 있음 (npm run dev)')
  const j = await (await fetch(BASE + '/api/recs?course=m22-alg&unit=' + encodeURIComponent('삼각함수') + '&school=high&max=99')).json()
  assert.ok(j.videos.length <= 8 && j.books.length <= 8, '최대 8')
  for (const it of j.videos) assert.equal(typeof it.forUnit, 'boolean')
  const urls = j.videos.map((x) => x.url)
  assert.equal(new Set(urls).size, urls.length, '한 영역 안 중복 없음')
})

test('책도 단원에 맞게 (사용자 요청 2026-11-12): 다른 단원 책은 빼고, 과목 전체 책은 그대로, 같은 시리즈 다른 판은 하나', () => {
  const units = ['듣기·말하기', '읽기', '쓰기', '문법', '문학', '매체']
  assert.equal(H.bookFitsUnit('EBS 필독 중학 국어 문법', '문학', units, src.filters), false, '문학에 문법 책 안 됨')
  assert.equal(H.bookFitsUnit('EBS 필독 중학 국어 문법', '쓰기', units, src.filters), false)
  assert.equal(H.bookFitsUnit('EBS 필독 중학 국어 문법', '문법', units, src.filters), true)
  const e1 = { school: 'high', curriculum: '2022', names: ['영어Ⅰ'], exam: false }
  assert.equal(H.bookFitsCourse({ title: 'High School Common English 1(고등 공통영어 1) 해설서', year: '2025' }, e1), false, '공통영어1 안의 영어1')
  assert.equal(H.bookFitsCourse({ title: '고등 영어1 자습서(김성연)(2026)', year: '2026' }, e1), true)
  assert.equal(H.bookFitsCourse({ title: '쎈 고등 확률과 통계(2026)(22개정)', year: '2024' }, { school: 'high', curriculum: '2015', names: ['확률과 통계'], exam: false }), false, '22개정 표시')
  assert.equal(H.isExamBook('EBS 수능특강 문학작품 연계 기출1'), true)
  assert.equal(H.isExamBook('고등 문학 자습서(2026)'), false)
  assert.equal(H.bookGradeOk('중학 국어 1-1 자습서', '2'), false)
  assert.equal(H.bookGradeOk('중학 영어1 자습서', '2'), false)
  assert.equal(H.bookGradeOk('중학 국어 2-1 자습서', '2'), true)
  assert.equal(H.bookGradeOk('EBS 필독 중학 국어 문법', '2'), true, '학년 표시 없으면 통과')
  assert.ok(H.bookScore({ title: '고등 문학 자습서', provider: '비상교육', year: '2026' }, '*') > H.bookScore({ title: '문학 길잡이', provider: '어느출판', year: '2019' }, '*'))
  // 자모로 풀린 제목(NFD)도 차단어·단원 비교가 됨
  const nfd = '3년 후 수능에서 만점 받는 법 l 다항식 OT'.normalize('NFD')
  assert.equal(H.blocked(nfd, 'high', { titleBlockWords: ['만점 받는 법'], gradeBlockWords: {} }), true)
  assert.equal(H.titleHasUnit(nfd, '다항식'), true)
  assert.equal(H.termConflict('22개정 중2수학 기출문제풀이ㅡ2학기 1차고사 3강', '중2', '1'), true)
  assert.equal(H.termConflict('중2 1학기 일차함수', '중2', '1'), false)
  assert.equal(H.isEbsLinked('[고3]ebs27문학 현대시5강'), true)
  assert.equal(H.isEbsLinked('27 수특 문학 현대시 01'), true)
  assert.equal(H.isEbsLinked('현대시 개념 총정리'), false)
  // 인기도: 조회수·구독자 많은 쪽이 앞, 작은 채널(1천 미만)은 뒤로
  const pv = { kind: 'video', views: 300000, year: '2024' }
  assert.ok(H.popScore(pv, 500000) > H.popScore({ kind: 'video', views: 2000, year: '2024' }, 500000))
  assert.ok(H.popScore(pv, 500) < H.popScore(pv, 50000), '작은 채널 감점')
  assert.equal(H.popScore({ kind: 'book' }, 1e6), 0)
  assert.equal(H.videoIdOf({ url: 'https://www.youtube.com/watch?v=DF4Jj5JPOVs' }), 'DF4Jj5JPOVs')
  // 과목 이름 속 단원 말('확률과 통계'의 '통계')은 단원 표시로 보지 않음
  const statUnits = ['경우의 수', '확률', '통계']
  assert.equal(H.bookFitsUnit('EBS 수능특강 확률과 통계', '확률', statUnits, {}, ['확률과 통계']), true)
  assert.equal(H.bookFitsUnit('고등 확률과 통계 통계 집중', '확률', statUnits, {}, ['확률과 통계']), false)
  // 카카오는 로마 숫자로 찾지 못함 → 숫자 검색어
  const qs = H.bookQueries({ subject: 'math', group: 'general', label: '미적분Ⅰ' }, '미적분Ⅰ', null, ['2'])
  assert.ok(qs.includes('미적분1 자습서') && !qs.some((q) => /[ⅠⅡ]/.test(q)))
  assert.equal(H.bookFitsUnit('EBS 중학 국어 현대시 감상', '문학', units, src.filters), true)
  assert.equal(H.bookFitsUnit('EBS 필독 중학 비문학 읽기(2021)', '문학', units, src.filters), false, '비문학은 문학이 아님')
  assert.equal(H.bookFitsUnit('EBS 필독 중학 비문학 읽기(2021)', '읽기', units, src.filters), true)
  assert.equal(H.seriesKey('EBS 필독 중학 문법(2021)'), H.seriesKey('EBS 필독 중학 국어 문법'))
  assert.equal(H.bookFitsUnit('EBS 올림포스 대수(2022 개정)', '삼각함수', ['지수함수와 로그함수', '삼각함수', '수열'], src.filters), true, '과목 전체 책은 그대로')
  assert.equal(H.seriesKey('EBS 필독 중학 국어 문법 완성 2000제(2025)'), H.seriesKey('EBS 필독 중학 국어 문법'))
  assert.notEqual(H.seriesKey('EBS 올림포스 대수'), H.seriesKey('EBS 올림포스 미적분Ⅰ'))
})

test('v3 표현 강화: 과목 타일·단계 아이콘, 성적 화면 오른쪽 정렬, 움직임은 reduced-motion에서 끔', () => {
  const html = read('design/prototype/index.html')
  const app = read('design/prototype/app.js')
  assert.match(app, /function subjTile\(/)
  assert.match(app, /class="step-icon" aria-hidden="true"/)
  assert.match(app, /class="score-row"/)
  assert.match(html, /\.score-input \{[^}]*align-items: flex-end/)
  const rm = html.slice(html.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
  for (const sel of ['.m-swap', '.fresh .item', '.step-icon']) assert.ok(rm.includes(sel), 'reduced-motion에서 끔: ' + sel)
  assert.ok(!/linear-gradient|radial-gradient/.test(html), '그라데이션 없음')
})

test('추천 카드: 보기·숨기기 줄은 카드 맨 아래(같은 줄 카드끼리 같은 위치), 사이트 바로가기 링크 없음 (사용자 요청 2026-11-12)', () => {
  const html = read('design/prototype/index.html')
  const app = read('design/prototype/app.js')
  assert.match(html, /\.item-body \.item-actions \{ margin-top: auto;/)
  assert.match(app, /class="item-body"/)
  assert.ok(!/class="site-link"/.test(app), '영상 묶음 아래 사이트 바로가기 없음')
})

test('추천 종류 탭: 맨 위 하나로 모든 단원 [영상 강의]·[수능 대비]·[책 추천] (사용자 요청 2026-11-15): 접근성·기본 탭·인쇄·움직임', () => {
  const html = read('design/prototype/index.html')
  const app = read('design/prototype/app.js')
  assert.match(app, /class="rec-tabs" role="tablist" aria-label="추천 종류"/)
  assert.match(app, /role="tab" id="rec-kind-' \+ k\.id \+ '" aria-controls="rec-kind-panel"/)
  assert.match(app, /id="rec-kind-panel" role="tabpanel" aria-labelledby="rec-kind-/)
  assert.match(app, /state\.recKind \|\| 'video'/, '기본은 영상 강의')
  assert.match(app, /label: '책 추천'/)
  assert.match(app, /label: '수능 대비'/)
  assert.match(app, /a === 'reckind'/)
  assert.ok(!/data-action="rectab"/.test(app), '단원마다 있던 작은 탭은 없음')
  assert.match(app, /querySelectorAll\('\.rec-group'\)/, '모든 단원의 묶음을 함께 바꿈')
  // 방향키는 role=tab 공통 처리 (과목 탭과 같은 코드)
  assert.match(app, /t\.getAttribute\('role'\) !== 'tab'/)
  assert.match(html, /\.rec-tabs button\[aria-selected='true'\]/)
  assert.match(html, /\.rec-group\[hidden\] \{ display: block !important; \}/, '인쇄는 모든 묶음')
  assert.match(html, /\.m-swap, \.m-tab,/, 'reduced-motion에서 탭 전환 움직임 끔')
})

test('같은 채널·같은 책 시리즈 몰림 방지, 단원마다 다른 책 설명 (사용자 캡처 2026-11-15)', () => {
  const app = read('design/prototype/app.js')
  const src = app.slice(app.indexOf('function dedupe'), app.indexOf('function groupCards'))
  const remote = {}
  const dedupe = new Function('remote', src + '; return dedupe')(remote)
  const slot = (key, title) => ({ getAttribute: (n) => (n === 'data-key' ? key : title) })
  const v = (id, ch, forUnit) => ({ url: 'u' + id, channelId: ch, forUnit })
  remote.a = { videos: [v(1, 'A', true), v(2, 'A', true), v(3, 'A', true), v(4, 'B', true), v(5, 'C', false)] }
  const out = dedupe([slot('a', '문법')], 'videos', 3, true).lists.a
  assert.deepEqual(out.map((x) => x.channelId).sort(), ['A', 'A', 'B'], '이 단원 강의 채널마다 1개 먼저, 같은 채널은 2개까지 (단원 밖 C보다 먼저)')
  remote.c = { videos: [v(1, 'A', true), v(2, 'A', true), v(3, 'A', true), v(5, 'C', false)] }
  const only = dedupe([slot('c', '문법')], 'videos', 3, true).lists.c
  assert.deepEqual(only.map((x) => x.channelId).sort(), ['A', 'A', 'C'], '한 채널이 3칸을 다 차지하지 않음')
  const b = (id, series) => ({ url: 'b' + id, series })
  remote.x = { books: [b(1, 's1'), b(2, 's2')] }
  remote.y = { books: [b(3, 's1'), b(4, 's3')] }
  const bo = dedupe([slot('x', '어휘'), slot('y', '문법')], 'books', 2, false).lists
  assert.deepEqual(bo.y.map((x) => x.url), ['b4'], '다른 판이라도 같은 시리즈는 과목 탭 안에서 한 번')
  const r1 = H.bookUnitReason({ title: '중학 영어2 자습서(윤정미 외)', provider: '동아출판' }, '문법')
  const r2 = H.bookUnitReason({ title: '중학 영어2 자습서(윤정미 외)', provider: '동아출판' }, '어휘')
  assert.equal(r1, '문법 단원: 교과서 문법 내용을 다시 정리할 때 보는 동아출판 자습서')
  assert.notEqual(r1, r2)
  assert.ok(!/최고|강추|1등|추천 1위/.test(r1))
})

test('과목명 혼동: 같은 교과 다른 과목 이름이 제목에 있으면 뺌, allowOtherNames는 허용 (운영 표본 2026-11-13)', () => {
  const cur = JSON.parse(read('data/curriculum.json'))
  const c = (id) => cur.courses.find((x) => x.id === id)
  const e2 = H.otherCourseKeys(cur.courses, c('e22-e2'))
  assert.ok(H.courseNameConflict('영어2 천재(안) 독해와작문 1과 본문 해설', e2))
  assert.ok(H.courseNameConflict('고1 공통영어2 YBM(박) 2022년 개정', e2))
  assert.ok(!H.courseNameConflict('영어2 천재 3과 본문 해설', e2))
  assert.ok(H.courseNameConflict('[22개정 신사고 쎈 확률과통계] 이항분포', H.otherCourseKeys(cur.courses, c('mm22-2b'))))
  assert.ok(!H.courseNameConflict('정승제의 확률과통계 순열과 조합', H.otherCourseKeys(cur.courses, c('m22-c1'))), '공통수학1은 확률과 통계 강의 허용')
  // 2022 화법과 언어는 별칭(화법과 작문·언어와 매체)이 자기 이름이라 걸리지 않음
  assert.ok(!H.courseNameConflict('화법과 작문 핵심 정리', H.otherCourseKeys(cur.courses, c('k22-speech'))))
  const approved = recs.items.filter((it) => it.review.status === 'approved' && (it.kind === 'video' || it.kind === 'playlist'))
  // 진로·융합(relaxedVideo) 과목은 단원 주제가 같은 다른 과목 강의를 일부러 허용 (사용자 요청 2026-11-15)
  assert.ok(!approved.some((it) => !c(it.courseId).relaxedVideo && H.courseNameConflict(it.title, H.otherCourseKeys(cur.courses, c(it.courseId)))), '승인 목록에 과목명 혼동 없음')
})

test('진로·융합 수학(relaxedVideo): 예전 교육과정 강의 허용·표시, 다른 과목은 그대로 (사용자 요청 2026-11-15)', () => {
  const cur = JSON.parse(read('data/curriculum.json'))
  const c = (id) => cur.courses.find((x) => x.id === id)
  for (const id of ['m22-econ', 'm22-ai', 'm22-job', 'm22-cult', 'm22-pstat', 'm22-inq']) assert.equal(c(id).relaxedVideo, true, id)
  assert.ok(!c('m22-geo').relaxedVideo && !c('m22-calc2').relaxedVideo, '이미 채워진 진로 과목은 완화하지 않음')
  assert.equal(H.ruleCurriculum(c('m22-pstat')), 'relaxed')
  assert.equal(H.ruleCurriculum(c('m22-alg')), '2022')
  assert.equal(H.videoRuleFails({ kind: 'video', year: '2016', title: '통계적 탐구' }, src.filters, 'relaxed'), '')
  assert.equal(H.videoRuleFails({ kind: 'video', year: '2016', title: '수열' }, src.filters, '2022'), 'old')
  assert.equal(H.oldCurriculumVideo(c('m22-pstat'), { kind: 'video', year: '2019' }), true)
  assert.equal(H.oldCurriculumVideo(c('m22-pstat'), { kind: 'video', year: '2025' }), false)
  assert.equal(H.oldCurriculumVideo(c('m22-alg'), { kind: 'video', year: '2019' }), false)
  assert.match(read('design/prototype/app.js'), /예전 교육과정 강의/)
})

test('책 카드: 저자 자리표시 값 빼기, 서점 자리표시 표지는 아이콘으로 (운영 지적 2026-11-15)', () => {
  assert.equal(H.cleanAuthors('미사용인물코드'), '')
  assert.equal(H.cleanAuthors('김성연, 저자 미상'), '김성연')
  assert.equal(H.cleanAuthors('윤정미, 이병민'), '윤정미, 이병민')
  const cfg = { placeholderHashes: [require('crypto').createHash('sha1').update(Buffer.from('ph')).digest('hex')] }
  assert.equal(H.isPlaceholderCover(Buffer.from('ph'), cfg), true)
  assert.equal(H.isPlaceholderCover(Buffer.from('real'), cfg), false)
  assert.ok(src.images.placeholderHashes.length >= 1)
  const app = read('design/prototype/app.js')
  assert.match(app, /function thumbPlaceholder/)
  assert.match(app, /addEventListener\('error'/)
  assert.match(read('design/prototype/index.html'), /\.thumb-empty\.book \{ aspect-ratio/)
})

test('글씨 크기·선명도 (사용자 요청 2026-11-15): 시스템 글꼴, 웹폰트 없음, 가는 굵기 없음, 글자 애니메이션은 끝나면 풀림', () => {
  for (const f of ['design/prototype/index.html', 'design/mockups/landing.html']) {
    const h = read(f)
    assert.match(h, /font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR'/, f)
    assert.ok(!/fonts\.googleapis/.test(h), f + ' 웹폰트 없음')
    assert.ok(!/font-weight: (100|200|300)\b/.test(h), f + ' 가는 굵기 없음')
  }
  const h = read('design/prototype/index.html')
  assert.match(h, /\.course-of, \.item-kind, \.source-note, \.side \.note \{ font-size: 14px; \}/)
  for (const cls of ['m-tab', 'm-swap', 'fresh \\.item']) assert.match(h, new RegExp('\\.' + cls + ' \\{ animation: [^}]*backwards;'), cls)
  assert.match(read('design/mockups/motion.css'), /\.m-enter \{ animation: [^}]*backwards;/)
})

test('computeRecs: 서버 없이 같은 계산 (1-B 빌드 스크립트가 같이 씀)', () => {
  const data = { src, curriculum: JSON.parse(read('data/curriculum.json')), items: recs.items, chStats: {} }
  const r = H.computeRecs({ courses: ['m22-alg'], unit: '수열', school: 'high', purpose: 'both', grade: 'h2', max: 8 }, data)
  assert.ok(Array.isArray(r.videos) && r.videos.length > 0 && r.videos.length <= 8)
  assert.ok(r.videos.some((v) => v.forUnit), '이 단원 강의')
  assert.ok(Array.isArray(r.examVideos) && Array.isArray(r.books))
  const naesin = H.computeRecs({ courses: ['m22-alg'], unit: '수열', school: 'high', purpose: 'naesin', grade: 'h2' }, data)
  assert.deepEqual(naesin.examVideos, [], '내신 학생에게는 수능 대비 강의 없음')
  assert.ok(naesin.videos.length <= 3 && naesin.books.length <= 2, '기본 3개·2권')
  // 같은 입력이면 같은 결과 (파일·시간에 기대지 않음)
  assert.deepEqual(H.computeRecs({ courses: ['e-mid'], unit: '문법', school: 'middle', grade: 'm2' }, data), H.computeRecs({ courses: ['e-mid'], unit: '문법', school: 'middle', grade: 'm2' }, data))
  assert.ok(!/readJson|searchParams/.test(H.computeRecs.toString()), '파일·요청을 직접 다루지 않음')
})

test('사용자 결정 2026-11-15: 서비스 이름 공부길, 고1 수능 대비 탭 숨김', () => {
  for (const f of ['design/prototype/index.html', 'design/prototype/app.js', 'design/mockups/landing.html', 'design/icons/favicon.svg']) {
    const h = read(f)
    assert.ok(!h.includes('〈서비스 이름〉'), f)
    assert.ok(h.includes('공부길'), f)
  }
  assert.match(read('design/prototype/app.js'), /isHigh\(\) && state\.grade !== 'h1' && \(state\.purpose === 'suneung'/)
})

test('같은 추천을 공유하는 단원은 카드 하나로, 위 ○○에 있어요 반복 카드 없음 (사용자 요청 2026-11-15)', () => {
  const app = read('design/prototype/app.js')
  const src = app.slice(app.indexOf('function dedupe'), app.indexOf('function allConfident'))
  const remote = {}
  const groupCards = new Function('remote', src + '; return groupCards')(remote)
  const v = (u, forUnit, ch) => ({ url: u, forUnit, channelId: ch || u })
  const course = [v('c1', false), v('c2', false), v('c3', false), v('c4', false)]
  remote.voc = { videos: course }
  remote.gram = { videos: course }
  remote.read = { videos: [v('r1', true), v('r2', true)].concat(course) }
  remote.listen = { videos: course }
  const e = (title, key, check) => ({ title, check, q: { key } })
  const cards = groupCards([e('어휘', 'voc', 'weak'), e('독해', 'read', 'weak'), e('문법', 'gram', 'normal'), e('듣기', 'listen', 'normal')], 'videos', 3, true)
  assert.equal(cards.length, 2, '어휘·문법·듣기는 한 카드, 독해(단원 전용 강의)는 따로')
  const merged = cards.find((g) => g.entries.length === 3)
  assert.deepEqual(merged.entries.map((x) => x.title), ['어휘', '문법', '듣기'])
  assert.ok(merged.items.length > 0)
  const read1 = cards.find((g) => g.entries[0].title === '독해')
  assert.ok(read1.items.some((x) => x.forUnit), '독해 카드는 단원 강의')
  const all = cards.flatMap((g) => g.items.map((x) => x.url))
  assert.equal(new Set(all).size, all.length, '카드끼리 겹치지 않음')
  // 겹쳐서 비게 된 카드는 그 항목이 보이는 카드에 합침
  remote.a = { books: [{ url: 'b1' }] }
  remote.b = { books: [{ url: 'b1' }, { url: 'b2' }] }
  remote.c = { books: [{ url: 'b2' }] }
  const bc = groupCards([e('가', 'a', 'weak'), e('나', 'b', 'normal'), e('다', 'c', 'normal')], 'books', 2, false)
  assert.ok(bc.every((g) => g.items.length > 0), '빈 카드 없음')
  assert.ok(!app.includes('위 ‘\' + title'), '위 ○○에 있어요 문구 만드는 코드 없음')
  assert.match(app, /이 단원들은 같은 추천이에요/)
  assert.match(read('design/prototype/index.html'), /\.rec-card \.group-head/)
})

test('대체 강의 안내: 단원 강의가 없을 때만 "준비하는 동안", 일부 대체면 개수 (운영 표본 2026-11-15)', () => {
  const app = read('design/prototype/app.js')
  assert.ok(app.includes("var note = es.length > 1 || !subst ? '' : !own ? '이 단원만 다루는 강의를 준비하는 동안"))
  assert.match(app, /'이 가운데 ' \+ subst \+ '개는 같은 과목의 다른 단원 강의예요\.'/)
})

test('책 추천 이유: EBS 교재는 EBS 책에만, 시중 교재는 출판사 정식 이름 + 책 종류 (사용자 캡처 2026-11-13)', () => {
  assert.equal(H.autoReason({ kind: 'book', provider: '미래엔', title: '고등 영어2 자습서(미래엔 김성연)(2026)' }, '영어Ⅱ'), '영어Ⅱ 과목 · 미래엔 자습서')
  assert.equal(H.autoReason({ kind: 'book', provider: '천재교육사', title: '고등 문학 자습서' }, '문학'), '문학 과목 · 천재교육 자습서')
  assert.equal(H.autoReason({ kind: 'book', provider: 'EBS한국교육방송공사', title: 'EBS 올림포스 대수' }, '대수'), '대수 과목 · EBS 교재')
  assert.equal(H.autoReason({ kind: 'book', provider: '좋은책신사고', title: '쎈 중등 수학 2-1' }, '1학기'), '1학기 과목 · 좋은책신사고 문제집')
  assert.equal(H.pubName('미래엔에듀'), '미래엔')
  const books = recs.items.filter((it) => it.kind === 'book' && it.review.status === 'approved')
  assert.ok(!books.some((it) => /EBS 교재/.test(it.reason) && !/EBS/.test(it.provider)), '시중 교재에 EBS 교재 없음')
  assert.ok(!books.some((it) => /천재교육사|미래엔에듀/.test(it.provider)), '출판사 정식 이름')
})

test('수능 대비 구분: 기출 해설·기출의 미래·실전 모의고사는 개념 칸이 아니라 수능 대비 묶음 (operator 확인 2026-11-12)', () => {
  assert.ok(H.isExam('지수함수와 로그함수 (1) I  수학Ⅰ I 2023 수능 기출의 미래', src.filters))
  assert.ok(H.isExam('2027 FINAL 실전 모의고사', src.filters))
  assert.ok(H.isExam('[2025학년도 고3 9월 모의평가 해설강의] 미적분', src.filters))
  assert.ok(!H.isExam('지수함수와 로그함수 35분에 끝내기 | 수학1(대수) 2강', src.filters), '개념 강의는 그대로')
  assert.ok(!H.isExam("연계+기출+실전연습 한 번에 끝내기 | 한병훈의 수능완성 '독서' 지문 완벽 분석", src.filters), '고3 수능완성 지문 분석은 개념 칸 (사용자 결정)')
})

test('1-B screen.css 는 프로토타입 스타일과 같다 (옮긴 뒤 어긋나지 않게)', () => {
  const src = read('design/prototype/index.html')
  const proto = src.slice(src.indexOf('<style>') + 7, src.indexOf('</style>')).trim()
  const web = read('web/app/screen.css')
  assert.ok(web.includes(proto), 'design/prototype/index.html 의 <style> 을 web/app/screen.css 로 다시 복사')
})

test('전 과목 시험 해설 재생목록(과목 이름 없음)은 받지 않음 (1-B 시나리오 3 확인 2026-11-15)', () => {
  assert.equal(H.mixedExamPlaylist('2024학년도 고3 6월 모의평가 해설'), true)
  assert.equal(H.mixedExamPlaylist('2025학년도 대학수학능력시험 해설강의✍🏻'), true)
  assert.equal(H.mixedExamPlaylist('[2025학년도 고3 9월 모의평가 해설강의] 언어와 매체'), false)
  assert.equal(H.mixedExamPlaylist('수능특강 영어 독해'), false)
  const approved = recs.items.filter((it) => it.review.status === 'approved' && it.kind === 'playlist')
  assert.ok(!approved.some((it) => H.mixedExamPlaylist(it.title)), '승인 목록에 전 과목 해설 재생목록 없음')
})

test('Vercel 배포 준비 (Q-8 = Vercel, 2026-11-15): 정적 내보내기·빌드 때 추천 생성·환경 변수 없음', () => {
  const v = JSON.parse(read('web/vercel.json'))
  // 프리셋 없이(Other) out/ 정적 파일만: nextjs 프리셋 + out 은 routes-manifest 를 out/ 에서 찾다 실패 (NEXT_NO_ROUTES_MANIFEST, 2026-11-16 첫 배포)
  assert.equal(v.framework, null)
  assert.equal(v.outputDirectory, 'out')
  assert.equal(v.buildCommand, 'npm run build')
  assert.ok(!('env' in v) && !('build' in v && v.build.env), '환경 변수 없음')
  const pkg = JSON.parse(read('web/package.json'))
  assert.match(pkg.scripts.build, /^npm run recs && next build$/, '빌드 때 추천 JSON을 data/에서 다시 만듦')
  assert.match(read('web/next.config.ts'), /output: 'export'/)
  const h = v.headers[0].headers.map((x) => x.key + '=' + x.value)
  assert.ok(h.includes('Referrer-Policy=no-referrer'))
})
