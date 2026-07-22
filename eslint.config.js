/* =====================================================
   MedConnect 2.0 — Configuration ESLint (flat, ESLint 9)
   Chantier D : filet anti-régression statique.

   Objectif : attraper les VRAIS bugs (clés dupliquées, code
   inatteignable, typeof invalide, variables non définies…) sans
   noyer l'équipe sous des remarques de style. Le code existant
   (vanilla JS, globales IIFE) doit passer avec 0 ERREUR ; les
   points d'amélioration non bloquants restent en « warning ».

   `npm run lint` échoue uniquement sur les erreurs.
   ===================================================== */
const js = require('@eslint/js');

// Globales exposées par les modules du projet (window.X = …) : les
// référencer ailleurs ne doit pas déclencher no-undef.
const PROJECT_GLOBALS = [
  'ACL', 'ActionFeedback', 'AdminModule', 'App', 'AppointmentsModule', 'Auth',
  'CloudDB', 'Currency', 'DB', 'EmergencyTransferModule', 'ExchangeBridge',
  'HospitalAuth', 'HospitalBedsModule', 'HospitalCapabilities', 'HospitalDesktopUI',
  'HospitalEmergencyModule', 'HospitalLabModule', 'HospitalMaternityModule',
  'HospitalMessagesModule', 'HospitalModule', 'HospitalPermissions', 'HospitalPortal',
  'HospitalReceptionModule', 'HospitalSubscriptionModule', 'HospitalsRegistry',
  'I18n', 'LabModule', 'LazyLoader', 'MapModule', 'MedConnectAdminCloud',
  'MedConnectBackButton', 'MedConnectHaptics', 'MedConnectInboxControls',
  'MedConnectPatientEditGuard', 'MedicalAIModule', 'MedicalRecordDesktop',
  'MedicalRecordSharing', 'Network', 'PatientModule', 'PatientPortal', 'PharmacyModule',
  'PharmacyPortal', 'Settings', 'ShareModule', 'SyncBadge', 'Timeline',
  'TransferService', 'VersionManager', 'navigateMedConnect',
  // Fonctions top-level de firebase-config.js exposées globalement.
  'resolveAppCheckSiteKey', 'activateAppCheck',
  // Externes chargés globalement (Firebase compat SDK, Leaflet, lib QR
  // optionnelle chargée à la demande côté scan de partage).
  'firebase', 'L', 'Html5Qrcode',
];

// Globales d'état Firebase RÉELLEMENT réassignées par firebase-config.js
// (firebaseReady bascule true/false, firebaseDB/Auth sont posés) → writable.
const WRITABLE_GLOBALS = ['firebaseDB', 'firebaseAuth', 'firebaseReady'];

// Divers (garde UMD `typeof module`, encodage, plateforme).
const MISC_GLOBALS = ['module', 'exports', 'require', 'process', 'globalThis', 'TextEncoder', 'TextDecoder'];

// Globales navigateur usuelles (sous-ensemble suffisant, ESLint 9 n'embarque
// plus `env`). Toutes en lecture seule.
const BROWSER_GLOBALS = [
  'window', 'document', 'navigator', 'location', 'history', 'screen',
  'localStorage', 'sessionStorage', 'console', 'fetch', 'Headers', 'Request', 'Response',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'alert', 'confirm', 'prompt', 'FormData', 'Blob', 'File',
  'FileReader', 'URL', 'URLSearchParams', 'XMLHttpRequest', 'WebSocket', 'Event',
  'CustomEvent', 'MutationObserver', 'IntersectionObserver', 'matchMedia', 'getComputedStyle',
  'crypto', 'btoa', 'atob', 'structuredClone', 'AbortController', 'Notification',
  'HTMLElement', 'Node', 'Image', 'DOMParser', 'performance', 'CSS',
];

const readonly = names => Object.fromEntries(names.map(n => [n, 'readonly']));

// Règles « bruyantes » sur du code legacy : rétrogradées pour ne pas
// masquer les vraies erreurs. Elles restent visibles en warning.
const NOISY_TO_WARN = {
  // Motif maison intentionnel : `const X = (()=>…)(); window.X = X;` — la
  // déclaration locale coïncide volontairement avec la globale exposée.
  // no-undef reste actif (bien plus utile ici : il attrape les typos et
  // les références non résolues, comme MedDB dans js/share.js).
  'no-redeclare': 'off',
  'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'no-cond-assign': ['warn', 'except-parens'],
  'no-constant-condition': ['warn', { checkLoops: false }],
  'no-fallthrough': 'warn',
  'no-useless-escape': 'warn',
  'no-async-promise-executor': 'warn',
  'no-case-declarations': 'warn',
  'no-irregular-whitespace': 'warn',
  'no-prototype-builtins': 'off',
  'no-control-regex': 'off',
  'no-extra-boolean-cast': 'off',
};

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'android/**', 'electron/**', 'playwright-report/**', 'test-results/**', 'coverage/**'] },

  // Modules applicatifs (navigateur, globales IIFE).
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        ...readonly(BROWSER_GLOBALS), ...readonly(PROJECT_GLOBALS), ...readonly(MISC_GLOBALS),
        ...Object.fromEntries(WRITABLE_GLOBALS.map(n => [n, 'writable'])),
      },
    },
    rules: { ...js.configs.recommended.rules, ...NOISY_TO_WARN },
  },

  // Service worker : contexte et globales spécifiques.
  {
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...readonly(['self', 'caches', 'clients', 'fetch', 'console', 'Promise', 'URL', 'location']) },
    },
    rules: { ...js.configs.recommended.rules, ...NOISY_TO_WARN },
  },
];
