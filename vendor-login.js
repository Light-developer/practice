(() => {
  const API = window.SOLEA_API_URL || 'http://localhost:4000';
  const form = document.getElementById('vendorLoginForm');
  if (!form) return;

  const button = form.querySelector('button[type="submit"]');
  const email = document.getElementById('vendorEmail');
  const password = document.getElementById('vendorPassword');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Signing in…';

    try {
      const response = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.value.trim(),
          password: password.value
        })
      });

      let data = {};
      try { data = await response.json(); } catch {}

      if (!response.ok) throw new Error(data.error || 'Unable to sign in. Please try again.');
      if (data.user?.role !== 'vendor') {
        await fetch(`${API}/api/auth/logout`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => {});
        throw new Error('This account is not a SOLEA partner account.');
      }

      window.location.replace('vendor-dashboard.html');
    } catch (error) {
      window.alert(error.message);
      button.disabled = false;
      button.textContent = originalText;
    }
  });
})();
