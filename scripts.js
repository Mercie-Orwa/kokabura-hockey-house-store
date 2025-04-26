// Global state
let cartItems = JSON.parse(localStorage.getItem('cartItems')) || [];
let cartCount = cartItems.reduce((sum, item) => sum + (item.quantity || 1), 0);
let products = [];
let userId = localStorage.getItem('userId') || null;

// --- Utility Functions ---
function showLoading(elementId, message = 'Loading...') {
    const element = document.getElementById(elementId);
    if (element) element.innerHTML = `<div class="loading-spinner">${message}</div>`;
}

function showError(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) element.innerHTML = `<div class="error-message">${message}</div>`;
}

function getCartTotal() {
    return cartItems.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0);
}

function validatePhoneNumber(phone) {
    return /^254[17]\d{8}$/.test(phone);
}

// --- Product Functions ---
async function fetchProducts() {
    try {
        showLoading('product-container');
        const response = await fetch('/products');
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        products = await response.json();
        localStorage.setItem('products', JSON.stringify(products));
        displayProducts(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        showError('product-container', 'Failed to load products. Please try again later.');
    }
}

function displayProducts(productList = products) {
    const container = document.getElementById('product-container');
    if (!container) return;
    
    container.innerHTML = productList.length ? productList.map(product => `
        <div class="product-card">
            <img src="${product.image || 'images/placeholder.jpg'}" alt="${product.name}">
            <h3>${product.name}</h3>
            <p class="price">Ksh ${product.price.toLocaleString()}</p>
            <p class="description">${product.description || 'No description available'}</p>
            <button onclick="addToCart('${product._id}')">Add to Cart</button>
        </div>
    `).join('') : '<p class="no-products">No products available</p>';
}

// --- Cart Functions ---
function addToCart(productId) {
    const product = products.find(p => p._id === productId);
    if (!product) return;

    const existingItem = cartItems.find(item => item._id === productId);
    if (existingItem) {
        existingItem.quantity = (existingItem.quantity || 1) + 1;
    } else {
        cartItems.push({ 
            _id: product._id,
            name: product.name,
            price: product.price,
            quantity: 1,
            image: product.image
        });
    }
    
    updateCartStorage();
    showToast(`${product.name} added to cart!`);
}

function removeFromCart(index) {
    if (index >= 0 && index < cartItems.length) {
        cartItems.splice(index, 1);
        updateCartStorage();
    }
}

function updateCartItemQuantity(index, change) {
    const item = cartItems[index];
    if (!item) return;

    item.quantity = (item.quantity || 1) + change;
    if (item.quantity <= 0) {
        cartItems.splice(index, 1);
    }
    
    updateCartStorage();
}

function updateCartStorage() {
    cartCount = cartItems.reduce((sum, item) => sum + (item.quantity || 1), 0);
    localStorage.setItem('cartItems', JSON.stringify(cartItems));
    updateCartCount();
    displayCartItems();
}

function displayCartItems() {
    const cartItemsElement = document.getElementById('cart-items');
    const cartTotalElement = document.getElementById('cart-total');
    if (!cartItemsElement || !cartTotalElement) return;

    cartItemsElement.innerHTML = cartItems.length ? cartItems.map((item, index) => `
        <div class="cart-item">
            <img src="${item.image || 'images/placeholder.jpg'}" alt="${item.name}">
            <div class="item-details">
                <h4>${item.name}</h4>
                <p>Ksh ${item.price.toLocaleString()} x ${item.quantity || 1}</p>
                <div class="quantity-controls">
                    <button onclick="updateCartItemQuantity(${index}, -1)">-</button>
                    <span>${item.quantity || 1}</span>
                    <button onclick="updateCartItemQuantity(${index}, 1)">+</button>
                </div>
                <button class="remove-btn" onclick="removeFromCart(${index})">Remove</button>
            </div>
        </div>
    `).join('') : '<p class="empty-cart">Your cart is empty</p>';

    cartTotalElement.textContent = getCartTotal().toLocaleString();
}

function updateCartCount() {
    const cartCountElements = document.querySelectorAll('.cart-count');
    cartCountElements.forEach(el => el.textContent = cartCount);
}

// --- Checkout Functions ---
async function initiateCheckout(e) {
    e.preventDefault();
    
    const checkoutForm = document.getElementById('checkout-form');
    const checkoutMessage = document.getElementById('checkout-message');
    if (!checkoutForm || !checkoutMessage) return;

    if (cartItems.length === 0) {
        showError('checkout-message', 'Your cart is empty!');
        return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html?redirect=checkout';
        return;
    }

    const formData = new FormData(checkoutForm);
    const customerData = {
        name: formData.get('name'),
        email: formData.get('email'),
        phoneNumber: formData.get('phone')
    };

    if (!validatePhoneNumber(customerData.phoneNumber)) {
        showError('checkout-message', 'Please enter a valid Kenyan phone number (e.g., 2547XXXXXXXX)');
        return;
    }

    try {
        showLoading('checkout-message', 'Processing your payment...');
        
        const response = await fetch('/api/checkout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                cart: cartItems,
                ...customerData
            })
        });

        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.message || 'Checkout failed');
        }

        // Payment initiated successfully
        checkoutMessage.innerHTML = `
            <div class="success-message">
                <p>${result.message}</p>
                <p>Check your phone to complete the M-Pesa payment</p>
            </div>
        `;

        // Start polling for payment status
        await monitorPaymentStatus(result.orderId, result.paymentId, token);

    } catch (error) {
        console.error('Checkout error:', error);
        showError('checkout-message', error.message || 'Failed to process payment');
    }
}

async function monitorPaymentStatus(orderId, paymentId, token) {
    const maxAttempts = 15; // ~45 seconds total
    let attempts = 0;
    
    while (attempts < maxAttempts) {
        try {
            const response = await fetch(`/api/payments/${paymentId}?orderId=${orderId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            const result = await response.json();
            
            if (response.ok && result.payment) {
                if (result.payment.status === 'completed') {
                    // Payment successful
                    document.getElementById('checkout-message').innerHTML = `
                        <div class="success-message">
                            <p>Payment completed successfully!</p>
                            <p>Your order #${orderId} has been confirmed.</p>
                        </div>
                    `;
                    clearCart();
                    setTimeout(() => window.location.href = '/order-history.html', 3000);
                    return;
                } else if (result.payment.status === 'failed') {
                    showError('checkout-message', 'Payment failed. Please try again.');
                    return;
                }
            }
            
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
            
        } catch (error) {
            console.error('Payment status check error:', error);
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    
    // If we get here, polling timed out
    showError('checkout-message', 'Payment status check timed out. Please check your order history for updates.');
}

// --- Order History ---
async function fetchOrderHistory() {
    const orderList = document.getElementById('order-list');
    if (!orderList) return;

    try {
        showLoading('order-list');
        const token = localStorage.getItem('token');
        if (!token) {
            window.location.href = '/login.html?redirect=order-history';
            return;
        }

        const response = await fetch('/orders', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = '/login.html?redirect=order-history';
                return;
            }
            throw new Error('Failed to fetch orders');
        }

        const orders = await response.json();
        displayOrderHistory(orders);
    } catch (error) {
        console.error('Order history error:', error);
        showError('order-list', error.message || 'Failed to load order history');
    }
}

function displayOrderHistory(orders) {
    const orderList = document.getElementById('order-list');
    if (!orderList) return;

    orderList.innerHTML = orders.length ? orders.map(order => `
        <div class="order-card">
            <div class="order-header">
                <h3>Order #${order._id.substring(0, 8)}</h3>
                <span class="order-status ${order.status}">${order.status}</span>
            </div>
            <div class="order-details">
                <p><strong>Date:</strong> ${new Date(order.createdAt).toLocaleString()}</p>
                <p><strong>Total:</strong> Ksh ${order.total.toLocaleString()}</p>
                <p><strong>Payment:</strong> ${order.paymentStatus}</p>
            </div>
            <div class="order-items">
                ${order.items.map(item => `
                    <div class="order-item">
                        <img src="${item.image || 'images/placeholder.jpg'}" alt="${item.name}">
                        <div>
                            <p>${item.name}</p>
                            <p>Ksh ${item.price.toLocaleString()} x ${item.quantity}</p>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('') : '<p class="no-orders">No orders found</p>';
}

// --- Authentication ---
async function handleLogin(e) {
    e.preventDefault();
    
    const loginForm = document.getElementById('login-form');
    const loginMessage = document.getElementById('login-message');
    if (!loginForm || !loginMessage) return;

    const formData = new FormData(loginForm);
    const credentials = {
        email: formData.get('email'),
        password: formData.get('password'),
        loginType: formData.get('login-type')
    };

    try {
        showLoading('login-message', 'Logging in...');
        
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(credentials)
        });

        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.message || 'Login failed');
        }

        // Login successful
        localStorage.setItem('token', result.token);
        localStorage.setItem('userId', result.userId);
        
        // Redirect based on user type
        const redirectUrl = credentials.loginType === 'admin' ? '/admin.html' : '/products.html';
        window.location.href = redirectUrl;

    } catch (error) {
        console.error('Login error:', error);
        showError('login-message', error.message || 'Login failed. Please try again.');
    }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialize based on current page
    const path = window.location.pathname;
    
    // Common initialization
    updateCartCount();
    
    // Page-specific initialization
    if (path.includes('products.html') || path === '/') {
        fetchProducts();
        document.getElementById('search-input')?.addEventListener('input', filterProducts);
    }
    
    if (path.includes('cart.html')) {
        displayCartItems();
        document.getElementById('checkout-form')?.addEventListener('submit', initiateCheckout);
    }
    
    if (path.includes('order-history.html')) {
        fetchOrderHistory();
    }
    
    if (path.includes('login.html')) {
        document.getElementById('login-form')?.addEventListener('submit', handleLogin);
    }
});

// Helper function to show toast notifications
function showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 500);
    }, duration);
}