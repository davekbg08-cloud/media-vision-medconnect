/* Fonctions pures de l'abonnement pawaPay (sans dépendance, testables). */
'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS = 30;

/** Formules et prix mensuels (USD) — source de vérité unique. */
const SUBSCRIPTION_PLANS = {
  essentiel: { name: 'Essentiel', amount: 250 },
  pro: { name: 'Pro', amount: 500 },
  institution: { name: 'Institution', amount: 800 },
};

/** Numéro RDC au format pawaPay : 243 + 9 chiffres, sans « + ». */
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const n = digits.startsWith('243') ? digits : digits.startsWith('0') ? `243${digits.slice(1)}` : digits;
  return /^243\d{9}$/.test(n) ? n : null;
}

/** Nouvelle date de fin : prolonge un abonnement encore valide, sinon part d'aujourd'hui. */
function nextEndDate(current, nowMs) {
  const end = current && current.endDate ? Date.parse(current.endDate) : NaN;
  const stillValid = current && ['active', 'grace_period'].includes(current.status) && end > nowMs;
  const base = stillValid ? end : nowMs;
  return new Date(base + PERIOD_DAYS * DAY_MS).toISOString();
}

module.exports = { SUBSCRIPTION_PLANS, normalizePhone, nextEndDate, DAY_MS };
