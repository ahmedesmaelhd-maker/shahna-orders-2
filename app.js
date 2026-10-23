(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    sb: null, user: null, profile: null, orders: [], customers: [],
    page: 'dashboard', authMode: 'login', realtimeChannel: null,
    selectedCustomer: null, refreshPromise: null, printFormat: 'label', pendingPrintOrder: null
  };
  const STATUS = ['جديد', 'قيد التجهيز', 'تم الشحن', 'تم التسليم', 'مرتجع', 'ملغي'];
  const STATUS_CLASS = {
    'جديد': 'status-new', 'قيد التجهيز': 'status-prep', 'تم الشحن': 'status-shipped',
    'تم التسليم': 'status-delivered', 'مرتجع': 'status-returned', 'ملغي': 'status-cancelled'
  };
  const PAGE_TITLES = { dashboard: 'لوحة التحكم', orders: 'الطلبات', customers: 'العملاء', reports: 'التقارير', settings: 'إعدادات المتجر' };
  const DEFAULT_CONFIG = window.SHAHNA_CONFIG || {};
  const CONFIG_STORAGE_KEY = 'shahna_cloud_config_v1';
  const moneyFormatter = new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function safeText(value, fallback = '—') { return value === null || value === undefined || String(value).trim() === '' ? fallback : esc(value); }
  function money(value) { return `${moneyFormatter.format(Number(value || 0))} ج.م`; }
  function moneyCompact(value) { return `${moneyFormatter.format(Number(value || 0))} <small>ج.م</small>`; }
  function dateShort(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('ar-EG', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  }
  function dateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
  function localDayKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function initials(name) {
    const parts = String(name || 'م').trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0]?.slice(0, 1) || 'م').toUpperCase();
  }
  function getConfig() {
    try {
      const stored = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || 'null');
      if (stored?.supabaseUrl && stored?.supabasePublishableKey) return stored;
    } catch { /* ignore malformed local configuration */ }
    return DEFAULT_CONFIG;
  }
  function isConfigured(config = getConfig()) {
    return Boolean(config?.supabaseUrl && config?.supabasePublishableKey && /^https:\/\//i.test(config.supabaseUrl));
  }
  function showOnly(which) {
    ['setup-screen', 'auth-screen', 'app-shell'].forEach(id => $(`#${id}`).classList.add('hidden'));
    $(`#${which}`).classList.remove('hidden');
    document.body.classList.remove('printing');
    refreshIcons();
  }
  function refreshIcons() { try { window.lucide?.createIcons?.(); } catch { /* icon CDN can be unavailable */ } }
  function toast(title, message = '', type = 'success', duration = 4200) {
    const region = $('#toast-region');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icon = type === 'success' ? 'circle-check' : type === 'error' ? 'circle-alert' : 'info';
    el.innerHTML = `<i data-lucide="${icon}"></i><div><b>${esc(title)}</b>${message ? `<p>${esc(message)}</p>` : ''}</div>`;
    region.appendChild(el); refreshIcons();
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(-8px)'; setTimeout(() => el.remove(), 200); }, duration);
  }
  function setButtonLoading(button, loading, loadingText = 'جاري التنفيذ...') {
    if (!button) return;
    if (loading) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<span class="spinner"></span> ${esc(loadingText)}`;
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
      if (button.id === 'auth-submit') button.innerHTML = state.authMode === 'signup' ? 'إنشاء الحساب <i data-lucide="user-plus"></i>' : 'تسجيل الدخول <i data-lucide="arrow-left"></i>' ;
      refreshIcons();
    }
  }
  function errorMessage(error) {
    const raw = error?.message || String(error || 'حدث خطأ غير متوقع.');
    if (/Failed to fetch|NetworkError|fetch failed/i.test(raw)) return 'تعذّر الاتصال. تأكد من الإنترنت ورابط ومفتاح Supabase.';
    if (/Invalid login credentials/i.test(raw)) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
    if (/Email not confirmed/i.test(raw)) return 'أكد بريدك الإلكتروني من رسالة التفعيل أولًا.';
    if (/relation .* does not exist|Could not find the table/i.test(raw)) return 'جداول قاعدة البيانات غير جاهزة. نفّذ ملف supabase/schema.sql في SQL Editor داخل مشروع Supabase.';
    if (/row-level security|violates row-level security/i.test(raw)) return 'قاعدة البيانات رفضت العملية بسبب سياسات الصلاحيات. راجع ملف schema.sql وإعدادات RLS.';
    if (/duplicate key|unique constraint/i.test(raw)) return 'هناك بيانات مكررة، غالبًا رقم هاتف محفوظ لعميل آخر في نفس الحساب. راجع رقم الهاتف.';
    return raw;
  }
  function toggleSetup() {
    const config = getConfig();
    $('#setup-url').value = config.supabaseUrl || '';
    $('#setup-key').value = config.supabasePublishableKey || '';
    showOnly('setup-screen');
  }
  function configureClient(config) {
    if (!isConfigured(config)) throw new Error('أدخل رابط Supabase صالحًا يبدأ بـ https:// ومفتاح النشر العام.');
    if (/service_role|secret[_-]?key/i.test(config.supabasePublishableKey)) throw new Error('هذا يبدو مفتاحًا سريًا. استخدم Publishable key أو anon public key فقط.');
    if (!window.supabase?.createClient) throw new Error('مكتبة Supabase لم تُحمّل. افتح الموقع مع اتصال بالإنترنت ثم أعد المحاولة.');
    state.sb?.removeAllChannels?.();
    state.sb = window.supabase.createClient(config.supabaseUrl.replace(/\/+$/, ''), config.supabasePublishableKey.trim(), {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { headers: { 'x-application-name': 'shahna-cloud' } }
    });
  }
  async function boot() {
    $('#auth-year').textContent = new Date().getFullYear();
    $('#footer-year').textContent = new Date().getFullYear();
    $('#page-date').textContent = new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    refreshIcons();
    const config = getConfig();
    if (!isConfigured(config)) { toggleSetup(); return; }
    try {
      configureClient(config);
      state.sb.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          showOnly('auth-screen'); $('#recovery-panel').classList.remove('hidden');
          $('#auth-heading-block').classList.add('hidden'); $('#auth-form').classList.add('hidden'); $('.auth-tabs').classList.add('hidden'); $('#forgot-password').classList.add('hidden');
          toast('استعد حسابك', 'أدخل كلمة المرور الجديدة أدناه.', 'info');
          return;
        }
        if (session?.user) {
          void openApp(session.user);
        } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
          state.user = null; state.profile = null; state.orders = []; state.customers = [];
          if (state.realtimeChannel) { state.sb?.removeChannel(state.realtimeChannel); state.realtimeChannel = null; }
          showOnly('auth-screen'); setAuthMode('login');
        }
      });
      const { data, error } = await state.sb.auth.getSession();
      if (error) throw error;
      if (data.session?.user) await openApp(data.session.user);
      else showOnly('auth-screen');
    } catch (error) {
      showOnly('auth-screen');
      toast('تعذر الاتصال', errorMessage(error), 'error', 7000);
    }
  }

  // Authentication
  function setAuthMode(mode) {
    state.authMode = mode;
    $$('.auth-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.authMode === mode));
    const isSignup = mode === 'signup';
    $('#store-name-wrap').classList.toggle('hidden', !isSignup);
    $('#auth-title').textContent = isSignup ? 'أنشئ حساب متجرك' : 'سجّل دخولك';
    $('#auth-subtitle').textContent = isSignup ? 'أنشئ حسابًا لتبدأ حفظ الطلبات على السحابة.' : 'أدخل بيانات حسابك للوصول إلى لوحة المتجر.';
    $('#auth-submit').innerHTML = isSignup ? 'إنشاء الحساب <i data-lucide="user-plus"></i>' : 'تسجيل الدخول <i data-lucide="arrow-left"></i>';
    $('#auth-password').autocomplete = isSignup ? 'new-password' : 'current-password';
    $('#forgot-password').classList.toggle('hidden', isSignup);
    $('#recovery-panel').classList.add('hidden');
    $('#auth-heading-block').classList.remove('hidden'); $('#auth-form').classList.remove('hidden'); $('.auth-tabs').classList.remove('hidden');
    refreshIcons();
  }
  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (!state.sb) return toggleSetup();
    const button = $('#auth-submit');
    const email = $('#auth-email').value.trim().toLowerCase();
    const password = $('#auth-password').value;
    setButtonLoading(button, true, state.authMode === 'signup' ? 'جاري إنشاء الحساب...' : 'جاري تسجيل الدخول...');
    try {
      if (state.authMode === 'signup') {
        const storeName = $('#auth-store').value.trim() || 'متجري';
        const { data, error } = await state.sb.auth.signUp({
          email, password,
          options: { data: { store_name: storeName }, emailRedirectTo: window.location.href.split('#')[0] }
        });
        if (error) throw error;
        if (data.session?.user) {
          toast('تم إنشاء الحساب', 'مرحبًا بك في شَحنة.', 'success');
          await openApp(data.session.user);
        } else {
          toast('راجع بريدك الإلكتروني', 'أرسلنا رابط تفعيل الحساب إذا كان تأكيد البريد مفعّلًا في Supabase.', 'info', 6500);
          setAuthMode('login');
        }
      } else {
        const { data, error } = await state.sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user) await openApp(data.user);
      }
    } catch (error) {
      toast(state.authMode === 'signup' ? 'تعذر إنشاء الحساب' : 'تعذر تسجيل الدخول', errorMessage(error), 'error', 6500);
    } finally { setButtonLoading(button, false); }
  }
  async function sendResetEmail(email) {
    if (!email) { toast('اكتب بريدك الإلكتروني', 'أدخل البريد المستخدم في حسابك أولًا.', 'info'); $('#auth-email').focus(); return; }
    const { error } = await state.sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href.split('#')[0] });
    if (error) throw error;
    toast('تم طلب رابط الاستعادة', 'راجع بريدك الإلكتروني واتبع التعليمات لتغيير كلمة المرور.', 'success', 6500);
  }
  async function handleRecovery(event) {
    event.preventDefault();
    const password = $('#new-password').value;
    if (password.length < 8) return toast('كلمة المرور قصيرة', 'استخدم 8 أحرف على الأقل.', 'error');
    const button = $('#recovery-form button'); setButtonLoading(button, true, 'جاري الحفظ...');
    try {
      const { error } = await state.sb.auth.updateUser({ password });
      if (error) throw error;
      $('#recovery-panel').classList.add('hidden'); $('#auth-heading-block').classList.remove('hidden'); $('#auth-form').classList.remove('hidden'); $('.auth-tabs').classList.remove('hidden'); $('#forgot-password').classList.remove('hidden');
      $('#recovery-form').reset(); toast('تم تغيير كلمة المرور', 'يمكنك الآن استخدام كلمة المرور الجديدة.', 'success');
      const { data } = await state.sb.auth.getUser(); if (data.user) await openApp(data.user);
    } catch (error) { toast('تعذر تغيير كلمة المرور', errorMessage(error), 'error'); }
    finally { setButtonLoading(button, false); }
  }
  async function signOut() {
    if (!state.sb) return;
    try { const { error } = await state.sb.auth.signOut(); if (error) throw error; }
    catch (error) { toast('تعذر تسجيل الخروج', errorMessage(error), 'error'); }
  }

  // Session, profile, data sync
  async function openApp(user) {
    if (!user || !state.sb) return;
    if (state.user?.id === user.id && !$('#app-shell').classList.contains('hidden')) return;
    state.user = user;
    showOnly('app-shell');
    $('#loading-banner').classList.remove('hidden');
    $('#sidebar-user-email').textContent = user.email || 'الحساب الحالي';
    $('#top-user-email').textContent = user.email || 'حساب المتجر';
    $('#settings-email').value = user.email || '';
    $('#settings-account-email').textContent = user.email || '—';
    try {
      await ensureProfile();
      await refreshData();
      setupRealtime();
    } catch (error) {
      toast('تعذر تجهيز مساحة العمل', errorMessage(error), 'error', 8000);
    } finally { $('#loading-banner').classList.add('hidden'); }
  }
  async function ensureProfile() {
    const { data, error } = await state.sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
    if (error) throw error;
    if (data) { state.profile = data; }
    else {
      const storeName = state.user.user_metadata?.store_name || 'متجري';
      const { data: created, error: createError } = await state.sb.from('profiles').insert({ id: state.user.id, store_name: storeName }).select('*').single();
      if (createError) throw createError;
      state.profile = created;
    }
    renderProfile();
  }
  function renderProfile() {
    const profile = state.profile || {};
    const name = profile.store_name || 'متجري';
    $('#sidebar-store-name').textContent = name;
    $('#top-store-name').textContent = name;
    $('#welcome-store-name').textContent = name;
    $('#store-avatar').textContent = initials(name);
    $('#top-avatar').textContent = initials(name);
    $('#settings-store-name').value = name;
    $('#settings-store-phone').value = profile.store_phone || '';
    $('#settings-store-address').value = profile.store_address || '';
  }
  async function refreshData({ silent = false } = {}) {
    if (!state.sb || !state.user) return;
    if (state.refreshPromise) return state.refreshPromise;
    const promise = (async () => {
      if (!silent) $('#loading-banner').classList.remove('hidden');
      const [ordersResult, customersResult] = await Promise.all([
        state.sb.from('orders').select('*').order('created_at', { ascending: false }).limit(2000),
        state.sb.from('customers').select('*').order('updated_at', { ascending: false }).limit(2000)
      ]);
      if (ordersResult.error) throw ordersResult.error;
      if (customersResult.error) throw customersResult.error;
      state.orders = ordersResult.data || [];
      state.customers = customersResult.data || [];
      renderAll();
    })();
    state.refreshPromise = promise;
    try { await promise; }
    catch (error) { toast('تعذر تحميل البيانات', errorMessage(error), 'error', 7000); throw error; }
    finally { state.refreshPromise = null; if (!silent) $('#loading-banner').classList.add('hidden'); }
  }
  function setupRealtime() {
    if (!state.sb || !state.user) return;
    if (state.realtimeChannel) state.sb.removeChannel(state.realtimeChannel);
    state.realtimeChannel = state.sb.channel(`shahna-user-${state.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `user_id=eq.${state.user.id}` }, () => { refreshData({ silent: true }).catch(() => {}); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers', filter: `user_id=eq.${state.user.id}` }, () => { refreshData({ silent: true }).catch(() => {}); })
      .subscribe();
  }

  // Navigation and rendering
  function showPage(page) {
    if (!PAGE_TITLES[page]) return;
    state.page = page;
    $$('.page-section').forEach(section => section.classList.toggle('active', section.id === `page-${page}`));
    $$('.nav-link[data-page]').forEach(link => link.classList.toggle('active', link.dataset.page === page));
    $('#breadcrumb-current').textContent = PAGE_TITLES[page];
    if (window.innerWidth <= 760) closeSidebar();
    if (page === 'orders') renderOrders();
    if (page === 'customers') renderCustomers();
    if (page === 'reports') renderReports();
  }
  function renderAll() {
    renderProfile(); renderDashboard(); renderOrders(); renderCustomers(); renderReports();
    $('#nav-order-count').textContent = state.orders.length;
    $('#orders-page-count').textContent = state.orders.length;
    $('#customers-page-count').textContent = state.customers.length;
  }
  function statusBadge(status) { return `<span class="status-badge ${STATUS_CLASS[status] || 'status-new'}">${esc(status || 'جديد')}</span>`; }
  function orderNumber(order) { return order.order_number || `ORD-${String(order.id || '').slice(0, 8)}`; }
  function getCod(order) { return Number(order.cod_amount ?? Math.max(0, Number(order.quantity || 0) * Number(order.product_price || 0) + Number(order.shipping_fee || 0) - Number(order.discount || 0) - Number(order.paid_amount || 0))); }
  function customerById(id) { return state.customers.find(customer => customer.id === id); }
  function renderDashboard() {
    const orders = state.orders;
    const waiting = orders.filter(order => ['جديد', 'قيد التجهيز', 'تم الشحن'].includes(order.status));
    const delivered = orders.filter(order => order.status === 'تم التسليم');
    const expected = orders.filter(order => !['تم التسليم', 'ملغي', 'مرتجع'].includes(order.status)).reduce((sum, order) => sum + getCod(order), 0);
    $('#stat-orders').textContent = orders.length.toLocaleString('ar-EG');
    $('#stat-pending').textContent = waiting.length.toLocaleString('ar-EG');
    $('#stat-delivered').textContent = delivered.length.toLocaleString('ar-EG');
    $('#stat-cod').innerHTML = moneyCompact(expected);
    const recent = [...orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
    $('#recent-orders').innerHTML = recent.length ? recent.map(order => `
      <div class="recent-order"><div class="order-customer"><span class="initial-avatar">${esc(initials(order.customer_name))}</span><span class="order-customer-text"><b>${safeText(order.customer_name)}</b><small>${esc(orderNumber(order))}</small></span></div><div class="recent-product"><b>${safeText(order.product_name)}</b><small>${dateShort(order.created_at)}</small></div><div class="recent-end"><b>${money(getCod(order))}</b>${statusBadge(order.status)}</div></div>`).join('') : `<div class="empty-state compact"><span class="empty-icon"><i data-lucide="package-search"></i></span><b>لسه مفيش طلبات</b><p>أضف أول طلب وسيظهر هنا.</p><button class="btn primary small-btn" data-new-order="1"><i data-lucide="plus"></i> إنشاء أول طلب</button></div>`;
    $('#status-breakdown').innerHTML = STATUS.map(status => {
      const count = orders.filter(order => order.status === status).length;
      const percent = orders.length ? Math.round(count / orders.length * 100) : 0;
      return `<div class="status-item"><div class="status-item-head"><span></span>${esc(status)}</div><strong>${count.toLocaleString('ar-EG')}</strong><div class="status-track"><i style="width:${percent}%"></i></div></div>`;
    }).join('');
    refreshIcons();
  }
  function filterOrders() {
    const query = `${$('#orders-search')?.value || ''} ${$('#global-search')?.value || ''}`.trim().toLowerCase();
    const status = $('#status-filter')?.value || 'all';
    return [...state.orders].filter(order => {
      const haystack = [order.order_number, order.customer_name, order.customer_phone, order.product_name, order.governorate, order.city, order.address, order.tracking_number].join(' ').toLowerCase();
      return (!query || haystack.includes(query)) && (status === 'all' || order.status === status);
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  function orderActionButtons(order) {
    const id = esc(order.id);
    return `<div class="row-actions"><button class="row-action" data-order-action="edit" data-id="${id}" title="تعديل الطلب" aria-label="تعديل الطلب"><i data-lucide="pencil"></i></button><button class="row-action print-action" data-order-action="print" data-id="${id}" title="طباعة ورقة الشحن" aria-label="طباعة ورقة الشحن"><i data-lucide="printer"></i></button><button class="row-action" data-order-action="status" data-id="${id}" title="تغيير الحالة" aria-label="تغيير الحالة"><i data-lucide="refresh-cw"></i></button><button class="row-action delete-action" data-order-action="delete" data-id="${id}" title="حذف الطلب" aria-label="حذف الطلب"><i data-lucide="trash-2"></i></button></div>`;
  }
  function renderOrders() {
    const orders = filterOrders();
    $('#orders-result-count').textContent = `${orders.length.toLocaleString('ar-EG')} من ${state.orders.length.toLocaleString('ar-EG')} طلب`;
    $('#orders-empty').classList.toggle('hidden', orders.length !== 0);
    $('#orders-tbody').innerHTML = orders.map(order => `
      <tr><td><span class="id-cell">${esc(orderNumber(order))}</span></td><td><div class="table-customer"><span class="initial-avatar">${esc(initials(order.customer_name))}</span><span class="table-customer-text"><b>${safeText(order.customer_name)}</b><small>${safeText(order.customer_phone)}</small></span></div></td><td><div class="product-cell" title="${esc(order.product_name)}">${safeText(order.product_name)}<small>الكمية: ${Number(order.quantity || 1).toLocaleString('ar-EG')}</small></div></td><td class="date-cell">${dateShort(order.created_at)}</td><td class="amount-cell">${money(getCod(order))}</td><td>${statusBadge(order.status)}</td><td>${orderActionButtons(order)}</td></tr>`).join('');
    $('#orders-mobile-list').innerHTML = orders.map(order => `
      <article class="mobile-order-card"><div class="mobile-order-top"><span class="mobile-order-id">${esc(orderNumber(order))}</span>${statusBadge(order.status)}</div><div class="mobile-order-customer"><span class="initial-avatar">${esc(initials(order.customer_name))}</span><div><b>${safeText(order.customer_name)}</b><small>${safeText(order.customer_phone)}</small></div></div><div class="mobile-order-meta"><span>${safeText(order.product_name)} × ${Number(order.quantity || 1).toLocaleString('ar-EG')}</span><b>${money(getCod(order))}</b></div><div class="mobile-order-meta"><span>${dateShort(order.created_at)}</span><span>${safeText(order.city)}، ${safeText(order.governorate)}</span></div><div class="mobile-order-actions"><button class="btn outline" data-order-action="edit" data-id="${esc(order.id)}"><i data-lucide="pencil"></i> تعديل</button><button class="btn outline" data-order-action="print" data-id="${esc(order.id)}"><i data-lucide="printer"></i> طباعة</button><button class="row-action" data-order-action="status" data-id="${esc(order.id)}" title="تغيير الحالة"><i data-lucide="refresh-cw"></i></button><button class="row-action delete-action" data-order-action="delete" data-id="${esc(order.id)}" title="حذف"><i data-lucide="trash-2"></i></button></div></article>`).join('');
    refreshIcons();
  }
  function renderCustomers() {
    const query = ($('#customers-search')?.value || '').trim().toLowerCase();
    const ordersByPhone = new Map();
    state.orders.forEach(order => {
      const key = String(order.customer_phone || '').trim();
      if (!ordersByPhone.has(key)) ordersByPhone.set(key, []);
      ordersByPhone.get(key).push(order);
    });
    const records = state.customers.map(customer => {
      const related = (ordersByPhone.get(String(customer.phone || '').trim()) || []).sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
      return { ...customer, orderCount: related.length, latestOrder: related[0] || null, deliveredCount: related.filter(order => order.status === 'تم التسليم').length };
    }).filter(customer => [customer.name, customer.phone, customer.phone_alt, customer.governorate, customer.city, customer.address].join(' ').toLowerCase().includes(query)).sort((a,b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
    $('#customer-total').textContent = state.customers.length.toLocaleString('ar-EG');
    $('#customer-delivered').textContent = state.customers.filter(customer => (ordersByPhone.get(String(customer.phone || '').trim()) || []).some(order => order.status === 'تم التسليم')).length.toLocaleString('ar-EG');
    $('#customer-repeat').textContent = records.filter(customer => customer.orderCount > 1).length.toLocaleString('ar-EG');
    $('#customers-results-label').textContent = `${records.length.toLocaleString('ar-EG')} عميل`;
    $('#customers-empty').classList.toggle('hidden', records.length !== 0);
    $('#customers-tbody').innerHTML = records.map(customer => `
      <tr><td><div class="customer-name-wrap"><span class="initial-avatar">${esc(initials(customer.name))}</span><span><b>${safeText(customer.name)}</b><small>${safeText(customer.phone_alt, '—')}</small></span></div></td><td dir="ltr" style="text-align:right">${safeText(customer.phone)}</td><td>${safeText(customer.governorate)} / ${safeText(customer.city)}</td><td><div class="customer-address-cell" title="${esc(customer.address)}">${safeText(customer.address)}</div></td><td><span class="count-pill">${customer.orderCount.toLocaleString('ar-EG')}</span></td><td class="date-cell">${dateShort(customer.latestOrder?.created_at || customer.updated_at || customer.created_at)}</td><td><button class="row-action" data-customer-action="view" data-id="${esc(customer.id)}" title="عرض ملف العميل"><i data-lucide="arrow-up-left"></i></button></td></tr>`).join('');
    $('#customers-mobile-list').innerHTML = records.map(customer => `
      <article class="mobile-order-card"><div class="mobile-order-top"><div class="customer-name-wrap"><span class="initial-avatar">${esc(initials(customer.name))}</span><span><b>${safeText(customer.name)}</b><small>${safeText(customer.phone)}</small></span></div><span class="count-pill">${customer.orderCount.toLocaleString('ar-EG')} طلب</span></div><div class="mobile-order-meta"><span>${safeText(customer.governorate)} / ${safeText(customer.city)}</span><span>${dateShort(customer.latestOrder?.created_at || customer.updated_at || customer.created_at)}</span></div><div class="mobile-order-meta"><span>${safeText(customer.address)}</span></div><div class="mobile-order-actions"><button class="btn outline" data-customer-action="view" data-id="${esc(customer.id)}"><i data-lucide="contact-round"></i> عرض الملف</button><button class="btn primary" data-customer-action="new-order" data-id="${esc(customer.id)}"><i data-lucide="plus"></i> طلب جديد</button></div></article>`).join('');
    refreshIcons();
  }
  function renderReports() {
    const orders = state.orders;
    const productValue = orders.reduce((s,o) => s + Number(o.product_price || 0) * Number(o.quantity || 0), 0);
    const shipping = orders.reduce((s,o) => s + Number(o.shipping_fee || 0), 0);
    const paid = orders.reduce((s,o) => s + Number(o.paid_amount || 0), 0);
    const returns = orders.filter(o => ['مرتجع','ملغي'].includes(o.status)).length;
    $('#report-products').textContent = money(productValue); $('#report-shipping').textContent = money(shipping);
    $('#report-paid').textContent = money(paid); $('#report-returned').textContent = returns.toLocaleString('ar-EG');
    $('#report-status-chart').innerHTML = STATUS.map((status, index) => {
      const count = orders.filter(o => o.status === status).length;
      const width = orders.length ? Math.round(count / orders.length * 100) : 0;
      return `<div class="report-status-row"><span>${esc(status)}</span><div class="bar"><i style="width:${width}%"></i></div><b>${count.toLocaleString('ar-EG')}</b></div>`;
    }).join('');
    const days = [];
    for (let offset = 6; offset >= 0; offset--) {
      const date = new Date(); date.setHours(0,0,0,0); date.setDate(date.getDate() - offset);
      const key = localDayKey(date);
      days.push({ key, label: new Intl.DateTimeFormat('ar-EG', { weekday: 'short' }).format(date), count: orders.filter(order => order.created_at && localDayKey(order.created_at) === key).length });
    }
    const max = Math.max(1, ...days.map(d => d.count));
    $('#report-week-chart').innerHTML = days.map(d => `<div class="week-column"><b>${d.count.toLocaleString('ar-EG')}</b><div class="week-bar-area"><i class="week-bar" style="height:${Math.max(3, Math.round(d.count / max * 100))}%"></i></div><small>${esc(d.label)}</small></div>`).join('');
    refreshIcons();
  }

  // Order creation/editing and customer data
  function calculateFormMoney() {
    const quantity = Math.max(0, Number($('#order-quantity').value || 0));
    const price = Math.max(0, Number($('#order-price').value || 0));
    const shipping = Math.max(0, Number($('#order-shipping').value || 0));
    const discount = Math.max(0, Number($('#order-discount').value || 0));
    const paid = Math.max(0, Number($('#order-paid').value || 0));
    const products = quantity * price;
    const subtotal = products + shipping - discount;
    const cod = Math.max(0, subtotal - paid);
    $('#preview-products').textContent = money(products);
    $('#preview-subtotal').textContent = money(subtotal);
    $('#preview-cod').textContent = money(cod);
    return { quantity, price, shipping, discount, paid, products, subtotal, cod };
  }
  function openOrderModal(order = null, customer = null) {
    if (!state.user || !state.sb) { toast('سجّل الدخول أولًا', 'يجب الاتصال بحساب المتجر لحفظ الطلبات.', 'info'); return; }
    $('#order-form').reset();
    $('#order-id').value = order?.id || '';
    $('#order-customer-id').value = order?.customer_id || customer?.id || '';
    $('#order-modal-title').textContent = order ? 'تعديل الطلب' : 'إنشاء طلب جديد';
    $('#order-save-btn').innerHTML = order ? '<i data-lucide="save"></i> حفظ التعديلات' : '<i data-lucide="save"></i> حفظ الطلب';
    $('#order-customer-name').value = order?.customer_name || customer?.name || '';
    $('#order-phone').value = order?.customer_phone || customer?.phone || '';
    $('#order-phone-alt').value = order?.customer_phone_alt || customer?.phone_alt || '';
    $('#order-governorate').value = order?.governorate || customer?.governorate || '';
    $('#order-city').value = order?.city || customer?.city || '';
    $('#order-address').value = order?.address || customer?.address || '';
    $('#order-product').value = order?.product_name || '';
    $('#order-sku').value = order?.sku || '';
    $('#order-quantity').value = order?.quantity || 1;
    $('#order-status').value = order?.status || 'جديد';
    $('#order-carrier').value = order?.carrier || '';
    $('#order-tracking').value = order?.tracking_number || '';
    $('#order-notes').value = order?.notes || '';
    $('#order-price').value = order?.product_price ?? 0;
    $('#order-shipping').value = order?.shipping_fee ?? 0;
    $('#order-discount').value = order?.discount ?? 0;
    $('#order-paid').value = order?.paid_amount ?? 0;
    calculateFormMoney();
    openModal('order-modal');
  }
  function openModal(id) { $(`#${id}`).classList.remove('hidden'); document.body.style.overflow = 'hidden'; refreshIcons(); }
  function closeModal(id) { $(`#${id}`)?.classList.add('hidden'); if (!$$('.modal-backdrop').some(el => !el.classList.contains('hidden'))) document.body.style.overflow = ''; }
  async function saveCustomerFromOrder(values, existingId) {
    const row = {
      user_id: state.user.id, name: values.customer_name, phone: values.customer_phone,
      phone_alt: values.customer_phone_alt || null, governorate: values.governorate, city: values.city,
      address: values.address
    };
    let result;
    if (existingId) {
      result = await state.sb.from('customers').update(row).eq('id', existingId).eq('user_id', state.user.id).select('id').single();
      if (result.error) throw result.error;
      return result.data.id;
    }
    result = await state.sb.from('customers').upsert(row, { onConflict: 'user_id,phone' }).select('id').single();
    if (result.error) throw result.error;
    return result.data.id;
  }
  async function saveOrder(event) {
    event.preventDefault();
    const button = $('#order-save-btn');
    const id = $('#order-id').value || null;
    const customerId = $('#order-customer-id').value || null;
    const values = {
      customer_name: $('#order-customer-name').value.trim(), customer_phone: $('#order-phone').value.trim(),
      customer_phone_alt: $('#order-phone-alt').value.trim(), governorate: $('#order-governorate').value.trim(),
      city: $('#order-city').value.trim(), address: $('#order-address').value.trim(),
      product_name: $('#order-product').value.trim(), sku: $('#order-sku').value.trim(),
      quantity: Number($('#order-quantity').value), status: $('#order-status').value,
      carrier: $('#order-carrier').value.trim(), tracking_number: $('#order-tracking').value.trim(),
      notes: $('#order-notes').value.trim(), product_price: Number($('#order-price').value),
      shipping_fee: Number($('#order-shipping').value), discount: Number($('#order-discount').value), paid_amount: Number($('#order-paid').value)
    };
    if (!values.customer_name || !values.customer_phone || !values.governorate || !values.city || !values.address || !values.product_name) return toast('بيانات ناقصة', 'أكمل الاسم ورقم الهاتف والمحافظة والمدينة والعنوان واسم المنتج.', 'error');
    if (!Number.isInteger(values.quantity) || values.quantity < 1) return toast('الكمية غير صحيحة', 'الكمية يجب أن تكون عددًا صحيحًا أكبر من صفر.', 'error');
    if ([values.product_price, values.shipping_fee, values.discount, values.paid_amount].some(n => !Number.isFinite(n) || n < 0)) return toast('راجع المبالغ', 'لا يمكن إدخال مبلغ سالب أو قيمة غير صالحة.', 'error');
    if (values.discount > values.quantity * values.product_price + values.shipping_fee) return toast('الخصم أكبر من الإجمالي', 'الخصم لا يمكن أن يتجاوز قيمة المنتجات ومصاريف الشحن.', 'error');
    if (values.paid_amount > values.quantity * values.product_price + values.shipping_fee - values.discount) return toast('المقدم أكبر من المستحق', 'المدفوع مقدمًا لا يمكن أن يتجاوز الإجمالي بعد الخصم.', 'error');
    setButtonLoading(button, true, id ? 'جاري حفظ التعديلات...' : 'جاري حفظ الطلب...');
    try {
      const savedCustomerId = await saveCustomerFromOrder(values, customerId);
      const row = {
        ...values, user_id: state.user.id, customer_id: savedCustomerId,
        phone_snapshot: values.customer_phone,
        order_number: id ? (state.orders.find(order => order.id === id)?.order_number || makeOrderNumber()) : makeOrderNumber()
      };
      // Schema uses customer_phone as the order snapshot field.
      delete row.phone_snapshot;
      let result;
      if (id) result = await state.sb.from('orders').update(row).eq('id', id).eq('user_id', state.user.id).select('*').single();
      else result = await state.sb.from('orders').insert(row).select('*').single();
      if (result.error) throw result.error;
      closeModal('order-modal');
      toast(id ? 'تم تحديث الطلب' : 'تم حفظ الطلب', 'البيانات محفوظة على قاعدة البيانات السحابية.', 'success');
      await refreshData({ silent: true });
      if (!id && result.data) askPrintLabel(result.data);
    } catch (error) { toast('لم يتم حفظ الطلب', errorMessage(error), 'error', 7000); }
    finally { setButtonLoading(button, false); }
  }
  function makeOrderNumber() {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const random = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `SH-${stamp}-${random}`;
  }
  function askPrintLabel(order) {
    // Order is saved before opening the print flow. The user may cancel printing.
    showLabel(order);
    toast('الطلب جاهز', 'اضغط «طباعة» من إجراءات الطلب لطباعة الملصق متى شئت.', 'info', 4500);
  }
  async function deleteOrder(id) {
    const order = state.orders.find(item => item.id === id);
    if (!order) return;
    if (!window.confirm(`هل تريد حذف الطلب ${orderNumber(order)} نهائيًا؟ لا يمكن التراجع عن الحذف.`)) return;
    try {
      const { error } = await state.sb.from('orders').delete().eq('id', id).eq('user_id', state.user.id);
      if (error) throw error;
      toast('تم حذف الطلب', orderNumber(order), 'success'); await refreshData({ silent: true });
    } catch (error) { toast('تعذر حذف الطلب', errorMessage(error), 'error'); }
  }
  function openStatusModal(order) {
    $('#status-order-id').value = order.id; $('#status-order-number').textContent = orderNumber(order);
    $('#status-new-value').value = order.status || 'جديد'; openModal('status-modal');
  }
  async function saveStatus(event) {
    event.preventDefault();
    const id = $('#status-order-id').value; const status = $('#status-new-value').value;
    try {
      const { error } = await state.sb.from('orders').update({ status }).eq('id', id).eq('user_id', state.user.id);
      if (error) throw error;
      closeModal('status-modal'); toast('تم تغيير حالة الطلب', status, 'success'); await refreshData({ silent: true });
    } catch (error) { toast('تعذر تعديل الحالة', errorMessage(error), 'error'); }
  }
  function handleOrderAction(action, id) {
    const order = state.orders.find(item => item.id === id); if (!order) return;
    if (action === 'edit') openOrderModal(order);
    else if (action === 'print') openPrintOptions(order);
    else if (action === 'status') openStatusModal(order);
    else if (action === 'delete') void deleteOrder(id);
  }

  // Customer details
  function openCustomerDetails(customer) {
    state.selectedCustomer = customer;
    const matchingOrders = state.orders.filter(order => order.customer_id === customer.id || String(order.customer_phone || '').trim() === String(customer.phone || '').trim()).sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
    $('#customer-detail-content').innerHTML = `<div class="customer-detail-grid"><div class="customer-detail-field"><span>اسم العميل</span><b>${safeText(customer.name)}</b></div><div class="customer-detail-field"><span>رقم الهاتف</span><b dir="ltr" style="text-align:right">${safeText(customer.phone)}</b></div><div class="customer-detail-field"><span>رقم بديل</span><b dir="ltr" style="text-align:right">${safeText(customer.phone_alt)}</b></div><div class="customer-detail-field"><span>المحافظة / المدينة</span><b>${safeText(customer.governorate)} / ${safeText(customer.city)}</b></div><div class="customer-detail-field full"><span>العنوان بالتفصيل</span><b>${safeText(customer.address)}</b></div><div class="customer-detail-field full"><span>ملاحظات العميل</span><b>${safeText(customer.notes)}</b></div></div><div class="customer-order-list"><h3>الطلبات السابقة (${matchingOrders.length.toLocaleString('ar-EG')})</h3>${matchingOrders.length ? matchingOrders.slice(0,6).map(order => `<div class="customer-order-item"><span>${esc(orderNumber(order))} · ${esc(order.product_name)}</span><span>${statusBadge(order.status)}</span><b>${money(getCod(order))}</b></div>`).join('') : '<p class="muted small">لا توجد طلبات مرتبطة بهذا العميل حتى الآن.</p>'}</div>`;
    openModal('customer-modal');
  }
  function handleCustomerAction(action, id) {
    const customer = state.customers.find(item => item.id === id); if (!customer) return;
    if (action === 'view') openCustomerDetails(customer);
    if (action === 'new-order') openOrderModal(null, customer);
  }

  // Shipping label
  function openPrintOptions(order) {
    if (!order) return;
    state.pendingPrintOrder = order;
    $('#print-format').value = state.printFormat || 'label';
    openModal('print-options-modal');
  }
  function showLabel(order) {
    if (!order) return;
    const profile = state.profile || {};
    $('#label-store-name').textContent = profile.store_name || 'متجري';
    $('#label-store-contact').textContent = profile.store_phone ? `هاتف: ${profile.store_phone}` : (state.user?.email || '');
    $('#label-store-address').textContent = profile.store_address || '';
    $('#label-order-number').textContent = orderNumber(order);
    $('#label-date').textContent = dateShort(order.created_at || new Date().toISOString());
    $('#label-customer-name').textContent = order.customer_name || '—';
    $('#label-phone-line').textContent = [order.customer_phone, order.customer_phone_alt].filter(Boolean).join('  ·  ');
    $('#label-address').textContent = [order.governorate, order.city, order.address].filter(Boolean).join('، ');
    $('#label-product-name').textContent = order.product_name || '—';
    $('#label-product-meta').textContent = order.sku ? `كود المنتج: ${order.sku}` : '';
    $('#label-product-qty').textContent = `× ${Number(order.quantity || 1)}`;
    $('#label-product-total').textContent = money(Number(order.product_price || 0) * Number(order.quantity || 0));
    $('#label-shipping').textContent = money(order.shipping_fee);
    $('#label-discount').textContent = money(order.discount);
    $('#label-paid').textContent = money(order.paid_amount);
    $('#label-cod-value').textContent = money(getCod(order));
    $('#label-notes').textContent = order.notes || '';
    $('#label-notes-wrap').style.display = order.notes ? '' : 'none';
    $('#label-carrier').textContent = order.carrier ? `شركة الشحن: ${order.carrier}` : '';
    $('#label-tracking-number').textContent = order.tracking_number || '';
    $('#label-barcode-text').textContent = orderNumber(order);
    $('#print-sheet').classList.toggle('a4', state.printFormat === 'a4');
    const root = $('#print-root'); root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('printing'); refreshIcons();
    setTimeout(() => window.print(), 180);
  }

  // CSV export utilities
  function csvCell(value) {
    let str = String(value ?? '');
    // Guard spreadsheet programs from interpreting imported text as formulas.
    if (/^[\s]*[=+@]/.test(str) || /^[\s]*-[0-9]/.test(str)) str = `'${str}`;
    return `"${str.replace(/"/g, '""')}"`;
  }
  function downloadCsv(filename, headers, rows) {
    const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    toast('تم تجهيز ملف CSV', filename, 'success');
  }
  function exportOrders() {
    const rows = state.orders.map(o => [orderNumber(o), o.created_at, o.status, o.customer_name, o.customer_phone, o.customer_phone_alt, o.governorate, o.city, o.address, o.product_name, o.sku, o.quantity, o.product_price, o.shipping_fee, o.discount, o.paid_amount, getCod(o), o.carrier, o.tracking_number, o.notes]);
    downloadCsv(`shahna-orders-${localDayKey(new Date())}.csv`, ['رقم الطلب','تاريخ الإنشاء','الحالة','اسم العميل','الهاتف','هاتف بديل','المحافظة','المدينة','العنوان','المنتج','كود المنتج','الكمية','سعر القطعة','الشحن','الخصم','مدفوع مقدمًا','تحصيل عند الاستلام','شركة الشحن','رقم التتبع','ملاحظات'], rows);
  }
  function exportCustomers() {
    const rows = state.customers.map(c => [c.name, c.phone, c.phone_alt, c.governorate, c.city, c.address, c.notes, dateShort(c.created_at), dateShort(c.updated_at)]);
    downloadCsv(`shahna-customers-${localDayKey(new Date())}.csv`, ['اسم العميل','الهاتف','هاتف بديل','المحافظة','المدينة','العنوان','ملاحظات','تاريخ الإضافة','آخر تحديث'], rows);
  }
  function exportReport() {
    const rows = state.orders.map(o => [orderNumber(o), o.status, o.customer_name, o.product_name, o.quantity, Number(o.product_price||0)*Number(o.quantity||0), o.shipping_fee, o.discount, o.paid_amount, getCod(o), dateShort(o.created_at)]);
    downloadCsv(`shahna-report-${localDayKey(new Date())}.csv`, ['رقم الطلب','الحالة','العميل','المنتج','الكمية','قيمة المنتجات','الشحن','الخصم','مدفوع مقدمًا','تحصيل متبقٍ','التاريخ'], rows);
  }

  // Settings
  async function saveSettings(event) {
    event.preventDefault();
    const storeName = $('#settings-store-name').value.trim();
    if (!storeName) return toast('اسم المتجر مطلوب', 'اكتب اسم المتجر أولًا.', 'error');
    const button = $('#settings-form button[type="submit"]'); setButtonLoading(button, true, 'جاري الحفظ...');
    try {
      const row = { id: state.user.id, store_name: storeName, store_phone: $('#settings-store-phone').value.trim() || null, store_address: $('#settings-store-address').value.trim() || null, updated_at: new Date().toISOString() };
      const { data, error } = await state.sb.from('profiles').upsert(row, { onConflict: 'id' }).select('*').single();
      if (error) throw error;
      state.profile = data; renderProfile(); toast('تم حفظ إعدادات المتجر', 'ستظهر البيانات الجديدة على أوراق الشحن التالية.', 'success');
    } catch (error) { toast('تعذر حفظ الإعدادات', errorMessage(error), 'error'); }
    finally { setButtonLoading(button, false); }
  }

  // Sidebar and interactions
  function openSidebar() { $('#sidebar').classList.add('open'); $('#sidebar-scrim').classList.add('open'); }
  function closeSidebar() { $('#sidebar').classList.remove('open'); $('#sidebar-scrim').classList.remove('open'); }
  function bindEvents() {
    $('#setup-form').addEventListener('submit', async event => {
      event.preventDefault();
      const config = { supabaseUrl: $('#setup-url').value.trim().replace(/\/+$/, ''), supabasePublishableKey: $('#setup-key').value.trim() };
      try {
        if (!isConfigured(config)) throw new Error('الرابط أو المفتاح غير مكتمل.');
        if (/service_role|secret[_-]?key/i.test(config.supabasePublishableKey)) throw new Error('لا تضع مفتاحًا سريًا هنا. استخدم Publishable key أو anon key.');
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
        configureClient(config);
        const { error } = await state.sb.auth.getSession(); if (error) throw error;
        toast('تم حفظ بيانات الاتصال', 'يمكنك الآن تسجيل الدخول أو إنشاء حساب.', 'success'); await boot();
      } catch (error) { toast('فشل اختبار الاتصال', errorMessage(error), 'error', 7000); }
    });
    $('#use-config-js').addEventListener('click', () => {
      try { localStorage.removeItem(CONFIG_STORAGE_KEY); }
      catch { /* ignored */ }
      if (!isConfigured(DEFAULT_CONFIG)) return toast('ملف config.js غير مكتمل', 'أضف رابط المشروع ومفتاح النشر العام في ملف config.js ثم أعد تحميل الصفحة.', 'info', 7000);
      boot();
    });
    $$('.auth-tab').forEach(tab => tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode)));
    $('#auth-form').addEventListener('submit', handleAuthSubmit);
    $('#forgot-password').addEventListener('click', async () => {
      try { await sendResetEmail($('#auth-email').value.trim().toLowerCase()); }
      catch (error) { toast('تعذر إرسال رابط الاستعادة', errorMessage(error), 'error'); }
    });
    $('#recovery-form').addEventListener('submit', handleRecovery);
    $$('[data-reveal]').forEach(button => button.addEventListener('click', () => {
      const input = $(`#${button.dataset.reveal}`); input.type = input.type === 'password' ? 'text' : 'password';
      button.innerHTML = `<i data-lucide="${input.type === 'password' ? 'eye' : 'eye-off'}"></i>`; refreshIcons();
    }));
    $('#signout-btn').addEventListener('click', signOut); $('#settings-signout').addEventListener('click', signOut);
    $('#profile-button').addEventListener('click', () => showPage('settings'));
    $$('.nav-link[data-page]').forEach(link => link.addEventListener('click', () => showPage(link.dataset.page)));
    $$('[data-go-page]').forEach(btn => btn.addEventListener('click', () => showPage(btn.dataset.goPage)));
    $('#mobile-menu-btn').addEventListener('click', openSidebar); $('#mobile-sidebar-close').addEventListener('click', closeSidebar); $('#sidebar-scrim').addEventListener('click', closeSidebar);
    $('#help-open').addEventListener('click', () => openModal('help-modal'));
    $('#new-order-top').addEventListener('click', () => openOrderModal()); $('#new-order-page').addEventListener('click', () => openOrderModal()); $('#quick-add-order').addEventListener('click', () => openOrderModal()); $('#empty-new-order').addEventListener('click', () => openOrderModal());
    $('#quick-customers').addEventListener('click', () => showPage('customers'));
    $('#quick-export').addEventListener('click', exportOrders); $('#orders-export').addEventListener('click', exportOrders); $('#settings-export-orders').addEventListener('click', exportOrders); $('#settings-export-customers').addEventListener('click', exportCustomers); $('#customers-export').addEventListener('click', exportCustomers); $('#report-export').addEventListener('click', exportReport);
    $('#refresh-btn').addEventListener('click', () => refreshData().then(() => toast('تم تحديث البيانات', 'أنت الآن ترى أحدث الطلبات.', 'success')).catch(() => {}));
    $('#global-search').addEventListener('input', () => { if ($('#global-search').value.trim()) showPage('orders'); renderOrders(); });
    $('#orders-search').addEventListener('input', renderOrders); $('#status-filter').addEventListener('change', renderOrders); $('#customers-search').addEventListener('input', renderCustomers);
    $('#order-form').addEventListener('submit', saveOrder);
    ['order-quantity','order-price','order-shipping','order-discount','order-paid'].forEach(id => $(`#${id}`).addEventListener('input', calculateFormMoney));
    $('#status-form').addEventListener('submit', saveStatus);
    $('#print-options-form').addEventListener('submit', event => { event.preventDefault(); state.printFormat = $('#print-format').value; const order = state.pendingPrintOrder; closeModal('print-options-modal'); if (order) showLabel(order); });
    $('#settings-form').addEventListener('submit', saveSettings);
    $('#customer-new-order').addEventListener('click', () => { const customer = state.selectedCustomer; closeModal('customer-modal'); openOrderModal(null, customer); });
    document.addEventListener('click', event => {
      const close = event.target.closest('[data-close-modal]');
      if (close) { closeModal(close.dataset.closeModal); return; }
      const orderAction = event.target.closest('[data-order-action]');
      if (orderAction) { handleOrderAction(orderAction.dataset.orderAction, orderAction.dataset.id); return; }
      const customerAction = event.target.closest('[data-customer-action]');
      if (customerAction) { handleCustomerAction(customerAction.dataset.customerAction, customerAction.dataset.id); return; }
      if (event.target.closest('[data-new-order]')) { openOrderModal(); return; }
      const backdrop = event.target.classList?.contains('modal-backdrop') ? event.target : null;
      if (backdrop) closeModal(backdrop.id);
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { $$('.modal-backdrop:not(.hidden)').forEach(modal => closeModal(modal.id)); closeSidebar(); } });
    window.addEventListener('afterprint', () => { document.body.classList.remove('printing'); $('#print-root').setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; });
    window.addEventListener('online', () => toast('عاد الاتصال بالإنترنت', 'يمكنك متابعة العمل ومزامنة البيانات.', 'success', 2500));
    window.addEventListener('offline', () => toast('انقطع الاتصال', 'لن تُحفظ التغييرات الجديدة حتى يعود الإنترنت.', 'error', 5000));
  }

  bindEvents();
  void boot();
})();
