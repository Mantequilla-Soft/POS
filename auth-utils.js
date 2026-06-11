// Shared auth utilities — included on every authenticated page.
// Provides: initAuthCheck(), authFetch(), showSessionExpiredModal()
(function () {

  function getToken() {
    return localStorage.getItem('pos_admin_token') || localStorage.getItem('pos_cashier_token') || '';
  }

  function setToken(newToken) {
    // Update whichever key is currently in use
    if (localStorage.getItem('pos_admin_token')) {
      localStorage.setItem('pos_admin_token', newToken);
    } else {
      localStorage.setItem('pos_cashier_token', newToken);
    }
  }

  function getApiBase() {
    return (localStorage.getItem('pos_api_base') || window.location.origin).replace(/\/$/, '');
  }

  function decodeTokenExp(token) {
    try {
      const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(b64)).exp || null; // seconds
    } catch { return null; }
  }

  async function tryRefreshToken() {
    const token = getToken();
    if (!token) return false;
    try {
      const res = await fetch(`${getApiBase()}/api/auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return false;
      const data = await res.json();
      setToken(data.token);
      return true;
    } catch { return false; }
  }

  function showSessionExpiredModal() {
    if (document.getElementById('_authExpiredOverlay')) return;
    const tFn = (typeof t === 'function') ? t : (k) => k;
    const overlay = document.createElement('div');
    overlay.id = '_authExpiredOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem';
    overlay.innerHTML = `
      <div style="background:var(--surface,#fff);border-radius:12px;padding:1.75rem 1.5rem;max-width:320px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.25)">
        <div style="font-size:2.5rem;margin-bottom:.75rem">🔒</div>
        <div style="font-weight:700;font-size:1rem;color:var(--text,#222);margin-bottom:.4rem">
          ${tFn('auth.sessionExpired')}
        </div>
        <button onclick="window.location.href='login.html'"
          style="margin-top:1rem;width:100%;padding:.75rem;background:#b45309;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:700;cursor:pointer;font-family:inherit">
          ${tFn('auth.loginAgain')}
        </button>
      </div>`;
    document.body.appendChild(overlay);
  }

  // Wraps fetch: on 401, silently refreshes and retries once.
  // Falls back to showing the session-expired modal if refresh fails.
  async function authFetch(url, options = {}) {
    const res = await fetch(url, options);
    if (res.status !== 401) return res;

    const refreshed = await tryRefreshToken();
    if (!refreshed) { showSessionExpiredModal(); return res; }

    const newToken = getToken();
    return fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${newToken}` },
    });
  }

  // Call once on page load. Proactively refreshes if token is expired or
  // expiring within 30 minutes. Schedules an ongoing 10-minute check.
  async function initAuthCheck() {
    const token = getToken();
    if (!token) return;

    const exp = decodeTokenExp(token);
    if (!exp) return;

    const secsLeft = exp - Math.floor(Date.now() / 1000);

    if (secsLeft < 0) {
      // Already expired — refresh immediately
      const ok = await tryRefreshToken();
      if (!ok) { showSessionExpiredModal(); return; }
    } else if (secsLeft < 1800) {
      // Expiring in < 30 min — refresh proactively
      tryRefreshToken();
    }

    // Keep refreshing proactively every 10 minutes for long sessions
    setInterval(async () => {
      const tok = getToken();
      if (!tok) return;
      const exp2 = decodeTokenExp(tok);
      if (!exp2) return;
      if (exp2 - Math.floor(Date.now() / 1000) < 1800) {
        const ok = await tryRefreshToken();
        if (!ok) showSessionExpiredModal();
      }
    }, 10 * 60 * 1000);
  }

  window.authFetch               = authFetch;
  window.initAuthCheck           = initAuthCheck;
  window.showSessionExpiredModal = showSessionExpiredModal;
  window.getAuthToken            = getToken;

  // Auto-run on every page that includes this script
  document.addEventListener('DOMContentLoaded', initAuthCheck);

}());
