// Fiche d'un membre : grades, présences, cours, coordonnées chiffrées, zone RGPD.
import { sb, unwrap } from '../supabaseClient.js';
import { h, clear, append, button, field, selectEl, formModal, confirmDialog, toast, showError, badge, emptyState } from '../dom.js';
import { isAdmin, state } from '../auth.js';
import { go } from '../router.js';
import { fmtShort, todayIso, downloadJson, fullName, errMsg, ROLE_LABEL } from '../util.js';
import { modal } from '../dom.js';
import { beltDot, memberForm } from './members.js';

export async function renderMember(root, { id }) {
  const m = await unwrap(sb.from('members').select('id,first_name,last_name,birth_year,active,left_at,anonymized_at,profile_id,is_instructor').eq('id', id).maybeSingle());
  if (!m) { root.appendChild(h('div', { class: 'card' }, emptyState('Membre introuvable.'), h('a', { class: 'btn', href: '#/membres' }, 'Retour aux membres'))); return; }
  const [grades, belts, att, courses, teaches] = await Promise.all([
    unwrap(sb.from('member_grades').select('id,awarded_on,note,belt:belt_levels(name,color)').eq('member_id', id).order('awarded_on', { ascending: false }).order('created_at', { ascending: false })),
    unwrap(sb.from('belt_levels').select('id,name,rank,color').order('rank')),
    unwrap(sb.from('attendance').select('present,session:sessions(id,date,status,course:courses(name))').eq('member_id', id)),
    unwrap(sb.from('course_members').select('course:courses(id,name)').eq('member_id', id)),
    m.is_instructor ? unwrap(sb.from('course_instructors').select('course:courses(id,name)').eq('member_id', id)) : Promise.resolve([]),
  ]);
  const reload = () => { clear(root); return renderMember(root, { id }); };
  // Compte lié (admin ou enseignant qui pratique aussi)
  const linked = m.profile_id ? await unwrap(sb.from('profiles').select('id,full_name,role').eq('id', m.profile_id).maybeSingle()) : null;
  const isSelf = !!m.profile_id && m.profile_id === state.profile.id;
  const anonymized = !!m.anonymized_at;

  // ----- Identité -----
  const infoCard = h('div', { class: 'card' },
    h('p', {}, h('a', { href: '#/membres' }, '‹ Membres')),
    h('div', { class: 'row-between' },
      h('h1', {}, anonymized ? `${m.first_name} ${m.last_name}` : fullName(m)),
      h('div', {}, anonymized ? badge('Anonymisé', 'badge-off') : [badge(m.active ? 'Actif' : 'Inactif', m.active ? 'badge-ok' : 'badge-off'), m.is_instructor ? [' ', badge('Enseignant', 'badge-ok')] : null])),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Année de naissance'), h('dd', {}, m.birth_year || '—'),
      h('dt', {}, 'Grade actuel'), h('dd', {}, grades.length ? [beltDot(grades[0].belt), ' ', grades[0].belt.name] : 'Aucun'),
      m.left_at ? [h('dt', {}, 'Départ'), h('dd', {}, fmtShort(m.left_at))] : null,
      h('dt', {}, 'Cours'), h('dd', {}, courses.length ? courses.map((c) => c.course && c.course.name).filter(Boolean).join(', ') : 'Aucun'),
      m.is_instructor ? [h('dt', {}, 'Enseigne'), h('dd', {}, teaches.length ? teaches.map((c) => c.course && c.course.name).filter(Boolean).join(', ') : 'Aucun cours pour le moment')] : null,
      h('dt', {}, 'Compte lié'), h('dd', {}, linked ? [linked.full_name || '(sans nom)', ' ', badge(ROLE_LABEL[linked.role] || linked.role, 'badge-ok')] : 'Aucun')),
    anonymized ? null : h('div', { class: 'btn-row' },
      button('Modifier', () => memberForm(m, reload)),
      isAdmin() ? button(m.profile_id ? 'Changer le compte lié' : 'Lier à un compte', linkAccount) : null,
      isAdmin() && !m.profile_id ? button('Créer un code d’activation', activationCode) : null));

  // ----- Statut d'enseignant (admin) -----
  const instrCard = isAdmin() && !anonymized ? h('div', { class: 'card' },
    h('h2', {}, 'Enseignant'),
    h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', checked: !!m.is_instructor,
        onchange: async (e) => {
          const cb = e.target; const want = cb.checked;
          cb.disabled = true;
          try {
            await unwrap(sb.from('members').update({ is_instructor: want }).eq('id', id));
            toast(want ? 'Fiche marquée comme enseignant.' : 'Statut d’enseignant retiré.', 'success');
            reload();
          } catch (err) { cb.checked = !want; cb.disabled = false; showError(err); }
        },
      }), ' Enseignant (peut être habilité à donner des cours)'),
    h('p', { class: 'muted small' }, 'Un enseignant sans compte apparaît dans le planning (habilitations du cours, intervenant des séances) et un administrateur coche les présences à sa place. En liant la fiche à un compte (« Lier à un compte »), la personne accède à ses cours dès que son compte a le rôle enseignant. Retirer le statut supprime ses habilitations sur les cours.')) : null;

  async function linkAccount() {
    let profiles, taken;
    try {
      [profiles, taken] = await Promise.all([
        unwrap(sb.rpc('list_users')),
        unwrap(sb.from('members').select('profile_id').not('profile_id', 'is', null)),
      ]);
    } catch (e) { showError(e); return; }
    const used = new Set(taken.map((t) => t.profile_id).filter((pid) => pid !== m.profile_id));
    const opts = [['', '— Aucun compte —']].concat(profiles.filter((p) => !used.has(p.id))
      .map((p) => [p.id, `${p.full_name || '(sans nom)'} – ${p.email} – ${ROLE_LABEL[p.role] || p.role}`]));
    const sel = selectEl(opts, m.profile_id || '');
    formModal({
      title: 'Lier la fiche à un compte',
      body: [h('p', { class: 'muted' }, 'Fusionne un compte avec cette fiche : la personne retrouve son historique (grades, présences). Utile quand un membre créé sans email se connecte plus tard, ou pour un enseignant qui pratique aussi. La liaison ne donne aucun droit : le rôle se gère dans Administration > Comptes.'), field('Compte', sel)],
      onSubmit: async () => {
        await unwrap(sb.from('members').update({ profile_id: sel.value || null }).eq('id', id));
        toast('Liaison enregistrée.', 'success');
        reload();
      },
    });
  }

  function activationCode() {
    const roleSel = selectEl(m.is_instructor ? [['member', 'Membre'], ['teacher', 'Enseignant']] : [['member', 'Membre']], 'member');
    const days = h('input', { type: 'number', min: 1, max: 30, value: 14, required: true, inputmode: 'numeric' });
    formModal({
      title: 'Créer un code d’activation',
      submitLabel: 'Créer le code',
      body: [
        h('p', { class: 'muted' }, 'Quand la personne saisit ce code après avoir créé son compte, son compte est automatiquement lié à cette fiche. Le code est à usage unique.'),
        field('Rôle donné', roleSel), field('Validité (jours, 1 à 30)', days)],
      onSubmit: async () => {
        const n = Number(days.value);
        const code = await unwrap(sb.rpc('create_invite_code', { p_label: 'Activation ' + fullName(m), p_days: n, p_max_uses: 1, p_role: roleSel.value, p_member_id: m.id }));
        showActivation(code, n);
      },
    });
  }
  function showActivation(code, n) {
    const message = `Bonjour ${m.first_name}, pour accéder à l’espace du club : 1) créez un compte sur ${location.origin + location.pathname} 2) saisissez ce code : ${code} (valable ${n} jours, usage unique).`;
    const out = h('input', { type: 'text', readOnly: true, value: code, class: 'code-out', 'aria-label': 'Code d’activation' });
    const msg = h('textarea', { rows: 5, readOnly: true, 'aria-label': 'Message à envoyer' }); msg.value = message;
    const copy = async (text, el, ok) => {
      try { await navigator.clipboard.writeText(text); toast(ok, 'success'); }
      catch { el.focus(); el.select(); toast('Copie automatique impossible : sélectionnez et copiez le texte.', 'error'); }
    };
    const dlg = modal({
      title: 'Code d’activation créé', dismissible: false,
      content: h('div', {},
        h('p', { class: 'warn' }, 'Ce code ne sera plus jamais affiché. Transmettez-le uniquement à la personne concernée.'),
        out, h('p', { class: 'hint' }, 'Message prêt à envoyer'), msg),
      actions: [
        button('Copier', () => copy(code, out, 'Code copié.')),
        button('Copier le message', () => copy(message, msg, 'Message copié.')),
        button('J’ai noté le code, fermer', () => dlg.close(), 'btn-primary'),
      ],
    });
    out.select();
  }

  // ----- Coordonnées (chargées uniquement à la demande, jamais mises en cache) -----
  const contactBox = h('div', { class: 'card' });
  function drawContactClosed() {
    append(clear(contactBox), [
      h('h2', {}, 'Coordonnées'),
      anonymized ? h('p', { class: 'muted' }, 'Membre anonymisé : aucune coordonnée conservée.') : h('p', { class: 'muted' }, 'Les coordonnées sont chiffrées. Chaque consultation est enregistrée dans le journal d’audit.'),
      anonymized ? null : button('Afficher les coordonnées', showContact, 'btn-primary')]);
  }
  async function showContact() {
    let c;
    try {
      const { data, error } = await sb.rpc('get_member_contact', { p_member_id: id });
      if (error) throw error;
      c = (data && data[0]) || {};
    } catch (e) { showError(e); return; }
    const email = h('input', { type: 'email', maxlength: 254, value: c.email || '', autocomplete: 'off' });
    const phone = h('input', { type: 'tel', maxlength: 30, value: c.phone || '', autocomplete: 'off' });
    const emerg = h('input', { type: 'text', maxlength: 200, value: c.emergency || '', autocomplete: 'off' });
    const lic = h('input', { type: 'text', maxlength: 40, value: c.license || '', autocomplete: 'off' });
    const msg = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Enregistrer');
    clear(contactBox).append(
      h('h2', {}, 'Coordonnées'),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          msg.hidden = true; save.disabled = true;
          try {
            await unwrap(sb.rpc('set_member_contact', { p_member_id: id, p_email: email.value.trim(), p_phone: phone.value.trim(), p_emergency: emerg.value.trim(), p_license: lic.value.trim() }));
            toast('Coordonnées enregistrées.', 'success');
          } catch (err) { msg.textContent = errMsg(err); msg.hidden = false; }
          finally { save.disabled = false; }
        },
      },
        field('Email', email), field('Téléphone', phone), field('Contact d’urgence (nom et téléphone)', emerg), field('N° de licence', lic), msg,
        h('div', { class: 'btn-row' }, save, button('Masquer', () => { clear(contactBox); drawContactClosed(); }, 'btn-ghost'))));
  }
  drawContactClosed();

  // ----- Grades -----
  const gradeCard = h('div', { class: 'card' }, h('h2', {}, 'Grades'));
  if (!grades.length) gradeCard.append(emptyState('Aucun grade enregistré.'));
  else {
    gradeCard.append(h('ul', { class: 'plain-list' }, grades.map((g) => h('li', { class: 'row-between' },
      h('span', {}, beltDot(g.belt), ' ', h('strong', {}, g.belt.name), ' – ', fmtShort(g.awarded_on), g.note ? h('span', { class: 'muted' }, ' · ' + g.note) : null),
      isAdmin() ? button('Supprimer', () => deleteGrade(g), 'btn-sm btn-danger-outline', { 'aria-label': `Supprimer le grade ${g.belt.name}` }) : null))));
  }
  if (!anonymized && isSelf && !isAdmin()) gradeCard.append(h('p', { class: 'muted' }, 'Vous ne pouvez pas vous décerner un grade : demandez à un administrateur.'));
  else if (!anonymized) gradeCard.append(button('Ajouter un grade', addGrade, 'btn-primary'));
  function addGrade() {
    if (!belts.length) { toast('Aucun grade défini (voir Administration).', 'error'); return; }
    const sel = selectEl(belts.map((b) => [b.id, b.name]), belts[0].id, { required: true });
    const date = h('input', { type: 'date', required: true, value: todayIso() });
    const note = h('input', { type: 'text', maxlength: 500 });
    formModal({
      title: 'Ajouter un grade',
      body: [field('Ceinture', sel), field('Date d’obtention', date), field('Note (facultative)', note)],
      onSubmit: async () => {
        await unwrap(sb.from('member_grades').insert({ member_id: id, belt_level_id: sel.value, awarded_on: date.value, note: note.value.trim() || null }));
        toast('Grade ajouté.', 'success');
        reload();
      },
    });
  }
  async function deleteGrade(g) {
    if (!(await confirmDialog({ title: 'Supprimer le grade', message: `Supprimer le grade « ${g.belt.name} » du ${fmtShort(g.awarded_on)} ?`, confirmLabel: 'Supprimer', danger: true }))) return;
    try { await unwrap(sb.from('member_grades').delete().eq('id', g.id)); toast('Grade supprimé.', 'success'); reload(); }
    catch (e) { showError(e); }
  }

  // ----- Présences -----
  const valid = att.filter((a) => a.session && a.session.status !== 'cancelled');
  valid.sort((a, b) => b.session.date.localeCompare(a.session.date));
  const presentCount = valid.filter((a) => a.present).length;
  const rate = valid.length ? Math.round((presentCount / valid.length) * 100) : null;
  const attCard = h('div', { class: 'card' },
    h('h2', {}, 'Présences'),
    rate === null ? emptyState('Aucune présence enregistrée.')
      : h('p', {}, h('strong', {}, `${rate} %`), ` de présence (${presentCount} / ${valid.length} séances pointées)`),
    valid.length ? h('ul', { class: 'plain-list' }, valid.slice(0, 50).map((a) => h('li', { class: 'row-between' },
      h('span', {}, h('a', { href: `#/seance/${a.session.id}` }, fmtShort(a.session.date)), ' – ', a.session.course ? a.session.course.name : ''),
      badge(a.present ? 'Présent' : 'Absent', a.present ? 'badge-ok' : 'badge-off')))) : null,
    valid.length > 50 ? h('p', { class: 'muted small' }, '50 dernières séances affichées.') : null);

  root.append(infoCard, instrCard, contactBox, gradeCard, attCard);

  // ----- Zone RGPD (admin) -----
  if (isAdmin()) {
    root.append(h('div', { class: 'card admin-zone' },
      h('h2', {}, 'Zone RGPD (administrateur)'),
      h('div', { class: 'btn-row' },
        button('Exporter les données (JSON)', async () => {
          try {
            if (!(await confirmDialog({ title: 'Exporter les données', message: 'Le fichier contiendra les coordonnées en clair. Transmettez-le uniquement à la personne concernée (ou à son représentant légal), par un moyen sûr, puis supprimez-le de cet appareil.', confirmLabel: 'Exporter' }))) return;
            const data = await unwrap(sb.rpc('export_member_data', { p_member_id: id }));
            downloadJson(data, `membre-${id}.json`);
            toast('Export téléchargé.', 'success');
          } catch (e) { showError(e); }
        }),
        anonymized ? null : button('Anonymiser ce membre', async () => {
          if (!(await confirmDialog({ title: 'Anonymiser ce membre', message: 'Le nom, l’année de naissance, les coordonnées et les inscriptions seront effacés de façon irréversible. Les statistiques de présence sont conservées.', confirmLabel: 'Anonymiser', danger: true }))) return;
          try { await unwrap(sb.rpc('anonymize_member', { p_member_id: id })); toast('Membre anonymisé.', 'success'); reload(); }
          catch (e) { showError(e); }
        }, 'btn-danger-outline'),
        button('Supprimer le membre', async () => {
          if (!(await confirmDialog({ title: 'Supprimer le membre', message: `Supprimer définitivement ${anonymized ? 'ce membre' : fullName(m)}, ses grades et ses présences ?`, confirmLabel: 'Supprimer', danger: true }))) return;
          try { await unwrap(sb.from('members').delete().eq('id', id)); toast('Membre supprimé.', 'success'); go('/membres'); }
          catch (e) { showError(e); }
        }, 'btn-danger-outline'))));
  }
}
