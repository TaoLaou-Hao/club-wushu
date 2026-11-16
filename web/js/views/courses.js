// Cours : liste, création / édition (admin), habilités, inscrits.
import { sb, unwrap } from '../supabaseClient.js';
import { h, clear, button, field, selectEl, formModal, modal, confirmDialog, toast, showError, badge, emptyState } from '../dom.js';
import { isAdmin } from '../auth.js';
import { WEEKDAYS, hm, todayIso, fullName, byMemberName, norm } from '../util.js';

export async function renderCourses(root) {
  const [courses, instr, teachers, myMember] = await Promise.all([
    unwrap(sb.from('courses').select('id,name,description,level,location,weekday,start_time,end_time,start_date,end_date,active').order('weekday').order('start_time')),
    unwrap(sb.from('course_instructors').select('course_id,member_id,member:members(id,first_name,last_name)')),
    unwrap(sb.from('members').select('id,first_name,last_name,profile_id').eq('is_instructor', true).eq('active', true).is('anonymized_at', null).order('last_name').order('first_name')),
    sb.rpc('my_member_id').then(({ data, error }) => { if (error) throw error; return data || null; }),
  ]);
  const instrBy = new Map();
  for (const r of instr) {
    if (!instrBy.has(r.course_id)) instrBy.set(r.course_id, []);
    instrBy.get(r.course_id).push(r);
  }
  const reload = () => { clear(root); return renderCourses(root); };

  root.append(h('div', { class: 'row-between' }, h('h1', {}, 'Cours'),
    isAdmin() ? button('Nouveau cours', () => courseForm(null, [], teachers, reload), 'btn-primary') : null));
  if (!courses.length) root.append(emptyState('Aucun cours pour le moment.'));

  const grid = h('div', { class: 'cards' });
  for (const c of courses) {
    const list = instrBy.get(c.id) || [];
    const canManage = isAdmin() || (!!myMember && list.some((r) => r.member_id === myMember));
    grid.appendChild(h('article', { class: 'card course' + (c.active ? '' : ' inactive') },
      h('div', { class: 'row-between' }, h('h2', {}, c.name), badge(c.active ? 'Actif' : 'Inactif', c.active ? 'badge-ok' : 'badge-off')),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Jour'), h('dd', {}, WEEKDAYS[c.weekday - 1]),
        h('dt', {}, 'Horaire'), h('dd', {}, `${hm(c.start_time)}–${hm(c.end_time)}`),
        h('dt', {}, 'Lieu'), h('dd', {}, c.location || '—'),
        h('dt', {}, 'Niveau'), h('dd', {}, c.level || '—'),
        h('dt', {}, 'Habilités'), h('dd', {}, list.length ? list.map((r) => (r.member ? fullName(r.member) : 'Sans nom')).join(', ') : 'Aucun')),
      c.description ? h('p', { class: 'muted' }, c.description) : null,
      h('div', { class: 'btn-row' },
        canManage ? button('Inscrits', () => enrolModal(c)) : null,
        isAdmin() ? button('Modifier', () => courseForm(c, list.map((r) => r.member_id), teachers, reload)) : null,
        isAdmin() ? button('Supprimer', () => deleteCourse(c, reload), 'btn-danger-outline') : null)));
  }
  root.append(grid);
}

async function deleteCourse(c, reload) {
  if (!(await confirmDialog({ title: 'Supprimer le cours', message: `Supprimer « ${c.name} » ? Toutes ses séances et présences seront supprimées définitivement.`, confirmLabel: 'Supprimer', danger: true }))) return;
  try {
    await unwrap(sb.from('courses').delete().eq('id', c.id));
    toast('Cours supprimé.', 'success');
    reload();
  } catch (e) { showError(e); }
}

function courseForm(c, currentInstr, teachers, reload) {
  const name = h('input', { type: 'text', required: true, maxlength: 100, value: c ? c.name : '' });
  const desc = h('textarea', { rows: 2, maxlength: 1000 }); desc.value = c && c.description ? c.description : '';
  const level = h('input', { type: 'text', maxlength: 60, value: c && c.level ? c.level : '' });
  const loc = h('input', { type: 'text', maxlength: 120, value: c && c.location ? c.location : '' });
  const wd = selectEl(WEEKDAYS.map((w, i) => [String(i + 1), w]), c ? String(c.weekday) : '1', { required: true });
  const st = h('input', { type: 'time', required: true, value: c ? hm(c.start_time) : '19:00' });
  const en = h('input', { type: 'time', required: true, value: c ? hm(c.end_time) : '20:30' });
  const sd = h('input', { type: 'date', required: true, value: c ? c.start_date : todayIso() });
  const ed = h('input', { type: 'date', value: c && c.end_date ? c.end_date : '' });
  const act = h('input', { type: 'checkbox', checked: c ? c.active : true });
  const chosen = new Set(currentInstr);
  const boxes = h('div', { class: 'checklist' }, teachers.map((p) => {
    const cb = h('input', { type: 'checkbox', checked: chosen.has(p.id), onchange: () => { cb.checked ? chosen.add(p.id) : chosen.delete(p.id); } });
    return h('label', { class: 'check' }, cb, ' ', fullName(p), p.profile_id ? '' : h('small', { class: 'muted' }, ' (sans compte)'));
  }));
  formModal({
    title: c ? 'Modifier le cours' : 'Nouveau cours', wide: true,
    body: [
      field('Nom', name), field('Description', desc), field('Niveau', level), field('Lieu', loc),
      field('Jour', wd), field('Début', st), field('Fin', en), field('Date de début', sd),
      field('Date de fin (facultative)', ed),
      h('label', { class: 'check' }, act, ' Cours actif'),
      h('fieldset', { class: 'fieldset' }, h('legend', {}, 'Personnes habilitées à enseigner'), teachers.length ? boxes : h('p', { class: 'muted' }, 'Aucun enseignant : cochez « Enseignant » sur une fiche membre.')),
    ],
    onSubmit: async () => {
      if (en.value <= st.value) throw new Error('L’heure de fin doit être après l’heure de début.');
      const row = {
        name: name.value.trim(), description: desc.value.trim() || null, level: level.value.trim() || null,
        location: loc.value.trim() || null, weekday: Number(wd.value), start_time: st.value, end_time: en.value,
        start_date: sd.value, end_date: ed.value || null, active: act.checked,
      };
      let id = c && c.id;
      if (c) await unwrap(sb.from('courses').update(row).eq('id', id));
      else id = (await unwrap(sb.from('courses').insert(row).select('id').single())).id;
      // Synchronisation des habilités (ajouts / retraits)
      const old = new Set(currentInstr);
      const add = [...chosen].filter((x) => !old.has(x)).map((member_id) => ({ course_id: id, member_id }));
      const del = [...old].filter((x) => !chosen.has(x));
      if (del.length) await unwrap(sb.from('course_instructors').delete().eq('course_id', id).in('member_id', del));
      if (add.length) await unwrap(sb.from('course_instructors').insert(add));
      toast('Cours enregistré.', 'success');
      const was = (k) => (k === 'start_time' || k === 'end_time' ? hm(c[k]) : c[k]) ?? '';
      const changed = !c || ['weekday', 'start_time', 'end_time', 'start_date', 'end_date', 'active']
        .some((k) => String(was(k)) !== String(row[k] ?? ''));
      reload();
      if (changed) offerResync(id);
    },
  });
}

async function offerResync(courseId) {
  const ok = await confirmDialog({
    title: 'Réaligner les séances futures ?',
    message: 'L’horaire ou la période du cours a changé. Voulez-vous supprimer les séances futures vides (sans présence ni compte rendu) et les régénérer sur 12 semaines ?',
    confirmLabel: 'Réaligner',
  });
  if (!ok) return;
  try {
    const { data, error } = await sb.rpc('resync_course_sessions', { p_course_id: courseId, p_weeks: 12 });
    if (error) throw error;
    toast(`${data} séance(s) créée(s).`, 'success');
  } catch (e) { showError(e); }
}

// ----- Inscrits d'un cours -----
async function enrolModal(course) {
  let enrolled, all;
  try {
    [enrolled, all] = await Promise.all([
      unwrap(sb.from('course_members').select('member:members(id,first_name,last_name,active,anonymized_at)').eq('course_id', course.id)),
      unwrap(sb.from('members').select('id,first_name,last_name').eq('active', true).is('anonymized_at', null).order('last_name')),
    ]);
  } catch (e) { showError(e); return; }
  const ids = new Map(enrolled.filter((r) => r.member).map((r) => [r.member.id, r.member]));
  const q = h('input', { type: 'search', placeholder: 'Rechercher un membre à inscrire…', autocomplete: 'off' });
  const enrolledBox = h('ul', { class: 'pick-list' });
  const resBox = h('ul', { class: 'pick-list' });

  async function add(m) {
    try {
      await unwrap(sb.from('course_members').insert({ course_id: course.id, member_id: m.id }));
      ids.set(m.id, m); draw();
    } catch (e) { showError(e); }
  }
  async function remove(m) {
    try {
      await unwrap(sb.from('course_members').delete().eq('course_id', course.id).eq('member_id', m.id));
      ids.delete(m.id); draw();
    } catch (e) { showError(e); }
  }
  function draw() {
    clear(enrolledBox); clear(resBox);
    const cur = [...ids.values()].sort(byMemberName);
    if (!cur.length) enrolledBox.appendChild(h('li', { class: 'muted' }, 'Aucun inscrit.'));
    for (const m of cur) {
      enrolledBox.appendChild(h('li', { class: 'row-between' }, h('span', {}, fullName(m), m.active ? '' : ' (inactif)'),
        button('Retirer', () => remove(m), 'btn-sm btn-danger-outline', { 'aria-label': `Retirer ${fullName(m)}` })));
    }
    const t = norm(q.value);
    const found = all.filter((m) => !ids.has(m.id) && (!t || norm(fullName(m)).includes(t) || norm(`${m.last_name} ${m.first_name}`).includes(t))).slice(0, 8);
    for (const m of found) resBox.appendChild(h('li', {}, button(`+ ${fullName(m)}`, () => add(m), 'btn-block btn-left')));
  }
  q.addEventListener('input', draw);
  draw();
  const m = modal({
    title: `Inscrits – ${course.name}`, wide: true,
    content: h('div', {}, h('h3', {}, 'Inscrits'), enrolledBox, h('h3', {}, 'Ajouter'), field('Recherche', q), resBox),
    actions: [button('Fermer', () => m.close(), 'btn-primary')],
  });
}
