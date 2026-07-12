# Révocation de session et custom claims — MedConnect

## Pourquoi ce mécanisme

L'audit sécurité a identifié deux limites liées à l'absence de serveur
(Cloud Function) :

1. **Révocation de session** — un compte suspendu (`status: 'suspended'`)
   perd déjà l'accès aux **données** Firestore en quasi temps réel
   (`accountStatusOk()`, `firestore.rules`, fermé dans un chantier
   précédent). Mais son **jeton Firebase Auth** restait valide jusqu'à
   expiration naturelle — le SDK client continue de le rafraîchir
   silencieusement tant que rien ne révoque le refresh token côté
   serveur.
2. **Custom claims** — `firestore.rules` lit déjà
   `request.auth.token.get('role', null)` et `.get('admin', false)`
   **en OR** avec la vérification Firestore (`users/{uid}.role`), mais
   `setCustomUserClaims` n'était jamais appelé nulle part dans ce
   dépôt — ces branches des règles étaient mortes, jamais alimentées.

## Ce que fait `scripts/sync-account-security.mjs`

À chaque exécution, il lit `mc_accounts` et :
- pour tout compte `status === 'suspended'` avec un `authUid` :
  révoque ses refresh tokens (`revokeRefreshTokens`) ;
- pour tout compte `status` dans `['approved', 'active']` avec un
  `authUid` et un `role` : pose de vrais custom claims
  (`{ role, admin }`) via `setCustomUserClaims`.

Chaque compte est traité indépendamment (un échec n'interrompt jamais
les autres), même principe que `scripts/backup-firestore.mjs`.

## Exécution automatique

`.github/workflows/sync-account-security.yml` tourne **toutes les
30 minutes** + déclenchement manuel. Il réutilise le secret
`FIREBASE_SERVICE_ACCOUNT_JSON` **déjà configuré** pour la sauvegarde
(voir `docs/BACKUP_RESTORE_RUNBOOK.md`) — **aucune nouvelle action
manuelle requise** pour activer ce chantier.

## Honnêteté — ce que ce n'est PAS

Ceci n'est **pas** une révocation instantanée façon Cloud Function
réactive (déclenchée immédiatement à l'écriture de `status: 'suspended'`).
C'est un balayage périodique : un compte suspendu entre son passage à
`'suspended'` et le prochain run peut donc garder un jeton Firebase
Auth valide jusqu'à **30 minutes** — délai assumé, documenté, et sans
solution gratuite plus rapide sans Cloud Function.

**Important** : ce délai ne concerne que le jeton Firebase Auth
lui-même. L'accès aux **données** Firestore, lui, reste coupé en
quasi temps réel dès l'écriture de `status: 'suspended'`
(`accountStatusOk()`) — c'est la vraie protection immédiate, ce
script ferme une limite secondaire (le jeton continue d'exister,
même s'il ne sert plus à grand-chose côté données).

## Exécution manuelle (poste local)

```bash
npm install firebase-admin --no-save
export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json
node scripts/sync-account-security.mjs               # dry-run (aucune écriture)
node scripts/sync-account-security.mjs --apply        # exécution réelle
```
