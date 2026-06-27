/* MedConnect — stabilise la page Administration avant le démarrage App.
   Le tableau admin contient des actions et du scroll : il ne doit pas être reconstruit chaque seconde. */
(function () {
  if (window.__mcAdminDashboardStability) return;
  window.__mcAdminDashboardStability = true;

  function isAdminDashboardVisible() {
    try {
      const main = document.getElementById('main-content');
      const user = window.Auth?.getUser?.();
      if (!main || user?.role !== 'admin') return false;
      const heading = main.querySelector('.page-header h2, .page-header h3')?.textContent || '';
      return heading.includes('Administration') || heading.includes('Maintenance compte');
    } catch (_) {
      return false;
    }
  }

  const originalSetInterval = window.setInterval.bind(window);
  window.setInterval = function (callback, delay, ...args) {
    if (delay === 1000 && typeof callback === 'function') {
      return originalSetInterval(function () {
        if (isAdminDashboardVisible()) return;
        return callback.apply(this, arguments);
      }, delay, ...args);
    }
    return originalSetInterval(callback, delay, ...args);
  };
})();
