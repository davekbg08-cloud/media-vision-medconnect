# Sauvegarde et restauration Firestore — MedConnect

## Pourquoi ce mécanisme et pas l'export natif Firestore

Firestore propose un export natif (`gcloud firestore export`), mais il
nécessite un **compte de facturation lié au projet GCP** — dans les
faits, la même bascule que le plan Firebase Blaze que le projet évite
volontairement pour l'instant. Ce runbook utilise à la place
**l'Admin SDK Firebase** (`firebase-admin`), qui est **gratuit et
disponible sur le plan Spark** — aucun lien avec la facturation GCP.

## Ce qui est sauvegardé

`scripts/backup-firestore.mjs` exporte toutes les collections
applicatives connues (`BACKUP_COLLECTIONS` dans le script — comptes,
dossiers patients, consultations, ordonnances, laboratoire,
admissions, consentements, partages, transferts, abonnements, journal
d'audit, etc.) au format **NDJSON** (un document JSON par ligne, un
fichier par collection), plus un `manifest.json` récapitulant le
nombre de documents et les éventuels échecs par collection.

## Sauvegarde automatique (recommandée)

Un workflow GitHub Actions planifié (`.github/workflows/backup-firestore.yml`)
exporte Firestore **chaque jour à 02:00 UTC**, **chiffre l'export**
(gpg symétrique AES256 — voir "Chiffrement" ci-dessous) et publie le
résultat comme **artefact de run** (conservé **30 jours**) — jamais
commité dans le dépôt git.

### Correctif (chantier sécurité) — l'export n'est plus publié en clair

Avant ce correctif, l'artefact publié contenait le NDJSON en clair
(comptes, dossiers patients complets) — accessible à quiconque a un
accès lecture au dépôt, au-delà du strict besoin opérationnel. L'export
est désormais **systématiquement chiffré** (`scripts/encrypt-backup.mjs`)
avant publication ; seuls l'archive chiffrée (`backup-output.tar.gz.gpg`)
et un manifeste **public non sensible** (date, version, nombre total de
documents, empreinte SHA-256 — jamais de contenu patient/compte) sont
publiés. La rétention est réduite de 90 à 30 jours (une sauvegarde
chiffrée conservée moins longtemps reste préférable à un export en
clair conservé plus longtemps ; 30 jours couvrent largement le délai de
détection d'un incident nécessitant une restauration).

### Configuration requise (une seule fois)

1. Firebase Console → ⚙️ Paramètres du projet → **Comptes de service**
   → "Générer une nouvelle clé privée" → télécharge un fichier JSON.
2. GitHub → dépôt → Settings → Secrets and variables → Actions →
   "New repository secret" :
   - Nom : `FIREBASE_SERVICE_ACCOUNT_JSON`
   - Valeur : le contenu **brut** du fichier JSON téléchargé (pas
     besoin de l'encoder — GitHub Actions accepte un secret
     multi-ligne tel quel).
3. Supprime le fichier `service-account.json` de ton poste après ça —
   ne le commite jamais.
4. Ajoute un second secret pour le chiffrement de la sauvegarde :
   - Nom : `FIRESTORE_BACKUP_ENCRYPTION_KEY`
   - Valeur : une passphrase forte et unique (ex. générée via
     `openssl rand -base64 32`), **à conserver précieusement en dehors
     de GitHub** (gestionnaire de mots de passe de l'équipe) — sans
     elle, aucune sauvegarde existante n'est déchiffrable, y compris
     par le propriétaire du projet.

**La clé de service Firebase donne un accès complet (lecture/écriture)
à tout le projet Firebase** — à traiter avec la même prudence qu'un mot
de passe administrateur. La révoquer : Firebase Console → Comptes de
service → supprimer la clé, puis en régénérer une nouvelle si besoin.
**La passphrase de chiffrement des sauvegardes** protège les données
patient/compte au repos dans les artefacts — sa fuite compromettrait
toutes les sauvegardes déjà publiées ; la faire tourner (nouveau secret)
ne rend PAS les anciennes sauvegardes chiffrées avec l'ancienne clé
plus sûres rétroactivement (elles restent déchiffrables avec l'ancienne
clé tant qu'elle existe quelque part).

### Déclenchement manuel

Onglet **Actions** → "Sauvegarde Firestore (export NDJSON)" →
"Run workflow". Utile pour vérifier que tout fonctionne juste après
avoir ajouté le secret, ou avant une opération risquée (migration,
changement de règles).

## Sauvegarde manuelle (poste local)

```bash
npm install firebase-admin --no-save
export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json
node scripts/backup-firestore.mjs
# Sortie par défaut : backups/<horodatage-ISO>/
```

## Vérifier l'intégrité d'une sauvegarde avant de l'utiliser

Avant toute restauration, vérifier :

1. **`manifest.json`** — `collections[*].ok` doit être `true` pour les
   collections critiques (`mc_accounts`, `mc_patients`,
   `mc_consultations`, `mc_prescriptions` en priorité). Une collection
   en échec (`ok: false`) n'invalide pas le reste de la sauvegarde,
   mais doit être retentée séparément avant de compter dessus.
2. **Nombre de documents cohérent** — comparer `collections[*].count`
   à un ordre de grandeur connu (nombre de patients/comptes attendu).
   Un `0` inattendu sur une collection habituellement peuplée est un
   signal d'alerte (mauvais projet Firebase ciblé, clé de service
   compte insuffisant, etc.) — ne pas restaurer sans comprendre
   pourquoi d'abord.
3. **Age de la sauvegarde** — le nom du dossier (`--out`) ou
   l'horodatage `manifest.json.startedAt` indique quand elle a été
   prise ; une restauration écrasera tout ce qui a été écrit depuis.

## Déchiffrer une sauvegarde téléchargée depuis GitHub Actions

Depuis le correctif de chiffrement, l'artefact téléchargé contient
`backup-output.tar.gz.gpg` (chiffré) et `backup-output.tar.gz.gpg.manifest.json`
(public, à vérifier en premier — voir section suivante). Pour
déchiffrer (jamais publier `FIRESTORE_BACKUP_ENCRYPTION_KEY` en clair,
même dans un terminal partagé/enregistré) :

```bash
# La passphrase doit être saisie ou fournie via une variable
# d'environnement locale — jamais en argument de commande visible
# dans l'historique du shell si le poste est partagé.
export FIRESTORE_BACKUP_ENCRYPTION_KEY='<passphrase depuis le gestionnaire de secrets>'

gpg --batch --yes --decrypt \
  --passphrase "$FIRESTORE_BACKUP_ENCRYPTION_KEY" \
  --output backup-output.tar.gz backup-output.tar.gz.gpg

mkdir -p backup-output
tar -xzf backup-output.tar.gz -C backup-output/
rm -f backup-output.tar.gz  # ne pas laisser le tar en clair après extraction

# Vérifier le manifeste public AVANT toute restauration (voir section suivante)
cat backup-output.tar.gz.gpg.manifest.json
```

Le dossier `backup-output/` obtenu est identique à ce que
`scripts/backup-firestore.mjs` produit normalement (un `.ndjson` par
collection + `manifest.json` détaillé) — poursuivre avec la
restauration ci-dessous.

## Restauration

⚠️ **Ne jamais exécuter directement en production sans vérification
préalable** — une restauration écrase les documents existants avec
ceux de la sauvegarde. Toujours commencer par `--dry-run` (mode par
défaut, aucune écriture) :

```bash
npm install firebase-admin --no-save
export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json

# 1. Dry-run : affiche ce qui SERAIT restauré, sans rien écrire
node scripts/restore-firestore.mjs --from backup-output

# 2. Restauration réelle, une fois le dry-run vérifié
node scripts/restore-firestore.mjs --from backup-output --apply

# 3. Restauration partielle (une ou plusieurs collections seulement)
node scripts/restore-firestore.mjs --from backup-output --collections mc_accounts,mc_patients --apply
```

(Pour une sauvegarde manuelle non chiffrée, produite localement sans
passer par le workflow — voir "Sauvegarde manuelle" ci-dessus —
`--from` pointe directement vers `backups/<horodatage-ISO>/`, sans
étape de déchiffrement.)

## Limites assumées (transparence)

- Le chiffrement (gpg symétrique AES256) protège le contenu au repos
  dans l'artefact GitHub Actions, mais reste aussi solide que la
  passphrase `FIRESTORE_BACKUP_ENCRYPTION_KEY` elle-même — une
  passphrase faible ou fuitée annule cette protection.
- Le manifeste public (`checksumSha256`) permet de vérifier l'intégrité
  de l'ARCHIVE CHIFFRÉE (aucune corruption pendant le transfert/stockage),
  mais pas une vérification cryptographique de chaque document
  individuel après déchiffrement — le `manifest.json` interne
  (comptage par collection, produit par `backup-firestore.mjs`) reste
  le seul garde-fou côté contenu.
- Rétention de 30 jours sur les artefacts GitHub Actions (réduite
  depuis 90 jours avec le chiffrement — voir plus haut) — pour un
  historique plus long, télécharger et archiver manuellement (toujours
  sous forme chiffrée) les sauvegardes importantes ailleurs.
- Aucune restauration automatique n'est déclenchée par ce dépôt — la
  restauration reste toujours une décision et une action manuelles.
- La perte de `FIRESTORE_BACKUP_ENCRYPTION_KEY` rend TOUTES les
  sauvegardes existantes définitivement irrécupérables (aucune clé de
  secours/recovery) — la passphrase doit être conservée dans un
  gestionnaire de secrets partagé de l'équipe, jamais uniquement dans
  GitHub Secrets (non lisible après écriture) ni sur un seul poste.
