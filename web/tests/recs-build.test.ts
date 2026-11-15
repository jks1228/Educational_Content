// 1-B 빌드 결과(public/recs) 확인 — npm run recs 뒤에 실행 (Node 24 TypeScript 바로 실행 + node --test)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..', '..')
const RECS = join(here, '..', 'public', 'recs')

type Course = { id: string; units: string[]; hidden?: boolean }
const cur = JSON.parse(readFileSync(join(ROOT, 'data', 'curriculum.json'), 'utf8')) as { courses: Course[]; offer: Record<string, Record<string, string[]>> }
const offered = new Set(Object.values(cur.offer).flatMap((s) => Object.values(s).flat()))
const visible = cur.courses.filter((c) => !c.hidden && offered.has(c.id))

test('보이는 과목마다 과목 전체(all)와 단원별 추천 파일이 있다', () => {
  assert.ok(existsSync(RECS), 'npm run recs 를 먼저 실행')
  for (const c of visible) {
    assert.ok(existsSync(join(RECS, c.id, 'all.json')), c.id + ' all')
    c.units.forEach((_, i) => assert.ok(existsSync(join(RECS, c.id, i + '.json')), c.id + ' ' + i))
  }
})

test('파일 모양: 영상·수능 대비 최대 8, 책에 수능 교재 표시·맞는 학년, 성적 값 없음', () => {
  for (const c of visible) {
    c.units.forEach((u, i) => {
      const j = JSON.parse(readFileSync(join(RECS, c.id, i + '.json'), 'utf8'))
      assert.equal(j.course, c.id)
      assert.equal(j.unit, u)
      assert.ok(j.videos.length <= 8 && j.examVideos.length <= 8)
      for (const b of j.books) {
        assert.equal(typeof b.examBook, 'boolean')
        assert.ok(Array.isArray(b.okGrades))
      }
      assert.ok(!/"score"|"naesin"|"mock"/.test(JSON.stringify(j)), '성적 값이 들어가지 않음')
    })
  }
})
