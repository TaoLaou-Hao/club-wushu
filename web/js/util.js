// Utilitaires : dates (fr-FR), libellés, messages d'erreur.
import { setErrorFormatter } from './dom.js';

export const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
export const STATUS_LABEL = { planned: 'Prévue', done: 'Terminée', cancelled: 'Annulée' };
export const ROLE_LABEL = { pending: 'En attente', member: 'Membre', teacher: 'Enseignant', admin: 'Administrateur' };

const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => iso(new Date());
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const fLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const fMonth = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const fShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const fStamp = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const asDate = (x) => (typeof x === 'string' ? parseDate(x) : x);
export const fmtLong = (x) => cap(fLong.format(asDate(x)));
export const fmtDay = (x) => cap(fDay.format(asDate(x)));
export const fmtMonth = (x) => cap(fMonth.format(asDate(x)));
export const fmtShort = (x) => fShort.format(asDate(x));
export const fmtStamp = (ts) => (ts ? fStamp.format(new Date(ts)) : '—');
export const hm = (t) => (t || '').slice(0, 5);

export const fullName = (m) => `${m.first_name} ${m.last_name}`;
export const byMemberName = (a, b) =>
  a.last_name.localeCompare(b.last_name, 'fr') || a.first_name.localeCompare(b.first_name, 'fr');

// Normalise pour la recherche (insensible aux accents et à la casse)
export const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Messages d'erreur conviviaux. Les RPC lèvent déjà des messages en français (code P0001).
export function errMsg(e) {
  if (!e) return 'Une erreur est survenue.';
  const code = e.code;
  const msg = e.message || '';
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Connexion impossible. Vérifiez votre réseau.';
  if (code === 'P0001') return msg;
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'Action non autorisée avec votre rôle.';
  if (code === '23505') return 'Cet élément existe déjà.';
  if (code === '23503') return "Action impossible : cet élément est lié à d'autres données.";
  if (code === '23514' || code === '22001' || code === '22P02') return 'Valeur invalide, incohérente ou trop longue.';
  if (/jwt|expired/i.test(msg)) return 'Session expirée. Reconnectez-vous.';
  return 'Une erreur est survenue. Réessayez.';
}
setErrorFormatter(errMsg);

// Téléchargement d'un objet JSON (via Blob, aucune donnée conservée).
export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Export CSV (séparateur « ; », BOM UTF-8 pour Excel). rows = tableau de tableaux.
export function downloadCsv(rows, filename) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = '\uFEFF' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Export iCalendar. events = [{uid, date 'YYYY-MM-DD', start 'HH:MM[:SS]', end, title, location}]
export function downloadIcs(events, filename) {
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Club Wushu//FR', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    const full = (t) => { const p = (t || '00:00').split(':'); return `${p[0] || '00'}${p[1] || '00'}${p[2] || '00'}`; };
    lines.push('BEGIN:VEVENT',
      `UID:${esc(e.uid)}@club-wushu`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Paris:${e.date.replace(/-/g, '')}T${full(e.start)}`,
      `DTEND;TZID=Europe/Paris:${e.date.replace(/-/g, '')}T${full(e.end)}`,
      `SUMMARY:${esc(e.title)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
