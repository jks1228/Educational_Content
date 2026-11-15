/*
  클릭형 단계별 프로토타입 (1-A 목업, 바닐라 JS)
  - 한 번에 한 화면만 보여 줌: #/info → #/grades → #/areas → #/result → #/recommend
  - 입력값은 이 페이지의 메모리에만 있음. 서버로 보내지 않고, 브라우저 저장소에도 저장하지 않음 (PRD 9장)
  - 주소의 # 뒤에는 단계 이름만 들어감 (성적·수준·체크 결과는 넣지 않음)
  - 규칙은 README "추천 기준"의 간단한 버전
  - 추천(5단계)은 미리보기 서버 /api/recs 에서 '승인된 항목'만 받음 (바깥 검색 없음, docs/api-decision.md)
    표지·썸네일은 /api/img 를 거쳐 받음. 서버에는 과목(코스)·단원 이름만 보내고 성적·체크 결과는 보내지 않음
  - 과목(코스)·단원 목록은 data/curriculum.json 에서 읽음 (코드에 목록을 쓰지 않음, docs/data-format.md)
    과목(코스)이 여럿인 학년은 1단계에서 "지금 배우는 과목"을 고르고, 3단계는 고른 과목의 단원으로 체크
*/
(function () {
  'use strict';

  var ICONS = '../icons/icons.svg';
  var LANDING = '../mockups/landing.html';
  var STEPS = ['info', 'grades', 'areas', 'result', 'recommend'];
  var STEP_TITLE = {
    info: '학년과 과목을 골라 주세요',
    grades: '최근 성적을 적어 주세요',
    areas: '약하다고 느끼는 곳을 표시해 주세요',
    result: '진단 결과',
    recommend: '추천'
  };

  /* ---------- 예시 데이터 ---------- */
  var GRADES = [
    { id: 'm1', label: '중1' }, { id: 'm2', label: '중2' }, { id: 'm3', label: '중3' },
    { id: 'h1', label: '고1' }, { id: 'h2', label: '고2' }, { id: 'h3', label: '고3' }
  ];
  var SUBJECTS = [
    { id: 'korean', label: '국어', short: '국', icon: 'i-korean' },
    { id: 'english', label: '영어', short: '영', icon: 'i-english' },
    { id: 'math', label: '수학', short: '수', icon: 'i-math' }
  ];
  var NAESIN_SCALE = { h1: 5, h2: 5, h3: 9 }; // 2026학년도 기준
  // 과목(코스)·단원: data/curriculum.json (시작할 때 한 번 불러옴)
  var CUR = null;
  var DATA_URL = '../data/curriculum.json';

  var DIRECTIONS = {
    low: { weak: ['concept-basic', 'easy-concept'], normal: ['concept-basic', 'basic-workbook'] },
    mid: { weak: ['concept-review', 'type-workbook'], normal: ['type-practice', 'basic-workbook'] },
    high: { weak: ['concept-review', 'hard-workbook'], normal: ['advanced', 'hard-workbook'] }
  };
  var TYPE_LABEL = {
    'concept-basic': '개념 기초 강의', 'concept-review': '개념 정리 강의', 'type-practice': '유형 연습 강의', 'advanced': '심화 강의',
    'easy-concept': '쉬운 개념서', 'basic-workbook': '기본 문제집', 'type-workbook': '유형별 문제집', 'hard-workbook': '고난도 문제집'
  };
  var TYPE_REASON = {
    'concept-basic': '처음부터 개념을 차근차근 설명해 줘요.',
    'concept-review': '헷갈리는 개념을 짧게 다시 정리해 줘요.',
    'type-practice': '자주 나오는 문제 유형을 하나씩 풀어 줘요.',
    'advanced': '어려운 문제를 푸는 생각 순서를 보여 줘요.',
    'easy-concept': '그림과 쉬운 예로 개념을 익히기 좋아요.',
    'basic-workbook': '기본 문제로 개념을 손에 익히기 좋아요.',
    'type-workbook': '유형별로 묶여 있어 강의 뒤에 바로 연습하기 좋아요.',
    'hard-workbook': '실력을 한 단계 올릴 고난도 문제가 모여 있어요.'
  };
  var LEVEL_LABEL = { high: '상', mid: '중', low: '하' };
  var LEVEL_RANK = { low: 0, mid: 1, high: 2 };
  var CHECK_LABEL = { confident: '자신 있음', normal: '보통', weak: '약함' };

  /* ---------- 상태 (메모리만) ---------- */
  var state = freshState();
  function freshState() {
    return { grade: null, subjects: [], courses: {}, purpose: null, scores: {}, checks: {}, tab: { areas: null, recommend: null }, recKind: 'video', hidden: {}, feedback: null, errors: {}, notice: null };
  }
  var lastStepIndex = -1;

  /* ---------- 도움 함수 ---------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // 과목 타일: 과목마다 다른 바탕색 + 과목 기호 (화면 어디서든 과목을 한눈에, v3 표현 강화 2026-11-12)
  function subjTile(id, small) { return '<span class="subj-icon ' + id + (small ? ' sm' : '') + '" aria-hidden="true">' + icon('i-' + id) + '</span>'; }
  var STEP_ICON = { info: 'i-diagnosis', grades: 'i-score', areas: 'i-check-area', result: 'i-diagnosis', recommend: 'i-recommend' };
  function icon(id, cls) { return '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="' + ICONS + '#' + id + '"/></svg>'; }
  function isHigh() { return state.grade && state.grade.charAt(0) === 'h'; }
  function subj(id) { return SUBJECTS.filter(function (s) { return s.id === id; })[0]; }
  function gradeLabel() { return (GRADES.filter(function (g) { return g.id === state.grade; })[0] || {}).label || ''; }
  function chosenSubjects() { return SUBJECTS.filter(function (s) { return state.subjects.indexOf(s.id) !== -1; }); }
  function course(id) { return CUR.courses.filter(function (c) { return c.id === id; })[0]; }
  // 이 학년에서 고를 수 있는 과목(코스) 목록
  function offerOf(subjectId) {
    var ids = (CUR.offer[state.grade] || {})[subjectId] || [];
    // 단원을 아직 채우지 못한 과목(hidden)은 학생 선택지에서 뺌 (docs/data-format.md 3-1)
    return ids.map(course).filter(function (c) { return c && !c.hidden; });
  }
  function needsCoursePick(subjectId) { return offerOf(subjectId).length > 1; }
  // 고른 과목(코스). 고를 것이 하나뿐이면 그것
  function chosenCourses(subjectId) {
    var offer = offerOf(subjectId);
    if (offer.length === 1) return offer;
    var picked = state.courses[subjectId] || [];
    return offer.filter(function (c) { return picked.indexOf(c.id) !== -1; });
  }
  // 단원 목록. 단원이 비어 있는 과목은 "과목 전체" 한 칸
  function areasOf(subjectId) {
    var g = state.grade, many = needsCoursePick(subjectId), out = [];
    chosenCourses(subjectId).forEach(function (c) {
      var units = c.units.length ? c.units : [c.label + ' 전체'];
      units.forEach(function (u, i) {
        out.push({
          id: g + '-' + subjectId + '-' + c.id + '-' + (i + 1), label: u, whole: !c.units.length,
          course: c, courseTag: many && c.group !== 'term' ? c.label : '',
          curriculum: CUR.curriculumByGrade[g]
        });
      });
    });
    return out;
  }
  // 화면에 보이는 이름: 과목(코스)이 여럿이면 "단원 (과목)"
  function areaName(a) { return a.courseTag && !a.whole ? a.label + ' (' + a.courseTag + ')' : a.label; }
  function scoreOf(s) {
    if (!state.scores[s]) state.scores[s] = { mode: 'score', score: '', ach: null, naesin: '', mock: '' };
    return state.scores[s];
  }
  function checksOf(s) { if (!state.checks[s]) state.checks[s] = {}; return state.checks[s]; }
  function isInt(v) { return /^\d+$/.test(String(v).trim()); }

  /* ---------- 수준 계산 (README 표의 간단한 버전) ---------- */
  function levelFromScore(n) { return n >= 90 ? 'high' : n >= 70 ? 'mid' : 'low'; }
  function levelFromAch(a) { return a === 'A' ? 'high' : (a === 'B' || a === 'C') ? 'mid' : 'low'; }
  function levelFromGrade9(n) { return n <= 2 ? 'high' : n <= 5 ? 'mid' : 'low'; }
  function levelFromGrade5(n) { return n <= 1 ? 'high' : n <= 3 ? 'mid' : 'low'; }
  function levelOf(s) {
    var sc = scoreOf(s);
    if (!isHigh()) {
      if (sc.mode === 'score') { var n = parseInt(sc.score, 10); return { level: levelFromScore(n), why: n + '점이라 ' + LEVEL_LABEL[levelFromScore(n)] + ' 수준으로 봤어요.' }; }
      return { level: levelFromAch(sc.ach), why: '성취도 ' + sc.ach + '라서 ' + LEVEL_LABEL[levelFromAch(sc.ach)] + ' 수준으로 봤어요.' };
    }
    var scale = NAESIN_SCALE[state.grade];
    var hasN = String(sc.naesin).trim() !== '', hasM = String(sc.mock).trim() !== '';
    var nL = hasN ? (scale === 5 ? levelFromGrade5 : levelFromGrade9)(parseInt(sc.naesin, 10)) : null;
    var mL = hasM ? levelFromGrade9(parseInt(sc.mock, 10)) : null;
    var nTxt = '내신 ' + sc.naesin + '등급(' + LEVEL_LABEL[nL] + ')', mTxt = '모의고사 ' + sc.mock + '등급(' + LEVEL_LABEL[mL] + ')';
    if (hasN && !hasM) return { level: nL, why: '내신 ' + sc.naesin + '등급(' + scale + '등급제)이라 ' + LEVEL_LABEL[nL] + ' 수준으로 봤어요.' };
    if (hasM && !hasN) return { level: mL, why: '모의고사 ' + sc.mock + '등급이라 ' + LEVEL_LABEL[mL] + ' 수준으로 봤어요.' };
    if (state.purpose === 'naesin') return { level: nL, why: '내신 대비를 골라서 ' + nTxt + '을 기준으로 봤어요.' };
    if (state.purpose === 'suneung') return { level: mL, why: '수능 대비를 골라서 ' + mTxt + '을 기준으로 봤어요.' };
    var low = LEVEL_RANK[nL] <= LEVEL_RANK[mL] ? nL : mL;
    if (nL === mL) return { level: low, why: nTxt + '과 ' + mTxt + '이 같아서 ' + LEVEL_LABEL[low] + ' 수준으로 봤어요.' };
    var lowTxt = low === nL ? nTxt : mTxt, highTxt = low === nL ? mTxt : nTxt;
    return { level: low, why: lowTxt + '이 ' + highTxt + '보다 낮아서, ' + LEVEL_LABEL[low] + ' 수준으로 봤어요. 둘 다 준비한다고 골랐기 때문이에요.' };
  }

  /* ---------- 검증 ---------- */
  function validate(step) {
    var e = {};
    if (step === 'info') {
      if (!state.grade) e.grade = '학년을 골라 주세요.';
      if (!state.subjects.length) e.subjects = '과목을 하나 이상 골라 주세요.';
      if (isHigh() && !state.purpose) e.purpose = '지금 준비하는 시험을 골라 주세요.';
      if (state.grade) chosenSubjects().forEach(function (s) {
        if (needsCoursePick(s.id) && !chosenCourses(s.id).length) {
          e['courses-' + s.id] = s.label + (isHigh() ? '에서 지금 배우는 과목을 하나 이상 골라 주세요.' : '에서 배운 범위를 하나 이상 골라 주세요.');
        }
      });
    }
    if (step === 'grades') {
      chosenSubjects().forEach(function (s) {
        var sc = scoreOf(s.id);
        if (!isHigh()) {
          if (sc.mode === 'score') {
            var v = String(sc.score).trim();
            if (v === '') e[s.id + '-score'] = '성적을 적어 주세요.';
            else if (!isInt(v) || +v > 100) e[s.id + '-score'] = '0부터 100까지 정수로 적어 주세요. 지금 적은 값: ' + v;
          } else if (!sc.ach) e[s.id + '-ach'] = '성취도를 골라 주세요.';
        } else {
          var n = String(sc.naesin).trim(), m = String(sc.mock).trim(), scale = NAESIN_SCALE[state.grade];
          if (n === '' && m === '') e[s.id + '-naesin'] = '내신이나 모의고사 중 하나는 적어 주세요.';
          if (n !== '' && (!isInt(n) || +n < 1 || +n > scale)) e[s.id + '-naesin'] = '내신 등급은 1부터 ' + scale + '까지 적을 수 있어요. 지금 적은 값: ' + n;
          if (m !== '' && (!isInt(m) || +m < 1 || +m > 9)) e[s.id + '-mock'] = '모의고사 등급은 1부터 9까지 적을 수 있어요. 지금 적은 값: ' + m;
        }
      });
    }
    if (step === 'areas') {
      chosenSubjects().forEach(function (s) {
        var c = checksOf(s.id), miss = areasOf(s.id).filter(function (a) { return !c[a.id]; });
        if (miss.length) e['areas-' + s.id] = miss.map(areaName);
      });
    }
    return e;
  }
  // 이미 오류가 났던 칸만 다시 검사 (입력하는 동안 새 오류를 띄우지는 않음)
  function refreshErrors(step) {
    var keys = Object.keys(state.errors);
    if (!keys.length) return;
    var fresh = validate(step);
    keys.forEach(function (k) { if (fresh[k]) state.errors[k] = fresh[k]; else delete state.errors[k]; });
  }
  // 칸 하나의 오류 표시만 고침 (화면 전체를 다시 그리지 않아 초점이 그대로)
  function syncFieldError(key) {
    var input = document.getElementById('in-' + key), err = document.getElementById('err-' + key);
    if (state.errors[key]) {
      if (err) err.textContent = state.errors[key];
      return;
    }
    if (err) err.remove();
    if (input) { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
  }
  function syncAreasAlert() {
    var alertEl = document.getElementById('err-areas');
    if (!alertEl) return;
    var keys = Object.keys(state.errors).filter(function (k) { return k.indexOf('areas-') === 0; });
    if (!keys.length) { alertEl.remove(); return; }
    var names = [];
    keys.forEach(function (k) { names = names.concat(state.errors[k]); });
    alertEl.textContent = '아직 고르지 않은 영역이 ' + names.length + '개 있어요: ' + names.join(', ');
  }
  function stepReady(step) {
    var i = STEPS.indexOf(step);
    for (var k = 0; k < i; k++) { if (Object.keys(validate(STEPS[k])).length) return false; }
    return true;
  }

  /* ---------- 추천: 승인된 항목만 (미리보기 서버 /api/recs) ---------- */
  // 학생 화면은 바깥 검색을 하지 않음. 내부 확인 페이지에서 리뷰어 확인 → 사용자 승인한 항목만 받음 (docs/api-decision.md)
  var remote = {}; // 키 → { status: 'loading' | 'ok' | 'fail', videos: [], books: [] } (메모리만)

  // a = 단원(areasOf의 한 칸). null이면 과목 전체 (고른 과목(코스) 모두에서)
  function recFor(subjectId, a, level, check) {
    var courses = a ? [a.course.id] : chosenCourses(subjectId).map(function (c) { return c.id; });
    return {
      cell: DIRECTIONS[level][check],
      key: 'course=' + encodeURIComponent(courses.join(',')) + '&unit=' + encodeURIComponent(a && !a.whole ? a.label : '*') + '&school=' + (isHigh() ? 'high' : 'middle') +
        // 학습 목적만 보냄(수능 해설을 보여 줄지 정하는 데만 씀, 성적은 보내지 않음)
        (isHigh() && state.purpose ? '&purpose=' + state.purpose : '') +
        // 학년(m2 등): 여러 학년이 같은 과목(중학 국어·영어)일 때 다른 학년 책을 빼는 데만 씀
        (state.grade ? '&grade=' + state.grade : '') +
        // 여유 후보까지 받아 과목 탭 안에서 중복을 뺀 뒤 3개·2권으로 줄임
        '&max=8'
    };
  }

  function fetchRecs(key, done) {
    if (remote[key] && remote[key].status !== 'fail') { done(); return; }
    remote[key] = { status: 'loading', videos: [], books: [] };
    fetch('/api/recs?' + key)
      .then(function (r) { if (!r.ok) throw new Error('recs'); return r.json(); })
      .then(function (j) { remote[key] = { status: 'ok', videos: j.videos || [], videosScope: j.videosScope || 'none', examVideos: j.examVideos || [], books: j.books || [], siteLink: j.siteLink || null }; done(); })
      .catch(function () { remote[key] = { status: 'fail', videos: [], books: [] }; done(); });
  }

  // 지금 보이는 과목 탭의 영역만 불러옴. 탭 안의 영역을 모두 불러온 뒤 한 번에 카드를 묶고 채움
  function loadPanel(subjectId) {
    var body = document.getElementById('rec-body-' + subjectId);
    if (!body) return;
    var entries = panelEntries(subjectId), left = entries.length;
    entries.forEach(function (e) {
      fetchRecs(e.q.key, function () {
        left -= 1;
        if (left === 0) fillPanel(subjectId);
      });
    });
  }

  /* 과목 탭 안에서 같은 영상·재생목록·책은 한 번만.
     화면 순서(약함 → 보통)대로, 1차: 영역마다 그 단원 전용 강의, 2차: 남은 칸을 과목 전체 강의(대체) 중 아직 안 나온 것으로.
     채울 것이 없으면 반복하지 않고 "위 ○○ 단원에 있어요" 안내. */
  var MAX_VIDEOS = 3, MAX_BOOKS = 2;
  function dedupe(slots, field, max, unitFirst) {
    var seen = {}, out = {};
    slots.forEach(function (slot) { out[slot.getAttribute('data-key')] = []; });
    // 같은 책 시리즈(다른 판·저자)도 과목 탭 안에서 한 번만 (사용자 캡처 2026-11-15)
    var idOf = function (it) { return it.series ? 'series:' + it.series : it.url; };
    // 채널: 한 영역에 같은 채널 강의가 몰리지 않게 1차로 채널마다 1개 (사용자 캡처 2026-11-15: 문법 3개 모두 한 채널)
    var chOf = function (it) { return it.kind === 'course' ? 'ebsi-course' : (it.channelId || it.provider || it.url); };
    // cap: 한 영역에 같은 채널 최대 몇 개까지
    var take = function (onlyUnit, cap) {
      slots.forEach(function (slot) {
        var key = slot.getAttribute('data-key'), r = remote[key] || {}, list = out[key];
        (r[field] || []).forEach(function (it) {
          if (list.length >= max || seen[it.url] || seen[idOf(it)] || (onlyUnit && !it.forUnit)) return;
          if (list.filter(function (x) { return chOf(x) === chOf(it); }).length >= cap) return;
          seen[it.url] = seen[idOf(it)] = slot.getAttribute('data-title'); list.push(it);
        });
      });
    };
    // 순서: 이 단원 강의·채널마다 1개 → 이 단원 강의·같은 채널 2개까지 → 과목 강의·채널마다 1개 → 나머지
    // (단원과 관계없는 과목 강의보다 이 단원 강의가 먼저, 다만 한 채널이 3칸을 다 차지하지는 않게)
    if (unitFirst) { take(true, 1); take(true, 2); take(false, 1); take(false, 2); }
    take(false, Infinity);
    // 고른 것은 이 단원 강의 먼저, 그 안에서는 서버 추천순으로 다시 정렬
    slots.forEach(function (slot) {
      var key = slot.getAttribute('data-key'), all = (remote[key] || {})[field] || [];
      out[key].sort(function (a, b) { return (unitFirst ? (b.forUnit ? 1 : 0) - (a.forUnit ? 1 : 0) : 0) || (all.indexOf(a) - all.indexOf(b)); });
    });
    // 다 겹쳐서 하나도 못 넣은 영역: 처음 나온 영역 이름
    var notes = {};
    slots.forEach(function (slot) {
      var key = slot.getAttribute('data-key'), r = remote[key] || {};
      if (!out[key].length && (r[field] || []).length) notes[key] = seen[r[field][0].url] || '';
    });
    return { lists: out, notes: notes };
  }
  /* 같은 추천을 공유하는 단원은 카드 하나로 (사용자 요청 2026-11-15: "같은 책(강의)일 경우 따로 있지 않고 → 어휘, 문법, 독해, 듣기 / 동일한 추천")
     종류(영상·수능 대비·책)마다 따로 묶음: ① 서버가 준 목록이 똑같은 단원끼리 한 카드 ② 카드끼리 겹치는 항목은 한 번만(dedupe)
     ③ 그래서 비게 된 카드는 그 항목이 보이는 카드에 합침 → '위 ○○에 있어요' 반복 카드 없음. 단원 전용 강의가 있는 단원은 목록이 달라 따로 카드 */
  function groupCards(entries, field, max, unitFirst) {
    var groups = [], bySig = {};
    entries.forEach(function (e) {
      var list = (remote[e.q.key] || {})[field] || [];
      var sig = list.map(function (it) { return it.url; }).join('\n');
      if (sig && bySig[sig]) { bySig[sig].entries.push(e); return; }
      var g = { id: 'g' + groups.length, key: e.q.key, entries: [e] };
      if (sig) bySig[sig] = g;
      groups.push(g);
    });
    var slots = groups.map(function (g) { return { getAttribute: function (n) { return n === 'data-key' ? g.key : g.id; } }; });
    var d = dedupe(slots, field, max, unitFirst);
    groups.forEach(function (g) { g.items = d.lists[g.key]; g.at = d.notes[g.key] || ''; });
    // 겹쳐서 빈 카드 → 그 항목을 보여 주는 카드로 합침
    var byId = {};
    groups.forEach(function (g) { byId[g.id] = g; });
    groups.forEach(function (g) {
      if (g.items.length || !g.at || !byId[g.at] || byId[g.at] === g) return;
      var host = byId[g.at];
      while (host.mergedInto) host = host.mergedInto;
      host.entries = host.entries.concat(g.entries);
      g.mergedInto = host;
    });
    return groups.filter(function (g) { return !g.mergedInto; });
  }
  function allConfident(s) { var c = checksOf(s); return areasOf(s).every(function (a) { return c[a.id] === 'confident'; }); }

  /* ---------- 화면 그리기 ---------- */
  var appEl = document.getElementById('app'), barEl = document.getElementById('appbar'), bottomEl = document.getElementById('bottom'), sideEl = document.getElementById('side');

  function renderBar(step) {
    var i = STEPS.indexOf(step) + 1, forward = i - 1 > lastStepIndex;
    var backHref = i === 1 ? LANDING : '#/' + STEPS[i - 2];
    barEl.innerHTML =
      '<div class="appbar-row"><a class="back" href="' + backHref + '" data-action="back">' + icon('i-back') + '뒤로</a>' +
      '<span class="brand" aria-hidden="true">공부길</span>' +
      '<span class="step-text" role="img" aria-label="5단계 중 ' + i + '단계"><b>' + i + '</b> / 5</span></div>' +
      '<div class="progress-wrap"><div class="progress" aria-hidden="true"><span' + (forward && i > 1 ? ' class="grow"' : '') + ' style="width:' + (i * 20) + '%;--from:' + ((i - 1) / i) + '"></span></div></div>';
  }

  // PC 왼쪽: 단계 목록 + 지금까지 고른 것 (휴대폰에서는 CSS로 숨김, 위 진행선이 대신)
  var PURPOSE_LABEL = { naesin: '내신 대비', suneung: '수능 대비', both: '둘 다' };
  function renderSide(step) {
    var i = STEPS.indexOf(step);
    // 링크가 없는 목록이라 nav가 아니라 제목 달린 구역 (리뷰 권장 4)
    var h = '<section aria-labelledby="side-title"><h2 id="side-title">진단 단계</h2><ol class="steps">';
    STEPS.forEach(function (st, k) {
      h += '<li' + (k < i ? ' class="done"' : '') + (k === i ? ' aria-current="step"' : '') + '>' + STEP_TITLE[st] + (k < i ? '<span class="sr-only"> (완료)</span>' : '') + '</li>';
    });
    h += '</ol></section>';
    var rows = [];
    if (state.grade) rows.push(['학년', gradeLabel()]);
    if (state.subjects.length) rows.push(['과목', chosenSubjects().map(function (s) { return s.label; }).join(', ')]);
    if (isHigh() && state.purpose) rows.push(['목적', PURPOSE_LABEL[state.purpose]]);
    if (rows.length) {
      h += '<dl class="summary" aria-label="고른 것">' + rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>';
    }
    h += '<p class="note">입력한 성적은 이 화면에서만 쓰고 저장하지 않아요.</p>';
    sideEl.innerHTML = h;
  }

  function errorHtml(key) { return state.errors[key] ? '<p class="error" id="err-' + key + '">' + esc(state.errors[key]) + '</p>' : ''; }
  function invalid(key) { return state.errors[key] ? ' aria-invalid="true" aria-describedby="err-' + key + '"' : ''; }

  function viewInfo() {
    var h = '';
    if (state.notice) h += '<div class="sec"><p class="notice" role="status">' + esc(state.notice) + '</p></div>';
    h += '<fieldset class="sec"' + (state.errors.grade ? ' aria-describedby="err-grade"' : '') + '><legend id="lg-grade">학년</legend><div class="grid3 grades">';
    GRADES.forEach(function (g) {
      h += '<label class="pick"><input type="radio" name="grade" value="' + g.id + '"' + (state.grade === g.id ? ' checked' : '') + ' data-field="grade"><span>' + g.label + '</span></label>';
    });
    h += '</div>' + errorHtml('grade') + '</fieldset>';
    h += '<fieldset class="sec"' + (state.errors.subjects ? ' aria-describedby="err-subjects"' : '') + '><legend>진단할 과목 <span class="soft">여러 개 고를 수 있어요</span></legend><div class="grid3 subjects">';
    SUBJECTS.forEach(function (s) {
      h += '<label class="pick"><input type="checkbox" value="' + s.id + '"' + (state.subjects.indexOf(s.id) !== -1 ? ' checked' : '') + ' data-field="subject"><span>' + subjTile(s.id, true) + s.label + '</span></label>';
    });
    h += '</div>' + errorHtml('subjects') + '</fieldset>';
    if (isHigh()) {
      h += '<fieldset class="sec"' + (state.errors.purpose ? ' aria-describedby="err-purpose"' : '') + '><legend>지금 준비하는 시험은 무엇인가요?</legend><div class="grid3 subjects">';
      [['naesin', '내신 대비'], ['suneung', '수능 대비'], ['both', '둘 다']].forEach(function (p) {
        h += '<label class="pick"><input type="radio" name="purpose" value="' + p[0] + '"' + (state.purpose === p[0] ? ' checked' : '') + ' data-field="purpose"><span>' + p[1] + '</span></label>';
      });
      h += '</div>' + errorHtml('purpose') + '</fieldset>';
    }
    if (state.grade) chosenSubjects().forEach(function (s) { if (needsCoursePick(s.id)) h += courseFieldset(s); });
    return h;
  }

  // 과목(코스) 고르기: 묶음(공통·일반 선택 …)별로. 진로·융합 선택은 접어 둠 (고른 것이 있으면 펼침)
  function courseFieldset(s) {
    var key = 'courses-' + s.id, picked = state.courses[s.id] || [], offer = offerOf(s.id);
    var title = isHigh() ? s.label + ': 지금 배우는 과목' : s.label + ': 배운 범위';
    var h = '<fieldset class="sec"' + (state.errors[key] ? ' aria-describedby="err-' + key + '"' : '') + '><legend>' + esc(title) + ' <span class="soft">여러 개 고를 수 있어요</span></legend>';
    CUR.groups.forEach(function (g) {
      var list = offer.filter(function (c) { return c.group === g.id; });
      if (!list.length) return;
      var chips = '<div class="grid2 courses">';
      list.forEach(function (c) {
        chips += '<label class="pick"><input type="checkbox" value="' + c.id + '"' + (picked.indexOf(c.id) !== -1 ? ' checked' : '') + ' data-field="course" data-subject="' + s.id + '"><span>' + esc(c.label) + '</span></label>';
      });
      chips += '</div>';
      var anyPicked = list.some(function (c) { return picked.indexOf(c.id) !== -1; });
      if (g.collapsed && !anyPicked) {
        h += '<details class="more"><summary>' + esc(g.label) + ' ' + list.length + '개 더 보기</summary>' + chips + '</details>';
      } else {
        h += (g.label && g.id !== 'term' ? '<p class="group-label">' + esc(g.label) + '</p>' : '') + chips;
      }
    });
    return h + errorHtml(key) + '</fieldset>';
  }

  function viewGrades() {
    var h = '';
    chosenSubjects().forEach(function (s) {
      var sc = scoreOf(s.id);
      h += '<fieldset class="sec score-card"><legend class="subj-legend">' + subjTile(s.id) + s.label + '</legend>';
      if (!isHigh()) {
        // 왼쪽: 점수/성취도 고르기, 오른쪽 끝: 입력란 또는 A~E (사용자 요청 2026-11-12)
        var swap = state.swapped === s.id ? ' m-swap' : '';
        h += '<div class="score-row"><div class="grid2 mode" role="radiogroup" aria-label="' + s.label + ' 성적 종류">' +
          '<label class="pick"><input type="radio" name="mode-' + s.id + '" value="score"' + (sc.mode === 'score' ? ' checked' : '') + ' data-field="mode" data-subject="' + s.id + '"><span>점수</span></label>' +
          '<label class="pick"><input type="radio" name="mode-' + s.id + '" value="ach"' + (sc.mode === 'ach' ? ' checked' : '') + ' data-field="mode" data-subject="' + s.id + '"><span>성취도</span></label></div>';
        h += '<div class="score-input' + swap + '">';
        if (sc.mode === 'score') {
          h += '<div class="field"><label for="in-' + s.id + '-score">시험 점수 (0~100)</label><input id="in-' + s.id + '-score" type="text" inputmode="numeric" autocomplete="off" value="' + esc(sc.score) + '" data-field="score" data-subject="' + s.id + '"' + invalid(s.id + '-score') + '></div>' + errorHtml(s.id + '-score');
        } else {
          h += '<div class="grid5" role="radiogroup" aria-label="' + s.label + ' 성취도"' + (state.errors[s.id + '-ach'] ? ' aria-describedby="err-' + s.id + '-ach"' : '') + '>';
          ['A', 'B', 'C', 'D', 'E'].forEach(function (a) {
            h += '<label class="pick"><input type="radio" name="ach-' + s.id + '" value="' + a + '"' + (sc.ach === a ? ' checked' : '') + ' data-field="ach" data-subject="' + s.id + '" id="in-' + s.id + '-ach-' + a + '"><span>' + a + '</span></label>';
          });
          h += '</div>' + errorHtml(s.id + '-ach');
        }
        h += '</div></div>';
      } else {
        h += '<div class="field"><label for="in-' + s.id + '-naesin">내신 등급</label><input id="in-' + s.id + '-naesin" type="text" inputmode="numeric" autocomplete="off" value="' + esc(sc.naesin) + '" placeholder="비워 둠" data-field="naesin" data-subject="' + s.id + '"' + invalid(s.id + '-naesin') + '></div>' + errorHtml(s.id + '-naesin');
        h += '<div class="field"><label for="in-' + s.id + '-mock">모의고사 등급</label><input id="in-' + s.id + '-mock" type="text" inputmode="numeric" autocomplete="off" value="' + esc(sc.mock) + '" placeholder="비워 둠" data-field="mock" data-subject="' + s.id + '"' + invalid(s.id + '-mock') + '></div>' + errorHtml(s.id + '-mock');
      }
      h += '</fieldset>';
    });
    return h;
  }

  var DONE_MARK = ' <span class="done-mark"><span aria-hidden="true">✓</span><span class="sr-only">(완료)</span></span>';
  function tabsHtml(kind, current, doneFn) {
    var subs = chosenSubjects();
    if (subs.length < 2) return '';
    var h = '<div class="tabs" role="tablist" aria-label="과목">';
    subs.forEach(function (s) {
      var sel = s.id === current;
      h += '<button type="button" role="tab" id="tab-' + kind + '-' + s.id + '" aria-controls="panel-' + kind + '-' + s.id + '" aria-selected="' + sel + '" tabindex="' + (sel ? 0 : -1) + '" data-action="tab" data-kind="' + kind + '" data-subject="' + s.id + '">' + subjTile(s.id, true) + s.label + (doneFn && doneFn(s.id) ? DONE_MARK : '') + '</button>';
    });
    return h + '</div>';
  }

  function viewAreas() {
    var subs = chosenSubjects();
    if (!state.tab.areas || state.subjects.indexOf(state.tab.areas) === -1) state.tab.areas = subs[0].id;
    var cur = state.tab.areas, h = '';
    var missKeys = Object.keys(state.errors).filter(function (k) { return k.indexOf('areas-') === 0; });
    if (missKeys.length) {
      var total = 0, names = [];
      missKeys.forEach(function (k) { total += state.errors[k].length; names = names.concat(state.errors[k]); });
      h += '<div class="sec"><p class="error" id="err-areas" role="alert">아직 고르지 않은 영역이 ' + total + '개 있어요: ' + esc(names.join(', ')) + '</p></div>';
    }
    h += '<div>' + tabsHtml('areas', cur, function (sid) { var c = checksOf(sid); return areasOf(sid).every(function (a) { return c[a.id]; }); });
    subs.forEach(function (s) {
      var list = areasOf(s.id), c = checksOf(s.id), missing = state.errors['areas-' + s.id] || [];
      h += '<div class="panel sec areas-grid" id="panel-areas-' + s.id + '"' + (subs.length > 1 ? ' role="tabpanel" aria-labelledby="tab-areas-' + s.id + '"' : '') + (s.id !== cur ? ' hidden' : '') + '>';
      h += '<p class="soft" style="margin-bottom:16px">' + s.label + ', ' + list[0].curriculum + ' 개정 교육과정' + (needsCoursePick(s.id) ? '. 1단계에서 고른 ' + (isHigh() ? '과목' : '범위') + '의 단원이에요.' : '') + '</p>';
      var lastCourse = null;
      list.forEach(function (a) {
        var miss = missing.indexOf(areaName(a)) !== -1;
        // 과목(코스)이 여럿이면 과목마다 제목을 두고 묶음
        if (needsCoursePick(s.id) && a.course !== lastCourse) {
          h += '<h3 class="course-head">' + esc(a.course.label) + '</h3>';
          lastCourse = a.course;
        }
        h += '<div class="area' + (miss ? ' missing' : '') + '" role="radiogroup" aria-labelledby="an-' + a.id + '"><p class="area-name" id="an-' + a.id + '">' + esc(a.label) + (a.courseTag && !a.whole ? '<span class="sr-only"> (' + esc(a.courseTag) + ')</span>' : '') + (miss ? ' <span class="soft">(아직 안 고름)</span>' : '') + '</p><div class="seg">';
        ['confident', 'normal', 'weak'].forEach(function (v) {
          var on = c[a.id] === v;
          h += '<label class="pick ' + v + '"><input type="radio" name="ar-' + a.id + '" value="' + v + '"' + (on ? ' checked' : '') + ' data-field="check" data-subject="' + s.id + '" data-area="' + a.id + '" id="in-' + a.id + '-' + v + '"><span>' + CHECK_LABEL[v] + '</span></label>';
        });
        h += '</div></div>';
      });
      h += '</div>';
    });
    return h + '</div>';
  }

  function viewResult() {
    var h = '';
    chosenSubjects().forEach(function (s) {
      var lv = levelOf(s.id), c = checksOf(s.id), list = areasOf(s.id);
      h += '<section class="sec subject-result"><div class="result-top"><h3 class="subj-legend">' + subjTile(s.id) + s.label + '</h3><p class="level m-reveal">수준<b>' + LEVEL_LABEL[lv.level] + '</b></p></div>' +
        '<p class="soft why">' + esc(lv.why) + '</p>';
      if (allConfident(s.id)) {
        h += '<p class="notice" style="margin-top:12px">모든 영역에 자신 있다고 했어요. 그래서 약한 영역 대신, 지금 수준에서 한 단계 더 연습할 자료를 과목 전체로 골랐어요.</p>';
      } else {
        var weak = list.filter(function (a) { return c[a.id] === 'weak'; }), normal = list.filter(function (a) { return c[a.id] === 'normal'; });
        h += '<p class="sub-title">먼저 볼 영역</p><ul class="rows">';
        weak.concat(normal).forEach(function (a) { h += '<li><span>' + esc(areaName(a)) + '</span><span class="lv ' + c[a.id] + '">' + CHECK_LABEL[c[a.id]] + '</span></li>'; });
        h += '</ul>';
      }
      h += '</section>';
    });
    h += '<div class="sec"><p class="soft">수준을 나누는 기준은 아직 임시 기준이에요. 결과는 내가 직접 체크한 내용을 바탕으로 해요.</p></div>';
    return h;
  }

  // 링크는 https 주소만 씀 (검색 결과를 그대로 넣지 않도록)
  function safeUrl(u) { return /^https:\/\//.test(u || '') ? u : ''; }

  // 표지·썸네일은 미리보기 서버를 거쳐 받음 (학생 브라우저가 카카오·YouTube 이미지 서버에 바로 접속하지 않게)
  function imgSrc(u) { return safeUrl(u) ? '/api/img?u=' + encodeURIComponent(u) : ''; }

  function thumbPlaceholder(isBook) {
    return '<span class="thumb thumb-empty ' + (isBook ? 'book' : 'video') + '" aria-hidden="true">' + icon(isBook ? 'i-book' : 'i-lecture', 'ph-icon') + '</span>';
  }

  function itemHtml(it) {
    var key = it.id;
    if (state.hidden[key]) return '';
    var isBook = it.kind === 'book';
    var isCourse = it.kind === 'course';
    // 다른 선생님(EBS 외) 강의는 채널 이름을 그대로 보여 주고 "다른 선생님 강의"로 표시 (사용자 결정 2026-11-12 v3)
    var other = it.channelGroup === 'other' ? ' · 다른 선생님 강의' : '';
    // 강좌 링크는 제공처 이름 그대로 (EBSi / EBS 중학)
    var site = isCourse ? (it.provider || 'EBSi') : '';
    var kindText = isCourse ? site + ' 강좌' + (it.itemCount ? ' · ' + it.itemCount + '강' : '')
      : it.kind === 'playlist' ? '강좌 재생목록' + (it.itemCount ? ' · ' + it.itemCount + '강' : '') + other
      : it.kind === 'video' ? '영상 강의' + (it.durationMin ? ' · ' + it.durationMin + '분' : '') + other : '책';
    // 진로·융합 과목에 넣은 예전 교육과정 강의: 학생이 알 수 있게 작게 표시 (사용자 요청 2026-11-15)
    if (it.oldCurriculum) kindText += ' · 예전 교육과정 강의';
    // 책: 저자·출판사 중 있는 것만 (저자 자리표시 값을 뺀 뒤 앞에 쉼표가 남지 않게)
    var meta = (isBook ? [it.authors, it.provider].filter(Boolean).map(esc).join(', ')
      : isCourse ? esc(it.provider) + (it.teacher ? ' · ' + esc(it.teacher) + ' 선생님' : '') : esc(it.provider)) +
      (it.year ? ', ' + esc(it.year) + '년' : '') + (it.isFree ? ' · 무료' : '');
    var src = imgSrc(it.thumbnail);
    // 표지·썸네일이 없거나(서점 자리표시 그림 포함, 서버가 404) 못 불러오면 책·강의 아이콘 자리표시 (운영 지적 2026-11-15)
    var thumb = src ? '<img class="thumb" src="' + esc(src) + '" alt="" loading="lazy" data-ph="' + (isBook ? 'book' : 'video') + '">' : thumbPlaceholder(isBook);
    return '<article class="item ' + (isBook ? 'book' : 'video') + '">' + thumb + '<div class="item-body">' +
      '<p class="item-kind">' + icon(isBook ? 'i-book' : 'i-lecture', 'kind-icon') + kindText + '</p>' +
      '<p class="item-title">' + esc(it.title) + '</p>' +
      '<p class="item-meta">' + meta + '</p>' +
      (it.reason ? '<p class="item-reason">' + esc(it.reason) + '</p>' : '') +
      // EBSi 강좌는 무료지만 회원 로그인 후 시청 (EBSi 안내 페이지 근거, 2026-11-12)
      (isCourse ? '<p class="item-meta">' + esc(site) + ' 무료 회원 로그인 후 볼 수 있어요</p>' : '') +
      (it.lastCheckedAt ? '<p class="item-meta">확인한 날 ' + esc(it.lastCheckedAt) + '</p>' : '') +
      '<div class="item-actions">' + (safeUrl(it.url) ? '<a href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">' + (isBook ? '책 정보 보기' : isCourse ? esc(site) + '에서 보기' : 'YouTube에서 보기') + '<span class="sr-only"> (새 탭): ' + esc(it.title) + '</span></a>' : '') +
      '<button type="button" data-action="hide" data-key="' + esc(key) + '">숨기기<span class="sr-only">: ' + esc(it.title) + '</span></button></div></div></article>';
  }

  // 한 묶음(영상 강의 / 책): 큰 소제목 + 추천순 항목. 없으면 '준비 중'
  function groupHtml(title, items, emptyText, extra, note) {
    var h = '<h4 class="group-head">' + title + '</h4>' + (note && items.length ? '<p class="soft scope-note">' + note + '</p>' : ''), shown = 0, hiddenKeys = [];
    var cards = '';
    items.forEach(function (it) { if (state.hidden[it.id]) hiddenKeys.push(it.id); else { cards += itemHtml(it); shown += 1; } });
    // PC에서는 영상은 카드 3열, 책은 2열 (휴대폰은 한 줄씩 그대로)
    if (shown) h += '<div class="items ' + (title === '책' ? 'books' : 'videos') + '">' + cards + '</div>';
    if (!shown && !hiddenKeys.length) h += '<p class="empty">' + emptyText + '</p>';
    if (hiddenKeys.length) h += '<p class="soft">숨긴 항목 ' + hiddenKeys.length + '개 <button type="button" class="textlink" data-action="unhide" data-keys="' + esc(hiddenKeys.join('\n')) + '">다시 보기</button></p>';
    return h + (extra || '');
  }

  var LOADING = '<div class="loading" role="status"><span class="sr-only">추천을 불러오는 중이에요</span><span></span><span></span></div>';

  // 과목 탭의 단원 목록(화면 순서: 약함 → 보통). 모두 자신 있음이면 과목 전체 한 칸
  function panelEntries(sid) {
    var lv = levelOf(sid).level, c = checksOf(sid), list = areasOf(sid), label = subj(sid).label;
    if (allConfident(sid)) return [{ title: label + ' 전체', check: null, courseLabel: '', q: recFor(sid, null, lv, 'normal') }];
    return list.filter(function (a) { return c[a.id] === 'weak'; }).concat(list.filter(function (a) { return c[a.id] === 'normal'; })).map(function (a) {
      return { title: a.label, check: c[a.id], courseLabel: a.whole ? '' : a.courseTag, q: recFor(sid, a, lv, c[a.id]) };
    });
  }

  // 종류 하나의 카드: 단원 하나면 지금처럼, 여럿이면 '어휘 · 문법 · 독해' 제목 + 단원마다 배지 + '이 단원들은 같은 추천이에요'
  var KIND_FIELD = { video: 'videos', exam: 'examVideos', book: 'books' };
  function cardHtml(g, kind) {
    var es = g.entries.slice().sort(function (a, b) { return (a.check === 'weak' ? 0 : 1) - (b.check === 'weak' ? 0 : 1); });
    var badge = function (e) { return e.check ? '<span class="lv ' + e.check + '">' + CHECK_LABEL[e.check] + '</span>' : ''; };
    var h = '<section class="sec rec-card">';
    if (es.length === 1) {
      var e = es[0];
      h += '<div class="area-head"><h3>' + esc(e.title) + '</h3>' + badge(e) + '</div>' + (e.courseLabel ? '<p class="course-of">' + esc(e.courseLabel) + '</p>' : '');
    } else {
      // 모두 같은 과목이면 과목 이름은 한 번만
      var oneCourse = es.every(function (x) { return x.courseLabel === es[0].courseLabel; });
      h += '<h3 class="merged-title">' + es.map(function (x) { return esc(x.title); }).join(' · ') + '</h3>' +
        '<ul class="unit-chips" aria-label="단원별 체크">' + es.map(function (x) { return '<li>' + esc(x.title) + (!oneCourse && x.courseLabel ? ' <span class="soft">(' + esc(x.courseLabel) + ')</span>' : '') + badge(x) + '</li>'; }).join('') + '</ul>' +
        (oneCourse && es[0].courseLabel ? '<p class="course-of">' + esc(es[0].courseLabel) + '</p>' : '') +
        '<p class="soft same-note">이 단원들은 같은 추천이에요.</p>';
    }
    // 추천 방향: 단원마다 다르면 약함·보통으로 나눠 적음
    var dirs = [];
    es.forEach(function (x) { var t = TYPE_LABEL[x.q.cell[0]] + ', ' + TYPE_LABEL[x.q.cell[1]]; var lab = es.length > 1 && x.check ? CHECK_LABEL[x.check] + ' 단원: ' : ''; if (!dirs.some(function (d) { return d.t === t; })) dirs.push({ t: t, lab: lab }); });
    h += dirs.map(function (d) { return '<p class="direction">' + (dirs.length > 1 ? d.lab : '') + d.t + '</p>'; }).join('');
    var items = g.items || [];
    // 합친 카드의 책 설명: 첫 단원 기준 문구("문법 단원: 교과서 문법 내용을…")를 묶인 단원 전체로
    if (es.length > 1) {
      var first = g.entries[0].title, joined = es.map(function (x) { return x.title; }).join('·');
      items = items.map(function (it) {
        if (it.kind !== 'book' || it.reason.indexOf(first + ' 단원: ') !== 0) return it;
        return Object.assign({}, it, { reason: it.reason.slice((first + ' 단원: ').length).split(first).join(joined) });
      });
    }
    if (kind === 'video') {
      // 단원 강의가 하나도 없을 때만 '준비하는 동안' 안내, 일부만 대체면 몇 개인지 (운영 표본 2026-11-15). 여러 단원 카드는 같은 추천이라 생략
      var subst = items.filter(function (it) { return !it.forUnit && !state.hidden[it.id]; }).length;
      var own = items.filter(function (it) { return it.forUnit && !state.hidden[it.id]; }).length;
      var note = es.length > 1 || !subst ? '' : !own ? '이 단원만 다루는 강의를 준비하는 동안, 같은 과목의 강의를 보여 줘요.' : '이 가운데 ' + subst + '개는 같은 과목의 다른 단원 강의예요.';
      h += groupHtml('영상 강의', items, '확인을 마친 무료 강의를 준비하고 있어요.', '', note);
    } else if (kind === 'exam') {
      h += groupHtml('수능 대비', items, '이 단원의 수능 대비 강의를 준비하고 있어요.', '', '수능·모의고사 문제를 풀고 해설하는 강의예요. 개념을 익힌 뒤에 보면 좋아요.');
    } else {
      h += groupHtml('책', items, '확인을 마친 책을 준비하고 있어요.');
    }
    return h + '</section>';
  }

  // 과목 탭 내용: 종류마다 카드 묶음. 위 탭(recKind)이 고른 종류만 보이고, 인쇄는 전부
  function panelBodyHtml(sid) {
    var entries = panelEntries(sid);
    if (entries.some(function (e) { var r = remote[e.q.key]; return !r || r.status === 'loading'; })) return LOADING;
    if (entries.every(function (e) { return remote[e.q.key].status === 'fail'; })) return '<div class="sec"><p class="empty">추천을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p></div>';
    var kinds = ['video'].concat(wantsExamTab() ? ['exam'] : [], ['book']), cur = recKind();
    return kinds.map(function (k) {
      var cards = groupCards(entries, KIND_FIELD[k], k === 'book' ? MAX_BOOKS : MAX_VIDEOS, k !== 'book');
      return '<div class="rec-group" data-kind="' + k + '"' + (k === cur ? '' : ' hidden') + '>' + cards.map(function (g) { return cardHtml(g, k); }).join('') + '</div>';
    }).join('');
  }

  // 수능 대비 탭: 고등학생이 '수능 대비'·'둘 다'를 골랐을 때만 (서버도 그때만 수능 대비 강의를 보냄)
  // 고1은 숨김: 고1 과목(공통수학·공통국어·공통영어)에는 수능 대비 강의를 두지 않아 탭이 늘 비어 있음 (사용자 결정 2026-11-15)
  function wantsExamTab() { return isHigh() && state.grade !== 'h1' && (state.purpose === 'suneung' || state.purpose === 'both'); }
  function recKind() { var k = state.recKind || 'video'; return k === 'exam' && !wantsExamTab() ? 'video' : k; }

  // 추천 맨 위 탭 하나 (role=tablist/tab, 내용은 아래 #rec-kind-panel 하나, 방향키는 아래 keydown 처리)
  function recKindTabsHtml() {
    var kinds = [{ id: 'video', label: '영상 강의', icon: 'i-lecture' }];
    if (wantsExamTab()) kinds.push({ id: 'exam', label: '수능 대비', icon: 'i-lecture' });
    kinds.push({ id: 'book', label: '책 추천', icon: 'i-book' });
    var cur = recKind();
    var h = '<div class="rec-tabs" role="tablist" aria-label="추천 종류">';
    kinds.forEach(function (k) {
      var sel = k.id === cur;
      h += '<button type="button" role="tab" id="rec-kind-' + k.id + '" aria-controls="rec-kind-panel" aria-selected="' + sel + '" tabindex="' + (sel ? 0 : -1) + '" data-action="reckind" data-rec="' + k.id + '">' + icon(k.icon, 'kind-icon') + k.label + '</button>';
    });
    return h + '</div>';
  }

  function fillPanel(sid) {
    var body = document.getElementById('rec-body-' + sid);
    if (!body) return;
    var wasLoading = !!body.querySelector('.loading');
    body.innerHTML = panelBodyHtml(sid);
    // 불러온 직후 한 번만 카드가 차례로 올라옴 (숨기기 등 다시 그릴 때는 안 움직임)
    if (wasLoading) { body.classList.add('fresh'); setTimeout(function () { body.classList.remove('fresh'); }, 900); }
  }

  function viewRecommend() {
    var subs = chosenSubjects();
    if (!state.tab.recommend || state.subjects.indexOf(state.tab.recommend) === -1) state.tab.recommend = subs[0].id;
    var cur = state.tab.recommend;
    // 맨 위: 추천 종류 탭(모든 과목·단원에 함께 적용) → 그 아래 과목 탭과 내용이 하나의 탭 패널
    var h = '<div class="sec rec-kind-bar">' + recKindTabsHtml() + '</div>' +
      '<div id="rec-kind-panel" role="tabpanel" aria-labelledby="rec-kind-' + recKind() + '">' + tabsHtml('recommend', cur, null);
    subs.forEach(function (s) {
      var lv = levelOf(s.id).level;
      h += '<div class="panel" id="panel-recommend-' + s.id + '"' + (subs.length > 1 ? ' role="tabpanel" aria-labelledby="tab-recommend-' + s.id + '"' : '') + (s.id !== cur ? ' hidden' : '') + '>';
      h += '<div class="sec" style="padding-top:14px;padding-bottom:14px"><p class="soft">' + s.label + ' 수준 ' + LEVEL_LABEL[lv] + '에 맞춰 찾았어요</p></div>';
      // 카드는 불러온 뒤 같은 추천끼리 묶어서 채움 (fillPanel)
      h += '<div class="rec-body" id="rec-body-' + s.id + '">' + (s.id === cur ? panelBodyHtml(s.id) : '') + '</div>';
      h += '</div>';
    });
    h += '</div><section class="sec feedback"><h3 id="fb-title" tabindex="-1">추천이 도움이 됐나요?</h3>';
    h += state.feedback ? '<p class="soft" role="status" style="margin-top:6px">알려 줘서 고마워요.</p>'
      : '<div class="row" role="group" aria-labelledby="fb-title"><button type="button" data-action="feedback" data-value="yes">예</button><button type="button" data-action="feedback" data-value="no">아니요</button></div>';
    h += '</section><div class="restart"><button type="button" class="textlink" data-action="restart">처음부터 다시 하기</button></div>';
    return h;
  }

  function bottomFor(step) {
    var label = { info: '다음', grades: '다음', areas: '다음', result: '추천 보기', recommend: '결과 인쇄하기' }[step];
    return '<button type="button" class="primary m-press" data-action="' + (step === 'recommend' ? 'print' : 'next') + '">' + label + '</button>';
  }

  // 제목 아래 안내 한 줄
  function leadFor(step) {
    if (step === 'grades') {
      return isHigh()
        ? '내신과 모의고사 중 아는 것만 적어도 돼요. ' + gradeLabel() + ' 내신은 1~' + NAESIN_SCALE[state.grade] + '등급, 모의고사는 1~9등급이에요.'
        : '최근 시험 점수나 성취도 중 하나를 골라 적어 주세요. 점수는 0부터 100까지 정수로 적어 주세요.';
    }
    if (step === 'areas') return '영역마다 하나씩 골라 주세요.';
    // 추천 화면은 제목 '추천'만 (안내 문구 삭제, 사용자 요청 2026-11-12)
    return '';
  }

  function render(step, opts) {
    opts = opts || {};
    var views = { info: viewInfo, grades: viewGrades, areas: viewAreas, result: viewResult, recommend: viewRecommend };
    var stepChanged = STEPS.indexOf(step) !== lastStepIndex;
    var lead = leadFor(step);
    renderBar(step);
    renderSide(step);
    appEl.className = step === 'result' && chosenSubjects().length > 1 ? 'wide-result' : '';
    appEl.innerHTML = '<div class="head' + (stepChanged ? ' m-enter' : '') + '"><div class="head-row"><span class="step-icon" aria-hidden="true">' + icon(STEP_ICON[step]) + '</span><h2 tabindex="-1" id="screen-title">' + STEP_TITLE[step] + '</h2></div>' +
      (lead ? '<p class="lead">' + esc(lead) + '</p>' : '') + '</div>' + views[step]();
    bottomEl.innerHTML = bottomFor(step);
    if (step === 'recommend') loadPanel(state.tab.recommend);
    document.title = STEP_TITLE[step] + ' · 공부길 (프로토타입)';
    if (stepChanged) {
      lastStepIndex = STEPS.indexOf(step);
      window.scrollTo(0, 0);
      document.getElementById('screen-title').focus();
    } else if (opts.focusId) {
      var el = document.getElementById(opts.focusId);
      if (el) el.focus();
    }
  }

  /* ---------- 이동 ---------- */
  function currentStep() { var m = location.hash.match(/^#\/(\w+)/); return m && STEPS.indexOf(m[1]) !== -1 ? m[1] : null; }
  function go(step) { if (location.hash === '#/' + step) route(); else location.hash = '#/' + step; }
  // 이 탭에서 지나온 단계 기록 (화면 "뒤로"가 브라우저 기록을 늘리지 않게 하려고 씀)
  var trail = [];
  function route() {
    var step = currentStep();
    if (!step) { history.replaceState(null, '', '#/info'); step = 'info'; }
    if (!stepReady(step)) {
      if (step !== 'info') state.notice = '새로고침하면 처음부터 다시 시작해요. 입력한 성적은 저장하지 않아요.';
      history.replaceState(null, '', '#/info'); step = 'info'; trail = [];
    }
    if (trail.length >= 2 && trail[trail.length - 2] === step) trail.pop();
    else if (trail[trail.length - 1] !== step) trail.push(step);
    state.errors = {};
    render(step);
    if (step !== 'info') state.notice = null;
  }

  function focusFirstError(step) {
    var keys = Object.keys(state.errors);
    if (!keys.length) return;
    var k = keys[0], target = null;
    if (step === 'info') {
      target = k.indexOf('courses-') === 0
        ? document.querySelector('[data-field="course"][data-subject="' + k.replace('courses-', '') + '"]')
        : document.querySelector('[data-field="' + (k === 'subjects' ? 'subject' : k) + '"]');
    }
    if (step === 'grades') {
      target = document.getElementById('in-' + k) || document.querySelector('[data-field="ach"][data-subject="' + k.split('-')[0] + '"]');
    }
    if (step === 'areas') {
      var sid = k.replace('areas-', '');
      if (state.tab.areas !== sid) { state.tab.areas = sid; render('areas'); }
      var firstMissing = document.querySelector('#panel-areas-' + sid + ' .area.missing input');
      target = firstMissing;
    }
    if (target) target.focus();
    document.getElementById('announce').textContent = '입력을 확인해 주세요. ' + (step === 'areas' ? '아직 고르지 않은 영역이 있어요.' : '');
  }

  function next() {
    var step = currentStep(), i = STEPS.indexOf(step);
    state.errors = validate(step);
    if (Object.keys(state.errors).length) { render(step); focusFirstError(step); return; }
    state.notice = null;
    go(STEPS[i + 1]);
  }

  function rerenderKeepingFocus(step, selector) {
    render(step);
    var el = document.querySelector(selector);
    if (el) el.focus();
  }

  /* ---------- 입력 이벤트 ---------- */
  appEl.addEventListener('change', function (ev) {
    var t = ev.target, f = t.getAttribute('data-field'), s = t.getAttribute('data-subject'), step = currentStep();
    if (!f) return;
    if (f === 'grade') {
      var was = state.grade; state.grade = t.value;
      if (was && was !== t.value) { state.scores = {}; state.checks = {}; state.courses = {}; state.hidden = {}; state.feedback = null; }
      if (!isHigh()) state.purpose = null;
      refreshErrors(step);
      rerenderKeepingFocus(step, '[data-field="grade"][value="' + t.value + '"]');
      return;
    }
    if (f === 'subject') {
      var idx = state.subjects.indexOf(t.value);
      if (t.checked && idx === -1) state.subjects.push(t.value);
      if (!t.checked && idx !== -1) state.subjects.splice(idx, 1);
      state.subjects.sort(function (a, b) { return SUBJECTS.findIndex(function (x) { return x.id === a; }) - SUBJECTS.findIndex(function (x) { return x.id === b; }); });
      // 과목(코스)을 고를 학년이면 그 칸이 나타나거나 사라지므로 다시 그림
      if (state.errors.subjects || (state.grade && needsCoursePick(t.value))) { refreshErrors(step); rerenderKeepingFocus(step, '[data-field="subject"][value="' + t.value + '"]'); }
      return;
    }
    if (f === 'course') {
      var list = state.courses[s] || (state.courses[s] = []), ci = list.indexOf(t.value);
      if (t.checked && ci === -1) list.push(t.value);
      if (!t.checked && ci !== -1) list.splice(ci, 1);
      if (state.errors['courses-' + s]) { refreshErrors(step); rerenderKeepingFocus(step, '[data-field="course"][value="' + t.value + '"]'); }
      return;
    }
    if (f === 'purpose') {
      state.purpose = t.value;
      if (state.errors.purpose) { refreshErrors(step); rerenderKeepingFocus(step, '[data-field="purpose"][value="' + t.value + '"]'); }
      return;
    }
    if (f === 'mode') {
      scoreOf(s).mode = t.value; delete state.errors[s + '-score']; delete state.errors[s + '-ach'];
      // 바뀐 입력칸만 살짝 나타나게 (점수 ↔ 성취도)
      state.swapped = s; render(step); state.swapped = null; var mm = document.querySelector('[data-field="mode"][data-subject="' + s + '"][value="' + t.value + '"]'); if (mm) mm.focus();
      return;
    }
    if (f === 'ach') {
      scoreOf(s).ach = t.value;
      if (state.errors[s + '-ach']) { refreshErrors(step); rerenderKeepingFocus(step, '#in-' + s + '-ach-' + t.value); }
      return;
    }
    if (f === 'check') {
      checksOf(s)[t.getAttribute('data-area')] = t.value;
      var areaEl = t.closest('.area');
      if (areaEl) {
        areaEl.classList.remove('missing');
        var mark = areaEl.querySelector('.area-name .soft'); if (mark) mark.remove();
      }
      var tab = document.getElementById('tab-areas-' + s);
      if (tab) {
        var c = checksOf(s), done = areasOf(s).every(function (a) { return c[a.id]; });
        if (done && !tab.querySelector('.done-mark')) tab.insertAdjacentHTML('beforeend', DONE_MARK);
      }
      refreshErrors(step);
      syncAreasAlert();
    }
  });
  appEl.addEventListener('input', function (ev) {
    var t = ev.target, f = t.getAttribute('data-field'), s = t.getAttribute('data-subject');
    if (f === 'score' || f === 'naesin' || f === 'mock') {
      scoreOf(s)[f] = t.value;
      refreshErrors(currentStep());
      ['score', 'naesin', 'mock'].forEach(function (x) { syncFieldError(s + '-' + x); });
    }
  });

  function onAction(ev) {
    var el = ev.target.closest('[data-action]');
    if (!el) return;
    var a = el.getAttribute('data-action'), step = currentStep();
    if (a === 'back') {
      var i = STEPS.indexOf(step);
      if (i > 0) {
        ev.preventDefault();
        var prev = STEPS[i - 1];
        if (trail.length >= 2 && trail[trail.length - 2] === prev) { history.back(); }
        else { trail[trail.length - 1] = prev; history.replaceState(null, '', '#/' + prev); route(); }
      }
      return; // 1단계에서는 링크 그대로 랜딩으로
    }
    if (a === 'next') { next(); return; }
    if (a === 'print') { window.print(); return; }
    if (a === 'tab') {
      state.tab[el.getAttribute('data-kind')] = el.getAttribute('data-subject');
      render(step, { focusId: 'tab-' + el.getAttribute('data-kind') + '-' + el.getAttribute('data-subject') });
      return;
    }
    // 추천 종류 탭(맨 위 하나): 다시 그리지 않고 모든 단원의 묶음만 바꿈 (포커스·스크롤 그대로)
    if (a === 'reckind') {
      var k = el.getAttribute('data-rec');
      var changed = recKind() !== k;
      state.recKind = k;
      Array.prototype.slice.call(el.parentNode.querySelectorAll('[role="tab"]')).forEach(function (b) {
        var sel = b === el;
        b.setAttribute('aria-selected', String(sel));
        b.setAttribute('tabindex', sel ? '0' : '-1');
      });
      Array.prototype.slice.call(document.querySelectorAll('.rec-group')).forEach(function (g) { g.hidden = g.getAttribute('data-kind') !== k; });
      var panel = document.getElementById('rec-kind-panel');
      if (panel) {
        panel.setAttribute('aria-labelledby', 'rec-kind-' + k);
        if (changed) { panel.classList.remove('m-tab'); void panel.offsetWidth; panel.classList.add('m-tab'); }
      }
      el.focus();
      return;
    }
    if (a === 'hide') {
      state.hidden[el.getAttribute('data-key')] = true;
      var panelId = el.closest('.panel') && el.closest('.panel').id;
      render(step);
      var btn = panelId && document.querySelector('#' + panelId + ' [data-action="unhide"]');
      if (btn) btn.focus();
      return;
    }
    if (a === 'unhide') {
      el.getAttribute('data-keys').split('\n').forEach(function (k) { delete state.hidden[k]; });
      render(step); return;
    }
    if (a === 'feedback') {
      state.feedback = el.getAttribute('data-value');
      render(step, { focusId: 'fb-title' });
      document.getElementById('announce').textContent = '알려 줘서 고마워요.';
      return;
    }
    if (a === 'restart') { state = freshState(); lastStepIndex = -1; go('info'); return; }
  }
  // 표지·썸네일을 못 불러오면(자리표시 그림이라 서버가 404 포함) 아이콘 자리표시로 바꿈
  appEl.addEventListener('error', function (ev) {
    var t = ev.target;
    if (t && t.tagName === 'IMG' && t.classList.contains('thumb')) t.outerHTML = thumbPlaceholder(t.getAttribute('data-ph') === 'book');
  }, true);
  appEl.addEventListener('click', onAction);
  barEl.addEventListener('click', onAction);
  bottomEl.addEventListener('click', onAction);

  // 과목 탭: 왼쪽·오른쪽 방향키로 옮기기
  appEl.addEventListener('keydown', function (ev) {
    var t = ev.target;
    if (t.getAttribute('role') !== 'tab' || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
    var tabs = Array.prototype.slice.call(t.parentNode.querySelectorAll('[role="tab"]')), i = tabs.indexOf(t);
    var nextTab = tabs[(i + (ev.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    ev.preventDefault();
    nextTab.click();
  });

  // 과목·단원 데이터를 불러온 뒤 시작
  fetch(DATA_URL)
    .then(function (r) { if (!r.ok) throw new Error('data'); return r.json(); })
    .then(function (j) {
      CUR = j;
      window.addEventListener('hashchange', route);
      route();
    })
    .catch(function () {
      appEl.innerHTML = '<div class="sec"><p class="error" role="alert">과목 정보를 불러오지 못했어요. 미리보기 서버(npm run dev)로 열었는지 확인해 주세요.</p></div>';
    });
})();
