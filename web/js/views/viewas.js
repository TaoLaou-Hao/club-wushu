// Sélection de la fiche pour l'aperçu « Voir comme » (administrateur).
import { sb, unwrap } from '../supabaseClient.js';
import { h, field, selectEl, formModal, showError } from '../dom.js';
import { fullName } from '../util.js';
import * as preview from '../preview.js';
import * as router from '../router.js';

export async function openViewAsPicker() {
  let members;
  try {
    members = await unwrap(sb.from('members').select('id,first_name,last_name,is_instructor,profile_id')
      .is('anonymized_at', null).eq('active', true).order('last_name').order('first_name'));
  } catch (e) { showError(e); return; }
  const roleSel = selectEl([['member', 'Membre (pratiquant)'], ['teacher', 'Enseignant']], 'member');
  const who = h('select', { required: true });
  const fill = () => {
    const list = members.filter((m) => roleSel.value === 'member' || m.is_instructor);
    who.replaceChildren(...list.map((m) => h('option', { value: m.id }, fullName(m) + (m.profile_id ? '' : ' (sans compte)'))));
  };
  roleSel.addEventListener('change', fill);
  fill();
  formModal({
    title: 'Voir l’appli comme…',
    submitLabel: 'Voir l’aperçu',
    body: [
      h('p', { class: 'muted' }, 'Aperçu en lecture seule : l’interface s’affiche comme pour la personne choisie, sans rien pouvoir modifier. Vos droits ne changent pas.'),
      field('Rôle', roleSel),
      field('Personne', who),
    ],
    onSubmit: async () => {
      const m = members.find((x) => x.id === who.value);
      if (!m) throw new Error('Choisissez une personne.');
      preview.enter({ role: roleSel.value, memberId: m.id, name: fullName(m) });
      router.go(roleSel.value === 'member' ? '/espace' : '/calendrier');
    },
  });
}
