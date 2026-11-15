// README "추천 기준"의 모든 경우: 학년 × 입력 방식 × 학습 목적 × 6칸 × "모두 자신 있음" (ROADMAP 1-B 완료 기준)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  levelOf, directionOf, DIRECTIONS, TYPE_LABEL, NAESIN_SCALE, validate, areasOf, allConfident, wantsExamTab, emptyScore, stepReady
} from '../lib/rules.ts'
import type { Check, Curriculum, GradeId, Level, Purpose, Score } from '../lib/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const cur = JSON.parse(readFileSync(join(here, '..', '..', 'data', 'curriculum.json'), 'utf8')) as Curriculum
const rank: Record<Level, number> = { low: 0, mid: 1, high: 2 }
const sc = (p: Partial<Score>): Score => ({ ...emptyScore(), ...p })

// README 표 그대로 (기대값을 코드와 따로 적음)
const expScore = (n: number): Level => (n >= 90 ? 'high' : n >= 70 ? 'mid' : 'low')
const expAch: Record<string, Level> = { A: 'high', B: 'mid', C: 'mid', D: 'low', E: 'low' }
const expG9 = (n: number): Level => (n <= 2 ? 'high' : n <= 5 ? 'mid' : 'low')
const expG5 = (n: number): Level => (n === 1 ? 'high' : n <= 3 ? 'mid' : 'low')

test('중학교: 점수 0~100, 성취도 A~E (학습 목적 없음)', () => {
  for (const g of ['m1', 'm2', 'm3'] as GradeId[]) {
    for (let n = 0; n <= 100; n++) assert.equal(levelOf(g, null, sc({ mode: 'score', score: String(n) })).level, expScore(n), g + ' ' + n)
    for (const a of 'ABCDE') assert.equal(levelOf(g, null, sc({ mode: 'ach', ach: a })).level, expAch[a], g + ' ' + a)
  }
})

test('고등학교: 내신만·모의고사만·둘 다 × 내신 대비·수능 대비·둘 다 (고1·고2 5등급제, 고3 9등급제)', () => {
  const purposes: Purpose[] = ['naesin', 'suneung', 'both']
  for (const g of ['h1', 'h2', 'h3'] as GradeId[]) {
    const scale = NAESIN_SCALE[g]
    const expN = scale === 5 ? expG5 : expG9
    for (const p of purposes) {
      for (let n = 1; n <= scale; n++) assert.equal(levelOf(g, p, sc({ naesin: String(n) })).level, expN(n), `${g} ${p} 내신만 ${n}`)
      for (let m = 1; m <= 9; m++) assert.equal(levelOf(g, p, sc({ mock: String(m) })).level, expG9(m), `${g} ${p} 모의만 ${m}`)
      for (let n = 1; n <= scale; n++) for (let m = 1; m <= 9; m++) {
        const nL = expN(n), mL = expG9(m)
        const want = p === 'naesin' ? nL : p === 'suneung' ? mL : (rank[nL] <= rank[mL] ? nL : mL)
        const r = levelOf(g, p, sc({ naesin: String(n), mock: String(m) }))
        assert.equal(r.level, want, `${g} ${p} 내신${n} 모의${m}`)
        assert.ok(r.why.length > 0)
      }
    }
  }
})

test('추천 방향 6칸 (README 표), 자신 있음은 추천하지 않음', () => {
  const table: [Level, Check, string, string][] = [
    ['low', 'weak', '개념 기초 강의', '쉬운 개념서'], ['low', 'normal', '개념 기초 강의', '기본 문제집'],
    ['mid', 'weak', '개념 정리 강의', '유형별 문제집'], ['mid', 'normal', '유형 연습 강의', '기본 문제집'],
    ['high', 'weak', '개념 정리 강의', '고난도 문제집'], ['high', 'normal', '심화 강의', '고난도 문제집']
  ]
  for (const [l, c, lec, book] of table) {
    const d = directionOf(l, c)
    assert.ok(d)
    assert.deepEqual([TYPE_LABEL[d[0]], TYPE_LABEL[d[1]]], [lec, book], l + ' ' + c)
  }
  for (const l of ['low', 'mid', 'high'] as Level[]) assert.equal(directionOf(l, 'confident'), null)
})

test('모두 자신 있음: 과목 전체를 자기 수준의 "보통" 칸으로 (모든 학년·과목)', () => {
  for (const g of Object.keys(cur.offer) as GradeId[]) {
    for (const subject of ['korean', 'english', 'math'] as const) {
      const offer = cur.offer[g][subject] ?? []
      const picked = offer.filter((id) => !cur.courses.find((c) => c.id === id)?.hidden).slice(0, 1)
      const st = { grade: g, subjects: [subject], courses: { [subject]: picked }, purpose: 'both' as Purpose, scores: {}, checks: {} as Record<string, Record<string, Check>> }
      const areas = areasOf(cur, g, subject, picked)
      assert.ok(areas.length > 0, g + ' ' + subject)
      st.checks[subject] = Object.fromEntries(areas.map((a) => [a.id, 'confident' as Check]))
      assert.equal(allConfident(cur, st, subject), true)
      for (const l of ['low', 'mid', 'high'] as Level[]) assert.deepEqual(DIRECTIONS[l].normal, directionOf(l, 'normal'))
      st.checks[subject][areas[0].id] = 'weak'
      assert.equal(allConfident(cur, st, subject), false)
    }
  }
})

test('입력 검사: 학년·과목·목적·과목(코스), 점수 범위, 등급 범위, 고르지 않은 영역', () => {
  const base = { grade: null, subjects: [], courses: {}, purpose: null, scores: {}, checks: {} }
  assert.deepEqual(Object.keys(validate(cur, base, 'info')).sort(), ['grade', 'subjects'])
  const h2 = { ...base, grade: 'h2' as GradeId, subjects: ['math' as const] }
  const e = validate(cur, h2, 'info')
  assert.ok(e.purpose && e['courses-math'], '고2: 목적과 수학 과목 고르기 필요')
  const ok = { ...h2, purpose: 'both' as Purpose, courses: { math: ['m22-alg'] } }
  assert.deepEqual(validate(cur, ok, 'info'), {})
  assert.match(String(validate(cur, { ...ok, scores: { math: sc({ naesin: '6' }) } }, 'grades')['math-naesin']), /1부터 5까지/)
  assert.match(String(validate(cur, { ...ok, grade: 'h3', courses: { math: ['m15-m1'] }, scores: { math: sc({ naesin: '9', mock: '10' }) } }, 'grades')['math-mock']), /1부터 9까지/)
  const m1 = { ...base, grade: 'm1' as GradeId, subjects: ['english' as const], scores: { english: sc({ score: '101' }) } }
  assert.match(String(validate(cur, m1, 'grades')['english-score']), /0부터 100까지/)
  assert.ok(Array.isArray(validate(cur, m1, 'areas')['areas-english']), '고르지 않은 영역 목록')
  assert.equal(stepReady(cur, base, 'grades'), false, '앞 단계가 안 되면 다음 단계로 못 감')
})

test('수능 대비 탭: 고2·고3의 수능 대비·둘 다만 (고1·중학교·내신 대비는 숨김)', () => {
  assert.equal(wantsExamTab('h2', 'both'), true)
  assert.equal(wantsExamTab('h3', 'suneung'), true)
  assert.equal(wantsExamTab('h1', 'both'), false)
  assert.equal(wantsExamTab('h2', 'naesin'), false)
  assert.equal(wantsExamTab('m2', null), false)
})
