# Club Wushu – Section technique : guide d'installation pas à pas

Ce guide explique, étape par étape, comment mettre en service l'application de gestion de la section technique (phase 1 : enseignants et administrateurs uniquement). Il ne suppose aucune connaissance préalable de Supabase ni de GitHub.

Documents complémentaires :

- `docs/SECURITE.md` : choix de sécurité et de gouvernance des données ;
- `docs/REGISTRE_TRAITEMENTS.md` : fiche de registre des traitements (modèle) ;
- `docs/MENTION_INFORMATION.md` : texte d'information à remettre aux membres (modèle).

---

## Avant de commencer

**Ce qu'il vous faut :**

- un compte GitHub ;
- un compte Google (pour la connexion Google, facultative mais recommandée) ;
- un gestionnaire de mots de passe (Bitwarden, KeePass, 1Password…) pour stocker les mots de passe et clés ci-dessous.

**Règle d'or : le dépôt GitHub est PUBLIC.** Tout ce qui est commité est visible de tous. Il ne doit donc jamais contenir :

| Élément | Où le mettre |
|---|---|
| Mot de passe de la base de données Supabase | Gestionnaire de mots de passe uniquement |
| Clé `service_role` (Supabase) | Nulle part dans le projet. Ne jamais la copier |
| Secret client Google (Client Secret) | Supabase uniquement (étape d) |
| Clé publique `anon` / `publishable` | `web/js/config.js` (c'est prévu, elle est publique) et secrets GitHub (étape h) |
| Sauvegardes (fichiers `pg_dump`) | Disque chiffré, jamais dans le dépôt |

---

## a. Créer le projet Supabase

1. Allez sur **https://supabase.com**, créez un compte puis cliquez sur **New project**.
2. Renseignez :
   - **Name** : `club-wushu` (par exemple) ;
   - **Region** : choisissez **Frankfurt (eu-central-1)**. Les données restent ainsi dans l'Union européenne ;
   - **Database Password** : cliquez sur *Generate a password*, puis **copiez-le immédiatement dans votre gestionnaire de mots de passe**. Supabase ne l'affichera plus.
3. Choisissez le plan **Free** et validez. La création prend quelques minutes.

> Le plan gratuit met le projet en pause après une semaine sans activité, et ne propose pas de sauvegarde automatique utilisable. Voir les étapes h et j.

---

## b. Créer les tables (exécuter le schéma)

1. Dans le menu de gauche de Supabase, ouvrez **SQL Editor**, puis **New query**.
2. Ouvrez le fichier `supabase/schema.sql` du dépôt, copiez tout son contenu et collez-le dans l'éditeur.
3. Cliquez sur **Run**.
4. Vérifiez qu'il n'y a pas d'erreur rouge. Un message « Success » ou équivalent doit apparaître.

> Le script crée les tables une seule fois : le réexécuter échouera ou modifiera la base. En cas d'erreur, ne relancez pas le script au hasard et demandez de l'aide avant de rien supprimer.

---

## c. Configurer l'authentification par email

Menu **Authentication**, puis **Sign In / Providers** (ou **Providers** selon la version de l'interface).

1. **Email** : activez le fournisseur.
2. **Confirm email** : activé (l'adresse doit être confirmée par un lien reçu par email).
3. **Minimum password length** : `10`.
4. Exigences de mot de passe : cochez l'obligation de **lettres et de chiffres** (et, si disponible, de caractères spéciaux).
5. **Désactivez** tous les autres fournisseurs (téléphone, Apple, GitHub, etc.) qui ne sont pas utilisés. Moins de portes d'entrée, c'est plus de sécurité.

Ensuite, menu **Authentication**, puis **URL Configuration** :

6. **Site URL** : `https://<utilisateur>.github.io/<repo>/`
   (remplacez `<utilisateur>` par votre nom d'utilisateur GitHub et `<repo>` par le nom du dépôt ; **la barre oblique finale est importante**) ;
7. **Redirect URLs** : ajoutez la même adresse.

---

## d. Connexion avec Google (facultative)

### d1. Créer le projet Google Cloud

1. Allez sur **https://console.cloud.google.com** et créez un projet (par exemple `club-wushu`).

### d2. Écran de consentement OAuth

1. Menu **APIs et services**, puis **Écran de consentement OAuth** (ou **Google Auth Platform**).
2. **Type d'utilisateur** : **Externe**.
3. Renseignez le nom de l'application, l'email de contact et le nom du club.
4. **Scopes** : ne gardez que **`email`**, **`profile`** et **`openid`**. N'ajoutez aucun autre accès (pas de Drive, pas de Gmail, etc.).
5. Une fois configuré, cliquez sur **Publier l'application** (passage « En production »).
   Sans cette étape, seuls les comptes de test ajoutés à la main peuvent se connecter, et la connexion expire toutes les semaines. Les scopes `email` et `profile` ne demandent pas de vérification Google.

### d3. Créer les identifiants OAuth

1. Menu **Identifiants**, puis **Créer des identifiants**, puis **ID client OAuth**.
2. **Type d'application** : **Application Web**.
3. **URI de redirection autorisés** : ajoutez exactement
   `https://<projet>.supabase.co/auth/v1/callback`
   (remplacez `<projet>` par la référence de votre projet Supabase, visible dans l'URL du tableau de bord ou dans **Project Settings > General**).
4. Validez. Google affiche un **Client ID** et un **Client Secret**.

### d4. Les renseigner dans Supabase

1. Dans Supabase : **Authentication > Sign In / Providers > Google**.
2. Activez le fournisseur, collez le **Client ID** et le **Client Secret**, puis enregistrez.

> **Le Client Secret Google ne va JAMAIS dans le dépôt, ni dans `config.js`.** Il reste dans Supabase et dans votre gestionnaire de mots de passe.

---

## e. Renseigner la configuration du site

Le fichier `web/js/config.js` contient l'adresse du projet et la **clé publique**. Ouvrez-le dans un éditeur de texte et remplacez les deux valeurs :

```js
export const SUPABASE_URL = 'https://<projet>.supabase.co';
export const SUPABASE_ANON_KEY = '<clé publique anon ou publishable>';
```

**Resserrez ensuite la CSP** dans `web/index.html` : remplacez `https://*.supabase.co wss://*.supabase.co` par `https://<projet>.supabase.co wss://<projet>.supabase.co`. Le navigateur ne pourra alors parler qu'à VOTRE projet.

**Recommandé :** publiez le site depuis une **organisation GitHub dédiée au club** (gratuite), par exemple `club-wushu-xxx.github.io`. Toutes les pages d'un même compte GitHub partagent la même origine web : une autre page publiée sur votre compte personnel pourrait techniquement lire la session de connexion stockée dans le navigateur.

Où trouver les valeurs : Supabase, **Project Settings > API Keys** (ou **Settings > API**) :

- **Project URL** : l'adresse `https://<projet>.supabase.co` ;
- **Clé publique** : la clé `anon` (ou `publishable`, `sb_publishable_…`).

**Vérification indispensable :** la clé `service_role` (ou `secret`) ne doit JAMAIS apparaître dans `config.js`. Elle donne un accès total à la base et contourne toutes les protections.

---

## f. Publier sur GitHub Pages

1. Créez un **dépôt public** sur GitHub, par exemple `club-wushu`, puis envoyez-y le contenu du projet.
2. Vérifiez qu'aucun secret n'a été ajouté (voir le tableau du début).
3. Ouvrez le dépôt, puis **Settings > Pages**.
4. Dans **Build and deployment > Source**, choisissez **GitHub Actions**.

> **Pourquoi pas « Deploy from a branch » ?** GitHub Pages ne sait publier, dans ce mode, que la racine du dépôt ou le dossier `/docs`. Or le site est dans le dossier `web/`. C'est le workflow `.github/workflows/pages.yml` qui copie le dossier `web/` et le publie. Il se lance automatiquement à chaque modification de `main`.

5. Allez dans l'onglet **Actions** et attendez que le workflow soit vert.
6. L'adresse du site apparaît dans **Settings > Pages** : `https://<utilisateur>.github.io/<repo>/`. C'est elle qui doit figurer dans l'étape c.

---

## g. Créer le premier administrateur

1. Ouvrez le site, cliquez sur **Créer un compte**, puis confirmez votre adresse email (lien reçu par mail).
2. Connectez-vous une fois. Votre compte est créé avec le rôle **pending** (en attente).
3. Retournez dans Supabase, **SQL Editor**, **New query**, et exécutez en remplaçant l'adresse :

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'votre.email@exemple.fr');
```

4. Reconnectez-vous sur le site : vous voyez maintenant la page **Administration**.

> Le rôle `admin` ne s'attribue jamais par code d'invitation. Cette requête est la seule porte d'entrée, réservée à la personne qui administre la base dans Supabase. Gardez-en au moins deux administrateurs si possible (le système refuse de retirer le dernier).

---

## h. Garder le projet éveillé (anti-pause)

Le plan gratuit met le projet en pause après une semaine sans activité. Le workflow `.github/workflows/keepalive.yml` envoie une requête légère deux fois par semaine.

1. Aucun secret à créer : le workflow lit l'adresse et la clé **publique** directement dans `web/js/config.js`.
2. Dans l'onglet **Actions**, lancez une fois le workflow **keepalive** manuellement (**Run workflow**) pour vérifier qu'il est vert.

> GitHub désactive les workflows planifiés d'un dépôt public sans aucune activité depuis 60 jours. Si le projet ne bouge plus, relancez le workflow à la main ou faites un petit commit.

---

## i. Utilisation quotidienne

Les menus ci-dessous décrivent l'interface prévue. Vérifiez les intitulés exacts lors de la mise en service.

| Tâche | Qui | Où |
|---|---|---|
| Générer les séances à partir des horaires | Admin | Calendrier > bouton « Générer les séances » (période de 366 jours maximum) |
| Inviter un enseignant | Admin | Administration > Codes enseignant : code à usage limité, durée de 1 à 30 jours. Le code est affiché **une seule fois** : copiez-le et transmettez-le de vive voix ou par message privé |
| Révoquer un code | Admin | Administration > Codes enseignant |
| Changer le rôle d'un compte | Admin | Administration > Comptes |
| Cocher les présences | Enseignant habilité | Séances > la séance du jour |
| Saisir un grade | Enseignant | Fiche du membre > Grades |
| Saisir un compte rendu | Enseignant habilité | Séance > Compte rendu (pas de données de santé) |
| Consulter les coordonnées d'un membre | Enseignant | Fiche du membre > Coordonnées (chaque consultation est journalisée) |

**Code d'invitation :** le destinataire crée son compte, puis saisit le code **exactement** tel qu'il est affiché (tirets compris, par exemple `WS-ABCD-EFGH-JKLM-NPQR`). Il dispose de 5 essais par heure.

**Maintenance mensuelle (à faire à la main, une fois par mois) :** connecté en admin dans l'appli, ouvrez **Administration > RGPD** et cliquez sur **Appliquer les durées de conservation**. (Ne passez pas par le SQL Editor : la fonction vérifie que l'appelant est un administrateur connecté et y serait refusée.)

Cette action anonymise les anciens membres partis depuis plus de 3 ans, supprime le journal d'audit de plus de 365 jours et nettoie les codes expirés. Elle renvoie le nombre d'opérations effectuées. Notez-la dans le registre de vos vérifications.

---

## j. Sauvegardes (indispensables)

**Le plan gratuit ne fournit pas de sauvegarde automatique utilisable.** Il faut donc sauvegarder soi-même, au moins une fois par mois.

### j1. Sauvegarder la base

1. Dans Supabase : **Project Settings > Database**, copiez la chaîne de connexion (**Connection string**, format URI). Choisissez le mode **Session pooler** si votre réseau n'accepte que l'IPv4. Remplacez `[YOUR-PASSWORD]` par le mot de passe de la base (il reste dans votre gestionnaire de mots de passe, ne le collez jamais dans un fichier du dépôt).
2. Sur un ordinateur disposant de PostgreSQL (`pg_dump`) :

```bash
# Écrire la sauvegarde HORS du dossier du dépôt Git, et sans les jetons de session
mkdir -p ~/sauvegardes-club
pg_dump "<chaîne de connexion>" --no-owner -n public -n private -n auth \
  --exclude-table-data=auth.sessions --exclude-table-data=auth.refresh_tokens \
  --exclude-table-data='auth.mfa_*' --exclude-table-data=auth.flow_state \
  -f ~/sauvegardes-club/sauvegarde_club.sql
```

3. Chiffrez immédiatement le fichier avec 7-Zip en AES-256 (clic droit, **7-Zip > Ajouter à l'archive**, format **7z**, méthode de chiffrement **AES-256**, cochez **Chiffrer les noms de fichiers**), ou en ligne de commande :

```bash
7z a -t7z -mhe=on -p sauvegarde_club_AAAA-MM-JJ.7z sauvegarde_club.sql
```

4. Supprimez le fichier `.sql` en clair une fois l'archive vérifiée.
5. Rangez l'archive sur un support chiffré, hors du dépôt, avec le mot de passe de l'archive dans le gestionnaire de mots de passe.

> Une sauvegarde contient des données personnelles (noms, années de naissance, présences, grades). Traitez-la comme telle : accès restreint, durée de conservation courte, suppression des copies inutiles.

### j2. Sauvegarder la clé de chiffrement (étape critique)

Les coordonnées des membres sont chiffrées avec une clé stockée dans **Supabase Vault** (nom : `club_data_key`). **Sans cette clé, les coordonnées sauvegardées sont illisibles**, et une restauration sur un autre projet peut ne pas la retrouver.

1. Dans **SQL Editor**, exécutez (réservé à l'administrateur de la base) :

```sql
select decrypted_secret from vault.decrypted_secrets where name = 'club_data_key';
```

2. Copiez la valeur affichée dans le gestionnaire de mots de passe, dans une entrée intitulée « Clé club wushu – club_data_key ». Ne l'enregistrez dans aucun fichier du dépôt et ne l'envoyez par email.
3. Refaites cette copie si la clé change (elle ne change pas toute seule).

### j3. Tester la restauration

Une sauvegarde qu'on n'a jamais restaurée ne prouve rien. Au moins une fois par an, restaurez-la dans un **projet Supabase de test** (et non dans le projet réel), puis vérifiez qu'un membre test se lit correctement. Supprimez le projet de test ensuite.

### j4. Attention à la pause

Un projet mis en pause trop longtemps peut être **supprimé** par Supabase. Gardez le workflow keepalive actif (étape h) et vérifiez-le chaque trimestre.

---

## k. Limites connues et phase 2

**Limites actuelles :**

- les comptes **membres** (élèves ou parents) n'existent pas : seuls les enseignants et administrateurs se connectent ;
- le plan gratuit n'offre pas de sauvegarde automatique : la procédure j est obligatoire ;
- la limite de 5 essais par heure s'applique par compte, pas par adresse IP ;
- la purge (`apply_retention`) est manuelle : pensez à la lancer chaque mois ;
- la clé de chiffrement ne tourne pas automatiquement (voir `docs/SECURITE.md`) ;
- les administrateurs du projet Supabase peuvent techniquement lire les données déchiffrées : c'est une limite de confiance, à expliquer aux personnes concernées.

**Phase 2 (prévue) :** accès des membres ou de leurs représentants légaux à leur propre fiche (présences, grades) et à leurs coordonnées, avec une nouvelle revue de sécurité et une mise à jour de `docs/REGISTRE_TRAITEMENTS.md`.

---

## Dépannage rapide

| Symptôme | Piste |
|---|---|
| « Invalid redirect URL » à la connexion | La Site URL ou la Redirect URL de l'étape c ne correspond pas exactement à l'adresse GitHub Pages (barre finale, majuscules). |
| Google renvoie « redirect_uri_mismatch » | L'URI de l'étape d3 doit être exactement `https://<projet>.supabase.co/auth/v1/callback`. |
| Connexion Google refusée pour un utilisateur | L'application Google est restée « En test » (étape d2, point 5). |
| Le site affiche une page vide ou des erreurs de script | Vérifiez `web/js/config.js` (URL et clé publique) et la console du navigateur (touche F12). |
| Le code d'invitation est refusé | Vérifiez l'expiration, le nombre d'utilisations restantes et la saisie exacte (tirets compris). |
| Le projet Supabase est en pause | Dans Supabase, cliquez sur **Restore project**, puis relancez le workflow keepalive. |
