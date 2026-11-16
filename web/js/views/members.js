// Liste des membres : recherche, filtres, création.
import { sb, unwrap } from '../supabaseClient.js';
import { isAdmin } from '../auth.js';
import { h, clear, button, field, selectEl, formModal, toast, badge, emptyState } from '../dom.js';
import { go } from '../router.js';
import { fullName, byMemberName, norm } from '../util.js';

// Filtres conservés en mémoire seulement
const filt = { q: '', status: 'active', anon: false, teachers: false };

export function beltDot(belt) {
  const d = h('span', { class: 'belt-dot', role: 'img', 'aria-label': belt ? `Ceinture ${belt.name}` : 'Aucun grade' });
  if (belt && belt.color) d.style.background = belt.color;
  else d.classList.add('none');
  return d;
}

export async function renderMembers(root) {
  const [members, grades] = await Promise.all([
    unwrap(sb.from('members').select('id,first_name,last_name,birth_year,active,anonymized_at,is_instructor').order('last_name').order('first_name')),
    unwrap(sb.from('member_grades').select('member_id,awarded_on,created_at,belt:belt_levels(name,color,rank)').order('awarded_on', { ascending: false }).order('created_at', { ascending: false })),
  ]);
  const latest = new Map(); // premier rencontré = plus récent (tri décroissant)
  for (const g of grades) if (!latest.has(g.member_id)) latest.set(g.member_id, g.belt);

  const q = h('input', { type: 'search', value: filt.q, placeholder: 'Nom ou prénom…', autocomplete: 'off', oninput: () => { filt.q = q.value; draw(); } });
  const status = selectEl([['active', 'Actifs'], ['inactive', 'Inactifs'], ['all', 'Tous']], filt.status, { onchange: () => { filt.status = status.value; draw(); } });
  const anon = h('input', { type: 'checkbox', checked: filt.anon, onchange: () => { filt.anon = anon.checked; draw(); } });
  const teachers = h('input', { type: 'checkbox', checked: filt.teachers, onchange: () => { filt.teachers = teachers.checked; draw(); } });
  const list = h('ul', { class: 'member-list' });
  const count = h('p', { class: 'muted small', 'aria-live': 'polite' });

  root.append(
    h('div', { class: 'row-between' }, h('h1', {}, 'Membres'), button('Ajouter un membre', () => memberForm(null, (id) => go('/membre/' + id)), 'btn-primary')),
    h('div', { class: 'toolbar filters' },
      field('Recherche', q), field('Statut', status),
      h('label', { class: 'check' }, teachers, ' Enseignants'),
      h('label', { class: 'check' }, anon, ' Afficher les anonymisés')),
    count, list);

  function draw() {
    clear(list);
    const t = norm(filt.q);
    const shown = members.filter((m) => {
      if (m.anonymized_at && !filt.anon) return false;
      if (filt.status === 'active' && !m.active) return false;
      if (filt.status === 'inactive' && m.active) return false;
      if (filt.teachers && !m.is_instructor) return false;
      return !t || norm(fullName(m)).includes(t) || norm(`${m.last_name} ${m.first_name}`).includes(t);
    }).sort(byMemberName);
    count.textContent = `${shown.length} membre${shown.length > 1 ? 's' : ''}`;
    if (!shown.length) list.appendChild(h('li', {}, emptyState('Aucun membre ne correspond.')));
    for (const m of shown) {
      const belt = latest.get(m.id);
      list.appendChild(h('li', {}, h('a', { class: 'member-row', href: `#/membre/${m.id}` },
        beltDot(belt),
        h('span', { class: 'member-name' }, `${m.last_name.toUpperCase()} ${m.first_name}`),
        h('span', { class: 'muted small' }, belt ? belt.name : 'Sans grade'),
        m.is_instructor ? badge('Enseignant', 'badge-ok') : null,
        m.anonymized_at ? badge('Anonymisé', 'badge-off') : !m.active ? badge('Inactif', 'badge-off') : null)));
    }
  }
  draw();
}

// Création / modification d'un membre (sans coordonnées)
export function memberForm(m, onSaved) {
  const fn = h('input', { type: 'text', required: true, maxlength: 60, value: m ? m.first_name : '', autocomplete: 'off' });
  const ln = h('input', { type: 'text', required: true, maxlength: 60, value: m ? m.last_name : '', autocomplete: 'off' });
  const by = h('input', { type: 'number', min: 1900, max: 2100, step: 1, value: m && m.birth_year ? m.birth_year : '', inputmode: 'numeric' });
  const act = h('input', { type: 'checkbox', checked: m ? m.active : true });
  const instr = !m && isAdmin() ? h('input', { type: 'checkbox', checked: false }) : null;
  formModal({
    title: m ? 'Modifier le membre' : 'Nouveau membre',
    body: [
      field('Prénom', fn), field('Nom', ln),
      field('Année de naissance', by, 'Année uniquement (minimisation des données).'),
      h('label', { class: 'check' }, act, ' Membre actif'),
      instr ? h('label', { class: 'check' }, instr, ' Enseignant (peut être habilité à donner des cours)') : null,
      h('p', { class: 'hint' }, 'Les coordonnées se saisissent depuis la fiche du membre.'),
    ],
    onSubmit: async () => {
      const row = { first_name: fn.value.trim(), last_name: ln.value.trim(), birth_year: by.value ? Number(by.value) : null, active: act.checked };
      if (instr) row.is_instructor = instr.checked;
      let id = m && m.id;
      if (m) await unwrap(sb.from('members').update(row).eq('id', id));
      else id = (await unwrap(sb.from('members').insert(row).select('id').single())).id;
      toast('Membre enregistré.', 'success');
      if (onSaved) onSaved(id);
    },
  });
}
