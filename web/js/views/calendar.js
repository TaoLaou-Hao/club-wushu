// Calendrier : vue semaine / mois, filtres, génération des séances (admin).
import { sb, unwrap } from '../supabaseClient.js';
import { h, clear, button, field, selectEl, formModal, toast, showError, loading, emptyState, badge } from '../dom.js';
import { isAdmin } from '../auth.js';
import { fullName, iso, todayIso, parseDate, addDays, mondayOf, fmtDay, fmtMonth, fmtShort, hm, WEEKDAYS, STATUS_LABEL, downloadIcs } from '../util.js';

// Préférences de vue conservées en mémoire seulement (pas de localStorage).
const view = { mode: 'week', anchor: new Date(), course: '', mine: false };

export async function renderCalendar(root) {
  const [courses, myMemberId] = await Promise.all([
    unwrap(sb.from('courses').select('id,name').order('name')),
    sb.rpc('my_member_id').then(({ data, error }) => { if (error) throw error; return data || null; }),
  ]);
  const mineRows = myMemberId ? await unwrap(sb.from('course_instructors').select('course_id').eq('member_id', myMemberId)) : [];
  const myIds = mineRows.map((r) => r.course_id);

  const title = h('h1', { class: 'cal-title', 'aria-live': 'polite' });
  const body = h('div');
  const courseSel = selectEl([['', 'Tous les cours'], ...courses.map((c) => [c.id, c.name])], view.course, {
    onchange: () => { view.course = courseSel.value; load(); }, 'aria-label': 'Filtrer par cours',
  });
  const mineCb = h('input', { type: 'checkbox', checked: view.mine, onchange: () => { view.mine = mineCb.checked; load(); } });
  const modeBtn = (m, label) => h('button', {
    type: 'button', class: 'seg' + (view.mode === m ? ' active' : ''), 'aria-pressed': String(view.mode === m),
    onclick: () => { view.mode = m; syncSeg(); load(); },
  }, label);
  const segWeek = modeBtn('week', 'Semaine');
  const segMonth = modeBtn('month', 'Mois');
  function syncSeg() {
    [[segWeek, 'week'], [segMonth, 'month']].forEach(([b, m]) => {
      b.classList.toggle('active', view.mode === m);
      b.setAttribute('aria-pressed', String(view.mode === m));
    });
  }
  function shift(dir) {
    const a = view.anchor;
    view.anchor = view.mode === 'week' ? addDays(a, 7 * dir) : new Date(a.getFullYear(), a.getMonth() + dir, 1);
    load();
  }

  root.append(
    h('div', { class: 'toolbar' },
      h('div', { class: 'toolbar-group' },
        button('‹', () => shift(-1), 'btn-icon', { 'aria-label': 'Précédent' }),
        button('Aujourd’hui', () => { view.anchor = new Date(); load(); }),
        button('›', () => shift(1), 'btn-icon', { 'aria-label': 'Suivant' })),
      h('div', { class: 'seg-group', role: 'group', 'aria-label': 'Affichage' }, segWeek, segMonth),
      button('Exporter (.ics)', exportIcs),
      isAdmin() ? button('Générer les séances', () => generateModal(load), 'btn-primary') : null),
    title,
    h('div', { class: 'toolbar filters' },
      h('div', { class: 'field inline' }, h('label', { for: 'f-course' }, 'Cours'), (courseSel.id = 'f-course', courseSel)),
      h('label', { class: 'check' }, mineCb, ' Mes cours')),
    h('div', { class: 'legend' },
      ...['planned', 'done', 'cancelled'].map((s) => h('span', { class: 'legend-item st-' + s }, STATUS_LABEL[s]))),
    body);

  // Export : séances non annulées des 8 prochaines semaines, selon les filtres actifs
  async function exportIcs() {
    try {
      let q = sb.from('sessions')
        .select('id,date,start_time,end_time,status,course:courses(name,location)')
        .gte('date', todayIso()).lte('date', iso(addDays(new Date(), 56))).neq('status', 'cancelled')
        .order('date').order('start_time');
      if (view.course) q = q.eq('course_id', view.course);
      if (view.mine) q = q.in('course_id', myIds.length ? myIds : ['00000000-0000-0000-0000-000000000000']);
      const rows = await unwrap(q);
      if (!rows.length) { toast('Aucune séance à exporter.', 'info'); return; }
      downloadIcs(rows.map((s) => ({ uid: s.id, date: s.date, start: s.start_time, end: s.end_time, title: s.course ? s.course.name : 'Cours', location: s.course && s.course.location })), 'seances-club.ics');
      toast(`${rows.length} séance(s) exportée(s).`, 'success');
    } catch (e) { showError(e); }
  }

  let seq = 0;
  async function load() {
    const my = ++seq;
    const a = view.anchor;
    let from, to;
    if (view.mode === 'week') { from = mondayOf(a); to = addDays(from, 6); }
    else { from = mondayOf(new Date(a.getFullYear(), a.getMonth(), 1)); to = addDays(from, 41); }
    title.textContent = view.mode === 'week'
      ? `Semaine du ${fmtShort(from)} au ${fmtShort(to)}`
      : fmtMonth(a);
    clear(body).appendChild(loading());
    try {
      let q = sb.from('sessions')
        .select('id,date,start_time,end_time,status,course_id,instructor_id,course:courses(name,location,level),instructor:members!sessions_instructor_id_fkey(id,first_name,last_name)')
        .gte('date', iso(from)).lte('date', iso(to))
        .order('date').order('start_time');
      if (view.course) q = q.eq('course_id', view.course);
      if (view.mine) q = q.in('course_id', myIds.length ? myIds : ['00000000-0000-0000-0000-000000000000']);
      const sessions = await unwrap(q);
      if (my !== seq) return;
      clear(body).appendChild(view.mode === 'week' ? weekView(from, sessions) : monthView(from, a, sessions));
    } catch (e) {
      if (my !== seq) return;
      clear(body);
      showError(e);
      body.appendChild(emptyState('Impossible de charger les séances.'));
    }
  }
  await load();
}

function groupByDate(sessions) {
  const map = new Map();
  for (const s of sessions) {
    if (!map.has(s.date)) map.set(s.date, []);
    map.get(s.date).push(s);
  }
  return map;
}

function sessionCard(s) {
  return h('a', { class: `sess st-${s.status}`, href: `#/seance/${s.id}` },
    h('span', { class: 'sess-time' }, `${hm(s.start_time)}–${hm(s.end_time)}`),
    h('span', { class: 'sess-name' }, s.course ? s.course.name : 'Cours'),
    h('span', { class: 'sess-instr' }, s.instructor ? fullName(s.instructor) : 'Aucun intervenant'),
    s.status !== 'planned' ? badge(STATUS_LABEL[s.status], 'st-' + s.status) : null);
}

function weekView(monday, sessions) {
  const by = groupByDate(sessions);
  const today = todayIso();
  const grid = h('div', { class: 'week' });
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const key = iso(d);
    const list = by.get(key) || [];
    grid.appendChild(h('section', { class: 'day' + (key === today ? ' today' : '') + (list.length ? '' : ' empty-day'), 'aria-label': fmtDay(d) },
      h('h3', {}, fmtDay(d)),
      list.length ? list.map(sessionCard) : h('p', { class: 'muted small' }, 'Aucune séance')));
  }
  return grid;
}

function monthView(gridStart, anchor, sessions) {
  const by = groupByDate(sessions);
  const today = todayIso();
  const grid = h('div', { class: 'month', role: 'grid' });
  WEEKDAYS.forEach((w) => grid.appendChild(h('div', { class: 'mhead', role: 'columnheader' }, w.slice(0, 3) + '.')));
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const key = iso(d);
    const list = by.get(key) || [];
    const other = d.getMonth() !== anchor.getMonth();
    grid.appendChild(h('div', { class: 'mcell' + (other ? ' other' : '') + (key === today ? ' today' : ''), role: 'gridcell' },
      h('button', {
        type: 'button', class: 'mday', 'aria-label': `${fmtDay(d)} : voir la semaine`,
        onclick: () => { view.anchor = d; view.mode = 'week'; window.dispatchEvent(new HashChangeEvent('hashchange')); },
      }, String(d.getDate())),
      list.map((s) => h('a', {
        class: `mentry st-${s.status}`, href: `#/seance/${s.id}`,
        title: `${hm(s.start_time)} ${s.course ? s.course.name : ''} – ${STATUS_LABEL[s.status]}`,
        'aria-label': `${hm(s.start_time)} ${s.course ? s.course.name : ''}, ${STATUS_LABEL[s.status]}`,
      }, h('span', { class: 'mt' }, hm(s.start_time)), ' ', h('span', { class: 'mname' }, s.course ? s.course.name : '')))));
  }
  return grid;
}

function generateModal(reload) {
  const from = h('input', { type: 'date', required: true, value: todayIso() });
  const to = h('input', { type: 'date', required: true, value: iso(addDays(new Date(), 84)) });
  formModal({
    title: 'Générer les séances',
    submitLabel: 'Générer',
    body: [
      h('p', { class: 'muted' }, 'Crée les séances manquantes des cours actifs sur la période (les séances existantes ne sont pas modifiées). 366 jours maximum.'),
      field('Du', from), field('Au', to),
    ],
    onSubmit: async () => {
      const { data, error } = await sb.rpc('generate_sessions', { p_from: from.value, p_to: to.value });
      if (error) throw error;
      toast(`${data} séance(s) créée(s).`, 'success');
      reload();
    },
  });
}
