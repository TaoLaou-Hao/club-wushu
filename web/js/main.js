// Point d'entrée : état d'authentification, coquille de l'application, routage.
import { sb, configured, libraryLoaded } from './supabaseClient.js';
import { h, clear, loading, showError, toast, badge } from './dom.js';
import { ROLE_LABEL, errMsg as errText } from './util.js';
import * as auth from './auth.js';
import * as router from './router.js';
import { setupScreen, loginScreen, recoveryScreen, pendingScreen, errorScreen, privacyStandalone } from './views/authviews.js';
import { privacyContent } from './views/privacy.js';
import { renderCalendar } from './views/calendar.js';
import { renderSession } from './views/session.js';
import { renderCourses } from './views/courses.js';
import { renderMembers } from './views/members.js';
import { renderMember } from './views/member.js';
import { renderAdmin } from './views/admin.js';
import { renderAccount } from './views/account.js';

const root = document.getElementById('app');
let viewBox = null;
let navEl = null;
let booted = false; // vrai après le premier rendu d'authentification

// ----- Routes -----
router.register('/calendrier', renderCalendar);
router.register('/seance/:id', renderSession);
router.register('/cours', renderCourses);
router.register('/membres', renderMembers);
router.register('/membre/:id', renderMember);
router.register('/admin', renderAdmin, { admin: true });
router.register('/compte', renderAccount);
router.register('/confidentialite', (el) => { el.appendChild(h('div', { class: 'card' }, privacyContent())); });

// ----- Rendu global -----
function render() {
  clear(root);
  viewBox = null;
  if (!configured || !sb) { root.appendChild(setupScreen(!libraryLoaded)); return; }
  if (auth.state.recovery) {
    root.appendChild(recoveryScreen(finishRecovery));
    return;
  }
  if (!auth.state.user) {
    auth.stopIdle();
    root.appendChild(router.currentPath() === '/confidentialite' ? privacyStandalone() : loginScreen());
    return;
  }
  if (!auth.state.profile) {
    root.appendChild(errorScreen('Profil introuvable. Déconnectez-vous puis reconnectez-vous.', logout));
    return;
  }
  if (auth.state.profile.role === 'pending') {
    root.appendChild(pendingScreen(refreshProfile, logout));
    return;
  }
  buildShell();
  routeView();
}

function buildShell() {
  const p = auth.state.profile;
  const links = [
    ['/calendrier', 'Calendrier'],
    ['/cours', 'Cours'],
    ['/membres', 'Membres'],
    ...(auth.isAdmin() ? [['/admin', 'Administration']] : []),
    ['/compte', 'Mon compte'],
  ];
  const toggle = h('button', {
    type: 'button', class: 'nav-toggle', 'aria-expanded': 'false', 'aria-controls': 'main-nav',
    onclick: () => {
      const open = navEl.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    },
  }, 'Menu');
  navEl = h('nav', { id: 'main-nav', class: 'nav', 'aria-label': 'Navigation principale' },
    links.map(([path, label]) => h('a', { href: '#' + path, dataset: { path } }, label)),
    h('button', { type: 'button', class: 'nav-logout', onclick: logout }, 'Déconnexion'));
  viewBox = h('main', { id: 'view', class: 'view', tabindex: '-1' });
  root.append(
    h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '#/calendrier' }, 'Club Wushu – Section technique'),
      h('span', { class: 'who' }, p.full_name || 'Utilisateur', ' ',
        badge(ROLE_LABEL[p.role], p.role === 'admin' ? 'badge-admin' : 'badge-teacher')),
      toggle, navEl),
    viewBox,
    h('footer', { class: 'footer' }, h('a', { href: '#/confidentialite' }, 'Confidentialité')));
}

async function routeView() {
  if (!viewBox) return;
  const path = router.currentPath();
  const t = router.nextToken();
  const hit = router.resolve(path === '/' ? '/calendrier' : path);
  if (!hit) { router.go('/calendrier'); return; }
  if (hit.route.opts.admin && !auth.isAdmin()) { router.go('/calendrier'); return; }
  const base = '/' + (path.split('/')[1] || 'calendrier');
  navEl.classList.remove('open');
  navEl.querySelectorAll('a').forEach((a) => {
    if (a.dataset.path === base || (base === '/seance' && a.dataset.path === '/calendrier') || (base === '/membre' && a.dataset.path === '/membres')) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const container = h('div');
  clear(viewBox).appendChild(loading());
  try {
    await hit.route.handler(container, hit.params, { isStale: () => !router.isCurrent(t) });
    if (!router.isCurrent(t)) return;
    clear(viewBox).appendChild(container);
    window.scrollTo(0, 0);
  } catch (e) {
    if (!router.isCurrent(t)) return;
    clear(viewBox).appendChild(h('div', { class: 'card' }, h('p', { class: 'form-error', role: 'alert' }, 'Chargement impossible : ' + errText(e))));
  }
}

window.addEventListener('profile-updated', () => render());
window.addEventListener('hashchange', () => {
  if (!configured || !sb) return;
  if (auth.state.user && auth.state.profile && auth.state.profile.role !== 'pending' && !auth.state.recovery) routeView();
  else if (!auth.state.user) render(); // bascule connexion <-> confidentialité
});

// ----- Session -----
async function logout() {
  try { await auth.signOut(); } catch (e) { showError(e); }
}

async function finishRecovery() {
  auth.state.recovery = false;
  try {
    if (!auth.state.profile && auth.state.user) await auth.loadProfile();
    auth.startIdle(() => { logout(); });
  } catch (e) { showError(e); }
  render();
}

async function refreshProfile() {
  try { await auth.loadProfile(); render(); } catch (e) { showError(e); }
}

// Appelé à chaque changement d'état d'authentification (hors TOKEN_REFRESHED, sans re-rendu inutile).
async function sync(event, session) {
  if (event === 'PASSWORD_RECOVERY') {
    auth.state.recovery = true;
    auth.state.user = session ? session.user : null;
    render();
    return;
  }
  const newId = session && session.user ? session.user.id : null;
  const oldId = auth.state.user ? auth.state.user.id : null;
  if (booted && newId === oldId && event !== 'SIGNED_OUT') { if (session) auth.state.user = session.user; return; }
  booted = true;
  auth.state.user = session ? session.user : null;
  auth.state.profile = null;
  if (!newId) { auth.state.recovery = false; render(); return; }
  try {
    await auth.loadProfile();
    if (event === 'SIGNED_IN' && !oldId) auth.markActive();
    auth.startIdle(() => { logout(); });
  } catch (e) {
    showError(e);
  }
  render();
}

async function boot() {
  if (!configured || !sb) { render(); return; }
  sb.auth.onAuthStateChange((event, session) => {
    // setTimeout : évite d'appeler Supabase à l'intérieur du callback (risque de blocage)
    setTimeout(() => sync(event, session), 0);
  });
  // Erreur éventuelle renvoyée par le fournisseur OAuth
  const q = new URLSearchParams(location.search);
  if (q.get('error_description') || q.get('error')) {
    auth.state.notice = 'Connexion impossible. Réessayez ou utilisez votre email.';
    history.replaceState(null, '', location.pathname + location.hash);
  }
  try {
    const { data } = await sb.auth.getSession();
    if (location.search.includes('code=')) history.replaceState(null, '', location.pathname + location.hash);
    await sync('INITIAL_SESSION', data.session);
  } catch (e) {
    render();
  }
}
boot();
