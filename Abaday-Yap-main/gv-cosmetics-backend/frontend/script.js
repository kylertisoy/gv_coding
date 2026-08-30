/* ═══════════════════════════════════════════
   API LAYER — talks to the FastAPI backend
═══════════════════════════════════════════ */
const API_BASE = window.GVCI_API_BASE || 'http://localhost:8000';

let authToken = localStorage.getItem('gvci_token') || null;

async function apiFetch(path, options = {}) {
  const headers = options.headers || {};
  if (!(options.body instanceof URLSearchParams)) {
    headers['Content-Type'] = 'application/json';
  }
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;

  const res = await fetch(API_BASE + path, { ...options, headers });
  if (!res.ok) {
    let detail = 'Request failed';
    try { detail = (await res.json()).detail || detail; } catch (e) {}
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

/* Local product photos — add more entries here as you get more photos.
   Key = product id, Value = path to the image file in the frontend/images folder. */
const IMAGE_OVERRIDES = {
  1: 'images/michael-styling-gel-sachet-10g.jpg',
  5: 'images/michael-styling-tube-50ml.jpg',
  6: 'images/michael-styling-tube-125ml.jpg',
  7: 'images/shine-n-free-gel-tube-50ml.jpg',
  8: 'images/shine-n-free-gel-tube-100ml.jpg',
};

/* Renders a product's image if p.image is set, otherwise falls back to the emoji icon */
function productImgHtml(p, size){
  size = size || 52;
  if(p.image){
    return `<img src="${p.image}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'">
            <span style="font-size:${size}px;display:none">${p.e}</span>`;
  }
  return `<span style="font-size:${size}px">${p.e}</span>`;
}

/* Map a backend product (category/emoji/description) to the shape the UI expects (cat/e/desc) */
function mapProduct(p) {
  return { id: p.id, name: p.name, cat: p.category, price: p.price, stock: p.stock, e: p.emoji, image: p.image_url || IMAGE_OVERRIDES[p.id], desc: p.description, badge: p.badge, avg_rating: p.avg_rating, rating_count: p.rating_count };
}

/* Display-only label for order statuses. The underlying value stays 'Shipped'
   everywhere (comparisons, the status-update API call, backend enum) — only
   what's shown to admins/customers reads "Delivering". */
function statusLabel(status){
  return status==='Shipped' ? 'Delivering' : status;
}

function formatOrderDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

/* Map a backend order to the shape the UI expects (id=order_number, items=string, etc.) */
function mapOrder(o) {
  return {
    id: o.order_number,
    dbId: o.id,
    customer: o.customer_name || '',
    items: o.items.map(i => i.product_name).join(', '),
    total: o.total,
    date: formatOrderDate(o.created_at),
    status: o.status,
    address: o.shipping_address,
    tracking: o.tracking_number,
  };
}

function mapNotif(n) {
  const iconMap = { processing: '🔄', shipped: '🚚', delivered: '✅', info: '🔔' };
  return {
    id: n.id,
    icon: iconMap[n.type] || '🔔',
    iconClass: n.type,
    title: n.title,
    msg: n.message,
    time: new Date(n.created_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
    read: n.read,
  };
}

/* ═══ STATE (populated from the API after login) ═══ */
let PRODUCTS = [];
let ORDERS_DATA = [];   // admin: all orders
let CUSTOMERS_DATA = [];
let cart={}, myOrders=[], activeCat='All', currentUser=null, editingProductId=null;
let pfImageData=null; // base64 data URL of a newly-picked product image (JPEG), pending save
let wishlist=[], loyaltyPoints=0, productRatings={};
let addresses=[];
let currentPass='', displayName='';
let NOTIFS=[];

/* Fetch products + ratings from the API */
async function loadProducts() {
  const data = await apiFetch('/products');
  PRODUCTS = data.map(mapProduct);
  productRatings = {};
  PRODUCTS.forEach(p => {
    if (p.rating_count > 0) {
      productRatings[p.id] = { avg: p.avg_rating.toFixed(1), count: p.rating_count, userRating: 0 };
    }
  });
}

/* Fetch the customer's wishlist product ids */
async function loadWishlist() {
  const data = await apiFetch('/wishlist');
  wishlist = data.map(p => p.id);
}

/* Fetch the customer's own orders (or all orders for admin) */
async function loadOrders() {
  const data = await apiFetch('/orders');
  const mapped = data.map(mapOrder);
  if (currentUser && currentUser.role === 'admin') {
    ORDERS_DATA = mapped;
  } else {
    myOrders = mapped;
  }
}

async function loadAddresses() {
  const data = await apiFetch('/addresses');
  addresses = data.map(a => ({ id: a.id, name: a.name, phone: a.phone, street: a.street, city: a.city, province: a.province, zip: a.zip, label: a.label, isDefault: a.is_default }));
}

async function loadNotifications() {
  const data = await apiFetch('/notifications');
  NOTIFS = data.map(mapNotif);
}

async function loadCustomers() {
  const data = await apiFetch('/customers');
  CUSTOMERS_DATA = data;
}

/* ═══ TOAST ═══ */
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2800);
}

/* ═══ LOGIN ═══ */
// topbar scroll shadow
window.addEventListener('scroll',function(){
  const tb=document.getElementById('c-topbar-el');
  if(tb){tb.classList.toggle('scrolled',window.scrollY>10);}
});

function showSignup(){
  document.getElementById('login-form-wrap').classList.add('hidden');
  document.getElementById('signup-form-wrap').classList.remove('hidden');
  document.getElementById('su-err').style.display='none';
}
function showLoginForm(){
  document.getElementById('signup-form-wrap').classList.add('hidden');
  document.getElementById('login-form-wrap').classList.remove('hidden');
}

async function doRegister(){
  const name=document.getElementById('su-name').value.trim();
  const email=document.getElementById('su-email').value.trim().toLowerCase();
  const pass=document.getElementById('su-pass').value;
  const pass2=document.getElementById('su-pass2').value;
  const err=document.getElementById('su-err');

  const showErr=(msg)=>{err.textContent='❌ '+msg;err.style.display='block';};

  if(!name||!email||!pass){showErr('Please fill in all fields.');return;}
  if(pass.length<6){showErr('Password must be at least 6 characters.');return;}
  if(pass!==pass2){showErr('Passwords do not match.');return;}

  let data;
  try {
    data = await apiFetch('/auth/register', {
      method:'POST',
      body: JSON.stringify({ name, email, password: pass })
    });
  } catch(e) {
    showErr(e.message||'Could not create account.');
    return;
  }
  err.style.display='none';

  // Registration no longer returns a token/user — new customer accounts are
  // created as 'pending' and need an admin to approve them before they can log in.
  showToast('✅ '+(data.detail||'Account created. Please wait for admin approval.'));

  // reset the signup form + switch back to login view for next time
  document.getElementById('su-name').value='';
  document.getElementById('su-email').value='';
  document.getElementById('su-pass').value='';
  document.getElementById('su-pass2').value='';
  showLoginForm();
}

async function doLogin(){
  const email=document.getElementById('inp-email').value.trim().toLowerCase();
  const pass=document.getElementById('inp-pass').value;
  const err=document.getElementById('err-msg');

  let data;
  try {
    const form = new URLSearchParams();
    form.set('username', email);
    form.set('password', pass);
    data = await apiFetch('/auth/login', { method: 'POST', body: form });
  } catch (e) {
    err.style.display='block';
    return;
  }
  err.style.display='none';

  authToken = data.access_token;
  localStorage.setItem('gvci_token', authToken);
  const acc = data.user; // {id,email,name,initials,role,loyalty_points}
  currentUser = acc;
  loyaltyPoints = acc.loyalty_points || 0;
  displayName = acc.name;
  currentPass = pass;

  document.getElementById('screen-login').classList.add('hidden');
  if(acc.role==='customer'){
    document.getElementById('screen-customer').classList.remove('hidden');
    document.getElementById('c-avatar').textContent=acc.initials;
    document.getElementById('prof-avatar-big').textContent=acc.initials;
    document.getElementById('c-username').textContent=acc.name.split(' ')[0];
    try {
      await Promise.all([loadProducts(), loadWishlist(), loadOrders(), loadAddresses(), loadNotifications()]);
    } catch (e) { showToast('⚠️ Could not reach the server.'); }
    buildShop();renderAddrList();buildRecommendations();updateWishlistBadge();updateNotifBell();
  } else {
    document.getElementById('screen-admin').classList.remove('hidden');
    try {
      await Promise.all([loadProducts(), loadOrders(), loadCustomers()]);
    } catch (e) { showToast('⚠️ Could not reach the server.'); }
    buildAdminAll();
  }
}

function doLogout(){
  currentUser=null;cart={};myOrders=[];activeCat='All';
  authToken=null;localStorage.removeItem('gvci_token');
  document.getElementById('inp-email').value='';
  document.getElementById('inp-pass').value='';
  document.getElementById('screen-customer').classList.add('hidden');
  document.getElementById('screen-admin').classList.add('hidden');
  document.getElementById('screen-login').classList.remove('hidden');
  showToast('Logged out. See you soon! 💄');
}

/* ═══ NOTIFICATIONS ═══ */
function pushNotif(icon,iconClass,title,msg){
  NOTIFS.unshift({id:Date.now(),icon,iconClass,title,msg,time:new Date().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}),read:false});
  updateNotifBell();renderNotifList();
}
function updateNotifBell(){
  const unread=NOTIFS.filter(n=>!n.read).length;
  const dot=document.getElementById('notif-dot');
  if(!dot)return;
  if(unread>0){dot.textContent=unread;dot.classList.add('on');}
  else{dot.classList.remove('on');}
}
function renderNotifList(){
  const el=document.getElementById('notif-list');if(!el)return;
  if(!NOTIFS.length){el.innerHTML='<div class="notif-empty"><div class="notif-empty-icon">🔔</div>No notifications yet</div>';return;}
  el.innerHTML=NOTIFS.map(n=>`
    <div class="notif-item ${n.read?'':'unread'}">
      <div class="ni-icon ${n.iconClass}">${n.icon}</div>
      <div class="ni-body"><div class="ni-title">${n.title}</div><div class="ni-msg">${n.msg}</div><div class="ni-time">${n.time}</div></div>
      ${!n.read?'<div class="ni-unread-dot"></div>':''}
    </div>`).join('');
}
async function toggleNotifPanel(e){
  e.stopPropagation();
  const panel=document.getElementById('notif-panel');
  panel.classList.toggle('open');
  if(panel.classList.contains('open')){
    try { await loadNotifications(); } catch(e){}
    updateNotifBell();renderNotifList();
  }
}
async function markAllRead(){
  const unread=NOTIFS.filter(n=>!n.read);
  try { await Promise.all(unread.map(n=>apiFetch('/notifications/'+n.id+'/read',{method:'PATCH'}))); } catch(e){}
  NOTIFS.forEach(n=>n.read=true);updateNotifBell();renderNotifList();
}
document.addEventListener('click',function(e){
  const panel=document.getElementById('notif-panel');
  if(panel&&panel.classList.contains('open')&&!panel.contains(e.target)&&!e.target.closest('.notif-bell')){panel.classList.remove('open');}
});

/* ═══ SHOP ═══ */
function cPage(name,el){
  document.querySelectorAll('.c-page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.c-nav-link').forEach(n=>n.classList.remove('active'));
  const pg=document.getElementById('cpage-'+name);
  if(pg)pg.classList.add('active');
  if(el)el.classList.add('active');
  if(name==='cart')renderCart();
  if(name==='orders')renderOrders();
  if(name==='profile')renderAddrList();
  if(name==='wishlist')renderWishlist();
  if(name==='stats'){setTimeout(renderStats,80);}
}

function buildShop(){
  const cats=['All',...new Set(PRODUCTS.map(p=>p.cat))];
  document.getElementById('cat-row').innerHTML=cats.map(c=>
    `<div class="cat-strip-item${c==='All'?' on':''}" data-cat="${c}" onclick="setCat('${c}',this)">${catEmoji(c)} ${c}</div>`
  ).join('');
  renderProducts();
}

function catEmoji(c){
  const m={'All':'🏪','Hair Care':'💇','Alcohol':'🧴','Body Care':'🌺','Personal Care':'🌸'};
  return m[c]||'✨';
}

function setCat(c,el){
  activeCat=c;
  document.querySelectorAll('.cat-strip-item').forEach(x=>x.classList.remove('on'));
  el.classList.add('on');
  document.getElementById('section-title').textContent=c==='All'?'All Products':c;
  renderProducts();
}

function setCatAll(){
  activeCat='All';
  document.querySelectorAll('.cat-strip-item').forEach(x=>x.classList.remove('on'));
  document.querySelector('[data-cat="All"]').classList.add('on');
  document.getElementById('section-title').textContent='All Products';
  renderProducts();
}

function updatePriceDisplay(){
  const v=document.getElementById('filter-price-max').value;
  document.getElementById('price-display-val').textContent='₱'+parseInt(v).toLocaleString();
}
function clearFilters(){
  document.getElementById('filter-price-max').value=1000;
  document.getElementById('price-display-val').textContent='₱1,000';
  document.querySelectorAll('input[name="rating-filter"]')[0].checked=true;
  renderProducts();
}
function renderProducts(){
  const q=(document.getElementById('search-inp').value||'').toLowerCase();
  const priceMax=parseFloat(document.getElementById('filter-price-max')?.value||1000);
  const minRating=parseFloat(document.querySelector('input[name="rating-filter"]:checked')?.value||0);
  const list=PRODUCTS.filter(p=>{
    if(activeCat!=='All'&&p.cat!==activeCat)return false;
    if(q&&!p.name.toLowerCase().includes(q)&&!p.desc.toLowerCase().includes(q))return false;
    if(p.price>priceMax)return false;
    const r=productRatings[p.id];
    if(minRating>0&&(!r||parseFloat(r.avg)<minRating))return false;
    return true;
  });
  const grid=document.getElementById('products-grid');
  if(!list.length){grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:64px;color:var(--muted)"><div style="font-size:44px;margin-bottom:12px">🔍</div><p>No products found.</p></div>';return;}
  grid.innerHTML=list.map(p=>{
    const isLow=p.stock<30&&p.stock>0;
    const badge=p.badge==='hot'?'<span class="p-badge">🔥 Hot</span>':p.badge==='new'?'<span class="p-badge new">✨ New</span>':'';
    const inWL=wishlist.includes(p.id);
    const r=productRatings[p.id];
    const starsHtml=r?[1,2,3,4,5].map(i=>`<span class="s${i<=Math.round(parseFloat(r.avg))?' on':''}" onclick="event.stopPropagation();rateProduct(${p.id},${i})">${i<=Math.round(parseFloat(r.avg))?'★':'☆'}</span>`).join('')+'<span class="p-rating-txt">('+r.count+')</span>':'';
    return `<div class="p-card" onclick="openProductModal(${p.id})">
      ${badge}
      <div class="p-img">
        ${productImgHtml(p)}
        <button class="p-wishlist" onclick="event.stopPropagation();toggleWishlist(${p.id})">${inWL?'❤️':'♡'}</button>
      </div>
      <div class="p-info">
        ${r?`<div class="p-stars-row">${starsHtml}</div>`:''}
        <div class="p-name">${p.name}</div>
        <div class="p-cat">${p.cat}</div>
        <div class="p-price-row">
          <div class="p-price">₱${p.price.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        </div>
        <div class="p-stock ${isLow?'low':''}">${p.stock===0?'Out of stock':isLow?'⚠️ Only '+p.stock+' left':p.stock+' in stock'}</div>
        <button class="p-add" onclick="event.stopPropagation();addCart(${p.id})" ${p.stock===0?'disabled':''}>
          ${p.stock===0?'Out of Stock':'🛒 Add to Cart'}
        </button>
      </div>
    </div>`;
  }).join('');
}

function addCart(id){
  const p=PRODUCTS.find(x=>x.id===id);
  cart[id]=(cart[id]||0)+1;
  updatePill();
  showToast('✅ '+p.name+' added to cart!');
}
async function toggleWishlist(id){
  try {
    const res = await apiFetch('/wishlist/'+id, { method: 'POST' });
    const idx=wishlist.indexOf(id);
    if(res.in_wishlist){ if(idx===-1)wishlist.push(id); showToast('❤️ Added to wishlist!'); }
    else{ if(idx>-1)wishlist.splice(idx,1); showToast('Removed from wishlist'); }
  } catch(e){ showToast('⚠️ '+e.message); return; }
  updateWishlistBadge();
  renderProducts();
}
function updateWishlistBadge(){
  const b=document.getElementById('wl-badge');
  if(!b)return;
  if(wishlist.length>0){b.textContent=wishlist.length;b.classList.add('on');}
  else{b.classList.remove('on');}
}
function renderWishlist(){
  const body=document.getElementById('wishlist-body');
  if(!wishlist.length){
    body.innerHTML=`<div class="empty-state">
      <div class="empty-icon">❤️</div>
      <h3>Your wishlist is empty</h3>
      <p>Save products you love by tapping the <b style="color:var(--rose)">♡ heart icon</b> on any product card in the Shop. They'll appear here so you can buy them later!</p>
      <button onclick="cPage('shop',document.getElementById('cnav-shop'))">Browse Products →</button>
      <div style="margin-top:22px;background:var(--rose-lt);border:1px solid var(--rose-mid);border-radius:12px;padding:14px 18px;max-width:340px;margin-left:auto;margin-right:auto;text-align:left">
        <div style="font-size:12px;font-weight:600;color:var(--rose-dk);margin-bottom:8px">💡 How to use Wishlist</div>
        <div style="font-size:12px;color:var(--text);line-height:1.7">
          1. Go to <b>Shop</b> and hover over a product<br>
          2. Click the <b>♡</b> heart button on the card<br>
          3. Come back here to view saved items<br>
          4. Add them to cart whenever you're ready!
        </div>
      </div>
    </div>`;
    return;
  }
  body.innerHTML=`<div class="wishlist-grid">${wishlist.map(id=>{
    const p=PRODUCTS.find(x=>x.id===id);if(!p)return'';
    return`<div class="p-card" style="position:relative" onclick="openProductModal(${p.id})">
      <button class="wl-remove" onclick="event.stopPropagation();toggleWishlist(${p.id});renderWishlist()">✕</button>
      <div class="p-img">${productImgHtml(p)}</div>
      <div class="p-info">
        <div class="p-name">${p.name}</div>
        <div class="p-cat">${p.cat}</div>
        <div class="p-price-row"><div class="p-price">₱${p.price.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
        <div class="p-stock ${p.stock===0?'low':''}">${p.stock===0?'Out of stock':p.stock+' in stock'}</div>
        <button class="p-add" onclick="event.stopPropagation();addCart(${p.id});renderWishlist()" ${p.stock===0?'disabled':''}>🛒 Add to Cart</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}
async function rateProduct(id,rating){
  let res;
  try {
    res = await apiFetch('/products/'+id+'/rate', { method: 'POST', body: JSON.stringify({ stars: rating }) });
  } catch(e) { showToast('⚠️ '+e.message); return; }
  productRatings[id] = { avg: res.avg.toFixed(1), count: res.count, userRating: res.user_rating };
  showToast('⭐ Rated '+rating+' star'+(rating>1?'s':'')+'!');
  renderProducts();
}
function buildRecommendations(){
  const wrap=document.getElementById('reco-wrap');
  if(!wrap)return;
  let reco=[];
  if(myOrders.length>0){
    // find cats from orders
    const orderedCats=new Set();
    myOrders.forEach(o=>{
      const itemNames=o.items.split(',');
      itemNames.forEach(nm=>{
        const p=PRODUCTS.find(x=>x.name===nm.trim());
        if(p)orderedCats.add(p.cat);
      });
    });
    reco=PRODUCTS.filter(p=>orderedCats.has(p.cat)&&!Object.keys(cart).map(Number).includes(p.id)).slice(0,8);
  }
  if(reco.length<4)reco=PRODUCTS.filter(p=>p.badge==='hot'||p.badge==='new').slice(0,8);
  if(!reco.length){wrap.style.display='none';return;}
  wrap.style.display='block';
  document.getElementById('reco-strip').innerHTML=reco.map(p=>`
    <div class="reco-card">
      <div class="reco-emoji">${productImgHtml(p, 36)}</div>
      <div class="reco-name">${p.name}</div>
      <div class="reco-price">₱${p.price.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
      <button class="reco-btn" onclick="addCart(${p.id})">🛒 Add to Cart</button>
    </div>`).join('');
}
function toggleLoyaltyPanel(e){
  e.stopPropagation();
  const panel=document.getElementById('loyalty-panel');
  panel.classList.toggle('open');
}
document.addEventListener('click',function(e2){
  const lp=document.getElementById('loyalty-panel');
  if(lp&&lp.classList.contains('open')&&!lp.contains(e2.target)&&!e2.target.closest('.loyalty-pill'))lp.classList.remove('open');
});
function updateLoyaltyDisplay(){
  const totalSpent=myOrders.reduce((s,o)=>s+o.total,0);
  document.getElementById('lp-display').textContent=loyaltyPoints;
  document.getElementById('lp-pts-big').textContent=loyaltyPoints;
  document.getElementById('lp-spent').textContent='₱'+totalSpent.toLocaleString();
  document.getElementById('lp-orders').textContent=myOrders.length;
  document.getElementById('lp-pts-lbl2').textContent=loyaltyPoints+' pts';
  const pct=Math.min(loyaltyPoints/500*100,100);
  document.getElementById('lp-bar').style.width=pct+'%';
}
// Backwards-compatible alias (older markup may still call updateLoyalty(spent))
function updateLoyalty(){ updateLoyaltyDisplay(); }
function updatePill(){
  document.getElementById('cart-pill').textContent='🛒 Cart ('+Object.values(cart).reduce((a,b)=>a+b,0)+')';
}

function renderCart(){
  const body=document.getElementById('cart-body');
  const keys=Object.keys(cart);
  if(!keys.length){body.innerHTML=`<div class="empty-state"><div class="empty-icon">🛒</div><h3>Your cart is empty</h3><p>Browse our GV Cosmetics collection and add items you love.</p><button onclick="cPage('shop',document.getElementById('cnav-shop'))">Start Shopping →</button></div>`;return;}
  let total=0;
  body.innerHTML=keys.map(id=>{
    const p=PRODUCTS.find(x=>x.id==id);const sub=p.price*cart[id];total+=sub;
    return`<div class="cart-item">
      <div class="ci-img">${productImgHtml(p, 30)}</div>
      <div class="ci-info">
        <div class="ci-name">${p.name}</div>
        <div class="ci-price">₱${p.price.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})} each</div>
        <div class="ci-qty">
          <button class="qb" onclick="adjCart(${id},-1)">−</button>
          <span style="font-size:13px;font-weight:600;min-width:22px;text-align:center">${cart[id]}</span>
          <button class="qb" onclick="adjCart(${id},1)">+</button>
        </div>
      </div>
      <div class="ci-total">₱${sub.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
      <button onclick="delCart(${id})" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:22px;margin-left:12px;transition:color .15s" onmouseover="this.style.color='#c62828'" onmouseout="this.style.color='var(--muted)'">×</button>
    </div>`;
  }).join('');
  body.innerHTML+=`<div class="cart-footer">
    <div>
      <div style="font-size:13px;color:var(--muted)">Total</div>
      <div style="font-size:22px;font-weight:700;color:var(--rose);font-family:'Cormorant Garamond',serif">₱${total.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
    </div>
    <button class="checkout-btn-main" onclick="openCheckout(${total})">Proceed to Checkout →</button>
  </div>`;
}
function adjCart(id,d){cart[id]=(cart[id]||0)+d;if(cart[id]<=0)delete cart[id];updatePill();renderCart();}
function delCart(id){delete cart[id];updatePill();renderCart();}

function openCheckout(grand){
  const defAddr=addresses.find(a=>a.isDefault)||addresses[0];
  const addrStr=defAddr?`${defAddr.street}, ${defAddr.city}`:'No address saved';
  const keys=Object.keys(cart);
  document.getElementById('checkout-body').innerHTML=`
    <div class="checkout-wrap">
      <h2>Checkout</h2>
      <div class="checkout-progress">
        <div class="cp-step"><div class="cp-circle done">✓</div><span class="cp-lbl done">Cart</span></div>
        <div class="cp-line done"></div>
        <div class="cp-step"><div class="cp-circle act">2</div><span class="cp-lbl act">Details</span></div>
        <div class="cp-line pend"></div>
        <div class="cp-step"><div class="cp-circle pend">3</div><span class="cp-lbl pend">Confirm</span></div>
      </div>
      <div class="order-summary-box">
        <div class="os-title">Order Summary</div>
        ${keys.map(id=>{const p=PRODUCTS.find(x=>x.id==id);return`<div class="os-row"><span>${p.name} × ${cart[id]}</span><span>₱${(p.price*cart[id]).toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>`;}).join('')}
        <div class="os-row os-total"><span>Total</span><span style="color:var(--rose)">₱${grand.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
      </div>
      <div class="form-2col">
        <div class="fg"><label>First Name</label><input id="co-fn" value="${displayName.split(' ')[0]}"></div>
        <div class="fg"><label>Last Name</label><input id="co-ln" value="${displayName.split(' ').slice(1).join(' ')}"></div>
      </div>
      <div class="fg"><label>Phone</label><input id="co-ph" value="${addresses[0]?.phone||''}"></div>
      <div class="fg"><label>Delivery Address</label><input id="co-addr" value="${addrStr}"></div>
      <div class="form-2col">
        <div class="fg"><label>City</label><input id="co-city" value="${defAddr?.city||''}"></div>
        <div class="fg"><label>Province</label><input id="co-prov" value="${defAddr?.province||''}"></div>
      </div>
      <div class="fg"><label>Payment Method</label>
        <select id="co-pay"><option value="cod">Cash on Delivery</option><option value="gcash">GCash</option><option value="card">Credit/Debit Card</option><option value="maya">Maya</option></select>
      </div>
      <button class="place-btn" onclick="placeOrder(${grand})">Place Order — ₱${grand.toLocaleString('en-PH',{minimumFractionDigits:2})} →</button>
    </div>`;
  cPage('checkout',null);
}

async function placeOrder(grand){
  const fn=document.getElementById('co-fn').value.trim();
  const ln=document.getElementById('co-ln')?.value.trim()||'';
  const addr=document.getElementById('co-addr').value.trim();
  if(!fn||!addr){showToast('Please fill in your name and address.');return;}
  const addrFull=addr+', '+document.getElementById('co-city').value+', '+document.getElementById('co-prov').value;
  const items=Object.keys(cart).map(id=>({product_id:parseInt(id),quantity:cart[id]}));

  let order;
  try {
    order = await apiFetch('/orders', {
      method: 'POST',
      body: JSON.stringify({ items, shipping_name: (fn+' '+ln).trim(), shipping_address: addrFull })
    });
  } catch(e) {
    showToast('⚠️ '+e.message);
    return;
  }

  cart={};updatePill();
  await loadProducts(); // stock changed
  try { const me = await apiFetch('/auth/me'); loyaltyPoints = me.loyalty_points; } catch(e){}
  myOrders.unshift(mapOrder(order));
  updateLoyaltyDisplay();
  buildRecommendations();

  document.getElementById('checkout-body').innerHTML=`
    <div class="success-wrap">
      <div class="success-icon">🎉</div>
      <h2>Order Placed!</h2>
      <p>Order <b style="color:var(--rose-dk)">${order.order_number}</b> is confirmed!<br>Delivering to:<br><b style="color:var(--rose)">${addrFull}</b><br><br>We'll notify you when your order status changes.</p>
      <button class="cont-btn" onclick="cPage('shop',document.getElementById('cnav-shop'))">Continue Shopping 💄</button>
    </div>`;
}

function renderOrders(){
  const body=document.getElementById('orders-body');
  if(!myOrders.length){body.innerHTML=`<div class="empty-state"><div class="empty-icon">📦</div><h3>No orders yet</h3><p>Start shopping to see your orders here!</p><button onclick="cPage('shop',document.getElementById('cnav-shop'))">Shop Now →</button></div>`;return;}
  body.innerHTML=myOrders.map(o=>{
    const steps=[
      {label:'Order Placed',sub:'Order received & confirmed',status:'done'},
      {label:'Processing',sub:'Preparing your items',status:o.status==='Pending'?'pend':'done'},
      {label:'Delivering',sub:'On its way to you',status:o.status==='Delivered'||o.status==='Shipped'?o.status==='Delivered'?'done':'act':'pend'},
      {label:'Delivered',sub:'Package delivered',status:o.status==='Delivered'?'done':'pend'},
    ];
    const trackHtml=o.tracking?`<div class="oc-tracking">
      <div class="oc-track-no">Tracking: <span>${o.tracking}</span></div>
      <div class="tt">${steps.map(s=>`<div class="tt-row"><div class="tt-dot ${s.status}">${s.status==='done'?'✓':s.status==='act'?'→':'○'}</div><div class="tt-body"><div class="tt-lbl">${s.label}</div><div class="tt-sub">${s.sub}</div></div></div>`).join('')}</div>
      ${o.status==='Delivered'?`<div class="review-prompt"><div style="font-size:12px;font-weight:600;color:var(--dark);margin-bottom:8px">Rate your order ⭐</div><div class="review-stars-row" id="revrow-${o.id}">${[1,2,3,4,5].map(i=>`<span class="rev-star" onclick="submitReview('${o.id}',${i})">${i<=0?'★':'☆'}</span>`).join('')}</div><textarea class="review-input" id="rev-txt-${o.id}" placeholder="Share your experience..."></textarea><button class="review-submit" onclick="submitReview('${o.id}',0)">Submit Review</button><div class="review-done" id="rev-done-${o.id}">✅ Review submitted! Thank you!</div></div>`:''}
    </div>`:''
    return`<div class="order-card">
      <div class="oc-head"><span class="oc-id">${o.id}</span><span class="oc-date">${o.date}</span></div>
      <div class="oc-items">${o.items}</div>
      ${o.address?`<div class="oc-addr">📍 ${o.address}</div>`:''}
      <div class="oc-foot">
        <span class="oc-price">₱${o.total.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
        <span class="badge ${o.status==='Delivered'?'bg-green':o.status==='Shipped'?'bg-blue':o.status==='Processing'?'bg-amber':'bg-gray'}">${statusLabel(o.status)}</span>
      </div>
      ${trackHtml}
    </div>`;
  }).join('');
}

/* ═══ PROFILE ═══ */
function renderAddrList(){
  document.getElementById('addr-list').innerHTML=addresses.map((a,i)=>`
    <div class="addr-card">${a.isDefault?'<span class="addr-default">Default</span>':''}
      <p>${a.name} · ${a.phone}</p>
      <span>${a.street}<br>${a.city}, ${a.province} ${a.zip} · ${a.label}</span>
    </div>`).join('');
}
async function addAddress(){
  const name=document.getElementById('addr-name').value.trim();
  const street=document.getElementById('addr-street').value.trim();
  if(!name||!street){showToast('Please fill in the required fields.');return;}
  const payload={name,phone:document.getElementById('addr-phone').value,street,city:document.getElementById('addr-city').value,province:document.getElementById('addr-province').value,zip:document.getElementById('addr-zip').value,label:document.getElementById('addr-label').value,is_default:addresses.length===0};
  try {
    await apiFetch('/addresses', { method:'POST', body: JSON.stringify(payload) });
    await loadAddresses();
  } catch(e){ showToast('⚠️ '+e.message); return; }
  renderAddrList();showToast('✅ Address added!');
}
function savePersonalInfo(){
  displayName=document.getElementById('pf-fname').value+' '+document.getElementById('pf-lname').value;
  document.getElementById('prof-display-name').textContent=displayName;
  document.getElementById('c-username').textContent=displayName.split(' ')[0];
  showToast('✅ Profile updated!');
}
function checkStrength(){
  const v=document.getElementById('pwd-new').value;
  const bar=document.getElementById('pwd-strength');const lbl=document.getElementById('pwd-strength-label');
  const pct=Math.min(v.length/10*100,100);
  const color=pct<40?'#C87941':pct<70?'#D97706':'#16A34A';
  const text=pct<40?'Weak':pct<70?'Moderate':'Strong';
  bar.style.width=pct+'%';bar.style.background=color;lbl.textContent=text;lbl.style.color=color;
}
async function changePassword(){
  const cur=document.getElementById('pwd-current').value;
  const nw=document.getElementById('pwd-new').value;
  const cf=document.getElementById('pwd-confirm').value;
  if(nw.length<6){showToast('❌ New password must be at least 6 characters.');return;}
  if(nw!==cf){showToast('❌ Passwords do not match.');return;}
  try {
    await apiFetch('/auth/change-password', { method:'POST', body: JSON.stringify({ current_password: cur, new_password: nw }) });
  } catch(e){ showToast('❌ '+e.message); return; }
  currentPass=nw;
  document.getElementById('pwd-current').value='';document.getElementById('pwd-new').value='';document.getElementById('pwd-confirm').value='';
  showToast('✅ Password updated successfully!');
}

/* ═══════════════════════════════════════════
   ADMIN
═══════════════════════════════════════════ */

/* Top-products performance by period (units sold + revenue).
   Weekly/Yearly are scaled off the existing monthly figures so the three
   views stay internally consistent. */
const TOP_PRODUCTS_DATA = {
  week: [
    { name:'Michael Isopropyl Alcohol 70% 470ml', cat:'Alcohol', units:31, revenue:2187, status:'Fast Moving' },
    { name:"Michael Styling Gel Sachet 10g", cat:'Hair Care', units:212, revenue:393, status:'Fast Moving' },
    { name:"Shine N' Free Gel Tube 50ml", cat:'Hair Care', units:25, revenue:301, status:'Fast Moving' },
    { name:"Great Love Cotton Buds 200's", cat:'Personal Care', units:11, revenue:196, status:'Moderate' },
    { name:'Michael Ethyl Alcohol 70% 470ml', cat:'Alcohol', units:9, revenue:637, status:'Moderate' },
    { name:"Great Moods Body Spray Drakkus", cat:'Body Care', units:3, revenue:353, status:'Slow Moving' },
  ],
  month: [
    { name:'Michael Isopropyl Alcohol 70% 470ml', cat:'Alcohol', units:124, revenue:8748, status:'Fast Moving' },
    { name:"Michael Styling Gel Sachet 10g", cat:'Hair Care', units:850, revenue:1573, status:'Fast Moving' },
    { name:"Shine N' Free Gel Tube 50ml", cat:'Hair Care', units:98, revenue:1205, status:'Fast Moving' },
    { name:"Great Love Cotton Buds 200's", cat:'Personal Care', units:45, revenue:785, status:'Moderate' },
    { name:'Michael Ethyl Alcohol 70% 470ml', cat:'Alcohol', units:38, revenue:2546, status:'Moderate' },
    { name:"Great Moods Body Spray Drakkus", cat:'Body Care', units:12, revenue:1412, status:'Slow Moving' },
  ],
  year: [
    { name:'Michael Isopropyl Alcohol 70% 470ml', cat:'Alcohol', units:1488, revenue:104976, status:'Fast Moving' },
    { name:"Michael Styling Gel Sachet 10g", cat:'Hair Care', units:10200, revenue:18876, status:'Fast Moving' },
    { name:"Shine N' Free Gel Tube 50ml", cat:'Hair Care', units:1176, revenue:14460, status:'Fast Moving' },
    { name:"Great Love Cotton Buds 200's", cat:'Personal Care', units:540, revenue:9420, status:'Moderate' },
    { name:'Michael Ethyl Alcohol 70% 470ml', cat:'Alcohol', units:456, revenue:30552, status:'Moderate' },
    { name:"Great Moods Body Spray Drakkus", cat:'Body Care', units:144, revenue:16944, status:'Slow Moving' },
  ],
};
const PERIOD_LABELS={week:'Weekly',month:'Monthly',year:'Yearly'};
let anTopChart=null, anTopPeriod='month', anTopMetric='units';
let dbTopChart=null, dbTopPeriod='month', dbTopMetric='units';

function getTopProductsSorted(period,metric){
  return [...TOP_PRODUCTS_DATA[period]].sort((a,b)=>metric==='revenue'?b.revenue-a.revenue:b.units-a.units);
}

function statusBadge(status){
  return `<span class="badge ${status==='Fast Moving'?'bg-green':status==='Moderate'?'bg-amber':'bg-red'}">${status}</span>`;
}

/* Renders the Top Products chart shared by Dashboard + Analytics.
   target = {canvasId, period, metric, limit} */
function renderTopProductsChart(canvasId,period,metric,limit){
  const ctx=document.getElementById(canvasId);
  if(!ctx) return null;
  const rows=getTopProductsSorted(period,metric).slice(0,limit||5);
  return new Chart(ctx,{type:'bar',data:{labels:rows.map(r=>r.name.length>18?r.name.slice(0,16)+'…':r.name),
    datasets:[{data:rows.map(r=>metric==='revenue'?r.revenue:r.units),backgroundColor:'rgba(194,96,126,0.8)',borderRadius:6,label:metric==='revenue'?'₱':'Units'}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{y:{beginAtZero:true,grid:{color:'#F1F5F9'},ticks:{callback:v=>metric==='revenue'?'₱'+v.toLocaleString():v}}}}});
}

/* DASHBOARD: Top Products card (period only — always ranked by units) */
function renderDbTopChart(){
  if(dbTopChart) dbTopChart.destroy();
  dbTopChart=renderTopProductsChart('ch-db-top',dbTopPeriod,dbTopMetric,5);
}
function onDbTopChange(){
  dbTopPeriod=document.getElementById('db-top-period').value;
  dbTopMetric=document.getElementById('db-top-metric').value;
  renderDbTopChart();
}

/* ANALYTICS: Top Products chart + Product Performance Report table */
function renderAnTopChart(){
  if(anTopChart) anTopChart.destroy();
  anTopChart=renderTopProductsChart('ch-prod',anTopPeriod,anTopMetric,5);
}
function renderAnTopTable(){
  const tbody=document.getElementById('an-top-tbody');
  if(!tbody) return;
  tbody.innerHTML=TOP_PRODUCTS_DATA[anTopPeriod].map(r=>
    `<tr><td>${r.name}</td><td>${r.cat}</td><td>${r.units}</td><td>₱${r.revenue.toLocaleString()}</td><td>${statusBadge(r.status)}</td></tr>`
  ).join('');
  const lbl=document.getElementById('an-top-period-label');
  if(lbl) lbl.textContent=PERIOD_LABELS[anTopPeriod];
}
function onAnTopChange(){
  anTopPeriod=document.getElementById('an-top-period').value;
  anTopMetric=document.getElementById('an-top-metric').value;
  renderAnTopChart();
  renderAnTopTable();
}

function aPanel(name,el){
  document.querySelectorAll('.a-panel').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.a-item').forEach(n=>n.classList.remove('on'));
  document.getElementById('ap-'+name).classList.add('on');
  el.classList.add('on');
  const builders={dashboard:buildDashboard,analytics:buildAnalytics,products:buildProducts,orders:buildOrders,customers:buildCustomers,approvals:buildApprovals,inventory:buildInventory};
  if(builders[name])builders[name]();
}

function buildAdminAll(){buildDashboard();}

/* DASHBOARD */
function buildDashboard(){
  const totalRev=ORDERS_DATA.reduce((s,o)=>s+o.total,0);
  const totalOrds=ORDERS_DATA.length;
  const pending=ORDERS_DATA.filter(o=>o.status==='Pending').length;
  const el=document.getElementById('ap-dashboard');
  el.innerHTML=`<div class="a-title">📊 Dashboard</div>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-icon">💰</div><div class="kpi-label">Total Revenue</div><div class="kpi-val">₱${totalRev.toLocaleString()}</div><div class="kpi-sub up">▲ All time</div></div>
      <div class="kpi"><div class="kpi-icon">🛒</div><div class="kpi-label">Total Orders</div><div class="kpi-val">${totalOrds}</div><div class="kpi-sub">${pending} pending</div></div>
      <div class="kpi"><div class="kpi-icon">💄</div><div class="kpi-label">Total Products</div><div class="kpi-val">${PRODUCTS.length}</div><div class="kpi-sub">${PRODUCTS.filter(p=>p.stock<30).length} low stock</div></div>
      <div class="kpi"><div class="kpi-icon">👥</div><div class="kpi-label">Customers</div><div class="kpi-val">${CUSTOMERS_DATA.length}</div><div class="kpi-sub up">▲ Active</div></div>
    </div>
    <div class="chart-grid">
      <div class="a-card"><h3>Weekly Sales Revenue</h3><div style="position:relative;height:200px"><canvas id="ch-sales"></canvas></div></div>
      <div class="a-card"><h3>Order Status Breakdown</h3><div style="position:relative;height:200px"><canvas id="ch-status"></canvas></div></div>
    </div>
    <div class="a-card" style="margin-bottom:18px">
      <div class="a-card-head">
        <h3>Top Products</h3>
        <div style="display:flex;gap:8px">
          <select id="db-top-metric" class="period-select" onchange="onDbTopChange()">
            <option value="units">By Sales (Units)</option>
            <option value="revenue">By Revenue</option>
          </select>
          <select id="db-top-period" class="period-select" onchange="onDbTopChange()">
            <option value="week">Weekly</option>
            <option value="month" selected>Monthly</option>
            <option value="year">Yearly</option>
          </select>
        </div>
      </div>
      <div style="position:relative;height:220px"><canvas id="ch-db-top"></canvas></div>
    </div>
    <div class="tbl-wrap"><div class="tbl-head"><h3>Recent Orders</h3><button class="btn-add" onclick="aPanel('orders',document.querySelector('.a-item:nth-child(7)'))">View All</button></div>
      <table class="a-table"><thead><tr><th>Order ID</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
      <tbody>${ORDERS_DATA.slice(0,5).map(o=>`<tr><td>${o.id}</td><td>${o.customer}</td><td style="font-size:11px;color:#64748B;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.items}</td><td>₱${o.total.toLocaleString()}</td><td><span class="badge ${o.status==='Delivered'?'bg-green':o.status==='Shipped'?'bg-blue':o.status==='Processing'?'bg-amber':'bg-gray'}">${statusLabel(o.status)}</span></td></tr>`).join('')}</tbody>
      </table></div>`;
  dbTopPeriod='month'; dbTopMetric='units';
  setTimeout(()=>{
    new Chart(document.getElementById('ch-sales'),{type:'bar',data:{labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],datasets:[{data:[3200,2800,4100,3600,5200,6800,4900],backgroundColor:'rgba(79,126,247,0.85)',borderRadius:6,label:'₱'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>'₱'+v.toLocaleString()},grid:{color:'#F1F5F9'}}}}});
    const ss=['Delivered','Shipped','Processing','Pending'];
    new Chart(document.getElementById('ch-status'),{type:'doughnut',data:{labels:ss.map(statusLabel),datasets:[{data:ss.map(s=>ORDERS_DATA.filter(o=>o.status===s).length),backgroundColor:['#16A34A','#2563EB','#D97706','#9CA3AF'],borderWidth:0,hoverOffset:6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:11},padding:8}}}}});
    renderDbTopChart();
  },80);
}

/* ANALYTICS */
function buildAnalytics(){
  const el=document.getElementById('ap-analytics');
  el.innerHTML=`<div class="a-title">📈 Analytics & Reports</div>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-icon">💰</div><div class="kpi-label">Monthly Revenue</div><div class="kpi-val">₱28,500</div><div class="kpi-sub up">▲ 15% vs last month</div></div>
      <div class="kpi"><div class="kpi-icon">🛒</div><div class="kpi-label">Monthly Orders</div><div class="kpi-val">142</div><div class="kpi-sub up">▲ 8%</div></div>
      <div class="kpi"><div class="kpi-icon">📦</div><div class="kpi-label">Avg Order Value</div><div class="kpi-val">₱201</div><div class="kpi-sub">Per transaction</div></div>
      <div class="kpi"><div class="kpi-icon">🔄</div><div class="kpi-label">Repeat Buyers</div><div class="kpi-val">68%</div><div class="kpi-sub up">▲ Loyal customers</div></div>
    </div>
    <div class="chart-grid">
      <div class="a-card">
        <div class="a-card-head">
          <h3>Top Products by Sales</h3>
          <div style="display:flex;gap:8px">
            <select id="an-top-metric" class="period-select" onchange="onAnTopChange()">
              <option value="units">By Sales (Units)</option>
              <option value="revenue">By Revenue</option>
            </select>
            <select id="an-top-period" class="period-select" onchange="onAnTopChange()">
              <option value="week">Weekly</option>
              <option value="month" selected>Monthly</option>
              <option value="year">Yearly</option>
            </select>
          </div>
        </div>
        <div style="position:relative;height:200px"><canvas id="ch-prod"></canvas></div>
      </div>
      <div class="a-card"><h3>Customer Segments</h3><div style="position:relative;height:200px"><canvas id="ch-seg"></canvas></div></div>
    </div>
    <div class="a-card" style="margin-bottom:16px"><h3>Monthly Revenue 2025</h3><div style="position:relative;height:150px"><canvas id="ch-month"></canvas></div></div>
    <div class="tbl-wrap"><div class="tbl-head"><h3>Product Performance Report (<span id="an-top-period-label">${PERIOD_LABELS[anTopPeriod]}</span>)</h3><button class="btn-add" onclick="showToast('📥 Exporting report...')">Export CSV</button></div>
      <table class="a-table"><thead><tr><th>Product</th><th>Category</th><th>Units Sold</th><th>Revenue</th><th>Status</th></tr></thead>
      <tbody id="an-top-tbody"></tbody></table></div>`;
  anTopPeriod='month'; anTopMetric='units';
  renderAnTopTable();
  setTimeout(()=>{
    renderAnTopChart();
    const l=CUSTOMERS_DATA.filter(c=>c.seg==='Loyal').length,o2=CUSTOMERS_DATA.filter(c=>c.seg==='Occasional').length,n=CUSTOMERS_DATA.filter(c=>c.seg==='New').length;
    new Chart(document.getElementById('ch-seg'),{type:'pie',data:{labels:[`Loyal (${l})`,`Occasional (${o2})`,`New (${n})`],datasets:[{data:[l,o2,n],backgroundColor:['#C2607E','#B8944A','#4F7EF7'],borderWidth:0,hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:11}}}}}});
    new Chart(document.getElementById('ch-month'),{type:'line',data:{labels:['Jan','Feb','Mar','Apr','May','Jun'],datasets:[{data:[18400,22100,19800,28500,26000,31200],borderColor:'#4F7EF7',backgroundColor:'rgba(79,126,247,0.08)',tension:0.4,fill:true,label:'Revenue',pointBackgroundColor:'#4F7EF7',pointRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>'₱'+v.toLocaleString()},grid:{color:'#F1F5F9'}}}}});
  },80);
}

/* PRODUCTS */
function buildProducts(){
  const el=document.getElementById('ap-products');
  pfImageData=null;
  el.innerHTML=`<div class="a-title">💄 Product Management</div>
    <div class="prod-form-card" id="prod-form-card">
      <h3 id="prod-form-title">➕ Add New Product</h3>
      <div class="pf-grid">
        <div><label style="font-size:11px;color:#64748B;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.06em">Product Name</label><input id="pf-name" placeholder="e.g. Michael Styling Gel 50ml"></div>
        <div><label style="font-size:11px;color:#64748B;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.06em">Category</label><select id="pf-cat"><option>Hair Care</option><option>Alcohol</option><option>Body Care</option><option>Personal Care</option></select></div>
        <div><label style="font-size:11px;color:#64748B;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.06em">Price (₱)</label><input type="number" id="pf-price" placeholder="0.00" step="0.01"></div>
        <div><label style="font-size:11px;color:#64748B;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.06em">Stock Qty</label><input type="number" id="pf-stock" placeholder="0"></div>
        <div><label style="font-size:11px;color:#64748B;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.06em">Emoji Icon</label><input id="pf-emoji" placeholder="💄" maxlength="2" value="💄"></div>
        <div><label style="font-size:11px;color:#64748B;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.06em">Product Image (JPEG)</label>
          <div style="display:flex;align-items:center;gap:10px">
            <div id="pf-image-preview" style="width:52px;height:52px;border-radius:8px;border:1.5px solid #E2E8F0;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#F8FAFC;flex-shrink:0"><span style="font-size:26px">💄</span></div>
            <input type="file" id="pf-image" accept="image/jpeg,.jpg,.jpeg" onchange="onProductImageSelected(event)" style="font-size:12px">
          </div>
        </div>
        <div class="full"><label style="font-size:11px;color:#64748B;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.06em">Description</label><textarea id="pf-desc" placeholder="Product description..."></textarea></div>
      </div>
      <div class="pf-actions"><button class="btn-save" onclick="saveProduct()">💾 Save Product</button><button class="btn-cancel-form" onclick="resetProductForm()">✕ Cancel</button></div>
    </div>
    <div class="tbl-wrap"><div class="tbl-head"><h3>All Products (<span id="prod-count">${PRODUCTS.length}</span>)</h3><button class="btn-add" onclick="resetProductForm();document.getElementById('pf-name').focus()">+ Add New</button></div>
      <table class="a-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody id="prod-tbody">${renderProdRows()}</tbody>
      </table></div>`;
}

function renderProdRows(){
  return PRODUCTS.map(p=>`
    <tr id="prow-${p.id}">
      <td><span style="margin-right:7px;font-size:16px">${p.e}</span>${p.name}</td>
      <td><span class="badge bg-gray">${p.cat}</span></td>
      <td>₱${p.price.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td><span class="badge ${p.stock===0?'bg-red':p.stock<30?'bg-amber':'bg-green'}">${p.stock}</span></td>
      <td>${p.stock===0?'<span class="badge bg-red">Out of Stock</span>':p.stock<30?'<span class="badge bg-amber">Low Stock</span>':'<span class="badge bg-green">In Stock</span>'}</td>
      <td><button class="btn-edit" onclick="editProduct(${p.id})">✏️ Edit</button><button class="btn-del" onclick="deleteProduct(${p.id})">🗑 Del</button></td>
    </tr>`).join('');
}

/* Reads a selected JPEG file into a base64 data URL for the product image preview + payload */
/* Reads a selected JPEG file, downsizes it on a canvas, and re-encodes it as a
   compressed JPEG data URL (keeps payloads small so the request doesn't get
   dropped for being too large — raw phone/screenshot images can be several MB). */
function onProductImageSelected(e){
  const file=e.target.files[0];
  if(!file) return;
  const isJpeg = file.type==='image/jpeg' || /\.jpe?g$/i.test(file.name);
  if(!isJpeg){ showToast('❌ Please select a JPEG image.'); e.target.value=''; return; }

  const img=new Image();
  const objectUrl=URL.createObjectURL(file);
  img.onload=()=>{
    const MAX_DIM=800;
    let {width,height}=img;
    if(width>height && width>MAX_DIM){ height=Math.round(height*(MAX_DIM/width)); width=MAX_DIM; }
    else if(height>MAX_DIM){ width=Math.round(width*(MAX_DIM/height)); height=MAX_DIM; }
    const canvas=document.createElement('canvas');
    canvas.width=width; canvas.height=height;
    canvas.getContext('2d').drawImage(img,0,0,width,height);
    pfImageData=canvas.toDataURL('image/jpeg',0.72); // re-encoded, compressed JPEG — typically tens of KB
    URL.revokeObjectURL(objectUrl);
    const prev=document.getElementById('pf-image-preview');
    if(prev) prev.innerHTML=`<img src="${pfImageData}" style="width:100%;height:100%;object-fit:cover">`;
  };
  img.onerror=()=>{ URL.revokeObjectURL(objectUrl); showToast('❌ Could not read that image.'); e.target.value=''; };
  img.src=objectUrl;
}

function updateProdCount(){
  const cnt=document.getElementById('prod-count');
  if(cnt) cnt.textContent=PRODUCTS.length;
}

async function saveProduct(){
  const name=document.getElementById('pf-name').value.trim();
  const cat=document.getElementById('pf-cat').value;
  const price=parseFloat(document.getElementById('pf-price').value);
  const stock=parseInt(document.getElementById('pf-stock').value);
  const emoji=document.getElementById('pf-emoji').value||'💄';
  const desc=document.getElementById('pf-desc').value.trim();
  if(!name||!price||isNaN(stock)){showToast('❌ Please fill in all required fields.');return;}
  const payload={name,category:cat,price,stock,emoji,description:desc};
  if(pfImageData) payload.image_url=pfImageData; // only sent when admin picked a new JPEG; leaves existing image untouched otherwise
  try {
    if(editingProductId){
      await apiFetch('/products/'+editingProductId, { method:'PUT', body: JSON.stringify(payload) });
      showToast('✅ Product updated!');
    } else {
      await apiFetch('/products', { method:'POST', body: JSON.stringify({...payload, badge:''}) });
      showToast('✅ Product added!');
    }
    await loadProducts();
  } catch(e){ showToast('⚠️ '+e.message); return; }
  resetProductForm();
  document.getElementById('prod-tbody').innerHTML=renderProdRows();
  updateProdCount();
}

function editProduct(id){
  const p=PRODUCTS.find(x=>x.id===id);if(!p)return;
  editingProductId=id;
  pfImageData=null;
  document.getElementById('prod-form-title').textContent='✏️ Edit Product';
  document.getElementById('pf-name').value=p.name;
  document.getElementById('pf-cat').value=p.cat;
  document.getElementById('pf-price').value=p.price;
  document.getElementById('pf-stock').value=p.stock;
  document.getElementById('pf-emoji').value=p.e;
  document.getElementById('pf-desc').value=p.desc;
  const imgInput=document.getElementById('pf-image'); if(imgInput) imgInput.value='';
  const prev=document.getElementById('pf-image-preview');
  if(prev) prev.innerHTML = p.image ? `<img src="${p.image}" style="width:100%;height:100%;object-fit:cover">` : `<span style="font-size:26px">${p.e||'💄'}</span>`;
  document.getElementById('prod-form-card').scrollIntoView({behavior:'smooth'});
}

async function deleteProduct(id){
  if(!confirm('Delete this product? This cannot be undone.'))return;
  try {
    await apiFetch('/products/'+id, { method:'DELETE' });
    await loadProducts();
  } catch(e){ showToast('⚠️ '+e.message); return; }
  document.getElementById('prod-tbody').innerHTML=renderProdRows();
  updateProdCount();
  showToast('🗑 Product deleted.');
}

function resetProductForm(){
  editingProductId=null;
  pfImageData=null;
  document.getElementById('prod-form-title').textContent='➕ Add New Product';
  ['pf-name','pf-price','pf-stock','pf-desc'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('pf-emoji').value='💄';
  const imgInput=document.getElementById('pf-image'); if(imgInput) imgInput.value='';
  const prev=document.getElementById('pf-image-preview'); if(prev) prev.innerHTML='<span style="font-size:26px">💄</span>';
}

/* ORDERS */
function buildOrders(){
  const pend=ORDERS_DATA.filter(o=>o.status==='Pending').length;
  const proc=ORDERS_DATA.filter(o=>o.status==='Processing').length;
  const ship=ORDERS_DATA.filter(o=>o.status==='Shipped').length;
  const deliv=ORDERS_DATA.filter(o=>o.status==='Delivered').length;
  document.getElementById('ap-orders').innerHTML=`<div class="a-title">🛒 Order Management</div>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-icon">📋</div><div class="kpi-label">Total Orders</div><div class="kpi-val">${ORDERS_DATA.length}</div></div>
      <div class="kpi"><div class="kpi-icon">⏳</div><div class="kpi-label">Pending</div><div class="kpi-val dn">${pend}</div></div>
      <div class="kpi"><div class="kpi-icon">🔄</div><div class="kpi-label">Processing</div><div class="kpi-val" style="color:#D97706">${proc}</div></div>
      <div class="kpi"><div class="kpi-icon">✅</div><div class="kpi-label">Delivered</div><div class="kpi-val up">${deliv}</div></div>
    </div>
    <div class="tbl-wrap"><div class="tbl-head"><h3>All Orders</h3><button class="btn-add" onclick="showToast('📥 Exporting orders...')">Export CSV</button></div>
      <table class="a-table" style="table-layout:fixed;width:100%">
        <thead><tr><th style="width:90px">Order ID</th><th style="width:120px">Customer</th><th>Items</th><th style="width:85px">Total</th><th style="width:60px">Date</th><th style="width:95px">Status</th><th style="width:120px">Update Status</th></tr></thead>
        <tbody id="orders-tbody">${renderOrderRows()}</tbody>
      </table></div>`;
}

function renderOrderRows(){
  return ORDERS_DATA.map(o=>`
    <tr id="ord-row-${o.id}">
      <td style="font-weight:600;color:var(--admin-accent)">${o.id}</td>
      <td>${o.customer}</td>
      <td style="font-size:11px;color:#64748B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.items}</td>
      <td>₱${o.total.toLocaleString()}</td>
      <td>${o.date}</td>
      <td id="ord-badge-${o.id}"><span class="badge ${o.status==='Delivered'?'bg-green':o.status==='Shipped'?'bg-blue':o.status==='Processing'?'bg-amber':'bg-gray'}">${statusLabel(o.status)}</span></td>
      <td>
        <select style="font-size:11px;border:1px solid #E2E8F0;border-radius:6px;padding:4px 6px;width:100%;outline:none" onchange="updateOrderStatus('${o.id}',this.value)">
          ${['Pending','Processing','Shipped','Delivered'].map(s=>`<option value="${s}" ${s===o.status?'selected':''}>${statusLabel(s)}</option>`).join('')}
        </select>
      </td>
    </tr>`).join('');
}

async function updateOrderStatus(orderId,newStatus){
  const order=ORDERS_DATA.find(o=>o.id===orderId);
  if(!order||order.status===newStatus)return;
  try {
    await apiFetch('/orders/'+order.dbId+'/status', { method:'PATCH', body: JSON.stringify({ status: newStatus }) });
    await loadOrders(); // refreshes ORDERS_DATA for admin
  } catch(e){ showToast('⚠️ '+e.message); return; }
  showToast('✅ Order '+orderId+' → '+statusLabel(newStatus)+'. Customer notified.');
  buildOrders();
}

/* CUSTOMERS */
function buildCustomers(){
  const loyal=CUSTOMERS_DATA.filter(c=>c.seg==='Loyal');
  const occ=CUSTOMERS_DATA.filter(c=>c.seg==='Occasional');
  const nw=CUSTOMERS_DATA.filter(c=>c.seg==='New');
  document.getElementById('ap-customers').innerHTML=`<div class="a-title">👥 Customer Analysis</div>
    <div class="seg-grid">
      <div class="seg-card"><div class="seg-num" style="color:#C2607E">${loyal.length}</div><div class="seg-lbl">Loyal Customers</div><div class="seg-rule">5 or more orders</div></div>
      <div class="seg-card"><div class="seg-num" style="color:#B8944A">${occ.length}</div><div class="seg-lbl">Occasional Buyers</div><div class="seg-rule">2 to 4 orders</div></div>
      <div class="seg-card"><div class="seg-num" style="color:#4F7EF7">${nw.length}</div><div class="seg-lbl">New Customers</div><div class="seg-rule">First order only</div></div>
    </div>
    <div class="tbl-wrap"><div class="tbl-head"><h3>Customer List</h3><button class="btn-add" onclick="showToast('📥 Exporting customer list...')">Export CSV</button></div>
      <table class="a-table"><thead><tr><th>Name</th><th>Email</th><th>Total Orders</th><th>Total Spent</th><th>Segment</th><th>Actions</th></tr></thead>
      <tbody>${CUSTOMERS_DATA.map(c=>`
        <tr>
          <td style="font-weight:500">${c.name}</td>
          <td style="color:#64748B;font-size:12px">${c.email}</td>
          <td>${c.orders}</td>
          <td>₱${c.total.toLocaleString()}</td>
          <td><span class="badge ${c.seg==='Loyal'?'bg-green':c.seg==='Occasional'?'bg-amber':'bg-blue'}">${c.seg}</span></td>
          <td><button class="btn-edit" onclick="showToast('📧 Email sent to ${c.name}')">📧 Email</button></td>
        </tr>`).join('')}
      </tbody></table></div>`;
}

/* PENDING APPROVALS */
async function buildApprovals(){
  const el=document.getElementById('ap-approvals');
  el.innerHTML=`<div class="a-title">✅ Pending Approvals</div>
    <div class="tbl-wrap"><div class="tbl-head"><h3>Customer Signups Awaiting Approval</h3></div>
      <table class="a-table"><thead><tr><th>Name</th><th>Email</th><th>Signed Up</th><th>Actions</th></tr></thead>
      <tbody id="appr-tbody"><tr><td colspan="4" style="text-align:center;color:#64748B">Loading…</td></tr></tbody></table></div>`;
  let pending;
  try {
    pending = await apiFetch('/auth/pending-customers');
  } catch(e) { showToast('⚠️ '+e.message); document.getElementById('appr-tbody').innerHTML='<tr><td colspan="4" style="text-align:center;color:#64748B">Could not load pending approvals.</td></tr>'; return; }
  renderApprovalRows(pending);
}

function renderApprovalRows(pending){
  const tbody=document.getElementById('appr-tbody');
  if(!tbody) return;
  if(!pending.length){ tbody.innerHTML='<tr><td colspan="4" style="text-align:center;color:#64748B">No pending signups 🎉</td></tr>'; return; }
  tbody.innerHTML=pending.map(u=>`
    <tr id="appr-row-${u.id}">
      <td style="font-weight:500">${u.name}</td>
      <td style="color:#64748B;font-size:12px">${u.email}</td>
      <td style="color:#64748B;font-size:12px">${u.created_at?formatOrderDate(u.created_at):''}</td>
      <td><button class="btn-save-inline" onclick="approveCustomer(${u.id})">✔ Approve</button><button class="btn-del" style="margin-left:4px" onclick="rejectCustomer(${u.id})">✕ Reject</button></td>
    </tr>`).join('');
}

async function approveCustomer(id){
  try { await apiFetch('/auth/approve/'+id, { method:'POST' }); } catch(e){ showToast('⚠️ '+e.message); return; }
  document.getElementById('appr-row-'+id)?.remove();
  showToast('✅ Customer approved');
  buildApprovals();
}

async function rejectCustomer(id){
  if(!confirm('Reject this signup?')) return;
  try { await apiFetch('/auth/reject/'+id, { method:'POST' }); } catch(e){ showToast('⚠️ '+e.message); return; }
  document.getElementById('appr-row-'+id)?.remove();
  showToast('🗑 Signup rejected');
  buildApprovals();
}

/* INVENTORY */
function buildInventory(){
  const totalUnits=PRODUCTS.reduce((s,p)=>s+p.stock,0);
  const lowStock=PRODUCTS.filter(p=>p.stock<30&&p.stock>0);
  const outStock=PRODUCTS.filter(p=>p.stock===0);
  document.getElementById('ap-inventory').innerHTML=`<div class="a-title">📦 Inventory Management</div>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-icon">💄</div><div class="kpi-label">Total Products</div><div class="kpi-val">${PRODUCTS.length}</div></div>
      <div class="kpi"><div class="kpi-icon">⚠️</div><div class="kpi-label">Low Stock</div><div class="kpi-val dn">${lowStock.length}</div></div>
      <div class="kpi"><div class="kpi-icon">❌</div><div class="kpi-label">Out of Stock</div><div class="kpi-val dn">${outStock.length}</div></div>
      <div class="kpi"><div class="kpi-icon">📊</div><div class="kpi-label">Total Units</div><div class="kpi-val">${totalUnits.toLocaleString()}</div></div>
    </div>
    ${lowStock.length||outStock.length?`<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#B91C1C;font-weight:500">⚠️ ${lowStock.length} products are low on stock and ${outStock.length} are out of stock. Please reorder.</div>`:''}
    <div class="tbl-wrap"><div class="tbl-head"><h3>Stock Levels</h3><button class="btn-add" onclick="showToast('📥 Inventory report exported!')">Export CSV</button></div>
      <table class="a-table"><thead><tr><th>Product</th><th>Category</th><th>Current Stock</th><th>Level</th><th>Status</th><th>Reorder Qty</th><th>Action</th></tr></thead>
      <tbody id="inv-tbody">${renderInvRows()}</tbody></table></div>`;
}

function renderInvRows(){
  return PRODUCTS.map(p=>{
    const color=p.stock===0?'#DC2626':p.stock<30?'#D97706':'#16A34A';
    const pct=Math.min(Math.round(p.stock/200*100),100);
    return`<tr id="inv-row-${p.id}">
      <td><span style="font-size:15px;margin-right:7px">${p.e}</span><span style="font-weight:500">${p.name}</span></td>
      <td>${p.cat}</td>
      <td><input type="number" value="${p.stock}" id="inv-qty-${p.id}" style="width:65px;border:1px solid #E2E8F0;border-radius:6px;padding:4px 7px;font-size:12px;font-family:'DM Sans',sans-serif"></td>
      <td style="min-width:90px"><div class="inv-bar-wrap"><div class="inv-bar" style="width:${pct}%;background:${color}"></div></div></td>
      <td><span class="badge ${p.stock===0?'bg-red':p.stock<30?'bg-amber':'bg-green'}">${p.stock===0?'Out of Stock':p.stock<30?'Low Stock':'In Stock'}</span></td>
      <td>${p.stock<30?`<input type="number" value="100" id="inv-reorder-${p.id}" style="width:60px;border:1px solid #E2E8F0;border-radius:6px;padding:4px 7px;font-size:12px;font-family:'DM Sans',sans-serif">`:'—'}</td>
      <td>
        <button class="btn-save-inline" onclick="updateStock(${p.id})">Update</button>
        ${p.stock<30?`<button class="btn-edit" style="margin-left:4px" onclick="reorderStock(${p.id})">Reorder</button>`:''}
      </td>
    </tr>`;}).join('');
}

async function updateStock(id){
  const p=PRODUCTS.find(x=>x.id===id);if(!p)return;
  const newQty=parseInt(document.getElementById('inv-qty-'+id).value);
  if(isNaN(newQty)||newQty<0){showToast('❌ Invalid quantity.');return;}
  try {
    await apiFetch('/products/'+id, { method:'PUT', body: JSON.stringify({ stock: newQty }) });
    await loadProducts();
  } catch(e){ showToast('⚠️ '+e.message); return; }
  document.getElementById('inv-tbody').innerHTML=renderInvRows();
  showToast('✅ Stock updated for '+p.name);
}

async function reorderStock(id){
  const p=PRODUCTS.find(x=>x.id===id);if(!p)return;
  const qty=parseInt(document.getElementById('inv-reorder-'+id)?.value)||100;
  try {
    await apiFetch('/products/'+id, { method:'PUT', body: JSON.stringify({ stock: p.stock + qty }) });
    await loadProducts();
  } catch(e){ showToast('⚠️ '+e.message); return; }
  document.getElementById('inv-tbody').innerHTML=renderInvRows();
  showToast('✅ Reordered '+qty+' units of '+p.name);
}

/* ═══ REVIEW ═══ */
function submitReview(oid,starClicked){
  const row=document.getElementById('revrow-'+oid);
  if(!row)return;
  const stars=row.querySelectorAll('.rev-star');
  let rating=0;
  stars.forEach((s,i)=>{if(s.classList.contains('selected'))rating=i+1;});
  if(starClicked>0){
    stars.forEach((s,i)=>{s.textContent=i<starClicked?'★':'☆';s.classList.toggle('selected',i<starClicked);s.classList.toggle('on',i<starClicked);});
    rating=starClicked;
  }
  if(rating===0){showToast('Please select a star rating first.');return;}
  document.getElementById('rev-done-'+oid).style.display='block';
  document.querySelector('#revrow-'+oid).closest('.review-prompt').querySelector('.review-submit').style.display='none';
  showToast('⭐ Thank you for your review!');
}

/* ═══ MY STATS ═══ */
function renderStats(){
  const body=document.getElementById('stats-body');
  if(!body)return;
  const totalSpent=myOrders.reduce((s,o)=>s+o.total,0);
  const cats={};
  myOrders.forEach(o=>{
    const names=o.items.split(',');
    names.forEach(nm=>{
      const p=PRODUCTS.find(x=>x.name===nm.trim());
      if(p)cats[p.cat]=(cats[p.cat]||0)+p.price;
    });
  });
  body.innerHTML=`
    <div class="stats-kpi">
      <div class="sk"><div class="sk-icon">💰</div><div class="sk-lbl">Total Spent</div><div class="sk-val">₱${totalSpent.toLocaleString('en-PH',{minimumFractionDigits:2})}</div></div>
      <div class="sk"><div class="sk-icon">📦</div><div class="sk-lbl">Total Orders</div><div class="sk-val">${myOrders.length}</div></div>
      <div class="sk"><div class="sk-icon">⭐</div><div class="sk-lbl">Loyalty Points</div><div class="sk-val">${loyaltyPoints}</div></div>
    </div>
    <div class="stats-charts">
      <div class="sc"><h3>Spending by Category</h3><div style="position:relative;height:180px"><canvas id="ch-cust-cat"></canvas></div></div>
      <div class="sc"><h3>Order History</h3><div style="position:relative;height:180px"><canvas id="ch-cust-ord"></canvas></div></div>
    </div>
    ${myOrders.length===0?`<div class="empty-state"><div class="empty-icon">📊</div><h3>No data yet</h3><p>Place your first order to see your spending analytics here!</p><button onclick="cPage('shop',document.getElementById('cnav-shop'))">Start Shopping →</button></div>`:''}
  `;
  if(myOrders.length>0){
    const catLabels=Object.keys(cats);
    const catVals=catLabels.map(k=>parseFloat(cats[k].toFixed(2)));
    new Chart(document.getElementById('ch-cust-cat'),{type:'doughnut',data:{labels:catLabels,datasets:[{data:catVals,backgroundColor:['#C2607E','#B8944A','#4A8C5C','#4F7EF7','#A03030'],borderWidth:0,hoverOffset:6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:11}}}}}});
    const ordLabels=myOrders.slice().reverse().map(o=>o.id);
    const ordVals=myOrders.slice().reverse().map(o=>o.total);
    new Chart(document.getElementById('ch-cust-ord'),{type:'bar',data:{labels:ordLabels,datasets:[{data:ordVals,backgroundColor:'rgba(194,96,126,0.75)',borderRadius:6,label:'₱'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>'₱'+v.toLocaleString()},grid:{color:'#F1F5F9'}}}}});
  }
}


/* ═══ MEGA MENU ═══ */
function setCat(cat){
  activeCat=cat;
  cPage('shop',document.getElementById('cnav-shop'));
  // update category strip
  document.querySelectorAll('.cat-strip-item').forEach(el=>{
    el.classList.toggle('on',el.textContent.trim()===cat||el.dataset.cat===cat);
  });
  renderProducts();
  document.getElementById('section-title').textContent=cat;
}
function filterBadge(badge){
  cPage('shop',document.getElementById('cnav-shop'));
  activeCat='All';
  document.querySelectorAll('.cat-strip-item').forEach(el=>el.classList.remove('on'));
  const grid=document.getElementById('products-grid');
  const q='';
  const list=PRODUCTS.filter(p=>p.badge===badge);
  if(!list.length){grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:64px;color:var(--v-muted)"><div style="font-size:44px;margin-bottom:12px">'+(badge==='hot'?'🔥':'✨')+'</div><p>No products found.</p></div>';return;}
  grid.innerHTML=list.map(p=>{
    const inWL=wishlist.includes(p.id);
    const r=productRatings[p.id];
    const starsHtml=r?[1,2,3,4,5].map(i=>`<span class="s${i<=Math.round(parseFloat(r.avg))?' on':''}">${i<=Math.round(parseFloat(r.avg))?'★':'☆'}</span>`).join('')+'<span class="p-rating-txt">('+r.count+')</span>':'';
    const badgeHtml=p.badge==='hot'?'<span class="p-badge">🔥 Hot</span>':p.badge==='new'?'<span class="p-badge new">✨ New</span>':'';
    return`<div class="p-card" onclick="openProductModal(${p.id})">${badgeHtml}<div class="p-img">${productImgHtml(p)}<button class="p-wishlist" onclick="event.stopPropagation();toggleWishlist(${p.id})">${inWL?'❤️':'♡'}</button></div><div class="p-info">${r?`<div class="p-stars-row">${starsHtml}</div>`:''}<div class="p-name">${p.name}</div><div class="p-cat">${p.cat}</div><div class="p-price-row"><div class="p-price">₱${p.price.toLocaleString('en-PH',{minimumFractionDigits:2})}</div></div><div class="p-stock ${p.stock===0?'low':''}">${p.stock===0?'Out of stock':p.stock+' in stock'}</div><button class="p-add" onclick="event.stopPropagation();addCart(${p.id})" ${p.stock===0?'disabled':''}>🛒 Add to Cart</button></div></div>`;
  }).join('');
  document.getElementById('section-title').textContent=badge==='hot'?'🔥 Best Sellers':'✨ New Arrivals';
}
function triggerFlashSale(){
  cPage('shop',document.getElementById('cnav-shop'));
  // Filter products with a discount feel: show all sorted by price asc
  activeCat='All';
  const list=[...PRODUCTS].sort((a,b)=>a.price-b.price);
  const grid=document.getElementById('products-grid');
  grid.innerHTML=list.map(p=>{
    const inWL=wishlist.includes(p.id);
    const r=productRatings[p.id];
    const starsHtml=r?[1,2,3,4,5].map(i=>`<span class="s${i<=Math.round(parseFloat(r.avg))?' on':''}">${i<=Math.round(parseFloat(r.avg))?'★':'☆'}</span>`).join('')+'<span class="p-rating-txt">('+r.count+')</span>':'';
    return`<div class="p-card" style="border:2px solid #D4A853" onclick="openProductModal(${p.id})"><span class="p-badge" style="background:#D4A853">⚡ Sale</span><div class="p-img">${productImgHtml(p)}<button class="p-wishlist" onclick="event.stopPropagation();toggleWishlist(${p.id})">${inWL?'❤️':'♡'}</button></div><div class="p-info">${r?`<div class="p-stars-row">${starsHtml}</div>`:''}<div class="p-name">${p.name}</div><div class="p-cat">${p.cat}</div><div class="p-price-row"><div class="p-price"><span style="text-decoration:line-through;font-size:11px;color:var(--v-muted);font-family:Jost">₱${(p.price*1.15).toFixed(0)}</span> ₱${p.price.toLocaleString('en-PH',{minimumFractionDigits:2})}</div></div><div class="p-stock ${p.stock===0?'low':''}">${p.stock===0?'Out of stock':p.stock+' in stock'}</div><button class="p-add" onclick="event.stopPropagation();addCart(${p.id})" ${p.stock===0?'disabled':''}>🛒 Add to Cart</button></div></div>`;
  }).join('');
  document.getElementById('section-title').textContent='⚡ Flash Sale';
}
function setCatAll(){
  activeCat='All';
  document.querySelectorAll('.cat-strip-item').forEach(el=>el.classList.remove('on'));
  if(document.querySelector('.cat-strip-item'))document.querySelector('.cat-strip-item').classList.add('on');
  renderProducts();
  document.getElementById('section-title').textContent='All Products';
}
/* ═══ MEGA MENU — robust hover with 220ms close-delay ═══ */
(function(){
  const DELAY = 220; // ms grace period for cursor to travel into panel

  let closeTimer = null;
  let currentOpen = null;

  function openMenu(item) {
    // cancel any pending close
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }

    // close previously open item (if different)
    if (currentOpen && currentOpen !== item) {
      currentOpen.classList.remove('open');
      const oldPanel = currentOpen.querySelector('.mega-panel');
      if (oldPanel) oldPanel.classList.remove('open');
    }

    currentOpen = item;
    item.classList.add('open');
    const panel = item.querySelector('.mega-panel');
    if (panel) panel.classList.add('open');
    document.getElementById('mega-overlay').classList.add('on');
  }

  function scheduleClose(item) {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(function() {
      // Only close if the cursor isn't inside the item or its panel right now
      if (currentOpen === item) {
        item.classList.remove('open');
        const panel = item.querySelector('.mega-panel');
        if (panel) panel.classList.remove('open');
        currentOpen = null;
        document.getElementById('mega-overlay').classList.remove('on');
      }
      closeTimer = null;
    }, DELAY);
  }

  function cancelClose() {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  }

  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.mn-item').forEach(function(item) {
      const panel = item.querySelector('.mega-panel');

      // trigger open on nav button hover
      item.addEventListener('mouseenter', function() { openMenu(item); });

      // start close timer when leaving the nav item wrapper
      item.addEventListener('mouseleave', function(e) {
        // if moving into the panel itself, don't close
        const to = e.relatedTarget;
        if (panel && panel.contains(to)) { cancelClose(); return; }
        scheduleClose(item);
      });

      // keep open while inside the panel
      if (panel) {
        panel.addEventListener('mouseenter', function() { cancelClose(); });
        panel.addEventListener('mouseleave', function(e) {
          // if moving back to the nav item, don't close
          const to = e.relatedTarget;
          if (item.contains(to)) { cancelClose(); return; }
          scheduleClose(item);
        });
      }
    });

    // close on overlay click
    const overlay = document.getElementById('mega-overlay');
    if (overlay) overlay.addEventListener('click', function() {
      if (currentOpen) {
        currentOpen.classList.remove('open');
        const panel = currentOpen.querySelector('.mega-panel');
        if (panel) panel.classList.remove('open');
        currentOpen = null;
      }
      overlay.classList.remove('on');
    });

    // close on Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && currentOpen) {
        currentOpen.classList.remove('open');
        const panel = currentOpen.querySelector('.mega-panel');
        if (panel) panel.classList.remove('open');
        currentOpen = null;
        document.getElementById('mega-overlay').classList.remove('on');
      }
    });
  });
})();

function closeAllMega(){
  document.querySelectorAll('.mn-item').forEach(function(item){
    item.classList.remove('open');
    const panel = item.querySelector('.mega-panel');
    if(panel) panel.classList.remove('open');
  });
  document.getElementById('mega-overlay').classList.remove('on');
}

/* ═══ INFO MODALS (About, Contact, FAQ, Product Description/Ingredients/How to Use/Benefits) ═══ */
const INFO_MODAL_CONTENT = {
  description: {
    title: 'Product Description',
    body: `<p>GV Cosmetics offers a curated line of hair care and styling essentials — from styling gels and sprays to treatment products — crafted for everyday salon-quality results.</p>
           <p>Each product listing includes a full description with its intended use, key features, and net weight/volume. Open any product card in the shop to see its specific description.</p>`
  },
  ingredients: {
    title: 'Ingredients',
    body: `<p>Full ingredient lists are printed on each product's packaging and are also available on the individual product page in the shop.</p>
           <p>Our formulas are developed with salon professionals and are free from harsh sulfates where possible. If you have a specific allergy or sensitivity, please check the product packaging or contact our support team before use.</p>`
  },
  howtouse: {
    title: 'How to Use',
    body: `<ol style="padding-left:18px;line-height:1.9">
             <li>Start with clean, towel-dried or dry hair depending on the product type.</li>
             <li>Apply a small amount evenly, working from roots to ends (or as directed on the label).</li>
             <li>Style as desired with a comb, brush, or your fingers.</li>
             <li>For sprays, hold the can 20–30cm from hair and apply in short bursts.</li>
           </ol>
           <p>Always check the specific instructions on your product's packaging, as usage can vary between gels, sprays, and treatments.</p>`
  },
  benefits: {
    title: 'Benefits',
    body: `<ul style="padding-left:18px;line-height:1.9">
             <li>💇 Long-lasting hold and style control</li>
             <li>✨ Adds shine without weighing hair down</li>
             <li>🌿 Lightweight, non-greasy formulas</li>
             <li>💧 Easy to wash out with regular shampoo</li>
             <li>🏆 Trusted, salon-tested formulations</li>
           </ul>`
  },
  about: {
    title: 'About Us',
    body: `<p>GV Cosmetics is a hair care and styling brand based in Cagayan de Oro, proudly serving customers with quality, affordable products for every hair type and style.</p>
           <p>What started as a small local supplier has grown into a trusted name for stylists and everyday customers alike, offering gels, sprays, treatments, and more — all backed by real customer reviews and ratings.</p>`
  },
  contact: {
    title: 'Contact Us',
    body: `<p>We'd love to hear from you! Reach us through any of the following:</p>
           <p>📍 Based in Cagayan de Oro, Philippines<br>
           🕘 Mon–Sat, 9:00 AM – 6:00 PM<br>
           📧 support@gvcosmetics.com<br>
           📞 (Add your business contact number here)</p>
           <p>You can also reach out through your account's order page for order-specific questions.</p>`
  },
  faq: {
    title: 'Frequently Asked Questions',
    body: `<p><strong>How long does delivery take?</strong><br>Delivery times vary by location; you can track your order status anytime from the "My Orders" page.</p>
           <p><strong>Can I change or cancel my order?</strong><br>Contact us as soon as possible after placing your order — changes can only be made before it ships.</p>
           <p><strong>How do I earn loyalty points?</strong><br>Loyalty points are automatically added to your account with every completed purchase.</p>
           <p><strong>What if a product arrives damaged?</strong><br>Please contact our support team with your order number and a photo of the item within 7 days of delivery.</p>`
  }
};

function openModal(key){
  const data = INFO_MODAL_CONTENT[key];
  if(!data) return;
  document.getElementById('im-title').textContent = data.title;
  document.getElementById('im-body').innerHTML = data.body;
  document.getElementById('info-modal-bg').classList.add('open');
}

function closeModal(e){
  // If triggered by clicking the background, only close when the background itself (not the modal box) was clicked
  if(e && e.target && e.target.id !== 'info-modal-bg' && e.type === 'click' && e.target.closest('#info-modal')) return;
  document.getElementById('info-modal-bg').classList.remove('open');
}

/* ═══ PRODUCT QUICK VIEW ═══ */
function openProductModal(id){
  const p=PRODUCTS.find(x=>x.id===id);if(!p)return;
  const inWL=wishlist.includes(p.id);
  const r=productRatings[p.id];
  const starsHtml=r?[1,2,3,4,5].map(i=>`<span class="s${i<=Math.round(parseFloat(r.avg))?' on':''}">${i<=Math.round(parseFloat(r.avg))?'★':'☆'}</span>`).join('')+' <span class="p-rating-txt">('+r.count+')</span>':'';
  const stockClass=p.stock===0?'out':p.stock<30?'low':'ok';
  const stockText=p.stock===0?'Out of stock':p.stock<30?'⚠️ Only '+p.stock+' left in stock':p.stock+' in stock';
  document.getElementById('pm-body').innerHTML=`
    <div class="pm-img-wrap">${productImgHtml(p,120)}</div>
    <div class="pm-details">
      <div class="pm-cat">${p.cat}</div>
      <div class="pm-name">${p.name}</div>
      ${r?`<div class="pm-stars-row">${starsHtml}</div>`:''}
      <div class="pm-price">₱${p.price.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
      <div class="pm-desc">${p.desc||'No description available.'}</div>
      <div class="pm-stock ${stockClass}">${stockText}</div>
      <div class="pm-actions">
        <button class="pm-add-btn" onclick="addCart(${p.id})" ${p.stock===0?'disabled':''}>${p.stock===0?'Out of Stock':'🛒 Add to Cart'}</button>
        <button class="pm-wl-btn" onclick="toggleWishlist(${p.id});openProductModal(${p.id})">${inWL?'❤️':'♡'}</button>
      </div>
    </div>`;
  document.getElementById('pm-modal-bg').classList.add('open');
}

function closeProductModal(e){
  if(e && e.target && e.target.id !== 'pm-modal-bg' && e.type === 'click' && e.target.closest('#pm-modal')) return;
  document.getElementById('pm-modal-bg').classList.remove('open');
}

/* ═══ SESSION RESTORE (keeps you logged in across page refreshes) ═══ */
async function tryRestoreSession(){
  if(!authToken)return;
  let acc;
  try { acc = await apiFetch('/auth/me'); }
  catch(e){ authToken=null; localStorage.removeItem('gvci_token'); return; }

  currentUser = acc;
  loyaltyPoints = acc.loyalty_points || 0;
  displayName = acc.name;

  document.getElementById('screen-login').classList.add('hidden');
  if(acc.role==='customer'){
    document.getElementById('screen-customer').classList.remove('hidden');
    document.getElementById('c-avatar').textContent=acc.initials;
    document.getElementById('prof-avatar-big').textContent=acc.initials;
    document.getElementById('c-username').textContent=acc.name.split(' ')[0];
    try {
      await Promise.all([loadProducts(), loadWishlist(), loadOrders(), loadAddresses(), loadNotifications()]);
    } catch(e){ showToast('⚠️ Could not reach the server.'); }
    buildShop();renderAddrList();buildRecommendations();updateWishlistBadge();updateNotifBell();
  } else {
    document.getElementById('screen-admin').classList.remove('hidden');
    try {
      await Promise.all([loadProducts(), loadOrders(), loadCustomers()]);
    } catch(e){ showToast('⚠️ Could not reach the server.'); }
    buildAdminAll();
  }
}
tryRestoreSession();