// Aperçu « Voir comme » (administrateur uniquement).
// L'admin choisit une fiche enseignant ou membre : l'interface s'affiche comme pour
// cette personne. C'est un APERÇU D'INTERFACE en LECTURE SEULE :
//  * toutes les écritures (insert/update/upsert/delete) et les RPC non listées sont bloquées ;
//  * my_member_id() renvoie la fiche choisie ; member_space() affiche les données de cette fiche
//    (la base vérifie que l'appelant est bien administrateur).
// Les droits réels du compte ne changent jamais : aucune élévation n'est possible par ce biais.
import { sb } from './supabaseClient.js';

const KEY = 'club_view_as';
let current = null; // { role: 'teacher'|'member', memberId, name }

try { current = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { current = null; }

export const viewAs = () => current;

export function enter(v) {
  current = { role: v.role === 'member' ? 'member' : 'teacher', memberId: v.memberId, name: v.name };
  try { sessionStorage.setItem(KEY, JSON.stringify(current)); } catch { /* ignore */ }
  window.dispatchEvent(new Event('profile-updated'));
}

export function exit() {
  current = null;
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  window.dispatchEvent(new Event('profile-updated'));
}

// À appeler quand le compte connecté n'est pas (ou plus) administrateur.
export function reset() {
  current = null;
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

const READ_RPC = new Set(['my_member_id', 'member_space', 'current_role_name', 'is_admin', 'is_staff', 'is_active_account']);
const WRITE_METHODS = ['insert', 'update', 'upsert', 'delete'];
const blockedError = () => ({ data: null, error: new Error('Aperçu en lecture seule : quittez l’aperçu pour modifier.') });

// Objet « requête » inerte : toute méthode chaînée renvoie lui-même, l'await renvoie l'erreur.
function blocked() {
  const p = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (res, rej) => Promise.resolve(blockedError()).then(res, rej);
      return () => p;
    },
    apply() { return p; },
  });
  return p;
}

if (sb) {
  const from = sb.from.bind(sb);
  const rpc = sb.rpc.bind(sb);
  sb.from = (table) => {
    const qb = from(table);
    if (!current) return qb;
    for (const m of WRITE_METHODS) qb[m] = () => blocked();
    return qb;
  };
  sb.rpc = (fn, args, opts) => {
    if (!current) return rpc(fn, args, opts);
    if (fn === 'my_member_id') return Promise.resolve({ data: current.memberId, error: null });
    if (fn === 'member_space') return rpc(fn, { ...(args || {}), p_member_id: current.memberId }, opts);
    if (!READ_RPC.has(fn)) return blocked();
    return rpc(fn, args, opts);
  };
}
