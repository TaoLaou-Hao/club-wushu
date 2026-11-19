// Administration : comptes, codes enseignant, grades, techniques, journal, RGPD.
import { sb, unwrap } from '../supabaseClient.js';
import { h, clear, button, field, selectEl, formModal, modal, confirmDialog, toast, showError, badge, loading, emptyState } from '../dom.js';
import { state } from '../auth.js';
import { ROLE_LABEL, fmtStamp } from '../util.js';

const TABS = [
  ['accounts', 'Comptes'], ['codes', 'Codes d’invitation'], ['belts', 'Grades'],
  ['techniques', 'Techniques'], ['audit', 'Journal d’audit'], ['rgpd', 'RGPD'],
];
let currentTab = 'accounts';

export async function renderAdmin(root) {
  const panel = h('div', { id: 'admin-panel', role: 'tabpanel' });
  const bar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Sections d’administration' });
  function drawTabs() {
    clear(bar);
    for (const [key, label] of TABS) {
      bar.appendChild(h('button', {
        type: 'button', role: 'tab', class: 'tab' + (key === currentTab ? ' active' : ''), 'aria-selected': String(key === currentTab),
        onclick: () => { currentTab = key; drawTabs(); show(); },
      }, label));
    }
  }
  async function show() {
    clear(panel).appendChild(loading());
    const box = h('div');
    try {
      await SECTIONS[currentTab](box);
      clear(panel).appendChild(box);
    } catch (e) { clear(panel); showError(e); panel.appendChild(emptyState('Chargement impossible.')); }
  }
  root.append(h('h1', {}, 'Administration'), bar, panel);
  drawTabs();
  await show();
}

const SECTIONS = { accounts, codes, belts, techniques, audit, rgpd };

// ---------------------------------------------------------------- Comptes
async function accounts(box) {
  const users = await unwrap(sb.rpc('list_users'));
  const again = () => { clear(box); return accounts(box); };
  box.append(h('h2', {}, 'Comptes'), h('p', { class: 'muted' }, 'Rôles : En attente (aucun accès), Membre (voit uniquement son espace), Enseignant (gère ses cours et séances), Administrateur (accès complet). Les nouveaux comptes sont « En attente » sans code d’invitation.'));
  const tbody = h('tbody');
  for (const u of users) {
    const sel = selectEl(Object.entries(ROLE_LABEL), u.role, { 'aria-label': `Rôle de ${u.full_name || u.email}` });
    sel.addEventListener('change', async () => {
      try { await unwrap(sb.rpc('set_user_role', { p_user_id: u.id, p_role: sel.value })); toast('Rôle mis à jour.', 'success'); again(); }
      catch (e) { showError(e); sel.value = u.role; }
    });
    tbody.appendChild(h('tr', {},
      h('td', { 'data-label': 'Nom' }, u.full_name || '—'),
      h('td', { 'data-label': 'Email' }, u.email),
      h('td', { 'data-label': 'Rôle' }, sel),
      h('td', { 'data-label': 'Inscrit le' }, fmtStamp(u.created_at)),
      h('td', { 'data-label': 'Dernière connexion' }, fmtStamp(u.last_sign_in_at)),
      h('td', {}, u.id === state.user.id ? h('span', { class: 'muted small' }, 'Vous') : button('Supprimer', async () => {
        if (!(await confirmDialog({ title: 'Supprimer le compte', message: `Supprimer définitivement le compte de ${u.full_name || u.email} ?`, confirmLabel: 'Supprimer', danger: true }))) return;
        try { await unwrap(sb.rpc('delete_user', { p_user_id: u.id })); toast('Compte supprimé.', 'success'); again(); }
        catch (e) { showError(e); }
      }, 'btn-sm btn-danger-outline'))));
  }
  box.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table responsive' },
    h('thead', {}, h('tr', {}, ['Nom', 'Email', 'Rôle', 'Inscrit le', 'Dernière connexion', ''].map((t) => h('th', { scope: 'col' }, t)))), tbody)));
}

// ---------------------------------------------------------------- Codes enseignant
async function codes(box) {
  const rows = await unwrap(sb.from('invite_codes').select('id,label,uses,max_uses,expires_at,revoked,created_at,role,member_id').order('created_at', { ascending: false }));
  const again = () => { clear(box); return codes(box); };
  const label = h('input', { type: 'text', maxlength: 100, placeholder: 'ex. Nouvel enseignant' });
  const days = h('input', { type: 'number', min: 1, max: 30, value: 7, required: true, inputmode: 'numeric' });
  const uses = h('input', { type: 'number', min: 1, max: 20, value: 1, required: true, inputmode: 'numeric' });
  const roleSel = selectEl([['teacher', 'Enseignant'], ['member', 'Membre']], 'teacher');
  box.append(
    h('h2', {}, 'Codes d’invitation'),
    h('p', { class: 'muted' }, 'Un code donne le rôle Enseignant ou Membre, jamais Administrateur.'),
    h('form', {
      class: 'card inline-grid',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const code = await unwrap(sb.rpc('create_invite_code', { p_label: label.value.trim() || null, p_days: Number(days.value), p_max_uses: Number(uses.value), p_role: roleSel.value }));
          showCode(code, roleSel.value);
          again();
        } catch (err) { showError(err); }
      },
    }, field('Libellé', label), field('Rôle donné', roleSel), field('Validité (jours, 1 à 30)', days), field('Utilisations (1 à 20)', uses),
    h('button', { type: 'submit', class: 'btn btn-primary' }, 'Créer un code')));
  if (!rows.length) box.append(emptyState('Aucun code.'));
  const now = Date.now();
  const tbody = h('tbody');
  for (const r of rows) {
    const expired = new Date(r.expires_at).getTime() < now;
    const st = r.revoked ? ['Révoqué', 'badge-off'] : expired ? ['Expiré', 'badge-off'] : r.uses >= r.max_uses ? ['Épuisé', 'badge-off'] : ['Actif', 'badge-ok'];
    tbody.appendChild(h('tr', {},
      h('td', { 'data-label': 'Libellé' }, r.label || '—'),
      h('td', { 'data-label': 'Rôle' }, ROLE_LABEL[r.role] || 'Enseignant', r.member_id ? [' ', badge('Activation fiche', 'badge-ok')] : null),
      h('td', { 'data-label': 'Utilisations' }, `${r.uses} / ${r.max_uses}`),
      h('td', { 'data-label': 'Expire le' }, fmtStamp(r.expires_at)),
      h('td', { 'data-label': 'Statut' }, badge(st[0], st[1])),
      h('td', {}, r.revoked ? null : button('Révoquer', async () => {
        if (!(await confirmDialog({ title: 'Révoquer le code', message: 'Ce code ne pourra plus être utilisé.', confirmLabel: 'Révoquer', danger: true }))) return;
        try { await unwrap(sb.from('invite_codes').update({ revoked: true }).eq('id', r.id)); toast('Code révoqué.', 'success'); again(); }
        catch (e) { showError(e); }
      }, 'btn-sm btn-danger-outline'))));
  }
  if (rows.length) box.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table responsive' },
    h('thead', {}, h('tr', {}, ['Libellé', 'Rôle', 'Utilisations', 'Expire le', 'Statut', ''].map((t) => h('th', { scope: 'col' }, t)))), tbody)));
}

// Affiche le code en clair UNE seule fois.
function showCode(code, role) {
  const out = h('input', { type: 'text', readOnly: true, value: code, class: 'code-out', 'aria-label': 'Code d’invitation' });
  const m = modal({
    title: role === 'member' ? 'Code membre créé' : 'Code enseignant créé', dismissible: false,
    content: h('div', {},
      h('p', { class: 'warn' }, 'Ce code ne sera plus jamais affiché. Transmettez-le uniquement à la personne concernée.'),
      out),
    actions: [
      button('Copier', async () => {
        try { await navigator.clipboard.writeText(code); toast('Code copié.', 'success'); }
        catch { out.focus(); out.select(); toast('Copie automatique impossible : sélectionnez et copiez le code.', 'error'); }
      }),
      button('J’ai noté le code, fermer', () => m.close(), 'btn-primary'),
    ],
  });
  out.select();
}

// ---------------------------------------------------------------- Grades (ceintures)
async function belts(box) {
  const rows = await unwrap(sb.from('belt_levels').select('id,name,rank,color').order('rank'));
  const again = () => { clear(box); return belts(box); };
  box.append(h('div', { class: 'row-between' }, h('h2', {}, 'Grades'), button('Ajouter un grade', () => beltForm(null, again), 'btn-primary')));
  if (!rows.length) box.append(emptyState('Aucun grade.'));
  box.append(h('ul', { class: 'plain-list' }, rows.map((b) => h('li', { class: 'row-between' },
    h('span', {}, colorDot(b.color), ' ', h('strong', {}, b.name), h('span', { class: 'muted' }, ` · rang ${b.rank}`)),
    h('span', { class: 'btn-row' },
      button('Modifier', () => beltForm(b, again), 'btn-sm'),
      button('Supprimer', async () => {
        if (!(await confirmDialog({ title: 'Supprimer le grade', message: `Supprimer « ${b.name} » ? Impossible s’il est déjà attribué à un membre.`, confirmLabel: 'Supprimer', danger: true }))) return;
        try { await unwrap(sb.from('belt_levels').delete().eq('id', b.id)); toast('Grade supprimé.', 'success'); again(); } catch (e) { showError(e); }
      }, 'btn-sm btn-danger-outline'))))));
}
function colorDot(c) {
  const d = h('span', { class: 'belt-dot', 'aria-hidden': 'true' });
  if (c) d.style.background = c; else d.classList.add('none');
  return d;
}
function beltForm(b, done) {
  const name = h('input', { type: 'text', required: true, maxlength: 60, value: b ? b.name : '' });
  const rank = h('input', { type: 'number', required: true, step: 1, value: b ? b.rank : 0, inputmode: 'numeric' });
  const color = h('input', { type: 'color', value: b && b.color ? b.color : '#cccccc' });
  formModal({
    title: b ? 'Modifier le grade' : 'Nouveau grade',
    body: [field('Nom', name), field('Rang (ordre croissant)', rank), field('Couleur', color)],
    onSubmit: async () => {
      const row = { name: name.value.trim(), rank: Number(rank.value), color: color.value };
      if (b) await unwrap(sb.from('belt_levels').update(row).eq('id', b.id));
      else await unwrap(sb.from('belt_levels').insert(row));
      toast('Grade enregistré.', 'success');
      done();
    },
  });
}

// ---------------------------------------------------------------- Techniques
async function techniques(box) {
  const rows = await unwrap(sb.from('techniques').select('id,name,category').order('name'));
  const again = () => { clear(box); return techniques(box); };
  box.append(h('div', { class: 'row-between' }, h('h2', {}, 'Techniques'), button('Ajouter une technique', () => techForm(null, again), 'btn-primary')));
  if (!rows.length) box.append(emptyState('Aucune technique.'));
  box.append(h('ul', { class: 'plain-list' }, rows.map((t) => h('li', { class: 'row-between' },
    h('span', {}, h('strong', {}, t.name), t.category ? h('span', { class: 'muted' }, ` · ${t.category}`) : null),
    h('span', { class: 'btn-row' },
      button('Modifier', () => techForm(t, again), 'btn-sm'),
      button('Supprimer', async () => {
        if (!(await confirmDialog({ title: 'Supprimer la technique', message: `Supprimer « ${t.name} » ? Elle sera retirée des comptes rendus de séance.`, confirmLabel: 'Supprimer', danger: true }))) return;
        try { await unwrap(sb.from('techniques').delete().eq('id', t.id)); toast('Technique supprimée.', 'success'); again(); } catch (e) { showError(e); }
      }, 'btn-sm btn-danger-outline'))))));
}
function techForm(t, done) {
  const name = h('input', { type: 'text', required: true, maxlength: 100, value: t ? t.name : '' });
  const cat = h('input', { type: 'text', maxlength: 60, value: t && t.category ? t.category : '' });
  formModal({
    title: t ? 'Modifier la technique' : 'Nouvelle technique',
    body: [field('Nom', name), field('Catégorie', cat)],
    onSubmit: async () => {
      const row = { name: name.value.trim(), category: cat.value.trim() || null };
      if (t) await unwrap(sb.from('techniques').update(row).eq('id', t.id));
      else await unwrap(sb.from('techniques').insert(row));
      toast('Technique enregistrée.', 'success');
      done();
    },
  });
}

// ---------------------------------------------------------------- Journal d'audit
async function audit(box) {
  const [rows, profiles] = await Promise.all([
    unwrap(sb.from('audit_log').select('id,at,actor,action,table_name,record_id,details').order('at', { ascending: false }).limit(200)),
    unwrap(sb.from('profiles').select('id,full_name')),
  ]);
  const names = new Map(profiles.map((p) => [p.id, p.full_name || 'Sans nom']));
  const actions = [...new Set(rows.map((r) => r.action))].sort();
  const sel = selectEl([['', 'Toutes les actions'], ...actions.map((a) => [a, a])], '', { onchange: draw, 'aria-label': 'Filtrer par action' });
  const tbody = h('tbody');
  function draw() {
    clear(tbody);
    for (const r of rows.filter((x) => !sel.value || x.action === sel.value)) {
      tbody.appendChild(h('tr', {},
        h('td', { 'data-label': 'Date' }, fmtStamp(r.at)),
        h('td', { 'data-label': 'Acteur' }, r.actor ? names.get(r.actor) || 'Compte supprimé' : '—'),
        h('td', { 'data-label': 'Action' }, r.action),
        h('td', { 'data-label': 'Table' }, r.table_name || '—'),
        h('td', { 'data-label': 'Enregistrement' }, h('code', {}, r.record_id || '—')),
        h('td', { 'data-label': 'Détails' }, r.details ? JSON.stringify(r.details) : '')));
    }
  }
  box.append(h('h2', {}, 'Journal d’audit'), h('p', { class: 'muted' }, '200 dernières entrées. Le journal ne contient que des identifiants, jamais de données personnelles.'),
    h('div', { class: 'toolbar' }, sel),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table responsive' },
      h('thead', {}, h('tr', {}, ['Date', 'Acteur', 'Action', 'Table', 'Enregistrement', 'Détails'].map((t) => h('th', { scope: 'col' }, t)))), tbody)));
  draw();
}

// ---------------------------------------------------------------- RGPD
async function rgpd(box) {
  const result = h('div', { 'aria-live': 'polite' });
  box.append(
    h('h2', {}, 'RGPD – durées de conservation'),
    h('p', {}, 'Anonymise les membres partis depuis plus de 3 ans, supprime les entrées du journal de plus de 365 jours et purge les anciens codes et tentatives.'),
    button('Appliquer les durées de conservation', async () => {
      if (!(await confirmDialog({ title: 'Appliquer les durées de conservation', message: 'Cette opération est irréversible (anonymisation et suppression définitives). Continuer ?', confirmLabel: 'Appliquer', danger: true }))) return;
      try {
        const r = await unwrap(sb.rpc('apply_retention', { p_member_years: 3, p_audit_days: 365 }));
        clear(result).append(h('p', { class: 'form-info' }, `Terminé : ${r.membres_anonymises} membre(s) anonymisé(s), ${r.logs_supprimes} entrée(s) de journal supprimée(s).`));
      } catch (e) { showError(e); }
    }, 'btn-danger-outline'),
    result,
    h('p', { class: 'muted' }, 'L’export et l’anonymisation d’un membre se font depuis sa fiche.'));
}
