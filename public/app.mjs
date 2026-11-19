const WEEKDAY_NAMES_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WEEKDAY_NAMES_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const state = {
  catalog: null,
  step: 1,
  search: '',
  category: 'ALL',
  selectedService: null,
  selectedStaff: null, // null = Primera especialista disponible
  selectedDate: null,
  selectedSlot: null,
  quickDays: [],
  monthView: null, // 'YYYY-MM'
  monthDaysMap: new Map(),
  daySlotsCache: new Map(),
  monthOpen: false,
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
  if (svc.isFree) return { label: 'Gratis', cls: 'is-free' };
  if (svc.priceCents == null) return { label: 'Según evaluación', cls: 'is-muted' };
  const soles = Math.round(svc.priceCents / 100);
  return { label: `Desde S/ ${soles}`, cls: '' };
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

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'TH';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function addMonths(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function showGlobalError(message) {
  $('global-error-text').textContent = message;
  $('global-error').hidden = false;
}

function hideGlobalError() {
  $('global-error').hidden = true;
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

function goToStep(step, { pushHistory = true } = {}) {
  state.step = step;
  const panels = document.querySelectorAll('.step-panel');
  panels.forEach(p => {
    const active = Number(p.dataset.step) === step;
    p.hidden = !active;
    p.classList.toggle('is-active', active);
  });

  const backBtn = $('nav-back-btn');
  backBtn.hidden = step <= 1 || step >= 5;

  const indicator = $('step-indicator');
  const progressTrack = $('progress-track');
  const progressFill = $('progress-fill');
  progressFill.className = `progress-fill is-step-${step}`;
  if (step <= 4) {
    indicator.textContent = `Paso ${step} de 4`;
    progressTrack.setAttribute('aria-valuenow', String(step));
  } else {
    indicator.textContent = 'Cita confirmada';
    progressTrack.setAttribute('aria-valuenow', '4');
  }

  if (pushHistory && window.history?.pushState) {
    const targetHash = `#paso-${step}`;
    if (window.location.hash !== targetHash) {
      window.history.pushState({ step }, '', targetHash);
    }
  }

  window.scrollTo({ top: 0, behavior: 'auto' });
  const heading = document.querySelector(`#step-${step === 1 ? 'service' : step === 2 ? 'staff' : step === 3 ? 'datetime' : step === 4 ? 'details' : 'confirmation'} h1, #step-${step === 1 ? 'service' : step === 2 ? 'staff' : step === 3 ? 'datetime' : step === 4 ? 'details' : 'confirmation'} h2`);
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
}

/* ==================== PASO 1: SERVICIOS ==================== */
function renderCategories() {
  const rail = $('category-rail');
  const cats = state.catalog?.categories || [];
  const pills = [{ code: 'ALL', label: 'Todos' }, ...cats.filter(c => c.code !== 'ASESORÍA')];
  rail.innerHTML = pills.map(c => `
    <button type="button" class="cat-pill" role="tab" aria-selected="${state.category === c.code ? 'true' : 'false'}" data-category="${escapeHtml(c.code)}">
      ${escapeHtml(c.label)}
    </button>
  `).join('');
}

function renderServices() {
  const container = $('services-list');
  const services = state.catalog?.services || [];
  const q = normalizeSearch(state.search);

  const featured = services.find(s => s.featured);
  const featuredBtn = $('featured-eval-btn');
  if (featured && !q && state.category === 'ALL') {
    $('featured-eval-name').textContent = featured.name;
    featuredBtn.dataset.serviceId = featured.id;
    featuredBtn.hidden = false;
  } else {
    featuredBtn.hidden = true;
  }

  const filtered = services.filter(s => {
    if (!q && state.category === 'ALL' && s.featured) return false;
    if (state.category !== 'ALL' && s.category !== state.category) return false;
    if (q) {
      const hay = normalizeSearch(`${s.name} ${s.categoryLabel} ${s.category}`);
      return hay.includes(q);
    }
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No encontramos servicios con «${escapeHtml(state.search)}».</p>
        <div class="empty-actions">
          <button type="button" class="secondary-btn" id="clear-filter-btn">Ver todos los servicios</button>
        </div>
      </div>
    `;
    $('clear-filter-btn')?.addEventListener('click', () => {
      state.search = '';
      state.category = 'ALL';
      $('service-search').value = '';
      $('service-search-clear').hidden = true;
      renderCategories();
      renderServices();
    });
    return;
  }

  // Group cleanly when showing ALL without search
  const showGroups = state.category === 'ALL' && !q;
  let html = '';
  let lastCat = null;
  const ordered = [...filtered].sort((a, b) => {
    const order = state.catalog.categories.map(c => c.code);
    const diff = order.indexOf(a.category) - order.indexOf(b.category);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, 'es');
  });

  for (const s of ordered) {
    if (showGroups && s.category !== lastCat) {
      lastCat = s.category;
      html += `<div class="service-group-label">${escapeHtml(s.categoryLabel)}</div>`;
    }
    const price = formatPrice(s);
    const dur = formatDuration(s.durationMinutes, s.durationMaxMinutes);
    html += `
      <button type="button" class="service-row" data-service-id="${escapeHtml(s.id)}">
        <span class="service-row-main">
          <span class="service-row-name">${escapeHtml(s.name)}</span>
          <span class="service-row-meta">
            <span>${escapeHtml(dur)}</span>
          </span>
        </span>
        <span class="service-row-right">
          <span class="service-price ${price.cls}">${escapeHtml(price.label)}</span>
          <span class="ico ico-caret-right row-arrow" aria-hidden="true"></span>
        </span>
      </button>
    `;
  }
  container.innerHTML = html;
}

function selectService(serviceId) {
  const svc = state.catalog?.services.find(s => s.id === serviceId);
  if (!svc) return;
  state.selectedService = svc;
  state.selectedStaff = null;
  state.selectedDate = null;
  state.selectedSlot = null;
  state.daySlotsCache.clear();
  state.monthDaysMap.clear();
  renderStep2();
  goToStep(2);
}

/* ==================== PASO 2: ESPECIALISTA ==================== */
function renderStep2() {
  const svc = state.selectedService;
  const price = formatPrice(svc);
  $('recap-service-name').textContent = svc.name;
  $('recap-service-meta').textContent = `${formatDuration(svc.durationMinutes, svc.durationMaxMinutes)} · ${price.label}`;

  const eligibleEntries = state.catalog.serviceEligibleStaff[svc.id] || [];
  const eligibleIds = new Set(eligibleEntries.map(e => e.staffId));
  const eligibleStaff = state.catalog.staff.filter(m => eligibleIds.has(m.id));

  const anyBtn = $('any-staff-btn');
  anyBtn.hidden = eligibleStaff.length <= 1;

  const list = $('staff-list');
  if (!eligibleStaff.length) {
    list.innerHTML = `
      <div class="empty-state">
        <p>Por ahora no hay especialistas habilitadas para este servicio.</p>
        <div class="empty-actions">
          <button type="button" class="secondary-btn" data-goto-step="1">Elegir otro servicio</button>
        </div>
      </div>
    `;
    return;
  }

  list.innerHTML = eligibleStaff.map(m => {
    const restText = m.restWeekday != null ? `Descansa los ${WEEKDAY_NAMES_LONG[m.restWeekday]}` : '';
    return `
      <button type="button" class="staff-row" data-staff-id="${escapeHtml(m.id)}">
        <span class="choice-avatar" aria-hidden="true">${escapeHtml(getInitials(m.displayName))}</span>
        <span class="choice-body">
          <span class="choice-title">${escapeHtml(m.displayName)}</span>
          <span class="choice-desc">${escapeHtml(m.specialtySummary)}</span>
          ${restText ? `<span class="choice-rest">${escapeHtml(restText)}</span>` : ''}
        </span>
        <span class="ico ico-caret-right row-arrow" aria-hidden="true"></span>
      </button>
    `;
  }).join('');
}

async function selectStaff(staffId) {
  state.selectedStaff = staffId ? state.catalog.staff.find(m => m.id === staffId) || null : null;
  state.selectedDate = null;
  state.selectedSlot = null;
  state.daySlotsCache.clear();
  state.monthDaysMap.clear();
  state.monthOpen = false;
  updateMonthDrawerUI();

  $('recap-step3-service').textContent = state.selectedService.name;
  $('recap-step3-staff').textContent = state.selectedStaff
    ? `Con ${state.selectedStaff.displayName}`
    : 'Primera especialista disponible';

  goToStep(3);
  await loadQuickDaysAndAutoSelect();
}

/* ==================== PASO 3: DÍA Y HORA ==================== */
async function loadQuickDaysAndAutoSelect() {
  const strip = $('date-strip');
  const slotsEl = $('slots-container');
  strip.innerHTML = '<div class="skeleton-row is-full"></div>';
  slotsEl.innerHTML = '<div class="surface"><div class="skeleton-stack"><div class="skeleton-row"></div><div class="skeleton-row"></div></div></div>';

  try {
    const qs = new URLSearchParams({
      serviceId: state.selectedService.id,
      count: '14'
    });
    if (state.selectedStaff) qs.set('staffId', state.selectedStaff.id);
    const data = await fetchJson(`/api/public/days?${qs.toString()}`);
    state.quickDays = data.days || [];
    for (const d of state.quickDays) state.monthDaysMap.set(d.date, d);

    const firstOpen = state.quickDays.find(d => !d.closed && d.availableCount > 0);
    const firstNonClosed = state.quickDays.find(d => !d.closed);
    state.selectedDate = (firstOpen || firstNonClosed || state.quickDays[0])?.date || state.catalog.today;
    state.monthView = state.selectedDate.slice(0, 7);

    renderDateStrip();
    await loadSlotsForDate(state.selectedDate);
  } catch (err) {
    slotsEl.innerHTML = `
      <div class="empty-state">
        <p>${escapeHtml(err.message)}</p>
        <div class="empty-actions">
          <button type="button" class="secondary-btn" id="retry-days-btn">Reintentar</button>
        </div>
      </div>
    `;
    $('retry-days-btn')?.addEventListener('click', () => loadQuickDaysAndAutoSelect());
  }
}

function renderDateStrip() {
  const strip = $('date-strip');
  if (state.selectedDate) {
    $('active-month-label').textContent = formatMonthTitle(state.selectedDate.slice(0, 7));
  }
  strip.innerHTML = state.quickDays.map(d => {
    const dt = new Date(d.date + 'T12:00:00Z');
    const wk = WEEKDAY_NAMES_SHORT[dt.getUTCDay()];
    const num = dt.getUTCDate();
    const selected = d.date === state.selectedDate;
    const disabled = d.closed || d.availableCount === 0;
    const isToday = d.date === state.catalog?.today;
    return `
      <button
        type="button"
        class="day-card${selected ? ' is-selected' : ''}"
        role="option"
        aria-selected="${selected ? 'true' : 'false'}"
        data-date="${escapeHtml(d.date)}"
        ${disabled ? 'disabled' : ''}
        aria-label="${escapeHtml(formatDateLong(d.date))}${disabled ? ' (sin horarios)' : `, ${d.availableCount} horarios disponibles`}"
      >
        <span class="day-wk">${isToday ? 'Hoy' : escapeHtml(wk)}</span>
        <span class="day-num">${num}</span>
        <span class="day-dot" aria-hidden="true"></span>
      </button>
    `;
  }).join('');
  const activeCard = strip.querySelector('.day-card.is-selected');
  if (activeCard) {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    activeCard.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }
}

function updateMonthDrawerUI() {
  const drawer = $('month-drawer');
  const btn = $('toggle-month-btn');
  drawer.classList.toggle('is-open', state.monthOpen);
  drawer.setAttribute('aria-hidden', state.monthOpen ? 'false' : 'true');
  btn.setAttribute('aria-expanded', state.monthOpen ? 'true' : 'false');
}

async function loadMonthCalendar(ym) {
  state.monthView = ym;
  $('cal-month-title').textContent = formatMonthTitle(ym);
  const minMonth = state.catalog.today.slice(0, 7);
  const maxMonth = state.catalog.maxDate.slice(0, 7);
  $('cal-prev-btn').disabled = ym <= minMonth;
  $('cal-next-btn').disabled = ym >= maxMonth;

  try {
    const qs = new URLSearchParams({ serviceId: state.selectedService.id, month: ym });
    if (state.selectedStaff) qs.set('staffId', state.selectedStaff.id);
    const data = await fetchJson(`/api/public/days?${qs.toString()}`);
    for (const d of (data.days || [])) state.monthDaysMap.set(d.date, d);
    renderMonthGrid(ym, data.days || []);
  } catch {
    $('cal-grid').innerHTML = '';
  }
}

function renderMonthGrid(ym, days) {
  const grid = $('cal-grid');
  if (!days.length) {
    grid.innerHTML = '';
    return;
  }
  const firstDow = new Date(days[0].date + 'T12:00:00Z').getUTCDay();
  const mondayOffset = (firstDow + 6) % 7;
  let html = '';
  for (let i = 0; i < mondayOffset; i++) {
    html += '<span></span>';
  }
  for (const d of days) {
    const num = Number(d.date.slice(8, 10));
    const disabled = d.closed || d.availableCount === 0;
    const selected = d.date === state.selectedDate;
    html += `
      <button
        type="button"
        class="cal-cell${selected ? ' is-selected' : ''}${!disabled ? ' has-slots' : ''}"
        data-cal-date="${escapeHtml(d.date)}"
        ${disabled ? 'disabled' : ''}
        aria-label="${escapeHtml(formatDateLong(d.date))}"
      >${num}</button>
    `;
  }
  grid.innerHTML = html;
}

async function loadSlotsForDate(date) {
  state.selectedDate = date;
  renderDateStrip();
  if (state.monthOpen && state.monthView) {
    const ym = date.slice(0, 7);
    if (ym === state.monthView) {
      const monthDays = [...state.monthDaysMap.values()]
        .filter(d => d.date.startsWith(ym))
        .sort((a, b) => a.date.localeCompare(b.date));
      if (monthDays.length) renderMonthGrid(ym, monthDays);
    }
  }

  const container = $('slots-container');
  const cacheKey = `${state.selectedService.id}|${state.selectedStaff?.id || 'ANY'}|${date}`;
  let data = state.daySlotsCache.get(cacheKey);
  if (!data) {
    container.innerHTML = '<div class="surface"><div class="skeleton-stack"><div class="skeleton-row"></div><div class="skeleton-row"></div></div></div>';
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
}

function renderSlots(data) {
  const container = $('slots-container');
  const slots = data.slots || [];
  if (!slots.length) {
    const nextOpenDay = state.quickDays.find(d => d.date > data.date && !d.closed && d.availableCount > 0);
    const staffLabel = state.selectedStaff ? state.selectedStaff.shortName : 'el salón';
    const message = data.reason === 'closed_weekday'
      ? 'El salón no atiende este día. Elige una fecha entre lunes y sábado.'
      : `No quedan horarios libres con ${staffLabel} el ${formatDateLong(data.date)}.`;

    container.innerHTML = `
      <div class="empty-state">
        <p>${escapeHtml(message)}</p>
        <div class="empty-actions">
          ${state.selectedStaff && data.anyStaffAvailableCount > 0
            ? `<button type="button" class="primary-btn" id="switch-any-staff-btn">Ver ${data.anyStaffAvailableCount} horarios con cualquier especialista</button>`
            : ''}
          ${nextOpenDay
            ? `<button type="button" class="secondary-btn" id="jump-next-day-btn">Ir al ${escapeHtml(formatDateLong(nextOpenDay.date))}</button>`
            : ''}
        </div>
      </div>
    `;
    $('switch-any-staff-btn')?.addEventListener('click', () => {
      state.selectedStaff = null;
      $('recap-step3-staff').textContent = 'Primera especialista disponible';
      state.daySlotsCache.clear();
      loadSlotsForDate(data.date);
    });
    $('jump-next-day-btn')?.addEventListener('click', () => {
      if (nextOpenDay) loadSlotsForDate(nextOpenDay.date);
    });
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
  renderStep4();
  goToStep(4);
}

/* ==================== PASO 4: DATOS Y CONFIRMACIÓN ==================== */
function renderStep4() {
  const svc = state.selectedService;
  const price = formatPrice(svc);
  const dateText = formatDateLong(state.selectedDate);
  const timeRange = `${formatTime12(state.selectedSlot.time)} – ${formatTime12(state.selectedSlot.endTime)}`;

  $('summary-service').textContent = svc.name;
  $('summary-datetime').textContent = `${dateText} · ${timeRange}`;
  $('summary-staff').textContent = state.selectedStaff
    ? state.selectedStaff.displayName
    : 'Primera especialista disponible';
  $('summary-duration').textContent = formatDuration(svc.durationMinutes, svc.durationMaxMinutes);

  if (svc.isFree) {
    $('summary-price-note').textContent = 'Sesión gratuita y sin compromiso.';
  } else if (svc.requiresEvalPrice) {
    $('summary-price-note').textContent = `${price.label} · El monto exacto se confirma en evaluación según largo y densidad.`;
  } else {
    $('summary-price-note').textContent = `${price.label} (referencial). Pago en salón con tarjeta, Yape, Plin o efectivo.`;
  }

  $('sticky-time').textContent = `${formatTime12(state.selectedSlot.time)} · ${formatDateShort(state.selectedDate)}`;
  $('sticky-price').textContent = price.label;
  clearFormErrors();
}

function clearFormErrors() {
  for (const id of ['err-name', 'err-phone', 'err-dni']) $(id).textContent = '';
  for (const id of ['client-name', 'client-phone', 'client-dni']) $(id).removeAttribute('aria-invalid');
  $('form-error').hidden = true;
}

function showFormError(message) {
  const el = $('form-error');
  $('form-error-text').textContent = message;
  el.hidden = false;
  el.classList.remove('is-shaking');
  void el.offsetWidth;
  el.classList.add('is-shaking');
}

function validateFormInputs() {
  clearFormErrors();
  let firstInvalid = null;

  const nameEl = $('client-name');
  const name = nameEl.value.trim().replace(/\s+/g, ' ');
  if (name.length < 2) {
    $('err-name').textContent = 'Escribe tu nombre y apellido.';
    nameEl.setAttribute('aria-invalid', 'true');
    firstInvalid = firstInvalid || nameEl;
  }

  const phoneEl = $('client-phone');
  const phoneDigits = phoneEl.value.replace(/\D/g, '');
  if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    $('err-phone').textContent = 'Ingresa un celular válido (ej. 987 654 321).';
    phoneEl.setAttribute('aria-invalid', 'true');
    firstInvalid = firstInvalid || phoneEl;
  }

  const dniEl = $('client-dni');
  const dni = dniEl.value.replace(/\D/g, '');
  dniEl.value = dni.slice(0, 8);
  if (!/^\d{8}$/.test(dniEl.value)) {
    $('err-dni').textContent = 'Ingresa tu DNI de 8 dígitos.';
    dniEl.setAttribute('aria-invalid', 'true');
    firstInvalid = firstInvalid || dniEl;
  }

  if (firstInvalid) {
    firstInvalid.focus();
    return null;
  }

  return {
    name,
    phone: phoneEl.value.trim(),
    dni: dniEl.value,
    notes: $('client-notes').value.trim()
  };
}

async function handleBookingSubmit(event) {
  event.preventDefault();
  if (state.submitting) return;
  const fields = validateFormInputs();
  if (!fields) return;

  state.submitting = true;
  const btn = $('submit-booking-btn');
  btn.disabled = true;
  btn.querySelector('.btn-label').textContent = 'Confirmando...';
  btn.querySelector('.btn-spinner').hidden = false;

  try {
    const res = await fetchJson('/api/public/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceId: state.selectedService.id,
        staffId: state.selectedStaff?.id || null,
        date: state.selectedDate,
        time: state.selectedSlot.time,
        name: fields.name,
        phone: fields.phone,
        dni: fields.dni,
        notes: fields.notes
      })
    });
    state.bookingResult = res;
    renderConfirmation(res);
    goToStep(5);
  } catch (err) {
    showFormError(err.message);
    if (err.status === 409) {
      state.daySlotsCache.clear();
    }
  } finally {
    state.submitting = false;
    btn.disabled = false;
    btn.querySelector('.btn-label').textContent = 'Confirmar mi cita';
    btn.querySelector('.btn-spinner').hidden = true;
  }
}

/* ==================== PASO 5: TICKET Y CALENDARIO ==================== */
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
    details: `Código de reserva: ${b.bookingCode}\nServicio: ${b.serviceName}\nEspecialista: ${b.staffName}\nCómo llegar: ${b.salon.mapsUrl}`
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function renderConfirmation(b) {
  $('ticket-code').textContent = b.bookingCode;
  $('ticket-service').textContent = `${b.serviceName} (${formatDuration(b.durationMinutes, b.durationMaxMinutes)})`;
  const dateLabel = formatDateLong(b.date);
  const capitalizedDate = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);
  $('ticket-datetime').textContent = `${capitalizedDate} · ${formatTime12(b.startTime)} – ${formatTime12(b.endTime)}`;
  $('ticket-staff').textContent = b.staffName;

  if (b.isFree) {
    $('ticket-price').textContent = 'Gratis (sin compromiso)';
  } else if (b.priceCents != null) {
    const soles = Math.round(b.priceCents / 100);
    $('ticket-price').textContent = b.requiresEvalPrice
      ? `Desde S/ ${soles} (se confirma en evaluación)`
      : `Desde S/ ${soles} (referencial)`;
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

function resetBookingFlow() {
  state.selectedService = null;
  state.selectedStaff = null;
  state.selectedDate = null;
  state.selectedSlot = null;
  state.bookingResult = null;
  state.daySlotsCache.clear();
  state.monthDaysMap.clear();
  $('client-notes').value = '';
  goToStep(1);
}

/* ==================== BOOTSTRAP & EVENTS ==================== */
async function loadCatalog() {
  hideGlobalError();
  try {
    const data = await fetchJson('/api/public/catalog');
    state.catalog = data;
    if (data.salon?.pricePolicyNote) {
      $('price-policy-note').textContent = data.salon.pricePolicyNote;
    }
    renderCategories();
    renderServices();
  } catch (err) {
    showGlobalError(err.message);
    $('services-list').innerHTML = '';
  }
}

function bindEvents() {
  $('global-retry-btn').addEventListener('click', () => loadCatalog());

  $('nav-back-btn').addEventListener('click', () => {
    if (state.step > 1 && state.step < 5) {
      goToStep(state.step - 1);
    }
  });

  $('brand-home-link').addEventListener('click', e => {
    e.preventDefault();
    resetBookingFlow();
  });

  document.addEventListener('click', e => {
    const goto = e.target.closest('[data-goto-step]');
    if (goto) {
      const target = Number(goto.dataset.gotoStep);
      if (target >= 1 && target <= 4) goToStep(target);
      return;
    }
    const svcBtn = e.target.closest('[data-service-id]');
    if (svcBtn) {
      selectService(svcBtn.dataset.serviceId);
      return;
    }
    const catBtn = e.target.closest('[data-category]');
    if (catBtn) {
      state.category = catBtn.dataset.category;
      renderCategories();
      renderServices();
      return;
    }
    const staffBtn = e.target.closest('[data-staff-id]');
    if (staffBtn) {
      selectStaff(staffBtn.dataset.staffId);
      return;
    }
    const dayBtn = e.target.closest('[data-date]');
    if (dayBtn && !dayBtn.disabled) {
      loadSlotsForDate(dayBtn.dataset.date);
      return;
    }
    const calBtn = e.target.closest('[data-cal-date]');
    if (calBtn && !calBtn.disabled) {
      const picked = calBtn.dataset.calDate;
      state.monthOpen = false;
      updateMonthDrawerUI();
      if (!state.quickDays.some(d => d.date === picked)) {
        const entry = state.monthDaysMap.get(picked) || { date: picked, closed: false, availableCount: 1 };
        state.quickDays = [...state.quickDays, entry].sort((a, b) => a.date.localeCompare(b.date));
      }
      loadSlotsForDate(picked);
      return;
    }
    const slotBtn = e.target.closest('.slot-btn');
    if (slotBtn) {
      selectTimeSlot(slotBtn.dataset.time, slotBtn.dataset.endTime);
    }
  });

  $('any-staff-btn').addEventListener('click', () => selectStaff(null));

  const searchInput = $('service-search');
  const searchClear = $('service-search-clear');
  searchInput.addEventListener('input', () => {
    state.search = searchInput.value;
    searchClear.hidden = !state.search;
    renderServices();
  });
  searchClear.addEventListener('click', () => {
    state.search = '';
    searchInput.value = '';
    searchClear.hidden = true;
    renderServices();
    searchInput.focus();
  });

  $('toggle-month-btn').addEventListener('click', async () => {
    state.monthOpen = !state.monthOpen;
    updateMonthDrawerUI();
    if (state.monthOpen) {
      await loadMonthCalendar(state.monthView || state.catalog.today.slice(0, 7));
    }
  });

  $('cal-prev-btn').addEventListener('click', () => {
    if (state.monthView) loadMonthCalendar(addMonths(state.monthView, -1));
  });
  $('cal-next-btn').addEventListener('click', () => {
    if (state.monthView) loadMonthCalendar(addMonths(state.monthView, 1));
  });

  // Auto-clean DNI digits on input
  $('client-dni').addEventListener('input', e => {
    const clean = e.target.value.replace(/\D/g, '').slice(0, 8);
    if (e.target.value !== clean) e.target.value = clean;
  });

  $('booking-form').addEventListener('submit', handleBookingSubmit);
  $('download-ics-btn').addEventListener('click', downloadIcs);
  $('book-another-btn').addEventListener('click', resetBookingFlow);

  window.addEventListener('popstate', e => {
    const target = e.state?.step;
    if (target && target >= 1 && target <= 4 && state.step < 5) {
      if (target === 2 && !state.selectedService) return goToStep(1, { pushHistory: false });
      if (target === 3 && !state.selectedService) return goToStep(1, { pushHistory: false });
      if (target === 4 && (!state.selectedDate || !state.selectedSlot)) return goToStep(3, { pushHistory: false });
      goToStep(target, { pushHistory: false });
    }
  });
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

bindEvents();
if (window.history?.replaceState) {
  window.history.replaceState({ step: 1 }, '', '#paso-1');
}
loadCatalog();
