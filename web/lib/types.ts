// 1-B 화면이 쓰는 모양 (data/curriculum.json, public/recs/*.json)

export type Level = 'high' | 'mid' | 'low'
export type Check = 'confident' | 'normal' | 'weak'
export type Purpose = 'naesin' | 'suneung' | 'both'
export type Step = 'info' | 'grades' | 'areas' | 'result' | 'recommend'
export type SubjectId = 'korean' | 'english' | 'math'
export type GradeId = 'm1' | 'm2' | 'm3' | 'h1' | 'h2' | 'h3'

export type Course = {
  id: string
  subject: SubjectId
  curriculum: string
  group: string
  label: string
  units: string[]
  hidden?: boolean
}

export type Curriculum = {
  courses: Course[]
  offer: Record<string, Partial<Record<SubjectId, string[]>>>
  groups: { id: string; label: string; collapsed: boolean }[]
  curriculumByGrade: Record<string, string>
}

export type Score = { mode: 'score' | 'ach'; score: string; ach: string | null; naesin: string; mock: string }

export type Area = {
  id: string
  label: string
  whole: boolean
  course: Course
  courseTag: string
  curriculum: string
}

// 미리 만든 추천 파일의 항목 (server/api.cjs publicItem + 화면용 값)
export type RecItem = {
  id: string
  kind: 'course' | 'playlist' | 'video' | 'book'
  title: string
  provider: string
  authors: string
  year: string
  url: string
  thumbnail: string
  durationMin: number
  itemCount: number
  teacher: string
  channelGroup: string
  isFree: boolean
  reason: string
  lastCheckedAt: string
  channelId: string
  series: string
  forUnit?: boolean
  oldCurriculum?: boolean
  examBook?: boolean
  okGrades?: string[]
  noCover?: boolean
}

export type RecFile = { course: string; unit: string; videos: RecItem[]; examVideos: RecItem[]; books: RecItem[] }
