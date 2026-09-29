/* =====================================================
   MedConnect — abonnement des établissements par Mobile Money (pawaPay)

   Flux : le responsable d'un établissement choisit une formule, son
   opérateur et son numéro ; startSubscriptionPayment demande à pawaPay de
   prélever son portefeuille (validation par code PIN). La confirmation est
   RELUE auprès de l'API pawaPay (interrogation par l'app via
   checkSubscriptionPayment, et rapprochement planifié) puis l'abonnement
   subscriptions/{hospitalId} est activé ou prolongé de 30 jours.

   Prix fixés côté serveur (jamais par l'app). Jeton : secret Secret
   Manager « PAWAPAY » (même compte pawaPay que Media Vision). Environnement :
   PAWAPAY_BASE_URL (sandbox par défaut). Mode et testeurs :
   appConfig/payments.pawapayMode (« live » | « sandbox ») et
   pawapayTesterUids.
   ===================================================== */
'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { randomUUID } = require('crypto');

const PAWAPAY_TOKEN = defineSecret('PAWAPAY');
const SANDBOX_URL = 'https://api.sandbox.pawapay.io';
const REGION = process.env.MEDCONNECT_FUNCTIONS_REGION || 'europe-west1';
const { SUBSCRIPTION_PLANS, normalizePhone, nextEndDate, DAY_MS } = require('./pawapay-helpers');
const GRACE_DAYS = 7;

const PROVIDERS_COD = new Set(['VODACOM_MPESA_COD', 'AIRTEL_COD', 'ORANGE_COD']);

const CALL_OPTS = {
  region: REGION,
  memory: '256MiB',
  minInstances: 0,
  maxInstances: 10,
  enforceAppCheck: true,
  secrets: [PAWAPAY_TOKEN],
};

const db = () => getFirestore();
const baseUrl = () => (process.env.PAWAPAY_BASE_URL || SANDBOX_URL).replace(/\/+$/, '');

async function pawapay(method, path, body) {
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${PAWAPAY_TOKEN.value()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await response.json(); } catch (_) { data = null; }
  return { httpStatus: response.status, data };
}

async function isPlatformAdmin(uid, token) {
  if (token && (token.admin === true || token.role === 'admin')) return true;
  const snap = await db().collection('users').doc(uid).get();
  return snap.exists && snap.data().role === 'admin';
}

async function assertCanPay(uid, token, hospitalId) {
  const admin = await isPlatformAdmin(uid, token);
  if (!admin) {
    // Le responsable paie avec le compte de l'établissement lui-même
    // (establishments/{id}.authUid) ; sinon, membre actif du personnel.
    const est = await db().collection('establishments').doc(hospitalId).get();
    const isEstablishmentAccount = est.exists && est.data().authUid === uid
      && ['active', 'approved'].includes(String(est.data().status || '').toLowerCase());
    if (!isEstablishmentAccount) {
      const member = await db().collection('hospitalMembers').doc(`${hospitalId}_${uid}`).get();
      if (!member.exists || member.data().status !== 'active') {
        throw new HttpsError('permission-denied', "Vous n'êtes pas membre actif de cet établissement.");
      }
    }
  }
  const config = (await db().collection('appConfig').doc('payments').get()).data() || {};
  const mode = config.pawapayMode;
  const testers = Array.isArray(config.pawapayTesterUids) ? config.pawapayTesterUids : [];
  const allowed = mode === 'live' || (mode === 'sandbox' && (admin || testers.includes(uid)));
  if (!allowed) {
    throw new HttpsError('failed-precondition', 'Le paiement Mobile Money n’est pas encore ouvert.');
  }
}

exports.startSubscriptionPayment = onCall(CALL_OPTS, async (request) => {
  try {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise.');
    const { hospitalId, plan, provider } = request.data || {};
    const phoneNumber = normalizePhone(request.data?.phoneNumber);
    if (typeof hospitalId !== 'string' || !hospitalId || hospitalId.length > 128 || hospitalId.includes('/')) {
      throw new HttpsError('invalid-argument', 'Établissement introuvable.');
    }
    const planInfo = SUBSCRIPTION_PLANS[plan];
    if (!planInfo) throw new HttpsError('invalid-argument', 'Formule inconnue.');
    if (!PROVIDERS_COD.has(provider)) throw new HttpsError('invalid-argument', 'Opérateur non pris en charge.');
    if (!phoneNumber) {
      throw new HttpsError('invalid-argument', 'Numéro Mobile Money invalide (243 suivi de 9 chiffres).');
    }
    await assertCanPay(uid, request.auth.token, hospitalId);

    const depositId = randomUUID();
    const amount = String(planInfo.amount);
    const ref = db().collection('pawapayDeposits').doc(depositId);
    await ref.set({
      depositId, kind: 'subscription', hospitalId, plan, uid, provider,
      amount: planInfo.amount, currency: 'USD', status: 'INITIATED',
      sandbox: baseUrl() === SANDBOX_URL, createdAt: FieldValue.serverTimestamp(),
    });

    const { httpStatus, data } = await pawapay('POST', '/v2/deposits', {
      depositId,
      amount,
      currency: 'USD',
      payer: { type: 'MMO', accountDetails: { phoneNumber, provider } },
      customerMessage: 'MedConnect',
      clientReferenceId: hospitalId,
      metadata: [{ hospitalId }, { plan }],
    });
    const accepted = httpStatus < 400 && data && String(data.status).toUpperCase() === 'ACCEPTED';
    if (!accepted) {
      const reason = data?.failureReason?.failureMessage || data?.failureReason?.failureCode ||
        'Paiement refusé par l’opérateur.';
      await ref.set({ status: 'REJECTED', failureReason: reason }, { merge: true });
      throw new HttpsError('failed-precondition', reason);
    }
    await ref.set({ status: 'ACCEPTED' }, { merge: true });
    return { depositId, status: 'pending', amount: planInfo.amount, currency: 'USD' };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('startSubscriptionPayment', error);
    throw new HttpsError('internal', `Paiement impossible : ${error?.message || error}`);
  }
});

/** Relit le dépôt chez pawaPay et active l'abonnement s'il est payé (idempotent). */
async function reconcileDeposit(depositId) {
  const ref = db().collection('pawapayDeposits').doc(depositId);
  const snap = await ref.get();
  if (!snap.exists) return { status: 'unknown' };
  const dep = snap.data();
  if (dep.status === 'COMPLETED') return { status: 'paid' };

  const { httpStatus, data } = await pawapay('GET', `/v2/deposits/${encodeURIComponent(depositId)}`);
  if (httpStatus >= 400 || !data) return { status: 'pending' };
  const remote = data.data && typeof data.data === 'object' ? data.data : data;
  const status = String(remote?.status || '').toUpperCase();

  if (status === 'COMPLETED') {
    const sameAmount = remote.amount == null || Math.abs(Number(remote.amount) - dep.amount) < 0.01;
    const sameCurrency = remote.currency == null || remote.currency === 'USD';
    if (!sameAmount || !sameCurrency) {
      await ref.set({ status: 'MISMATCH' }, { merge: true });
      return { status: 'failed', message: 'Paiement incohérent : contactez MedConnect.' };
    }
    const subRef = db().collection('subscriptions').doc(dep.hospitalId);
    await db().runTransaction(async (tx) => {
      const [depNow, subSnap] = await Promise.all([tx.get(ref), tx.get(subRef)]);
      if (depNow.data()?.status === 'COMPLETED') return; // déjà appliqué
      const current = subSnap.exists ? subSnap.data() : null;
      const now = Date.now();
      tx.set(subRef, {
        hospitalId: dep.hospitalId,
        establishmentId: dep.hospitalId,
        plan: dep.plan,
        status: 'active',
        billingCycle: 'monthly',
        startDate: current?.startDate || new Date(now).toISOString(),
        endDate: nextEndDate(current, now),
        graceUntil: '',
        activatedAt: new Date(now).toISOString(),
        paymentMethod: 'pawapay',
        lastPaymentDepositId: depositId,
        lastPaymentAmount: dep.amount,
        lastPaymentCurrency: 'USD',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(ref, { status: 'COMPLETED', completedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(db().collection('auditLogs').doc(), {
        action: 'subscription_paid_pawapay',
        targetType: 'subscriptions',
        targetId: dep.hospitalId,
        details: { plan: dep.plan, amount: dep.amount, currency: 'USD', depositId },
        actorUid: dep.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    return { status: 'paid' };
  }
  if (status === 'FAILED' || status === 'REJECTED') {
    const reason = remote?.failureReason?.failureMessage || remote?.failureReason?.failureCode ||
      'Paiement refusé ou annulé.';
    await ref.set({ status: 'FAILED', failureReason: reason }, { merge: true });
    return { status: 'failed', message: reason };
  }
  return { status: 'pending' };
}

exports.checkSubscriptionPayment = onCall(CALL_OPTS, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise.');
  const depositId = request.data?.depositId;
  if (typeof depositId !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(depositId)) {
    throw new HttpsError('invalid-argument', 'Paiement introuvable.');
  }
  const snap = await db().collection('pawapayDeposits').doc(depositId).get();
  if (!snap.exists || snap.data().uid !== uid) throw new HttpsError('not-found', 'Paiement introuvable.');
  return reconcileDeposit(depositId);
});

exports.reconcileSubscriptionDeposits = onSchedule(
  { schedule: 'every 10 minutes', region: REGION, secrets: [PAWAPAY_TOKEN] },
  async () => {
    const since = Timestamp.fromMillis(Date.now() - DAY_MS);
    const pending = await db().collection('pawapayDeposits')
      .where('status', '==', 'ACCEPTED').where('createdAt', '>=', since).limit(100).get();
    for (const doc of pending.docs) {
      try { await reconcileDeposit(doc.id); } catch (e) { console.error('reconcile', doc.id, e); }
    }
  }
);

/* Échéances de tous les abonnements datés (payés par pawaPay, activés
   à la main, ou essai gratuit) :
   active → grace_period (7 jours) → expired ; trial → expired. */
exports.expirePawapaySubscriptions = onSchedule(
  { schedule: 'every day 02:00', timeZone: 'Africa/Lubumbashi', region: REGION },
  async () => {
    const now = Date.now();
    const subs = await db().collection('subscriptions')
      .where('status', 'in', ['active', 'grace_period', 'trial']).get();
    for (const doc of subs.docs) {
      const s = doc.data();
      const end = Date.parse(s.endDate || '');
      if (!Number.isFinite(end)) continue;
      if (s.status === 'trial' && end < now) {
        await doc.ref.set({ status: 'expired', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      } else if (s.status === 'active' && end < now) {
        await doc.ref.set({
          status: 'grace_period',
          graceUntil: new Date(end + GRACE_DAYS * DAY_MS).toISOString(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } else if (s.status === 'grace_period' && Date.parse(s.graceUntil || '') < now) {
        await doc.ref.set({ status: 'expired', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    }
  }
);

