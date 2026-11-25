const WEEKDAY_NAMES_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WEEKDAY_NAMES_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const SALON_WA = 'https://wa.me/51986732957';
const SALON_PHONE_DISPLAY = '986 732 957';
const VIP_CLUB_URL = 'https://chat.whatsapp.com/FOmwXgSPb5u4YLbK5ZiXai?s=sh&p=a&iam=2';

const STEP_LABELS = {
  1: 'Paso 1 de 4 · Servicios',
  2: 'Paso 2 de 4 · Tus datos',
  3: 'Paso 3 de 4 · Día y hora',
  4: 'Paso 4 de 4 · Confirmar',
  5: '¡Cita registrada!'
};

const CATEGORY_EMOJIS = {
  COLOR: '🎨',
  CORTE: '✂️',
  TRATAMIENTO: '💆‍♀️',
  'QUÍMICO': '✨',
  PEINADO: '💇‍♀️',
  'MANOS / PIES': '💅',
  MAQUILLAJE: '💄',
  DEPILACION: '🌿',
  'ASESORÍA': '💬'
};

const state = {
  client: null,
  upcomingAppointments: [],
  catalog: null,
  gateOpen: false,
  gateView: 'welcome',
  claimTarget: null,
  claimSearchTimer: null,
  claimSearchSeq: 0,
  calendarSeq: 0,
  slotsSeq: 0,
  activeStep: 1,
  search: '',
  activeCategory: null,
  selectedService: null,
  guestData: { name: '', phone: '', dni: '', birthday: '' },
  dataConfirmed: false,
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
      }, prefersReducedMotion() ? 0 : 260);
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

function firstNameOf(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || 'Clienta';
}

function activePersonInfo() {
  if (state.client) {
    return {
      name: state.client.name || '',
      phone: state.client.phone || '',
      dni: state.client.dni || '',
      birthday: state.client.birthday || '',
      email: state.client.email || ''
    };
  }
  return { ...state.guestData, email: '' };
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
  clearTimeout(window.__welcomeToastTimer);
  window.__welcomeToastTimer = setTimeout(() => {
    $('welcome-toast').hidden = true;
  }, 6000);
}

function setFieldError(inputId, errId, msg) {
  const inp = $(inputId);
  const err = $(errId);
  if (err) err.textContent = msg || '';
  if (inp) {
    if (msg) inp.setAttribute('aria-invalid', 'true');
    else inp.removeAttribute('aria-invalid');
  }
}

function setFormBusy(btnId, busy, idleLabel, busyLabel) {
  const btn = $(btnId);
  if (!btn) return;
  btn.disabled = busy;
  const lbl = btn.querySelector('.btn-label');
  const sp = btn.querySelector('.btn-spinner');
  if (lbl) lbl.textContent = busy ? busyLabel : idleLabel;
  if (sp) sp.hidden = !busy;
}

function showBoxError(boxId, textId, msg) {
  const el = $(boxId);
  if (!el) return;
  $(textId).textContent = msg;
  el.hidden = false;
  el.classList.remove('is-shaking');
  void el.offsetWidth;
  el.classList.add('is-shaking');
  scrollToEl(el);
}

/* ==================== PANEL OPCIONAL DE CUENTA (GATE) ==================== */
function openAccountGate(viewName = 'welcome', { prefillName = '', fromNotFound = false } = {}) {
  state.gateOpen = true;
  state.gateView = viewName;
  $('gate-shell').hidden = false;
  $('booking-workspace').hidden = true;
  $('sec-confirmation').hidden = true;
  $('step-indicator').hidden = true;
  $('progress-track').hidden = true;

  const views = ['welcome', 'claim-search', 'claim-complete', 'register', 'login'];
  for (const v of views) {
    $(`view-${v}`).hidden = v !== viewName;
  }

  if (viewName === 'claim-search') {
    setTimeout(() => $('claim-name-search')?.focus(), 80);
  } else if (viewName === 'register') {
    $('register-heading').textContent = fromNotFound
      ? 'Te agregamos como clienta de Touché'
      : 'Crea tu cuenta de clienta Touché';
    $('register-sub').textContent = fromNotFound
      ? 'Completa tus datos aquí para crear tu ficha y tu acceso.'
      : 'Solo te pedimos estos datos una vez. Así podrás reservar siempre en segundos.';
    const srcName = prefillName || state.guestData.name;
    if (srcName && !$('reg-name').value.trim()) $('reg-name').value = srcName;
    if (state.guestData.phone && !$('reg-phone').value.trim()) $('reg-phone').value = state.guestData.phone;
    if (state.guestData.dni && !$('reg-dni').value.trim()) $('reg-dni').value = state.guestData.dni;
    if (state.guestData.birthday && !$('reg-birthday').value) $('reg-birthday').value = state.guestData.birthday;
    $('reg-error').hidden = true;
    setTimeout(() => $('reg-name')?.focus(), 80);
  } else if (viewName === 'login') {
    $('login-error').hidden = true;
    setTimeout(() => $('login-email')?.focus(), 80);
  } else if (viewName === 'claim-complete') {
    $('claim-error').hidden = true;
    setTimeout(() => $('claim-email')?.focus(), 80);
  }

  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

function closeAccountGate() {
  state.gateOpen = false;
  $('gate-shell').hidden = true;
  if (state.bookingResult) {
    $('sec-confirmation').hidden = false;
    $('booking-workspace').hidden = true;
  } else {
    $('sec-confirmation').hidden = true;
    $('booking-workspace').hidden = false;
  }
  $('step-indicator').hidden = false;
  $('progress-track').hidden = false;
  updateProgressAndRail();
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

async function runUnclaimedNameSearch(query) {
  const wrap = $('claim-results-wrap');
  const trimmed = query.trim();
  const seq = ++state.claimSearchSeq;
  if (trimmed.length < 2) {
    wrap.innerHTML = '<p class="claim-hint">Escribe al menos 2 letras de tu nombre para ver coincidencias.</p>';
    return;
  }
  wrap.innerHTML = '<div class="skeleton-row"></div>';
  try {
    const data = await fetchJson(`/api/client/unclaimed-names?q=${encodeURIComponent(trimmed)}`);
    if (seq !== state.claimSearchSeq) return;
    const results = data.results || [];
    if (!results.length) {
      wrap.innerHTML = `<p class="claim-hint">No encontramos «${escapeHtml(trimmed)}» en la lista disponible. Usa el botón de abajo para crear tu cuenta.</p>`;
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
    if (seq !== state.claimSearchSeq) return;
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
    $('claim-phone').value = state.guestData.phone || '';
    $('claim-dni').value = state.guestData.dni || '';
    $('claim-birthday').value = state.guestData.birthday || '';
    setFieldError('claim-email', 'err-claim-email', '');
    setFieldError('claim-password', 'err-claim-password', '');
    setFieldError('claim-phone', 'err-claim-phone', '');
    setFieldError('claim-dni', 'err-claim-dni', '');
    openAccountGate('claim-complete');
  } catch (err) {
    $('claim-results-wrap').innerHTML = `<p class="claim-hint">${escapeHtml(err.message)}</p>`;
  }
}

function applyAuthenticatedClient(client, upcomingAppointments = [], toastMsg = '') {
  state.client = client;
  state.upcomingAppointments = upcomingAppointments;
  state.claimTarget = null;
  state.dataConfirmed = true;
  renderClientProfileBars();
  if (state.gateOpen) closeAccountGate();
  else updateProgressAndRail();
  if (toastMsg) showWelcomeToast(toastMsg);
}

async function handleClaimSubmit(event) {
  event.preventDefault();
  if (state.submitting || !state.claimTarget) return;
  $('claim-error').hidden = true;
  setFieldError('claim-email', 'err-claim-email', '');
  setFieldError('claim-password', 'err-claim-password', '');
  setFieldError('claim-phone', 'err-claim-phone', '');
  setFieldError('claim-dni', 'err-claim-dni', '');

  const email = $('claim-email').value.trim();
  const password = $('claim-password').value;
  const phone = $('claim-phone').value.trim();
  const dni = $('claim-dni').value.replace(/\D/g, '').slice(0, 8);
  const birthday = $('claim-birthday').value.trim();

  if (!email.includes('@')) {
    setFieldError('claim-email', 'err-claim-email', 'Ingresa un correo válido (ej. tu@correo.com).');
    $('claim-email').focus();
    return;
  }
  if (password.length < 6) {
    setFieldError('claim-password', 'err-claim-password', 'Crea una contraseña de al menos 6 caracteres.');
    $('claim-password').focus();
    return;
  }
  if (phone.replace(/\D/g, '').length < 7) {
    setFieldError('claim-phone', 'err-claim-phone', 'Ingresa un celular válido (ej. 987 654 321).');
    $('claim-phone').focus();
    return;
  }
  if (state.claimTarget.needsDni && !/^\d{8}$/.test(dni)) {
    setFieldError('claim-dni', 'err-claim-dni', 'Ingresa tu DNI de 8 números.');
    $('claim-dni').focus();
    return;
  }

  state.submitting = true;
  setFormBusy('claim-submit-btn', true, 'Activar mi cuenta y continuar', 'Activando tu cuenta...');
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
    applyAuthenticatedClient(res.client, res.upcomingAppointments || [], '¡Cuenta activada! Tus datos quedaron listos para reservar.');
  } catch (err) {
    showBoxError('claim-error', 'claim-error-text', err.message);
  } finally {
    state.submitting = false;
    setFormBusy('claim-submit-btn', false, 'Activar mi cuenta y continuar', 'Activando tu cuenta...');
  }
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  if (state.submitting) return;
  $('reg-error').hidden = true;
  setFieldError('reg-name', 'err-reg-name', '');
  setFieldError('reg-email', 'err-reg-email', '');
  setFieldError('reg-password', 'err-reg-password', '');
  setFieldError('reg-phone', 'err-reg-phone', '');
  setFieldError('reg-dni', 'err-reg-dni', '');

  const name = $('reg-name').value.trim().replace(/\s+/g, ' ');
  const email = $('reg-email').value.trim();
  const password = $('reg-password').value;
  const phone = $('reg-phone').value.trim();
  const dni = $('reg-dni').value.replace(/\D/g, '').slice(0, 8);
  const birthday = $('reg-birthday').value.trim();

  if (name.length < 2) {
    setFieldError('reg-name', 'err-reg-name', 'Escribe tu nombre y apellido.');
    $('reg-name').focus();
    return;
  }
  if (phone.replace(/\D/g, '').length < 7) {
    setFieldError('reg-phone', 'err-reg-phone', 'Ingresa un celular válido (ej. 987 654 321).');
    $('reg-phone').focus();
    return;
  }
  if (!/^\d{8}$/.test(dni)) {
    setFieldError('reg-dni', 'err-reg-dni', 'Ingresa tu DNI de 8 números.');
    $('reg-dni').focus();
    return;
  }
  if (!email.includes('@')) {
    setFieldError('reg-email', 'err-reg-email', 'Ingresa un correo válido (ej. tu@correo.com).');
    $('reg-email').focus();
    return;
  }
  if (password.length < 6) {
    setFieldError('reg-password', 'err-reg-password', 'Crea una contraseña de al menos 6 caracteres.');
    $('reg-password').focus();
    return;
  }

  state.submitting = true;
  setFormBusy('reg-submit-btn', true, 'Crear mi cuenta y continuar', 'Creando tu cuenta...');
  try {
    const res = await fetchJson('/api/client/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, phone, dni, birthday })
    });
    applyAuthenticatedClient(res.client, res.upcomingAppointments || [], '¡Bienvenida al Club Touché! Tu cuenta quedó guardada.');
  } catch (err) {
    showBoxError('reg-error', 'reg-error-text', err.message);
  } finally {
    state.submitting = false;
    setFormBusy('reg-submit-btn', false, 'Crear mi cuenta y continuar', 'Creando tu cuenta...');
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
    applyAuthenticatedClient(res.client, res.upcomingAppointments || [], `¡Hola de nuevo, ${firstNameOf(res.client.name)}!`);
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
  state.dataConfirmed = false;
  state.guestData = { name: '', phone: '', dni: '', birthday: '' };
  renderClientProfileBars();
  resetBookingSelection();
  updateProgressAndRail();
  showWelcomeToast('Sesión cerrada correctamente.');
}

/* ==================== PERFIL Y PROGRESO DEL FLUJO (4 PASOS) ==================== */
function renderClientProfileBars() {
  const c = state.client;
  const loggedIn = !!c;

  $('open-login-btn').hidden = loggedIn;
  $('logout-btn').hidden = !loggedIn;
  $('quick-account-strip').hidden = loggedIn;
  $('client-bar').hidden = !loggedIn;
  $('signed-in-data-card').hidden = !loggedIn;
  $('guest-fields-wrap').hidden = loggedIn;

  if (loggedIn) {
    const first = firstNameOf(c.name);
    $('rail-client-greeting').textContent = `Hola, ${first}`;
    $('rail-client-email').textContent = c.email;
    $('client-bar-name').textContent = `Hola, ${first}`;
    $('client-bar-email').textContent = c.email;

    const metaParts = [c.email];
    if (c.phone) metaParts.push(`Cel. ${c.phone}`);
    if (c.dni) metaParts.push(`DNI ${c.dni}`);
    const metaText = metaParts.join(' · ');
    $('step2-account-name').textContent = c.name;
    $('step2-account-meta').textContent = metaText;
    $('booking-account-name').textContent = c.name;
    $('booking-account-meta').textContent = metaText;

    // Prefill advisory call inputs too
    if (!$('adv-name').value) $('adv-name').value = c.name;
    if (!$('adv-phone').value && c.phone) $('adv-phone').value = c.phone;
  } else {
    $('rail-client-greeting').textContent = 'Bienvenida a Touché Hair Studio';
    $('rail-client-email').textContent = 'Reserva tu cita en 4 pasos simples';
  }

  const strip = $('upcoming-strip');
  const list = $('upcoming-list');
  if (loggedIn && state.upcomingAppointments.length) {
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

function goToStep(targetStep) {
  if (targetStep === 1) {
    state.activeStep = 1;
    state.bookingResult = null;
  } else if (targetStep === 2 && state.selectedService) {
    state.activeStep = 2;
  } else if (targetStep === 3 && state.selectedService && (state.dataConfirmed || state.client)) {
    state.activeStep = 3;
    ensureScheduleLoaded();
  } else if (targetStep === 4 && state.selectedService && (state.dataConfirmed || state.client) && state.selectedDate && state.selectedSlot) {
    state.activeStep = 4;
    renderAccountChoiceStep();
  }
  updateProgressAndRail();
  scrollToEl($('booking-workspace'));
}

function updateProgressAndRail() {
  const step = state.bookingResult ? 5 : state.activeStep;
  $('step-indicator').textContent = STEP_LABELS[step] || STEP_LABELS[1];
  $('progress-track').setAttribute('aria-valuenow', String(Math.min(step, 4)));
  $('progress-fill').className = `progress-fill is-step-${step}`;

  if (!state.bookingResult && !state.gateOpen) {
    $('sec-service').hidden = step !== 1;
    $('sec-client-data').hidden = step !== 2;
    $('sec-schedule').hidden = step !== 3;
    $('sec-account-choice').hidden = step !== 4;
  }

  const person = activePersonInfo();
  const hasData = !!(state.client || (state.dataConfirmed && person.name && person.phone && person.dni));
  const hasSchedule = !!(state.selectedDate && state.selectedSlot);

  const doneFlags = {
    1: !!state.selectedService,
    2: hasData,
    3: hasSchedule,
    4: !!state.bookingResult
  };
  for (let i = 1; i <= 4; i++) {
    const node = $(`stepper-${i}`);
    if (!node) continue;
    const isCurrent = step === i;
    const isDone = doneFlags[i] && step > i;
    node.classList.toggle('is-current', isCurrent);
    node.classList.toggle('is-done', isDone);
    node.disabled = i > 1 && !doneFlags[i - 1] && i > step;
    const numEl = node.querySelector('.stepper-num');
    if (numEl) numEl.textContent = isDone ? '✓' : String(i);
  }

  // Compact selected chips bar (Steps 2..4)
  const picksStrip = $('canvas-picks-strip');
  if (picksStrip) {
    const chips = [];
    if (state.selectedService && step > 1) {
      chips.push(`<button type="button" class="pick-chip" data-jump-step="1"><span>✓ ${escapeHtml(state.selectedService.name)}</span><small>Cambiar</small></button>`);
    }
    if (hasData && step > 2) {
      chips.push(`<button type="button" class="pick-chip" data-jump-step="2"><span>✓ ${escapeHtml(firstNameOf(person.name))}</span><small>Editar</small></button>`);
    }
    if (hasSchedule && step > 3) {
      chips.push(`<button type="button" class="pick-chip" data-jump-step="3"><span>✓ ${escapeHtml(formatDateShort(state.selectedDate))} · ${escapeHtml(formatTime12(state.selectedSlot.time))}</span><small>Cambiar</small></button>`);
    }
    picksStrip.innerHTML = chips.join('');
    picksStrip.hidden = chips.length === 0;
  }

  // Desktop left summary rail
  $('rail-item-service').classList.toggle('is-done', !!state.selectedService);
  $('rail-item-service').classList.toggle('is-active', step === 1);
  $('rail-val-service').textContent = state.selectedService
    ? `${state.selectedService.name} (${formatDuration(state.selectedService.durationMinutes, state.selectedService.durationMaxMinutes)})`
    : 'Por elegir';

  $('rail-item-data').classList.toggle('is-done', hasData);
  $('rail-item-data').classList.toggle('is-active', step === 2);
  $('rail-val-data').textContent = hasData ? `${person.name} · ${person.phone}` : 'Por completar';

  $('rail-item-schedule').classList.toggle('is-done', hasSchedule);
  $('rail-item-schedule').classList.toggle('is-active', step === 3);
  $('rail-val-schedule').textContent = hasSchedule
    ? `${formatDateShort(state.selectedDate)} · ${formatTime12(state.selectedSlot.time)}`
    : 'Por elegir';

  $('rail-item-account').classList.toggle('is-done', !!state.bookingResult);
  $('rail-item-account').classList.toggle('is-active', step === 4);
  $('rail-val-account').textContent = state.client
    ? 'Cuenta activa · Confirmar'
    : 'Crear cuenta o Ahora no';
}

/* ==================== PASO 1: CATÁLOGO DE SERVICIOS (SIN PRECIOS) ==================== */
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
      <span class="cat-card-emoji" aria-hidden="true">${CATEGORY_EMOJIS[c.code] || '✨'}</span>
      <span class="cat-card-body">
        <span class="cat-card-title">${escapeHtml(c.label)}</span>
        <span class="cat-card-count">${c.count} ${c.count === 1 ? 'servicio' : 'servicios'}</span>
      </span>
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
    // ZERO prices shown anywhere — ONLY service name + approximate duration
    listEl.innerHTML = filtered.map(s => {
      const dur = formatDuration(s.durationMinutes, s.durationMaxMinutes);
      return `
        <button type="button" class="service-row" data-service-id="${escapeHtml(s.id)}">
          <span class="service-row-main">
            <span class="service-row-name">${escapeHtml(s.name)}</span>
            <span class="service-row-meta">Duración aprox.: ${escapeHtml(dur)}</span>
          </span>
          <span class="service-row-right">
            <span class="service-pick-tag">Elegir</span>
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
  state.selectedStaff = null;
  state.selectedDate = null;
  state.selectedSlot = null;
  state.monthView = null;
  state.daySlotsCache.clear();
  state.monthDaysMap.clear();

  // Auto-select sole eligible specialist if only 1 exists
  const eligible = getEligibleStaffFor(svc.id);
  if (eligible.length === 1) {
    state.selectedStaff = eligible[0];
  }

  state.activeStep = 2;
  updateProgressAndRail();
  scrollToEl($('booking-workspace'), { focusEl: state.client ? $('continue-to-schedule-btn') : $('guest-name') });
}

/* ==================== PASO 2: TUS DATOS ==================== */
function handleGuestDataSubmit(event) {
  event.preventDefault();
  if (state.client) {
    state.dataConfirmed = true;
    goToStep(3);
    return;
  }

  setFieldError('guest-name', 'err-guest-name', '');
  setFieldError('guest-phone', 'err-guest-phone', '');
  setFieldError('guest-dni', 'err-guest-dni', '');

  const name = $('guest-name').value.trim().replace(/\s+/g, ' ');
  const phone = $('guest-phone').value.trim();
  const dni = $('guest-dni').value.replace(/\D/g, '').slice(0, 8);
  const birthday = $('guest-birthday').value.trim();

  if (name.length < 2) {
    setFieldError('guest-name', 'err-guest-name', 'Escribe tu nombre y apellido.');
    $('guest-name').focus();
    return;
  }
  if (phone.replace(/\D/g, '').length < 7) {
    setFieldError('guest-phone', 'err-guest-phone', 'Ingresa un celular válido (ej. 987 654 321).');
    $('guest-phone').focus();
    return;
  }
  if (!/^\d{8}$/.test(dni)) {
    setFieldError('guest-dni', 'err-guest-dni', 'Ingresa tu DNI de 8 números.');
    $('guest-dni').focus();
    return;
  }

  state.guestData = { name, phone, dni, birthday };
  state.dataConfirmed = true;
  if (!$('adv-name').value) $('adv-name').value = name;
  if (!$('adv-phone').value) $('adv-phone').value = phone;

  goToStep(3);
}

/* ==================== PASO 3: CITA — ESPECIALISTA, CALENDARIO Y HORA ==================== */
function getEligibleStaffFor(serviceId) {
  const entries = state.catalog?.serviceEligibleStaff?.[serviceId] || [];
  const ids = new Set(entries.map(e => (typeof e === 'string' ? e : e.staffId)));
  return (state.catalog?.staff || []).filter(m => ids.has(m.id));
}

function renderStaffPills() {
  const box = $('schedule-staff-box');
  const row = $('staff-pills-row');
  if (!state.selectedService || !row) return;
  const eligible = getEligibleStaffFor(state.selectedService.id);
  if (eligible.length <= 1) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const currentId = state.selectedStaff?.id || '';
  const pills = [
    `<button type="button" class="staff-chip-btn${currentId === '' ? ' is-selected' : ''}" data-pick-staff="" aria-pressed="${currentId === '' ? 'true' : 'false'}">✨ Primera disponible</button>`,
    ...eligible.map(m => `
      <button type="button" class="staff-chip-btn${currentId === m.id ? ' is-selected' : ''}" data-pick-staff="${escapeHtml(m.id)}" aria-pressed="${currentId === m.id ? 'true' : 'false'}">${escapeHtml(m.shortName || m.displayName)}</button>
    `)
  ];
  row.innerHTML = pills.join('');
}

function ensureScheduleLoaded() {
  renderStaffPills();
  const targetMonth = state.monthView || state.catalog?.today?.slice(0, 7);
  if (targetMonth && !state.monthDaysMap.size) {
    loadCalendarMonth(targetMonth);
  }
  $('schedule-time-wrap').hidden = !state.selectedDate;
  $('schedule-notes-wrap').hidden = !state.selectedSlot;
  $('schedule-continue-wrap').hidden = !state.selectedSlot;
}

async function switchScheduleStaff(staffId) {
  state.selectedStaff = staffId ? (state.catalog.staff.find(m => m.id === staffId) || null) : null;
  state.selectedDate = null;
  state.selectedSlot = null;
  state.daySlotsCache.clear();
  state.monthDaysMap.clear();
  $('schedule-time-wrap').hidden = true;
  $('schedule-notes-wrap').hidden = true;
  $('schedule-continue-wrap').hidden = true;
  renderStaffPills();
  updateProgressAndRail();
  const targetMonth = state.catalog.today.slice(0, 7);
  await loadCalendarMonth(targetMonth);
}

async function loadCalendarMonth(ym) {
  const seq = ++state.calendarSeq;
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
    if (seq !== state.calendarSeq) return;
    const days = data.days || [];
    for (const d of days) state.monthDaysMap.set(d.date, d);

    const hasOpen = days.some(d => !d.closed && d.availableCount > 0);
    if (!hasOpen && ym === minMonth && ym < maxMonth) {
      return loadCalendarMonth(addMonths(ym, 1));
    }
    renderCalendarGrid(days);
  } catch (err) {
    if (seq !== state.calendarSeq) return;
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

async function selectDate(date) {
  const seq = ++state.slotsSeq;
  state.selectedDate = date;
  state.selectedSlot = null;

  const monthDays = [...state.monthDaysMap.values()]
    .filter(d => d.date.startsWith(state.monthView))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (monthDays.length) renderCalendarGrid(monthDays);

  $('schedule-time-wrap').hidden = false;
  $('schedule-notes-wrap').hidden = true;
  $('schedule-continue-wrap').hidden = true;

  const label = formatDateLong(date);
  $('selected-day-banner').textContent = `Horarios libres · ${label.charAt(0).toUpperCase() + label.slice(1)}`;
  updateProgressAndRail();

  const container = $('slots-container');
  const cacheKey = `${state.selectedService.id}|${state.selectedStaff?.id || 'ANY'}|${date}`;
  let data = state.daySlotsCache.get(cacheKey);

  if (!data) {
    container.innerHTML = '<div class="skeleton-row"></div>';
    scrollToEl($('schedule-time-wrap'));
    try {
      const qs = new URLSearchParams({ serviceId: state.selectedService.id, date });
      if (state.selectedStaff) qs.set('staffId', state.selectedStaff.id);
      data = await fetchJson(`/api/public/availability?${qs.toString()}`);
      if (seq !== state.slotsSeq) return;
      state.daySlotsCache.set(cacheKey, data);
    } catch (err) {
      if (seq !== state.slotsSeq) return;
      container.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
      return;
    }
  }

  renderSlots(data);
  scrollToEl($('schedule-time-wrap'));
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
            ? `<button type="button" class="primary-btn" id="switch-any-staff-btn">Ver ${data.anyStaffAvailableCount} horas con primera disponible</button>`
            : ''}
        </div>
      </div>
    `;
    $('switch-any-staff-btn')?.addEventListener('click', () => switchScheduleStaff(''));
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

function selectTimeSlot(time, endTime) {
  state.selectedSlot = { time, endTime };
  document.querySelectorAll('.slot-btn').forEach(btn => {
    const active = btn.dataset.time === time;
    btn.classList.toggle('is-selected', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  $('schedule-notes-wrap').hidden = false;
  $('schedule-continue-wrap').hidden = false;
  updateProgressAndRail();
  scrollToEl($('schedule-continue-wrap'));
}

/* ==================== PASO 4: CREAR CUENTA | AHORA NO Y RESERVA ==================== */
function renderAccountChoiceStep() {
  const svc = state.selectedService;
  const person = activePersonInfo();
  const dateLabel = formatDateLong(state.selectedDate);
  const capDate = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);
  const staffLabel = state.selectedStaff ? state.selectedStaff.displayName : 'Primera especialista disponible';

  // ZERO prices shown anywhere
  $('final-review-service').textContent = `Servicio: ${svc.name} (Duración aprox.: ${formatDuration(svc.durationMinutes, svc.durationMaxMinutes)})`;
  $('final-review-when').textContent = `Día y hora: ${capDate}, ${formatTime12(state.selectedSlot.time)} – ${formatTime12(state.selectedSlot.endTime)}`;
  $('final-review-staff').textContent = `Especialista: ${staffLabel}`;
  $('final-review-client').textContent = `Clienta: ${person.name} · Cel. ${person.phone}`;

  $('form-error').hidden = true;
  const loggedIn = !!state.client;
  $('account-decision-box').hidden = loggedIn;
  $('signed-in-confirm-box').hidden = !loggedIn;
  $('account-dual-actions').hidden = false;
  $('inline-create-account-form').hidden = true;
  setFieldError('inline-acc-email', 'err-inline-email', '');
  setFieldError('inline-acc-password', 'err-inline-password', '');
}

async function submitFinalBooking({ triggerBtnId = null, busyLabel = 'Confirmando tu cita...' } = {}) {
  if (state.submitting) return;
  $('form-error').hidden = true;

  state.submitting = true;
  const skipBtn = $('btn-skip-account-book');
  const createBtn = $('btn-choose-create-account');
  if (skipBtn) skipBtn.disabled = true;
  if (createBtn) createBtn.disabled = true;
  if (triggerBtnId) {
    setFormBusy(triggerBtnId, true, '✓ Confirmar mi cita ahora', busyLabel);
  }

  try {
    const person = activePersonInfo();
    const payload = {
      serviceId: state.selectedService.id,
      staffId: state.selectedStaff?.id || null,
      date: state.selectedDate,
      time: state.selectedSlot.time,
      notes: $('client-notes').value.trim()
    };
    if (!state.client) {
      payload.name = person.name;
      payload.phone = person.phone;
      payload.dni = person.dni;
    }

    const res = await fetchJson('/api/public/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    state.bookingResult = res;
    if (state.client) {
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
    }

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
    if (skipBtn) skipBtn.disabled = false;
    if (createBtn) createBtn.disabled = false;
    if (triggerBtnId) {
      setFormBusy(triggerBtnId, false, '✓ Confirmar mi cita ahora', busyLabel);
    }
  }
}

async function handleInlineCreateAccountAndBook(event) {
  event.preventDefault();
  if (state.submitting) return;
  $('form-error').hidden = true;
  setFieldError('inline-acc-email', 'err-inline-email', '');
  setFieldError('inline-acc-password', 'err-inline-password', '');

  const email = $('inline-acc-email').value.trim();
  const password = $('inline-acc-password').value;
  if (!email.includes('@')) {
    setFieldError('inline-acc-email', 'err-inline-email', 'Ingresa un correo válido (ej. tu@correo.com).');
    $('inline-acc-email').focus();
    return;
  }
  if (password.length < 6) {
    setFieldError('inline-acc-password', 'err-inline-password', 'Crea una contraseña de al menos 6 caracteres.');
    $('inline-acc-password').focus();
    return;
  }

  state.submitting = true;
  setFormBusy('submit-create-and-book-btn', true, '✨ Crear cuenta y confirmar cita', 'Creando cuenta y reservando...');
  try {
    const res = await fetchJson('/api/client/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: state.guestData.name,
        phone: state.guestData.phone,
        dni: state.guestData.dni,
        birthday: state.guestData.birthday,
        email,
        password
      })
    });
    state.client = res.client;
    state.upcomingAppointments = res.upcomingAppointments || [];
    renderClientProfileBars();
    state.submitting = false;
    await submitFinalBooking({ triggerBtnId: 'submit-create-and-book-btn', busyLabel: 'Confirmando tu cita...' });
  } catch (err) {
    state.submitting = false;
    setFormBusy('submit-create-and-book-btn', false, '✨ Crear cuenta y confirmar cita', 'Creando cuenta y reservando...');
    showBoxError('form-error', 'form-error-text', err.message);
  }
}

/* ==================== PANTALLA FINAL: WHATSAPP (986 732 957), CALENDARIO Y CLUB VIP ==================== */
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
    `WhatsApp del salón: ${SALON_PHONE_DISPLAY}`,
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
    details: `Código de reserva: ${b.bookingCode}\nServicio: ${b.serviceName}\nEspecialista: ${b.staffName}\nSalón y citas Touché: ${SALON_PHONE_DISPLAY}\nCómo llegar: ${b.salon.mapsUrl}`
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
  $('ticket-address').textContent = b.salon.address;
  $('ticket-reference').textContent = b.salon.reference;

  $('ticket-tip-text').textContent = b.serviceCategory === 'COLOR'
    ? 'No necesitas venir con el cabello lavado; lo lavamos aquí antes de iniciar tu servicio. Recuerda tocar el timbre 201.'
    : 'Te recomendamos llegar 10 minutos antes de tu cita y tocar el timbre 201. Aceptamos tarjetas en cuotas sin intereses, Yape, Plin y efectivo.';

  $('gcal-link').href = buildGoogleCalendarUrl(b);
  $('maps-link').href = b.salon.mapsUrl;

  const waText = [
    `Hola Touché Hair Studio 💕 Quiero confirmar mi cita:`,
    `• Código: ${b.bookingCode}`,
    `• Clienta: ${b.clientName}`,
    `• Servicio: ${b.serviceName}`,
    `• Día y hora: ${capDate} a las ${formatTime12(b.startTime)}`,
    `• Especialista: ${b.staffName}`
  ].join('\n');
  $('ticket-whatsapp-link').href = `${SALON_WA}?text=${encodeURIComponent(waText)}`;
  $('ticket-vip-club-link').href = b.salon?.vipClubUrl || VIP_CLUB_URL;
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
  state.activeStep = 1;
  state.search = '';
  state.activeCategory = null;
  state.selectedService = null;
  state.selectedStaff = null;
  state.monthView = null;
  state.selectedDate = null;
  state.selectedSlot = null;
  state.bookingResult = null;
  state.daySlotsCache.clear();
  state.monthDaysMap.clear();

  $('service-search').value = '';
  $('service-search-clear').hidden = true;
  $('client-notes').value = '';
  $('service-options-wrap').hidden = true;
  $('schedule-time-wrap').hidden = true;
  $('schedule-notes-wrap').hidden = true;
  $('schedule-continue-wrap').hidden = true;

  if (state.catalog) {
    renderFeaturedEval();
    renderCategories();
  }
}

/* ==================== APARTADO CLIENTAS: MENSAJE Y ASESORÍA (986 732 957) ==================== */
function handleQuickMessageSend() {
  const raw = ($('quick-msg-input')?.value || '').trim();
  const text = raw
    ? `Hola Touché Hair Studio 💕 ${raw}`
    : 'Hola Touché Hair Studio 💕 Quisiera hacer una consulta sobre sus servicios y horarios.';
  window.open(`${SALON_WA}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
}

async function handleAdvisorySubmit(event) {
  event.preventDefault();
  if (state.submitting) return;
  $('adv-error').hidden = true;
  $('adv-success').hidden = true;

  const name = $('adv-name').value.trim().replace(/\s+/g, ' ');
  const phone = $('adv-phone').value.trim();
  const topic = $('adv-topic').value.trim();

  if (name.length < 2) {
    showBoxError('adv-error', 'adv-error-text', 'Escribe tu nombre para poder llamarte.');
    $('adv-name').focus();
    return;
  }
  if (phone.replace(/\D/g, '').length < 7) {
    showBoxError('adv-error', 'adv-error-text', 'Ingresa tu número de celular (ej. 987 654 321).');
    $('adv-phone').focus();
    return;
  }

  state.submitting = true;
  setFormBusy('adv-submit-btn', true, '📞 Pedir que me llamen para asesoría', 'Enviando solicitud...');
  try {
    const res = await fetchJson('/api/public/advisory-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, topic })
    });
    if (res.whatsappUrl) $('adv-wa-followup').href = res.whatsappUrl;
    $('adv-success').hidden = false;
    $('adv-topic').value = '';
  } catch (err) {
    showBoxError('adv-error', 'adv-error-text', err.message);
  } finally {
    state.submitting = false;
    setFormBusy('adv-submit-btn', false, '📞 Pedir que me llamen para asesoría', 'Enviando solicitud...');
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
      state.client = me.client;
      state.upcomingAppointments = me.upcomingAppointments || [];
      state.dataConfirmed = true;
    }
    renderClientProfileBars();
    updateProgressAndRail();
  } catch (err) {
    $('global-error-text').textContent = err.message;
    $('global-error').hidden = false;
  }
}

function bindEvents() {
  $('global-retry-btn').addEventListener('click', () => bootstrap());
  $('brand-home-link').addEventListener('click', e => {
    e.preventDefault();
    state.gateOpen = false;
    $('gate-shell').hidden = true;
    $('sec-confirmation').hidden = true;
    $('booking-workspace').hidden = false;
    $('step-indicator').hidden = false;
    $('progress-track').hidden = false;
    resetBookingSelection();
    renderClientProfileBars();
    updateProgressAndRail();
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });

  // Optional account gate triggers
  $('open-login-btn').addEventListener('click', () => openAccountGate('welcome'));
  $('inline-login-trigger').addEventListener('click', () => openAccountGate('login'));
  $('step2-login-link').addEventListener('click', () => openAccountGate('login'));
  $('hub-account-btn').addEventListener('click', () => openAccountGate(state.client ? 'welcome' : 'register'));
  $('close-gate-btn').addEventListener('click', () => closeAccountGate());

  $('btn-returning-salon').addEventListener('click', () => openAccountGate('claim-search'));
  $('btn-first-time-salon').addEventListener('click', () => openAccountGate('register'));
  $('btn-go-login').addEventListener('click', () => openAccountGate('login'));
  $('btn-not-found-register').addEventListener('click', () => {
    openAccountGate('register', { prefillName: $('claim-name-search').value.trim(), fromNotFound: true });
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
  for (const id of ['claim-dni', 'reg-dni', 'guest-dni']) {
    $(id)?.addEventListener('input', e => {
      const clean = e.target.value.replace(/\D/g, '').slice(0, 8);
      if (e.target.value !== clean) e.target.value = clean;
    });
  }

  // Account gate forms
  $('claim-form').addEventListener('submit', handleClaimSubmit);
  $('register-form').addEventListener('submit', handleRegisterSubmit);
  $('login-form').addEventListener('submit', handleLoginSubmit);

  // Booking flow forms & step buttons
  $('guest-data-form').addEventListener('submit', handleGuestDataSubmit);
  $('back-to-service-btn').addEventListener('click', () => goToStep(1));
  $('back-to-data-btn').addEventListener('click', () => goToStep(2));
  $('back-to-schedule-btn').addEventListener('click', () => goToStep(3));
  $('continue-to-account-btn').addEventListener('click', () => goToStep(4));

  // Step 4: Dual big buttons (CREAR CUENTA | AHORA NO)
  $('btn-choose-create-account').addEventListener('click', () => {
    $('account-dual-actions').hidden = true;
    $('inline-create-account-form').hidden = false;
    $('form-error').hidden = true;
    setTimeout(() => $('inline-acc-email')?.focus(), 80);
  });
  $('btn-skip-account-book').addEventListener('click', () => submitFinalBooking());
  $('btn-cancel-inline-account').addEventListener('click', () => submitFinalBooking());
  $('inline-create-account-form').addEventListener('submit', handleInlineCreateAccountAndBook);
  $('submit-signed-booking-btn').addEventListener('click', () => submitFinalBooking({ triggerBtnId: 'submit-signed-booking-btn' }));

  // Service search & category toggle
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

  // Delegated clicks
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
      openAccountGate(gateBtn.dataset.gateView);
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

    const pickStaffBtn = e.target.closest('[data-pick-staff]');
    if (pickStaffBtn) {
      switchScheduleStaff(pickStaffBtn.dataset.pickStaff);
      return;
    }

    const calBtn = e.target.closest('[data-cal-date]');
    if (calBtn && !calBtn.disabled) {
      selectDate(calBtn.dataset.calDate);
      return;
    }

    const jumpBtn = e.target.closest('[data-jump-step]');
    if (jumpBtn && !jumpBtn.disabled) {
      goToStep(Number(jumpBtn.dataset.jumpStep));
      return;
    }

    const slotBtn = e.target.closest('.slot-btn');
    if (slotBtn) {
      selectTimeSlot(slotBtn.dataset.time, slotBtn.dataset.endTime);
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const jumpEl = e.target.closest('li[data-jump-step]');
      if (jumpEl) {
        e.preventDefault();
        goToStep(Number(jumpEl.dataset.jumpStep));
      }
    }
  });

  $('cal-prev-btn').addEventListener('click', () => {
    if (state.monthView) loadCalendarMonth(addMonths(state.monthView, -1));
  });
  $('cal-next-btn').addEventListener('click', () => {
    if (state.monthView) loadCalendarMonth(addMonths(state.monthView, 1));
  });

  // Confirmation & Client Hub actions
  $('download-ics-btn').addEventListener('click', downloadIcs);
  $('quick-msg-send-btn').addEventListener('click', handleQuickMessageSend);
  $('advisory-call-form').addEventListener('submit', handleAdvisorySubmit);

  $('nav-conocenos-link').addEventListener('click', e => {
    e.preventDefault();
    scrollToEl($('sec-conocenos'));
  });
  $('about-book-btn').addEventListener('click', () => {
    if (state.gateOpen) closeAccountGate();
    scrollToEl($('booking-workspace'));
  });
  $('book-another-btn').addEventListener('click', () => {
    $('sec-confirmation').hidden = true;
    $('booking-workspace').hidden = false;
    resetBookingSelection();
    renderClientProfileBars();
    updateProgressAndRail();
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

bindEvents();
bootstrap();
