// 수준 계산·추천 방향·단원 목록·입력 검사 (README "추천 기준", design/prototype/app.js 와 같은 규칙)
// 화면과 상관없는 순수 함수만 둔다 → tests/rules.test.ts 로 모든 경우를 확인
import type { Area, Check, Course, Curriculum, GradeId, Level, Purpose, Score, Step, SubjectId } from './types.ts'

export const STEPS: Step[] = ['info', 'grades', 'areas', 'result', 'recommend']
export const STEP_TITLE: Record<Step, string> = {
  info: '학년과 과목을 골라 주세요',
  grades: '최근 성적을 적어 주세요',
  areas: '약하다고 느끼는 곳을 표시해 주세요',
  result: '진단 결과',
  recommend: '추천'
}
export const GRADES: { id: GradeId; label: string }[] = [
  { id: 'm1', label: '중1' }, { id: 'm2', label: '중2' }, { id: 'm3', label: '중3' },
  { id: 'h1', label: '고1' }, { id: 'h2', label: '고2' }, { id: 'h3', label: '고3' }
]
export const SUBJECTS: { id: SubjectId; label: string }[] = [
  { id: 'korean', label: '국어' }, { id: 'english', label: '영어' }, { id: 'math', label: '수학' }
]
// 2026학년도 기준 내신 등급제 (README: 고1·고2 5등급제, 고3 9등급제)
export const NAESIN_SCALE: Record<string, 5 | 9> = { h1: 5, h2: 5, h3: 9 }

export const DIRECTIONS: Record<Level, Record<'weak' | 'normal', [string, string]>> = {
  low: { weak: ['concept-basic', 'easy-concept'], normal: ['concept-basic', 'basic-workbook'] },
  mid: { weak: ['concept-review', 'type-workbook'], normal: ['type-practice', 'basic-workbook'] },
  high: { weak: ['concept-review', 'hard-workbook'], normal: ['advanced', 'hard-workbook'] }
}
export const TYPE_LABEL: Record<string, string> = {
  'concept-basic': '개념 기초 강의', 'concept-review': '개념 정리 강의', 'type-practice': '유형 연습 강의', advanced: '심화 강의',
  'easy-concept': '쉬운 개념서', 'basic-workbook': '기본 문제집', 'type-workbook': '유형별 문제집', 'hard-workbook': '고난도 문제집'
}
export const LEVEL_LABEL: Record<Level, string> = { high: '상', mid: '중', low: '하' }
const LEVEL_RANK: Record<Level, number> = { low: 0, mid: 1, high: 2 }
export const CHECK_LABEL: Record<Check, string> = { confident: '자신 있음', normal: '보통', weak: '약함' }
export const PURPOSE_LABEL: Record<Purpose, string> = { naesin: '내신 대비', suneung: '수능 대비', both: '둘 다' }

export const isHighGrade = (g: string | null) => !!g && g.charAt(0) === 'h'
export const gradeLabelOf = (g: string | null) => GRADES.find((x) => x.id === g)?.label ?? ''

/* ---------- 수준 계산 (README 표, 경계값은 임시 기준) ---------- */
export const levelFromScore = (n: number): Level => (n >= 90 ? 'high' : n >= 70 ? 'mid' : 'low')
export const levelFromAch = (a: string | null): Level => (a === 'A' ? 'high' : a === 'B' || a === 'C' ? 'mid' : 'low')
export const levelFromGrade9 = (n: number): Level => (n <= 2 ? 'high' : n <= 5 ? 'mid' : 'low')
export const levelFromGrade5 = (n: number): Level => (n <= 1 ? 'high' : n <= 3 ? 'mid' : 'low')

export function levelOf(grade: GradeId, purpose: Purpose | null, sc: Score): { level: Level; why: string } {
  if (!isHighGrade(grade)) {
    if (sc.mode === 'score') {
      const n = parseInt(sc.score, 10), l = levelFromScore(n)
      return { level: l, why: n + '점이라 ' + LEVEL_LABEL[l] + ' 수준으로 봤어요.' }
    }
    const l = levelFromAch(sc.ach)
    return { level: l, why: '성취도 ' + sc.ach + '라서 ' + LEVEL_LABEL[l] + ' 수준으로 봤어요.' }
  }
  const scale = NAESIN_SCALE[grade]
  const hasN = String(sc.naesin).trim() !== '', hasM = String(sc.mock).trim() !== ''
  const nL = hasN ? (scale === 5 ? levelFromGrade5 : levelFromGrade9)(parseInt(sc.naesin, 10)) : null
  const mL = hasM ? levelFromGrade9(parseInt(sc.mock, 10)) : null
  const nTxt = '내신 ' + sc.naesin + '등급(' + (nL ? LEVEL_LABEL[nL] : '') + ')'
  const mTxt = '모의고사 ' + sc.mock + '등급(' + (mL ? LEVEL_LABEL[mL] : '') + ')'
  if (nL && !mL) return { level: nL, why: '내신 ' + sc.naesin + '등급(' + scale + '등급제)이라 ' + LEVEL_LABEL[nL] + ' 수준으로 봤어요.' }
  if (mL && !nL) return { level: mL, why: '모의고사 ' + sc.mock + '등급이라 ' + LEVEL_LABEL[mL] + ' 수준으로 봤어요.' }
  const n = nL as Level, m = mL as Level
  if (purpose === 'naesin') return { level: n, why: '내신 대비를 골라서 ' + nTxt + '을 기준으로 봤어요.' }
  if (purpose === 'suneung') return { level: m, why: '수능 대비를 골라서 ' + mTxt + '을 기준으로 봤어요.' }
  // 둘 다 → 두 등급 중 낮은 쪽 수준 (약한 쪽을 먼저 보충)
  const low = LEVEL_RANK[n] <= LEVEL_RANK[m] ? n : m
  if (n === m) return { level: low, why: nTxt + '과 ' + mTxt + '이 같아서 ' + LEVEL_LABEL[low] + ' 수준으로 봤어요.' }
  const lowTxt = low === n ? nTxt : mTxt, highTxt = low === n ? mTxt : nTxt
  return { level: low, why: lowTxt + '이 ' + highTxt + '보다 낮아서, ' + LEVEL_LABEL[low] + ' 수준으로 봤어요. 둘 다 준비한다고 골랐기 때문이에요.' }
}

// 추천 방향: '자신 있음'은 추천하지 않고, 과목의 모든 영역이 '자신 있음'이면 자기 수준의 '보통' 칸 (README)
export function directionOf(level: Level, check: Check): [string, string] | null {
  if (check === 'confident') return null
  return DIRECTIONS[level][check]
}

/* ---------- 과목(코스)·단원 ---------- */
export function offerOf(cur: Curriculum, grade: string | null, subject: SubjectId): Course[] {
  const ids = (grade && cur.offer[grade]?.[subject]) || []
  // 단원을 채우지 못한 과목(hidden)은 학생 선택지에서 뺌
  return ids.map((id) => cur.courses.find((c) => c.id === id)).filter((c): c is Course => !!c && !c.hidden)
}
export const needsCoursePick = (cur: Curriculum, grade: string | null, subject: SubjectId) => offerOf(cur, grade, subject).length > 1
export function chosenCourses(cur: Curriculum, grade: string | null, subject: SubjectId, picked: string[] = []): Course[] {
  const offer = offerOf(cur, grade, subject)
  if (offer.length === 1) return offer
  return offer.filter((c) => picked.includes(c.id))
}
export function areasOf(cur: Curriculum, grade: string, subject: SubjectId, picked: string[] = []): Area[] {
  const many = needsCoursePick(cur, grade, subject)
  const out: Area[] = []
  for (const c of chosenCourses(cur, grade, subject, picked)) {
    const units = c.units.length ? c.units : [c.label + ' 전체']
    units.forEach((u, i) => out.push({
      id: grade + '-' + subject + '-' + c.id + '-' + (i + 1), label: u, whole: !c.units.length,
      course: c, courseTag: many && c.group !== 'term' ? c.label : '', curriculum: cur.curriculumByGrade[grade]
    }))
  }
  return out
}
export const areaName = (a: Area) => (a.courseTag && !a.whole ? a.label + ' (' + a.courseTag + ')' : a.label)

/* ---------- 입력 검사 ---------- */
export type DiagState = {
  grade: GradeId | null
  subjects: SubjectId[]
  courses: Partial<Record<SubjectId, string[]>>
  purpose: Purpose | null
  scores: Partial<Record<SubjectId, Score>>
  checks: Partial<Record<SubjectId, Record<string, Check>>>
}
export type Errors = Record<string, string | string[]>

const isInt = (v: string) => /^\d+$/.test(String(v).trim())
export const emptyScore = (): Score => ({ mode: 'score', score: '', ach: null, naesin: '', mock: '' })
const subjectLabel = (id: SubjectId) => SUBJECTS.find((s) => s.id === id)?.label ?? id

export function validate(cur: Curriculum, s: DiagState, step: Step): Errors {
  const e: Errors = {}
  const high = isHighGrade(s.grade)
  if (step === 'info') {
    if (!s.grade) e.grade = '학년을 골라 주세요.'
    if (!s.subjects.length) e.subjects = '과목을 하나 이상 골라 주세요.'
    if (high && !s.purpose) e.purpose = '지금 준비하는 시험을 골라 주세요.'
    if (s.grade) for (const id of s.subjects) {
      if (needsCoursePick(cur, s.grade, id) && !chosenCourses(cur, s.grade, id, s.courses[id]).length) {
        e['courses-' + id] = subjectLabel(id) + (high ? '에서 지금 배우는 과목을 하나 이상 골라 주세요.' : '에서 배운 범위를 하나 이상 골라 주세요.')
      }
    }
  }
  if (step === 'grades') {
    for (const id of s.subjects) {
      const sc = s.scores[id] ?? emptyScore()
      if (!high) {
        if (sc.mode === 'score') {
          const v = String(sc.score).trim()
          if (v === '') e[id + '-score'] = '성적을 적어 주세요.'
          else if (!isInt(v) || +v > 100) e[id + '-score'] = '0부터 100까지 정수로 적어 주세요. 지금 적은 값: ' + v
        } else if (!sc.ach) e[id + '-ach'] = '성취도를 골라 주세요.'
      } else {
        const n = String(sc.naesin).trim(), m = String(sc.mock).trim(), scale = NAESIN_SCALE[s.grade as string]
        if (n === '' && m === '') e[id + '-naesin'] = '내신이나 모의고사 중 하나는 적어 주세요.'
        if (n !== '' && (!isInt(n) || +n < 1 || +n > scale)) e[id + '-naesin'] = '내신 등급은 1부터 ' + scale + '까지 적을 수 있어요. 지금 적은 값: ' + n
        if (m !== '' && (!isInt(m) || +m < 1 || +m > 9)) e[id + '-mock'] = '모의고사 등급은 1부터 9까지 적을 수 있어요. 지금 적은 값: ' + m
      }
    }
  }
  if (step === 'areas' && s.grade) {
    for (const id of s.subjects) {
      const c = s.checks[id] ?? {}
      const miss = areasOf(cur, s.grade, id, s.courses[id]).filter((a) => !c[a.id])
      if (miss.length) e['areas-' + id] = miss.map(areaName)
    }
  }
  return e
}

export function stepReady(cur: Curriculum, s: DiagState, step: Step): boolean {
  const i = STEPS.indexOf(step)
  for (let k = 0; k < i; k++) if (Object.keys(validate(cur, s, STEPS[k])).length) return false
  return true
}

export function allConfident(cur: Curriculum, s: DiagState, id: SubjectId): boolean {
  const c = s.checks[id] ?? {}
  return areasOf(cur, s.grade as string, id, s.courses[id]).every((a) => c[a.id] === 'confident')
}

// 수능 대비 탭: 고2·고3이 '수능 대비'·'둘 다'를 골랐을 때만 (고1은 숨김, 사용자 결정 2026-11-15)
export const wantsExamTab = (grade: string | null, purpose: Purpose | null) =>
  isHighGrade(grade) && grade !== 'h1' && (purpose === 'suneung' || purpose === 'both')
