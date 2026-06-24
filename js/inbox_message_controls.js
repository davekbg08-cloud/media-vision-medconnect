/* =====================================================
   MedConnect — Messagerie : lecture et suppression
   -----------------------------------------------------
   Ajoute l'affichage Non lu/Lu et la suppression locale
   par utilisateur dans la boîte de réception.
   ===================================================== */
(function () {
  'use strict';

  if (window.MedConnectInboxControls?.installed) return;

  let patched = false;

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function typeIcon(type) {
    const icons = { prescription: '💊', appointment: '📅', stock: '📦', alert: '⚠️', info: 'ℹ️' };
    return icons[type] || '📩';
  }

  function recipientKeys(user) {
    return [user?.uid, user?.patient_id, user?.username, user?.order_num, user?.matricule]
      .filter(Boolean)
      .map(String);
  }

  function messageMatchesUser(message, user) {
    if (!user || message.to_role !== user.role) return false;
    if (!message.to_id) return true;
    return recipientKeys(user).includes(String(message.to_id));
  }

  function isDeletedForUser(message, user) {
    const keys = recipientKeys(user);
    const deletedFor = Array.isArray(message.deletedFor) ? message.deletedFor.map(String) : [];
    return keys.some(key => deletedFor.includes(key));
  }

  function isUnread(message) {
    return message.readStatus !== 'read' && !message.read;
  }

  function markRead(mid) {
    if (window.Network?.markRead) {
      window.Network.markRead(mid);
      return;
    }
    const messages = DB.getMessages();
    const msg = messages.find(m => m.mid === mid);
    if (!msg) return;
    msg.read = true;
    msg.readStatus = 'read';
    msg.readAt = new Date().toISOString();
    DB.saveMessages(messages);
  }

  function deleteMessage(mid) {
    const user = Auth.getUser();
    if (!user) return;
    if (!confirm('Supprimer ce message de votre boîte de réception ?')) return;

    const messages = DB.getMessages();
    const msg = messages.find(m => m.mid === mid);
    if (!msg) return;

    const deletedFor = new Set(Array.isArray(msg.deletedFor) ? msg.deletedFor.map(String) : []);
    recipientKeys(user).forEach(key => deletedFor.add(String(key)));
    msg.deletedFor = Array.from(deletedFor);
    msg.deletedAt = new Date().toISOString();
    msg.deletedByUid = user.uid || user.username || user.patient_id || '';

    DB.saveMessages(messages);
    App.closeModal?.();
    App.toast?.('🗑️ Message supprimé');
    App.navigateTo?.('inbox');
  }

  function renderInbox(main) {
    const user = Auth.getUser();
    const messages = DB.getMessages()
      .filter(m => messageMatchesUser(m, user))
      .filter(m => !isDeletedForUser(m, user))
      .sort((a, b) => {
        const unreadA = isUnread(a) ? 1 : 0;
        const unreadB = isUnread(b) ? 1 : 0;
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
      ${!messages.length ? `<div class="card empty-state"><p>Aucun message</p></div>` : ''}
      <div class="records-list">
        ${messages.map(message => {
          const unread = isUnread(message);
          const preview = esc(message.body).slice(0, 100) + ((message.body || '').length > 100 ? '…' : '');
          return `
            <div class="record-card ${unread ? 'unread-msg' : ''}"
                 style="${unread ? 'border-color:rgba(14,165,233,.55);box-shadow:0 0 0 1px rgba(14,165,233,.16)' : ''}"
                 onclick="Network.openMsg('${esc(message.mid)}')">
              <div class="record-header">
                <span>${typeIcon(message.type)}</span>
                ${message.priority === 'urgent' ? `<span class="chip" style="color:var(--danger);border-color:var(--danger)">🔴 Urgent</span>` : ''}
                ${unread ? `<span class="chip" style="color:var(--accent);border-color:var(--accent)">● Non lu</span>` : `<span class="chip">Lu</span>`}
                <strong>${esc(message.subject)}</strong>
                <span class="record-date">📅 ${esc(message.date)}</span>
              </div>
              <p style="font-size:.84rem;color:var(--text-muted)">De : ${esc(message.from)}</p>
              <p style="font-size:.83rem">${preview}</p>
              <div style="display:flex;justify-content:flex-end;margin-top:.55rem">
                <button class="btn btn-ghost btn-xs" style="color:var(--danger)"
                  onclick="event.stopPropagation();Network.deleteMessage('${esc(message.mid)}')">🗑️ Supprimer</button>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  function openMsg(mid) {
    const msg = DB.getMessages().find(m => m.mid === mid);
    if (!msg) return;

    markRead(mid);
    const refreshed = DB.getMessages().find(m => m.mid === mid) || msg;
    const readAt = refreshed.readAt ? `<br>Statut : Lu le ${new Date(refreshed.readAt).toLocaleString()}` : '<br>Statut : Lu';

    App.openModal(`${typeIcon(refreshed.type)} ${esc(refreshed.subject)}`, `
      <p style="font-size:.84rem;color:var(--text-muted)">
        De : <strong>${esc(refreshed.from)}</strong> · 📅 ${esc(refreshed.date)}${readAt}
      </p>
      <hr style="border-color:var(--border);margin:1rem 0">
      <p style="font-size:.9rem;line-height:1.7">${esc(refreshed.body).replace(/\n/g, '<br>')}</p>
      <div class="form-actions" style="margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="Network.markUnread('${esc(refreshed.mid)}');App.closeModal();App.navigateTo('inbox')">Marquer non lu</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="Network.deleteMessage('${esc(refreshed.mid)}')">🗑️ Supprimer</button>
      </div>`);
  }

  function patchNetwork() {
    if (!window.Network || patched) return;
    Network.renderInbox = renderInbox;
    Network.openMsg = openMsg;
    Network.deleteMessage = deleteMessage;
    patched = true;
  }

  patchNetwork();
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    patchNetwork();
    if (attempts > 80 || patched) clearInterval(timer);
  }, 150);

  window.MedConnectInboxControls = Object.freeze({
    installed: true,
    deleteMessage,
  });
})();
