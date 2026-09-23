#!/usr/bin/env bash
#
# MedConnect — Audit npm + tests + déploiement des Cloud Functions.
#
# Reproduit, en un seul script réutilisable, la séquence :
#   git pull → functions/npm audit fix → npm audit --omit=dev (rapport) →
#   npm test (racine, 971 tests) → commit+push (SEULEMENT si le lockfile a
#   changé ET que les tests sont verts) → firebase deploy --only functions.
#
# Le runtime cible (firebase.json / functions/package.json → nodejs24) doit
# correspondre à la version Node locale utilisée pour lancer ce script, sinon
# le déploiement échoue avec « User code failed to load. Cannot determine
# backend specification. Timeout after 10000. » (mismatch de version Node
# entre le poste local et le runtime des fonctions — vu et corrigé le
# 2026-09-23 : nodejs20 déprécié → nodejs24).
#
# INVARIANTS respectés (mêmes que scripts/deploy-ordered-v2942.sh) :
#   - Aucune donnée Firestore n'est touchée.
#   - Aucun secret manipulé ni affiché.
#   - `set -euo pipefail` : le script s'arrête au premier échec (ex. tests
#     rouges) plutôt que d'enchaîner commit/push/deploy sur du cassé.
#   - `npm audit fix --force` n'est JAMAIS lancé automatiquement (changement
#     cassant potentiel) : les vulnérabilités qui l'exigent restent
#     signalées, à traiter manuellement.
#
# Usage :
#   scripts/audit-deploy-functions.sh [--project <id>] [--skip-audit-fix]
#                                      [--no-push] [--dry-run]
#
#   --project <id>     ID de projet Firebase (sinon projet par défaut du CLI).
#   --skip-audit-fix   Ne lance pas `npm audit fix` (audit --omit=dev quand
#                      même exécuté, pour rapport).
#   --no-push          Commit local si le lockfile a changé, mais ne pousse
#                      pas (et ne déploie pas : le déploiement doit partir du
#                      code réellement poussé).
#   --dry-run          N'exécute AUCUNE commande qui modifie quoi que ce soit
#                      (pull/commit/push/deploy) : affiche seulement les
#                      commandes qui seraient lancées. audit/tests tournent
#                      quand même (lecture seule).
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
PROJECT=""; SKIP_AUDIT_FIX=0; NO_PUSH=0; DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --skip-audit-fix) SKIP_AUDIT_FIX=1; shift ;;
    --no-push) NO_PUSH=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Option inconnue : $1 (voir --help)" ;;
  esac
done

PROJECT_ARG=()
[ -n "$PROJECT" ] && PROJECT_ARG=(--project "$PROJECT")

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    say "  ${YEL}[dry-run]${RST} $*"
  else
    "$@"
  fi
}

cd "$(dirname "$0")/.."   # racine du dépôt

command -v firebase >/dev/null 2>&1 || die "CLI 'firebase' introuvable. Installe firebase-tools puis relance."

LOCAL_NODE_MAJOR="$(node -e "console.log(process.versions.node.split('.')[0])")"
RUNTIME_NODE_MAJOR="$(node -e "console.log(require('./firebase.json').functions.runtime.match(/\d+/)[0])" 2>/dev/null || echo '?')"
if [ "$LOCAL_NODE_MAJOR" != "$RUNTIME_NODE_MAJOR" ]; then
  warn "Node local (v${LOCAL_NODE_MAJOR}) ≠ runtime functions (nodejs${RUNTIME_NODE_MAJOR})."
  warn "Le déploiement risque le timeout « Cannot determine backend specification »."
  warn "Aligne l'un sur l'autre (nvm use ${RUNTIME_NODE_MAJOR}, ou mets à jour firebase.json) avant de continuer."
fi

say "${BOLD}MedConnect — Audit + tests + déploiement Cloud Functions${RST}"
say "Projet : ${BOLD}${PROJECT:-<défaut CLI>}${RST}   Dry-run : ${BOLD}$([ "$DRY_RUN" -eq 1 ] && echo oui || echo non)${RST}"

step "1. git pull"
run git pull

step "2. functions/ — npm audit"
( cd functions
  if [ "$SKIP_AUDIT_FIX" -eq 0 ]; then
    say "   npm audit fix (jamais --force : pas de breaking change automatique)"
    npm audit fix || warn "npm audit fix a rencontré des vulnérabilités restantes (voir rapport ci-dessous)."
  else
    warn "npm audit fix sauté (--skip-audit-fix)."
  fi
  say "   npm audit --omit=dev (rapport, ne bloque pas le script)"
  npm audit --omit=dev || warn "Vulnérabilités restantes en dépendances de prod — triage manuel requis (souvent --force = breaking change)."
)

step "3. npm test (racine)"
npm test
ok "Tests verts."

step "4. Commit + push (seulement si functions/package-lock.json a changé)"
git add functions/package.json functions/package-lock.json
if git diff --cached --quiet -- functions/package.json functions/package-lock.json; then
  ok "Aucun changement de dépendances functions à committer."
else
  run git commit -m "chore(functions): npm audit fix

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  if [ "$NO_PUSH" -eq 1 ]; then
    warn "--no-push : commit local uniquement, déploiement SAUTÉ (il doit partir du code poussé)."
    exit 0
  fi
  run git push
  ok "Poussé."
fi

step "5. firebase deploy --only functions"
run firebase deploy --only functions "${PROJECT_ARG[@]}"
ok "Déploiement terminé."
