(() => {
  const API_BASE = window.SOLEA_API_URL || 'http://localhost:4000';

  function getCart() {
    try { return JSON.parse(localStorage.getItem('solea-cart') || '[]'); }
    catch { return []; }
  }

  function setLoading(form, loading) {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    button.disabled = loading;
    button.textContent = loading ? 'Opening secure checkout…' : 'Pay securely ↗';
  }

  function showError(message) {
    const success = document.getElementById('checkoutSuccess');
    let error = document.getElementById('checkoutError');
    if (!error) {
      error = document.createElement('div');
      error.id = 'checkoutError';
      error.setAttribute('role', 'alert');
      error.style.cssText = 'margin-top:18px;padding:16px;border:1px solid #d7aaa0;background:#f6e7e3;color:#702b20;font-size:13px;line-height:1.5;';
      success?.parentNode?.insertBefore(error, success);
    }
    error.textContent = message;
    if (success) success.classList.remove('show');
  }

  async function verifyReturnedPayment() {
    const reference = new URLSearchParams(location.search).get('reference');
    if (!reference) return;
    try {
      const response = await fetch(`${API_BASE}/api/orders/verify/${encodeURIComponent(reference)}`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok || data.order?.status !== 'paid') throw new Error('Payment could not be confirmed yet.');
      localStorage.removeItem('solea-cart');
      document.getElementById('checkoutSuccess')?.classList.add('show');
      const successText = document.querySelector('#checkoutSuccess p');
      if (successText) successText.textContent = `Payment confirmed. Your order ${data.order.order_number} has been received.`;
      history.replaceState({}, document.title, location.pathname);
    } catch (error) {
      showError(error.message || 'We could not confirm this payment. Please contact support before trying again.');
    }
  }

  function initProductionCheckout() {
    const form = document.getElementById('checkoutForm');
    if (!form) return;

    // Capture phase prevents the prototype submit handler in script.js from firing.
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const formData = new FormData(form);
      const cart = getCart().filter(item => Number.isInteger(Number(item.id)) && Number(item.qty) > 0);
      if (!cart.length) return showError('Your bag is empty. Add a pair before checking out.');

      setLoading(form, true);
      try {
        const response = await fetch(`${API_BASE}/api/orders/initialize-payment`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: String(formData.get('fullName') || '').trim(),
            email: String(formData.get('email') || '').trim(),
            deliveryAddress: String(formData.get('deliveryAddress') || '').trim(),
            items: cart.map(item => ({ legacyId: Number(item.id), quantity: Number(item.qty) }))
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to start payment.');
        window.location.assign(data.payment.authorization_url);
      } catch (error) {
        showError(error.message || 'Payment could not be started. Please try again.');
        setLoading(form, false);
      }
    }, true);

    verifyReturnedPayment();
  }

  document.addEventListener('DOMContentLoaded', initProductionCheckout);
})();
