// Détail d'une séance : intervenant, présences, compte rendu, techniques, statut.
import { sb, unwrap } from '../supabaseClient.js';
import { h, clear, button, field, selectEl, formModal, confirmDialog, toast, showError, badge, emptyState } from '../dom.js';
import { state, isAdmin } from '../auth.js';
import { go } from '../router.js';
import { fmtLong, hm, STATUS_LABEL, fullName, byMemberName, norm } from '../util.js';

export async function renderSession(root, { id }) {
  const s = await unwrap(sb.from('sessions')
    .select('id,course_id,date,start_time,end_time,status,summary,notes,instructor_id,course:courses(id,name,location,level),instructor:profiles!sessions_instructor_id_fkey(full_name)')
    .eq('id', id).maybeSingle());
  if (!s) { root.appendChild(h('div', { class: 'card' }, emptyState('Séance introuvable.'), h('a', { class: 'btn', href: '#/calendrier' }, 'Retour au calendrier'))); return; }

  const [canRes, quals, enrolled, att, techs, sTechs] = await Promise.all([
    sb.rpc('can_manage_session', { p_session_id: id }),
    unwrap(sb.from('course_instructors').select('profile_id,profile:profiles(full_name)').eq('course_id', s.course_id)),
    unwrap(sb.from('course_members').select('member:members(id,first_name,last_name,active,anonymized_at)').eq('course_id', s.course_id)),
    unwrap(sb.from('attendance').select('member_id,present').eq('session_id', id)),
    unwrap(sb.from('techniques').select('id,name,category').order('name')),
    unwrap(sb.from('session_techniques').select('technique_id').eq('session_id', id)),
  ]);
  if (canRes.error) throw canRes.error;
  const canManage = canRes.data === true;
  const admin = isAdmin();

  // --- Modèle de la liste d'appel : inscrits actifs + déjà pointés ---
  const rows = new Map(); // member_id -> {m, present: true|false|null}
  for (const r of enrolled) {
    const m = r.member;
    if (m && m.active && !m.anonymized_at) rows.set(m.id, { m, present: null });
  }
  const extraIds = att.map((a) => a.member_id).filter((x) => !rows.has(x));
  if (extraIds.length) {
    const extra = await unwrap(sb.from('members').select('id,first_name,last_name,active,anonymized_at').in('id', extraIds));
    for (const m of extra) rows.set(m.id, { m, present: null });
  }
  for (const a of att) { const r = rows.get(a.member_id); if (r) r.present = a.present; }

  // --- Zones d'affichage ---
  const header = h('div', { class: 'card' });
  const instrBox = h('div', { class: 'card' });
  const attBox = h('div', { class: 'card' });
  const logBox = h('div', { class: 'card' });
  root.append(h('p', {}, h('a', { href: '#/calendrier' }, '‹ Calendrier')), header, instrBox, attBox, logBox);

  if (!canManage) root.insertBefore(h('p', { class: 'form-info' }, 'Lecture seule : vous n’êtes pas habilité à gérer cette séance.'), header);

  // ===== En-tête + statut =====
  function drawHeader() {
    clear(header);
    header.append(
      h('div', { class: 'row-between' },
        h('h1', {}, s.course ? s.course.name : 'Séance'),
        badge(STATUS_LABEL[s.status], 'st-' + s.status)),
      h('p', {}, fmtLong(s.date), ' · ', `${hm(s.start_time)}–${hm(s.end_time)}`),
      h('p', { class: 'muted' }, [s.course && s.course.location, s.course && s.course.level].filter(Boolean).join(' · ')));
    if (canManage) {
      header.append(h('div', { class: 'btn-row' },
        s.status !== 'done' ? button('Marquer terminée', () => setStatus('done'), 'btn-primary') : null,
        s.status !== 'cancelled' ? button('Annuler la séance', () => setStatus('cancelled'), 'btn-danger-outline') : null,
        s.status !== 'planned' ? button('Remettre en prévue', () => setStatus('planned')) : null));
    }
    if (admin) {
      header.append(h('div', { class: 'btn-row admin-zone' },
        button('Modifier date / horaire', editWhen),
        button('Supprimer la séance', deleteSession, 'btn-danger-outline')));
    }
  }
  async function setStatus(status) {
    if (status === 'cancelled' && !(await confirmDialog({ title: 'Annuler la séance', message: 'Voulez-vous vraiment marquer cette séance comme annulée ?', confirmLabel: 'Annuler la séance', danger: true }))) return;
    try {
      await unwrap(sb.from('sessions').update({ status }).eq('id', id));
      s.status = status;
      drawHeader();
      toast('Statut mis à jour.', 'success');
    } catch (e) { showError(e); }
  }
  function editWhen() {
    const d = h('input', { type: 'date', required: true, value: s.date });
    const st = h('input', { type: 'time', required: true, value: hm(s.start_time) });
    const en = h('input', { type: 'time', required: true, value: hm(s.end_time) });
    formModal({
      title: 'Modifier date et horaire',
      body: [field('Date', d), field('Début', st), field('Fin', en)],
      onSubmit: async () => {
        await unwrap(sb.from('sessions').update({ date: d.value, start_time: st.value, end_time: en.value }).eq('id', id));
        s.date = d.value; s.start_time = st.value; s.end_time = en.value;
        drawHeader();
        toast('Séance modifiée.', 'success');
      },
    });
  }
  async function deleteSession() {
    if (!(await confirmDialog({ title: 'Supprimer la séance', message: 'Cette séance et ses présences seront définitivement supprimées.', confirmLabel: 'Supprimer', danger: true }))) return;
    try {
      await unwrap(sb.from('sessions').delete().eq('id', id));
      toast('Séance supprimée.', 'success');
      go('/calendrier');
    } catch (e) { showError(e); }
  }

  // ===== Intervenant =====
  function drawInstructor() {
    clear(instrBox);
    instrBox.appendChild(h('h2', {}, 'Intervenant'));
    const sel = selectEl([['', 'Aucun intervenant'], ...quals.map((q) => [q.profile_id, q.profile ? q.profile.full_name || 'Sans nom' : 'Sans nom'])],
      s.instructor_id || '', { disabled: !canManage, 'aria-label': 'Intervenant' });
    sel.addEventListener('change', () => setInstructor(sel.value || null, sel));
    instrBox.appendChild(h('div', { class: 'btn-row' }, sel));
    const iAmQualified = quals.some((q) => q.profile_id === state.user.id);
    if (canManage && iAmQualified && s.instructor_id !== state.user.id) {
      instrBox.appendChild(h('div', { class: 'btn-row' }, button('Je prends ce cours', () => setInstructor(state.user.id), 'btn-primary')));
    }
    if (!quals.length) instrBox.appendChild(h('p', { class: 'muted small' }, 'Aucune personne habilitée pour ce cours (voir la page Cours).'));
  }
  async function setInstructor(pid) {
    try {
      await unwrap(sb.from('sessions').update({ instructor_id: pid }).eq('id', id));
      s.instructor_id = pid;
      toast('Intervenant mis à jour.', 'success');
    } catch (e) { showError(e); }
    drawInstructor();
  }

  // ===== Présences =====
  let allMembers = null; // chargé à la demande pour « ajouter un membre »
  const list = () => [...rows.values()].sort((a, b) => byMemberName(a.m, b.m));

  function drawAttendance() {
    clear(attBox);
    const items = list();
    const present = items.filter((r) => r.present === true).length;
    attBox.append(
      h('div', { class: 'row-between' },
        h('h2', {}, 'Présences'),
        h('span', { class: 'counter', 'aria-live': 'polite' }, `${present} présent${present > 1 ? 's' : ''} / ${items.length}`)));
    if (canManage) {
      attBox.append(h('div', { class: 'btn-row' },
        button('Tous présents', allPresent, 'btn-primary'),
        button('Ajouter un membre non inscrit', addMemberModal)));
    }
    if (!items.length) attBox.append(emptyState('Aucun membre inscrit à ce cours. Inscrivez-les depuis la page Cours.'));
    const ul = h('ul', { class: 'att-list' });
    for (const r of items) {
      const label = r.present === true ? 'Présent' : r.present === false ? 'Absent' : 'Non pointé';
      ul.appendChild(h('li', {},
        h('button', {
          type: 'button', class: 'att-row ' + (r.present === true ? 'is-present' : r.present === false ? 'is-absent' : 'is-unset'),
          'aria-pressed': String(r.present === true), disabled: !canManage,
          'aria-label': `${fullName(r.m)} : ${label}. Appuyer pour changer.`,
          onclick: () => mark([r.m.id], r.present !== true),
        }, h('span', { class: 'att-name' }, fullName(r.m)), h('span', { class: 'att-state' }, label))));
    }
    attBox.appendChild(ul);
  }
  async function mark(ids, present) {
    const before = ids.map((i) => [i, rows.get(i).present]);
    ids.forEach((i) => { rows.get(i).present = present; });
    drawAttendance();
    try {
      await unwrap(sb.from('attendance').upsert(ids.map((member_id) => ({ session_id: id, member_id, present })), { onConflict: 'session_id,member_id' }));
    } catch (e) {
      before.forEach(([i, p]) => { rows.get(i).present = p; });
      drawAttendance();
      showError(e);
    }
  }
  async function allPresent() {
    const ids = list().map((r) => r.m.id);
    if (ids.length) { await mark(ids, true); toast('Tous les membres sont marqués présents.', 'success'); }
  }
  async function addMemberModal() {
    try {
      if (!allMembers) {
        allMembers = await unwrap(sb.from('members').select('id,first_name,last_name').eq('active', true).is('anonymized_at', null).order('last_name'));
      }
    } catch (e) { showError(e); return; }
    const q = h('input', { type: 'search', placeholder: 'Rechercher un nom…', autocomplete: 'off' });
    const res = h('ul', { class: 'pick-list' });
    const m = formModal({ title: 'Ajouter un membre non inscrit', submitLabel: 'Fermer', body: [field('Recherche', q), res], onSubmit: async () => true });
    function draw() {
      clear(res);
      const t = norm(q.value);
      const found = allMembers.filter((x) => !rows.has(x.id) && (!t || norm(fullName(x)).includes(t) || norm(`${x.last_name} ${x.first_name}`).includes(t))).slice(0, 12);
      if (!found.length) res.appendChild(h('li', { class: 'muted' }, 'Aucun résultat.'));
      for (const x of found) {
        res.appendChild(h('li', {}, button(fullName(x), async () => {
          rows.set(x.id, { m: x, present: null });
          await mark([x.id], true);
          m.close();
        }, 'btn-block btn-left')));
      }
    }
    q.addEventListener('input', draw);
    draw();
  }

  // ===== Compte rendu =====
  const selected = new Set(sTechs.map((t) => t.technique_id));
  const techList = [...techs];
  function drawLog() {
    clear(logBox);
    const summary = h('textarea', { rows: 4, maxlength: 2000, disabled: !canManage }, '');
    summary.value = s.summary || '';
    const notes = h('textarea', { rows: 3, maxlength: 2000, disabled: !canManage }, '');
    notes.value = s.notes || '';
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Techniques travaillées' });
    for (const t of techList) {
      const on = selected.has(t.id);
      chips.appendChild(h('button', {
        type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), disabled: !canManage,
        onclick: () => toggleTech(t.id),
      }, (on ? '✓ ' : '') + t.name));
    }
    logBox.append(
      h('h2', {}, 'Compte rendu'),
      field('Ce qu’on a fait', summary),
      h('p', { class: 'hint' }, 'Techniques travaillées'),
      chips);
    if (canManage) {
      const nt = h('input', { type: 'text', maxlength: 100, placeholder: 'Nouvelle technique' });
      logBox.append(h('form', {
        class: 'inline-form',
        onsubmit: async (e) => {
          e.preventDefault();
          const name = nt.value.trim();
          if (!name) return;
          try {
            const row = await unwrap(sb.from('techniques').insert({ name }).select('id,name,category').single());
            techList.push(row); techList.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
            await unwrap(sb.from('session_techniques').insert({ session_id: id, technique_id: row.id }));
            selected.add(row.id);
            toast('Technique ajoutée.', 'success');
            drawLog();
          } catch (err) { showError(err); }
        },
      }, h('label', { class: 'sr-only', for: 'new-tech' }, 'Nouvelle technique'), (nt.id = 'new-tech', nt), h('button', { type: 'submit', class: 'btn' }, 'Ajouter la technique')));
    }
    logBox.append(
      field('Remarques', notes),
      h('p', { class: 'warn' }, 'Ne pas saisir d’information de santé ni de donnée sensible.'));
    if (canManage) {
      logBox.append(button('Enregistrer le compte rendu', async () => {
        try {
          // Chaîne vide -> null (permet le réalignement automatique des séances vides)
          const upd = { summary: summary.value.trim() || null, notes: notes.value.trim() || null };
          await unwrap(sb.from('sessions').update(upd).eq('id', id));
          s.summary = upd.summary; s.notes = upd.notes;
          toast('Compte rendu enregistré.', 'success');
        } catch (e) { showError(e); }
      }, 'btn-primary'));
    }
  }
  async function toggleTech(tid) {
    try {
      if (selected.has(tid)) {
        await unwrap(sb.from('session_techniques').delete().eq('session_id', id).eq('technique_id', tid));
        selected.delete(tid);
      } else {
        await unwrap(sb.from('session_techniques').insert({ session_id: id, technique_id: tid }));
        selected.add(tid);
      }
      // Conserve le texte en cours de saisie
      const keep = [...logBox.querySelectorAll('textarea')].map((t) => t.value);
      drawLog();
      logBox.querySelectorAll('textarea').forEach((t, i) => { t.value = keep[i]; });
    } catch (e) { showError(e); }
  }

  drawHeader(); drawInstructor(); drawAttendance(); drawLog();
}
