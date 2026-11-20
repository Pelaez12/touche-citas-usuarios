const WEEKDAY_NAMES_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WEEKDAY_NAMES_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const SUPPORT_WA = 'https://wa.me/51992272521';

const STEP_LABELS = {
  1: 'Paso 1 de 5 · Servicio',
  2: 'Paso 2 de 5 · Especialista',
  3: 'Paso 3 de 5 · Día',
  4: 'Paso 4 de 5 · Hora',
  5: 'Paso 5 de 5 · Confirmar',
  6: '¡Cita reservada!'
};

const state = {
  client: null,
  upcomingAppointments: [],
  catalog: null,
  gateView: 'welcome',
  claimTarget: null,
  claimSearchTimer: null,
  activeStep: 1,
  search: '',
  activeCategory: null,
  selectedService: null,
  staffChosen: false,
  selectedStaff: null,
  monthView: null,
  monthDaysMap: new Map(),
  selectedDate: null,
  selectedSlot: null,
  daySlotsCache: new Map(),
  bookingResult: null,
  submitting: false
};

const $ = id => document.getElementById(id);

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeSearch(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function prefersReducedMotion() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function scrollToEl(el, { focusEl = null } = {}) {
  if (!el) return;
  requestAnimationFrame(() => {
    el.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start'
    });
    if (focusEl) {
      setTimeout(() => {
        try { focusEl.focus({ preventScroll: true }); } catch {}
      }, prefersReducedMotion() ? 0 : 280);
    }
  });
}

function formatDuration(min, max) {
  const fmt = m => {
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h} h ${rem} min` : `${h} h`;
  };
  if (max && max > min) return `${fmt(min)} – ${fmt(max)}`;
  return fmt(min);
}

function formatPrice(svc) {
  if (svc.isFree) return { label: 'Gratis', cls: 'is-free', soles: 0 };
  if (svc.priceCents == null) return { label: 'Según evaluación', cls: 'is-muted', soles: null };
  const soles = Math.round(svc.priceCents / 100);
  return { label: `Desde S/ ${soles}`, cls: '', soles };
}

function buildPriceNoticeCopy(svc) {
  const price = formatPrice(svc);
  if (svc.isFree) {
    return {
      isFree: true,
      title: 'Servicio 100% gratuito',
      text: 'Esta evaluación dura 20 minutos, no tiene ningún costo y es sin compromiso. En el salón te daremos un presupuesto exacto.'
    };
  }
  if (price.soles == null) {
    return {
      isFree: false,
      title: 'Aviso importante sobre el precio',
      text: 'El precio de este servicio se define dentro del salón según el largo, la cantidad y el estado actual de tu cabello. Antes de empezar, nuestra especialista te confirmará el monto exacto.'
    };
  }
  return {
    isFree: false,
    title: `Aviso sobre el precio (${price.label})`,
    text: `El monto mostrado (${price.label}) es un precio base referencial. Dentro del salón el precio final puede variar de lo establecido según el largo, la cantidad y el estado actual de tu cabello. Antes de iniciar, nuestra especialista te confirmará el monto exacto.`
  };
}

function formatTime12(hhmm) {
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3, 5);
  const suffix = h >= 12 ? 'p. m.' : 'a. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

function formatDateLong(ymd) {
  const d = new Date(ymd + 'T12:00:00Z');
  const wk = WEEKDAY_NAMES_LONG[d.getUTCDay()];
  const day = d.getUTCDate();
  const mon = MONTH_NAMES[d.getUTCMonth()];
  return `${wk} ${day} de ${mon}`;
}

function formatDateShort(ymd) {
  const d = new Date(ymd + 'T12:00:00Z');
  const wk = WEEKDAY_NAMES_SHORT[d.getUTCDay()];
  const day = d.getUTCDate();
  const mon = MONTH_NAMES[d.getUTCMonth()].slice(0, 3);
  return `${wk} ${day} ${mon}`;
}

function formatMonthTitle(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function addMonths(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'TH';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function firstNameOf(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || 'Clienta';
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...(options.headers || {}) },
    ...options
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data.error || 'Ocurrió un problema de conexión. Inténtalo de nuevo.');
    err.status = res.status;
    throw err;
  }
  return data;
}

function showWelcomeToast(message) {
  $('welcome-toast-text').textContent = message;
  $('welcome-toast').hidden = false;
  setTimeout(() => {
    $('welcome-toast').hidden = true;
  }, 6000);
}

/* ==================== VISTAS DEL PORTAL DE ACCESO (GATE) ==================== */
function showGateView(viewName, { prefillName = '', fromNotFound = false } = {}) {
  state.gateView = viewName;
  $('gate-shell').hidden = false;
  $('booking-workspace').hidden = true;
  $('sec-confirmation').hidden = true;
  $('step-indicator').hidden = true;
  $('progress-track').hidden = true;
  $('logout-btn').hidden = true;

  const views = ['welcome', 'claim-search', 'claim-complete', 'register', 'login'];
  for (const v of views) {
    $(`view-${v}`).hidden = v !== viewName;
  }

  if (viewName === 'claim-search') {
    const inp = $('claim-name-search');
    setTimeout(() => inp.focus(), 80);
  } else if (viewName === 'register') {
    $('register-heading').textContent = fromNotFound
      ? 'Te agregamos como clienta de Touché'
      : 'Crea tu cuenta de clienta Touché';
    $('register-sub').textContent = fromNotFound
      ? 'Completa tus datos aquí para crear tu ficha y tu acceso, y enseguida podrás reservar tu cita.'
      : 'Solo te pedimos estos datos una vez. Guardaremos tu acceso para que reserves tus citas en segundos.';
    if (prefillName && !$('reg-name').value.trim()) {
      $('reg-name').value = prefillName;
    }
    $('reg-error').hidden = true;
    setTimeout(() => $('reg-name').focus(), 80);
  } else if (viewName === 'login') {
    $('login-error').hidden = true;
    setTimeout(() => $('login-email').focus(), 80);
  } else if (viewName === 'claim-complete') {
    $('claim-error').hidden = true;
    setTimeout(() => $('claim-email').focus(), 80);
  }

  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

async function runUnclaimedNameSearch(query) {
  const wrap = $('claim-results-wrap');
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    wrap.innerHTML = '<p class="claim-hint">Escribe al menos 2 letras de tu nombre para ver coincidencias.</p>';
    return;
  }
  wrap.innerHTML = '<div class="skeleton-row"></div>';
  try {
    const data = await fetchJson(`/api/client/unclaimed-names?q=${encodeURIComponent(trimmed)}`);
    const results = data.results || [];
    if (!results.length) {
      wrap.innerHTML = `<p class="claim-hint">No encontramos «${escapeHtml(trimmed)}» en la lista disponible. Usa el botón de abajo para agregarte.</p>`;
      return;
    }
    wrap.innerHTML = `
      <div class="name-list" role="list">
        ${results.map(r => `
          <button type="button" class="name-row" data-claim-id="${escapeHtml(r.id)}">
            <span>${escapeHtml(r.name)}</span>
            <span class="ico ico-caret-right row-arrow" aria-hidden="true"></span>
          </button>
        `).join('')}
      </div>
    `;
  } catch (err) {
    wrap.innerHTML = `<p class="claim-hint">${escapeHtml(err.message)}</p>`;
  }
}

async function selectUnclaimedName(clientId) {
  try {
    const reqs = await fetchJson(`/api/client/claim-requirements?clientId=${encodeURIComponent(clientId)}`);
    state.claimTarget = reqs;
    $('claim-selected-name').textContent = reqs.name;
    $('claim-phone-label').textContent = reqs.needsPhone
      ? 'Completa tu celular (WhatsApp)'
      : 'Confirma tu celular (WhatsApp)';
    $('claim-dni-field').hidden = !reqs.needsDni;
    $('claim-dni').required = !!reqs.needsDni;
    $('claim-birthday-field').hidden = !reqs.needsBirthday;
    $('claim-email').value = '';
    $('claim-password').value = '';
    $('claim-phone').value = '';
    $('claim-dni').value = '';
    $('claim-birthday').value = '';
    for (const id of ['err-claim-email', 'err-claim-password', 'err-claim-phone', 'err-claim-dni']) $(id).textContent = '';
    showGateView('claim-complete');
  } catch (err) {
    $('claim-results-wrap').innerHTML = `<p class="claim-hint">${escapeHtml(err.message)}</p>`;
  }
}

function setFormBusy(btnId, busy, idleLabel, busyLabel) {
  const btn = $(btnId);
  btn.disabled = busy;
  btn.querySelector('.btn-label').textContent = busy ? busyLabel : idleLabel;
  btn.querySelector('.btn-spinner').hidden = !busy;
}

function showBoxError(boxId, textId, msg) {
  const el = $(boxId);
  $(textId).textContent = msg;
  el.hidden = false;
  el.classList.remove('is-shaking');
  void el.offsetWidth;
  el.classList.add('is-shaking');
  scrollToEl(el);
}

async function handleClaimSubmit(event) {
  event.preventDefault();
  if (state.submitting || !state.claimTarget) return;
  $('claim-error').hidden = true;
  for (const id of ['err-claim-email', 'err-claim-password', 'err-claim-phone', 'err-claim-dni']) $(id).textContent = '';

  const email = $('claim-email').value.trim();
  const password = $('claim-password').value;
  const phone = $('claim-phone').value.trim();
  const dni = $('claim-dni').value.replace(/\D/g, '').slice(0, 8);
  const birthday = $('claim-birthday').value.trim();

  if (!email.includes('@')) {
    $('err-claim-email').textContent = 'Ingresa un correo válido (ej. tunombre@gmail.com).';
    $('claim-email').focus();
    return;
  }
  if (password.length < 6) {
    $('err-claim-password').textContent = 'Crea una contraseña de al menos 6 caracteres.';
    $('claim-password').focus();
    return;
  }
  if (phone.replace(/\D/g, '').length < 7) {
    $('err-claim-phone').textContent = 'Ingresa un celular válido (ej. 987 654 321).';
    $('claim-phone').focus();
    return;
  }
  if (state.claimTarget.needsDni && !/^\d{8}$/.test(dni)) {
    $('err-claim-dni').textContent = 'Ingresa tu DNI de 8 números.';
    $('claim-dni').focus();
    return;
  }

  state.submitting = true;
  setFormBusy('claim-submit-btn', true, 'Activar mi cuenta y reservar cita', 'Activando tu cuenta...');
  try {
    const res = await fetchJson('/api/client/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: state.claimTarget.clientId,
        email,
        password,
        phone,
        dni: state.claimTarget.needsDni ? dni : '',
        birthday
      })
    });
    enterBookingWorkspace(res.client, res.upcomingAppointments || [], '¡Cuenta activada y guardada! Ya puedes elegir tu cita.');
  } catch (err) {
    showBoxError('claim-error', 'claim-error-text', err.message);
  } finally {
    state.submitting = false;
    setFormBusy('claim-submit-btn', false, 'Activar mi cuenta y reservar cita', 'Activando tu cuenta...');
  }
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  if (state.submitting) return;
  $('reg-error').hidden = true;
  for (const id of ['err-reg-name', 'err-reg-email', 'err-reg-password', 'err-reg-phone', 'err-reg-dni']) $(id).textContent = '';

  const name = $('reg-name').value.trim().replace(/\s+/g, ' ');
  const email = $('reg-email').value.trim();
  const password = $('reg-password').value;
  const phone = $('reg-phone').value.trim();
  const dni = $('reg-dni').value.replace(/\D/g, '').slice(0, 8);
  const birthday = $('reg-birthday').value.trim();

  if (name.length < 2) {
    $('err-reg-name').textContent = 'Escribe tu nombre y apellido.';
    $('reg-name').focus();
    return;
  }
  if (!email.includes('@')) {
    $('err-reg-email').textContent = 'Ingresa un correo válido (ej. tunombre@gmail.com).';
    $('reg-email').focus();
    return;
  }
  if (password.length < 6) {
    $('err-reg-password').textContent = 'Crea una contraseña de al menos 6 caracteres.';
    $('reg-password').focus();
    return;
  }
  if (phone.replace(/\D/g, '').length < 7) {
    $('err-reg-phone').textContent = 'Ingresa un celular válido (ej. 987 654 321).';
    $('reg-phone').focus();
    return;
  }
  if (!/^\d{8}$/.test(dni)) {
    $('err-reg-dni').textContent = 'Ingresa tu DNI de 8 números.';
    $('reg-dni').focus();
    return;
  }

  state.submitting = true;
  setFormBusy('reg-submit-btn', true, 'Crear mi cuenta y reservar cita', 'Creando tu cuenta...');
  try {
    const res = await fetchJson('/api/client/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, phone, dni, birthday })
    });
    enterBookingWorkspace(res.client, res.upcomingAppointments || [], '¡Bienvenida a Touché! Tu cuenta quedó guardada. Ahora elige tu cita.');
  } catch (err) {
    showBoxError('reg-error', 'reg-error-text', err.message);
  } finally {
    state.submitting = false;
    setFormBusy('reg-submit-btn', false, 'Crear mi cuenta y reservar cita', 'Creando tu cuenta...');
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  if (state.submitting) return;
  $('login-error').hidden = true;

  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  if (!email.includes('@') || !password) {
    showBoxError('login-error', 'login-error-text', 'Ingresa tu correo y tu contraseña.');
    return;
  }

  state.submitting = true;
  setFormBusy('login-submit-btn', true, 'Ingresar a mi cuenta', 'Ingresando...');
  try {
    const res = await fetchJson('/api/client/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    enterBookingWorkspace(res.client, res.upcomingAppointments || [], `¡Hola de nuevo, ${firstNameOf(res.client.name)}!`);
  } catch (err) {
    showBoxError('login-error', 'login-error-text', err.message);
  } finally {
    state.submitting = false;
    setFormBusy('login-submit-btn', false, 'Ingresar a mi cuenta', 'Ingresando...');
  }
}

async function handleLogout() {
  try {
    await fetchJson('/api/client/logout', { method: 'POST' });
  } catch {}
  state.client = null;
  state.upcomingAppointments = [];
  resetBookingSelection();
  showGateView('welcome');
}

/* ==================== ESPACIO DE RESERVA (CON SESIÓN) ==================== */
function renderClientProfileBars() {
  const c = state.client;
  if (!c) return;
  const first = firstNameOf(c.name);
  $('rail-client-greeting').textContent = `Hola, ${first}`;
  $('rail-client-email').textContent = c.email;
  $('client-bar-name').textContent = `Hola, ${first}`;
  $('client-bar-email').textContent = c.email;

  $('booking-account-name').textContent = c.name;
  const metaParts = [c.email];
  if (c.phone) metaParts.push(`Cel. ${c.phone}`);
  if (c.dni) metaParts.push(`DNI ${c.dni}`);
  $('booking-account-meta').textContent = metaParts.join(' · ');

  const strip = $('upcoming-strip');
  const list = $('upcoming-list');
  if (state.upcomingAppointments.length) {
    list.innerHTML = state.upcomingAppointments.map(a => `
      <div class="upcoming-item">
        <strong>${escapeHtml(formatDateShort(a.date))} · ${escapeHtml(formatTime12(a.startTime))}</strong> — ${escapeHtml(a.serviceName)} (${escapeHtml(a.staffName)})
      </div>
    `).join('');
    strip.hidden = false;
  } else {
    strip.hidden = true;
  }
}

async function enterBookingWorkspace(client, upcomingAppointments = [], toastMsg = '') {
  state.client = client;
  state.upcomingAppointments = upcomingAppointments;
  state.claimTarget = null;
  $('gate-shell').hidden = true;
  $('sec-confirmation').hidden = true;
  $('booking-workspace').hidden = false;
  $('step-indicator').hidden = false;
  $('progress-track').hidden = false;
  $('logout-btn').hidden = false;

  renderClientProfileBars();
  resetBookingSelection();
  if (!state.catalog) await loadCatalog();
  updateProgressAndRail();
  if (toastMsg) showWelcomeToast(toastMsg);
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

function updateProgressAndRail() {
  let step = 1;
  if (state.bookingResult) step = 6;
  else if (state.selectedSlot) step = 5;
  else if (state.selectedDate) step = 4;
  else if (state.staffChosen) step = 3;
  else if (state.selectedService) step = 2;

  state.activeStep = step;
  $('step-indicator').textContent = STEP_LABELS[step];
  $('progress-track').setAttribute('aria-valuenow', String(Math.min(step, 5)));
  $('progress-fill').className = `progress-fill is-step-${step}`;

  $('badge-step-1').classList.toggle('is-done', !!state.selectedService);
  $('badge-step-2').classList.toggle('is-done', state.staffChosen);
  $('badge-step-3').classList.toggle('is-done', !!state.selectedDate);
  $('badge-step-4').classList.toggle('is-done', !!state.selectedSlot);

  const svc = state.selectedService;
  $('rail-item-service').classList.toggle('is-done', !!svc);
  if (svc) {
    const p = formatPrice(svc);
    $('rail-val-service').textContent = `${svc.name} (${p.label})`;
    const notice = buildPriceNoticeCopy(svc);
    const railNotice = $('rail-price-notice');
    railNotice.classList.toggle('is-free', notice.isFree);
    $('rail-price-notice-text').textContent = notice.isFree
      ? 'Evaluación sin costo ni compromiso.'
      : `Precio referencial (${p.label}): puede variar dentro del salón según largo y estado del cabello.`;
    railNotice.hidden = false;
  } else {
    $('rail-val-service').textContent = 'Por elegir';
    $('rail-price-notice').hidden = true;
  }

  $('rail-item-staff').classList.toggle('is-done', state.staffChosen);
  $('rail-val-staff').textContent = state.staffChosen
    ? (state.selectedStaff ? state.selectedStaff.displayName : 'Primera especialista disponible')
    : 'Por elegir';

  $('rail-item-date').classList.toggle('is-done', !!state.selectedDate);
  $('rail-val-date').textContent = state.selectedDate ? formatDateShort(state.selectedDate) : 'Por elegir';

  $('rail-item-time').classList.toggle('is-done', !!state.selectedSlot);
  $('rail-val-time').textContent = state.selectedSlot
    ? `${formatTime12(state.selectedSlot.time)} – ${formatTime12(state.selectedSlot.endTime)}`
    : 'Por elegir';
}

/* ==================== PASO 1: SERVICIOS ==================== */
function renderCategories() {
  const grid = $('category-grid');
  const cats = (state.catalog?.categories || []).filter(c => c.code !== 'ASESORÍA');
  grid.innerHTML = cats.map(c => `
    <button
      type="button"
      class="cat-card${state.activeCategory === c.code ? ' is-active' : ''}"
      data-category="${escapeHtml(c.code)}"
      aria-pressed="${state.activeCategory === c.code ? 'true' : 'false'}"
    >
      <span class="cat-card-title">${escapeHtml(c.label)}</span>
      <span class="cat-card-count">${c.count} ${c.count === 1 ? 'opción' : 'opciones'}</span>
    </button>
  `).join('');
}

function renderServiceOptions({ autoScroll = false } = {}) {
  const wrap = $('service-options-wrap');
  const listEl = $('services-list');
  const titleEl = $('service-options-title');
  const q = normalizeSearch(state.search);

  if (!q && !state.activeCategory) {
    wrap.hidden = true;
    return;
  }

  const services = state.catalog?.services || [];
  const filtered = services.filter(s => {
    if (q) {
      const hay = normalizeSearch(`${s.name} ${s.categoryLabel} ${s.category}`);
      return hay.includes(q);
    }
    return s.category === state.activeCategory;
  }).sort((a, b) => a.name.localeCompare(b.name, 'es'));

  if (q) {
    titleEl.textContent = `Resultados para «${state.search.trim()}» (${filtered.length})`;
  } else {
    const cat = state.catalog.categories.find(c => c.code === state.activeCategory);
    titleEl.textContent = `${cat ? cat.label : 'Servicios'} (${filtered.length})`;
  }

  if (!filtered.length) {
    listEl.innerHTML = `
      <div class="empty-state">
        <p>No encontramos un servicio con «${escapeHtml(state.search)}».</p>
        <div class="empty-actions">
          <button type="button" class="secondary-btn" id="clear-search-empty-btn">Ver todas las categorías</button>
        </div>
      </div>
    `;
    $('clear-search-empty-btn')?.addEventListener('click', () => {
      state.search = '';
      state.activeCategory = null;
      $('service-search').value = '';
      $('service-search-clear').hidden = true;
      renderCategories();
      renderServiceOptions();
    });
  } else {
    listEl.innerHTML = filtered.map(s => {
      const p = formatPrice(s);
      const dur = formatDuration(s.durationMinutes, s.durationMaxMinutes);
      return `
        <button type="button" class="service-row" data-service-id="${escapeHtml(s.id)}">
          <span class="service-row-main">
            <span class="service-row-name">${escapeHtml(s.name)}</span>
            <span class="service-row-meta">Duración aprox.: ${escapeHtml(dur)}</span>
          </span>
          <span class="service-row-right">
            <span class="service-price ${p.cls}">${escapeHtml(p.label)}</span>
            <span class="ico ico-caret-right row-arrow" aria-hidden="true"></span>
          </span>
        </button>
      `;
    }).join('');
  }

  wrap.hidden = false;
  if (autoScroll) scrollToEl(wrap);
}

function renderFeaturedEval() {
  const featured = state.catalog?.services.find(s => s.featured);
  const btn = $('featured-eval-btn');
  if (featured) {
    $('featured-eval-name').textContent = featured.name;
    btn.dataset.serviceId = featured.id;
    btn.hidden = false;
  } else {
    btn.hidden = true;
  }
}

function selectService(serviceId) {
  const svc = state.catalog?.services.find(s => s.id === serviceId);
  if (!svc) return;

  state.selectedService = svc;
  state.staffChosen = false;
  state.selectedStaff = null;
  state.selectedDate = null;
  state.selectedSlot = null;
  state.daySlotsCache.clear();
  state.monthDaysMap.clear();

  const price = formatPrice(svc);
  $('chosen-service-name').textContent = svc.name;
  $('chosen-service-meta').textContent = `${formatDuration(svc.durationMinutes, svc.durationMaxMinutes)} · ${price.label}`;
  $('chosen-service-box').hidden = false;
  $('service-picker').hidden = true;

  const notice = buildPriceNoticeCopy(svc);
  const alertBox = $('service-price-alert');
  alertBox.classList.toggle('is-free', notice.isFree);
  $('service-price-alert-title').textContent = notice.title;
  $('service-price-alert-text').textContent = notice.text;
  alertBox.hidden = false;

  $('sec-date').hidden = true;
  $('sec-time').hidden = true;
  $('sec-details').hidden = true;

  renderStep2Staff();
  updateProgressAndRail();

  const eligible = getEligibleStaffFor(svc.id);
  if (eligible.length === 1) {
    selectStaff(eligible[0].id, { autoScrollTarget: $('service-price-alert') });
  } else {
    $('sec-staff').hidden = false;
    scrollToEl($('service-price-alert'));
  }
}

function reopenServicePicker() {
  state.selectedService = null;
  state.staffChosen = false;
  state.selectedStaff = null;
  state.selectedDate = null;
  state.selectedSlot = null;
  $('chosen-service-box').hidden = true;
  $('service-price-alert').hidden = true;
  $('service-picker').hidden = false;
  $('sec-staff').hidden = true;
  $('sec-date').hidden = true;
  $('sec-time').hidden = true;
  $('sec-details').hidden = true;
  renderCategories();
  renderServiceOptions();
  updateProgressAndRail();
  scrollToEl($('sec-service'));
}

/* ==================== PASO 2: ESPECIALISTA ==================== */
function getEligibleStaffFor(serviceId) {
  const entries = state.catalog?.serviceEligibleStaff?.[serviceId] || [];
  const ids = new Set(entries.map(e => (typeof e === 'string' ? e : e.staffId)));
  return (state.catalog?.staff || []).filter(m => ids.has(m.id));
}

function renderStep2Staff() {
  const eligible = getEligibleStaffFor(state.selectedService.id);
  $('chosen-staff-box').hidden = true;
  $('staff-picker').hidden = false;
  $('any-staff-btn').hidden = eligible.length <= 1;

  const list = $('staff-list');
  if (!eligible.length) {
    list.innerHTML = '<div class="empty-state"><p>Por ahora no hay especialistas habilitadas para este servicio.</p></div>';
    return;
  }

  list.innerHTML = eligible.map(m => `
    <button type="button" class="staff-row" data-staff-id="${escapeHtml(m.id)}">
      <span class="choice-avatar" aria-hidden="true">${escapeHtml(getInitials(m.displayName))}</span>
      <span class="choice-body">
        <span class="choice-title">${escapeHtml(m.displayName)}</span>
        <span class="choice-desc">${escapeHtml(m.specialtySummary)}</span>
      </span>
      <span class="ico ico-caret-right row-arrow" aria-hidden="true"></span>
    </button>
  `).join('');
}

async function selectStaff(staffId, { autoScrollTarget = null } = {}) {
  const eligible = getEligibleStaffFor(state.selectedService.id);
  state.staffChosen = true;
  state.selectedStaff = staffId ? (state.catalog.staff.find(m => m.id === staffId) || null) : null;
  state.selectedDate = null;
  state.selectedSlot = null;
  state.daySlotsCache.clear();
  state.monthDaysMap.clear();

  $('sec-staff').hidden = false;
  $('staff-picker').hidden = true;
  $('chosen-staff-box').hidden = false;
  $('chosen-staff-name').textContent = state.selectedStaff
    ? state.selectedStaff.displayName
    : 'Primera especialista disponible';
  $('chosen-staff-meta').textContent = state.selectedStaff
    ? state.selectedStaff.specialtySummary
    : 'Te mostraremos todos los horarios libres del equipo';
  $('change-staff-btn').hidden = eligible.length <= 1;

  $('sec-time').hidden = true;
  $('sec-details').hidden = true;
  $('sec-date').hidden = false;
  updateProgressAndRail();

  const targetMonth = state.catalog.today.slice(0, 7);
  await loadCalendarMonth(targetMonth);
  scrollToEl(autoScrollTarget || $('sec-date'));
}

function reopenStaffPicker() {
  state.staffChosen = false;
  state.selectedStaff = null;
  state.selectedDate = null;
  state.selectedSlot = null;
  $('chosen-staff-box').hidden = true;
  $('staff-picker').hidden = false;
  $('sec-date').hidden = true;
  $('sec-time').hidden = true;
  $('sec-details').hidden = true;
  updateProgressAndRail();
  scrollToEl($('sec-staff'));
}

/* ==================== PASO 3: CALENDARIO ESTILO CALENDLY ==================== */
async function loadCalendarMonth(ym) {
  state.monthView = ym;
  $('cal-month-title').textContent = formatMonthTitle(ym);
  const minMonth = state.catalog.today.slice(0, 7);
  const maxMonth = state.catalog.maxDate.slice(0, 7);
  $('cal-prev-btn').disabled = ym <= minMonth;
  $('cal-next-btn').disabled = ym >= maxMonth;

  const grid = $('cal-grid');
  grid.innerHTML = '<div class="skeleton-grid-placeholder" aria-label="Cargando días disponibles"></div>';

  try {
    const qs = new URLSearchParams({
      serviceId: state.selectedService.id,
      month: ym
    });
    if (state.selectedStaff) qs.set('staffId', state.selectedStaff.id);
    const data = await fetchJson(`/api/public/days?${qs.toString()}`);
    const days = data.days || [];
    for (const d of days) state.monthDaysMap.set(d.date, d);

    const hasOpen = days.some(d => !d.closed && d.availableCount > 0);
    if (!hasOpen && ym === minMonth && ym < maxMonth) {
      return loadCalendarMonth(addMonths(ym, 1));
    }
    renderCalendarGrid(days);
  } catch (err) {
    grid.innerHTML = `
      <div class="empty-state is-span-all">
        <p>${escapeHtml(err.message)}</p>
        <div class="empty-actions">
          <button type="button" class="secondary-btn" id="retry-cal-btn">Reintentar</button>
        </div>
      </div>
    `;
    $('retry-cal-btn')?.addEventListener('click', () => loadCalendarMonth(ym));
  }
}

function renderCalendarGrid(days) {
  const grid = $('cal-grid');
  if (!days.length) {
    grid.innerHTML = '';
    return;
  }
  const firstDow = new Date(days[0].date + 'T12:00:00Z').getUTCDay();
  const mondayOffset = (firstDow + 6) % 7;
  let html = '';
  for (let i = 0; i < mondayOffset; i++) {
    html += '<span aria-hidden="true"></span>';
  }
  for (const d of days) {
    const dayNum = Number(d.date.slice(8, 10));
    const available = !d.closed && d.availableCount > 0;
    const selected = d.date === state.selectedDate;
    const cls = selected ? 'cal-cell is-selected' : available ? 'cal-cell is-available' : 'cal-cell';
    html += `
      <button
        type="button"
        class="${cls}"
        data-cal-date="${escapeHtml(d.date)}"
        ${available ? '' : 'disabled'}
        aria-pressed="${selected ? 'true' : 'false'}"
        aria-label="${escapeHtml(formatDateLong(d.date))}${available ? `, ${d.availableCount} horarios disponibles` : ' (no disponible)'}"
      >${dayNum}</button>
    `;
  }
  grid.innerHTML = html;
}

/* ==================== PASO 4: HORAS DISPONIBLES ==================== */
async function selectDate(date) {
  state.selectedDate = date;
  state.selectedSlot = null;

  const monthDays = [...state.monthDaysMap.values()]
    .filter(d => d.date.startsWith(state.monthView))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (monthDays.length) renderCalendarGrid(monthDays);

  $('sec-details').hidden = true;
  $('sec-time').hidden = false;
  const label = formatDateLong(date);
  $('selected-day-banner').textContent = label.charAt(0).toUpperCase() + label.slice(1);
  updateProgressAndRail();

  const container = $('slots-container');
  const cacheKey = `${state.selectedService.id}|${state.selectedStaff?.id || 'ANY'}|${date}`;
  let data = state.daySlotsCache.get(cacheKey);

  if (!data) {
    container.innerHTML = '<div class="skeleton-row"></div><div class="skeleton-row"></div>';
    scrollToEl($('sec-time'));
    try {
      const qs = new URLSearchParams({ serviceId: state.selectedService.id, date });
      if (state.selectedStaff) qs.set('staffId', state.selectedStaff.id);
      data = await fetchJson(`/api/public/availability?${qs.toString()}`);
      state.daySlotsCache.set(cacheKey, data);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
      return;
    }
  }

  renderSlots(data);
  scrollToEl($('sec-time'));
}

function renderSlots(data) {
  const container = $('slots-container');
  const slots = data.slots || [];
  if (!slots.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Ya no quedan horas libres para este día.</p>
        <div class="empty-actions">
          ${state.selectedStaff && data.anyStaffAvailableCount > 0
            ? `<button type="button" class="primary-btn" id="switch-any-staff-btn">Ver ${data.anyStaffAvailableCount} horas con cualquier especialista</button>`
            : ''}
          <button type="button" class="secondary-btn" id="pick-other-day-btn">Elegir otro día</button>
        </div>
      </div>
    `;
    $('switch-any-staff-btn')?.addEventListener('click', () => {
      state.selectedStaff = null;
      $('chosen-staff-name').textContent = 'Primera especialista disponible';
      $('chosen-staff-meta').textContent = 'Te mostraremos todos los horarios libres del equipo';
      state.daySlotsCache.clear();
      selectDate(data.date);
    });
    $('pick-other-day-btn')?.addEventListener('click', () => scrollToEl($('sec-date')));
    return;
  }

  const morning = slots.filter(s => s.period === 'morning');
  const afternoon = slots.filter(s => s.period === 'afternoon');

  const renderGroup = (title, iconClass, items) => {
    if (!items.length) return '';
    return `
      <div class="slot-group">
        <div class="slot-group-head">
          <span class="ico ${iconClass}" aria-hidden="true"></span>
          <h3>${title}</h3>
        </div>
        <div class="slots-grid">
          ${items.map(s => `
            <button
              type="button"
              class="slot-btn${state.selectedSlot?.time === s.time ? ' is-selected' : ''}"
              data-time="${escapeHtml(s.time)}"
              data-end-time="${escapeHtml(s.endTime)}"
              aria-pressed="${state.selectedSlot?.time === s.time ? 'true' : 'false'}"
            >${escapeHtml(formatTime12(s.time))}</button>
          `).join('')}
        </div>
      </div>
    `;
  };

  container.innerHTML =
    renderGroup('Mañana', 'ico-sun-horizon', morning) +
    renderGroup('Tarde', 'ico-sun', afternoon);
}

/* ==================== PASO 5: CONFIRMAR RESERVA ==================== */
function selectTimeSlot(time, endTime) {
  state.selectedSlot = { time, endTime };
  document.querySelectorAll('.slot-btn').forEach(btn => {
    const active = btn.dataset.time === time;
    btn.classList.toggle('is-selected', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  renderFinalDetails();
  $('sec-details').hidden = false;
  updateProgressAndRail();
  scrollToEl($('sec-details'));
}

function renderFinalDetails() {
  const svc = state.selectedService;
  const price = formatPrice(svc);
  const dateLabel = formatDateLong(state.selectedDate);
  const capDate = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);
  const staffLabel = state.selectedStaff ? state.selectedStaff.displayName : 'Primera especialista disponible';

  $('final-review-service').textContent = `Servicio: ${svc.name} (${formatDuration(svc.durationMinutes, svc.durationMaxMinutes)} · ${price.label})`;
  $('final-review-when').textContent = `Día y hora: ${capDate}, ${formatTime12(state.selectedSlot.time)} – ${formatTime12(state.selectedSlot.endTime)}`;
  $('final-review-staff').textContent = `Especialista: ${staffLabel}`;

  const notice = buildPriceNoticeCopy(svc);
  const finalAlert = $('final-price-alert');
  finalAlert.classList.toggle('is-free', notice.isFree);
  $('final-price-alert-title').textContent = notice.isFree ? notice.title : 'Recuerda sobre el precio referencial';
  $('final-price-alert-text').textContent = notice.text;
  finalAlert.hidden = false;
  $('form-error').hidden = true;
}

async function handleBookingSubmit(event) {
  event.preventDefault();
  if (state.submitting || !state.client) return;
  $('form-error').hidden = true;

  state.submitting = true;
  setFormBusy('submit-booking-btn', true, 'Confirmar mi cita', 'Confirmando tu cita...');

  try {
    const res = await fetchJson('/api/public/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceId: state.selectedService.id,
        staffId: state.selectedStaff?.id || null,
        date: state.selectedDate,
        time: state.selectedSlot.time,
        notes: $('client-notes').value.trim()
      })
    });
    state.bookingResult = res;
    state.upcomingAppointments = [
      ...state.upcomingAppointments,
      {
        appointmentId: res.appointmentId,
        bookingCode: res.bookingCode,
        serviceName: res.serviceName,
        date: res.date,
        startTime: res.startTime,
        endTime: res.endTime,
        staffName: res.staffName
      }
    ].sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));

    renderConfirmation(res);
    $('booking-workspace').hidden = true;
    $('sec-confirmation').hidden = false;
    updateProgressAndRail();
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  } catch (err) {
    showBoxError('form-error', 'form-error-text', err.message);
    if (err.status === 409) {
      state.daySlotsCache.clear();
    }
  } finally {
    state.submitting = false;
    setFormBusy('submit-booking-btn', false, 'Confirmar mi cita', 'Confirmando tu cita...');
  }
}

/* ==================== COMPROBANTE Y CALENDARIO ==================== */
function toCalendarUtcStamp(ymd, hhmm) {
  const d = new Date(`${ymd}T${hhmm}:00-05:00`);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function buildIcsContent(b) {
  const startUtc = toCalendarUtcStamp(b.date, b.startTime);
  const endUtc = toCalendarUtcStamp(b.date, b.endTime);
  const nowUtc = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const summary = `Cita Touché Hair Studio — ${b.serviceName}`;
  const location = `${b.salon.address} (${b.salon.reference})`;
  const desc = [
    `Código de reserva: ${b.bookingCode}`,
    `Servicio: ${b.serviceName}`,
    `Especialista: ${b.staffName}`,
    `Ubicación: ${b.salon.address} (${b.salon.reference})`,
    `Soporte WhatsApp: 992 272 521`,
    `Mapa: ${b.salon.mapsUrl}`
  ].join('\\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Touche Hair Studio//Agenda Clientas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${b.appointmentId}@touchesalon.pe`,
    `DTSTAMP:${nowUtc}`,
    `DTSTART:${startUtc}`,
    `DTEND:${endUtc}`,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
    `DESCRIPTION:${desc}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Recordatorio de tu cita en Touché Hair Studio',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

function buildGoogleCalendarUrl(b) {
  const startUtc = toCalendarUtcStamp(b.date, b.startTime);
  const endUtc = toCalendarUtcStamp(b.date, b.endTime);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Cita Touché Hair Studio — ${b.serviceName}`,
    dates: `${startUtc}/${endUtc}`,
    location: `${b.salon.address} (${b.salon.reference})`,
    details: `Código de reserva: ${b.bookingCode}\nServicio: ${b.serviceName}\nEspecialista: ${b.staffName}\nSoporte Touché: 992 272 521\nCómo llegar: ${b.salon.mapsUrl}`
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function renderConfirmation(b) {
  $('ticket-code').textContent = b.bookingCode;
  $('ticket-service').textContent = `${b.serviceName} (${formatDuration(b.durationMinutes, b.durationMaxMinutes)})`;
  const dateLabel = formatDateLong(b.date);
  const capDate = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);
  $('ticket-datetime').textContent = `${capDate} · ${formatTime12(b.startTime)} – ${formatTime12(b.endTime)}`;
  $('ticket-staff').textContent = b.staffName;

  if (b.isFree) {
    $('ticket-price').textContent = 'Gratis (sin compromiso)';
  } else if (b.priceCents != null) {
    const soles = Math.round(b.priceCents / 100);
    $('ticket-price').textContent = `Desde S/ ${soles} (referencial: puede variar en salón según largo y estado del cabello)`;
  } else {
    $('ticket-price').textContent = 'Según evaluación en salón';
  }

  $('ticket-address').textContent = b.salon.address;
  $('ticket-reference').textContent = b.salon.reference;

  $('ticket-tip-text').textContent = b.serviceCategory === 'COLOR'
    ? 'No necesitas venir con el cabello lavado; lo lavamos aquí antes de iniciar tu servicio. Recuerda tocar el timbre 201.'
    : 'Te recomendamos llegar 10 minutos antes de tu cita y tocar el timbre 201. Aceptamos tarjetas en cuotas sin intereses, Yape, Plin y efectivo.';

  $('gcal-link').href = buildGoogleCalendarUrl(b);
  $('maps-link').href = b.salon.mapsUrl;
  const waText = `Hola Touché, acabo de reservar mi cita (${b.bookingCode}) para ${b.serviceName} el ${capDate} a las ${formatTime12(b.startTime)}. Tengo una consulta:`;
  $('ticket-whatsapp-link').href = `${SUPPORT_WA}?text=${encodeURIComponent(waText)}`;
}

function downloadIcs() {
  const b = state.bookingResult;
  if (!b) return;
  const content = buildIcsContent(b);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cita-touche-${b.date}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function resetBookingSelection() {
  state.search = '';
  state.activeCategory = null;
  state.selectedService = null;
  state.staffChosen = false;
  state.selectedStaff = null;
  state.selectedDate = null;
  state.selectedSlot = null;
  state.bookingResult = null;
  state.daySlotsCache.clear();
  state.monthDaysMap.clear();

  $('service-search').value = '';
  $('service-search-clear').hidden = true;
  $('client-notes').value = '';

  $('chosen-service-box').hidden = true;
  $('service-price-alert').hidden = true;
  $('service-picker').hidden = false;
  $('service-options-wrap').hidden = true;
  $('sec-staff').hidden = true;
  $('sec-date').hidden = true;
  $('sec-time').hidden = true;
  $('sec-details').hidden = true;

  if (state.catalog) {
    renderFeaturedEval();
    renderCategories();
  }
}

/* ==================== BOOTSTRAP Y EVENTOS ==================== */
async function loadCatalog() {
  $('global-error').hidden = true;
  try {
    state.catalog = await fetchJson('/api/public/catalog');
    renderFeaturedEval();
    renderCategories();
    updateProgressAndRail();
  } catch (err) {
    $('global-error-text').textContent = err.message;
    $('global-error').hidden = false;
    $('category-grid').innerHTML = '';
  }
}

async function bootstrap() {
  $('global-error').hidden = true;
  try {
    const [me] = await Promise.all([fetchJson('/api/client/me'), loadCatalog()]);
    if (me.authenticated && me.client) {
      await enterBookingWorkspace(me.client, me.upcomingAppointments || []);
    } else {
      showGateView('welcome');
    }
  } catch (err) {
    $('global-error-text').textContent = err.message;
    $('global-error').hidden = false;
  }
}

function bindEvents() {
  $('global-retry-btn').addEventListener('click', () => bootstrap());
  $('brand-home-link').addEventListener('click', e => {
    e.preventDefault();
    if (state.client) {
      $('sec-confirmation').hidden = true;
      $('booking-workspace').hidden = false;
      renderClientProfileBars();
      resetBookingSelection();
      updateProgressAndRail();
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } else {
      showGateView('welcome');
    }
  });

  // Gate navigation
  $('btn-returning-salon').addEventListener('click', () => showGateView('claim-search'));
  $('btn-first-time-salon').addEventListener('click', () => showGateView('register'));
  $('btn-go-login').addEventListener('click', () => showGateView('login'));
  $('btn-not-found-register').addEventListener('click', () => {
    showGateView('register', { prefillName: $('claim-name-search').value.trim(), fromNotFound: true });
  });

  $('logout-btn').addEventListener('click', () => handleLogout());
  $('mobile-logout-btn').addEventListener('click', () => handleLogout());

  // Unclaimed name search (debounced)
  const claimSearch = $('claim-name-search');
  const claimClear = $('claim-search-clear');
  claimSearch.addEventListener('input', () => {
    claimClear.hidden = !claimSearch.value;
    clearTimeout(state.claimSearchTimer);
    state.claimSearchTimer = setTimeout(() => runUnclaimedNameSearch(claimSearch.value), 180);
  });
  claimClear.addEventListener('click', () => {
    claimSearch.value = '';
    claimClear.hidden = true;
    runUnclaimedNameSearch('');
    claimSearch.focus();
  });

  // Clean DNI numeric fields
  for (const id of ['claim-dni', 'reg-dni']) {
    $(id).addEventListener('input', e => {
      const clean = e.target.value.replace(/\D/g, '').slice(0, 8);
      if (e.target.value !== clean) e.target.value = clean;
    });
  }

  // Gate forms
  $('claim-form').addEventListener('submit', handleClaimSubmit);
  $('register-form').addEventListener('submit', handleRegisterSubmit);
  $('login-form').addEventListener('submit', handleLoginSubmit);

  // Booking workspace events
  $('change-service-btn').addEventListener('click', () => reopenServicePicker());
  $('change-staff-btn').addEventListener('click', () => reopenStaffPicker());
  $('any-staff-btn').addEventListener('click', () => selectStaff(null));

  $('close-category-btn').addEventListener('click', () => {
    state.activeCategory = null;
    state.search = '';
    $('service-search').value = '';
    $('service-search-clear').hidden = true;
    renderCategories();
    renderServiceOptions();
    scrollToEl($('category-prompt'));
  });

  const searchInput = $('service-search');
  const searchClear = $('service-search-clear');
  searchInput.addEventListener('input', () => {
    state.search = searchInput.value;
    searchClear.hidden = !state.search;
    renderServiceOptions({ autoScroll: false });
  });
  searchClear.addEventListener('click', () => {
    state.search = '';
    searchInput.value = '';
    searchClear.hidden = true;
    renderServiceOptions();
    searchInput.focus();
  });

  document.addEventListener('click', e => {
    const togglePass = e.target.closest('[data-toggle-pass]');
    if (togglePass) {
      const input = $(togglePass.dataset.togglePass);
      if (input) {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        togglePass.textContent = show ? 'Ocultar' : 'Mostrar';
      }
      return;
    }

    const gateBtn = e.target.closest('[data-gate-view]');
    if (gateBtn) {
      showGateView(gateBtn.dataset.gateView);
      return;
    }

    const claimBtn = e.target.closest('[data-claim-id]');
    if (claimBtn) {
      selectUnclaimedName(claimBtn.dataset.claimId);
      return;
    }

    const catBtn = e.target.closest('[data-category]');
    if (catBtn) {
      state.search = '';
      $('service-search').value = '';
      $('service-search-clear').hidden = true;
      state.activeCategory = catBtn.dataset.category;
      renderCategories();
      renderServiceOptions({ autoScroll: true });
      return;
    }

    const svcBtn = e.target.closest('[data-service-id]');
    if (svcBtn) {
      selectService(svcBtn.dataset.serviceId);
      return;
    }

    const staffBtn = e.target.closest('[data-staff-id]');
    if (staffBtn) {
      selectStaff(staffBtn.dataset.staffId);
      return;
    }

    const calBtn = e.target.closest('[data-cal-date]');
    if (calBtn && !calBtn.disabled) {
      selectDate(calBtn.dataset.calDate);
      return;
    }

    const slotBtn = e.target.closest('.slot-btn');
    if (slotBtn) {
      selectTimeSlot(slotBtn.dataset.time, slotBtn.dataset.endTime);
    }
  });

  $('cal-prev-btn').addEventListener('click', () => {
    if (state.monthView) loadCalendarMonth(addMonths(state.monthView, -1));
  });
  $('cal-next-btn').addEventListener('click', () => {
    if (state.monthView) loadCalendarMonth(addMonths(state.monthView, 1));
  });

  $('booking-form').addEventListener('submit', handleBookingSubmit);
  $('download-ics-btn').addEventListener('click', downloadIcs);
  $('book-another-btn').addEventListener('click', () => {
    $('sec-confirmation').hidden = true;
    $('booking-workspace').hidden = false;
    renderClientProfileBars();
    resetBookingSelection();
    updateProgressAndRail();
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

bindEvents();
bootstrap();
