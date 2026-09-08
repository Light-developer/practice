const products = [
  {
    id: 1,
    name: 'Arc Watch',
    price: 129,
    category: 'accessories',
    image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=700&q=80'
  },
  {
    id: 2,
    name: 'Canvas Tote',
    price: 48,
    category: 'accessories',
    image: 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=700&q=80'
  },
  {
    id: 3,
    name: 'Ceramic Set',
    price: 64,
    category: 'home',
    image: 'https://images.unsplash.com/photo-1493106819501-66d381c466f1?auto=format&fit=crop&w=700&q=80'
  },
  {
    id: 4,
    name: 'Daily Lamp',
    price: 89,
    category: 'home',
    image: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=700&q=80'
  },
  {
    id: 5,
    name: 'Field Bottle',
    price: 35,
    category: 'accessories',
    image: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=700&q=80'
  },
  {
    id: 6,
    name: 'Soft Throw',
    price: 72,
    category: 'home',
    image: 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?auto=format&fit=crop&w=700&q=80'
  },
  {
    id: 7,
    name: 'Desk Tray',
    price: 42,
    category: 'home',
    image: 'https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=700&q=80'
  },
  {
    id: 8,
    name: 'Leather Wallet',
    price: 58,
    category: 'accessories',
    image: 'https://images.unsplash.com/photo-1627123424574-724758594e93?auto=format&fit=crop&w=700&q=80'
  }
];

let cart = JSON.parse(localStorage.getItem('nova-cart') || '[]');

const money = (amount) => `$${amount.toFixed(2)}`;

function renderProducts(filter = 'all') {
  const productContainer = document.getElementById('products');
  const filteredProducts = products.filter(
    (product) => filter === 'all' || product.category === filter
  );

  productContainer.innerHTML = filteredProducts
    .map(
      (product) => `
        <article class="product-card group overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
          <div class="relative overflow-hidden bg-stone-100">
            <img
              src="${product.image}"
              alt="${product.name}"
              class="product-image h-72 w-full object-cover"
              loading="lazy"
            >
            <span class="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-[11px] font-black uppercase tracking-wider backdrop-blur">
              NOVA
            </span>
            <button
              onclick="addToCart(${product.id})"
              class="absolute bottom-3 right-3 translate-y-1 rounded-full bg-stone-900 px-4 py-2.5 text-sm font-bold text-white opacity-0 shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100 hover:bg-orange-500"
            >
              + Add
            </button>
          </div>
          <div class="p-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h3 class="font-black">${product.name}</h3>
                <p class="mt-1 text-xs capitalize text-stone-500">${product.category}</p>
              </div>
              <span class="font-bold">${money(product.price)}</span>
            </div>
          </div>
        </article>
      `
    )
    .join('');
}

function addToCart(id) {
  cart.push(id);
  saveCart();
  openCart();
}

function removeFromCart(index) {
  cart.splice(index, 1);
  saveCart();
}

function saveCart() {
  localStorage.setItem('nova-cart', JSON.stringify(cart));
  updateCart();
}

function updateCart() {
  const cartCount = document.getElementById('cartCount');
  const cartItems = document.getElementById('cartItems');
  const cartTotal = document.getElementById('cartTotal');

  cartCount.textContent = cart.length;
  cartCount.classList.toggle('hidden', !cart.length);

  const items = cart
    .map((id, index) => ({ ...products.find((product) => product.id === id), index }))
    .filter((product) => product.id);

  if (!items.length) {
    cartItems.innerHTML = `
      <div class="rounded-2xl border border-dashed border-stone-300 p-8 text-center">
        <p class="font-bold">Your cart is empty.</p>
        <p class="mt-1 text-sm text-stone-500">Add something you love.</p>
      </div>
    `;
  } else {
    cartItems.innerHTML = items
      .map(
        (product) => `
          <div class="flex items-center gap-3 rounded-2xl bg-stone-50 p-3">
            <img src="${product.image}" alt="${product.name}" class="h-16 w-16 rounded-xl object-cover">
            <div class="flex-1">
              <p class="font-bold">${product.name}</p>
              <p class="text-sm text-stone-500">${money(product.price)}</p>
            </div>
            <button
              onclick="removeFromCart(${product.index})"
              class="text-xs font-semibold text-stone-400 transition hover:text-red-500"
            >
              Remove
            </button>
          </div>
        `
      )
      .join('');
  }

  const total = items.reduce((sum, product) => sum + product.price, 0);
  cartTotal.textContent = money(total);
}

function openCart() {
  const cartPanel = document.getElementById('cartPanel');
  const overlay = document.getElementById('overlay');

  cartPanel.classList.remove('hidden');
  cartPanel.classList.add('cart-enter');
  overlay.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function closeCart() {
  const cartPanel = document.getElementById('cartPanel');
  const overlay = document.getElementById('overlay');

  cartPanel.classList.add('hidden');
  cartPanel.classList.remove('cart-enter');
  overlay.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}

function closeMobileMenu() {
  const mobileMenu = document.getElementById('mobileMenu');
  const menuBtn = document.getElementById('menuBtn');
  const menuIcon = document.getElementById('menuIcon');

  mobileMenu.classList.add('hidden');
  mobileMenu.classList.remove('mobile-menu-enter');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />';
}

function toggleMobileMenu() {
  const mobileMenu = document.getElementById('mobileMenu');
  const menuBtn = document.getElementById('menuBtn');
  const menuIcon = document.getElementById('menuIcon');
  const isOpen = !mobileMenu.classList.contains('hidden');

  if (isOpen) {
    closeMobileMenu();
    return;
  }

  mobileMenu.classList.remove('hidden');
  mobileMenu.classList.add('mobile-menu-enter');
  menuBtn.setAttribute('aria-expanded', 'true');
  menuIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />';
}

document.getElementById('cartBtn').addEventListener('click', openCart);
document.getElementById('closeCart').addEventListener('click', closeCart);
document.getElementById('overlay').addEventListener('click', closeCart);
document.getElementById('menuBtn').addEventListener('click', toggleMobileMenu);

document.querySelectorAll('.mobile-link').forEach((link) => {
  link.addEventListener('click', closeMobileMenu);
});

document.querySelectorAll('.filter').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((filterButton) => {
      filterButton.classList.remove('bg-stone-900', 'text-white');
      filterButton.classList.add('border', 'border-stone-300', 'bg-white');
    });

    button.classList.remove('border', 'border-stone-300', 'bg-white');
    button.classList.add('bg-stone-900', 'text-white');

    renderProducts(button.dataset.filter);
  });
});

document.getElementById('checkoutBtn').addEventListener('click', () => {
  alert('Demo checkout — connect your payment provider here.');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeCart();
    closeMobileMenu();
  }
});

window.addEventListener('resize', () => {
  if (window.innerWidth >= 768) {
    closeMobileMenu();
  }
});

renderProducts();
updateCart();
