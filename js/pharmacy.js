// ========== MedConnect — Pharmacy Portal Module ==========

window.PharmacyModule = (() => {
  let cart = [];

  function getHTML() {
    return `
      <div id="pharm-pos" class="section active">
        <div class="page-header">
          <div>
            <h1>🛒 Point de Vente</h1>
            <p>Vente de médicaments et produits pharmaceutiques</p>
          </div>
        </div>
        <div class="pos-layout">
          <div class="pos-products">
            <div style="display:flex;gap:0.75rem;margin-bottom:1rem;flex-wrap:wrap;">
              <div class="search-bar" style="flex:1;min-width:200px;">
                <input class="form-control" placeholder="Rechercher un produit..." id="pharm-search" oninput="PharmacyModule.filterProducts()">
              </div>
              <select class="form-control" style="width:auto;" id="pharm-cat-filter" onchange="PharmacyModule.filterProducts()">
                <option value="">Toutes catégories</option>
              </select>
            </div>
            <div class="product-grid" id="pharm-product-grid"></div>
          </div>
          <div class="pos-cart glass">
            <div class="cart-header">🛒 Panier</div>
            <div class="cart-items" id="cart-items">
              <div class="empty-state" style="padding:2rem 0;"><div class="empty-icon">🛒</div><p>Panier vide</p></div>
            </div>
            <div class="cart-total" id="cart-total-section" style="display:none;">
              <div class="cart-total-row"><span>Sous-total</span><span id="cart-subtotal">0 FC</span></div>
              <div class="cart-total-row grand"><span>Total</span><span id="cart-total">0 FC</span></div>
              <div class="form-group" style="margin-top:1rem;"><label>Client (optionnel)</label><input class="form-control" id="cart-client" placeholder="Nom du client"></div>
              <button class="btn btn-success" style="width:100%;justify-content:center;margin-top:0.5rem;" onclick="PharmacyModule.completeSale()">✅ Valider la vente</button>
            </div>
          </div>
        </div>
      </div>

      <div id="pharm-rx" class="section">
        <div class="page-header">
          <div>
            <h1>📝 Ordonnances</h1>
            <p>Recherchez et dispensez les ordonnances des patients</p>
          </div>
        </div>
        <div id="pharm-rx-content"></div>
      </div>

      <div id="pharm-inventory" class="section">
        <div class="page-header">
          <div>
            <h1>📦 Inventaire</h1>
            <p>Gestion du stock de médicaments</p>
          </div>
          <button class="btn btn-primary" onclick="PharmacyModule.showProductModal()">➕ Nouveau Produit</button>
        </div>
        <div class="stats-grid" id="pharm-inv-stats"></div>
        <div class="glass section-card">
          <div class="table-container">
            <table>
              <thead><tr><th></th><th>Produit</th><th>Catégorie</th><th>Prix</th><th>Stock</th><th>Expiration</th><th>Actions</th></tr></thead>
              <tbody id="pharm-inventory-list"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div id="pharm-sales" class="section">
        <div class="page-header">
          <div>
            <h1>📊 Historique des Ventes</h1>
            <p>Suivi des transactions</p>
          </div>
        </div>
        <div class="stats-grid" id="pharm-sales-stats"></div>
        <div class="glass section-card">
          <div class="table-container">
            <table>
              <thead><tr><th>Date</th><th>Client</th><th>Articles</th><th>Total</th></tr></thead>
              <tbody id="pharm-sales-list"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div id="pharm-locate" class="section">
        <div class="page-header">
          <div>
            <h1>📍 Localisation</h1>
            <p>Position de votre pharmacie et établissements proches</p>
          </div>
        </div>
        <div class="glass section-card">
          <div style="display:flex;gap:0.75rem;margin-bottom:1rem;">
            <button class="btn btn-primary" onclick="MapModule.searchNearby('pharmacy')">🏪 Pharmacies</button>
            <button class="btn btn-success" onclick="MapModule.searchNearby('hospital')">🏥 Hôpitaux</button>
          </div>
          <div id="map-container"></div>
          <div id="map-results" style="margin-top:1rem;"></div>
        </div>
      </div>
    `;
  }

  function getSidebarNav() {
    return `
      <li><button class="active" onclick="PharmacyModule.showSection('pharm-pos', this)"><span class="nav-icon">🛒</span> Point de Vente</button></li>
      <li><button onclick="PharmacyModule.showSection('pharm-rx', this)"><span class="nav-icon">📝</span> Ordonnances</button></li>
      <li><button onclick="PharmacyModule.showSection('pharm-inventory', this)"><span class="nav-icon">📦</span> Inventaire</button></li>
      <li><button onclick="PharmacyModule.showSection('pharm-sales', this)"><span class="nav-icon">📊</span> Ventes</button></li>
      <li><button onclick="PharmacyModule.showSection('pharm-locate', this)"><span class="nav-icon">📍</span> Localisation</button></li>
    `;
  }

  function showSection(sectionId, btn) {
    document.querySelectorAll('.main-content .section').forEach(s => s.classList.remove('active'));
    document.getElementById(sectionId).classList.add('active');
    document.querySelectorAll('.sidebar-nav button').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    if (sectionId === 'pharm-locate') setTimeout(() => MapModule.initMap(), 100);
  }

  async function init() {
    cart = [];
    await loadProducts();
    await loadInventory();
    await loadSalesHistory();
    loadRxLookup();
  }

  function loadRxLookup() {
    const container = document.getElementById('pharm-rx-content');
    if (container) container.innerHTML = ShareModule.getPharmacistLookupHTML();
  }

  // ===== Products Grid (POS) =====
  let allProducts = [];

  async function loadProducts() {
    allProducts = await MedDB.dbGetAll('products');
    renderProducts(allProducts);
    loadCategories();
  }

  function loadCategories() {
    const cats = [...new Set(allProducts.map(p => p.categorie))];
    const sel = document.getElementById('pharm-cat-filter');
    if (!sel) return;
    sel.innerHTML = '<option value="">Toutes catégories</option>' + cats.map(c => `<option>${c}</option>`).join('');
  }

  function renderProducts(products) {
    const grid = document.getElementById('pharm-product-grid');
    if (!grid) return;
    if (!products.length) {
      grid.innerHTML = '<div class="empty-state glass" style="grid-column:1/-1;padding:2rem;"><div class="empty-icon">📦</div><h3>Aucun produit</h3><p>Ajoutez un produit dans l’inventaire ou vérifiez le chargement des données.</p></div>';
      return;
    }
    grid.innerHTML = products.map(p => `
      <div class="product-card glass" onclick="PharmacyModule.addToCart(${p.id})">
        <div class="product-emoji">${p.emoji || '💊'}</div>
        <div class="product-name">${p.nom}</div>
        <div class="product-price">${formatPrice(p.prix)}</div>
        <div class="product-stock">Stock: ${p.stock}</div>
      </div>
    `).join('');
  }

  function filterProducts() {
    const q = (document.getElementById('pharm-search')?.value || '').toLowerCase();
    const cat = document.getElementById('pharm-cat-filter')?.value || '';
    let filtered = allProducts;
    if (q) filtered = filtered.filter(p => p.nom.toLowerCase().includes(q));
    if (cat) filtered = filtered.filter(p => p.categorie === cat);
    renderProducts(filtered);
  }

  // ===== Cart =====
  async function addToCart(productId) {
    const product = await MedDB.dbGet('products', productId);
    if (!product || product.stock <= 0) {
      App.showToast('Produit en rupture de stock', 'error');
      return;
    }
    const existing = cart.find(i => i.productId === productId);
    if (existing) {
      if (existing.quantite >= product.stock) {
        App.showToast('Stock insuffisant', 'error');
        return;
      }
      existing.quantite++;
    } else {
      cart.push({ productId, nom: product.nom, prixUnitaire: product.prix, quantite: 1 });
    }
    renderCart();
  }

  function removeFromCart(productId) {
    cart = cart.filter(i => i.productId !== productId);
    renderCart();
  }

  function updateQty(productId, delta) {
    const item = cart.find(i => i.productId === productId);
    if (!item) return;
    item.quantite += delta;
    if (item.quantite <= 0) { removeFromCart(productId); return; }
    renderCart();
  }

  function renderCart() {
    const container = document.getElementById('cart-items');
    const totalSection = document.getElementById('cart-total-section');

    if (!cart.length) {
      container.innerHTML = '<div class="empty-state" style="padding:2rem 0;"><div class="empty-icon">🛒</div><p>Panier vide</p></div>';
      totalSection.style.display = 'none';
      return;
    }

    totalSection.style.display = 'block';
    container.innerHTML = cart.map(item => `
      <div class="cart-item">
        <div class="cart-item-info">
          <h4>${item.nom}</h4>
          <p>${formatPrice(item.prixUnitaire)} × ${item.quantite}</p>
        </div>
        <div class="cart-item-actions">
          <button class="qty-btn" onclick="PharmacyModule.updateQty(${item.productId}, -1)">−</button>
          <span style="font-weight:600;min-width:24px;text-align:center;">${item.quantite}</span>
          <button class="qty-btn" onclick="PharmacyModule.updateQty(${item.productId}, 1)">+</button>
          <button class="qty-btn" style="color:var(--danger);border-color:var(--danger);" onclick="PharmacyModule.removeFromCart(${item.productId})">×</button>
        </div>
      </div>
    `).join('');

    const total = cart.reduce((sum, i) => sum + i.prixUnitaire * i.quantite, 0);
    document.getElementById('cart-subtotal').textContent = formatPrice(total);
    document.getElementById('cart-total').textContent = formatPrice(total);
  }

  async function completeSale() {
    if (!cart.length) return;
    const total = cart.reduce((sum, i) => sum + i.prixUnitaire * i.quantite, 0);
    const client = document.getElementById('cart-client')?.value || 'Client anonyme';

    // Save sale
    await MedDB.dbAdd('sales', {
      date: new Date().toISOString(),
      items: cart.map(i => ({ ...i })),
      total,
      client,
    });

    // Update stock
    for (const item of cart) {
      const product = await MedDB.dbGet('products', item.productId);
      if (product) {
        product.stock = Math.max(0, product.stock - item.quantite);
        await MedDB.dbUpdate('products', product);
      }
    }

    cart = [];
    renderCart();
    await loadProducts();
    await loadInventory();
    await loadSalesHistory();
    App.showToast(`Vente de ${formatPrice(total)} enregistrée`, 'success');
  }

  // ===== Inventory =====
  async function loadInventory() {
    const products = await MedDB.dbGetAll('products');
    const totalStock = products.reduce((s, p) => s + p.stock, 0);
    const totalValue = products.reduce((s, p) => s + p.stock * p.prix, 0);
    const lowStock = products.filter(p => p.stock < 30).length;

    const statsEl = document.getElementById('pharm-inv-stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stat-card glass"><div class="stat-icon blue">📦</div><div class="stat-info"><h3>${products.length}</h3><p>Produits</p></div></div>
        <div class="stat-card glass"><div class="stat-icon green">📊</div><div class="stat-info"><h3>${totalStock}</h3><p>Unités en stock</p></div></div>
        <div class="stat-card glass"><div class="stat-icon purple">💰</div><div class="stat-info"><h3>${formatPrice(totalValue)}</h3><p>Valeur du stock</p></div></div>
        <div class="stat-card glass"><div class="stat-icon red">⚠️</div><div class="stat-info"><h3>${lowStock}</h3><p>Stock faible (&lt;30)</p></div></div>
      `;
    }

    const tbody = document.getElementById('pharm-inventory-list');
    if (!tbody) return;
    if (!products.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="empty-icon">📦</div><h3>Aucun produit</h3><p>Ajoutez un produit pour démarrer l’inventaire.</p></td></tr>';
      return;
    }
    tbody.innerHTML = products.map(p => `
      <tr>
        <td style="font-size:1.5rem;text-align:center;">${p.emoji || '💊'}</td>
        <td><strong>${p.nom}</strong></td>
        <td><span class="badge badge-blue">${p.categorie}</span></td>
        <td>${formatPrice(p.prix)}</td>
        <td><span class="badge ${p.stock < 30 ? 'badge-red' : 'badge-green'}">${p.stock}</span></td>
        <td>${p.dateExpiration ? new Date(p.dateExpiration).toLocaleDateString('fr-FR') : '—'}</td>
        <td>
          <button class="btn btn-sm btn-ghost" onclick="PharmacyModule.showProductModal(${p.id})">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="PharmacyModule.deleteProduct(${p.id})">🗑️</button>
        </td>
      </tr>
    `).join('');
  }

  function showProductModal(productId) {
    const modal = document.getElementById('global-modal');
    const modalBody = document.getElementById('modal-body');
    document.getElementById('modal-title').textContent = productId ? 'Modifier le produit' : 'Nouveau produit';

    const loadData = async () => {
      let p = {};
      if (productId) p = await MedDB.dbGet('products', productId) || {};
      modalBody.innerHTML = `
        <form id="product-form">
          <div class="form-group"><label>Nom du produit</label><input class="form-control" id="pr-nom" value="${p.nom || ''}" required></div>
          <div class="form-row">
            <div class="form-group"><label>Catégorie</label>
              <select class="form-control" id="pr-cat">
                ${['Antalgique','Antibiotique','Anti-inflammatoire','Bronchodilatateur','Antidiabétique','Antihypertenseur','Antiulcéreux','Vitamines','Solution','Matériel','Protection','Autre'].map(c => `<option ${p.categorie===c?'selected':''}>${c}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Emoji</label><input class="form-control" id="pr-emoji" value="${p.emoji || '💊'}" maxlength="4"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Prix (FC)</label><input type="number" class="form-control" id="pr-prix" value="${p.prix || ''}" required></div>
            <div class="form-group"><label>Stock</label><input type="number" class="form-control" id="pr-stock" value="${p.stock || 0}" required></div>
          </div>
          <div class="form-group"><label>Date d'expiration</label><input type="date" class="form-control" id="pr-exp" value="${p.dateExpiration || ''}"></div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
            <button type="submit" class="btn btn-primary">💾 Sauvegarder</button>
          </div>
        </form>
      `;
      document.getElementById('product-form').onsubmit = async (e) => {
        e.preventDefault();
        const data = {
          nom: document.getElementById('pr-nom').value,
          categorie: document.getElementById('pr-cat').value,
          emoji: document.getElementById('pr-emoji').value || '💊',
          prix: parseInt(document.getElementById('pr-prix').value),
          stock: parseInt(document.getElementById('pr-stock').value),
          dateExpiration: document.getElementById('pr-exp').value,
        };
        if (productId) { data.id = productId; await MedDB.dbUpdate('products', data); }
        else { await MedDB.dbAdd('products', data); }
        App.closeModal();
        await loadProducts();
        await loadInventory();
        App.showToast('Produit sauvegardé', 'success');
      };
    };
    loadData();
    modal.classList.add('active');
  }

  async function deleteProduct(id) {
    if (!confirm('Supprimer ce produit ?')) return;
    await MedDB.dbDelete('products', id);
    await loadProducts();
    await loadInventory();
    App.showToast('Produit supprimé', 'info');
  }

  // ===== Sales History =====
  async function loadSalesHistory() {
    const sales = await MedDB.dbGetAll('sales');
    const todayStr = new Date().toISOString().split('T')[0];
    const todaySales = sales.filter(s => s.date.startsWith(todayStr));
    const todayTotal = todaySales.reduce((sum, s) => sum + s.total, 0);
    const allTotal = sales.reduce((sum, s) => sum + s.total, 0);

    const statsEl = document.getElementById('pharm-sales-stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stat-card glass"><div class="stat-icon blue">🧾</div><div class="stat-info"><h3>${sales.length}</h3><p>Ventes totales</p></div></div>
        <div class="stat-card glass"><div class="stat-icon green">💰</div><div class="stat-info"><h3>${formatPrice(allTotal)}</h3><p>Chiffre d'affaires total</p></div></div>
        <div class="stat-card glass"><div class="stat-icon purple">📅</div><div class="stat-info"><h3>${todaySales.length}</h3><p>Ventes aujourd'hui</p></div></div>
        <div class="stat-card glass"><div class="stat-icon orange">💵</div><div class="stat-info"><h3>${formatPrice(todayTotal)}</h3><p>CA aujourd'hui</p></div></div>
      `;
    }

    const tbody = document.getElementById('pharm-sales-list');
    if (!tbody) return;
    if (!sales.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:2rem;">Aucune vente</td></tr>';
      return;
    }
    tbody.innerHTML = sales.sort((a, b) => b.date.localeCompare(a.date)).map(s => `
      <tr>
        <td>${new Date(s.date).toLocaleString('fr-FR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</td>
        <td>${s.client || 'Anonyme'}</td>
        <td>${s.items.map(i => `${i.nom} ×${i.quantite}`).join(', ')}</td>
        <td><strong>${formatPrice(s.total)}</strong></td>
      </tr>
    `).join('');
  }

  async function loadPrescriptionIntoCart(code) {
    const rx = ShareModule.findByCode(code);
    if (!rx) {
      App.showToast("Ordonnance non trouvée", "error");
      return;
    }

    const products = await MedDB.dbGetAll('products');
    let matchedCount = 0;

    for (const p of products) {
      const cleanProductName = p.nom.toLowerCase().trim();
      if (rx.traitement.toLowerCase().includes(cleanProductName)) {
        const existing = cart.find(item => item.productId === p.id);
        if (existing) {
          if (existing.quantite < p.stock) {
            existing.quantite++;
            matchedCount++;
          }
        } else if (p.stock > 0) {
          cart.push({ productId: p.id, nom: p.nom, prixUnitaire: p.prix, quantite: 1 });
          matchedCount++;
        }
      }
    }

    if (matchedCount > 0) {
      renderCart();
      App.showToast(`${matchedCount} produit(s) chargé(s) dans le panier`, 'success');
      const posBtn = document.querySelectorAll('.sidebar-nav button')[0];
      showSection('pharm-pos', posBtn);
    } else {
      App.showToast("Aucun produit correspondant trouvé en stock dans l'inventaire", 'warning');
    }
  }

  function formatPrice(amount) {
    return new Intl.NumberFormat('fr-FR').format(amount) + ' FC';
  }

  return { getHTML, getSidebarNav, init, showSection, filterProducts, addToCart, removeFromCart, updateQty, completeSale, showProductModal, deleteProduct, loadRxLookup, loadPrescriptionIntoCart };
})();
