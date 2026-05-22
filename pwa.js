// Auto-clear a stale localhost API base when running on a real domain
(function () {
  const stored = localStorage.getItem('pos_api_base');
  const onRealDomain = !['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (stored && onRealDomain && /localhost|127\.0\.0\.1/.test(stored)) {
    localStorage.removeItem('pos_api_base');
  }
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
