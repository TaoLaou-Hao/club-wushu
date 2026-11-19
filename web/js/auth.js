// Authentification, profil et déconnexion automatique après inactivité.
import { sb } from './supabaseClient.js';
import { viewAs } from './preview.js';

export const state = {
  user: null,
  profile: null,
  recovery: false, // true pendant la réinitialisation de mot de passe
  notice: null,    // message affiché sur l'écran de connexion
};

// Rôle réel du compte (jamais modifié par l'aperçu)
export const realRole = () => (state.profile ? state.profile.role : null);
export const isRealAdmin = () => realRole() === 'admin';
// Rôle effectif pour l'interface : en aperçu « Voir comme », celui de la fiche choisie
export const role = () => {
  const r = realRole();
  const v = viewAs();
  return r === 'admin' && v ? v.role : r;
};
export const isAdmin = () => role() === 'admin';
export const isStaff = () => ['teacher', 'admin'].includes(role());
export const isMember = () => role() === 'member';

export async function loadProfile() {
  const { data, error } = await sb.from('profiles').select('id,full_name,role').eq('id', state.user.id).maybeSingle();
  if (error) throw error;
  state.profile = data;
  return data;
}

// Traduction des erreurs Supabase Auth (anglais) en français.
export function authErrMsg(e) {
  const code = e && e.code;
  const msg = (e && e.message) || '';
  if (code === 'invalid_credentials' || /invalid login/i.test(msg)) return 'Email ou mot de passe incorrect.';
  if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) return "Adresse email non confirmée. Consultez votre boîte mail.";
  if (code === 'user_already_exists' || /already registered/i.test(msg)) return 'Un compte existe déjà avec cet email.';
  if (code === 'weak_password' || /password/i.test(msg) && /(short|weak|least)/i.test(msg)) return 'Mot de passe trop faible (10 caractères minimum).';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || /rate limit/i.test(msg)) return 'Trop de tentatives. Patientez quelques minutes.';
  if (code === 'same_password' || /different from the old/i.test(msg)) return "Le nouveau mot de passe doit être différent de l'ancien.";
  if (/failed to fetch|network/i.test(msg)) return 'Connexion impossible. Vérifiez votre réseau.';
  if (code === 'email_address_invalid' || /invalid.*email/i.test(msg)) return 'Adresse email invalide.';
  return 'Une erreur est survenue. Réessayez.';
}

const appUrl = () => location.origin + location.pathname;

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(authErrMsg(error));
}

// Retourne true si une session est ouverte directement, false si confirmation email requise.
export async function signUp(email, password, fullName) {
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { full_name: fullName }, emailRedirectTo: appUrl() },
  });
  if (error) throw new Error(authErrMsg(error));
  return !!data.session;
}

export async function signInGoogle() {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } });
  if (error) throw new Error(authErrMsg(error));
}

export async function resetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
  if (error) throw new Error(authErrMsg(error));
}

export async function updatePassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw new Error(authErrMsg(error));
}

export async function signOut() {
  stopIdle();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  await sb.auth.signOut();
}

// Connexion fraîche : repart d'un horodatage d'activité neuf
export function markActive() { writeStored(Date.now()); }

// ---------- Déconnexion automatique (30 min d'inactivité) ----------
// L'horodatage de dernière activité (aucune donnée personnelle) est partagé
// entre onglets et survit à la fermeture du navigateur : rouvrir l'appli après
// 30 min d'inactivité impose une reconnexion, même si la session est persistée.
const IDLE_MS = 30 * 60 * 1000;
const KEY = 'club_last_activity';
let lastActivity = Date.now();
let idleTimer = null;
let onIdle = null;
const EVENTS = ['mousemove', 'keydown', 'touchstart', 'click', 'scroll'];

function readStored() {
  try { const v = Number(localStorage.getItem(KEY)); return Number.isFinite(v) ? v : 0; } catch { return 0; }
}
function writeStored(v) {
  try { localStorage.setItem(KEY, String(v)); } catch { /* stockage indisponible */ }
}
function bump() {
  const now = Date.now();
  if (now - lastActivity > 1000) { lastActivity = now; writeStored(now); }
}
function check() {
  const last = Math.max(lastActivity, readStored());
  if (Date.now() - last >= IDLE_MS) {
    stopIdle();
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    state.notice = 'Vous avez été déconnecté après 30 minutes d’inactivité.';
    if (onIdle) onIdle();
  }
}
export function startIdle(callback) {
  stopIdle();
  onIdle = callback;
  const stored = readStored();
  if (stored && Date.now() - stored >= IDLE_MS) {
    lastActivity = stored;
    check();
    return;
  }
  lastActivity = Date.now();
  writeStored(lastActivity);
  EVENTS.forEach((e) => window.addEventListener(e, bump, { passive: true }));
  document.addEventListener('visibilitychange', check);
  idleTimer = setInterval(check, 15000);
}
export function stopIdle() {
  EVENTS.forEach((e) => window.removeEventListener(e, bump));
  document.removeEventListener('visibilitychange', check);
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = null;
}
