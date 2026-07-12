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
exporte Firestore **chaque jour à 02:00 UTC**, et publie le résultat
comme **artefact de run** (conservé 90 jours) — jamais commité dans le
dépôt git (données potentiellement volumineuses et sensibles).

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

**Cette clé donne un accès complet (lecture/écriture) à tout le
projet Firebase** — à traiter avec la même prudence qu'un mot de
passe administrateur. La révoquer : Firebase Console → Comptes de
service → supprimer la clé, puis en régénérer une nouvelle si besoin.

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

## Restauration

⚠️ **Ne jamais exécuter directement en production sans vérification
préalable** — une restauration écrase les documents existants avec
ceux de la sauvegarde. Toujours commencer par `--dry-run` (mode par
défaut, aucune écriture) :

```bash
npm install firebase-admin --no-save
export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json

# 1. Dry-run : affiche ce qui SERAIT restauré, sans rien écrire
node scripts/restore-firestore.mjs --from backups/2026-07-12T02-00-00-000Z

# 2. Restauration réelle, une fois le dry-run vérifié
node scripts/restore-firestore.mjs --from backups/2026-07-12T02-00-00-000Z --apply

# 3. Restauration partielle (une ou plusieurs collections seulement)
node scripts/restore-firestore.mjs --from backups/2026-07-12T02-00-00-000Z --collections mc_accounts,mc_patients --apply
```

Si la sauvegarde provient d'un artefact GitHub Actions : la
télécharger depuis l'onglet Actions du run concerné, la décompresser,
puis pointer `--from` vers le dossier obtenu.

## Limites assumées (transparence)

- Les sauvegardes ne sont **pas chiffrées au repos** au-delà de ce que
  GitHub Actions applique déjà à ses artefacts — ne pas les
  télécharger sur un poste non sécurisé.
- Pas de vérification cryptographique d'intégrité (checksum) entre
  l'export et le réimport — le `manifest.json` (comptage) est le seul
  garde-fou actuel.
- Rétention de 90 jours sur les artefacts GitHub Actions (limite de la
  plateforme sur ce plan) — pour un historique plus long, télécharger
  et archiver manuellement les sauvegardes importantes ailleurs.
- Aucune restauration automatique n'est déclenchée par ce dépôt — la
  restauration reste toujours une décision et une action manuelles.
