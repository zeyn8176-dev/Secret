/* PRESENCE — Digital Smart Attendance
   Data is stored in the browser (localStorage). */

/* ---------- Storage ---------- */
const KEY_STUDENTS = 'presence.students.v1';
const KEY_ATTEND = 'presence.attendance.v1';
const load = (k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
let students = load(KEY_STUDENTS);
let attendance = load(KEY_ATTEND);
// "Clear" on the Attendance Record only hides today's list up to that moment; the stored attendance
// (and so the Attendance History) is never touched.
const KEY_RECCLEAR = 'presence.recordclear.v1';
let recClear = (() => { try { return JSON.parse(localStorage.getItem(KEY_RECCLEAR)) || {}; } catch { return {}; } })();

/* ---------- Helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtTime = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDay = (key) => new Date(key + 'T00:00:00').toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const fullName = (s) => `${s.firstName} ${s.lastName}`;
const FALLBACK_AVATAR = window.PRESENCE_ICON || 'icon.png';

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- Animation helpers ---------- */
const leaveTimers = new WeakMap();
const LEAVE_PROPS = ['top', 'left', 'width', 'height'];
function clearLeave(el) {
  el.classList.remove('anim-out', 'leaving');
  LEAVE_PROPS.forEach((p) => el.style.removeProperty(p));
}
function animIn(el) {
  clearTimeout(leaveTimers.get(el));
  clearLeave(el);
  el.hidden = false;
  el.classList.remove('anim-in');
  void el.offsetWidth; // restart the animation
  el.classList.add('anim-in');
}
function animOut(el, done) {
  if (el.hidden || el.classList.contains('anim-out')) return;
  const stage = $('stage');
  if (getComputedStyle(el).position !== 'fixed' && stage.contains(el)) {
    // take it out of the layout so the incoming view doesn't jump while this one fades
    const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
    el.style.top = (r.top - s.top) + 'px';
    el.style.left = (r.left - s.left) + 'px';
    el.style.width = r.width + 'px';
    el.style.height = r.height + 'px';
    el.classList.add('leaving');
  }
  el.classList.remove('anim-in');
  el.classList.add('anim-out');
  leaveTimers.set(el, setTimeout(() => { clearLeave(el); el.hidden = true; if (done) done(); }, 340));
}
const isGone = (el) => el.hidden || el.classList.contains('anim-out');

// ripple on every button press
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest && e.target.closest('button, .photo-drop');
  if (!b || b.disabled) return;
  const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2;
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  b.appendChild(s);
  setTimeout(() => s.remove(), 950);
});

// confirmation dialog (animated, inside the system)
function confirmDialog(title, text, yesLabel = 'Confirm', yesStyle = 'danger') {
  return new Promise((resolve) => {
    const m = $('confirmModal'), yes = $('confirmYes'), no = $('confirmNo');
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    yes.textContent = yesLabel;
    yes.className = yesStyle; // 'danger' (red) for removals, 'primary' (blue) for positive actions
    const finish = (v) => {
      yes.onclick = no.onclick = m.onclick = null;
      document.removeEventListener('keydown', onKey);
      animOut(m);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') finish(false); };
    document.addEventListener('keydown', onKey);
    yes.onclick = () => finish(true);
    no.onclick = () => finish(false);
    m.onclick = (e) => { if (e.target === m) finish(false); };
    animIn(m);
    no.focus();
  });
}

/* ---------- View state ---------- */
const navButtons = { scan: $('btnScan'), students: $('btnStudents'), record: $('btnRecord'), history: $('btnHistory'), register: $('btnRegister') };
function setActive(name) {
  Object.entries(navButtons).forEach(([k, b]) => b.classList.toggle('active', k === name));
}
// An open students / history panel (or the register form) keeps its button highlighted,
// so starting or stopping the camera never changes what the person is looking at.
function activeName(scanOn) {
  if (panelOpen('students')) return 'students';
  if (!isGone($('todayArea'))) return 'record';
  if (!isGone($('calendarArea'))) return 'history';
  if (!isGone($('registerArea'))) return 'register';
  return scanOn ? 'scan' : '';
}
const keepsPanel = () => panelKind === 'students' || panelKind === 'history';
// one view at a time in the main area: the scanner, the register form or the history calendar
const VIEW_IDS = { scan: 'scannerArea', register: 'registerArea', calendar: 'calendarArea', today: 'todayArea' };
function showView(name) {
  Object.entries(VIEW_IDS).forEach(([k, id]) => {
    const el = $(id);
    if (k === name) { if (isGone(el)) animIn(el); } else animOut(el);
  });
}
function showRegister(on) {
  if (on) { showView('register'); hidePanel(); }
  else showView('scan');
}
let panelKind = null; // which sidebar button owns the open panel: 'students' | 'history' | null
function hidePanel() {
  animOut($('sidePanel'));
  $('stage').classList.remove('has-panel');
  panelKind = null;
}
// close the panel and return to the scanner (used by pressing the same button again)
function closePanel() {
  hidePanel();
  setActive(scanning ? 'scan' : '');
}

/* ---------- Side panel rendering ---------- */
let panelBackFn = null;
function panel(title, sub, html, back = false, animate = true, kind = null) {
  showView(kind === 'history' ? (histState.mode === 'today' ? 'today' : 'calendar') : 'scan');
  if (isGone($('sidePanel'))) animIn($('sidePanel'));
  $('stage').classList.add('has-panel');
  panelKind = kind;
  panelBackFn = typeof back === 'function' ? back : null;
  $('panelBack').hidden = !back;
  $('panelTitle').textContent = title;
  $('panelSub').textContent = sub || '';
  const pb = $('panelBody');
  pb.innerHTML = html;
  pb.classList.remove('content-in');
  if (animate) {
    [...pb.children].forEach((c, i) => c.style.setProperty('--c', i));
    pb.querySelectorAll('.list li, .kv div').forEach((li, i) => li.style.setProperty('--i', Math.min(i, 14)));
    void pb.offsetWidth;
    pb.classList.add('content-in');
  }
}

function renderIdle() {
  panel('Student Information', '', '<p class="empty">Scan a student QR code to display their information here.</p>');
}

function renderScanResult(student, status, record) {
  // status: ok | dup | unknown
  if (status === 'unknown') {
    panel('Student Information', 'Scan result',
      `<div class="result"><img class="avatar" src="${FALLBACK_AVATAR}" alt="">
       <h3>Not Registered</h3>
       <p class="course">This QR code does not belong to a registered student.</p>
       <span class="badge err">Attendance not recorded</span></div>`);
    return;
  }
  const cs = classStats(student);
  const badge = status === 'ok'
    ? '<span class="badge ok">Attendance recorded</span>'
    : '<span class="badge warn">Already recorded today</span>';
  panel('Student Information', 'Scan result',
    `<div class="result">
       <img class="avatar" src="${esc(student.photo || FALLBACK_AVATAR)}" alt="">
       <h3>${esc(fullName(student))}</h3>
       <p class="course">${esc(student.course)}${student.yearLevel ? ' · ' + esc(student.yearLevel) : ''}</p>
       ${badge}
       <div class="kv">
         <div><span>Student ID</span><span>${esc(student.id)}</span></div>
         <div><span>Sex</span><span>${esc(student.sex || '—')}</span></div>
         <div><span>Year level</span><span>${esc(student.yearLevel || '—')}</span></div>
         <div><span>Section</span><span>${esc(student.section || '—')}</span></div>
         <div><span>Class present</span><span>${cs.n} / ${cs.reg} · ${cs.pct}%</span></div>
         <div><span>Date</span><span>${esc(record.date)}</span></div>
         <div><span>Time</span><span>${esc(record.time)}</span></div>
       </div>
       <div class="form-actions result-actions"><button class="ghost" id="viewHistory" type="button">View Attendance Record</button></div>
     </div>`);
  $('viewHistory').addEventListener('click', showToday);
}

let studentFilter = '';
function renderStudents(filter = '', fromSearch = false) {
  studentFilter = filter;
  const q = filter.trim().toLowerCase();
  const rows = students
    .filter((s) => !q || `${fullName(s)} ${s.course} ${s.id} ${s.sex || ''} ${s.yearLevel || ''} ${s.section || ''}`.toLowerCase().includes(q))
    .map((s) => `<li class="clickable" data-open="${esc(s.id)}" tabindex="0" role="button" title="View full information">
        <img src="${esc(s.photo || FALLBACK_AVATAR)}" alt="">
        <div class="meta"><b>${esc(fullName(s))}</b><small>${esc(s.course)}${s.yearLevel ? ' · ' + esc(s.yearLevel) : ''}${s.section ? ' · ' + esc(s.section) : ''}</small><small>${esc(s.id)}${s.sex ? ' · ' + esc(s.sex) : ''}</small></div>
        <button class="icon-btn" data-del="${esc(s.id)}" title="Remove student" type="button">Remove</button>
      </li>`).join('');
  const html = `<input class="search" id="studentSearch" type="search" placeholder="Search students…" value="${esc(filter)}">
    ${rows ? `<ul class="list students">${rows}</ul>` : '<p class="empty">No registered students found.</p>'}`;
  panel('Registered Students', `${students.length} registered · click a student for details`, html, false, !fromSearch, 'students');
  const search = $('studentSearch');
  search.addEventListener('input', () => {
    renderStudents(search.value, true);
    const el = $('studentSearch'); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  });
}

const fmtShort = (key) => new Date(key + 'T00:00:00').toLocaleDateString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

// from: 'students' (opened from the registered list) or 'history' (opened from an attendance row)
function renderStudentDetail(id, from = 'students') {
  const s = students.find((x) => x.id === id);
  if (!s) {
    if (from === 'history') toast('This student is no longer registered.');
    else renderStudents(studentFilter);
    return;
  }
  const goBack = () => {
    if (from === 'history' && histState.mode === 'today') { hidePanel(); renderToday(); } // opened from today's record
    else if (from === 'history') renderHistoryPanel();
    else renderStudents(studentFilter);
  };
  const recs = attendance.filter((r) => r.studentId === s.id).sort((a, b) => b.ts - a.ts);
  const last = recs[0];
  const regAt = s.registeredAt ? new Date(s.registeredAt).toLocaleString() : '—';
  const history = recs.length
    ? `<ul class="list">${recs.map((r) => `<li class="clickable" data-date="${esc(r.date)}" tabindex="0" role="button" title="Open this date in Attendance History"><div class="meta"><b>${esc(fmtShort(r.date))}</b></div><div class="time">${esc(r.time)}</div></li>`).join('')}</ul>`
    : '<p class="empty">No attendance recorded for this student yet.</p>';
  const html = `
    <div class="result">
      <img class="avatar" src="${esc(s.photo || FALLBACK_AVATAR)}" alt="">
      <h3>${esc(fullName(s))}</h3>
      <p class="course">${esc(s.course)}${s.yearLevel ? ' · ' + esc(s.yearLevel) : ''}</p>
      <div class="kv">
        <div><span>Student ID</span><span>${esc(s.id)}</span></div>
        <div><span>First name</span><span>${esc(s.firstName)}</span></div>
        <div><span>Last name</span><span>${esc(s.lastName)}</span></div>
        <div><span>Sex</span><span>${esc(s.sex || '—')}</span></div>
        <div><span>Course</span><span>${esc(s.course)}</span></div>
        <div><span>Year level</span><span>${esc(s.yearLevel || '—')}</span></div>
        <div><span>Section</span><span>${esc(s.section || '—')}</span></div>
        <div><span>Registered</span><span>${esc(regAt)}</span></div>
        <div><span>Days present</span><span>${recs.length}</span></div>
        <div><span>Last attendance</span><span>${last ? esc(fmtShort(last.date) + ' ' + last.time) : '—'}</span></div>
      </div>
    </div>
    <div class="detail-qr">
      <div class="day-head">QR code</div>
      <div id="detailQR" class="qr-box"></div>
      <div class="form-actions">
        <button class="ghost" id="dlQR" type="button">Download QR</button>
      </div>
    </div>
    <div class="day-head">Attendance history · ${recs.length} day${recs.length === 1 ? '' : 's'} present</div>
    ${history}
    <div class="remove-zone">
      <button class="danger block" id="rmStudent" type="button">Remove Student</button>
    </div>`;
  panel('Student Details', s.id, html, goBack, true, from);
  $('detailQR').appendChild(buildQRCanvas(qrPayload(s)));
  $('dlQR').addEventListener('click', () => downloadCanvas(buildQRCanvas(qrPayload(s), 640, s.id), `${s.id}-QR.png`));
  $('rmStudent').addEventListener('click', () => removeStudent(s.id, goBack));
}

async function removeStudent(id, after) {
  const s = students.find((x) => x.id === id);
  if (!s) return;
  const ok = await confirmDialog(`Remove ${fullName(s)}?`,
    'This student will be removed from the registered list and their QR code will stop working. Past attendance records are kept.', 'Remove');
  if (!ok) return;
  students = students.filter((x) => x.id !== s.id);
  save(KEY_STUDENTS, students);
  toast('Student removed.');
  if (after) after();
}

/* ---------- Attendance history: calendar -> courses -> attendance record ---------- */
const YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
const cal = { y: new Date().getFullYear(), m: new Date().getMonth() }; // starts on the system's current month
let histState = { date: null, course: null, year: null, section: null, open: null, openYear: null, mode: 'calendar' };
const newHist = (date = null, mode = 'calendar') => ({ date, course: null, year: null, section: null, open: null, openYear: null, mode });
// a record's section: saved with the scan, or (older records) taken from the registered student
const secOf = (r) => {
  if (r.section) return r.section;
  const s = students.find((x) => x.id === r.studentId);
  return (s && s.section) || '';
};
const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const monthName = (m) => new Date(2000, m, 1).toLocaleDateString([], { month: 'long' });
// first day of the week follows the system's region settings when the browser exposes them
function weekStart() {
  try {
    const loc = new Intl.Locale(navigator.language);
    const info = loc.getWeekInfo ? loc.getWeekInfo() : loc.weekInfo;
    if (info && info.firstDay) return info.firstDay % 7; // 1 = Monday ... 7 = Sunday
  } catch { /* fall back to Sunday */ }
  return 0;
}
// the courses offered in the registration form (single source of truth) plus any other course already in use
function courseNames() {
  const list = [...document.querySelectorAll('#courseList option')].map((o) => o.value);
  [...students.map((s) => s.course), ...attendance.map((r) => r.course)].forEach((c) => {
    const t = String(c || '').trim();
    if (t && !list.some((x) => sameText(x, t))) list.push(t);
  });
  return list;
}
const recordsOn = (date) => attendance.filter((r) => r.date === date);

function renderCalendar() {
  const counts = {};
  attendance.forEach((r) => { counts[r.date] = (counts[r.date] || 0) + 1; });

  const thisYear = new Date().getFullYear();
  const dataYears = attendance.map((r) => +String(r.date).slice(0, 4)).filter(Boolean);
  const lo = Math.min(cal.y, thisYear - 3, ...dataYears), hi = Math.max(cal.y, thisYear + 1, ...dataYears);
  const ySel = $('calYear');
  ySel.innerHTML = '';
  for (let y = lo; y <= hi; y++) { const o = document.createElement('option'); o.value = y; o.textContent = y; ySel.appendChild(o); }
  ySel.value = cal.y;
  $('calMonth').value = cal.m;

  const ws = weekStart();
  $('calDow').innerHTML = Array.from({ length: 7 }, (_, i) =>
    `<span>${esc(new Date(2021, 0, 3 + ((ws + i) % 7)).toLocaleDateString([], { weekday: 'short' }))}</span>`).join('');

  const lead = (new Date(cal.y, cal.m, 1).getDay() - ws + 7) % 7;
  const days = new Date(cal.y, cal.m + 1, 0).getDate();
  const today = todayKey();
  let html = '<i class="cal-blank"></i>'.repeat(lead);
  for (let d = 1; d <= days; d++) {
    const key = `${cal.y}-${pad(cal.m + 1)}-${pad(d)}`;
    const n = counts[key] || 0;
    const sel = key === histState.date;
    html += `<button type="button" class="cal-day${key === today ? ' today' : ''}${sel ? ' selected' : ''}" data-date="${key}" aria-pressed="${sel}">`
      + `<span>${d}</span>${n ? `<em class="cal-count" title="${n} present">${n}</em>` : ''}</button>`;
  }
  const grid = $('calGrid');
  grid.innerHTML = html;
  grid.style.gridTemplateRows = `repeat(${Math.ceil((lead + days) / 7)}, minmax(54px, 1fr))`;
}

function showCalendar(key = null) {
  stopCamera();
  histState = newHist(key);
  if (key) { const [y, m] = key.split('-'); cal.y = +y; cal.m = +m - 1; }
  renderCalendar();
  showView('calendar');
  setActive('history');
  if (key) renderCourses(); else hidePanel();
}

// Attendance Record button: today's timeline only (no side panel)
function showToday() {
  stopCamera();
  histState = newHist(todayKey(), 'today');
  hidePanel();
  renderToday();
  showView('today');
  setActive('record');
}

// today's scans that have not been cleared from this list
const todayRecords = () => recordsOn(todayKey()).filter((r) => !(recClear.date === todayKey() && r.ts <= recClear.ts));

/* ----- Attendance Record: grouped by course > year level > section, with % present ----- */
const pct = (n, d) => (d ? Math.min(100, Math.round((n / d) * 100)) : 0);
const natural = (p, q) => String(p).localeCompare(String(q), undefined, { numeric: true, sensitivity: 'base' });
// how many students are registered in a course (and optionally year level / section)
const registeredIn = (course, year, sec) => students.filter((s) =>
  sameText(s.course, course) && (year == null || (s.yearLevel || '') === year) && (sec == null || sameText(s.section, sec))).length;
const statHTML = (n, reg) =>
  `<div class="stat" title="${n} of ${reg} registered students present"><span class="stat-pct">${pct(n, reg)}%</span><small>${n} / ${reg} present</small></div>`;
const barHTML = (n, reg) => `<div class="bar" aria-hidden="true"><i style="width:${pct(n, reg)}%"></i></div>`;

// present / registered / percent for the class (course + year level + section) of one student
function classStats(student) {
  const same = (x) => sameText(x.course, student.course) && (x.yearLevel || '') === (student.yearLevel || '');
  const n = todayRecords().filter((r) => same(r) && sameText(secOf(r), student.section)).length;
  const reg = students.filter((s) => same(s) && sameText(s.section, student.section)).length;
  return { n, reg, pct: pct(n, reg) };
}

function groupToday(recs) {
  const order = courseNames();
  const courses = [];
  recs.forEach((r) => {
    const cName = String(r.course || '').trim(), yName = r.yearLevel || '', sName = String(secOf(r) || '').trim();
    let c = courses.find((x) => sameText(x.name, cName));
    if (!c) courses.push(c = { name: cName, years: [] });
    let y = c.years.find((x) => x.name === yName);
    if (!y) c.years.push(y = { name: yName, secs: [] });
    let sc = y.secs.find((x) => sameText(x.name, sName));
    if (!sc) y.secs.push(sc = { name: sName, rows: [] });
    sc.rows.push(r);
  });
  const rank = (list, name, cmp) => { const i = list.findIndex((x) => cmp(x, name)); return i < 0 ? 999 : i; };
  courses.sort((a, b) => rank(order, a.name, sameText) - rank(order, b.name, sameText) || natural(a.name, b.name));
  courses.forEach((c) => {
    c.years.sort((a, b) => rank(YEARS, a.name, (x, n) => x === n) - rank(YEARS, b.name, (x, n) => x === n));
    c.years.forEach((y) => y.secs.sort((a, b) => natural(a.name, b.name)));
  });
  return courses;
}

function renderToday() {
  const date = todayKey();
  const recs = todayRecords().sort((a, b) => b.ts - a.ts); // newest first inside each section
  $('todayDate').textContent = fmtDay(date);
  $('btnClearRecord').hidden = $('btnExportRecord').hidden = !recs.length;
  if (!recs.length) {
    $('todayList').innerHTML = '<p class="empty">No attendance in this list yet. Scanned students will appear here, grouped by course, year level and section.</p>';
    return;
  }
  const row = (r) => {
    const s = students.find((x) => x.id === r.studentId);
    return `<li class="clickable" data-open="${esc(r.studentId)}" tabindex="0" role="button" title="View student details"><img src="${esc((s && s.photo) || FALLBACK_AVATAR)}" alt=""><div class="meta"><b>${esc(r.name)}</b><small>${esc(r.studentId)}</small></div><span class="row-time">${esc(r.time)}</span></li>`;
  };
  $('todayList').innerHTML = groupToday(recs).map((c) => {
    const years = c.years.map((y) => {
      const secs = y.secs.map((sc) => {
        const reg = registeredIn(c.name, y.name, sc.name);
        return `<div class="sec-card">
          <div class="sec-head"><b>${esc(sc.name ? 'Section ' + sc.name : 'No section')}</b>${statHTML(sc.rows.length, reg)}</div>
          ${barHTML(sc.rows.length, reg)}
          <ul class="sec-list">${sc.rows.map(row).join('')}</ul></div>`;
      }).join('');
      return `<div class="grp-year">
        <div class="grp-head year"><h4>${esc(y.name || 'No year level')}</h4></div>
        <div class="sec-grid">${secs}</div></div>`;
    }).join('');
    return `<section class="grp-course">
      <div class="grp-head course"><h3>${esc(c.name || 'No course')}</h3></div>${years}</section>`;
  }).join('');
}

async function clearRecord() {
  const n = todayRecords().length;
  if (!n) return;
  const ok = await confirmDialog('Clear today’s record?',
    `This resets the list of ${n} student${n === 1 ? '' : 's'}, the course / year level / section groups and all percentages back to zero. Attendance History keeps its saved records.`, 'Clear');
  if (!ok) return;
  recClear = { date: todayKey(), ts: Date.now() };
  localStorage.setItem(KEY_RECCLEAR, JSON.stringify(recClear));
  renderToday();
  toast('Attendance Record reset.');
}

function closeHistory() {
  histState = newHist();
  hidePanel();
  showView('scan');
  setActive(scanning ? 'scan' : '');
}

function pickDate(key) {
  if (histState.date === key && !isGone($('sidePanel'))) { // clicking the picked date again hides the right panel
    histState = newHist();
    $('calGrid').querySelectorAll('.cal-day').forEach((b) => { b.classList.remove('selected'); b.setAttribute('aria-pressed', 'false'); });
    hidePanel();
    return;
  }
  histState = newHist(key);
  $('calGrid').querySelectorAll('.cal-day').forEach((b) => {
    const on = b.dataset.date === key;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-pressed', on);
  });
  renderCourses();
}

// right panel, step 1: only the courses that have attendees on the picked date.
// Click a course to open / close its year levels (and the sections of each year level),
// each with present / registered counts.
function renderCourses() {
  const date = histState.date;
  if (!date) { hidePanel(); return; }
  histState.course = histState.year = histState.section = null;
  const recs = recordsOn(date);
  const regCount = (c, y, sec) => students.filter((s) => sameText(s.course, c) && (!y || s.yearLevel === y) && (sec == null || sameText(s.section, sec))).length;
  const sectionsOf = (c, y) => {
    const list = [];
    [...students.filter((s) => sameText(s.course, c) && s.yearLevel === y).map((s) => s.section),
     ...recs.filter((r) => sameText(r.course, c) && r.yearLevel === y).map(secOf)].forEach((v) => {
      const t = String(v || '').trim();
      if (t && !list.some((x) => sameText(x, t))) list.push(t);
    });
    return list.sort((p, q) => p.localeCompare(q, undefined, { numeric: true, sensitivity: 'base' }));
  };
  const attended = courseNames().filter((c) => recs.some((r) => sameText(r.course, c)));
  if (histState.open && !attended.some((c) => sameText(c, histState.open))) histState.open = null;
  const html = attended.length ? attended.map((c) => {
    const inCourse = recs.filter((r) => sameText(r.course, c));
    const open = sameText(c, histState.open);
    const blocks = YEARS.map((y) => {
      const inYear = inCourse.filter((r) => r.yearLevel === y);
      const secs = sectionsOf(c, y).map((sec) => {
        const n = inYear.filter((r) => sameText(secOf(r), sec)).length;
        return `<button type="button" class="chip sec${n ? '' : ' zero'}" data-course="${esc(c)}" data-year="${esc(y)}" data-section="${esc(sec)}"><span>${esc(sec)}</span><em>${n}/${regCount(c, y, sec)}</em></button>`;
      }).join('');
      const zero = inYear.length ? '' : ' zero';
      const counts = `<em>${inYear.length}/${regCount(c, y)}</em>`;
      if (!secs) { // no sections registered for this year level: open its record straight away
        return `<div class="year-block"><button type="button" class="chip${zero}" data-course="${esc(c)}" data-year="${esc(y)}"><span>${esc(y)}</span>${counts}</button></div>`;
      }
      const openY = open && sameText(y, histState.openYear);
      return `<div class="year-block${openY ? ' open' : ''}"><button type="button" class="chip${zero}" data-ytoggle="${esc(y)}" aria-expanded="${!!openY}"><span>${esc(y)}</span>${counts}<i class="caret"></i></button>`
        + `<div class="sec-chips"><small>Section</small>${secs}</div></div>`;
    }).join('');
    const total = regCount(c);
    return `<div class="course-card${open ? ' open' : ''}"><button type="button" class="course-btn" data-toggle="${esc(c)}" aria-expanded="${open}"><span class="course-name">${esc(c)}</span><em class="ratio" title="${inCourse.length} of ${total} present">${total ? Math.round(inCourse.length / total * 100) : 0}%</em><i class="caret"></i></button><div class="year-chips">${blocks}</div></div>`;
  }).join('') : '<p class="empty">No student attended on this date.</p>';
  panel('Courses', `${fmtDay(date)} · ${recs.length} present`, html, false, true, 'history');
}

// right panel, step 2: students of that course / year level (/ section) who attended on the picked date
function renderRecord(course, year, section = null) {
  const date = histState.date;
  histState.course = course; histState.year = year; histState.section = section;
  const rows = recordsOn(date)
    .filter((r) => sameText(r.course, course) && r.yearLevel === year && (section == null || sameText(secOf(r), section)))
    .sort((a, b) => a.ts - b.ts);
  const html = rows.length
    ? `<ul class="list students">${rows.map((r) => {
        const s = students.find((x) => x.id === r.studentId);
        const sec = secOf(r);
        return `<li class="clickable" data-open="${esc(r.studentId)}" tabindex="0" role="button" title="View student information"><img src="${esc((s && s.photo) || FALLBACK_AVATAR)}" alt="">
          <div class="meta"><b>${esc(r.name)}</b><small>${esc(r.studentId)}${section == null && sec ? ' · ' + esc(sec) : ''}</small></div>
          <div class="time"><b>${esc(r.time)}</b></div></li>`;
      }).join('')}</ul>`
    : '<p class="empty">No students attended on this date.</p>';
  const label = [course, year, section].filter((v) => v != null && v !== '').join(' · ');
  panel('Attendance Record', `${label} · ${rows.length} present`, html, () => renderCourses(), true, 'history');
}

function renderHistoryPanel() {
  if (!histState.date) { hidePanel(); return; }
  if (histState.course) renderRecord(histState.course, histState.year, histState.section);
  else renderCourses();
}

async function clearHistory() {
  const n = attendance.length;
  if (!n) return;
  const ok = await confirmDialog('Clear attendance history?',
    `All ${n} attendance record${n === 1 ? '' : 's'} will be permanently deleted. Registered students are kept. Export the CSV first if you need a copy.`,
    'Clear History');
  if (!ok) return;
  attendance = [];
  save(KEY_ATTEND, attendance);
  toast('Attendance history cleared.');
  if (!isGone($('calendarArea'))) { renderCalendar(); renderHistoryPanel(); }
}

function downloadCSV(list, name) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [['Date', 'Time', 'Student ID', 'Name', 'Course', 'Year Level', 'Section'].map(cell).join(',')];
  list.forEach((r) =>
    lines.push([r.date, r.time, r.studentId, r.name, r.course, r.yearLevel || '', secOf(r)].map(cell).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportCSV() {
  if (!attendance.length) { toast('No attendance to export.'); return; }
  downloadCSV([...attendance].sort((a, b) => a.ts - b.ts), `attendance-${todayKey()}.csv`);
}

// Attendance Record: exports only what the list currently shows, in the same course / year / section order
function exportRecordCSV() {
  const recs = todayRecords();
  if (!recs.length) { toast('No attendance to export.'); return; }
  const list = [];
  groupToday(recs).forEach((c) => c.years.forEach((y) => y.secs.forEach((sc) => list.push(...sc.rows.sort((p, q) => p.ts - q.ts)))));
  downloadCSV(list, `attendance-record-${todayKey()}.csv`);
}

/* ---------- Camera ---------- */
const video = $('video');
const canvas = $('scanCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
let stream = null;
let scanning = false;
let rafId = null;
let lastValue = '';
let lastAt = 0;

function setStatus(on, text) {
  $('statusDot').classList.toggle('live', on);
  $('statusText').textContent = text;
}

async function startCamera() {
  if (scanning) return;
  if (!window.isSecureContext && location.hostname !== 'localhost') {
    toast('Camera needs HTTPS or localhost.');
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('This browser does not support camera access.');
    return;
  }
  showView('scan');
  if (panelKind !== 'students') hidePanel(); // leave an open Registered Students panel alone
  setActive(activeName(true));
  // Ask for the back camera (on phones the first listed camera is often the front one).
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30, max: 30 } },
      audio: false,
    });
  } catch (err) {
    const msg = err && err.name === 'NotAllowedError' ? 'Camera permission was denied.'
      : err && err.name === 'NotFoundError' ? 'No camera was found.'
      : 'Could not start the camera.';
    toast(msg);
    setActive(activeName(false));
    return;
  }
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  await video.play().catch(() => {});
  try { // keep the picture sharp when a phone screen / printed QR is held close
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
  } catch { /* not supported */ }
  if (!detector && !window.jsQR) { // no QR reader yet: wait for the backup CDNs
    setStatus(true, 'Loading scanner…');
    if (!(await ensureJsQR())) {
      toast('The QR reader could not load. Check your internet connection, then press Scan again.');
      stopCamera();
      setActive(activeName(false));
      return;
    }
  }
  $('cameraPlaceholder').hidden = true;
  $('reticle').hidden = false;
  scanning = true;
  document.body.classList.add('is-scanning');
  setStatus(true, 'Scanning…');
  tick();
}

function stopCamera() {
  scanning = false;
  document.body.classList.remove('is-scanning');
  cancelAnimationFrame(rafId);
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  video.srcObject = null;
  $('cameraPlaceholder').hidden = false;
  $('reticle').hidden = true;
  setStatus(false, 'Camera off');
}

let detector = null;
try { if ('BarcodeDetector' in window) detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
let busy = false, lastScanAt = 0, frameNo = 0, detectorFails = 0;

// Make sure the QR reader library (jsQR) is available. If the main CDN is blocked or slow,
// try the others, so scanning doesn't silently do nothing.
const JSQR_SOURCES = [
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js',
];
let jsQRLoading = null;
function ensureJsQR() {
  if (window.jsQR) return Promise.resolve(true);
  if (jsQRLoading) return jsQRLoading;
  jsQRLoading = (async () => {
    for (const src of JSQR_SOURCES) {
      const ok = await new Promise((res) => {
        const s = document.createElement('script');
        s.src = src; s.onload = () => res(true); s.onerror = () => { s.remove(); res(false); };
        document.head.appendChild(s);
      });
      if (ok && window.jsQR) return true;
    }
    return false;
  })();
  jsQRLoading.then((ok) => { if (!ok) jsQRLoading = null; }); // allow a retry later
  return jsQRLoading;
}

// jsQR fallback. Every attempt looks at the frame through a different "view" (crop + size):
//  - shrinking the picture removes the moire / pixel grid you get when filming a phone or
//    monitor (one size is never right for every distance, so several are rotated through);
//  - the centre crop finds a code held inside the yellow frame quickly;
//  - the contrast-boosted views rescue washed-out frames (screen glare, bright backlight).
// Three views are tried per tick, so every view gets a turn many times a second.
const VIEWS = [
  { crop: 1,    max: 480 },
  { crop: 0.7,  max: 420 },
  { crop: 1,    max: 320 },
  { crop: 1,    max: 800 },
  { crop: 0.55, max: 360, boost: true },
  { crop: 1,    max: 640, boost: true },
];
const SCAN_SIZE = 800;
canvas.width = canvas.height = SCAN_SIZE; // one fixed canvas: no re-allocation per frame
// Area-averaging downscale. A single drawImage() to a much smaller size just skips pixels,
// which keeps (even creates) the moire pattern you see when filming a phone screen. Halving
// step by step averages neighbouring pixels, which smooths the pixel grid away while the
// QR squares stay crisp.
const stepA = document.createElement('canvas'), stepB = document.createElement('canvas');
stepA.width = stepB.width = 640; stepA.height = stepB.height = 360;
const stepACtx = stepA.getContext('2d'), stepBCtx = stepB.getContext('2d');
[ctx, stepACtx, stepBCtx].forEach((c) => { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; });
function scaleDown(source, sx, sy, sw, sh, tw, th) {
  let src = source, cx = sx, cy = sy, cw = sw, ch = sh, useA = true;
  while (cw / 2 >= tw && ch / 2 >= th) {
    const nw = Math.round(cw / 2), nh = Math.round(ch / 2);
    if (stepA.width < nw || stepA.height < nh) { // very large camera picture: grow the work canvases
      stepA.width = stepB.width = Math.max(stepA.width, nw); stepA.height = stepB.height = Math.max(stepA.height, nh);
      [stepACtx, stepBCtx].forEach((c) => { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; });
    }
    const dst = useA ? stepA : stepB, dctx = useA ? stepACtx : stepBCtx;
    dctx.drawImage(src, cx, cy, cw, ch, 0, 0, nw, nh);
    src = dst; cx = 0; cy = 0; cw = nw; ch = nh; useA = !useA;
  }
  ctx.drawImage(src, cx, cy, cw, ch, 0, 0, tw, th);
}
// Draws one "view" of the current frame onto the work canvas and returns its pixels.
function grabView(v) {
  const vw = video.videoWidth, vh = video.videoHeight;
  let sx = 0, sy = 0, sw = vw, sh = vh;
  if (v.crop < 1) { // centred square
    const side = Math.round(Math.min(vw, vh) * v.crop);
    sx = Math.round((vw - side) / 2); sy = Math.round((vh - side) / 2); sw = sh = side;
  }
  const k = Math.min(1, v.max / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  try { ctx.filter = v.boost ? 'grayscale(1) contrast(1.8)' : 'none'; } catch { /* unsupported */ }
  scaleDown(video, sx, sy, sw, sh, w, h);
  try { ctx.filter = 'none'; } catch { /* unsupported */ }
  return ctx.getImageData(0, 0, w, h);
}
function decodeView(v, inversion) {
  const img = grabView(v);
  const code = jsQR(img.data, img.width, img.height, { inversionAttempts: inversion });
  return code && code.data ? code.data : null;
}

// Background decoder. jsQR is heavy; running it on the page's own thread is what made the
// camera and the whole page stutter. In a Web Worker the page stays smooth while the
// decoding happens on another CPU core. If a worker can't be made, the old in-page decoder is used.
let qrWorker = null, workerOK = true, workerBusy = false, workerJobId = 0;
function getWorker() {
  if (qrWorker || !workerOK) return qrWorker;
  try {
    const code = `
      let ready = false;
      for (const u of ${JSON.stringify(JSQR_SOURCES)}) {
        try { importScripts(u); if (self.jsQR) { ready = true; break; } } catch (e) {}
      }
      onmessage = (e) => {
        const d = e.data; let value = null;
        if (ready) {
          try {
            const c = self.jsQR(new Uint8ClampedArray(d.buf), d.w, d.h, { inversionAttempts: d.inv });
            value = c && c.data ? c.data : null;
          } catch (err) {}
        }
        postMessage({ value, ready });
      };`;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    qrWorker = new Worker(url);
    qrWorker.onmessage = (e) => {
      workerBusy = false;
      if (!e.data.ready) { dropWorker(); return; } // library could not load inside the worker
      if (e.data.value && scanning) handleScan(e.data.value);
    };
    qrWorker.onerror = () => dropWorker();
  } catch { dropWorker(); }
  return qrWorker;
}
function dropWorker() {
  workerOK = false; workerBusy = false;
  if (qrWorker) { qrWorker.terminate(); qrWorker = null; }
}
// Sends ONE view of the current frame to the worker (skipped while it is still busy).
// Returns false when no worker is available, so the caller can fall back.
function decodeInWorker() {
  const w = getWorker();
  if (!w) return false;
  if (workerBusy) return true;
  const n = frameNo++;
  const img = grabView(VIEWS[n % VIEWS.length]);
  workerBusy = true;
  w.postMessage({ buf: img.data.buffer, w: img.width, h: img.height, inv: n % 5 === 4 ? 'attemptBoth' : 'dontInvert' }, [img.data.buffer]);
  return true;
}
function decodeWithJsQR() {
  if (!window.jsQR) return null;
  for (let i = 0; i < 2; i++) {
    const n = frameNo++;
    // the slower inverted (light-on-dark) check only runs now and then
    const value = decodeView(VIEWS[n % VIEWS.length], n % 5 === 4 ? 'attemptBoth' : 'dontInvert');
    if (value) return value;
  }
  return null;
}

async function tick(ts = 0) {
  if (!scanning) return;
  rafId = requestAnimationFrame(tick);
  if (busy || ts - lastScanAt < (workerOK ? 45 : 90) || video.readyState < 2 || !video.videoWidth) return;
  lastScanAt = ts; busy = true;
  try {
    let value = null;
    if (detector) { // built-in browser detector (fast); if it keeps failing, drop it and use jsQR
      try {
        const found = await detector.detect(video);
        if (found.length) value = found[0].rawValue;
        detectorFails = 0;
      } catch { if (++detectorFails > 5) detector = null; }
    }
    if (!value && !decodeInWorker()) value = decodeWithJsQR();
    if (value) handleScan(value);
  } catch { /* skip this frame */ }
  busy = false;
}

// green flash + short vibration so you know the code was read
function flashReticle() {
  const r = $('reticle');
  r.classList.remove('hit'); void r.offsetWidth; r.classList.add('hit');
  try { if (navigator.vibrate) navigator.vibrate(60); } catch { /* not supported */ }
}

/* ---------- Attendance ---------- */
// The QR now holds just the Student ID (e.g. PRS-2026-0001): a tiny 21x21 code that
// scans almost instantly. Older "PRESENCE:<id>" codes are still understood.
function parseQR(raw) {
  raw = String(raw).replace(/[\u0000-\u001f]/g, '').trim();
  const m = /^PRESENCE:(.+)$/i.exec(raw);
  if (m) return m[1].trim();
  try { const p = JSON.parse(raw); if (p && p.app === 'presence' && typeof p.id === 'string') return p.id.trim(); } catch { /* not JSON */ }
  return raw || null;
}
const looksLikeId = (v) => /^PRS-\d{4}-\d+$/i.test(v || '');

function handleScan(raw) {
  const now = Date.now();
  if (raw === lastValue && now - lastAt < 3000) return; // debounce repeat reads
  lastValue = raw; lastAt = now;
  flashReticle();

  const id = parseQR(raw);
  const student = id ? students.find((s) => s.id.toUpperCase() === id.toUpperCase()) : null;

  if (!student) {
    if (looksLikeId(id)) renderScanResult(null, 'unknown');
    else toast('This is not a PRESENCE student QR code.');
    beep(false);
    return;
  }
  const d = new Date();
  const date = todayKey(d);
  let rec = attendance.find((r) => r.studentId === student.id && r.date === date);
  let status = 'dup';
  if (!rec) {
    rec = { studentId: student.id, name: fullName(student), course: student.course, yearLevel: student.yearLevel || '', section: student.section || '', date, time: fmtTime(d), ts: d.getTime() };
    attendance.push(rec);
    save(KEY_ATTEND, attendance);
    status = 'ok';
  } else if (recClear.date === date && rec.ts <= recClear.ts) {
    // the Attendance Record was cleared after this student's first scan: they count again in the fresh list
    Object.assign(rec, { name: fullName(student), course: student.course, yearLevel: student.yearLevel || '', section: student.section || '', time: fmtTime(d), ts: d.getTime() });
    save(KEY_ATTEND, attendance);
    status = 'ok';
  }
  renderScanResult(student, status, rec);
  beep(status === 'ok');
}

function beep(good) {
  try {
    const A = window.AudioContext || window.webkitAudioContext;
    const ac = new A();
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = good ? 880 : 220;
    g.gain.value = 0.06;
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 0.14);
    o.onended = () => ac.close();
  } catch { /* no audio */ }
}

/* ---------- Registration ---------- */
let photoData = '';
let lastRegistered = null;

/* ---------- Photo cropper ---------- */
// The chosen picture opens in a crop window: drag to move, slider / wheel / pinch to zoom,
// button to rotate. The result is saved as a square 320px JPEG (shown as a circle in the app).
const CROP_VIEW = 300, PHOTO_OUT = 320;
let cropImg = null, cropUrl = '';          // picture currently in the crop window
let savedPhoto = null;                      // { img, url, state } last applied photo, so it can be re-cropped
const crop = { z: 1, x: 0, y: 0, r: 0 };    // zoom (1 = just fills the square), pan (px), rotation (quarter turns)
const cropCanvas = $('cropCanvas'), cropCtx = cropCanvas.getContext('2d');
cropCtx.imageSmoothingQuality = 'high';

const cropDims = () => (crop.r % 2 ? [cropImg.naturalHeight, cropImg.naturalWidth] : [cropImg.naturalWidth, cropImg.naturalHeight]);
const cropScale = () => { const [w, h] = cropDims(); return (CROP_VIEW / Math.min(w, h)) * crop.z; };
function clampCrop() { // the picture must always cover the whole square
  const [w, h] = cropDims(), s = cropScale();
  const mx = Math.max(0, (w * s - CROP_VIEW) / 2), my = Math.max(0, (h * s - CROP_VIEW) / 2);
  crop.x = Math.min(mx, Math.max(-mx, crop.x));
  crop.y = Math.min(my, Math.max(-my, crop.y));
}
function drawCrop(g, size) {
  const k = size / CROP_VIEW;
  g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); // transparent PNGs get a white background
  g.save();
  g.translate(size / 2 + crop.x * k, size / 2 + crop.y * k);
  g.rotate(crop.r * Math.PI / 2);
  const sc = cropScale() * k;
  g.scale(sc, sc);
  g.drawImage(cropImg, -cropImg.naturalWidth / 2, -cropImg.naturalHeight / 2);
  g.restore();
}
const renderCrop = () => { if (cropImg) drawCrop(cropCtx, CROP_VIEW); };
function setZoom(z) {
  crop.z = Math.min(4, Math.max(1, z));
  $('cropZoom').value = crop.z;
  clampCrop();
}

function openCropper(img, url, state) {
  cropImg = img; cropUrl = url;
  Object.assign(crop, state);
  $('cropZoom').value = crop.z;
  clampCrop(); renderCrop();
  animIn($('cropModal'));
  $('cropApply').focus();
}
function cancelCrop() {
  if (isGone($('cropModal'))) return;
  if (!savedPhoto || savedPhoto.url !== cropUrl) URL.revokeObjectURL(cropUrl); // a new, unused file
  cropImg = savedPhoto ? savedPhoto.img : null; cropUrl = savedPhoto ? savedPhoto.url : '';
  animOut($('cropModal'));
}
function applyCrop() {
  const c = document.createElement('canvas');
  c.width = c.height = PHOTO_OUT;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  drawCrop(g, PHOTO_OUT);
  photoData = c.toDataURL('image/jpeg', 0.88);
  if (savedPhoto && savedPhoto.url !== cropUrl) URL.revokeObjectURL(savedPhoto.url);
  savedPhoto = { img: cropImg, url: cropUrl, state: { ...crop } };
  $('photoPreview').src = photoData;
  $('photoPreview').hidden = false;
  $('photoHint').hidden = true;
  $('btnEditPhoto').hidden = false;
  $('formError').textContent = '';
  animOut($('cropModal'));
}
function discardPhotoSource() { // form was reset: forget the picture
  if (savedPhoto) URL.revokeObjectURL(savedPhoto.url);
  savedPhoto = null; cropImg = null; cropUrl = '';
  $('btnEditPhoto').hidden = true;
}

// drag to move, two fingers to pinch-zoom, wheel / slider to zoom
const cropStage = $('cropStage'), cropPtrs = new Map();
let pinchStart = 0, pinchZ = 1;
const pinchDist = () => { const [a, b] = [...cropPtrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
cropStage.addEventListener('pointerdown', (e) => {
  cropStage.setPointerCapture(e.pointerId);
  cropPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  cropStage.classList.add('dragging');
  if (cropPtrs.size === 2) { pinchStart = pinchDist(); pinchZ = crop.z; }
});
cropStage.addEventListener('pointermove', (e) => {
  const p = cropPtrs.get(e.pointerId);
  if (!p || !cropImg) return;
  const f = CROP_VIEW / cropStage.getBoundingClientRect().width;
  if (cropPtrs.size === 1) { crop.x += (e.clientX - p.x) * f; crop.y += (e.clientY - p.y) * f; }
  p.x = e.clientX; p.y = e.clientY;
  if (cropPtrs.size === 2 && pinchStart) setZoom(pinchZ * pinchDist() / pinchStart);
  clampCrop(); renderCrop();
});
const endCropPtr = (e) => { cropPtrs.delete(e.pointerId); pinchStart = 0; if (!cropPtrs.size) cropStage.classList.remove('dragging'); };
cropStage.addEventListener('pointerup', endCropPtr);
cropStage.addEventListener('pointercancel', endCropPtr);
cropStage.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(crop.z * Math.exp(-e.deltaY * 0.0015)); renderCrop(); }, { passive: false });
$('cropZoom').addEventListener('input', () => { setZoom(+$('cropZoom').value); renderCrop(); });
$('cropRotate').addEventListener('click', () => { crop.r = (crop.r + 1) % 4; clampCrop(); renderCrop(); });
$('cropApply').addEventListener('click', applyCrop);
$('cropCancel').addEventListener('click', cancelCrop);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancelCrop(); });

function nextStudentId() {
  const year = new Date().getFullYear();
  let max = 0;
  students.forEach((s) => { const m = /^PRS-\d{4}-(\d+)$/.exec(s.id); if (m) max = Math.max(max, +m[1]); });
  return `PRS-${year}-${String(max + 1).padStart(4, '0')}`;
}

function openRegister() {
  stopCamera();
  setActive('register');
  showRegister(true);
  $('formError').textContent = '';
  $('firstName').focus();
}

function resetForm() {
  $('registerForm').reset();
  photoData = '';
  discardPhotoSource();
  $('photoPreview').hidden = true;
  $('photoHint').hidden = false;
  document.querySelectorAll('.field input.bad, .seg.bad').forEach((i) => i.classList.remove('bad'));
  $('formError').textContent = '';
}

let registering = false;
async function onRegister(e) {
  e.preventDefault();
  const f = {
    firstName: $('firstName').value.trim(),
    lastName: $('lastName').value.trim(),
    course: $('course').value.trim(),
    section: $('section').value.trim(),
    sex: (document.querySelector('input[name="sex"]:checked') || {}).value || '',
    yearLevel: (document.querySelector('input[name="yearLevel"]:checked') || {}).value || '',
  };
  document.querySelectorAll('.field input, .seg').forEach((i) => i.classList.remove('bad'));
  const bad = [];
  if (!f.firstName) bad.push('firstName');
  if (!f.lastName) bad.push('lastName');
  if (!f.sex) bad.push('sexSeg');
  if (!f.course) bad.push('course');
  if (!f.yearLevel) bad.push('yearSeg');
  if (!f.section) bad.push('section');
  if (bad.length) {
    bad.forEach((id) => $(id).classList.add('bad'));
    $('formError').textContent = 'Please complete the highlighted fields.';
    const first = $(bad[0]);
    (first.querySelector('input') || first).focus();
    return;
  }
  if (!photoData) { $('formError').textContent = 'Please add the student’s photo.'; return; }
  if (students.some((s) => fullName(s).toLowerCase() === fullName(f).toLowerCase() && s.course.toLowerCase() === f.course.toLowerCase())) {
    $('firstName').classList.add('bad'); $('lastName').classList.add('bad');
    $('formError').textContent = 'This student is already registered in this course.';
    return;
  }
  // ask for confirmation before saving the student and generating the QR
  if (registering) return;
  registering = true;
  const confirmed = await confirmDialog('Register Student',
    'Are you sure you want to register this student?', 'Yes, Register', 'primary');
  registering = false;
  if (!confirmed) return;
  const student = { id: nextStudentId(), ...f, photo: photoData, registeredAt: Date.now() };
  try {
    students.push(student);
    save(KEY_STUDENTS, students);
  } catch (err) {
    students.pop();
    $('formError').textContent = 'Storage is full. Remove some students and try again.';
    return;
  }
  resetForm();
  showQRModal(student);
}

/* ---------- QR code drawing ---------- */
function qrPayload(s) { return s.id; } // just the Student ID

// Draws the QR ourselves with whole-pixel modules and a proper white quiet zone,
// so the PNG scans reliably from a phone screen or a printout.
function buildQRCanvas(text, outPx = 640, label = '') {
  const holder = document.createElement('div');
  const q = new QRCode(holder, { text, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.M });
  const model = q._oQRCode;
  if (!model || !model.getModuleCount) return holder.querySelector('canvas') || document.createElement('canvas');
  const n = model.getModuleCount(), quiet = 4;
  const scale = Math.max(2, Math.floor(outPx / (n + quiet * 2)));
  const size = (n + quiet * 2) * scale;
  const labelH = label ? scale * 3 : 0; // optional caption (the Student ID) under the code
  const c = document.createElement('canvas');
  c.width = size; c.height = size + labelH;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, size, size + labelH);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
    if (model.isDark(r, col)) g.fillRect((col + quiet) * scale, (r + quiet) * scale, scale, scale);
  }
  if (label) {
    g.font = `bold ${Math.round(scale * 1.6)}px Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, size / 2, size + labelH * 0.42);
  }
  return c;
}

function downloadCanvas(c, name) {
  const a = document.createElement('a');
  a.href = c.toDataURL('image/png'); a.download = name; a.click();
}

/* ---------- Registration confirmation modal ---------- */
function showQRModal(student) {
  lastRegistered = student;
  $('qrSubtitle').textContent = `${fullName(student)} — ${student.course} · ${student.yearLevel} · ${student.section} · ${student.sex}`;
  $('qrId').textContent = student.id;
  $('qrCode').innerHTML = '';
  $('qrCode').appendChild(buildQRCanvas(qrPayload(student)));
  animIn($('qrModal'));
}

function downloadQR() {
  const s = lastRegistered; if (!s) return;
  downloadCanvas(buildQRCanvas(qrPayload(s), 640, s.id), `${s.id}-QR.png`);
}

/* ---------- Events ---------- */
$('btnScan').addEventListener('click', startCamera);
$('btnStop').addEventListener('click', () => {
  stopCamera();
  if (!keepsPanel()) hidePanel(); // only a leftover scan result is cleared; lists/history stay open
  setActive(activeName(false));
  toast('Camera stopped.');
});
// Pressing a button again closes what it opened (no separate Back button needed)
const panelOpen = (kind) => panelKind === kind && !isGone($('sidePanel'));
$('btnStudents').addEventListener('click', () => {
  if (panelOpen('students')) { closePanel(); return; }
  setActive('students'); renderStudents();
});
$('btnRecord').addEventListener('click', () => {
  if (!isGone($('todayArea'))) { closeHistory(); return; }
  showToday();
});
$('btnClearRecord').addEventListener('click', clearRecord);
$('btnExportRecord').addEventListener('click', exportRecordCSV);
$('todayList').addEventListener('click', (e) => {
  const li = e.target.closest && e.target.closest('[data-open]');
  if (li) renderStudentDetail(li.dataset.open, 'history');
});
$('todayList').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const li = e.target.closest && e.target.closest('[data-open]');
  if (li && e.target === li) renderStudentDetail(li.dataset.open, 'history');
});
$('btnHistory').addEventListener('click', () => {
  if (!isGone($('calendarArea'))) { closeHistory(); return; }
  showCalendar();
});
// calendar controls
function setMonth(y, m) { const d = new Date(y, m, 1); cal.y = d.getFullYear(); cal.m = d.getMonth(); renderCalendar(); }
$('calPrev').addEventListener('click', () => setMonth(cal.y, cal.m - 1));
$('calNext').addEventListener('click', () => setMonth(cal.y, cal.m + 1));
$('calMonth').addEventListener('change', () => setMonth(cal.y, +$('calMonth').value));
$('calYear').addEventListener('change', () => setMonth(+$('calYear').value, cal.m));
$('calToday').addEventListener('click', () => { const d = new Date(); setMonth(d.getFullYear(), d.getMonth()); });
$('calGrid').addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('.cal-day');
  if (b) pickDate(b.dataset.date);
});
$('btnExport').addEventListener('click', exportCSV);
$('btnClearHistory').addEventListener('click', clearHistory);
$('btnRegister').addEventListener('click', () => {
  if (!isGone($('registerArea'))) { showRegister(false); setActive(scanning ? 'scan' : ''); return; }
  openRegister();
});
$('panelBack').addEventListener('click', () => { // only shown inside a student's details
  if (panelBackFn) { panelBackFn(); return; }
  closePanel();
});

$('panelBody').addEventListener('click', (e) => {
  const tog = e.target.closest && e.target.closest('[data-toggle]');
  if (tog) { // open / close a course's year levels without redrawing the list
    const card = tog.closest('.course-card'), willOpen = !card.classList.contains('open');
    $('panelBody').querySelectorAll('.course-card').forEach((c) => {
      c.classList.remove('open'); c.querySelector('.course-btn').setAttribute('aria-expanded', 'false');
    });
    card.classList.toggle('open', willOpen);
    tog.setAttribute('aria-expanded', willOpen);
    histState.open = willOpen ? tog.dataset.toggle : null;
    histState.openYear = null;
    card.querySelectorAll('.year-block').forEach((yb) => { yb.classList.remove('open'); const t = yb.querySelector('[data-ytoggle]'); if (t) t.setAttribute('aria-expanded', 'false'); });
    return;
  }
  const ytog = e.target.closest && e.target.closest('[data-ytoggle]');
  if (ytog) { // open / close the sections of a year level
    const block = ytog.closest('.year-block'), willOpen = !block.classList.contains('open');
    block.closest('.course-card').querySelectorAll('.year-block').forEach((yb) => {
      yb.classList.remove('open'); const t = yb.querySelector('[data-ytoggle]'); if (t) t.setAttribute('aria-expanded', 'false');
    });
    block.classList.toggle('open', willOpen);
    ytog.setAttribute('aria-expanded', willOpen);
    histState.openYear = willOpen ? ytog.dataset.ytoggle : null;
    return;
  }
  const dateRow = e.target.closest && e.target.closest('[data-date]');
  if (dateRow) { showCalendar(dateRow.dataset.date); return; }
  const chip = e.target.closest && e.target.closest('[data-year]');
  if (chip) { renderRecord(chip.dataset.course, chip.dataset.year, chip.dataset.section ?? null); return; }
  const del = e.target.closest && e.target.closest('[data-del]');
  if (del) {
    removeStudent(del.dataset.del, () => renderStudents($('studentSearch') ? $('studentSearch').value : ''));
    return;
  }
  const open = e.target.closest && e.target.closest('[data-open]');
  if (open) renderStudentDetail(open.dataset.open, panelKind === 'history' ? 'history' : 'students');
});
$('panelBody').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.tagName === 'INPUT') return;
  const dr = e.target.closest && e.target.closest('[data-date]');
  if (dr && e.target === dr) { showCalendar(dr.dataset.date); return; }
  const open = e.target.closest && e.target.closest('[data-open]');
  if (open && e.target === open) renderStudentDetail(open.dataset.open, panelKind === 'history' ? 'history' : 'students');
});

$('btnPickPhoto').addEventListener('click', () => $('photoInput').click());
$('photoInput').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  e.target.value = ''; // so choosing the same file again still triggers this
  if (!file.type.startsWith('image/')) { $('formError').textContent = 'Please choose an image file.'; return; }
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => openCropper(img, url, { z: 1, x: 0, y: 0, r: 0 });
  img.onerror = () => { URL.revokeObjectURL(url); $('formError').textContent = 'That image could not be read.'; };
  img.src = url;
});
$('btnEditPhoto').addEventListener('click', () => { if (savedPhoto) openCropper(savedPhoto.img, savedPhoto.url, savedPhoto.state); });
$('registerForm').addEventListener('submit', onRegister);
$('btnCancelReg').addEventListener('click', () => { resetForm(); setActive(''); showRegister(false); hidePanel(); });

$('btnDownloadQR').addEventListener('click', downloadQR);
$('btnCloseQR').addEventListener('click', () => {
  animOut($('qrModal'));
  setActive('students'); renderStudents();
});

window.addEventListener('beforeunload', stopCamera);

/* ---------- Init ---------- */
for (let m = 0; m < 12; m++) { const o = document.createElement('option'); o.value = m; o.textContent = monthName(m); $('calMonth').appendChild(o); }
[...document.querySelector('.controls').children].forEach((c, i) => c.style.setProperty('--i', i));
[...$('registerForm').children].forEach((c, i) => c.style.setProperty('--i', i));
if (!window.jsQR) ensureJsQR(); // pre-load the QR reader from a backup CDN if the main one failed
