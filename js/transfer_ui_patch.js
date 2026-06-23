/* =====================================================
   MedConnect — Patch UI transfert ciblé
   -----------------------------------------------------
   Ajoute uniquement la section “À qui envoyer ?” dans
   Nouveau message, sans modifier ni supprimer le code
   existant. Ce fichier surcharge Network.openCompose et
   Network.sendMessage quand Network est disponible.
   ===================================================== */
(function () {
  'use strict';

  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeRole(role) {
    if (window.TransferService?.normalizeRole) return window.TransferService.normalizeRole(role);
    const r = String(role || '').trim().toLowerCase();
    return r === 'pharmacy' ? 'pharmacist' : r;
  }

  function patientName(patient) {
    if (!patient) return '';
    return `${patient.firstname || patient.prenom || ''} ${patient.lastname || patient.nom || ''}`.trim() || patient.name || patient.id || '';
  }

  function accountName(account) {
    if (!account) return '';
    return account.pharmacy || account.name || account.fullname || account.username || account.uid || account.matricule || account.order_num || '';
  }

  function localRecipients(role, query) {
    const r = normalizeRole(role);
    const q = String(query || '').trim().toLowerCase();

    if (window.TransferService?.listRecipients) {
      const fromService = window.TransferService.listRecipients(r, q);
      if (Array.isArray(fromService) && fromService.length) return fromService;
    }

    if (r === 'patient') {
      return (window.DB?.getPatients?.() || [])
        .map(patient => ({
          role: 'patient',
          uid: patient.id || patient.uid || patient.patient_id || '',
          name: patientName(patient),
          label: `${patientName(patient)}${patient.id ? ' — ' + patient.id : ''}`,
        }))
        .filter(item => item.uid)
        .filter(item => !q || `${item.uid} ${item.name} ${item.label}`.toLowerCase().includes(q));
    }

    const seen = new Set();
    return [
      ...(window.DB?.getAccounts?.() || []),
      ...(window.DB?.getUsers?.() || []),
    ]
      .filter(account => normalizeRole(account.role) === r)
      .filter(account => ['approved', 'active', undefined, null, ''].includes(account.status))
      .map(account => ({
        role: r,
        uid: account.uid || account.username || account.order_num || account.matricule || '',
        name: accountName(account),
        label: accountName(account),
      }))
      .filter(item => item.uid && !seen.has(item.uid) && seen.add(item.uid))
      .filter(item => !q || `${item.uid} ${item.name} ${item.label}`.toLowerCase().includes(q));
  }

  function refreshComposeRecipients() {
    const roleEl = document.getElementById('msg-role');
    const searchEl = document.getElementById('msg-recipient-search');
    const selectEl = document.getElementById('msg-recipient');
    const helpEl = document.getElementById('msg-recipient-help');
    if (!roleEl || !selectEl) return;

    const role = roleEl.value;
    const query = searchEl?.value || '';
    const recipients = localRecipients(role, query);

    if (!recipients.length) {
      selectEl.innerHTML = `<option value="">Aucun destinataire disponible</option>`;
      if (helpEl) helpEl.textContent = 'Aucun compte validé trouvé pour ce rôle. Essayez une autre recherche ou vérifiez les comptes.';
      return;
    }

    selectEl.innerHTML = `
      <option value="">— Choisir une personne —</option>
      ${recipients.map(item => `
        <option value="${esc(item.uid)}" data-name="${esc(item.name || item.label)}">
          ${esc(item.label || item.name || item.uid)}
        </option>`).join('')}`;

    if (helpEl) {
      helpEl.textContent = `${recipients.length} destinataire(s) disponible(s). Le message sera envoyé uniquement à la personne choisie.`;
    }
  }

  function openCompose() {
    window.App.openModal('✉️ Nouveau message', `
      <form onsubmit="Network.sendMessage(event)">
        <div class="form-group"><label>Destinataire (rôle)</label>
          <select id="msg-role" onchange="Network.refreshComposeRecipients()">
            <option value="patient">🩺 Patient</option>
            <option value="doctor">👨‍⚕️ Médecin</option>
            <option value="pharmacist">💊 Pharmacien</option>
            <option value="nurse">🩹 Infirmier</option>
          </select>
        </div>

        <div class="form-group">
          <label>À qui envoyer ? *</label>
          <input type="search" id="msg-recipient-search" class="inp" placeholder="Rechercher par nom, numéro ou identifiant" oninput="Network.refreshComposeRecipients()">
          <select id="msg-recipient" required style="margin-top:.45rem">
            <option value="">Chargement…</option>
          </select>
          <small id="msg-recipient-help" style="color:var(--text-muted);font-size:.72rem">
            Choisissez une personne précise pour éviter l'envoi à tout un rôle.
          </small>
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

    setTimeout(refreshComposeRecipients, 0);
  }

  function syncTransferToCloud(transfer) {
    try {
      const ready = typeof firebaseReady !== 'undefined' ? firebaseReady : window.firebaseReady;
      const db = typeof firebaseDB !== 'undefined' ? firebaseDB : window.firebaseDB;
      if (!ready || !db || !transfer?.transferId) return;
      db.collection('mc_transfers').doc(String(transfer.transferId)).set(transfer, { merge: true });
      db.collection('transfers').doc(String(transfer.transferId)).set(transfer, { merge: true });
    } catch (_) {}
  }

  function sendMessage(event) {
    event.preventDefault();

    const role = normalizeRole(document.getElementById('msg-role')?.value);
    const recipientEl = document.getElementById('msg-recipient');
    const selected = recipientEl?.selectedOptions?.[0];
    const toUid = recipientEl?.value || '';
    const toName = selected?.dataset?.name || selected?.textContent?.trim() || '';
    const priority = document.getElementById('msg-priority')?.value || 'normal';
    const subject = document.getElementById('msg-subject')?.value || '';
    const body = document.getElementById('msg-body')?.value || '';

    if (!toUid) {
      window.App.toast('Choisissez d’abord la personne à qui envoyer.', 'error');
      return;
    }

    try {
      if (window.TransferService?.transferObject) {
        const transfer = window.TransferService.transferObject({
          objectType: 'message',
          objectId: `MSG-${Date.now()}`,
          objectTitle: subject,
          objectSummary: body.slice(0, 180),
          recipient: { role, uid: toUid, name: toName },
          priority,
          metadata: { source: 'network_compose' },
        });

        syncTransferToCloud(transfer);
        window.TransferService.createNotificationForTransfer(transfer, { subject, body });
      } else {
        window.Network.notify({
          to_role: role,
          to_id: toUid,
          type: 'info',
          priority,
          subject,
          body,
        });
      }

      window.App.closeModal();
      window.App.toast(`✅ Message envoyé à ${toName || 'la personne choisie'}`);
      window.App.navigateTo?.('inbox');
    } catch (error) {
      console.warn('[MedConnect] Envoi ciblé impossible :', error);
      window.App.toast(error?.message || 'Impossible d’envoyer le message.', 'error');
    }
  }

  function applyPatch() {
    if (!window.Network || !window.App || !window.DB) return false;
    window.Network.openCompose = openCompose;
    window.Network.sendMessage = sendMessage;
    window.Network.refreshComposeRecipients = refreshComposeRecipients;
    return true;
  }

  if (!applyPatch()) {
    window.addEventListener('DOMContentLoaded', () => setTimeout(applyPatch, 0));
  }
})();
