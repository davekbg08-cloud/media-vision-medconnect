/* =====================================================
   MedConnect 2.0 — HospitalMessagesModule
   Messagerie interne à l'établissement (desktop hôpital).

   Retour utilisateur : le shell desktop hôpital n'avait AUCUNE
   messagerie (contrairement au mobile, js/inbox_message_controls.js +
   js/transfer_ui_patch.js) — module natif ajouté ici, rendu dans
   #hospital-content comme tous les autres modules HospitalXModule.

   Réutilise Network.notify()/DB.getMessages() (mêmes collections,
   mêmes règles Firestore que la messagerie mobile) — pas de système
   parallèle. Destinataires limités au personnel AFFILIÉ à
   l'établissement actif (HospitalsRegistry.getCurrentHospital().staff) :
   messagerie interne, pas un annuaire de toute la plateforme.

   Pièce jointe : référence vers une fiche patient ou une ordonnance
   DÉJÀ existante (numéro MC / identifiant local), jamais un fichier
   uploadé — Firebase Storage n'est pas activé sur ce projet et
   nécessiterait le plan Blaze. Le destinataire ne voit le contenu
   référencé que s'il a lui-même le droit de le lire (règles Firestore
   mc_patients/mc_prescriptions inchangées) : la pièce jointe n'élargit
   aucun accès, elle facilite juste la navigation vers un document déjà
   consultable.
   ===================================================== */
const HospitalMessagesModule = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const ROLE_LABELS = {
    doctor: 'Médecin', nurse: 'Infirmier(e)', pharmacist: 'Pharmacie',
    lab: 'Laboratoire', reception: 'Réception', admin_hospital: 'Administration',
  };

  function _currentUser() {
    return window.Auth?.getUser?.() || null;
  }

  function _recipientKeys(user) {
    return [user?.uid, user?.patient_id, user?.username, user?.order_num, user?.matricule]
      .filter(Boolean).map(String);
  }

  function _messageMatchesUser(message, user) {
    if (!user || message.to_role !== user.role) return false;
    if (!message.to_id) return true;
    return _recipientKeys(user).includes(String(message.to_id));
  }

  function _isDeletedForUser(message, user) {
    const keys = _recipientKeys(user);
    const deletedFor = Array.isArray(message.deletedFor) ? message.deletedFor.map(String) : [];
    return keys.some(key => deletedFor.includes(key));
  }

  function _isUnread(message) {
    return message.readStatus !== 'read' && !message.read;
  }

  function _typeIcon(type) {
    const icons = { prescription: '💊', appointment: '📅', stock: '📦', alert: '⚠️', info: 'ℹ️' };
    return icons[type] || '📩';
  }

  async function render(container) {
    HospitalPermissions.requireRoute('messages');
    const user = _currentUser();
    const messages = (window.DB?.getMessages?.() || [])
      .filter(m => _messageMatchesUser(m, user))
      .filter(m => !_isDeletedForUser(m, user))
      .sort((a, b) => {
        const unreadA = _isUnread(a) ? 1 : 0;
        const unreadB = _isUnread(b) ? 1 : 0;
        if (unreadA !== unreadB) return unreadB - unreadA;
        const urgentA = a.priority === 'urgent' ? 1 : 0;
        const urgentB = b.priority === 'urgent' ? 1 : 0;
        if (urgentA !== urgentB) return urgentB - urgentA;
        return (b.createdAt || b.date || '').localeCompare(a.createdAt || a.date || '');
      });

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>Messagerie</h1><p>Messages entre professionnels de l'établissement</p></div>
        <button type="button" class="btn btn-primary btn-sm" onclick="HospitalMessagesModule.openNew(event)">✉️ Nouveau message</button>
      </div>
      ${!messages.length ? `<div class="card empty-state"><p>Aucun message.</p></div>` : `
      <div class="records-list">
        ${messages.map(m => _messageCard(m)).join('')}
      </div>`}
    `;
  }

  function _messageCard(m) {
    const unread = _isUnread(m);
    const preview = esc(m.body || '').slice(0, 100) + ((m.body || '').length > 100 ? '…' : '');
    return `
      <div class="card record-card ${unread ? 'unread-msg' : ''}"
           style="${unread ? 'border-color:rgba(14,165,233,.55);box-shadow:0 0 0 1px rgba(14,165,233,.16)' : ''};cursor:pointer"
           onclick="HospitalMessagesModule.openMessage('${esc(m.mid)}')">
        <p>
          <span>${_typeIcon(m.type)}</span>
          ${m.priority === 'urgent' ? ' 🔴 Urgent' : ''}
          ${unread ? ' · <strong>Non lu</strong>' : ' · Lu'}
          — <strong>${esc(m.subject || '(sans objet)')}</strong>
        </p>
        <p class="muted">De : ${esc(m.from || '—')} · ${esc(String(m.date || '').slice(0,10))}${m.attachedRecordLabel ? ' · 📎 ' + esc(m.attachedRecordLabel) : ''}</p>
        <p style="font-size:.83rem">${preview}</p>
      </div>`;
  }

  function openMessage(mid) {
    const messages = window.DB?.getMessages?.() || [];
    const msg = messages.find(m => m.mid === mid);
    if (!msg) return false;

    markRead(mid);
    const refreshed = (window.DB?.getMessages?.() || []).find(m => m.mid === mid) || msg;

    const attachmentBlock = refreshed.attachedRecordType ? `
      <div class="card" style="margin-top:.75rem">
        <p>📎 Pièce jointe : <strong>${esc(refreshed.attachedRecordLabel || refreshed.attachedRecordId || '')}</strong></p>
        <button type="button" class="btn btn-ghost btn-sm" onclick="HospitalMessagesModule.openAttachment('${esc(refreshed.attachedRecordType)}','${esc(refreshed.attachedRecordId)}')">Voir</button>
      </div>` : '';

    return App.openModal(`${_typeIcon(refreshed.type)} ${esc(refreshed.subject || '(sans objet)')}`, `
      <p class="muted">De : <strong>${esc(refreshed.from || '—')}</strong> · ${esc(String(refreshed.date || '').slice(0,10))}</p>
      <p style="white-space:pre-wrap">${esc(refreshed.body || '')}</p>
      ${attachmentBlock}
      <div style="display:flex;gap:.5rem;margin-top:1rem">
        <button type="button" class="btn btn-ghost btn-sm" onclick="App.closeModal()">Fermer</button>
        <button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="HospitalMessagesModule.deleteMessage('${esc(refreshed.mid)}')">🗑️ Supprimer</button>
      </div>
    `);
  }

  function markRead(mid) {
    if (window.Network?.markRead) { window.Network.markRead(mid); return; }
    const messages = window.DB?.getMessages?.() || [];
    const msg = messages.find(m => m.mid === mid);
    if (!msg) return;
    msg.read = true; msg.readStatus = 'read'; msg.readAt = new Date().toISOString();
    window.DB?.saveMessages?.(messages);
  }

  function deleteMessage(mid) {
    const user = _currentUser();
    if (!user) return false;
    if (!window.confirm('Supprimer ce message de votre boîte de réception ?')) return false;

    const messages = window.DB?.getMessages?.() || [];
    const msg = messages.find(m => m.mid === mid);
    if (!msg) return false;

    const deletedFor = new Set(Array.isArray(msg.deletedFor) ? msg.deletedFor.map(String) : []);
    _recipientKeys(user).forEach(key => deletedFor.add(key));
    msg.deletedFor = Array.from(deletedFor);
    msg.deletedAt = new Date().toISOString();
    msg.deletedByUid = user.uid || user.username || '';

    window.DB?.saveMessages?.(messages);
    App.closeModal?.();
    App.toast?.('🗑️ Message supprimé');
    HospitalDesktopUI.navigate('messages');
    return true;
  }

  /* ── Pièce jointe : ouvre un aperçu en lecture seule depuis le cache
     local déjà synchronisé (jamais un nouvel appel Firestore élargi —
     si le document n'est pas dans le cache du destinataire, c'est qu'il
     n'y a pas accès, comme pour tout le reste de l'app). ── */
  function openAttachment(type, id) {
    if (type === 'patient') {
      const p = (window.DB?.getPatients?.() || []).find(x => x.id === id);
      if (!p) { App.toast?.('Fiche patient introuvable ou non accessible.', 'error'); return false; }
      return App.openModal('🪪 Fiche patient', `
        <p><strong>${esc(`${p.firstname || ''} ${p.lastname || ''}`.trim() || p.id)}</strong></p>
        <p class="muted">${esc(p.id)}</p>
        ${p.phone ? `<p>📞 ${esc(p.phone)}</p>` : ''}
        ${p.birthdate ? `<p>🎂 ${esc(p.birthdate)}</p>` : ''}
      `);
    }
    if (type === 'prescription') {
      const rx = (window.DB?.getPrescriptions?.() || []).find(x => x.pid === id);
      if (!rx) { App.toast?.('Ordonnance introuvable ou non accessible.', 'error'); return false; }
      return App.openModal('💊 Ordonnance', `
        <p class="muted">${esc(String(rx.date || '').slice(0,10))} — ${esc(rx.patient_id || '')}</p>
        <ul>${(rx.medicines || []).map(m => `<li>${esc(m.name || m.nom || '')} ${esc(m.dosage || '')}</li>`).join('') || '<li>—</li>'}</ul>
      `);
    }
    return false;
  }

  /* ── Nouveau message ────────────────────────────── */

  function _staffRecipients() {
    const hospital = window.HospitalsRegistry?.getCurrentHospital?.();
    const currentUid = _currentUser()?.uid || window.HospitalAuth?.getSession?.()?.agentUid || '';
    return (hospital?.staff || [])
      .filter(s => (s.status === 'active' || s.status === 'approved') && s.uid !== currentUid);
  }

  function openNew(event) {
    event?.preventDefault?.();
    const recipients = _staffRecipients();
    return App.openModal('✉️ Nouveau message', `
      <div class="form-group"><label>Destinataire *</label>
        <select id="hm-to">
          <option value="">— Choisir une personne —</option>
          ${recipients.map(s => `<option value="${esc(s.uid)}" data-role="${esc(s.role)}" data-name="${esc(s.name || s.uid)}">
            ${esc(s.name || s.uid)} (${esc(ROLE_LABELS[s.role] || s.role)})
          </option>`).join('')}
        </select>
        ${!recipients.length ? '<p class="muted">Aucun autre membre affilié trouvé dans cet établissement.</p>' : ''}
      </div>
      <div class="form-group"><label>Priorité</label>
        <select id="hm-priority">
          <option value="normal">Normale</option>
          <option value="urgent">🔴 Urgente</option>
        </select>
      </div>
      <div class="form-group"><label>Sujet *</label><input id="hm-subject" required></div>
      <div class="form-group"><label>Message *</label><textarea id="hm-body" rows="4" required></textarea></div>
      <div class="form-group"><label>Pièce jointe</label>
        <select id="hm-attach-type" onchange="HospitalMessagesModule._onAttachTypeChange()">
          <option value="">Aucune</option>
          <option value="patient">Fiche patient</option>
          <option value="prescription">Ordonnance</option>
        </select>
      </div>
      <div class="form-group" id="hm-attach-mc-wrap" style="display:none">
        <label>Numéro MC du patient</label>
        <input id="hm-attach-mc" placeholder="MC-2026-CD-XXXXXXXX" oninput="HospitalMessagesModule._searchAttachmentPatient()">
        <p class="muted" id="hm-attach-status" style="min-height:1.2em"></p>
      </div>
      <div class="form-group" id="hm-attach-rx-wrap" style="display:none">
        <label>Ordonnance</label>
        <select id="hm-attach-rx"><option value="">—</option></select>
      </div>
      <div style="display:flex;gap:.5rem">
        <button type="button" class="btn btn-ghost btn-full" onclick="App.closeModal()">Annuler</button>
        <button type="button" class="btn btn-primary btn-full" id="hm-send-btn" onclick="HospitalMessagesModule.send()">📤 Envoyer</button>
      </div>
    `);
  }

  function _onAttachTypeChange() {
    const type = document.getElementById('hm-attach-type')?.value;
    const mcWrap = document.getElementById('hm-attach-mc-wrap');
    const rxWrap = document.getElementById('hm-attach-rx-wrap');
    if (mcWrap) mcWrap.style.display = type ? 'block' : 'none';
    if (rxWrap) rxWrap.style.display = type === 'prescription' ? 'block' : 'none';
  }

  function _searchAttachmentPatient() {
    const mc = document.getElementById('hm-attach-mc')?.value.trim().toUpperCase();
    const statusEl = document.getElementById('hm-attach-status');
    const rxSelect = document.getElementById('hm-attach-rx');
    if (!statusEl) return;
    if (!mc) { statusEl.textContent = ''; if (rxSelect) rxSelect.innerHTML = '<option value="">—</option>'; return; }

    const patient = (window.DB?.getPatients?.() || []).find(p => String(p.id || '').toUpperCase() === mc);
    if (!patient) {
      statusEl.textContent = '⚠️ Patient introuvable dans le cache local.';
      if (rxSelect) rxSelect.innerHTML = '<option value="">—</option>';
      return;
    }
    statusEl.textContent = `✅ ${(`${patient.firstname || ''} ${patient.lastname || ''}`.trim()) || patient.id}`;

    if (rxSelect) {
      const rxList = (window.DB?.getPrescriptions?.() || []).filter(rx => rx.patient_id === patient.id);
      rxSelect.innerHTML = rxList.length
        ? rxList.map(rx => `<option value="${esc(rx.pid)}">${esc(String(rx.date || '').slice(0,10))} — ${esc((rx.medicines || [])[0]?.name || (rx.medicines||[])[0]?.nom || 'Ordonnance')}</option>`).join('')
        : '<option value="">Aucune ordonnance trouvée pour ce patient</option>';
    }
  }

  let _sending = false;
  async function send() {
    if (_sending) return false;
    const btn = document.getElementById('hm-send-btn');
    const toSelect = document.getElementById('hm-to');
    const selected = toSelect?.selectedOptions?.[0];
    const toUid = toSelect?.value || '';
    const toRole = selected?.dataset?.role || '';
    const toName = selected?.dataset?.name || '';
    const priority = document.getElementById('hm-priority')?.value || 'normal';
    const subject = document.getElementById('hm-subject')?.value.trim() || '';
    const body = document.getElementById('hm-body')?.value.trim() || '';

    if (!toUid) { App.toast?.('Choisissez un destinataire.', 'error'); return false; }
    if (!subject || !body) { App.toast?.('Sujet et message requis.', 'error'); return false; }

    const attachType = document.getElementById('hm-attach-type')?.value || null;
    let attachedRecordId = null;
    let attachedRecordLabel = null;
    if (attachType === 'patient') {
      const mc = document.getElementById('hm-attach-mc')?.value.trim().toUpperCase();
      const patient = mc ? (window.DB?.getPatients?.() || []).find(p => String(p.id || '').toUpperCase() === mc) : null;
      if (!patient) { App.toast?.('Sélectionnez un patient valide pour la pièce jointe.', 'error'); return false; }
      attachedRecordId = patient.id;
      attachedRecordLabel = `${(`${patient.firstname || ''} ${patient.lastname || ''}`.trim()) || patient.id} (${patient.id})`;
    } else if (attachType === 'prescription') {
      const rxSelect = document.getElementById('hm-attach-rx');
      attachedRecordId = rxSelect?.value || '';
      if (!attachedRecordId) { App.toast?.('Sélectionnez une ordonnance pour la pièce jointe.', 'error'); return false; }
      const rx = (window.DB?.getPrescriptions?.() || []).find(x => x.pid === attachedRecordId);
      attachedRecordLabel = `Ordonnance du ${String(rx?.date || '').slice(0,10)}`;
    }

    _sending = true;
    if (btn) { btn.disabled = true; if (btn.dataset) btn.dataset.processing = 'true'; btn.textContent = '⏳ Envoi en cours…'; }
    try {
      const hospitalId = await window.CloudDB?.getActiveHospitalId?.();
      try {
        await window.CloudDB?.requireWritableSubscription?.(
          priority === 'urgent' ? 'send_message_urgent' : 'send_message_professional'
        );
      } catch (err) {
        App.toast?.(err.message || 'Abonnement expiré — action bloquée.', 'error');
        return false;
      }

      window.Network?.notify?.({
        to_role: toRole, to_id: toUid, type: 'info', priority, subject, body, hospitalId,
        attachedRecordType: attachType || null, attachedRecordId, attachedRecordLabel,
      });

      App.closeModal?.();
      App.toast?.(`✅ Message envoyé à ${toName || 'la personne choisie'}`);
      HospitalDesktopUI.navigate('messages');
      return true;
    } catch (e) {
      console.error('[HospitalMessages] send :', e);
      App.toast?.(e.message || "Impossible d'envoyer le message.", 'error');
      return false;
    } finally {
      _sending = false;
      if (btn) { btn.disabled = false; if (btn.dataset) delete btn.dataset.processing; btn.textContent = '📤 Envoyer'; }
    }
  }

  return {
    render, openNew, send, openMessage, openAttachment, markRead, deleteMessage,
    _onAttachTypeChange, _searchAttachmentPatient,
  };
})();

window.HospitalMessagesModule = HospitalMessagesModule;
