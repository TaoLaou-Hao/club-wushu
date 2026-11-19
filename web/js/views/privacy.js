// Notice de confidentialité (texte statique).
import { h } from '../dom.js';

export function privacyContent() {
  const sec = (title, ...body) => h('section', {}, h('h2', {}, title), ...body);
  return h('article', { class: 'prose' },
    h('h1', {}, 'Politique de confidentialité'),
    h('p', { class: 'muted' }, 'Club Wushu – Section technique. Cette notice explique comment vos données et celles des adhérents sont traitées.'),
    sec('Responsable du traitement',
      h('p', {}, 'Le club (section technique de wushu). Pour toute question, contactez le responsable de la section.')),
    sec('Finalités',
      h('ul', {},
        h('li', {}, 'Organisation des cours et des séances.'),
        h('li', {}, 'Suivi des présences.'),
        h('li', {}, 'Suivi des grades.'),
        h('li', {}, 'Information des pratiquants sur leur planning et leur progression, et réponses « Je viens / Je ne viens pas » aux séances.'))),
    sec('Base légale',
      h('p', {}, 'Exécution de l’adhésion au club et intérêt légitime du club à organiser son activité.')),
    sec('Données traitées',
      h('p', {}, 'Nom, prénom, année de naissance, coordonnées (email, téléphone, contact d’urgence, numéro de licence) stockées sous forme chiffrée, présences et grades. Aucune donnée de santé ne doit être saisie.')),
    sec('Destinataires',
      h('p', {}, 'Les enseignants et les administrateurs de la section uniquement. Chaque consultation des coordonnées est enregistrée dans un journal.'),
      h('p', {}, 'Si vous avez un compte relié à votre fiche, vous voyez vos propres données dans « Mon espace » (jamais celles des autres pratiquants, ni les notes internes des enseignants).')),
    sec('Hébergement',
      h('p', {}, 'Les données sont hébergées par Supabase, dans l’Union européenne.')),
    sec('Durée de conservation',
      h('p', {}, 'Les données d’un adhérent sont conservées 3 ans après son départ, puis anonymisées. Le journal d’audit est conservé 1 an.')),
    sec('Vos droits',
      h('p', {}, 'Vous disposez des droits d’accès, de rectification, d’effacement, d’opposition, de limitation et de portabilité. Depuis « Mon espace », vous pouvez télécharger vos données et corriger vos coordonnées. Pour les autres demandes, contactez le responsable de la section.'),
      h('p', {}, 'Vous pouvez aussi introduire une réclamation auprès de la CNIL : www.cnil.fr.')));
}
