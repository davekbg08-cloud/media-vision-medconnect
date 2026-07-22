/* =====================================================
   Tests — Chantier A (socle UI/UX + sécurité, v2.9.38)
   ① Toasts accessibles & priorisés (js/app.js + css/style.css)
   ② Boutons : focus, tactile, états, variantes, aria
   ③ sourceDevice = signal UX / défense en profondeur (jamais garde
      unique) + thème auto (prefers-color-scheme)
   Analyse de source (mêmes dépendances DOM que les autres tests app/UI).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const appSrc   = read('js/app.js');
const cssSrc   = read('css/style.css');
const bridgeSrc = read('js/exchange-bridge.js');
const rulesSrc = read('firestore.rules');
const hospitalSrc = read('js/hospital.js');

/* ── ① Toasts — accessibilité & priorité ───────────── */
test('① toast() reste rétrocompatible : signature (msg, type, opts) avec type par défaut', () => {
  assert.match(appSrc, /function toast\(msg, type = 'success', opts = \{\}\)/);
});

test('① toast pose aria-live (assertive pour error/urgence, polite sinon) et role', () => {
  const i = appSrc.indexOf('function toast(');
  const body = appSrc.slice(i, i + 2200);
  assert.match(body, /isCritical\s*=\s*\(type === 'error' \|\| type === 'urgence'\)/);
  assert.match(body, /setAttribute\('aria-live', isCritical \? 'assertive' : 'polite'\)/);
  assert.match(body, /setAttribute\('role', isCritical \? 'alert' : 'status'\)/);
});

test('① la durée dépend de la gravité : erreur plus longue, urgence persistante', () => {
  assert.match(appSrc, /TOAST_MS\s*=\s*\{[^}]*success:\s*3500/);
  assert.match(appSrc, /error:\s*6000/);
  assert.match(appSrc, /urgence:\s*0/); // 0 = persistant (pas d'auto-fermeture)
});

test('① empilement borné (max 4) et message posé via textContent (jamais d\'HTML injecté)', () => {
  const i = appSrc.indexOf('function toast(');
  const body = appSrc.slice(i, i + 2200);
  assert.match(body, /while \(c\.children\.length >= 4\)/);
  assert.match(body, /body\.textContent = msg/);
  assert.doesNotMatch(body, /innerHTML\s*=\s*msg/);
});

test('① action rapide + bouton de fermeture (nécessaire pour les toasts persistants)', () => {
  const i = appSrc.indexOf('function toast(');
  const body = appSrc.slice(i, i + 2800);
  assert.match(body, /opts\.action/);
  assert.match(body, /className = 'toast-close'/);
  assert.match(body, /setAttribute\('aria-label', 'Fermer la notification'\)/);
});

test('① CSS toast : structure flex, icône, action, fermeture, variante urgence, reduced-motion', () => {
  assert.match(cssSrc, /\.toast \{ display:flex/);
  assert.match(cssSrc, /\.toast-ico/);
  assert.match(cssSrc, /\.toast-action/);
  assert.match(cssSrc, /\.toast-close/);
  assert.match(cssSrc, /\.toast-urgence/);
  assert.match(cssSrc, /prefers-reduced-motion: no-preference[\s\S]*toast-pulse/);
});

/* ── ② Boutons — focus, tactile, états, variantes ──── */
test('② .btn : cible tactile ≥ 44px et focus clavier visible', () => {
  assert.match(cssSrc, /\.btn \{ min-height: 44px; \}/);
  assert.match(cssSrc, /\.btn:focus-visible \{\s*outline: 2px solid var\(--primary\)/);
});

test('② état désactivé et état chargement (spinner, reduced-motion)', () => {
  assert.match(cssSrc, /\.btn:disabled,\s*\.btn\[aria-disabled="true"\]/);
  assert.match(cssSrc, /\.btn-loading::after/);
  assert.match(cssSrc, /@keyframes btn-spin/);
  assert.match(cssSrc, /prefers-reduced-motion: reduce[\s\S]*btn-loading::after/);
});

test('② variantes de rôle réutilisant les couleurs sémantiques', () => {
  assert.match(cssSrc, /\.btn-danger\b/);
  assert.match(cssSrc, /\.btn-medical\b/);
  assert.match(cssSrc, /\.btn-admin\b/);
});

test('② App.setBtnLoading existe, est exporté, et ne casse pas button-feedback (aria-busy + disabled)', () => {
  assert.match(appSrc, /function setBtnLoading\(btn, loading\)/);
  assert.match(appSrc, /toggleTheme, openModal, closeModal, toast, setBtnLoading, init/);
  const i = appSrc.indexOf('function setBtnLoading(');
  const body = appSrc.slice(i, i + 500);
  assert.match(body, /setAttribute\('aria-busy', 'true'\)/);
});

test('② boutons-icônes critiques ont un libellé accessible (🩺 consultation, 🖨️ impression)', () => {
  assert.match(hospitalSrc, /aria-label="Nouvelle consultation"[^>]*>🩺/);
  assert.match(hospitalSrc, /aria-label="Imprimer l'ordonnance"[^>]*>🖨️/);
});

/* ── ③ sourceDevice : défense en profondeur, jamais garde unique ── */
test('③ le contrat de sécurité sourceDevice est explicite côté client', () => {
  assert.match(bridgeSrc, /CONTRAT DE SÉCURITÉ/);
  assert.match(bridgeSrc, /jamais.*garde unique|ne fait JAMAIS.*accorder/s);
});

test('③ firestore.rules : hospitalCanWriteFromDevice ne peut qu\'ASSOUPLIR (abonnement OU device != desktop)', () => {
  // Forme sûre verrouillée : l'abonnement est la vraie garde ; le device
  // ne fait que relâcher pour le mobile. Jamais l'inverse.
  assert.match(rulesSrc, /function hospitalCanWriteFromDevice\(hospitalId, deviceValue\) \{\s*return hospitalSubscriptionOk\(hospitalId\) \|\| deviceValue != 'desktop';/);
});

test('③ la LIMITE DE SÉCURITÉ CONNUE reste documentée dans firestore.rules', () => {
  assert.match(rulesSrc, /LIMITE DE SÉCURITÉ CONNUE — sourceDevice est DÉCLARÉ par le/);
  assert.match(rulesSrc, /NE PAS présenter\s*[\s\S]{0,40}ce contrôle comme une sécurité forte/);
});

/* ── ③ Thème auto ─────────────────────────────────── */
test('③ le thème suit prefers-color-scheme quand aucun choix explicite n\'est enregistré', () => {
  assert.match(appSrc, /prefers-color-scheme: light/);
  assert.match(appSrc, /savedTheme === 'light' \|\| \(!savedTheme && prefersLight\)/);
});
