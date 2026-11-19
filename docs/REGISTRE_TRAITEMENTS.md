# Registre des traitements (art. 30 RGPD) – Gestion de la section technique

> **Document modèle à faire valider par le bureau du club. Ce n'est pas un avis juridique.**

Fiche de registre pour le traitement « Gestion de la section technique ». Les éléments entre crochets sont à compléter. Dernière mise à jour : [À COMPLÉTER]. Revue prévue : chaque année, et à chaque changement important de l'application (par exemple l'ouverture aux membres en phase 2).

---

## 1. Identification

| Élément | Contenu |
|---|---|
| Nom du traitement | Gestion de la section technique (application de suivi des cours, présences, grades) |
| Responsable du traitement | [NOM DU CLUB], [forme juridique], [adresse du siège], [numéro d'affiliation éventuel] |
| Représentant du bureau | [NOM, FONCTION] |
| Contact pour les questions sur les données | [ADRESSE EMAIL DÉDIÉE] |
| Personne qui administre l'application | [NOM, FONCTION] |
| Date de mise en service | [À COMPLÉTER] |

---

## 2. Finalités

1. **Organiser les cours** : planification des séances, affectation des enseignants, liste des inscrits.
2. **Suivre la présence** aux séances, pour la sécurité des pratiquants (savoir qui est présent en cas d'incident) et pour le suivi de l'assiduité.
3. **Suivre la progression technique** : niveaux de ceinture (grades) et comptes rendus de séance, sans donnée de santé.
4. **Joindre les personnes** en cas de besoin lié à la pratique, et contacter les représentants légaux des mineurs.
5. **Assurer la sécurité** de l'application : journal d'audit, limitation des tentatives, contrôle des accès.
6. **Respecter les droits des personnes** : export, rectification, effacement. Chaque pratiquant disposant d'un compte peut consulter ses données, télécharger une copie et corriger ses coordonnées depuis « Mon espace ».
7. **Informer les pratiquants** de leur planning, de leur progression et de leur assiduité, et leur permettre d'annoncer leur présence ou leur absence aux séances à venir.

Finalités exclues : prospection commerciale, profilage, revente ou cession des données, décisions automatisées.

---

## 3. Base légale

| Finalité | Base légale (art. 6) |
|---|---|
| 1, 2, 3 : gestion de l'adhésion et de la pratique | **6.1.b** : exécution du contrat d'adhésion (ou des mesures précontractuelles) |
| 4 : coordonnées de contact | **6.1.b** pour le membre ; **6.1.d** pour le contact d'urgence (protection d'un intérêt vital) |
| 5 : journal d'audit et sécurité | **6.1.f** : intérêt légitime à sécuriser le traitement. Un test de mise en balance est à conserver avec le registre |
| Accès des enseignants et administrateurs | **6.1.b** (exécution de la mission confiée) et **6.1.f** pour la sécurité |
| 6 : droits des personnes | **6.1.c** : obligation légale de répondre aux demandes |

Pour un mineur, le contrat d'adhésion est conclu par le représentant légal. [À VALIDER par le bureau.]

---

## 4. Personnes concernées

| Catégorie | Commentaire |
|---|---|
| Membres (pratiquants) | Adultes et **mineurs**. Pour les mineurs, les représentants légaux reçoivent l'information (voir `MENTION_INFORMATION.md`) |
| Représentants légaux et contacts d'urgence | Personnes désignées par le membre |
| Enseignants et intervenants | Personnes disposant d'un compte `teacher` ou `admin` |
| Administrateurs | Responsables de la gestion de l'application |

Effectif estimé : [NOMBRE] membres, [NOMBRE] enseignants.

---

## 5. Catégories de données

| Catégorie | Données | Commentaire |
|---|---|---|
| Identité | Prénom, nom, **année de naissance** (et non la date complète) | Minimisation |
| Coordonnées (chiffrées) | Email, téléphone | Chiffrement AES-256, schéma non exposé |
| Contact d'urgence (chiffré) | Nom et téléphone d'un tiers | Chiffrement AES-256 |
| Licence (chiffré) | Numéro de licence | Chiffrement AES-256 |
| Pratique | Grade, date d'obtention, note (500 caractères au maximum) | Pas de donnée de santé |
| Présence | Présence à une séance, enseignant ayant pris la présence, date | |
| Séances | Compte rendu (2000 caractères au maximum), techniques travaillées | Pas de donnée de santé |
| Réponses aux séances | « Je viens » / « Je ne viens pas » pour une séance à venir, date de réponse | Saisie par le pratiquant ; aucun motif demandé (évite toute donnée de santé) |
| Comptes utilisateurs | Email, nom affiché, rôle, dernière connexion | Membres, enseignants et administrateurs |
| Journal d'audit | Action, identifiant d'enregistrement, colonnes modifiées, horodatage | Aucune valeur personnelle |
| Codes d'invitation | Hachage SHA-256 du code, date d'expiration, nombre d'utilisations | Le code en clair n'est jamais conservé |

**Données exclues** : données de santé, certificats médicaux, date de naissance complète, adresse postale, données bancaires, photographies.

---

## 6. Destinataires

| Destinataire | Qui | Accès |
|---|---|---|
| Responsable du traitement (bureau) | Administrateurs | Toutes les données du club |
| Enseignants habilités | Staff | Données des membres et séances. Coordonnées uniquement sur demande, journalisée |
| Personne qui administre le projet | Administrateur technique | Accès à la base (voir `SECURITE.md`, limite de confiance) |

Aucune communication à des tiers autres que les sous-traitants ci-dessous, sauf obligation légale.

---

## 7. Sous-traitants et hébergeurs

| Prestataire | Rôle | Localisation des données | Remarque |
|---|---|---|---|
| **Supabase** | Base de données, authentification, stockage des clés (Vault) | **Union européenne (Frankfurt, eu-central-1)** | Société de droit américain. Vérifier le contrat de sous-traitance (DPA) et les garanties de transfert |
| **GitHub** (Microsoft) | Hébergement du code et publication du site | Le **code** ne contient aucune donnée personnelle. GitHub traite des données techniques de connexion des visiteurs du site (adresse IP, par exemple) | Société de droit américain. Vérifier le DPA |
| **Google** (facultatif) | Authentification « Se connecter avec Google » | Hors contrôle du club | Utilisé seulement si la connexion Google est activée. Ne transmet que l'email et le nom (scopes `email` et `profile`) |

**Transferts hors Union européenne.** Supabase et GitHub sont des sociétés américaines. Les données de l'application restent hébergées dans l'UE, mais les sociétés peuvent y accéder depuis les États-Unis dans certains cas (maintenance, support). [À VALIDER] Le bureau doit vérifier que chaque prestataire est couvert par une garantie appropriée : certification au **Data Privacy Framework** ou **clauses contractuelles types**, et que le DPA est signé ou accepté. Conserver les preuves avec le registre.

---

## 8. Durées de conservation

| Donnée | Durée | Point de départ | Mécanisme |
|---|---|---|---|
| Fiche membre et présences, grades | Durée de l'adhésion **+ 3 ans** | Date de départ (`left_at`) | Purge `apply_retention`, puis anonymisation |
| Coordonnées, contact d'urgence, licence | Durée de l'adhésion, puis **supprimées** à l'anonymisation | Anonymisation | Suppression des données chiffrées |
| Notes des grades | Supprimées à l'anonymisation | Anonymisation | Mise à vide du champ `note` |
| Membre anonymisé (statistiques) | Sans limite, sans donnée personnelle | Anonymisation | Nom remplacé, année de naissance supprimée |
| Journal d'audit | **365 jours** | Date de l'action | Purge `apply_retention` |
| Tentatives de code d'invitation | **30 jours** | Date de la tentative | Purge `apply_retention` |
| Codes d'invitation expirés ou révoqués | **30 jours** après expiration (codes révoqués : 30 jours après leur création) | Date d'expiration ou de création | Purge `apply_retention` |
| Comptes enseignants | Durée de la fonction, puis suppression. [À VALIDER : proposition, au plus 1 an après la fin de la fonction] | Date de fin de fonction | Suppression du compte (`delete_user`) |
| Comptes `pending` non utilisés | [À VALIDER : proposition, 3 mois] | Date de création | Suppression manuelle |
| Sauvegardes (fichiers `pg_dump`) | [À VALIDER : 12 mois glissants maximum] | Date de sauvegarde | Destruction manuelle des plus anciennes |

**Remarque sur les sauvegardes :** une donnée effacée dans l'application peut subsister dans une sauvegarde jusqu'à sa destruction. Le registre doit le mentionner aux personnes qui exercent un droit d'effacement.

---

## 9. Mesures de sécurité (art. 32)

Les mesures détaillées figurent dans `docs/SECURITE.md`. En résumé :

- **Contrôle d'accès** par rôle, appliqué par la base (RLS) : aucun accès anonyme, rôle admin non attribuable par code, dernier admin protégé ;
- **Chiffrement** AES-256 des coordonnées, clé dans Supabase Vault, schéma non exposé par l'API ;
- **Mots de passe** hachés par Supabase Auth, confirmation d'email, longueur minimale de 10 caractères avec lettres et chiffres ;
- **Codes d'invitation** : 80 bits d'entropie, stockés sous forme de hachage, expiration, révocation, 5 essais par heure et par compte ;
- **Journalisation** des actions sensibles, sans valeurs personnelles ;
- **Sécurité du site** : Content Security Policy, pas de dépendance externe, pas d'affichage HTML des données ;
- **Localisation** des données dans l'UE ;
- **Sauvegardes chiffrées** (AES-256) hors dépôt, et clé de chiffrement sauvegardée séparément ;
- **Gestion des secrets** : aucun secret dans le dépôt public ;
- **Revue trimestrielle** et procédure de violation de données (art. 33 et 34).

---

## 10. Droits des personnes et procédure

| Droit | Délai de réponse | Traitement |
|---|---|---|
| Information (art. 13) | Lors de l'inscription | Document `MENTION_INFORMATION.md` |
| Accès (art. 15) | 1 mois | Export JSON depuis la fiche membre |
| Rectification (art. 16) | 1 mois | Modification par un enseignant ou un admin |
| Effacement (art. 17) | 1 mois | Anonymisation (voir section 8) |
| Limitation (art. 18) | 1 mois | Pas de fonction dédiée en phase 1 : traitement manuel par l'admin (retrait des droits, conservation hors usage) [À PRÉVOIR en phase 2] |
| Portabilité (art. 20) | 1 mois | Export JSON |
| Opposition (art. 21) | 1 mois | Examen au cas par cas ; cessation de l'usage fondé sur l'intérêt légitime, sauf motif impérieux documenté |

Une demande reçue par un enseignant est transmise à l'administrateur. Chaque demande est consignée dans un registre des demandes (date, personne, droit, réponse, date de réponse).

---

## 11. Transferts et violations

- **Violation de données** : procédure dans `docs/SECURITE.md`, section 11. Notification à la CNIL dans les 72 heures si le risque le justifie (art. 33), information des personnes si le risque est élevé (art. 34).
- **Analyse d'impact** : [À ÉVALUER] Le traitement porte sur des mineurs et des coordonnées ; le bureau doit décider s'il faut réaliser une analyse d'impact (AIPD).

---

## 12. Historique des mises à jour

| Date | Modification | Par |
|---|---|---|
| [À COMPLÉTER] | Création du registre | [NOM] |
| 2026-11 | Espace membre : accès des pratiquants à leurs propres données, réponses aux séances, codes d'activation | [NOM] |
