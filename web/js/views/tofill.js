// Encart « Cours à pourvoir » : séances des 24 prochaines heures, sans intervenant,
// avec au moins un pratiquant qui a annoncé sa venue. Visible des enseignants habilités.
import { sb, unwrap } from '../supabaseClient.js';
import { h, button, toast, showError } from '../dom.js';
import { fmtDay, hm } from '../util.js';
import * as router from '../router.js';

export async function toFillPanel() {
  let list;
  try { list = await unwrap(sb.rpc('open_sessions_to_fill')); } catch { return null; }
  if (!Array.isArray(list) || !list.length) return null;

  const box = h('section', { class: 'card tofill', 'aria-label': 'Cours à pourvoir' });
  const render = () => {
    box.replaceChildren(
      h('h2', {}, list.length > 1 ? 'Cours à pourvoir' : 'Un cours à pourvoir'),
      h('p', { class: 'muted' }, 'Des pratiquants ont annoncé leur venue et personne n’est encore affecté.'),
      ...list.map((s) => h('div', { class: 'tofill-row' },
        h('div', {},
          h('strong', {}, `${fmtDay(s.date)} · ${hm(s.start_time)}–${hm(s.end_time)}`),
          h('div', {}, s.course + (s.location ? ' · ' + s.location : '')),
          h('div', { class: 'muted' }, s.declared > 1 ? `${s.declared} pratiquants prévus` : '1 pratiquant prévu')),
        h('div', { class: 'tofill-actions' },
          button('Je prends ce cours', async () => {
            try {
              await unwrap(sb.rpc('claim_session', { p_session_id: s.id }));
              list = list.filter((x) => x.id !== s.id);
              toast('Cours pris : vous êtes l’intervenant.');
              list.length ? render() : box.remove();
              router.go('/seance/' + s.id);
            } catch (e) { showError(e); }
          }, 'btn-primary'),
          h('a', { class: 'btn', href: '#/seance/' + s.id }, 'Voir la séance')))));
  };
  render();
  return box;
}
