# MedConnect — Système de notifications (v2.9.42)

Système de notifications médicales **multi-appareils**, sécurisé, avec Firestore
comme **source de vérité**. La notification push n'est qu'un **signal** invitant
le client à relire la notification autorisée depuis Firestore (Auth + App Check +
droits sur le document source). Aucune donnée médicale ne transite jamais dans un
payload push.

## Quatre objets distincts (ne jamais confondre)

| Objet | Collection | Nature |
|---|---|---|
| Message utilisateur | `mc_messages` | Échange écrit entre personnes |
| **Notification métier** | `notifications` | Signal « un événement te concerne » |
| Notification système push | (transport) | Réveil de l'appareil, sans contenu |
| Journal d'audit | `auditLogs` | Traçabilité administrative |

## Architecture en 4 niveaux

```
Événement métier canonique (mc_appointments, mc_lab_results, …)
        ↓  trigger Cloud Function v2 (transition réelle before/after)
Notification Firestore destinée à un utilisateur précis (notifications/{id})
        ↓  résolution des appareils (pushRegistrations) par Cloud Functions
Envoi via le fournisseur adapté à chaque appareil (FCM / Web Push / Electron)
```

Le client **n'envoie jamais** de push directement. Tout push est préparé et
envoyé depuis un environnement fiable : **Cloud Functions v2 + Admin SDK**, Web
Push serveur (Safari/iOS), secrets dans **Secret Manager**.

## Inventaire de l'existant (décisions)

| Composant actuel | Rôle réel | Décision | Canonique |
|---|---|---|---|
| `notifications` (cloud-db `createNotification`) | Notification métier (schéma mince) | **Étendu en place** | `notifications` |
| `mc_messages` / `Network.notify` | Message utilisateur | Conservé | `mc_messages` |
| `messages` (legacy) | Ancien miroir | Conservé (mort) | `mc_messages` |
| `db.js saveMessages`→`notifications` | Double écriture | Supprimé (v2.9.34) | — |
| `ExchangeBridge` listener `notifications` | Signal temps réel | Réutilisé/étendu | `notifications` |
| `Network.getUnread` / badges in-app | Compteur non-lus | Réutilisé + recalcul Firestore | `notifications`+`mc_messages` |
| `App.toast` | Feedback éphémère | Conservé (≠ notification) | — |
| Push FCM/VAPID/`setAppBadge` | Inexistant | **À créer** | `pushRegistrations`, `notificationDeliveries` |
| Préférences | Inexistant | À créer | `notificationPreferences` |
| `sw.js` | Cache PWA | **Étendu** (push), jamais un 2ᵉ SW | même SW |

## Collections canoniques

### `notifications/{notificationId}` — une notification pour UN utilisateur précis
Champs riches : `notificationId, eventId, deduplicationKey, type, category,
priority, recipientUid, recipientRole, hospitalId, sourceCollection,
sourceDocumentId, titleKey, bodyKey, localizationParams, safePreview, deepLink,
createdAt, expiresAt, readStatus, readAt, openedAt, dismissedAt, createdBySystem,
schemaVersion`.
- `recipientUid` **obligatoire** (aucun envoi clinique générique par rôle).
- `safePreview` sans donnée médicale ; `sourceDocumentId` technique.
- Immuable **sauf** champs d'état utilisateur (`readStatus/readAt/openedAt/
  dismissedAt/updatedAt`). Une notification appartient à **un seul** utilisateur.

### `pushRegistrations/{uid}/devices/{deviceId}` — une installation
`provider` ∈ {`fcm_android_native`, `fcm_web`, `webpush_ios`, `webpush_safari`,
`electron_running`}. `registrationToken`/`installationId`/`webPushSubscription`
= **données techniques sensibles** : jamais dans les logs, l'UI admin, un export,
ni accessibles à un autre utilisateur. **Écriture Cloud Functions uniquement.**

### `notificationPreferences/{uid}` — préférences par utilisateur
`enabled, language, timezone, quietHours, channels{…}, soundEnabled,
vibrationEnabled, criticalAlertsEnabled, updatedAt`. Ne bloquent **jamais** la
création de la notification interne ; contrôlent seulement les canaux externes.
Une alerte **sécurité/clinique critique** reste visible dans le centre même si le
push externe est coupé.

### `notificationDeliveries/{deliveryId}` — journal technique de livraison
`state` ∈ {`queued, sent_to_provider, failed_temporary, failed_permanent,
opened, read, expired`}. **Jamais `delivered`** sans preuve réelle du
fournisseur. Un succès FCM = `sent_to_provider`, **pas** « lu ».

## Règles Firestore (Phase 1 — livrée)

- `notifications` : lecture/màj par le **destinataire** (`recipientUid`), màj
  limitée aux champs d'état (dont `openedAt`) ; contenu/adressage immuables ;
  suppression admin. *(Le resserrement `create` = Cloud Functions uniquement est
  une étape **gatée** : appliquée après déploiement des triggers, pour ne pas
  casser les écritures client existantes — même approche que `mc_accounts`.)*
- `pushRegistrations/{uid}/devices` : **lecture propriétaire seule**, **écriture
  client toujours refusée** (Cloud Functions Auth + App Check).
- `notificationPreferences/{uid}` : propriétaire seul, `uid` immuable, pas de
  suppression.
- `notificationDeliveries` : Cloud Functions/Admin uniquement (aucun identifiant
  fournisseur exposé au client).

Testées à l'émulateur : `tests/firestore-rules/notifications-system-v2942.rules.test.js`.

## Confidentialité des push (rappel non négociable)

Un payload push ne contient QUE : `{ notificationId, category, priority,
deepLink, badgeCount }`. Jamais de diagnostic, résultat, valeur biologique, nom
de médicament, ordonnance, nom/numéro MC/date de naissance/téléphone du patient,
allergie, note, contenu de message, motif de consultation. Après clic : ouvrir →
Auth → App Check → lire `notifications/{id}` → vérifier `recipientUid` → vérifier
les droits sur le document source → afficher seulement ensuite.

## Phases

1. **Modèle + règles (4 collections)** — *livrée*.
2. Cloud Functions cœur (`enqueueNotification` + callables).
3. Déclencheurs métier (transitions réelles + idempotence `deduplicationKey`).
4. File d'envoi/retry (Cloud Tasks) + `cleanupStalePushRegistrations` + 404/410.
5. Fournisseurs push (FCM Web, Web Push iOS/Safari, FCM Android natif, Electron).
6. SW push + centre de notifications UI + deep links (allowlist).
7. Tests + miroirs Android + PR.
