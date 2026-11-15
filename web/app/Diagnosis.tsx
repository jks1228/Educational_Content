'use client'
// 진단 1~5단계 (design/prototype/app.js 를 옮김). 마크업·클래스는 프로토타입과 같게 → screen.css 그대로 적용
// 입력은 이 페이지 메모리에만 있음. 서버로 보내지 않고 브라우저 저장소에도 저장하지 않음 (PRD 9장). 주소에는 단계 이름만
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  STEPS, STEP_TITLE, GRADES, SUBJECTS, NAESIN_SCALE, TYPE_LABEL, LEVEL_LABEL, CHECK_LABEL, PURPOSE_LABEL,
  isHighGrade, gradeLabelOf, levelOf, offerOf, needsCoursePick, chosenCourses, areasOf, areaName, validate, stepReady,
  allConfident, wantsExamTab, emptyScore, DIRECTIONS, type DiagState, type Errors
} from '@/lib/rules'
import { recPath, mergeFiles, filterLists, groupCards, mergedReason, scopeNote, MAX_BOOKS, MAX_VIDEOS, type Field, type Lists } from '@/lib/recs'
import type { Area, Check, Curriculum, GradeId, Purpose, RecFile, RecItem, Score, Step, SubjectId } from '@/lib/types'

type Kind = 'video' | 'exam' | 'book'
type UI = DiagState & {
  tab: { areas: SubjectId | null; recommend: SubjectId | null }
  recKind: Kind
  hidden: Record<string, boolean>
  feedback: string | null
  notice: string | null
}
const fresh = (): UI => ({ grade: null, subjects: [], courses: {}, purpose: null, scores: {}, checks: {}, tab: { areas: null, recommend: null }, recKind: 'video', hidden: {}, feedback: null, notice: null })
const STEP_ICON: Record<Step, string> = { info: 'i-diagnosis', grades: 'i-score', areas: 'i-check-area', result: 'i-diagnosis', recommend: 'i-recommend' }
const KIND_FIELD: Record<Kind, Field> = { video: 'videos', exam: 'examVideos', book: 'books' }
const subjLabel = (id: SubjectId) => SUBJECTS.find((s) => s.id === id)?.label ?? id
const safeUrl = (u: string) => (/^https:\/\//.test(u || '') ? u : '')

function Icon({ id, cls }: { id: string; cls?: string }) {
  return <svg className={'icon' + (cls ? ' ' + cls : '')} aria-hidden="true"><use href={'/icons/icons.svg#' + id} /></svg>
}
function SubjTile({ id, small }: { id: SubjectId; small?: boolean }) {
  return <span className={'subj-icon ' + id + (small ? ' sm' : '')} aria-hidden="true"><Icon id={'i-' + id} /></span>
}
function ErrorText({ errors, k }: { errors: Errors; k: string }) {
  const v = errors[k]
  return v ? <p className="error" id={'err-' + k}>{String(v)}</p> : null
}
const invalidProps = (errors: Errors, k: string) => (errors[k] ? { 'aria-invalid': true, 'aria-describedby': 'err-' + k } : {})

// 표지·썸네일: 학생 브라우저가 바로 받음(no-referrer). 없거나 자리표시·못 불러오면 아이콘 (사용자 결정 2026-11-15 A안)
function Thumb({ it }: { it: RecItem }) {
  const [failed, setFailed] = useState(false)
  const isBook = it.kind === 'book'
  const src = it.noCover ? '' : safeUrl(it.thumbnail)
  if (!src || failed) return <span className={'thumb thumb-empty ' + (isBook ? 'book' : 'video')} aria-hidden="true"><Icon id={isBook ? 'i-book' : 'i-lecture'} cls="ph-icon" /></span>
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="thumb" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

function ItemCard({ it, onHide }: { it: RecItem; onHide: (id: string) => void }) {
  const isBook = it.kind === 'book', isCourse = it.kind === 'course'
  const other = it.channelGroup === 'other' ? ' · 다른 선생님 강의' : ''
  const site = isCourse ? it.provider || 'EBSi' : ''
  let kindText = isCourse ? site + ' 강좌' + (it.itemCount ? ' · ' + it.itemCount + '강' : '')
    : it.kind === 'playlist' ? '강좌 재생목록' + (it.itemCount ? ' · ' + it.itemCount + '강' : '') + other
      : it.kind === 'video' ? '영상 강의' + (it.durationMin ? ' · ' + it.durationMin + '분' : '') + other : '책'
  if (it.oldCurriculum) kindText += ' · 예전 교육과정 강의'
  const meta = (isBook ? [it.authors, it.provider].filter(Boolean).join(', ') : isCourse ? it.provider + (it.teacher ? ' · ' + it.teacher + ' 선생님' : '') : it.provider) +
    (it.year ? ', ' + it.year + '년' : '') + (it.isFree ? ' · 무료' : '')
  const url = safeUrl(it.url)
  return (
    <article className={'item ' + (isBook ? 'book' : 'video')}>
      <Thumb it={it} />
      <div className="item-body">
        <p className="item-kind"><Icon id={isBook ? 'i-book' : 'i-lecture'} cls="kind-icon" />{kindText}</p>
        <p className="item-title">{it.title}</p>
        <p className="item-meta">{meta}</p>
        {it.reason ? <p className="item-reason">{it.reason}</p> : null}
        {isCourse ? <p className="item-meta">{site} 무료 회원 로그인 후 볼 수 있어요</p> : null}
        {it.lastCheckedAt ? <p className="item-meta">확인한 날 {it.lastCheckedAt}</p> : null}
        <div className="item-actions">
          {url ? <a href={url} target="_blank" rel="noopener noreferrer">{isBook ? '책 정보 보기' : isCourse ? site + '에서 보기' : 'YouTube에서 보기'}<span className="sr-only"> (새 탭): {it.title}</span></a> : null}
          <button type="button" onClick={() => onHide(it.id)}>숨기기<span className="sr-only">: {it.title}</span></button>
        </div>
      </div>
    </article>
  )
}

type Entry = { title: string; check: Check | null; courseLabel: string; key: string; paths: string[]; cell: [string, string]; examCourse: boolean }

export default function Diagnosis() {
  const [cur, setCur] = useState<Curriculum | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [s, setS] = useState<UI>(fresh)
  const [step, setStep] = useState<Step>('info')
  const [errors, setErrors] = useState<Errors>({})
  const [announce, setAnnounce] = useState('')
  const [files, setFiles] = useState<Record<string, RecFile | 'fail'>>({})
  const prevIdx = useRef(-1)
  const [forward, setForward] = useState(false)
  const focusAfter = useRef<string | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const sRef = useRef(s)
  sRef.current = s

  const high = isHighGrade(s.grade)

  // 과목·단원 데이터를 불러온 뒤 시작
  useEffect(() => {
    fetch('/data/curriculum.json').then((r) => { if (!r.ok) throw new Error('data'); return r.json() }).then(setCur).catch(() => setLoadError(true))
  }, [])

  /* ---------- 이동: 주소 # 뒤에는 단계 이름만 ---------- */
  const route = useCallback(() => {
    if (!cur) return
    const m = location.hash.match(/^#\/(\w+)/)
    let next = (m && (STEPS as string[]).includes(m[1]) ? m[1] : null) as Step | null
    if (!next) { history.replaceState(null, '', '#/info'); next = 'info' }
    if (!stepReady(cur, sRef.current, next)) {
      if (next !== 'info') setS((x) => ({ ...x, notice: '새로고침하면 처음부터 다시 시작해요. 입력한 성적은 저장하지 않아요.' }))
      history.replaceState(null, '', '#/info'); next = 'info'
    } else if (next !== 'info') setS((x) => (x.notice ? { ...x, notice: null } : x))
    const idx = STEPS.indexOf(next)
    setForward(idx > prevIdx.current)
    setErrors({})
    setStep(next)
  }, [cur])
  useEffect(() => {
    if (!cur) return
    route()
    window.addEventListener('hashchange', route)
    return () => window.removeEventListener('hashchange', route)
  }, [cur, route])
  const go = (st: Step) => { if (location.hash === '#/' + st) route(); else location.hash = '#/' + st }

  // 단계가 바뀌면 맨 위로, 제목에 초점
  useEffect(() => {
    if (!cur) return
    const idx = STEPS.indexOf(step)
    if (idx !== prevIdx.current) {
      prevIdx.current = idx
      window.scrollTo(0, 0)
      document.getElementById('screen-title')?.focus()
    }
    document.title = STEP_TITLE[step] + ' · 공부길'
  }, [step, cur])
  // 다시 그린 뒤 초점 옮기기 (오류 칸·탭·숨긴 항목 다시 보기)
  useEffect(() => {
    if (!focusAfter.current) return
    const el = document.querySelector<HTMLElement>(focusAfter.current)
    focusAfter.current = null
    el?.focus()
  })

  // 입력이 바뀌면 이미 오류가 났던 칸만 다시 검사 (새 오류를 띄우지는 않음)
  const update = (fn: (x: UI) => UI) => {
    setS((x) => {
      const n = fn(x)
      if (cur) setErrors((e) => {
        const keys = Object.keys(e)
        if (!keys.length) return e
        const freshE = validate(cur, n, step)
        const out: Errors = {}
        for (const k of keys) if (freshE[k]) out[k] = freshE[k]
        return out
      })
      return n
    })
  }
  const scoreOf = (id: SubjectId): Score => s.scores[id] ?? emptyScore()
  const setScore = (id: SubjectId, patch: Partial<Score>) => update((x) => ({ ...x, scores: { ...x.scores, [id]: { ...(x.scores[id] ?? emptyScore()), ...patch } } }))

  const next = () => {
    if (!cur) return
    const e = validate(cur, s, step)
    if (Object.keys(e).length) {
      setErrors(e)
      const k = Object.keys(e)[0]
      if (step === 'info') focusAfter.current = k.startsWith('courses-') ? '[data-field="course"][data-subject="' + k.slice(8) + '"]' : '[data-field="' + (k === 'subjects' ? 'subject' : k) + '"]'
      if (step === 'grades') focusAfter.current = '#in-' + k + ', [data-field="ach"][data-subject="' + k.split('-')[0] + '"]'
      if (step === 'areas') {
        const sid = k.slice(6) as SubjectId
        setS((x) => ({ ...x, tab: { ...x.tab, areas: sid } }))
        focusAfter.current = '#panel-areas-' + sid + ' .area.missing input'
      }
      setAnnounce('입력을 확인해 주세요. ' + (step === 'areas' ? '아직 고르지 않은 영역이 있어요.' : ''))
      return
    }
    go(STEPS[STEPS.indexOf(step) + 1])
  }
  const back = (ev: React.MouseEvent) => {
    const i = STEPS.indexOf(step)
    if (i > 0) { ev.preventDefault(); history.back() }
  }

  /* ---------- 과목(코스)·단원 ---------- */
  const chosenSubjects = SUBJECTS.filter((x) => s.subjects.includes(x.id))
  const areas = (id: SubjectId): Area[] => (cur && s.grade ? areasOf(cur, s.grade, id, s.courses[id]) : [])
  const checksOf = (id: SubjectId) => s.checks[id] ?? {}

  // 과목 탭 (방향키로 옮기기)
  const tabKeys = (ev: React.KeyboardEvent<HTMLButtonElement>, ids: string[], cur0: string, pick: (id: string) => void, idPrefix: string) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return
    ev.preventDefault()
    const i = ids.indexOf(cur0)
    const n = ids[(i + (ev.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length]
    pick(n)
    focusAfter.current = '#' + idPrefix + n
  }
  const SubjectTabs = ({ kind, current, done }: { kind: 'areas' | 'recommend'; current: SubjectId; done?: (id: SubjectId) => boolean }) => {
    if (chosenSubjects.length < 2) return null
    const ids = chosenSubjects.map((x) => x.id)
    const pick = (id: string) => setS((x) => ({ ...x, tab: { ...x.tab, [kind]: id as SubjectId } }))
    return (
      <div className="tabs" role="tablist" aria-label="과목">
        {chosenSubjects.map((x) => {
          const sel = x.id === current
          return (
            <button key={x.id} type="button" role="tab" id={'tab-' + kind + '-' + x.id} aria-controls={'panel-' + kind + '-' + x.id} aria-selected={sel} tabIndex={sel ? 0 : -1}
              onClick={() => pick(x.id)} onKeyDown={(ev) => tabKeys(ev, ids, current, pick, 'tab-' + kind + '-')}>
              <SubjTile id={x.id} small />{x.label}
              {done?.(x.id) ? <> <span className="done-mark"><span aria-hidden="true">✓</span><span className="sr-only">(완료)</span></span></> : null}
            </button>
          )
        })}
      </div>
    )
  }

  /* ---------- 1단계 ---------- */
  const viewInfo = () => {
    if (!cur) return null
    return (
      <>
        {s.notice ? <div className="sec"><p className="notice" role="status">{s.notice}</p></div> : null}
        <fieldset className="sec" aria-describedby={errors.grade ? 'err-grade' : undefined}>
          <legend id="lg-grade">학년</legend>
          <div className="grid3 grades">
            {GRADES.map((g) => (
              <label key={g.id} className="pick">
                <input type="radio" name="grade" value={g.id} checked={s.grade === g.id} data-field="grade"
                  onChange={() => update((x) => {
                    const changed = x.grade && x.grade !== g.id
                    const base = changed ? { ...x, scores: {}, checks: {}, courses: {}, hidden: {}, feedback: null } : x
                    return { ...base, grade: g.id, purpose: isHighGrade(g.id) ? base.purpose : null }
                  })} />
                <span>{g.label}</span>
              </label>
            ))}
          </div>
          <ErrorText errors={errors} k="grade" />
        </fieldset>
        <fieldset className="sec" aria-describedby={errors.subjects ? 'err-subjects' : undefined}>
          <legend>진단할 과목 <span className="soft">여러 개 고를 수 있어요</span></legend>
          <div className="grid3 subjects">
            {SUBJECTS.map((x) => (
              <label key={x.id} className="pick">
                <input type="checkbox" value={x.id} checked={s.subjects.includes(x.id)} data-field="subject"
                  onChange={(ev) => update((y) => {
                    const on = ev.target.checked
                    const list = on ? [...y.subjects, x.id] : y.subjects.filter((z) => z !== x.id)
                    return { ...y, subjects: SUBJECTS.map((z) => z.id).filter((z) => list.includes(z)) }
                  })} />
                <span><SubjTile id={x.id} small />{x.label}</span>
              </label>
            ))}
          </div>
          <ErrorText errors={errors} k="subjects" />
        </fieldset>
        {high ? (
          <fieldset className="sec" aria-describedby={errors.purpose ? 'err-purpose' : undefined}>
            <legend>지금 준비하는 시험은 무엇인가요?</legend>
            <div className="grid3 subjects">
              {(['naesin', 'suneung', 'both'] as Purpose[]).map((p) => (
                <label key={p} className="pick">
                  <input type="radio" name="purpose" value={p} checked={s.purpose === p} data-field="purpose" onChange={() => update((x) => ({ ...x, purpose: p }))} />
                  <span>{PURPOSE_LABEL[p]}</span>
                </label>
              ))}
            </div>
            <ErrorText errors={errors} k="purpose" />
          </fieldset>
        ) : null}
        {s.grade ? chosenSubjects.filter((x) => needsCoursePick(cur, s.grade, x.id)).map((x) => courseFieldset(x.id)) : null}
      </>
    )
  }
  // 과목(코스) 고르기: 묶음별, 진로·융합 선택은 접어 둠 (고른 것이 있으면 펼침)
  const courseFieldset = (id: SubjectId) => {
    if (!cur) return null
    const key = 'courses-' + id, picked = s.courses[id] ?? [], offer = offerOf(cur, s.grade, id)
    const title = high ? subjLabel(id) + ': 지금 배우는 과목' : subjLabel(id) + ': 배운 범위'
    const toggle = (cid: string, on: boolean) => update((x) => {
      const list = x.courses[id] ?? []
      return { ...x, courses: { ...x.courses, [id]: on ? [...list.filter((z) => z !== cid), cid] : list.filter((z) => z !== cid) } }
    })
    return (
      <fieldset key={key} className="sec" aria-describedby={errors[key] ? 'err-' + key : undefined}>
        <legend>{title} <span className="soft">여러 개 고를 수 있어요</span></legend>
        {cur.groups.map((g) => {
          const list = offer.filter((c) => c.group === g.id)
          if (!list.length) return null
          const chips = (
            <div className="grid2 courses">
              {list.map((c) => (
                <label key={c.id} className="pick">
                  <input type="checkbox" value={c.id} checked={picked.includes(c.id)} data-field="course" data-subject={id} onChange={(ev) => toggle(c.id, ev.target.checked)} />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          )
          const anyPicked = list.some((c) => picked.includes(c.id))
          if (g.collapsed && !anyPicked) return <details key={g.id} className="more"><summary>{g.label} {list.length}개 더 보기</summary>{chips}</details>
          return <div key={g.id}>{g.label && g.id !== 'term' ? <p className="group-label">{g.label}</p> : null}{chips}</div>
        })}
        <ErrorText errors={errors} k={key} />
      </fieldset>
    )
  }

  /* ---------- 2단계 ---------- */
  const viewGrades = () => chosenSubjects.map((x) => {
    const sc = scoreOf(x.id)
    return (
      <fieldset key={x.id} className="sec score-card">
        <legend className="subj-legend"><SubjTile id={x.id} />{x.label}</legend>
        {!high ? (
          <div className="score-row">
            <div className="grid2 mode" role="radiogroup" aria-label={x.label + ' 성적 종류'}>
              {(['score', 'ach'] as const).map((m) => (
                <label key={m} className="pick">
                  <input type="radio" name={'mode-' + x.id} value={m} checked={sc.mode === m} data-field="mode" data-subject={x.id}
                    onChange={() => { setErrors((e) => { const n = { ...e }; delete n[x.id + '-score']; delete n[x.id + '-ach']; return n }); setScore(x.id, { mode: m }) }} />
                  <span>{m === 'score' ? '점수' : '성취도'}</span>
                </label>
              ))}
            </div>
            {/* 바뀐 입력칸만 살짝 나타나게 (key로 바뀔 때만 움직임) */}
            <div className="score-input m-swap" key={sc.mode}>
              {sc.mode === 'score' ? (
                <>
                  <div className="field">
                    <label htmlFor={'in-' + x.id + '-score'}>시험 점수 (0~100)</label>
                    <input id={'in-' + x.id + '-score'} type="text" inputMode="numeric" autoComplete="off" value={sc.score} onChange={(ev) => setScore(x.id, { score: ev.target.value })} {...invalidProps(errors, x.id + '-score')} />
                  </div>
                  <ErrorText errors={errors} k={x.id + '-score'} />
                </>
              ) : (
                <>
                  <div className="grid5" role="radiogroup" aria-label={x.label + ' 성취도'} aria-describedby={errors[x.id + '-ach'] ? 'err-' + x.id + '-ach' : undefined}>
                    {['A', 'B', 'C', 'D', 'E'].map((a) => (
                      <label key={a} className="pick">
                        <input type="radio" name={'ach-' + x.id} value={a} checked={sc.ach === a} data-field="ach" data-subject={x.id} id={'in-' + x.id + '-ach-' + a} onChange={() => setScore(x.id, { ach: a })} />
                        <span>{a}</span>
                      </label>
                    ))}
                  </div>
                  <ErrorText errors={errors} k={x.id + '-ach'} />
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {(['naesin', 'mock'] as const).map((f) => (
              <div key={f}>
                <div className="field">
                  <label htmlFor={'in-' + x.id + '-' + f}>{f === 'naesin' ? '내신 등급' : '모의고사 등급'}</label>
                  <input id={'in-' + x.id + '-' + f} type="text" inputMode="numeric" autoComplete="off" placeholder="비워 둠" value={sc[f]} onChange={(ev) => setScore(x.id, { [f]: ev.target.value })} {...invalidProps(errors, x.id + '-' + f)} />
                </div>
                <ErrorText errors={errors} k={x.id + '-' + f} />
              </div>
            ))}
          </>
        )}
      </fieldset>
    )
  })

  /* ---------- 3단계 ---------- */
  const viewAreas = () => {
    if (!cur || !s.grade) return null
    const curTab = s.tab.areas && s.subjects.includes(s.tab.areas) ? s.tab.areas : s.subjects[0]
    const missKeys = Object.keys(errors).filter((k) => k.startsWith('areas-'))
    const names = missKeys.flatMap((k) => errors[k] as string[])
    return (
      <>
        {missKeys.length ? <div className="sec"><p className="error" id="err-areas" role="alert">아직 고르지 않은 영역이 {names.length}개 있어요: {names.join(', ')}</p></div> : null}
        <div>
          <SubjectTabs kind="areas" current={curTab} done={(id) => areas(id).every((a) => checksOf(id)[a.id])} />
          {chosenSubjects.map((x) => {
            const list = areas(x.id), c = checksOf(x.id), missing = (errors['areas-' + x.id] as string[]) ?? []
            const many = needsCoursePick(cur, s.grade, x.id)
            let last: string | null = null
            return (
              <div key={x.id} className="panel sec areas-grid" id={'panel-areas-' + x.id} {...(chosenSubjects.length > 1 ? { role: 'tabpanel', 'aria-labelledby': 'tab-areas-' + x.id } : {})} hidden={x.id !== curTab}>
                <p className="soft" style={{ marginBottom: 16 }}>{x.label}, {list[0]?.curriculum} 개정 교육과정{many ? '. 1단계에서 고른 ' + (high ? '과목' : '범위') + '의 단원이에요.' : ''}</p>
                {list.map((a) => {
                  const miss = missing.includes(areaName(a)) && !c[a.id]
                  const head = many && a.course.id !== last ? <h3 className="course-head">{a.course.label}</h3> : null
                  last = a.course.id
                  return (
                    <div key={a.id} style={{ display: 'contents' }}>
                      {head}
                      <div className={'area' + (miss ? ' missing' : '')} role="radiogroup" aria-labelledby={'an-' + a.id}>
                        <p className="area-name" id={'an-' + a.id}>{a.label}{a.courseTag && !a.whole ? <span className="sr-only"> ({a.courseTag})</span> : null}{miss ? <> <span className="soft">(아직 안 고름)</span></> : null}</p>
                        <div className="seg">
                          {(['confident', 'normal', 'weak'] as Check[]).map((v) => (
                            <label key={v} className={'pick ' + v}>
                              <input type="radio" name={'ar-' + a.id} value={v} checked={c[a.id] === v} id={'in-' + a.id + '-' + v}
                                onChange={() => update((y) => ({ ...y, checks: { ...y.checks, [x.id]: { ...(y.checks[x.id] ?? {}), [a.id]: v } } }))} />
                              <span>{CHECK_LABEL[v]}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </>
    )
  }

  /* ---------- 4단계 ---------- */
  const viewResult = () => {
    if (!cur || !s.grade) return null
    return (
      <>
        {chosenSubjects.map((x) => {
          const lv = levelOf(s.grade as GradeId, s.purpose, scoreOf(x.id)), c = checksOf(x.id), list = areas(x.id)
          const weak = list.filter((a) => c[a.id] === 'weak'), normal = list.filter((a) => c[a.id] === 'normal')
          return (
            <section key={x.id} className="sec subject-result">
              <div className="result-top"><h3 className="subj-legend"><SubjTile id={x.id} />{x.label}</h3><p className="level m-reveal">수준<b>{LEVEL_LABEL[lv.level]}</b></p></div>
              <p className="soft why">{lv.why}</p>
              {allConfident(cur, s, x.id) ? (
                <p className="notice" style={{ marginTop: 12 }}>모든 영역에 자신 있다고 했어요. 그래서 약한 영역 대신, 지금 수준에서 한 단계 더 연습할 자료를 과목 전체로 골랐어요.</p>
              ) : (
                <>
                  <p className="sub-title">먼저 볼 영역</p>
                  <ul className="rows">{weak.concat(normal).map((a) => <li key={a.id}><span>{areaName(a)}</span><span className={'lv ' + c[a.id]}>{CHECK_LABEL[c[a.id]]}</span></li>)}</ul>
                </>
              )}
            </section>
          )
        })}
        <div className="sec"><p className="soft">수준을 나누는 기준은 아직 임시 기준이에요. 결과는 내가 직접 체크한 내용을 바탕으로 해요.</p></div>
      </>
    )
  }

  /* ---------- 5단계: 추천 ---------- */
  const examTab = wantsExamTab(s.grade, s.purpose)
  const recKind: Kind = s.recKind === 'exam' && !examTab ? 'video' : s.recKind
  const entriesOf = useCallback((id: SubjectId): Entry[] => {
    if (!cur || !s.grade) return []
    const lv = levelOf(s.grade, s.purpose, s.scores[id] ?? emptyScore()).level
    const list = areasOf(cur, s.grade, id, s.courses[id]), c = s.checks[id] ?? {}
    if (allConfident(cur, s, id)) {
      const courses = chosenCourses(cur, s.grade, id, s.courses[id])
      const paths = courses.map((x) => recPath(x.id, 'all'))
      return [{ title: subjLabel(id) + ' 전체', check: null, courseLabel: '', key: paths.join('+'), paths, cell: DIRECTIONS[lv].normal, examCourse: courses.some((x) => x.group === 'exam') }]
    }
    return list.filter((a) => c[a.id] === 'weak').concat(list.filter((a) => c[a.id] === 'normal')).map((a) => {
      const p = recPath(a.course.id, a.whole ? 'all' : a.course.units.indexOf(a.label))
      return { title: a.label, check: c[a.id], courseLabel: a.whole ? '' : a.courseTag, key: p, paths: [p], cell: DIRECTIONS[lv][c[a.id] as 'weak' | 'normal'], examCourse: a.course.group === 'exam' }
    })
  }, [cur, s])
  const recTab = s.tab.recommend && s.subjects.includes(s.tab.recommend) ? s.tab.recommend : s.subjects[0]

  // 지금 보이는 과목 탭의 파일만 받음 (이미 받은 것은 다시 받지 않음)
  useEffect(() => {
    if (step !== 'recommend' || !recTab) return
    const need = [...new Set(entriesOf(recTab).flatMap((e) => e.paths))].filter((p) => !files[p])
    need.forEach((p) => {
      fetch(p).then((r) => { if (!r.ok) throw new Error('recs'); return r.json() })
        .then((j: RecFile) => setFiles((f) => ({ ...f, [p]: j })))
        .catch(() => setFiles((f) => ({ ...f, [p]: 'fail' })))
    })
  }, [step, recTab, entriesOf, files])

  // 위 탭(추천 종류)을 바꾸면 내용만 옆에서 들어옴 (reduced-motion이면 CSS가 끔)
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    el.classList.remove('m-tab'); void el.offsetWidth; el.classList.add('m-tab')
  }, [recKind])

  const hide = (id: string) => { setS((x) => ({ ...x, hidden: { ...x.hidden, [id]: true } })); focusAfter.current = '#panel-recommend-' + recTab + ' .unhide' }
  const groupBlock = (title: string, items: RecItem[], emptyText: string, note: string) => {
    const shown = items.filter((it) => !s.hidden[it.id]), hiddenIds = items.filter((it) => s.hidden[it.id]).map((it) => it.id)
    return (
      <>
        <h4 className="group-head">{title}</h4>
        {note && items.length ? <p className="soft scope-note">{note}</p> : null}
        {shown.length ? <div className={'items ' + (title === '책' ? 'books' : 'videos')}>{shown.map((it) => <ItemCard key={it.id} it={it} onHide={hide} />)}</div> : null}
        {!shown.length && !hiddenIds.length ? <p className="empty">{emptyText}</p> : null}
        {hiddenIds.length ? <p className="soft">숨긴 항목 {hiddenIds.length}개 <button type="button" className="textlink unhide" onClick={() => setS((x) => { const h = { ...x.hidden }; hiddenIds.forEach((k) => delete h[k]); return { ...x, hidden: h } })}>다시 보기</button></p> : null}
      </>
    )
  }
  const cardView = (g: { id: string; entries: Entry[]; items: RecItem[] }, kind: Kind) => {
    const es = g.entries.slice().sort((a, b) => (a.check === 'weak' ? 0 : 1) - (b.check === 'weak' ? 0 : 1))
    const badge = (e: Entry) => (e.check ? <span className={'lv ' + e.check}>{CHECK_LABEL[e.check]}</span> : null)
    const oneCourse = es.every((x) => x.courseLabel === es[0].courseLabel)
    const dirs: { t: string; lab: string }[] = []
    for (const x of es) {
      const t = TYPE_LABEL[x.cell[0]] + ', ' + TYPE_LABEL[x.cell[1]]
      if (!dirs.some((d) => d.t === t)) dirs.push({ t, lab: es.length > 1 && x.check ? CHECK_LABEL[x.check] + ' 단원: ' : '' })
    }
    const titles = es.map((x) => x.title)
    const items = es.length > 1 ? g.items.map((it) => (it.kind === 'book' ? { ...it, reason: mergedReason(it.reason, g.entries[0].title, titles) } : it)) : g.items
    return (
      <section key={g.id} className="sec rec-card">
        {es.length === 1 ? (
          <>
            <div className="area-head"><h3>{es[0].title}</h3>{badge(es[0])}</div>
            {es[0].courseLabel ? <p className="course-of">{es[0].courseLabel}</p> : null}
          </>
        ) : (
          <>
            <h3 className="merged-title">{titles.join(' · ')}</h3>
            <ul className="unit-chips" aria-label="단원별 체크">{es.map((x) => <li key={x.key}>{x.title}{!oneCourse && x.courseLabel ? <> <span className="soft">({x.courseLabel})</span></> : null}{badge(x)}</li>)}</ul>
            {oneCourse && es[0].courseLabel ? <p className="course-of">{es[0].courseLabel}</p> : null}
            <p className="soft same-note">이 단원들은 같은 추천이에요.</p>
          </>
        )}
        {dirs.map((d) => <p key={d.t} className="direction">{dirs.length > 1 ? d.lab : ''}{d.t}</p>)}
        {kind === 'video' ? groupBlock('영상 강의', items, '확인을 마친 무료 강의를 준비하고 있어요.', scopeNote(items, s.hidden, es.length > 1))
          : kind === 'exam' ? groupBlock('수능 대비', items, '이 단원의 수능 대비 강의를 준비하고 있어요.', '수능·모의고사 문제를 풀고 해설하는 강의예요. 개념을 익힌 뒤에 보면 좋아요.')
            : groupBlock('책', items, '확인을 마친 책을 준비하고 있어요.', '')}
      </section>
    )
  }
  const panelBody = (id: SubjectId) => {
    const entries = entriesOf(id)
    const status = entries.map((e) => e.paths.map((p) => files[p]))
    if (status.some((st) => st.some((x) => !x))) return <div className="loading" role="status"><span className="sr-only">추천을 불러오는 중이에요</span><span></span><span></span></div>
    if (status.every((st) => st.every((x) => x === 'fail'))) return <div className="sec"><p className="empty">추천을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p></div>
    const lists: Record<string, Lists> = {}
    for (const e of entries) {
      const got = e.paths.map((p) => files[p]).filter((x): x is RecFile => !!x && x !== 'fail')
      lists[e.key] = filterLists(mergeFiles(got), { grade: s.grade, purpose: s.purpose, examCourse: e.examCourse })
    }
    const kinds: Kind[] = ['video', ...(examTab ? ['exam' as Kind] : []), 'book']
    return kinds.map((k) => {
      const cards = groupCards(entries.map((e) => ({ key: e.key, entry: e })), lists, KIND_FIELD[k], k === 'book' ? MAX_BOOKS : MAX_VIDEOS, k !== 'book')
      return <div key={k} className="rec-group" data-kind={k} hidden={k !== recKind}>{cards.map((g) => cardView(g, k))}</div>
    })
  }
  const pickKind = (k: string) => setS((x) => ({ ...x, recKind: k as Kind }))
  const viewRecommend = () => {
    if (!cur || !s.grade) return null
    const kinds: { id: Kind; label: string; icon: string }[] = [{ id: 'video', label: '영상 강의', icon: 'i-lecture' }, ...(examTab ? [{ id: 'exam' as Kind, label: '수능 대비', icon: 'i-lecture' }] : []), { id: 'book', label: '책 추천', icon: 'i-book' }]
    return (
      <>
        <div className="sec rec-kind-bar">
          <div className="rec-tabs" role="tablist" aria-label="추천 종류">
            {kinds.map((k) => (
              <button key={k.id} type="button" role="tab" id={'rec-kind-' + k.id} aria-controls="rec-kind-panel" aria-selected={k.id === recKind} tabIndex={k.id === recKind ? 0 : -1}
                onClick={() => pickKind(k.id)} onKeyDown={(ev) => tabKeys(ev, kinds.map((x) => x.id), recKind, pickKind, 'rec-kind-')}>
                <Icon id={k.icon} cls="kind-icon" />{k.label}
              </button>
            ))}
          </div>
        </div>
        <div id="rec-kind-panel" role="tabpanel" aria-labelledby={'rec-kind-' + recKind} ref={panelRef}>
          <SubjectTabs kind="recommend" current={recTab} />
          {chosenSubjects.map((x) => (
            <div key={x.id} className="panel" id={'panel-recommend-' + x.id} {...(chosenSubjects.length > 1 ? { role: 'tabpanel', 'aria-labelledby': 'tab-recommend-' + x.id } : {})} hidden={x.id !== recTab}>
              <div className="sec" style={{ paddingTop: 14, paddingBottom: 14 }}><p className="soft">{x.label} 수준 {LEVEL_LABEL[levelOf(s.grade as GradeId, s.purpose, scoreOf(x.id)).level]}에 맞춰 찾았어요</p></div>
              {x.id === recTab ? <div className="rec-body">{panelBody(x.id)}</div> : null}
            </div>
          ))}
        </div>
        <div className="sec"><p className="soft">강의 썸네일과 책 표지는 YouTube·카카오에서 바로 불러와요. 어느 화면에서 왔는지는 보내지 않고, 입력한 성적은 어디에도 보내지 않아요.</p></div>
        <section className="sec feedback">
          <h3 id="fb-title" tabIndex={-1}>추천이 도움이 됐나요?</h3>
          {s.feedback ? <p className="soft" role="status" style={{ marginTop: 6 }}>알려 줘서 고마워요.</p> : (
            <div className="row" role="group" aria-labelledby="fb-title">
              {(['yes', 'no'] as const).map((v) => <button key={v} type="button" onClick={() => feedback(v)}>{v === 'yes' ? '예' : '아니요'}</button>)}
            </div>
          )}
        </section>
        <div className="restart"><button type="button" className="textlink" onClick={() => { setS(fresh()); setFiles({}); prevIdx.current = -1; go('info') }}>처음부터 다시 하기</button></div>
      </>
    )
  }
  // 만족도: 분석 도구(Umami)는 사용자가 계정을 준비할 때까지 꺼 둠 — 켜지면 '예/아니요'만 보냄(성적·학년 없음, Q-6)
  const feedback = (v: 'yes' | 'no') => {
    setS((x) => ({ ...x, feedback: v }))
    focusAfter.current = '#fb-title'
    setAnnounce('알려 줘서 고마워요.')
    const w = window as unknown as { umami?: { track: (e: string, d: Record<string, string>) => void } }
    w.umami?.track('feedback', { value: v })
  }

  /* ---------- 틀 ---------- */
  if (loadError) return <div className="sec"><p className="error" role="alert">과목 정보를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p></div>
  const i = STEPS.indexOf(step) + 1
  const lead = step === 'grades'
    ? (high ? '내신과 모의고사 중 아는 것만 적어도 돼요. ' + gradeLabelOf(s.grade) + ' 내신은 1~' + NAESIN_SCALE[s.grade as string] + '등급, 모의고사는 1~9등급이에요.' : '최근 시험 점수나 성취도 중 하나를 골라 적어 주세요. 점수는 0부터 100까지 정수로 적어 주세요.')
    : step === 'areas' ? '영역마다 하나씩 골라 주세요.' : ''
  const rows: [string, string][] = []
  if (s.grade) rows.push(['학년', gradeLabelOf(s.grade)])
  if (s.subjects.length) rows.push(['과목', chosenSubjects.map((x) => x.label).join(', ')])
  if (high && s.purpose) rows.push(['목적', PURPOSE_LABEL[s.purpose]])
  const views: Record<Step, () => React.ReactNode> = { info: viewInfo, grades: viewGrades, areas: viewAreas, result: viewResult, recommend: viewRecommend }
  const label = { info: '다음', grades: '다음', areas: '다음', result: '추천 보기', recommend: '결과 인쇄하기' }[step]

  return (
    <>
      <div className="shell">
        <header className="appbar">
          <div className="appbar-row">
            {/* 1단계의 '뒤로'는 랜딩으로 (일반 링크) */}
            <a className="back" href={i > 1 ? '#/' + STEPS[i - 2] : '/'} onClick={back}><Icon id="i-back" />뒤로</a>
            <span className="brand" aria-hidden="true">공부길</span>
            <span className="step-text" role="img" aria-label={'5단계 중 ' + i + '단계'}><b>{i}</b> / 5</span>
          </div>
          <div className="progress-wrap"><div className="progress" aria-hidden="true"><span key={step} className={forward && i > 1 ? 'grow' : undefined} style={{ width: i * 20 + '%', ['--from' as string]: String((i - 1) / i) }} /></div></div>
        </header>
        <div className="frame">
          <aside className="side">
            <section aria-labelledby="side-title">
              <h2 id="side-title">진단 단계</h2>
              <ol className="steps">
                {STEPS.map((st, k) => <li key={st} className={k < i - 1 ? 'done' : undefined} aria-current={k === i - 1 ? 'step' : undefined}>{STEP_TITLE[st]}{k < i - 1 ? <span className="sr-only"> (완료)</span> : null}</li>)}
              </ol>
            </section>
            {rows.length ? <dl className="summary" aria-label="고른 것">{rows.map((r) => <div key={r[0]}><dt>{r[0]}</dt><dd>{r[1]}</dd></div>)}</dl> : null}
            <p className="note">입력한 성적은 이 화면에서만 쓰고 저장하지 않아요.</p>
          </aside>
          <div className="content">
            <main id="app" className={step === 'result' && chosenSubjects.length > 1 ? 'wide-result' : undefined}>
              <div className="head m-enter" key={step}>
                <div className="head-row"><span className="step-icon" aria-hidden="true"><Icon id={STEP_ICON[step]} /></span><h2 tabIndex={-1} id="screen-title">{STEP_TITLE[step]}</h2></div>
                {lead ? <p className="lead">{lead}</p> : null}
              </div>
              {cur ? views[step]() : <div className="loading" role="status"><span className="sr-only">불러오는 중이에요</span><span></span><span></span></div>}
            </main>
            <div className="bottom">
              <button type="button" className="primary m-press" onClick={step === 'recommend' ? () => window.print() : next}>{label}</button>
            </div>
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{announce}</p>
    </>
  )
}

