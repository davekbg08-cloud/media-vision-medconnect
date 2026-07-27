#!/usr/bin/env bash
#
# MedConnect 2.0 — Déploiement ORDONNÉ v2.9.42 (chantiers 6/7 + sécurité).
#
# Ce script applique l'ordre IMPÉRATIF documenté dans docs/DEPLOYMENT_v2.9.42.md :
#
#     Cloud Functions  →  [GATE login staging]  →  Règles Firestore
#                       →  [GATE login staging]  →  Hosting (PWA)
#
# Pourquoi cet ordre : la fermeture de la lecture publique de `mc_accounts`
# (firestore.rules) dépend de Cloud Functions de confiance (authLookup,
# checkAgentDuplicate, claimPatientAccount). Déployer les règles AVANT les
# fonctions casserait la connexion. Le script REFUSE donc de déployer les
# règles tant que tu n'as pas confirmé, à la main, que le login staging
# fonctionne après le déploiement des fonctions.
#
# INVARIANTS respectés :
#   - Aucune donnée Firestore n'est supprimée, réinitialisée, ni migrée par
#     ce script (la migration éventuelle reste un geste séparé — cf. §1/§2 du
#     guide, avec backup + dry-run + journal).
#   - Aucun secret n'est manipulé ni affiché. Le service-account reste sur ton
#     poste, référencé par GOOGLE_APPLICATION_CREDENTIALS ; l'authentification
#     du déploiement passe par `firebase login` (jamais un secret en clair ici).
#
# Usage :
#   scripts/deploy-ordered-v2942.sh [--project <id>] [--target staging|prod]
#                                   [--skip-preflight] [--dry-run]
#
#   --project <id>     ID de projet Firebase (sinon projet par défaut du CLI).
#   --target           Étiquette d'environnement affichée dans les gates
#                      (par défaut: staging). N'a AUCUN effet destructeur ;
#                      sert à te rappeler où tu déploies.
#   --skip-preflight   Ne relance pas lint/tests/scan (déconseillé).
#   --dry-run          N'exécute AUCUN déploiement : affiche seulement les
#                      commandes qui seraient lancées.
#
set -euo pipefail

# --- couleurs (désactivées si pas un TTY) ------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; CYA=$'\033[36m'; RST=$'\033[0m'
else
  BOLD=''; RED=''; GRN=''; YEL=''; CYA=''; RST=''
fi
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s\n' "${BOLD}${CYA}==> $*${RST}"; }
ok()   { printf '%s\n' "${GRN}✔ $*${RST}"; }
warn() { printf '%s\n' "${YEL}⚠ $*${RST}"; }
die()  { printf '%s\n' "${RED}✗ $*${RST}" >&2; exit 1; }

# --- args --------------------------------------------------------------------
PROJECT=""; TARGET="staging"; SKIP_PREFLIGHT=0; DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --target)  TARGET="${2:-}"; shift 2 ;;
    --skip-preflight) SKIP_PREFLIGHT=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Option inconnue : $1 (voir --help)" ;;
  esac
done

PROJECT_ARG=()
[ -n "$PROJECT" ] && PROJECT_ARG=(--project "$PROJECT")

# `firebase` lancé (ou simplement affiché en dry-run).
fb() {
  if [ "$DRY_RUN" -eq 1 ]; then
    say "  ${YEL}[dry-run]${RST} firebase $* ${PROJECT_ARG[*]:-}"
  else
    firebase "$@" "${PROJECT_ARG[@]}"
  fi
}

# Gate manuel : demande une confirmation explicite. Toute réponse ≠ "oui"/"o"
# interrompt le déploiement (fail-safe : on n'avance pas dans le doute).
gate() {
  local prompt="$1"
  printf '\n%s\n' "${BOLD}${YEL}⏸  GATE — $prompt${RST}"
  printf '%s' "   Confirmer pour continuer ? [oui/non] : "
  local ans; read -r ans || true
  case "${ans,,}" in
    oui|o|yes|y) ok "Confirmé, on continue." ;;
    *) die "Interrompu au gate (réponse : « ${ans:-<vide>} »). Rien de plus n'a été déployé." ;;
  esac
}

cd "$(dirname "$0")/.."   # racine du dépôt

say "${BOLD}MedConnect — Déploiement ordonné v2.9.42${RST}"
say "Cible affichée : ${BOLD}${TARGET}${RST}   Projet : ${BOLD}${PROJECT:-<défaut CLI>}${RST}   Dry-run : ${BOLD}$([ "$DRY_RUN" -eq 1 ] && echo oui || echo non)${RST}"

if [ "$DRY_RUN" -eq 0 ]; then
  command -v firebase >/dev/null 2>&1 || die "CLI 'firebase' introuvable. Installe firebase-tools puis relance."
fi

# --- 0. Pré-vol : lint + tests + scan secrets --------------------------------
if [ "$SKIP_PREFLIGHT" -eq 0 ]; then
  step "0. Pré-vol (lint + tests + scan secrets)"
  npm run lint
  node --test tests/*.test.js
  npm run security:scan
  ok "Pré-vol vert."
else
  warn "Pré-vol sauté (--skip-preflight)."
fi

# --- 1. Cloud Functions (AVANT toute règle) ----------------------------------
step "1. Déploiement des Cloud Functions (chantiers 6/7 + notifications)"
say "   Inclut notamment : authLookup, checkAgentDuplicate, claimPatientAccount,"
say "   setVerifiedClientType, et l'ossature notifications."
if [ "$DRY_RUN" -eq 0 ]; then
  ( cd functions && npm install )
fi
fb deploy --only functions
ok "Fonctions déployées."

gate "Sur ${TARGET}, teste MAINTENANT à la main : (a) connexion d'un professionnel,
   (b) premier accès d'un patient, (c) inscription d'un agent (détection de doublon).
   Ces parcours passent désormais par les fonctions. Tout fonctionne ?"

# --- 2. Règles Firestore (fermeture mc_accounts) — après gate ----------------
step "2. Déploiement des règles Firestore (fermeture lecture publique mc_accounts)"
say "   La règle restreinte est DÉJÀ dans firestore.rules (titulaire/admin only)."
fb deploy --only firestore:rules
ok "Règles déployées."

gate "Re-teste sur ${TARGET} : connexion pro + premier accès patient fonctionnent
   TOUJOURS (désormais sans lecture publique de mc_accounts) ?
   En cas d'échec : rollback rapide possible via l'onglet Règles de la console."

# --- 3. Hosting (PWA) --------------------------------------------------------
step "3. Déploiement Hosting (PWA v2.9.42 — cache medconnect-v4.43)"
fb deploy --only hosting
ok "Hosting déployé."

# --- Rappels non automatisés (décisions humaines) ----------------------------
step "Reste à décider MANUELLEMENT (non lancé par ce script)"
cat <<EOF
  • App Check : activer l'enforcement dans la console APRÈS avoir vérifié qu'aucun
    appareil légitime n'est rejeté (docs/FIREBASE_APP_CHECK_SETUP.md).
  • CSP : DÉJÀ bloquante et complète (firebase.json) — elle a pris effet à
    l'étape Hosting ci-dessus. Vérifier la console navigateur (aucune violation
    'Refused to ... Content Security Policy'). En cas de blocage d'une ressource
    légitime : repasser la clé du header en Content-Security-Policy-Report-Only
    puis redéployer le hosting (rollback observation seule).
  • Notifications (envoi réel) : clés VAPID dans Secret Manager + clé publique
    côté client + google-services.json Android, puis re-déployer les fonctions.
  • Android APK : versionCode 43 / 2.9.42, miroirs déjà synchronisés.
EOF

printf '\n%s\n' "${BOLD}${GRN}Déploiement ordonné terminé (dans l'ordre, avec gates respectés).${RST}"
say "Une fois §App Check + §CSP validés en ${TARGET}, la version peut passer"
say "de READY FOR STAGING à READY FOR PRODUCTION."
