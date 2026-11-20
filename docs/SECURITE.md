# Sécurité et gouvernance des données – Section technique

> **Document modèle à faire valider par le bureau du club. Ce n'est pas un avis juridique.**

Ce document décrit les choix de sécurité de l'application (phase 1 : enseignants et administrateurs). Il sert de référence pour les personnes qui maintiennent l'application et pour la revue trimestrielle. Les règles décrites ici sont celles du fichier `supabase/schema.sql`, qui fait foi.

---

## 1. Principes

- **Moindre privilège** : chaque personne ne voit et ne modifie que ce dont elle a besoin. La protection est appliquée par la base (RLS), pas seulement par l'écran.
- **Aucun accès anonyme** aux données : seule la fonction `keepalive` (sans donnée) est accessible sans connexion.
- **Minimisation** : pas de date de naissance complète (année seulement), pas de données de santé, coordonnées séparées et chiffrées.
- **Traçabilité** : les actions sensibles sont journalisées, sans recopier les valeurs personnelles.
- **Conformité par conception** (art. 25) : export, effacement et purge sont prévus dès la conception.

---

## 2. Modèle de rôles

| Rôle | Qui | Ce qu'il peut faire |
|---|---|---|
| `pending` | Toute personne qui vient de créer un compte | Voir et modifier son propre profil, saisir un code d'invitation. Aucun accès aux données du club |
| `member` | Pratiquant (code d'activation ou rôle attribué par un admin) | **Aucun accès direct aux tables** : les politiques RLS exigent un rôle enseignant ou admin. Il ne voit que **ses propres données**, uniquement via des fonctions dédiées (`member_space`, `export_my_data`, `get_my_contact`, `set_my_contact`, `set_my_rsvp`) qui partent de la fiche liée à son compte. Il ne voit jamais les notes internes des séances, les autres membres ni leurs coordonnées. Il peut modifier son email, téléphone et contact d'urgence (pas le n° de licence) et annoncer sa présence ou son absence aux séances à venir de ses cours |
| `teacher` | Enseignant invité avec un code | Voir la liste des membres, les cours, les séances ; saisir présences, comptes rendus **pour les cours où il est habilité** ; grades et coordonnées uniquement pour les membres de ses cours |
| `admin` | Responsable désigné (au moins deux recommandés) | Tout ce que fait un enseignant, plus : gérer les cours et les enseignants habilités, créer les codes, gérer les comptes, exporter, anonymiser, purger |

**Règles :**

- Un rôle ne se modifie **jamais** par un simple `UPDATE` : un trigger bloque toute tentative directe. Le changement passe par la fonction `set_user_role`, réservée aux administrateurs, et chaque changement est journalisé.
- **Le rôle `admin` ne s'obtient jamais par code d'invitation.** Un code ne donne que le rôle `teacher` ou `member`.
- **Cours à pourvoir** : `open_sessions_to_fill()` et `claim_session()` (migration 005) ne servent qu'aux enseignants et admins. Un enseignant ne voit et ne prend que les séances des cours où il est habilité ; une séance déjà prise ne peut pas être reprise. Les membres n'y ont aucun accès.
- **Aperçu « Voir comme » (admin)** : l'administrateur peut afficher l'interface telle qu'un enseignant ou un membre la voit. C'est un aperçu côté navigateur, **en lecture seule** : toutes les écritures et les fonctions sensibles sont bloquées dans l'appli, et le compte garde ses droits réels (aucune élévation possible). Pour un membre, les données affichées sont exactement les siennes (`member_space(p_member_id)`, réservé à l'admin et vérifié par la base).
- **Dernier administrateur protégé** : la base refuse de retirer ou de supprimer le dernier administrateur.
- Un administrateur ne peut pas supprimer son propre compte par cette voie.
- Repasser un compte en `pending` retire ses habilitations sur les cours.
- Le premier administrateur est désigné manuellement dans la base (voir `README.md`, étape g).

---

## 3. Contrôle d'accès par table (RLS)

« Staff » désigne les rôles `teacher` et `admin`. Un compte `pending` n'a accès à aucune table, sauf son propre profil.

| Table | Lecture | Ajout / modification / suppression |
|---|---|---|
| `profiles` | Soi-même, ou tout staff | Modification : soi-même (nom ; le rôle est bloqué par trigger) ou admin. Ajout : uniquement à l'inscription (trigger). Suppression directe : interdite |
| `belt_levels` (niveaux de ceinture) | Staff | Admin uniquement |
| `techniques` | Staff | Ajout : staff. Modification et suppression : admin |
| `members` | Staff | Ajout : staff. Modification : admin, ou enseignant ayant un lien avec le membre (inscrit ou pointé dans un de ses cours, ou fiche qu'il a créée). Une fiche anonymisée ne peut plus être modifiée ; la date de départ est fixée automatiquement. Suppression : admin |
| `member_grades` | Staff | Ajout : enseignant ayant un lien avec le membre, ou admin ; date non future. Modification et suppression : admin. L'auteur est renseigné automatiquement |
| `courses` | Staff | Admin uniquement |
| `course_instructors` (enseignants habilités) | Staff | Admin uniquement |
| `course_members` (inscriptions) | Staff | Enseignant habilité sur le cours, ou admin |
| `sessions` (séances) | Staff | Création et suppression : admin. Modification : enseignant habilité sur la séance ; la date et l'horaire ne peuvent être modifiés que par un admin (trigger) |
| `session_techniques` | Staff | Tout enseignant habilité sur le cours, ou admin |
| `attendance` (présences) | Staff | Tout enseignant habilité sur le cours, ou admin. L'auteur et l'heure sont renseignés automatiquement |
| `invite_codes` | Admin | Aucune écriture directe. Création par la fonction `create_invite_code` (admin) ; seule la révocation est possible ensuite (trigger) |
| `audit_log` | Admin | Aucune écriture : seuls les triggers écrivent dans le journal |
| `private.member_contacts` (coordonnées chiffrées) | **Aucun accès direct** depuis l'API | Via `set_member_contact` et `get_member_contact` : admin, ou enseignant ayant un lien avec le membre. Lecture journalisée, 40 consultations/heure max ; seul un admin peut tout effacer |
| `private.invite_attempts` (essais de code) | Aucun accès API | Écrit uniquement par la fonction `redeem_invite_code` |

**Fonctions sensibles et qui peut les appeler :**

| Fonction | Appelant | Remarque |
|---|---|---|
| `list_users`, `set_user_role`, `delete_user` | Admin | Garde-fou du dernier administrateur |
| `create_invite_code` | Admin | Code affiché une seule fois |
| `redeem_invite_code` | Compte connecté en `pending` | 5 essais maximum par heure |
| `set_member_contact` | Staff | Contrôle de longueur des champs |
| `get_member_contact` | Staff | Chaque lecture est journalisée (`contact_read`) |
| `generate_sessions`, `resync_course_sessions` | Admin | Ne supprime pas une séance ayant présences ou compte rendu |
| `export_member_data` | Admin | Export des données d'un membre (art. 15 et 20), journalisé |
| `anonymize_member` | Admin | Effacement (art. 17), journalisé |
| `apply_retention` | Admin | Purge selon les durées de conservation (voir `REGISTRE_TRAITEMENTS.md`) |
| `keepalive` | Anonyme et connecté | Ne renvoie aucune donnée. Sert uniquement au maintien en activité |

Les fonctions du schéma `private` ne sont accessibles à aucun rôle de l'API.

---

## 4. Chiffrement

### 4.1 Coordonnées des membres

- Les coordonnées (email, téléphone, contact d'urgence, numéro de licence) sont chiffrées en **AES-256** avec `pgcrypto` (chiffrement symétrique OpenPGP).
- La clé est générée aléatoirement (256 bits) lors de la mise en place et stockée dans **Supabase Vault**, sous le nom `club_data_key`.
- Les données chiffrées sont dans le schéma `private`, qui n'est exposé par aucune route de l'API. Les fonctions de déchiffrement ne sont pas appelables directement.
- Le chiffrement est fait et défait dans la base : le navigateur ne reçoit jamais la clé.

### 4.2 Autres secrets

| Élément | Protection |
|---|---|
| Mots de passe des comptes | Gérés par Supabase Auth, hachés (bcrypt). Jamais stockés en clair, jamais dans les tables de l'application |
| Codes d'invitation | Seul le **hachage SHA-256** est stocké. Le code est affiché une seule fois à sa création |
| Mot de passe de la base | Gestionnaire de mots de passe de l'administrateur uniquement |
| Clé `service_role` | Jamais dans le dépôt, jamais dans le navigateur |

---

## 5. Codes d'invitation

- **Entropie** : 16 caractères tirés d'un alphabet de 32 symboles, soit **80 bits**. L'alphabet exclut les caractères ambigus (0/O, 1/I).
- **Format** : `WS-XXXX-XXXX-XXXX-XXXX`. La saisie ne tient pas compte de la casse ni des espaces en début et en fin de saisie ; les tirets doivent être saisis.
- **Usage limité** : de 1 à 20 utilisations par code (1 par défaut).
- **Expiration** : de 1 à 30 jours, fixée à la création.
- **Révocation** : un administrateur peut révoquer un code à tout moment.
- **Limitation des essais** : 5 échecs maximum par heure et par compte. Les essais sont conservés 30 jours puis supprimés.
- **Rôle figé** : un code ne peut conférer que le rôle `teacher` ou `member`, jamais `admin`.
- **Code d'activation de fiche** : un code peut être rattaché à une fiche membre précise (usage unique). À son utilisation, le compte est lié automatiquement à cette fiche, si elle n'est pas déjà liée ni anonymisée. Créer un nouveau code d'activation pour une fiche révoque le précédent ; anonymiser la fiche révoque ses codes.
- **Limite connue** : la limite porte sur le compte, pas sur l'adresse IP. Un attaquant pourrait créer plusieurs comptes ; la protection repose alors sur le nombre de comptes possibles (confirmation d'email) et sur la longueur du code, qui rend l'attaque par essais impraticable.

---

## 6. Authentification et sessions

- Connexion par **email et mot de passe** (confirmation d'email obligatoire, 10 caractères minimum, lettres et chiffres), ou par **Google** (scopes `email`, `profile`, `openid` uniquement).
- Pas d'autre fournisseur activé.
- Les jetons de session expirent (durée par défaut de Supabase, environ une heure, renouvelée automatiquement tant que l'utilisateur est actif).
- **Exigence de conception à vérifier dans le code front** : déconnexion automatique après **30 minutes d'inactivité**. Cette règle n'est pas assurée par la base ; elle doit être implémentée dans le navigateur.
- Les droits sont vérifiés par la base à chaque requête : un retrait de rôle ou une suppression de compte est effectif immédiatement, même si la session reste ouverte dans le navigateur.

---

## 7. Journal d'audit

- Chaque création, modification et suppression sur les tables sensibles est journalisée (`audit_log`) : qui, quand, quelle action, quel identifiant d'enregistrement, quelles **colonnes** ont changé.
- **Aucune valeur personnelle n'est copiée dans le journal** : ni le nom, ni la note, ni le contact.
- Chaque **lecture** de coordonnées (`contact_read`), chaque **export** (`member_export`) et chaque **anonymisation** (`member_anonymize`) est tracée.
- Les tentatives de code échouées sont tracées (`invite_failed`), sans le code.
- Seuls les administrateurs peuvent lire le journal. Personne ne peut le modifier depuis l'application ; seule la purge de conservation (`apply_retention`, 90 jours minimum) supprime les entrées anciennes.
- Durée de conservation : 365 jours (purge par `apply_retention`).

---

## 8. Sécurité du site (front-end)

- **Hébergement statique** (GitHub Pages) : le site ne peut pas envoyer d'en-têtes HTTP personnalisés. La **Content Security Policy** doit donc être posée par une balise `<meta http-equiv="Content-Security-Policy">` dans chaque page. Exemple (à adapter à l'adresse du projet) :

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
               connect-src 'self' https://<projet>.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'">
```

  Limite : `frame-ancestors` ne fonctionne pas dans une balise `meta`. La protection contre l'intégration dans un cadre (clickjacking) est donc limitée sur ce type d'hébergement.

- **Aucun script inline** et **aucune dépendance CDN** : la bibliothèque Supabase est fournie dans `web/vendor/supabase.js`.
- **Pas d'`innerHTML` avec des données** : les données sont affichées avec `textContent` ou par création d'éléments. Une donnée saisie ne doit jamais être interprétée comme du HTML.
- Déconnexion après 30 minutes d'inactivité (voir section 6).
- Messages d'erreur génériques côté écran ; le détail technique reste dans la console du serveur.

---

## 9. Gestion des secrets et dépôt public

**Le dépôt est public. Tout ce qui y est commité est lisible par tous.** La sécurité ne repose donc jamais sur le secret du code source ni sur l'URL du projet : elle repose sur la base (RLS) et sur les secrets gardés hors du dépôt.

| Élément | Public ? | Où il se trouve |
|---|---|---|
| Adresse du projet Supabase (`https://<projet>.supabase.co`) | Oui | `web/js/config.js`, secret GitHub |
| Clé publique `anon` / `publishable` | Oui, par conception (protégée par la RLS) | `web/js/config.js`, secrets GitHub |
| Code source, schéma SQL, documents | Oui | Dépôt |
| Clé `service_role` / `secret` | **Non, jamais** | Nulle part dans le projet |
| Mot de passe de la base | **Non, jamais** | Gestionnaire de mots de passe |
| Client Secret Google | **Non, jamais** | Supabase uniquement, gestionnaire de mots de passe |
| Clé de chiffrement `club_data_key` | **Non, jamais** | Supabase Vault, copie dans le gestionnaire de mots de passe |
| Sauvegardes `pg_dump` | **Non, jamais** | Disque chiffré, hors dépôt |
| Coordonnées ou données de membres (même test) | **Non, jamais** | Nulle part dans le dépôt : utiliser des données fictives |

Le fichier `.gitignore` fourni exclut déjà `*.sql` (sauf `supabase/*.sql`), `*.7z`, `*.dump`, `.env` et les exports `membre-*.json`. Faites tout de même vos sauvegardes **hors** du dossier du dépôt.

---

## 10. Ce que ces protections ne couvrent pas (limites honnêtes)

1. **Les administrateurs du projet Supabase** (personnes qui ont accès au tableau de bord et au mot de passe de la base) peuvent techniquement lire les données déchiffrées, puisque la clé est dans la même base. Le chiffrement protège contre la fuite des tables, des exports et des sauvegardes **sans** la clé, pas contre un administrateur de la base. C'est une limite de confiance, à expliquer aux personnes concernées.
2. **Les notes de séance et les grades ne doivent contenir aucune donnée de santé**, ni d'information médicale. Cette règle est rappelée dans l'interface, mais elle repose sur la vigilance des enseignants.
3. **Le plan gratuit n'a pas de sauvegarde automatique utilisable.** La procédure de sauvegarde est décrite dans `README.md` (section j) et reste manuelle.
4. **Journaux techniques Supabase** : en cas d'erreur de validation, Postgres peut écrire la ligne refusée (nom, année de naissance) dans les journaux du projet Supabase, conservés quelques jours par l'hébergeur. L'interface valide les longueurs avant envoi pour limiter ce cas.
5. **La purge est manuelle** : `apply_retention` doit être lancée chaque mois.
5. **La clé de chiffrement ne tourne pas automatiquement.** Aucune fonction de rotation n'existe en phase 1 (voir section 12).
6. **La limite d'essais de code est par compte**, non par adresse IP (voir section 5).
7. **La CSP par balise `meta`** ne couvre pas tous les cas (voir section 8).
8. **Les comptes `pending` non utilisés** peuvent s'accumuler : un administrateur doit les supprimer régulièrement.
9. **La cohérence de l'anonymisation** : un membre anonymisé garde son identifiant technique dans les présences et les grades (pour les statistiques), mais sans nom, sans coordonnées, sans année de naissance et sans notes.

---

## 11. Procédure en cas de violation de données

Une violation de données est une atteinte à la sécurité entraînant la destruction, la perte, l'altération, la divulgation ou l'accès non autorisé à des données personnelles (exemples : mot de passe de la base publié, email d'un administrateur piraté, export envoyé à la mauvaise personne).

**Étape 1 : contenir (dans l'heure)**

1. Révoquer les codes d'invitation actifs (Administration > Codes enseignant, ou `update public.invite_codes set revoked = true where not revoked;` dans **SQL Editor**).
2. Si un compte est compromis : retirer son rôle (`set_user_role` vers `pending`) ou le supprimer, puis le désactiver dans **Authentication > Users**.
3. Si la base est potentiellement exposée : régénérer le mot de passe de la base (**Project Settings > Database**), puis mettre à jour la chaîne de connexion des sauvegardes.
4. Si une clé d'API est exposée : régénérer les clés dans **Project Settings > API Keys**, puis mettre à jour `web/js/config.js` et les secrets GitHub, puis relancer le déploiement.
5. Si un mot de passe utilisateur est exposé : forcer la réinitialisation (**Authentication > Users**).

**Étape 2 : évaluer (dans les 24 heures)**

- Quelles données sont concernées (nature, volume) ? Quelles personnes ?
- Le risque pour les personnes est-il possible ? Probable ? Élevé (coordonnées, mineurs, contact d'urgence) ?
- Consigner l'incident dans un registre interne, même si aucune notification n'est finalement requise (art. 33).

**Étape 3 : notifier (dans les 72 heures)**

- Si la violation est susceptible d'engendrer un **risque pour les droits et libertés** des personnes : notifier la **CNIL** dans les **72 heures** après en avoir pris connaissance (art. 33). Au-delà, indiquer les motifs du retard.
- Si le risque est **élevé** : informer **les personnes concernées** dans les meilleurs délais, en langage clair, avec les mesures prises et les conseils à suivre (art. 34). Pour les mineurs, informer les représentants légaux.
- La notification à la CNIL se fait en ligne sur le site de la CNIL (téléservice de notification de violation de données).
- Supabase informe le responsable de traitement en cas d'incident touchant la plateforme ; le délai et le contenu sont fixés par le contrat de sous-traitance (DPA) de Supabase.

**Étape 4 : tirer les leçons**

- Compte rendu écrit : cause, données touchées, actions, mesures correctives.
- Mettre à jour `docs/SECURITE.md` et, si besoin, `docs/REGISTRE_TRAITEMENTS.md`.

**Coordonnées à compléter :** responsable du traitement [À COMPLÉTER], personne référente [À COMPLÉTER].

---

## 12. Rotation des clés

| Clé ou secret | Fréquence | Procédure |
|---|---|---|
| Mot de passe de la base | Annuelle, et immédiatement en cas de doute | Project Settings > Database > réinitialiser ; mettre à jour le gestionnaire de mots de passe et les procédures de sauvegarde |
| Clé publique API | En cas de fuite de la clé `service_role`, ou si la clé publique est jugée compromise | Project Settings > API Keys ; mettre à jour `config.js` et les secrets GitHub ; redéployer |
| Client Secret Google | Annuelle, ou en cas de doute | Google Cloud > Identifiants ; mettre à jour le fournisseur dans Supabase |
| Clé de chiffrement `club_data_key` | En cas de compromission uniquement | **Non automatisée en phase 1.** Procédure : créer une nouvelle clé, réencrypter les coordonnées (script à écrire et tester sur une copie), vérifier, puis retirer l'ancienne clé. À faire avec une personne compétente en base de données |

---

## 13. Droits des personnes (RGPD)

| Droit | Comment l'exercer dans l'application |
|---|---|
| Accès (art. 15) | Administration > membre > Exporter : fichier JSON contenant identité, coordonnées, grades et présences |
| Rectification (art. 16) | Modification de la fiche par un enseignant ou un admin |
| Effacement (art. 17) | Fiche membre > Anonymiser (définitif). Il s'agit d'une pseudonymisation forte : nom, année de naissance, coordonnées et inscriptions sont effacés ; les présences et grades restent rattachés à un identifiant technique. Pour un effacement total, utilisez « Supprimer le membre » |
| Limitation, opposition (art. 18 et 21) | Demande traitée par l'admin : restriction de l'usage des données, suppression des coordonnées |
| Portabilité (art. 20) | Même export que l'accès, au format JSON structuré |
| Information (art. 13) | Document `docs/MENTION_INFORMATION.md` remis lors de l'inscription |

**Délai de réponse** : le responsable de traitement répond dans un délai d'un mois à compter de la demande, prolongeable selon les règles du RGPD. Tenir un registre des demandes.

Un export est un fichier sensible : le transmettre par un canal sûr (remise en main propre, espace partagé à accès restreint), jamais par un message public.

---

## 14. Checklist de revue trimestrielle

- [ ] Liste des administrateurs à jour ; au moins deux administrateurs ; aucun compte inconnu parmi eux.
- [ ] Liste des enseignants `teacher` à jour ; les enseignants qui ont quitté le club sont repassés en `pending` ou supprimés.
- [ ] Comptes `pending` anciens supprimés.
- [ ] Aucun code d'invitation actif inutile ; codes expirés ou révoqués nettoyés.
- [ ] Purge « Appliquer les durées de conservation » lancée chaque mois depuis Administration > RGPD (historique noté).
- [ ] Journal d'audit consulté : pas de pic inhabituel de `contact_read` ou `member_export`.
- [ ] Sauvegarde du dernier mois présente, chiffrée, et son mot de passe retrouvé dans le gestionnaire.
- [ ] Restauration de test réalisée au moins une fois par an.
- [ ] Workflow keepalive vert ; projet Supabase actif.
- [ ] Dépôt public : aucun secret, aucun fichier de données, aucune sauvegarde (recherche rapide sur `service_role`, `secret`, `password`, `.sql`, `.7z`).
- [ ] Clé `club_data_key` présente dans le gestionnaire de mots de passe.
- [ ] Mise à jour des dépendances du site (bibliothèque Supabase dans `web/vendor/`).
- [ ] Registre des traitements et mention d'information relus et à jour.
- [ ] Registre des incidents et des demandes de droits relu.
- [ ] Notice aux enseignants rappelée : pas de donnée de santé dans les notes.
