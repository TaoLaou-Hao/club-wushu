// Statistiques (enseignants et administrateurs) : présence, assiduité, techniques, export CSV.
import { sb, unwrap } from '../supabaseClient.js';
import { h, clear, button, selectEl, showError, toast, loading, emptyState } from '../dom.js';
import { isAdmin } from '../auth.js';
import { iso, todayIso, addDays, parseDate, fmtShort, fullName, downloadCsv } from '../util.js';

const PERIODS = [['28', '4 semaines'], ['91', '3 mois'], ['365', '12 mois']];
const PAGE = 1000;
const CHUNK = 200;
const LOOKBACK = 365;

// Lit toutes les lignes d'une requête par pages de 1000.
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const rows = await unwrap(build().range(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
const chunks = (arr, n) => { const r = []; for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n)); return r; };
const pct = (x) => `${Math.round(x * 100)} %`;
const avg = (a, b) => (b ? Math.round((a / b) * 10) / 10 : 0);

export async function renderStats(root) {
  root.append(h('h1', {}, 'Statistiques'), loading());
  let data;
  try { data = await loadData(); } catch (e) { clear(root); root.append(h('h1', {}, 'Statistiques')); showError(e); root.append(emptyState('Chargement impossible.')); return; }
  clear(root);
  const { courses } = data;
  const view = { period: '91', course: '' };

  const body = h('div');
  const periodSel = selectEl(PERIODS, view.period, { 'aria-label': 'Période', onchange: () => { view.period = periodSel.value; draw(); } });
  const courseSel = selectEl([['', isAdmin() ? 'Tous les cours' : 'Tous mes cours'], ...courses.map((c) => [c.id, c.name])], '',
    { 'aria-label': 'Cours', onchange: () => { view.course = courseSel.value; draw(); } });
  root.append(h('h1', {}, 'Statistiques'),
    h('div', { class: 'toolbar filters' },
      h('div', { class: 'field inline' }, h('label', { for: 'st-period' }, 'Période'), (periodSel.id = 'st-period', periodSel)),
      h('div', { class: 'field inline' }, h('label', { for: 'st-course' }, 'Cours'), (courseSel.id = 'st-course', courseSel)),
      button('Exporter les présences (CSV)', () => exportCsv(data, view), '', { 'aria-label': 'Exporter les présences au format CSV' })),
    body);

  function draw() { clear(body).appendChild(compute(data, view)); }
  draw();
}

async function loadData() {
  const { data: myId, error: me } = await sb.rpc('my_member_id');
  if (me) throw me;
  let courses = await unwrap(sb.from('courses').select('id,name').order('name'));
  if (!isAdmin()) {
    const mine = myId ? await unwrap(sb.from('course_instructors').select('course_id').eq('member_id', myId)) : [];
    const ids = new Set(mine.map((r) => r.course_id));
    courses = courses.filter((c) => ids.has(c.id));
  }
  const courseIds = courses.map((c) => c.id);
  const empty = { courses, sessions: [], att: new Map(), enrolled: new Map(), techs: [], sTechs: new Map(), members: new Map() };
  if (!courseIds.length) return empty;

  const since = iso(addDays(new Date(), -LOOKBACK));
  const [sessions, cm, techs] = await Promise.all([
    fetchAll(() => sb.from('sessions').select('id,course_id,date').eq('status', 'done').gte('date', since).lte('date', todayIso()).in('course_id', courseIds).order('date').order('id')),
    fetchAll(() => sb.from('course_members').select('course_id,member:members(id,first_name,last_name,active,anonymized_at)').in('course_id', courseIds).order('course_id').order('member_id')),
    unwrap(sb.from('techniques').select('id,name').order('name')),
  ]);
  const enrolled = new Map(); // course_id -> [member]
  const members = new Map();
  for (const r of cm) {
    if (!r.member) continue;
    if (!enrolled.has(r.course_id)) enrolled.set(r.course_id, []);
    enrolled.get(r.course_id).push(r.member);
    members.set(r.member.id, r.member);
  }
  const att = new Map(); // session_id -> Map(member_id -> present)
  const sTechs = new Map(); // session_id -> [technique_id]
  const sids = sessions.map((s) => s.id);
  for (const part of chunks(sids, CHUNK)) {
    const [a, t] = await Promise.all([
      fetchAll(() => sb.from('attendance').select('session_id,member_id,present,member:members(id,first_name,last_name,active,anonymized_at)').in('session_id', part).order('session_id').order('member_id')),
      fetchAll(() => sb.from('session_techniques').select('session_id,technique_id').in('session_id', part).order('session_id').order('technique_id')),
    ]);
    for (const r of a) {
      if (!att.has(r.session_id)) att.set(r.session_id, new Map());
      att.get(r.session_id).set(r.member_id, r.present === true);
      if (r.member) members.set(r.member.id, r.member);
    }
    for (const r of t) {
      if (!sTechs.has(r.session_id)) sTechs.set(r.session_id, []);
      sTechs.get(r.session_id).push(r.technique_id);
    }
  }
  return { courses, sessions, att, enrolled, techs, sTechs, members };
}

function selection(data, view) {
  const cs = view.course ? data.courses.filter((c) => c.id === view.course) : data.courses;
  const ids = new Set(cs.map((c) => c.id));
  const from = iso(addDays(new Date(), -Number(view.period)));
  const all = data.sessions.filter((s) => ids.has(s.course_id));
  return { cs, ids, all, inPeriod: all.filter((s) => s.date >= from) };
}

function bar(value, label) {
  return h('div', { class: 'stat-bar', role: 'img', 'aria-label': label },
    h('span', { style: { width: `${Math.max(0, Math.min(100, Math.round(value * 100)))}%` } }));
}

function section(title, ...content) { return h('section', { class: 'card' }, h('h2', {}, title), ...content); }

function compute(data, view) {
  const { cs, all, inPeriod } = selection(data, view);
  const box = h('div');
  if (!cs.length) return emptyState(isAdmin() ? 'Aucun cours.' : 'Vous n’enseignez aucun cours pour le moment.');
  if (!inPeriod.length) { box.append(emptyState('Aucune séance terminée sur cette période.')); }

  const presentIn = (s) => { const m = data.att.get(s.id); return m ? [...m.values()].filter(Boolean).length : 0; };
  const enrolCount = (cid) => (data.enrolled.get(cid) || []).filter((m) => m.active && !m.anonymized_at).length;

  // KPI
  const totalPresent = inPeriod.reduce((n, s) => n + presentIn(s), 0);
  let numer = 0, denom = 0;
  for (const s of inPeriod) { const e = enrolCount(s.course_id); if (e > 0) { numer += Math.min(presentIn(s), e); denom += e; } }
  if (inPeriod.length) {
    box.append(h('div', { class: 'kpis' },
      kpi(String(inPeriod.length), 'Séances données'),
      kpi(String(totalPresent), 'Présences totales'),
      kpi(String(avg(totalPresent, inPeriod.length)).replace('.', ','), 'Présents par séance'),
      kpi(denom ? pct(numer / denom) : '—', 'Taux de présence moyen')));

    // Par cours
    const list = h('ul', { class: 'plain-list' });
    for (const c of cs) {
      const ss = inPeriod.filter((s) => s.course_id === c.id);
      if (!ss.length) continue;
      const tp = ss.reduce((n, s) => n + presentIn(s), 0);
      const e = enrolCount(c.id);
      const rate = e ? Math.min(1, tp / ss.length / e) : 0;
      list.appendChild(h('li', {},
        h('div', { class: 'row-between' }, h('strong', {}, c.name), h('span', { class: 'muted small' }, e ? pct(rate) : '—')),
        h('p', { class: 'muted small' }, `${ss.length} séance${ss.length > 1 ? 's' : ''} · ${String(avg(tp, ss.length)).replace('.', ',')} présents en moyenne · ${e} inscrit${e > 1 ? 's' : ''}`),
        e ? bar(rate, `Taux de présence ${pct(rate)}`) : null));
    }
    box.append(section('Par cours', list));

    // Assidus
    const counts = new Map();
    for (const s of inPeriod) for (const [mid, p] of data.att.get(s.id) || []) if (p) counts.set(mid, (counts.get(mid) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).filter(([mid]) => data.members.get(mid));
    box.append(section('Assidus', top.length
      ? h('ol', { class: 'plain-list stat-rank' }, top.map(([mid, n]) => h('li', { class: 'row-between' },
        h('a', { href: `#/membre/${mid}` }, nameOf(data.members.get(mid))), h('span', { class: 'muted' }, `${n} présence${n > 1 ? 's' : ''}`))))
      : emptyState('Aucune présence enregistrée.')));

    // Techniques
    const tc = new Map();
    for (const s of inPeriod) for (const t of new Set(data.sTechs.get(s.id) || [])) tc.set(t, (tc.get(t) || 0) + 1);
    const worked = data.techs.filter((t) => tc.has(t.id)).sort((a, b) => tc.get(b.id) - tc.get(a.id));
    const unworked = data.techs.filter((t) => !tc.has(t.id));
    const max = worked.length ? tc.get(worked[0].id) : 1;
    box.append(section('Techniques travaillées',
      worked.length ? h('ul', { class: 'plain-list' }, worked.map((t) => h('li', {},
        h('div', { class: 'row-between' }, h('span', {}, t.name), h('span', { class: 'muted small' }, `${tc.get(t.id)} séance${tc.get(t.id) > 1 ? 's' : ''}`)),
        bar(tc.get(t.id) / max, `${t.name} : ${tc.get(t.id)} séances`))))
        : emptyState('Aucune technique renseignée sur cette période.'),
      h('h3', {}, 'Peu travaillées'),
      unworked.length ? h('p', { class: 'muted' }, unworked.map((t) => t.name).join(', ')) : h('p', { class: 'muted' }, 'Toutes les techniques ont été travaillées.')));
  }

  // À relancer (fenêtre de 12 mois, indépendante de la période affichée)
  box.append(section('À relancer', relanceList(data, cs, all)));
  return box;
}

const nameOf = (m) => (m.anonymized_at ? 'Membre anonymisé' : fullName(m));
const kpi = (v, l) => h('div', { class: 'kpi' }, h('strong', { class: 'kpi-v' }, v), h('span', { class: 'kpi-l' }, l));

function relanceList(data, cs, sessions) {
  const today = parseDate(todayIso());
  const byCourse = new Map();
  for (const s of sessions) { if (!byCourse.has(s.course_id)) byCourse.set(s.course_id, []); byCourse.get(s.course_id).push(s); }
  const people = new Map(); // member_id -> {m, courseIds}
  for (const c of cs) for (const m of data.enrolled.get(c.id) || []) {
    if (!m.active || m.anonymized_at) continue;
    if (!people.has(m.id)) people.set(m.id, { m, cids: [] });
    people.get(m.id).cids.push(c.id);
  }
  const rows = [];
  for (const { m, cids } of people.values()) {
    const ss = cids.flatMap((cid) => byCourse.get(cid) || []).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    if (!ss.length) continue;
    let last = null, streak = 0, counting = true;
    for (const s of ss) {
      const p = (data.att.get(s.id) || new Map()).get(m.id) === true;
      if (p) { if (!last) last = s.date; counting = false; }
      else if (counting) streak++;
    }
    const days = last ? Math.round((today - parseDate(last)) / 86400000) : Infinity;
    if (days > 21 || streak >= 3) rows.push({ m, last, streak, days });
  }
  rows.sort((a, b) => (b.days === a.days ? b.streak - a.streak : b.days - a.days));
  if (!rows.length) return emptyState('Personne à relancer : tout le monde est assidu.');
  return h('div', {},
    h('p', { class: 'muted small' }, 'Dernière présence il y a plus de 21 jours, ou 3 absences consécutives (sur 12 mois).'),
    h('ul', { class: 'plain-list' }, rows.map((r) => h('li', { class: 'row-between' },
      h('a', { href: `#/membre/${r.m.id}` }, fullName(r.m)),
      h('span', { class: 'muted small' }, `${r.last ? fmtShort(r.last) : 'Jamais'} · ${r.streak} absence${r.streak > 1 ? 's' : ''} d’affilée`)))));
}

function exportCsv(data, view) {
  const { all, inPeriod } = selection(data, view);
  if (!inPeriod.length) { toast('Aucune séance à exporter sur cette période.', 'info'); return; }
  const cname = new Map(data.courses.map((c) => [c.id, c.name]));
  const rows = [['Date', 'Cours', 'Nom', 'Prénom', 'Présent']];
  for (const s of inPeriod) {
    const a = data.att.get(s.id) || new Map();
    const ids = new Set(a.keys());
    for (const m of data.enrolled.get(s.course_id) || []) if (m.active && !m.anonymized_at) ids.add(m.id);
    const list = [...ids].map((id) => data.members.get(id)).filter(Boolean)
      .sort((x, y) => x.last_name.localeCompare(y.last_name, 'fr') || x.first_name.localeCompare(y.first_name, 'fr'));
    for (const m of list) rows.push([s.date, cname.get(s.course_id) || '', m.last_name, m.first_name, a.get(m.id) === true ? 'oui' : 'non']);
  }
  void all;
  downloadCsv(rows, `presences-${todayIso()}.csv`);
  toast('Export téléchargé.', 'success');
}
