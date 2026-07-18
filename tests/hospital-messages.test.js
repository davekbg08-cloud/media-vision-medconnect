/* =====================================================
   Tests — HospitalMessagesModule (messagerie interne desktop hôpital)

   Retour utilisateur : le shell desktop hôpital n'avait aucune
   messagerie (contrairement au mobile). Ajoutée en réutilisant
   Network.notify()/DB.getMessages() (mêmes collections/règles
   Firestore) — destinataires limités au personnel affilié à
   l'établissement actif ; pièce jointe = référence vers une fiche
   patient/ordonnance déjà existante (jamais un fichier uploadé, pas de
   Firebase Storage sur ce projet).

   Exécute le VRAI js/hospital-messages.js dans un bac à sable vm (même
   convention que tests/hospital-lab-desktop-workflow.test.js).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fakeElement(initial = {}) {
  return { value: '', textContent: '', innerHTML: '', disabled: false, dataset: {}, style: {}, selectedOptions: [], ...initial };
}

function setup({
  role = 'doctor',
  staff = [],
  currentUid = 'user-1',
  messages = [],
  patients = [],
  prescriptions = [],
  requireWritableSubscriptionImpl = async () => true,
} = {}) {
  const elements = new Map();
  const getEl = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };
  const toasts = [];
  const opened = { title: null, html: null, count: 0 };
  let localMessages = messages.slice();

  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;

  sandbox.HospitalPermissions = { getCurrentRole: () => role, requireRoute: () => true };
  sandbox.HospitalAuth = { getSession: () => ({ agentUid: currentUid, role }) };
  sandbox.Auth = { getUser: () => ({ uid: currentUid, role }) };
  sandbox.HospitalsRegistry = { getCurrentHospital: () => ({ establishmentId: 'EST-1', staff }) };
  sandbox.App = {
    toast: (msg, type) => toasts.push({ msg, type }),
    openModal: (title, html) => { opened.title = title; opened.html = html; opened.count++; return true; },
    closeModal: () => {},
  };
  sandbox.HospitalDesktopUI = { navigate: () => {} };
  sandbox.confirm = () => true;
  sandbox.CloudDB = {
    getActiveHospitalId: async () => 'EST-1',
    requireWritableSubscription: requireWritableSubscriptionImpl,
  };
  sandbox.DB = {
    getMessages: () => localMessages,
    saveMessages: (list) => { localMessages = list; },
    getPatients: () => patients,
    getPrescriptions: () => prescriptions,
  };
  sandbox.Network = {
    notify: (payload) => {
      localMessages.push({
        mid: `MSG-${localMessages.length + 1}`,
        to_role: payload.to_role, to_id: payload.to_id, type: payload.type,
        subject: payload.subject, body: payload.body, priority: payload.priority,
        from: 'Test Sender', fromUid: currentUid,
        date: '2026-07-18', createdAt: '2026-07-18T00:00:00.000Z',
        read: false, readStatus: 'unread',
        attachedRecordType: payload.attachedRecordType || null,
        attachedRecordId: payload.attachedRecordId || null,
        attachedRecordLabel: payload.attachedRecordLabel || null,
      });
    },
    markRead: (mid) => {
      const m = localMessages.find(x => x.mid === mid);
      if (m) { m.read = true; m.readStatus = 'read'; }
    },
  };
  sandbox.document = { getElementById: getEl, confirm: () => true };

  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-messages.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/hospital-messages.js' });
  return { sandbox, toasts, opened, getEl, messagesRef: () => localMessages };
}

test('render() affiche "Aucun message." quand la boîte est vide', async () => {
  const { sandbox } = setup({});
  const container = { innerHTML: '' };
  await sandbox.HospitalMessagesModule.render(container);
  assert.match(container.innerHTML, /Aucun message/);
  assert.match(container.innerHTML, /Nouveau message/);
});

test("render() liste les messages adressés au rôle/uid de l'agent connecté", async () => {
  const { sandbox } = setup({
    role: 'doctor',
    currentUid: 'doc-1',
    messages: [{ mid: 'M1', to_role: 'doctor', to_id: 'doc-1', subject: 'Analyse urgente', body: '...', from: 'Lab', date: '2026-07-18' }],
  });
  const container = { innerHTML: '' };
  await sandbox.HospitalMessagesModule.render(container);
  assert.match(container.innerHTML, /Analyse urgente/);
});

test('openNew() liste les destinataires depuis le personnel affilié, sans inclure soi-même', () => {
  const { sandbox, opened } = setup({
    currentUid: 'doc-1',
    staff: [
      { uid: 'doc-1', role: 'doctor', name: 'Moi-même', status: 'active' },
      { uid: 'nurse-1', role: 'nurse', name: 'Infirmière A', status: 'active' },
      { uid: 'lab-1', role: 'lab', name: 'Labo B', status: 'active' },
    ],
  });
  const result = sandbox.HospitalMessagesModule.openNew();
  assert.strictEqual(result, true);
  assert.strictEqual(opened.count, 1);
  assert.match(opened.html, /Infirmière A/);
  assert.match(opened.html, /Labo B/);
  assert.ok(!/Moi-même/.test(opened.html), "l'agent ne doit pas pouvoir s'envoyer un message à lui-même");
});

test('send() refuse sans destinataire sélectionné', async () => {
  const { sandbox, getEl, toasts } = setup({ staff: [{ uid: 'nurse-1', role: 'nurse', name: 'Infirmière A', status: 'active' }] });
  sandbox.HospitalMessagesModule.openNew();
  getEl('hm-subject').value = 'Test';
  getEl('hm-body').value = 'Contenu';
  const result = await sandbox.HospitalMessagesModule.send();
  assert.strictEqual(result, false);
  assert.ok(toasts.some(t => t.type === 'error'));
});

test('send() envoie un message sans pièce jointe au destinataire choisi', async () => {
  const { sandbox, getEl, messagesRef } = setup({
    currentUid: 'doc-1',
    staff: [{ uid: 'nurse-1', role: 'nurse', name: 'Infirmière A', status: 'active' }],
  });
  sandbox.HospitalMessagesModule.openNew();
  getEl('hm-to').value = 'nurse-1';
  getEl('hm-to').selectedOptions = [{ dataset: { role: 'nurse', name: 'Infirmière A' } }];
  getEl('hm-subject').value = 'Consigne';
  getEl('hm-body').value = 'Merci de vérifier le patient MC-1';
  const result = await sandbox.HospitalMessagesModule.send();
  assert.strictEqual(result, true);
  const msg = messagesRef().find(m => m.subject === 'Consigne');
  assert.ok(msg, 'le message doit être créé');
  assert.strictEqual(msg.to_role, 'nurse');
  assert.strictEqual(msg.to_id, 'nurse-1');
  assert.strictEqual(msg.attachedRecordType, null);
});

test('send() avec pièce jointe "fiche patient" refuse si le numéro MC ne correspond à aucun patient du cache local', async () => {
  const { sandbox, getEl } = setup({
    staff: [{ uid: 'nurse-1', role: 'nurse', name: 'Infirmière A', status: 'active' }],
    patients: [],
  });
  sandbox.HospitalMessagesModule.openNew();
  getEl('hm-to').value = 'nurse-1';
  getEl('hm-to').selectedOptions = [{ dataset: { role: 'nurse', name: 'Infirmière A' } }];
  getEl('hm-subject').value = 'Suivi';
  getEl('hm-body').value = 'Voir la fiche';
  getEl('hm-attach-type').value = 'patient';
  getEl('hm-attach-mc').value = 'MC-INCONNU';
  const result = await sandbox.HospitalMessagesModule.send();
  assert.strictEqual(result, false);
});

test('send() avec pièce jointe "fiche patient" valide joint la référence (jamais un fichier)', async () => {
  const { sandbox, getEl, messagesRef } = setup({
    staff: [{ uid: 'nurse-1', role: 'nurse', name: 'Infirmière A', status: 'active' }],
    patients: [{ id: 'MC-1', firstname: 'Jean', lastname: 'Dupont' }],
  });
  sandbox.HospitalMessagesModule.openNew();
  getEl('hm-to').value = 'nurse-1';
  getEl('hm-to').selectedOptions = [{ dataset: { role: 'nurse', name: 'Infirmière A' } }];
  getEl('hm-subject').value = 'Suivi';
  getEl('hm-body').value = 'Voir la fiche';
  getEl('hm-attach-type').value = 'patient';
  getEl('hm-attach-mc').value = 'mc-1';
  const result = await sandbox.HospitalMessagesModule.send();
  assert.strictEqual(result, true);
  const msg = messagesRef().find(m => m.subject === 'Suivi');
  assert.strictEqual(msg.attachedRecordType, 'patient');
  assert.strictEqual(msg.attachedRecordId, 'MC-1');
  assert.match(msg.attachedRecordLabel, /Jean Dupont/);
});

test('send() avec pièce jointe "ordonnance" refuse si aucune ordonnance sélectionnée', async () => {
  const { sandbox, getEl } = setup({
    staff: [{ uid: 'nurse-1', role: 'nurse', name: 'Infirmière A', status: 'active' }],
  });
  sandbox.HospitalMessagesModule.openNew();
  getEl('hm-to').value = 'nurse-1';
  getEl('hm-to').selectedOptions = [{ dataset: { role: 'nurse', name: 'Infirmière A' } }];
  getEl('hm-subject').value = 'Ordonnance';
  getEl('hm-body').value = 'Voir ordonnance';
  getEl('hm-attach-type').value = 'prescription';
  getEl('hm-attach-rx').value = '';
  const result = await sandbox.HospitalMessagesModule.send();
  assert.strictEqual(result, false);
});

test('send() avec pièce jointe "ordonnance" valide joint la référence', async () => {
  const { sandbox, getEl, messagesRef } = setup({
    staff: [{ uid: 'nurse-1', role: 'nurse', name: 'Infirmière A', status: 'active' }],
    prescriptions: [{ pid: 'RX-1', patient_id: 'MC-1', date: '2026-07-10', medicines: [{ name: 'Amoxicilline' }] }],
  });
  sandbox.HospitalMessagesModule.openNew();
  getEl('hm-to').value = 'nurse-1';
  getEl('hm-to').selectedOptions = [{ dataset: { role: 'nurse', name: 'Infirmière A' } }];
  getEl('hm-subject').value = 'Ordonnance';
  getEl('hm-body').value = 'Voir ordonnance';
  getEl('hm-attach-type').value = 'prescription';
  getEl('hm-attach-rx').value = 'RX-1';
  const result = await sandbox.HospitalMessagesModule.send();
  assert.strictEqual(result, true);
  const msg = messagesRef().find(m => m.subject === 'Ordonnance');
  assert.strictEqual(msg.attachedRecordType, 'prescription');
  assert.strictEqual(msg.attachedRecordId, 'RX-1');
});

test('openMessage() marque le message comme lu et affiche la pièce jointe', () => {
  const { sandbox, opened, messagesRef } = setup({
    currentUid: 'doc-1',
    messages: [{
      mid: 'M2', to_role: 'doctor', to_id: 'doc-1', subject: 'Résultat', body: 'Voir la fiche jointe',
      from: 'Labo', date: '2026-07-18', read: false, readStatus: 'unread',
      attachedRecordType: 'patient', attachedRecordId: 'MC-1', attachedRecordLabel: 'Jean Dupont (MC-1)',
    }],
  });
  const result = sandbox.HospitalMessagesModule.openMessage('M2');
  assert.strictEqual(result, true);
  assert.match(opened.html, /Jean Dupont \(MC-1\)/);
  const msg = messagesRef().find(m => m.mid === 'M2');
  assert.strictEqual(msg.read, true);
});

test("openAttachment('patient', ...) affiche la fiche depuis le cache local", () => {
  const { sandbox, opened } = setup({ patients: [{ id: 'MC-1', firstname: 'Jean', lastname: 'Dupont' }] });
  const result = sandbox.HospitalMessagesModule.openAttachment('patient', 'MC-1');
  assert.strictEqual(result, true);
  assert.match(opened.html, /Jean Dupont/);
});

test("openAttachment('patient', ...) échoue proprement si absent du cache (jamais d'accès élargi)", () => {
  const { sandbox, opened, toasts } = setup({ patients: [] });
  const result = sandbox.HospitalMessagesModule.openAttachment('patient', 'MC-INCONNU');
  assert.strictEqual(result, false);
  assert.strictEqual(opened.count, 0);
  assert.ok(toasts.some(t => t.type === 'error'));
});

test("openAttachment('prescription', ...) affiche l'ordonnance depuis le cache local", () => {
  const { sandbox, opened } = setup({
    prescriptions: [{ pid: 'RX-1', patient_id: 'MC-1', date: '2026-07-10', medicines: [{ name: 'Amoxicilline' }] }],
  });
  const result = sandbox.HospitalMessagesModule.openAttachment('prescription', 'RX-1');
  assert.strictEqual(result, true);
  assert.match(opened.html, /Amoxicilline/);
});

test('deleteMessage() supprime le message pour l\'agent courant uniquement', () => {
  const { sandbox, messagesRef } = setup({
    currentUid: 'doc-1',
    messages: [{ mid: 'M3', to_role: 'doctor', to_id: 'doc-1', subject: 'À supprimer', body: '...', from: 'X', date: '2026-07-18' }],
  });
  const result = sandbox.HospitalMessagesModule.deleteMessage('M3');
  assert.strictEqual(result, true);
  const msg = messagesRef().find(m => m.mid === 'M3');
  assert.ok(msg.deletedFor.includes('doc-1'));
});
