// Mon espace : progression, assiduité, prochaines séances, cours, historique, données personnelles.
import { sb, unwrap } from '../supabaseClient.js';
import { h, field, button, badge, emptyState, formModal, toast, showError } from '../dom.js';
import { WEEKDAYS, fmtLong, fmtDay, fmtShort, hm, downloadJson } from '../util.js';
import { beltDot } from './members.js';

function card(title, ...children) {
  return h('section', { class: 'card space-card' }, h('h2', {}, title), ...children);
}

// ---------- iCalendar ----------
const icsEsc = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsFold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 73) { out.push(rest.slice(0, 73)); rest = ' ' + rest.slice(73); }
  out.push(rest);
  return out.join('\r\n');
}
const icsStamp = (date, time) => `${date.replace(/-/g, '')}T${hm(time).replace(':', '')}00`;

function buildIcs(sessions) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Club Wushu//Mon espace//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const s of sessions) {
    lines.push('BEGIN:VEVENT',
      `UID:${s.id}@club-wushu`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=Europe/Paris:${icsStamp(s.date, s.start_time)}`,
      `DTEND;TZID=Europe/Paris:${icsStamp(s.date, s.end_time)}`,
      `SUMMARY:${icsEsc(s.course)}`);
    if (s.location) lines.push(`LOCATION:${icsEsc(s.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

function downloadIcs(sessions) {
  const blob = new Blob([buildIcs(sessions)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'seances-club.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Sections ----------
function headerCard(data) {
  const cur = data.grades[0];
  return h('section', { class: 'card space-card space-hello' },
    h('h1', {}, `Bonjour ${data.member.first_name}`),
    h('p', { class: 'space-grade' }, cur
      ? ['Grade actuel : ', beltDot(cur), ' ', h('strong', {}, cur.name)]
      : 'Aucun grade pour le moment'));
}

function progressCard(data) {
  const cur = data.grades[0];
  const curRank = cur ? cur.rank : -Infinity;
  const next = data.belts.find((b) => b.rank > curRank);
  const path = h('ol', { class: 'belt-path', 'aria-label': 'Parcours des ceintures' });
  for (const b of data.belts) {
    const isCur = cur && b.rank === cur.rank;
    const done = b.rank <= curRank;
    const isNext = next && b.rank === next.rank;
    path.appendChild(h('li', { class: 'belt-step' + (done ? ' done' : '') + (isCur ? ' current' : '') + (isNext ? ' next' : '') },
      beltDot(b),
      h('span', { class: 'belt-name' }, b.name),
      isCur ? h('span', { class: 'belt-tag' }, 'Actuel') : null,
      isNext ? h('span', { class: 'belt-tag' }, 'Prochain objectif') : null));
  }
  return card('Ma progression',
    data.belts.length ? path : emptyState('Aucune ceinture définie.'),
    h('h3', {}, 'Historique des grades'),
    data.grades.length
      ? h('ul', { class: 'plain-list' }, data.grades.map((g) => h('li', {},
        h('span', { class: 'muted' }, fmtShort(g.date)), ' · ', beltDot(g), ' ', h('strong', {}, g.name),
        g.note ? h('span', { class: 'muted' }, ` – ${g.note}`) : null)))
      : emptyState('Aucun grade enregistré.'));
}

function streakOf(history) {
  let n = 0;
  for (const s of history) {
    if (s.status === 'cancelled') continue;
    if (s.present === true) n++;
    else break;
  }
  return n;
}

function attendanceCard(data) {
  const st = data.stats;
  const pct = st.sessions_90d > 0 ? Math.round((st.present_90d / st.sessions_90d) * 100) : null;
  const streak = streakOf(data.history);
  const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100,
    'aria-valuenow': pct === null ? null : pct, 'aria-label': 'Taux de présence sur 90 jours' },
    h('div', { class: 'progress-fill', style: { width: `${pct || 0}%` } }));
  return card('Mon assiduité',
    h('p', { class: 'space-big' }, pct === null ? '—' : `${pct} %`,
      h('span', { class: 'muted small' }, pct === null ? ' Aucune séance sur 90 jours' : ` de présence sur 90 jours (${st.present_90d} sur ${st.sessions_90d} séances)`)),
    bar,
    h('dl', { class: 'kv' },
      h('dt', {}, 'Présences au total'), h('dd', {}, String(st.present_total)),
      h('dt', {}, 'Série en cours'), h('dd', {}, streak > 0 ? `${streak} séance${streak > 1 ? 's' : ''} d’affilée` : 'Aucune'),
      st.first_presence ? [h('dt', {}, 'Pratiquant depuis'), h('dd', {}, fmtShort(st.first_presence))] : null));
}

function upcomingCard(data) {
  const list = h('ul', { class: 'space-list' });
  const hint = h('p', { class: 'hint' }, 'Prévenez votre enseignant : il voit vos réponses.');
  const body = h('div', {});
  const planned = data.upcoming.filter((s) => s.status === 'planned');

  function setRsvp(s, wanted, btns, row) {
    const next = s.rsvp === wanted ? null : wanted;
    btns.forEach((b) => { b.disabled = true; });
    sb.rpc('set_my_rsvp', { p_session_id: s.id, p_status: next }).then(({ error }) => {
      btns.forEach((b) => { b.disabled = false; });
      if (error) { showError(error); return; }
      s.rsvp = next;
      refresh(btns, s);
      toast(next === 'present' ? 'C’est noté : vous venez.' : next === 'absent' ? 'C’est noté : vous ne venez pas.' : 'Réponse retirée.', 'success');
    }, (e) => { btns.forEach((b) => { b.disabled = false; }); showError(e); });
  }
  function refresh(btns, s) {
    btns[0].setAttribute('aria-pressed', String(s.rsvp === 'present'));
    btns[1].setAttribute('aria-pressed', String(s.rsvp === 'absent'));
    btns[0].classList.toggle('on', s.rsvp === 'present');
    btns[1].classList.toggle('on', s.rsvp === 'absent');
  }

  for (const s of data.upcoming) {
    const cancelled = s.status === 'cancelled';
    const li = h('li', { class: 'space-item' + (cancelled ? ' is-cancelled' : '') },
      h('div', { class: 'space-item-head' },
        h('strong', {}, fmtDay(s.date)), ' ', h('span', {}, `${hm(s.start_time)}–${hm(s.end_time)}`),
        cancelled ? [' ', badge('Annulée', 'badge-off')] : null),
      h('div', {}, s.course, s.location ? h('span', { class: 'muted' }, ` · ${s.location}`) : null),
      s.instructor ? h('div', { class: 'muted small' }, `Avec ${s.instructor}`) : null);
    if (!cancelled) {
      const yes = h('button', { type: 'button', class: 'btn btn-sm rsvp-btn', 'aria-pressed': 'false' }, 'Je viens');
      const no = h('button', { type: 'button', class: 'btn btn-sm rsvp-btn rsvp-no', 'aria-pressed': 'false' }, 'Je ne viens pas');
      const btns = [yes, no];
      yes.addEventListener('click', () => setRsvp(s, 'present', btns, li));
      no.addEventListener('click', () => setRsvp(s, 'absent', btns, li));
      refresh(btns, s);
      li.appendChild(h('div', { class: 'btn-row', role: 'group', 'aria-label': `Ma réponse pour ${s.course}, ${fmtLong(s.date)}` }, yes, no));
    }
    list.appendChild(li);
  }

  if (!data.upcoming.length) body.appendChild(emptyState('Aucune séance prévue dans les 4 prochaines semaines.'));
  else body.append(list, hint);
  const actions = planned.length
    ? h('div', { class: 'btn-row' }, button('Ajouter à mon agenda (.ics)', () => downloadIcs(planned), 'btn-ghost'))
    : null;
  return card('Mes prochaines séances', body, actions);
}

function coursesCard(data) {
  if (!data.courses.length) return card('Mes cours', emptyState('Vous n’êtes inscrit à aucun cours pour le moment.'));
  const sorted = [...data.courses].sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
  return card('Mes cours', h('ul', { class: 'space-list' }, sorted.map((c) => h('li', { class: 'space-item' },
    h('div', { class: 'space-item-head' }, h('strong', {}, WEEKDAYS[c.weekday - 1]), ' ', `${hm(c.start_time)}–${hm(c.end_time)}`),
    h('div', {}, c.name, c.level ? h('span', { class: 'muted' }, ` · ${c.level}`) : null),
    c.location ? h('div', { class: 'muted small' }, c.location) : null,
    c.instructors && c.instructors.length ? h('div', { class: 'muted small' }, `Avec ${c.instructors.join(', ')}`) : null))));
}

function historyCard(data) {
  if (!data.history.length) return card('Historique', emptyState('Aucune séance passée pour le moment.'));
  return card('Historique', h('ul', { class: 'space-list' }, data.history.map((s) => {
    const pres = s.present === true ? badge('Présent', 'badge-ok')
      : s.present === false ? badge('Absent', 'badge-off')
        : h('span', { class: 'muted small' }, 'Non noté');
    const techs = s.techniques || [];
    const work = (s.summary || techs.length)
      ? h('details', { class: 'space-details' },
        h('summary', {}, 'Ce qui a été travaillé'),
        s.summary ? h('p', {}, s.summary) : null,
        techs.length ? h('div', { class: 'chips' }, techs.map((t) => h('span', { class: 'chip-tag' }, t))) : null)
      : null;
    return h('li', { class: 'space-item' },
      h('div', { class: 'row-between' },
        h('div', {}, h('strong', {}, fmtDay(s.date)), ' · ', s.course,
          s.status === 'cancelled' ? [' ', badge('Annulée', 'badge-off')] : null),
        s.status === 'cancelled' ? null : pres),
      work);
  })));
}

function techniquesCard(data) {
  const list = [...(data.techniques_90d || [])].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'));
  return card('Techniques travaillées (90 jours)', list.length
    ? h('div', { class: 'chips' }, list.map((t) => h('span', { class: 'chip-tag', title: t.category || null },
      t.name, h('span', { class: 'chip-count' }, ` × ${t.count}`))))
    : emptyState('Aucune technique enregistrée sur les 90 derniers jours.'));
}

async function openContact() {
  let row = {};
  try {
    const rows = await unwrap(sb.rpc('get_my_contact'));
    row = (Array.isArray(rows) && rows[0]) || {};
  } catch (e) { showError(e); return; }
  const email = h('input', { type: 'email', maxlength: 254, value: row.email || '', autocomplete: 'email' });
  const phone = h('input', { type: 'tel', maxlength: 30, value: row.phone || '', autocomplete: 'tel' });
  const emerg = h('input', { type: 'text', maxlength: 200, value: row.emergency || '' });
  formModal({
    title: 'Mes coordonnées',
    body: [
      field('Email', email),
      field('Téléphone', phone),
      field('Contact d’urgence', emerg, 'Nom et téléphone d’une personne à prévenir. N’indiquez aucune information de santé.'),
      h('p', { class: 'muted' }, `Numéro de licence : ${row.license || '—'} (géré par le club)`),
    ],
    onSubmit: async () => {
      await unwrap(sb.rpc('set_my_contact', { p_email: email.value.trim(), p_phone: phone.value.trim(), p_emergency: emerg.value.trim() }));
      toast('Coordonnées enregistrées.', 'success');
    },
  });
}

function dataCard() {
  const exportBtn = button('Télécharger mes données', async () => {
    exportBtn.disabled = true;
    try {
      const obj = await unwrap(sb.rpc('export_my_data'));
      downloadJson(obj, 'mes-donnees-club.json');
      toast('Fichier téléchargé.', 'success');
    } catch (e) { showError(e); } finally { exportBtn.disabled = false; }
  });
  return card('Mes données',
    h('div', { class: 'btn-row' }, button('Mes coordonnées', openContact), exportBtn),
    h('p', { class: 'muted small' }, 'Vous pouvez demander à un administrateur du club de corriger ou de supprimer vos données. ',
      h('a', { href: '#/confidentialite' }, 'En savoir plus sur la confidentialité'), '.'));
}

export async function renderSpace(root) {
  const data = await unwrap(sb.rpc('member_space'));
  if (!data || data.linked === false) {
    root.appendChild(h('div', { class: 'card' }, h('h1', {}, 'Mon espace'),
      h('p', {}, 'Votre compte n’est pas encore relié à une fiche de pratiquant. Demandez à un responsable du club de la relier.')));
    return;
  }
  data.grades = data.grades || [];
  data.belts = data.belts || [];
  data.courses = data.courses || [];
  data.upcoming = data.upcoming || [];
  data.history = data.history || [];
  data.stats = data.stats || { sessions_90d: 0, present_90d: 0, present_total: 0, first_presence: null };
  root.append(
    headerCard(data), progressCard(data), attendanceCard(data), upcomingCard(data),
    coursesCard(data), historyCard(data), techniquesCard(data), dataCard());
}
