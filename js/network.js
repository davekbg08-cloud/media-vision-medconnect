/* =====================================================
   MedConnect 2.0 — Réseau Médical
   Flux : Médecin ↔ Pharmacie ↔ Patient
   Ordonnance intelligente (allergies + stock)
   ===================================================== */
const Network = (() => {
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  function patientName(patient) {
    if (!patient) return '—';
    return `${patient.firstname || patient.prenom || ''} ${patient.lastname || patient.nom || ''}`.trim() || '—';
  }

  /* ── NOTIFICATIONS ─────────────────────────────────
     Champs nouveaux ajoutés SANS retirer les anciens :
     to_role/to_id/read (existants) restent fonctionnels.
     toUid/fromUid/fromRole/readStatus/priority/createdAt
     sont les champs propres pour les nouveaux usages.
  ──────────────────────────────────────────────────── */
  function notify({
    to_role, to_id, type, subject, body, priority, recipientUid, hospitalId,
    // Pièce jointe (chantier "messagerie desktop hôpital") : référence
    // vers une fiche patient ou une ordonnance DÉJÀ existante dans
    // Firestore — jamais un fichier/photo uploadé (pas de Firebase
    // Storage sur ce projet). Le destinataire ne peut ouvrir la
    // référence que s'il a lui-même le droit de lire ce document
    // (règles Firestore de mc_patients/mc_prescriptions, inchangées) :
    // joindre une référence n'élargit aucun accès.
    attachedRecordType = null, attachedRecordId = null, attachedRecordLabel = null,
  }) {
    const from = window.Auth?.getUser?.();
    const msgs = DB.getMessages();
    msgs.push({
      mid:        DB.makeId('N'),
      to_role, to_id, type, subject, body,
      toUid:      to_id || null,
      // PARTIE H — recipientUid : uid Firebase réel du destinataire
      // patient quand disponible (patientAuthUid, posé après migration
      // PIN → Firebase Auth), en plus de to_id qui reste le numéro MC
      // pour compatibilité avec le matching existant (recipientKeys).
      recipientUid: recipientUid || null,
      fromUid:    from?.uid || null,
      fromRole:   from?.role || 'system',
      from:       from?.name || 'MedConnect',
      priority:   priority === 'urgent' ? 'urgent' : 'normal',
      date:       new Date().toISOString().slice(0,10),
      createdAt:  new Date().toISOString(),
      read:       false,
      readStatus: 'unread',
      readAt:     null,
      // Correctif (audit) : seul champ qui permet à
      // hospitalCanWriteFromDevice() (firestore.rules, mc_messages) de
      // s'appliquer — absent (null) pour les 8 autres types de
      // notification (rendez-vous, ordonnance, labo, affiliation...),
      // qui restent donc toujours autorisés comme aujourd'hui. Seule la
      // messagerie pro→pro (js/transfer_ui_patch.js) le renseigne.
      hospitalId: hospitalId || null,
      sourceDevice: window.ExchangeBridge?.currentSourceDevice?.() || 'mobile',
      attachedRecordType, attachedRecordId, attachedRecordLabel,
    });
    DB.saveMessages(msgs);
  }

  function recipientKeys(user) {
    return [user?.uid, user?.patient_id, user?.username, user?.order_num, user?.matricule]
      .filter(Boolean);
  }

  function messageMatchesUser(message, user) {
    if (!user || message.to_role !== user.role) return false;
    if (!message.to_id) return true;
    return recipientKeys(user).includes(message.to_id);
  }

  // Correctif (audit) : dupliqué à l'identique de
  // js/inbox_message_controls.js isDeletedForUser (même convention de
  // duplication déjà en place pour recipientKeys/messageMatchesUser) —
  // nécessaire ici pour que getUnread() ne compte pas un message que
  // l'utilisateur a supprimé de sa boîte.
  function isDeletedForUser(message, user) {
    const keys = recipientKeys(user).map(String);
    const deletedFor = Array.isArray(message.deletedFor) ? message.deletedFor.map(String) : [];
    return keys.some(key => deletedFor.includes(key));
  }

  function getUnread(role, id) {
    const user = window.Auth?.getUser?.();
    // Correctif (audit) : un message supprimé (deletedFor) sans jamais
    // avoir été ouvert restait compté ici indéfiniment — inbox_message_
    // controls.js filtre bien deletedFor pour l'AFFICHAGE de la liste
    // (renderInbox), mais ne patche jamais getUnread(), utilisé tel quel
    // par le badge du menu (js/app.js buildNav). Le badge restait donc
    // bloqué à un nombre non nul sans qu'aucune action utilisateur ne
    // puisse plus jamais le faire redescendre.
    if (!id && user?.role === role) {
      return DB.getMessages().filter(m =>
        messageMatchesUser(m, user) && !isDeletedForUser(m, user) && m.readStatus !== 'read' && !m.read
      ).length;
    }
    return DB.getMessages().filter(m =>
      m.to_role === role && (!id || m.to_id === id) && m.readStatus !== 'read' && !m.read
    ).length;
  }

  function markRead(mid) {
    const msgs = DB.getMessages();
    const m    = msgs.find(x => x.mid === mid);
    if (m) {
      m.read = true;
      m.readStatus = 'read';
      m.readAt = new Date().toISOString();
      DB.saveMessages(msgs);
    }
  }

  function markUnread(mid) {
    const msgs = DB.getMessages();
    const m    = msgs.find(x => x.mid === mid);
    if (m) { m.read = false; m.readStatus = 'unread'; m.readAt = null; DB.saveMessages(msgs); }
  }

  /* ── INBOX UI — non lus en premier, urgents en tête ─── */
  function renderInbox(main) {
    const user = Auth.getUser();
    const msgs = DB.getMessages()
      .filter(m => messageMatchesUser(m, user))
      .sort((a,b) => {
        const unreadA = a.readStatus !== 'read' && !a.read ? 1 : 0;
        const unreadB = b.readStatus !== 'read' && !b.read ? 1 : 0;
        if (unreadA !== unreadB) return unreadB - unreadA;
        const urgentA = a.priority === 'urgent' ? 1 : 0;
        const urgentB = b.priority === 'urgent' ? 1 : 0;
        if (urgentA !== urgentB) return urgentB - urgentA;
        return (b.createdAt || b.date || '').localeCompare(a.createdAt || a.date || '');
      });

    main.innerHTML = `
      <div class="page-header">
        <h2>📨 Messagerie Médicale</h2>
        <button class="btn btn-primary btn-sm" onclick="Network.openCompose()">✉️ Nouveau message</button>
      </div>
      ${!msgs.length ? `<div class="card empty-state"><p>Aucun message</p></div>` : ''}
      <div class="records-list">
        ${msgs.map(m => {
          const isUnread = m.readStatus !== 'read' && !m.read;
          return `
          <div class="record-card ${isUnread?'unread-msg':''}" onclick="Network.openMsg('${m.mid}')">
            <div class="record-header">
              <span>${typeIcon(m.type)}</span>
              ${m.priority === 'urgent' ? `<span class="chip" style="color:var(--danger);border-color:var(--danger)">🔴 Urgent</span>` : ''}
              <strong>${esc(m.subject)}</strong>
              <span class="record-date">📅 ${m.date}</span>
              ${isUnread ? `<span class="unread-dot"></span>` : ''}
            </div>
            <p style="font-size:.84rem;color:var(--text-muted)">De : ${esc(m.from)}</p>
            <p style="font-size:.83rem">${esc(m.body).slice(0,100)}${m.body.length>100?'…':''}</p>
          </div>`;
        }).join('')}
      </div>`;
  }

  function typeIcon(type) {
    const m = { prescription:'💊', appointment:'📅', stock:'📦', alert:'⚠️', info:'ℹ️' };
    return m[type] || '📩';
  }

  function openMsg(mid) {
    const m = DB.getMessages().find(x => x.mid === mid); if (!m) return;
    markRead(mid);
    App.openModal(`${typeIcon(m.type)} ${m.subject}`, `
      <p style="font-size:.84rem;color:var(--text-muted)">De : <strong>${esc(m.from)}</strong> · 📅 ${m.date}</p>
      <hr style="border-color:var(--border);margin:1rem 0">
      <p style="font-size:.9rem;line-height:1.7">${esc(m.body).replace(/\n/g,'<br>')}</p>
      <div class="form-actions" style="margin-top:1rem">
        <button class="btn btn-ghost btn-sm" onclick="Network.markUnread('${m.mid}');App.closeModal();App.navigateTo('inbox')">Marquer non lu</button>
      </div>`);
  }

  function openCompose() {
    App.openModal('✉️ Nouveau message', `
      <form onsubmit="Network.sendMessage(event)">
        <div class="form-group"><label>Destinataire (rôle)</label>
          <select id="msg-role">
            <option value="patient">🩺 Patient</option>
            <option value="doctor">👨‍⚕️ Médecin</option>
            <option value="pharmacist">💊 Pharmacien</option>
            <option value="nurse">🩹 Infirmier</option>
          </select>
        </div>
        <div class="form-group"><label>Priorité</label>
          <select id="msg-priority">
            <option value="normal">Normale</option>
            <option value="urgent">🔴 Urgente</option>
          </select>
        </div>
        <div class="form-group"><label>Sujet *</label><input type="text" id="msg-subject" required></div>
        <div class="form-group"><label>Message *</label><textarea id="msg-body" rows="5" required></textarea></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
          <button type="submit" class="btn btn-primary">📤 Envoyer</button>
        </div>
      </form>`);
  }

  function sendMessage(e) {
    e.preventDefault();
    notify({
      to_role:  document.getElementById('msg-role').value,
      type:     'info',
      priority: document.getElementById('msg-priority').value,
      subject:  document.getElementById('msg-subject').value,
      body:     document.getElementById('msg-body').value,
    });
    App.closeModal();
    App.toast('✅ Message envoyé');
  }

  /* ── DOCTOR → PHARMACY (ciblée, plus de diffusion globale) ──
     PARTIE H — restreint strictement à l'admin et au médecin auteur de
     l'ordonnance, aligné sur la règle serveur mc_prescriptions.update
     (doctorCanRead || admin). L'ancien repli ACL.canAccessPatient
     autorisait à tort toute personne ayant simplement accès au dossier
     patient (via consentement notamment) à envoyer une ordonnance. */
  function canSendPrescription(rx) {
    const user = Auth.getUser();
    if (!user || !rx) return false;
    if (user.role === 'admin') return true;
    return rx.created_by === user.uid || rx.doctor_uid === user.uid;
  }

  /** Liste les pharmaciens actifs pouvant recevoir une ordonnance.
      PARTIE H — accepte aussi 'active' (pas seulement 'approved'),
      sinon des pharmacies pourtant validées restaient invisibles. */
  function getAvailablePharmacies() {
    return DB.getAccounts().filter(a => a.role === 'pharmacist' && ['approved', 'active'].includes(a.status));
  }

  /** PARTIE E/F — envoi ciblé : 'patient' | uid pharmacien précis.
      PARTIE H — devient asynchrone et attend la confirmation Firestore
      réelle (DB.updatePrescriptionAndConfirm) avant d'afficher un
      message de succès — plus de toast optimiste sur une écriture
      fire-and-forget non confirmée. */
  async function sendPrescriptionToPharmacy(prescriptionId, target) {
    const rx = DB.getPrescriptions().find(p => p.pid === prescriptionId || p.code === prescriptionId);
    if (!rx) { App.toast('Ordonnance introuvable.', 'error'); return; }
    if (!canSendPrescription(rx)) { App.toast('Accès ordonnance non autorisé.', 'error'); return; }

    const pt = DB.getPatientById(rx.patient_id || rx.patientId);
    const patientId = rx.patient_id || rx.patientId || '—';
    const patientUid = pt?.patientAuthUid || null;

    function offlineOrDeniedMessage(reason) {
      return reason === 'offline'
        ? '📶 Ordonnance enregistrée localement — en attente de synchronisation.'
        : '❌ Échec de l\'envoi — droits ou connexion à vérifier.';
    }

    // Envoi d'une ordonnance = action desktop soumise à l'abonnement
    // (send_prescription_pharmacy ∈ DESKTOP_BLOCKED_ACTIONS). Décision
    // produit : les DEUX chemins d'envoi — dépôt dans l'espace du
    // patient ET dispatch vers une pharmacie précise — sont bloqués sur
    // desktop expiré. Le mobile n'est jamais coupé
    // (hospitalCanWriteFromDevice côté règles laisse toujours passer le
    // mobile). Contrôle unique en tête, avant tout chemin d'écriture.
    try {
      await window.CloudDB?.requireWritableSubscription?.('send_prescription_pharmacy');
    } catch (e) {
      App.toast(e.message || "Envoi bloqué : abonnement de l'établissement expiré.", 'error');
      return;
    }

    // sourceDevice courant, posé sur CHAQUE écriture : la règle serveur
    // (hospitalCanWriteFromDevice) en dépend pour gater le bon device —
    // sans lui elle lirait le device de CRÉATION persisté (piège déjà vu
    // sur mc_appointments).
    const sourceDevice = window.ExchangeBridge?.currentSourceDevice?.() || 'desktop';

    // "patient" seul : aucune pharmacie ne doit voir l'ordonnance
    if (!target || target === 'patient') {
      const result = await DB.updatePrescriptionAndConfirm(rx.pid, { pharmacyUid: null, pharmacyName: null, status: 'sent', sourceDevice });
      if (!result.ok) { App.toast(offlineOrDeniedMessage(result.reason), 'warning'); return; }
      notify({
        to_role: 'patient', to_id: patientId, recipientUid: patientUid, type: 'prescription',
        subject: '💊 Ordonnance disponible',
        body: `Votre ordonnance du ${rx.date} est disponible dans votre espace. Présentez-la à la pharmacie de votre choix.`,
      });
      App.toast('✅ Ordonnance enregistrée — patient uniquement');
      return;
    }

    // Pharmacie précise (uid réel d'un compte pharmacien)
    const pharmacist = getAvailablePharmacies().find(p => p.uid === target);
    if (!pharmacist) { App.toast('Pharmacie introuvable ou non validée.', 'error'); return; }

    const result = await DB.updatePrescriptionAndConfirm(rx.pid, {
      pharmacyUid:  pharmacist.uid,
      pharmacyName: pharmacist.pharmacy || pharmacist.name,
      status:       'sent',
      sourceDevice,
    });
    if (!result.ok) { App.toast(offlineOrDeniedMessage(result.reason), 'warning'); return; }

    const body = [
      `Patient : ${patientName(pt)} [${patientId}]`,
      `Diagnostic : ${rx.diagnosis || rx.diagnostic || '—'}`,
      `Médicaments :`,
      ...(rx.medicines||rx.items||[]).map(m => `  • ${m.name || m.nom} — ${m.dosage || m.traitement || ''}`),
      ``,
      `Date : ${rx.date} · Dr. ${rx.doctor || rx.docteur || '—'}`,
    ].join('\n');

    notify({
      to_role: 'pharmacist', to_id: pharmacist.uid, type: 'prescription',
      subject: `💊 Ordonnance patient ${patientId}`,
      body,
    });
    notify({
      to_role: 'patient', to_id: patientId, recipientUid: patientUid, type: 'prescription',
      subject: `✅ Ordonnance envoyée à ${pharmacist.pharmacy || pharmacist.name}`,
      body: `Votre ordonnance du ${rx.date} a été transmise. Vous pouvez aller récupérer vos médicaments.`,
    });
    App.toast(`📤 Ordonnance envoyée à ${pharmacist.pharmacy || pharmacist.name}`);
  }

  /* ── PARTIE B/H — statuts ordonnance côté pharmacie ───────── */
  const RX_STATUSES = ['sent','received','preparing','ready','delivered','cancelled'];

  // PARTIE H — transitions valides : empêche un retour arbitraire de
  // statut (ex : delivered → sent, qui était accepté sans contrôle).
  // cancelled reste atteignable depuis n'importe quel statut actif,
  // mais seulement avec une raison (vérifié ci-dessous).
  const RX_TRANSITIONS = {
    sent:      ['received', 'cancelled'],
    received:  ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready:     ['delivered', 'cancelled'],
    delivered: [],
    cancelled: [],
  };

  function setPrescriptionStatus(pid, status, reason) {
    const user = Auth.getUser();
    if (!RX_STATUSES.includes(status)) return;
    const rx = DB.getPrescriptions().find(p => p.pid === pid);
    if (!rx) return;
    const allowed = RX_TRANSITIONS[rx.status] || [];
    if (!allowed.includes(status)) {
      App.toast(`❌ Transition invalide : ${rx.status} → ${status}`, 'error');
      return;
    }
    if (status === 'cancelled' && !reason) {
      App.toast('⚠️ Une raison d\'annulation est requise.', 'error');
      return;
    }
    DB.updatePrescription(pid, {
      status, updatedByUid: user?.uid || '', updatedByRole: user?.role || '',
      ...(reason ? { cancelReason: reason } : {}),
    });
    const labels = { received:'reçue', preparing:'en préparation', ready:'prête', delivered:'remise au patient', cancelled:'annulée' };
    notify({
      to_role: 'doctor', to_id: rx.doctor_uid || rx.created_by, type: 'prescription',
      subject: `Ordonnance ${labels[status] || status}`,
      body: `L'ordonnance du patient ${rx.patient_id || rx.patientId} est désormais : ${labels[status] || status}.`,
    });
    notify({
      to_role: 'patient', to_id: rx.patient_id || rx.patientId, type: 'prescription',
      subject: `Votre ordonnance est ${labels[status] || status}`,
      body: `Mise à jour de votre ordonnance du ${rx.date} : ${labels[status] || status}.`,
    });
    App.toast(`✅ Statut mis à jour : ${labels[status] || status}`);
  }



  /* ── SMART PRESCRIPTION CHECK ──────────────────── */
  function smartCheck(patientId, medicines) {
    const patient = DB.getPatientById(patientId);
    if (!patient) return [];

    const warnings = [];
    const allergies  = (patient.allergies||'').toLowerCase();
    const meds_lower = DB.getMedicines().map(m => ({ ...m, namel: (m.name || m.nom || '').toLowerCase() }));

    medicines.forEach(med => {
      const name_l = (med.name||med.nom||'').toLowerCase();

      // 1. Allergie check
      if (allergies && allergies.split(/[,;\s]+/).some(a => a.length>2 && name_l.includes(a.trim()))) {
        warnings.push({ type:'allergy', med:med.name,
          msg:`⚠️ Allergie possible : <strong>${med.name}</strong> détecté dans les allergies du patient.` });
      }

      // 2. Stock check in pharmacy
      const stock = meds_lower.find(m => m.namel.includes(name_l) || name_l.includes(m.namel.slice(0,4)));
      if (stock && parseInt(stock.stock) === 0) {
        warnings.push({ type:'stock', med:med.name,
          msg:`📦 Rupture de stock : <strong>${med.name}</strong> indisponible en pharmacie.` });
      } else if (stock && parseInt(stock.stock) < 5) {
        warnings.push({ type:'stock_low', med:med.name,
          msg:`⚠️ Stock faible : <strong>${med.name}</strong> (${stock.stock} restants).` });
      }
    });

    // 3. Basic interaction check
    const INTERACTIONS = [
      ['aspirine','warfarine'], ['ibuprofène','aspirine'], ['métronidazole','alcool'],
      ['paracétamol','alcool'], ['amoxicilline','pénicilline'],
    ];
    const names = medicines.map(m => (m.name || m.nom || '').toLowerCase());
    INTERACTIONS.forEach(([a,b]) => {
      if (names.some(n=>n.includes(a)) && names.some(n=>n.includes(b))) {
        warnings.push({ type:'interaction', med:`${a}+${b}`,
          msg:`🔴 Interaction possible : <strong>${a}</strong> + <strong>${b}</strong> — vérifier la posologie.` });
      }
    });

    return warnings;
  }

  function renderSmartCheckResult(warnings) {
    if (!warnings.length) return `<div class="smart-ok">✅ Aucune alerte détectée</div>`;
    return `<div class="smart-warnings">
      ${warnings.map(w => `<div class="smart-warn smart-${w.type}">${w.msg}</div>`).join('')}
    </div>`;
  }

  /* ── STOCK CHECK FROM DOCTOR VIEW ──────────────── */
  function checkStockForMeds(medicines) {
    const meds = DB.getMedicines();
    return medicines.map(med => {
      const name_l = (med.name||med.nom||'').toLowerCase();
      const found  = meds.find(m => (m.name || m.nom || '').toLowerCase().includes(name_l) || name_l.includes((m.name || m.nom || '').toLowerCase().slice(0,4)));
      return {
        name:  med.name || med.nom,
        stock: found ? parseInt(found.stock) : -1,
        price: found ? (found.price || found.prix) : null,
      };
    });
  }

  return {
    notify, getUnread, markRead, markUnread,
    renderInbox, openMsg, openCompose, sendMessage,
    sendPrescriptionToPharmacy, getAvailablePharmacies, setPrescriptionStatus, RX_STATUSES, RX_TRANSITIONS,
    canSendPrescription,
    smartCheck, renderSmartCheckResult,
    checkStockForMeds,
  };
})();

window.Network = Network;
