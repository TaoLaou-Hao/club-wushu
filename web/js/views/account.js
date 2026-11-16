// Mon compte : nom, mot de passe, rôle, déconnexion.
import { sb, unwrap } from '../supabaseClient.js';
import { h, field, toast, showError } from '../dom.js';
import * as auth from '../auth.js';
import { ROLE_LABEL } from '../util.js';

export async function renderAccount(root) {
  const p = auth.state.profile;
  const name = h('input', { type: 'text', required: true, maxlength: 100, value: p.full_name || '', autocomplete: 'name' });
  const p1 = h('input', { type: 'password', required: true, minlength: 10, maxlength: 200, autocomplete: 'new-password' });
  const p2 = h('input', { type: 'password', required: true, minlength: 10, maxlength: 200, autocomplete: 'new-password' });
  const pwMsg = h('p', { class: 'form-error', role: 'alert', hidden: true });

  root.append(
    h('h1', {}, 'Mon compte'),
    h('div', { class: 'card' },
      h('h2', {}, 'Informations'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Email'), h('dd', {}, auth.state.user.email || '—'),
        h('dt', {}, 'Rôle'), h('dd', {}, ROLE_LABEL[p.role])),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            await unwrap(sb.from('profiles').update({ full_name: name.value.trim() }).eq('id', p.id));
            p.full_name = name.value.trim();
            toast('Nom mis à jour.', 'success');
            window.dispatchEvent(new Event('profile-updated'));
          } catch (err) { showError(err); }
        },
      }, field('Nom complet', name), h('button', { type: 'submit', class: 'btn btn-primary' }, 'Enregistrer le nom'))),
    h('div', { class: 'card' },
      h('h2', {}, 'Changer le mot de passe'),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          pwMsg.hidden = true;
          try {
            if (p1.value.length < 10) throw new Error('Le mot de passe doit contenir au moins 10 caractères.');
            if (p1.value !== p2.value) throw new Error('Les deux mots de passe ne correspondent pas.');
            await auth.updatePassword(p1.value);
            p1.value = ''; p2.value = '';
            toast('Mot de passe modifié.', 'success');
          } catch (err) { pwMsg.textContent = err.message; pwMsg.hidden = false; }
        },
      }, field('Nouveau mot de passe', p1, '10 caractères minimum.'), field('Confirmer le mot de passe', p2), pwMsg,
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Changer le mot de passe'))),
    h('div', { class: 'card' },
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => auth.signOut().catch(showError) }, 'Déconnexion'),
        h('a', { class: 'btn btn-ghost', href: '#/confidentialite' }, 'Politique de confidentialité'))));
}
