/*
  추천 후보 확인 페이지 (내부용)
  - 후보 찾기: POST /api/collect → data/recommendations.json 에 candidate로 추가
  - [승인] 한 번 / [제외] / [후보로 되돌리기]: POST /api/review
    (사용자 결정 2026-11-11: 리뷰어 확인 단계·추천 이유 입력 없음. 이유는 서버가 자동으로 만들고, '이유 고치기'는 접힌 선택 기능)
*/
(function () {
  'use strict';
  var GRADES = [['m1', '중1'], ['m2', '중2'], ['m3', '중3'], ['h1', '고1'], ['h2', '고2'], ['h3', '고3']];
  var SUBJ = { korean: '국어', english: '영어', math: '수학' };
  var STATUS_LABEL = { candidate: '후보', approved: '승인', retired: '제외' };
  var cur = null, recs = [];
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeUrl(u) { return /^https:\/\//.test(u || '') ? u : ''; }
  function say(text, err) { var m = $('msg'); m.textContent = text; m.className = 'msg' + (err ? ' err' : ''); }

  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
  }

  function courseOf(id) { return cur.courses.filter(function (c) { return c.id === id; })[0]; }

  function fillCourses() {
    var g = $('grade').value, offer = cur.offer[g] || {}, h = '';
    ['korean', 'english', 'math'].forEach(function (s) {
      (offer[s] || []).forEach(function (id) { var c = courseOf(id); h += '<option value="' + id + '">' + SUBJ[s] + ' · ' + esc(c.label) + '</option>'; });
    });
    $('course').innerHTML = h;
    fillUnits();
  }
  function fillUnits() {
    var c = courseOf($('course').value), h = '<option value="*">과목 전체</option>';
    (c ? c.units : []).forEach(function (u) { h += '<option>' + esc(u) + '</option>'; });
    $('unit').innerHTML = h;
    renderList();
  }

  function loadRecs() {
    return fetch('/data/recommendations.json?t=' + Date.now()).then(function (r) { return r.json(); }).then(function (j) { recs = j.items || []; });
  }

  function itemHtml(it) {
    var st = it.review.status;
    var meta = it.kind === 'playlist' ? '재생목록 · ' + (it.itemCount || 0) + '강' : it.kind === 'video' ? '영상 · ' + (it.durationMin || 0) + '분 · 조회 ' + (it.views || 0) : '책 · ' + esc(it.authors);
    var thumb = safeUrl(it.thumbnail) ? '<img class="thumb" alt="" loading="lazy" src="/api/img?u=' + encodeURIComponent(it.thumbnail) + '">' : '<span class="thumb"></span>';
    var rid = 'r-' + btoa(unescape(encodeURIComponent(it.id))).replace(/[^a-zA-Z0-9]/g, '');
    return '<article class="item ' + (it.kind === 'book' ? 'book' : '') + '">' + thumb + '<div>' +
      '<p><span class="status ' + st + '">' + STATUS_LABEL[st] + '</span> <span class="soft">· 추천순 점수 ' + (it.score || 0) + (it.review.approvedAt ? ' · 승인일 ' + esc(it.review.approvedAt) : '') + '</span></p>' +
      '<p class="title">' + (safeUrl(it.url) ? '<a href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">' + esc(it.title) + '<span class="sr-only"> (새 탭)</span></a>' : esc(it.title)) + '</p>' +
      '<p class="soft">' + esc(it.provider) + ' · ' + meta + (it.year ? ' · ' + esc(it.year) + '년' : '') + ' · 단원: ' + esc(it.unit === '*' ? '과목 전체' : it.unit) + '</p>' +
      (it.reason ? '<p class="soft">추천 이유: ' + esc(it.reason) + '</p>' : '') +
      '<div class="actions">' +
      (st === 'candidate'
        ? '<button type="button" class="primary" data-set="approved" data-id="' + esc(it.id) + '">승인<span class="sr-only">: ' + esc(it.title) + '</span></button>' +
          '<button type="button" data-set="retired" data-id="' + esc(it.id) + '">제외<span class="sr-only">: ' + esc(it.title) + '</span></button>'
        : '<button type="button" data-set="candidate" data-id="' + esc(it.id) + '">후보로 되돌리기<span class="sr-only">: ' + esc(it.title) + '</span></button>') +
      '</div>' +
      // 이유 고치기: 접힌 선택 기능 (필수 아님). 비워 두면 승인할 때 자동으로 만듦
      '<details class="fix"><summary>이유 고치기 (선택)</summary>' +
      '<label for="' + rid + '">추천 이유 (사실만 짧게, 광고 문구 금지)</label><textarea id="' + rid + '" data-reason="' + esc(it.id) + '">' + esc(it.reason) + '</textarea>' +
      '<div class="actions"><button type="button" data-save="' + esc(it.id) + '">' + (st === 'approved' ? '이유 저장' : '이 이유로 승인') + '</button></div></details>' +
      '</div></article>';
  }

  function renderList() {
    var cid = $('course').value, unit = $('unit').value, st = $('status').value;
    var list = recs.filter(function (it) { return it.courseId === cid && it.unit === unit && (!st || it.review.status === st); })
      .sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    $('count').textContent = list.length + '개';
    $('list').innerHTML = list.length ? list.map(itemHtml).join('') : '<p class="soft">아직 후보가 없어요. 위에서 "이 단원 후보 찾기"를 눌러 주세요.</p>';
  }

  $('grade').addEventListener('change', fillCourses);
  $('course').addEventListener('change', fillUnits);
  $('unit').addEventListener('change', renderList);
  $('status').addEventListener('change', renderList);

  $('collect').addEventListener('click', function () {
    var btn = $('collect');
    btn.disabled = true; say('후보를 찾는 중이에요…');
    post('/api/collect', { grade: $('grade').value, courseId: $('course').value, unit: $('unit').value })
      .then(function (r) {
        if (!r.ok) throw new Error(r.j.reason || 'fail');
        say(r.j.found + '개를 찾았고, 새 후보 ' + r.j.added + '개를 추가했어요. (YouTube ' + (r.j.units || 0) + ' units 사용' +
          (r.j.notSynced && r.j.notSynced.length ? ' · 아직 목록을 안 받은 채널: ' + r.j.notSynced.join(', ') : '') + ')');
        loadUsage();
        return loadRecs();
      })
      .then(renderList)
      .catch(function (e) { say('후보를 찾지 못했어요 (' + e.message + '). 키 설정(.env.local)과 미리보기 서버를 확인해 주세요.', true); })
      .then(function () { btn.disabled = false; });
  });

  function setStatus(id, status, reason, doneText) {
    var body = { id: id, status: status };
    if (reason) body.reason = reason;
    return post('/api/review', body).then(function (r) {
      if (!r.ok) { say('바꾸지 못했어요 (' + r.j.reason + ').', true); return; }
      say(doneText);
      return loadRecs().then(renderList);
    });
  }

  $('list').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-set]'), s = ev.target.closest('[data-save]');
    if (b) {
      var st = b.getAttribute('data-set');
      setStatus(b.getAttribute('data-id'), st, '', st === 'approved' ? '승인했어요. 추천 이유는 자동으로 만들었어요.' : STATUS_LABEL[st] + '(으)로 바꿨어요.');
    } else if (s) {
      var id = s.getAttribute('data-save'), ta = document.querySelector('[data-reason="' + CSS.escape(id) + '"]');
      setStatus(id, 'approved', ta ? ta.value : '', '추천 이유를 저장하고 승인했어요.');
    }
  });

  // 주소 직접 추가 (YouTube oEmbed — 키·할당량 없음)
  var REASONS = { 'bad-url': '영상·재생목록 주소가 아니에요', 'bad-course': '학년·과목을 다시 골라 주세요', exists: '이미 있는 후보예요', 'video-rule': '규칙(교육과정 기준 연도·예비과정)에 맞지 않아요', oembed: 'YouTube에서 정보를 받지 못했어요(비공개·삭제 영상일 수 있어요)' };
  function addSay(id, text, err) { var m = $(id); m.textContent = text; m.className = 'msg' + (err ? ' err' : ''); }
  $('addUrlBtn').addEventListener('click', function () {
    var btn = $('addUrlBtn');
    btn.disabled = true; addSay('addMsg', '정보를 받는 중이에요…');
    post('/api/add-url', { url: $('addUrl').value, grade: $('grade').value, courseId: $('course').value, unit: $('unit').value })
      .then(function (r) {
        if (!r.ok) { addSay('addMsg', '추가하지 못했어요: ' + (REASONS[r.j.reason] || r.j.reason), true); return; }
        addSay('addMsg', '"' + r.j.title + '" (' + r.j.provider + (r.j.channelGroup === 'other' ? ', 다른 선생님' : '') + ')을 후보로 추가했어요. 아래 목록에서 [승인]하세요.');
        $('addUrl').value = '';
        return loadRecs().then(renderList);
      })
      .catch(function (e) { addSay('addMsg', '추가하지 못했어요 (' + e.message + ').', true); })
      .then(function () { btn.disabled = false; });
  });

  // 채널 목록 캐시 현황·받기
  function loadUsage() {
    return fetch('/api/usage').then(function (r) { return r.json(); }).then(function (j) {
      $('usage').textContent = '· 오늘 YouTube ' + j.usedToday + ' / ' + j.limit + ' units';
      $('chans').innerHTML = '<ul>' + j.channels.map(function (c) {
        return '<li>' + esc(c.name) + (c.group === 'other' ? ' <span class="soft">(다른 선생님' + (c.enabled ? '' : ', 꺼짐') + ')</span>' : '') +
          ' — <span class="soft">' + (c.uploads ? '영상 ' + c.uploads + '개' + (c.complete ? '' : ' (받는 중, 다시 누르면 이어 받음)') + ' · ' + esc(c.syncedAt) : '아직 안 받음') + '</span></li>';
      }).join('') + '</ul>';
    }).catch(function () {});
  }
  $('syncAll').addEventListener('click', function () {
    var btn = $('syncAll');
    btn.disabled = true; addSay('chMsg', '채널 목록을 받는 중이에요. 처음에는 몇 분 걸릴 수 있어요…');
    post('/api/sync', {}).then(function (r) {
      if (!r.ok) { addSay('chMsg', '받지 못했어요 (' + (r.j.reason === 'daily-limit' ? '오늘 사용량 한도(7,000 units)에 닿았어요' : r.j.reason) + ').', true); return; }
      addSay('chMsg', 'YouTube ' + r.j.units + ' units를 써서 받았어요.');
    }).catch(function (e) { addSay('chMsg', '받지 못했어요 (' + e.message + ').', true); })
      .then(function () { btn.disabled = false; loadUsage(); });
  });
  $('addChBtn').addEventListener('click', function () {
    post('/api/add-channel', { channel: $('addCh').value, school: $('addChSchool').value }).then(function (r) {
      if (!r.ok) { addSay('chMsg', '채널을 추가하지 못했어요 (' + ({ 'bad-channel': '@핸들 또는 youtube.com 채널 주소를 넣어 주세요', 'no-channel': '채널을 찾지 못했어요', 'is-ebs': '이미 EBS 허용 채널이에요' }[r.j.reason] || r.j.reason) + ').', true); return; }
      addSay('chMsg', '"' + r.j.name + '" 채널을 추가했어요. "채널 목록 받기"를 눌러 영상 목록을 받으세요.');
      $('addCh').value = '';
      loadUsage();
    });
  });
  loadUsage();

  $('grade').innerHTML = GRADES.map(function (g) { return '<option value="' + g[0] + '">' + g[1] + '</option>'; }).join('');
  fetch('/data/curriculum.json').then(function (r) { return r.json(); }).then(function (j) { cur = j; return loadRecs(); }).then(fillCourses);
})();
