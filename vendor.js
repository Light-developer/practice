const SOLEA_API = window.SOLEA_API_URL || 'http://localhost:4000';
let currentVendor = null;

async function vendorApi(path, options = {}) {
  const response = await fetch(`${SOLEA_API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data?.error || 'Something went wrong.');
  return data;
}

function showVendorMessage(message) {
  if (typeof toast === 'function') toast(message);
  else window.alert(message);
}

function setButtonLoading(button, loading, label) {
  if (!button) return;
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Please wait…';
  } else {
    button.disabled = false;
    button.textContent = label || button.dataset.originalText || 'Submit';
  }
}

async function initVendorAuth() {
  const registerForm = document.getElementById('vendorRegisterForm');
  const loginForm = document.getElementById('vendorLoginForm');

  registerForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = registerForm.querySelector('button[type="submit"]');
    setButtonLoading(button, true);
    try {
      await vendorApi('/api/vendors/register', {
        method: 'POST',
        body: JSON.stringify({
          brand: document.getElementById('registerBrand').value.trim(),
          email: document.getElementById('registerEmail').value.trim(),
          password: document.getElementById('registerPassword').value,
          country: document.getElementById('registerCountry').value.trim(),
          story: document.getElementById('registerStory').value.trim()
        })
      });
      location.href = 'vendor-dashboard.html';
    } catch (error) {
      showVendorMessage(error.message);
      setButtonLoading(button, false, 'Create partner account ↗');
    }
  });

  loginForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = loginForm.querySelector('button[type="submit"]');
    setButtonLoading(button, true);
    try {
      const data = await vendorApi('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('vendorEmail').value.trim(),
          password: document.getElementById('vendorPassword').value
        })
      });
      if (data.user?.role !== 'vendor') {
        await vendorApi('/api/auth/logout', { method: 'POST' }).catch(() => {});
        throw new Error('This account is not a SOLEA partner account.');
      }
      location.href = 'vendor-dashboard.html';
    } catch (error) {
      showVendorMessage(error.message);
      setButtonLoading(button, false, 'Enter dashboard ↗');
    }
  });
}

function formatMoney(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value || 0) / 100);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function renderVendorDashboard(data) {
  const { vendor, metrics, products, orders } = data;
  currentVendor = vendor;
  const brand = vendor.brand_name || 'Your House';
  const first = brand.split(/\s+/)[0];

  document.getElementById('dashboardBrand')?.replaceChildren(document.createTextNode(brand));
  document.getElementById('settingsBrand')?.replaceChildren(document.createTextNode(brand));
  document.getElementById('settingsEmail')?.replaceChildren(document.createTextNode(vendor.email || ''));
  document.getElementById('settingsStatus')?.replaceChildren(document.createTextNode(vendor.status || 'pending'));

  const greeting = document.getElementById('dashboardGreeting');
  if (greeting) greeting.innerHTML = `Welcome, <em>${escapeHtml(first)}.</em>`;

  document.getElementById('metricSales')?.replaceChildren(document.createTextNode(formatMoney(metrics.gross_sales, 'USD')));
  document.getElementById('metricOrders')?.replaceChildren(document.createTextNode(String(metrics.orders || 0)));
  document.getElementById('metricUnits')?.replaceChildren(document.createTextNode(String(metrics.units_sold || 0)));
  document.getElementById('metricStock')?.replaceChildren(document.createTextNode(String(metrics.available_stock || 0)));

  const productBody = document.getElementById('vendorProductsBody');
  if (productBody) {
    productBody.innerHTML = products.length ? products.map(product => `
      <tr>
        <td><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.brand)}</small></td>
        <td>${escapeHtml(product.category)}</td>
        <td>${formatMoney(product.price_kobo, product.currency || 'USD')}</td>
        <td>${product.stock}</td>
        <td><span class="status ${product.active ? 'live' : 'draft'}">${product.active ? 'Live' : 'Pending'}</span></td>
      </tr>`).join('') : '<tr><td colspan="5">Your catalogue is empty. Add your first product.</td></tr>';
  }

  const orderList = document.getElementById('vendorOrdersList');
  if (orderList) {
    orderList.innerHTML = orders.length ? orders.map(order => {
      const itemText = (order.items || []).map(item => `${escapeHtml(item.name)} × ${item.quantity}`).join(', ');
      return `<div><span>#${escapeHtml(order.order_number)}</span><strong>${itemText}</strong><small>${escapeHtml(order.status)}</small><b>${formatMoney(order.vendor_total, 'USD')}</b></div>`;
    }).join('') : '<div><span>No orders yet</span><strong>Your first marketplace order will appear here.</strong><small>Waiting for sales</small><b>—</b></div>';
  }

  const meta = document.getElementById('ordersMeta');
  if (meta) meta.textContent = `${orders.length} recent order${orders.length === 1 ? '' : 's'}`;

  const pending = document.getElementById('vendorApprovalNotice');
  if (pending) {
    pending.hidden = vendor.status === 'approved';
    if (vendor.status !== 'approved') pending.textContent = 'Your partner application is pending review. Products you add will remain unpublished until SOLEA approves your house.';
  }
}

async function addProduct() {
  const name = window.prompt('Product name');
  if (!name) return;
  const category = window.prompt('Category (e.g. Sneakers, Loafers, Boots)');
  if (!category) return;
  const price = window.prompt('Price in USD');
  if (!price) return;
  const stock = window.prompt('Stock quantity', '10');
  if (stock === null) return;
  const imageUrl = window.prompt('Product image URL');
  if (!imageUrl) return;

  try {
    await vendorApi('/api/vendors/products', {
      method: 'POST',
      body: JSON.stringify({ name, category, price, stock, imageUrl, brand: currentVendor?.brand_name || '' })
    });
    showVendorMessage('Product saved successfully.');
    await loadVendorDashboard();
  } catch (error) {
    showVendorMessage(error.message);
  }
}

async function loadVendorDashboard() {
  try {
    const data = await vendorApi('/api/vendors/dashboard');
    renderVendorDashboard(data);
  } catch (error) {
    location.href = 'vendor-login.html';
  }
}

async function initVendorDashboard() {
  if (!document.getElementById('vendorProductsBody')) return;
  await loadVendorDashboard();

  document.getElementById('vendorLogout')?.addEventListener('click', async () => {
    try { await vendorApi('/api/auth/logout', { method: 'POST' }); } finally { location.href = 'vendor-login.html'; }
  });

  document.getElementById('addProductDemo')?.addEventListener('click', addProduct);
}

document.addEventListener('DOMContentLoaded', () => {
  initVendorAuth();
  initVendorDashboard();
});
