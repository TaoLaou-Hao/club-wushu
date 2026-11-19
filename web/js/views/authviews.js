// Écrans hors application : configuration, connexion, récupération, compte en attente.
import { h, clear, append, field, toast, showError } from '../dom.js';
import * as auth from '../auth.js';
import { sb } from '../supabaseClient.js';
import { errMsg } from '../util.js';
import { privacyContent } from './privacy.js';

const TITLE = 'Club Wushu – Section technique';

function card(...children) {
  return h('main', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
    h('h1', { class: 'brand-title' }, TITLE), ...children),
    h('footer', { class: 'footer' }, h('a', { href: '#/confidentialite' }, 'Confidentialité')));
}

export function setupScreen(libraryMissing) {
  return card(
    h('h2', {}, 'Configuration requise'),
    libraryMissing
      ? h('p', {}, 'La bibliothèque Supabase (vendor/supabase.js) est introuvable. Vérifiez le déploiement du dossier « vendor ».')
      : h('div', {},
        h('p', {}, 'L’application n’est pas encore reliée à votre projet Supabase.'),
        h('ol', {},
          h('li', {}, 'Créez un projet Supabase (région UE) et exécutez supabase/schema.sql dans le SQL Editor.'),
          h('li', {}, 'Ouvrez le fichier js/config.js.'),
          h('li', {}, 'Remplacez SUPABASE_URL et SUPABASE_ANON_KEY par les valeurs de Project Settings > API (clé « anon public »).'),
          h('li', {}, 'Rechargez cette page.'))));
}

export function privacyStandalone() {
  return h('main', { class: 'auth-wrap' }, h('div', { class: 'auth-card wide' },
    privacyContent(),
    h('p', {}, h('a', { class: 'btn btn-primary', href: '#/' }, 'Retour'))));
}

export function errorScreen(message, onLogout) {
  return card(h('p', { class: 'form-error', role: 'alert' }, message),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: onLogout }, 'Se déconnecter'));
}

// ---------- Connexion / inscription / mot de passe oublié ----------
export function loginScreen() {
  let mode = 'login'; // login | signup | forgot
  const box = h('div');
  const notice = auth.state.notice;
  auth.state.notice = null;

  function draw() {
    clear(box);
    const msg = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const info = h('p', { class: 'form-info', role: 'status', hidden: true });
    const email = h('input', { type: 'email', required: true, autocomplete: 'email', maxlength: 254 });
    const pw = h('input', { type: 'password', required: true, minlength: mode === 'signup' ? 10 : null, autocomplete: mode === 'signup' ? 'new-password' : 'current-password', maxlength: 200 });
    const name = h('input', { type: 'text', required: true, autocomplete: 'name', maxlength: 100 });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' },
      mode === 'login' ? 'Se connecter' : mode === 'signup' ? 'Créer mon compte' : 'Envoyer le lien');

    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        msg.hidden = true; info.hidden = true;
        submit.disabled = true;
        try {
          if (mode === 'login') {
            await auth.signIn(email.value.trim(), pw.value);
          } else if (mode === 'signup') {
            if (pw.value.length < 10) throw new Error('Le mot de passe doit contenir au moins 10 caractères.');
            const direct = await auth.signUp(email.value.trim(), pw.value, name.value.trim());
            if (!direct) {
              info.textContent = 'Compte créé. Vérifiez votre boîte mail pour confirmer votre adresse, puis connectez-vous.';
              info.hidden = false;
            }
          } else {
            await auth.resetPassword(email.value.trim());
            info.textContent = 'Si cette adresse correspond à un compte, un lien de réinitialisation vient d’être envoyé.';
            info.hidden = false;
          }
        } catch (err) {
          msg.textContent = err.message;
          msg.hidden = false;
        } finally {
          submit.disabled = false;
        }
      },
    },
      mode === 'signup' ? field('Nom complet', name) : null,
      field('Adresse email', email),
      mode !== 'forgot' ? field('Mot de passe', pw, mode === 'signup' ? '10 caractères minimum.' : null) : null,
      msg, info, submit);

    const google = h('button', {
      type: 'button', class: 'btn btn-block',
      onclick: async () => { try { await auth.signInGoogle(); } catch (err) { showError(err); } },
    }, 'Continuer avec Google');

    const links = h('div', { class: 'auth-links' },
      mode !== 'login' ? linkBtn('Déjà un compte ? Se connecter', () => { mode = 'login'; draw(); }) : null,
      mode !== 'signup' ? linkBtn('Créer un compte', () => { mode = 'signup'; draw(); }) : null,
      mode === 'login' ? linkBtn('Mot de passe oublié ?', () => { mode = 'forgot'; draw(); }) : null);

    append(box, [
      h('h2', {}, mode === 'login' ? 'Connexion' : mode === 'signup' ? 'Créer un compte' : 'Mot de passe oublié'),
      form,
      mode !== 'forgot' ? h('div', { class: 'sep' }, h('span', {}, 'ou')) : null,
      mode !== 'forgot' ? google : null,
      links]);
  }
  draw();
  return card(notice ? h('p', { class: 'form-info', role: 'status' }, notice) : null, box);
}

const linkBtn = (label, fn) => h('button', { type: 'button', class: 'linklike', onclick: fn }, label);

// ---------- Nouveau mot de passe (événement PASSWORD_RECOVERY) ----------
export function recoveryScreen(onDone) {
  const p1 = h('input', { type: 'password', required: true, minlength: 10, autocomplete: 'new-password', maxlength: 200 });
  const p2 = h('input', { type: 'password', required: true, minlength: 10, autocomplete: 'new-password', maxlength: 200 });
  const msg = h('p', { class: 'form-error', role: 'alert', hidden: true });
  return card(
    h('h2', {}, 'Nouveau mot de passe'),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        msg.hidden = true;
        try {
          if (p1.value.length < 10) throw new Error('Le mot de passe doit contenir au moins 10 caractères.');
          if (p1.value !== p2.value) throw new Error('Les deux mots de passe ne correspondent pas.');
          await auth.updatePassword(p1.value);
          toast('Mot de passe modifié.', 'success');
          onDone();
        } catch (err) { msg.textContent = err.message; msg.hidden = false; }
      },
    },
      field('Nouveau mot de passe', p1, '10 caractères minimum.'),
      field('Confirmer le mot de passe', p2),
      msg,
      h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Enregistrer')));
}

// ---------- Compte en attente de validation ----------
export function pendingScreen(onRefresh, onLogout) {
  const code = h('input', { type: 'text', required: true, maxlength: 40, autocomplete: 'off', autocapitalize: 'characters', placeholder: 'WS-XXXX-XXXX-XXXX-XXXX' });
  const msg = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Valider le code');
  return card(
    h('h2', {}, 'Compte en attente de validation'),
    h('p', {}, `Bonjour ${auth.state.profile.full_name || ''}, votre compte a bien été créé. Un administrateur doit le valider avant que vous puissiez accéder à l’application.`),
    h('p', {}, 'Si le club vous a remis un code (code d’activation ou code enseignant), saisissez-le ci-dessous.'),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        msg.hidden = true;
        submit.disabled = true;
        try {
          const { data, error } = await sb.rpc('redeem_invite_code', { p_code: code.value });
          if (error) throw error;
          if (data === 'ok') { toast('Code accepté. Bienvenue !', 'success'); await onRefresh(); }
          else { msg.textContent = 'Code invalide, expiré ou déjà utilisé.'; msg.hidden = false; }
        } catch (err) { msg.textContent = errMsg(err); msg.hidden = false; }
        finally { submit.disabled = false; }
      },
    }, field('Code', code), msg, submit),
    h('div', { class: 'auth-links' },
      linkBtn('Vérifier à nouveau mon statut', onRefresh),
      linkBtn('Se déconnecter', onLogout)));
}
