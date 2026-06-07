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

  /* ── NOTIFICATIONS ─────────────────────────────── */
  function notify({ to_role, to_id, type, subject, body }) {
    const msgs = DB.getMessages();
    msgs.push({
      mid:     `N${Date.now()}`,
      to_role, to_id, type, subject, body,
      from:    window.Auth?.getUser?.()?.name || 'MedConnect',
      date:    new Date().toISOString().slice(0,10),
      read:    false,
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

  function getUnread(role, id) {
    const user = window.Auth?.getUser?.();
    if (!id && user?.role === role) {
      return DB.getMessages().filter(m => messageMatchesUser(m, user) && !m.read).length;
    }
    return DB.getMessages().filter(m =>
      m.to_role === role && (!id || m.to_id === id) && !m.read
    ).length;
  }

  function markRead(mid) {
    const msgs = DB.getMessages();
    const m    = msgs.find(x => x.mid === mid);
    if (m) { m.read = true; DB.saveMessages(msgs); }
  }

  /* ── INBOX UI ──────────────────────────────────── */
  function renderInbox(main) {
    const user = Auth.getUser();
    const msgs = DB.getMessages()
      .filter(m => messageMatchesUser(m, user))
      .sort((a,b) => b.date.localeCompare(a.date));

    main.innerHTML = `
      <div class="page-header">
        <h2>📨 Messagerie Médicale</h2>
        <button class="btn btn-primary btn-sm" onclick="Network.openCompose()">✉️ Nouveau message</button>
      </div>
      ${!msgs.length ? `<div class="card empty-state"><p>Aucun message</p></div>` : ''}
      <div class="records-list">
        ${msgs.map(m => `
          <div class="record-card ${m.read?'':'unread-msg'}" onclick="Network.openMsg('${m.mid}')">
            <div class="record-header">
              <span>${typeIcon(m.type)}</span>
              <strong>${esc(m.subject)}</strong>
              <span class="record-date">📅 ${m.date}</span>
              ${!m.read ? `<span class="unread-dot"></span>` : ''}
            </div>
            <p style="font-size:.84rem;color:var(--text-muted)">De : ${esc(m.from)}</p>
            <p style="font-size:.83rem">${esc(m.body).slice(0,100)}${m.body.length>100?'…':''}</p>
          </div>`).join('')}
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
      <p style="font-size:.9rem;line-height:1.7">${esc(m.body).replace(/\n/g,'<br>')}</p>`);
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
      to_role: document.getElementById('msg-role').value,
      type:    'info',
      subject: document.getElementById('msg-subject').value,
      body:    document.getElementById('msg-body').value,
    });
    App.closeModal();
    App.toast('✅ Message envoyé');
  }

  /* ── DOCTOR → PHARMACY ─────────────────────────── */
  function sendPrescriptionToPharmacy(prescriptionId, pharmacyName) {
    const rx = DB.getPrescriptions().find(p => p.pid === prescriptionId || p.code === prescriptionId); if (!rx) return;
    const pt = DB.getPatientById(rx.patient_id || rx.patientId);
    const patientId = rx.patient_id || rx.patientId || rx.patientNom || '—';
    const body = [
      `Patient : ${patientName(pt)} [${patientId}]`,
      `Diagnostic : ${rx.diagnosis || rx.diagnostic || '—'}`,
      `Médicaments :`,
      ...(rx.medicines||rx.items||[]).map(m => `  • ${m.name || m.nom} — ${m.dosage || m.traitement || ''}`),
      ``,
      `Date : ${rx.date} · Dr. ${rx.doctor || rx.docteur || '—'}`,
    ].join('\n');

    notify({
      to_role: 'pharmacist',
      type:    'prescription',
      subject: `💊 Ordonnance patient ${patientId}`,
      body,
    });
    // Notify patient
    notify({
      to_role: 'patient',
      to_id:   patientId,
      type:    'prescription',
      subject: `✅ Ordonnance envoyée à ${pharmacyName||'la pharmacie'}`,
      body:    `Votre ordonnance du ${rx.date} a été transmise. Vous pouvez aller récupérer vos médicaments.`,
    });
    App.toast('📤 Ordonnance envoyée à la pharmacie');
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
    notify, getUnread, markRead,
    renderInbox, openMsg, openCompose, sendMessage,
    sendPrescriptionToPharmacy,
    smartCheck, renderSmartCheckResult,
    checkStockForMeds,
  };
})();

window.Network = Network;
