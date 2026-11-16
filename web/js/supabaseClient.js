// Création du client Supabase (une seule instance).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Vrai si config.js a été renseigné (plus de valeurs d'exemple).
export const configured =
  /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(SUPABASE_URL) &&
  !SUPABASE_URL.includes('VOTRE') &&
  !SUPABASE_ANON_KEY.includes('VOTRE') &&
  SUPABASE_ANON_KEY.length > 20;

export const libraryLoaded = typeof window.supabase !== 'undefined';

// PKCE : le retour OAuth / réinitialisation arrive par ?code=..., ce qui
// évite de mélanger les jetons avec le routeur par hash (#/...).
export const sb = configured && libraryLoaded
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// Lance une requête supabase-js et lève l'erreur si présente.
export async function unwrap(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}
