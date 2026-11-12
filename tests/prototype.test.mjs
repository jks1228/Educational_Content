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
  assert.deepEqual(f.minVideoYearByCurriculum, { 2015: 2018, 2022: 2018 })
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
  assert.equal(H.autoReason({ kind: 'book', unit: '삼각함수' }, '대수'), '대수 과목 · EBS 교재')
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
  const end = app.indexOf('function buildView(')
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

test('수능 대비 구분: 기출 해설·기출의 미래·실전 모의고사는 개념 칸이 아니라 수능 대비 묶음 (operator 확인 2026-11-12)', () => {
  assert.ok(H.isExam('지수함수와 로그함수 (1) I  수학Ⅰ I 2023 수능 기출의 미래', src.filters))
  assert.ok(H.isExam('2027 FINAL 실전 모의고사', src.filters))
  assert.ok(H.isExam('[2025학년도 고3 9월 모의평가 해설강의] 미적분', src.filters))
  assert.ok(!H.isExam('지수함수와 로그함수 35분에 끝내기 | 수학1(대수) 2강', src.filters), '개념 강의는 그대로')
  assert.ok(!H.isExam("연계+기출+실전연습 한 번에 끝내기 | 한병훈의 수능완성 '독서' 지문 완벽 분석", src.filters), '고3 수능완성 지문 분석은 개념 칸 (사용자 결정)')
})
