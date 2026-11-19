const WEEKDAY_NAMES_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WEEKDAY_NAMES_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const STEP_LABELS = {
  1: 'Paso 1 de 5 · Servicio',
  2: 'Paso 2 de 5 · Especialista',
  3: 'Paso 3 de 5 · Día',
  4: 'Paso 4 de 5 · Hora',
  5: 'Paso 5 de 5 · Tus datos',
  6: '¡Cita reservada!'
};

const state = {
  catalog: null,
  activeStep: 1,
  search: '',
  activeCategory: null,
  selectedService: null,
  staffChosen: false,
  selectedStaff: null, // null when "Primera especialista disponible"
  monthView: null, // 'YYYY-MM'
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
  $('reset-top-btn').hidden = step <= 1;

  // Step number badges
  $('badge-step-1').classList.toggle('is-done', !!state.selectedService);
  $('badge-step-2').classList.toggle('is-done', state.staffChosen);
  $('badge-step-3').classList.toggle('is-done', !!state.selectedDate);
  $('badge-step-4').classList.toggle('is-done', !!state.selectedSlot);

  // Desktop Calendly left rail summary
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

  // Show chosen service summary & hide picker to keep screen calm and uncluttered
  const price = formatPrice(svc);
  $('chosen-service-name').textContent = svc.name;
  $('chosen-service-meta').textContent = `${formatDuration(svc.durationMinutes, svc.durationMaxMinutes)} · ${price.label}`;
  $('chosen-service-box').hidden = false;
  $('service-picker').hidden = true;

  // Show prominent price clarification alert immediately
  const notice = buildPriceNoticeCopy(svc);
  const alertBox = $('service-price-alert');
  alertBox.classList.toggle('is-free', notice.isFree);
  $('service-price-alert-title').textContent = notice.title;
  $('service-price-alert-text').textContent = notice.text;
  alertBox.hidden = false;

  // Hide downstream steps until chosen
  $('sec-date').hidden = true;
  $('sec-time').hidden = true;
  $('sec-details').hidden = true;

  renderStep2Staff();
  updateProgressAndRail();

  // Check if only 1 specialist is eligible: auto-select her and unlock Calendar immediately!
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
  const ids = new Set(entries.map(e => e.staffId));
  return (state.catalog?.staff || []).filter(m => ids.has(m.id));
}

function renderStep2Staff() {
  const eligible = getEligibleStaffFor(state.selectedService.id);
  $('chosen-staff-box').hidden = true;
  $('staff-picker').hidden = false;
  $('any-staff-btn').hidden = eligible.length <= 1;

  const list = $('staff-list');
  if (!eligible.length) {
    list.innerHTML = `
      <div class="empty-state">
        <p>Por ahora no hay especialistas habilitadas para este servicio.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = eligible.map(m => {
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

    // If current month has zero open days left (e.g., last day of month evening), automatically advance to next month!
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

  // Refresh selected circle highlight in calendar
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

/* ==================== PASO 5: DATOS Y CONFIRMACIÓN ==================== */
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

  const nameInput = $('client-name');
  scrollToEl($('sec-details'), { focusEl: nameInput.value.trim() ? null : nameInput });
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
  scrollToEl(el);
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
    $('err-phone').textContent = 'Ingresa un número de celular válido (ej. 987 654 321).';
    phoneEl.setAttribute('aria-invalid', 'true');
    firstInvalid = firstInvalid || phoneEl;
  }

  const dniEl = $('client-dni');
  const dni = dniEl.value.replace(/\D/g, '');
  dniEl.value = dni.slice(0, 8);
  if (!/^\d{8}$/.test(dniEl.value)) {
    $('err-dni').textContent = 'Ingresa tu DNI de 8 números.';
    dniEl.setAttribute('aria-invalid', 'true');
    firstInvalid = firstInvalid || dniEl;
  }

  if (firstInvalid) {
    scrollToEl(firstInvalid, { focusEl: firstInvalid });
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
  btn.querySelector('.btn-label').textContent = 'Confirmando tu cita...';
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
    $('booking-workspace').hidden = true;
    $('sec-confirmation').hidden = false;
    updateProgressAndRail();
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
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

function resetAll() {
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

  $('booking-workspace').hidden = false;
  $('sec-confirmation').hidden = true;
  $('chosen-service-box').hidden = true;
  $('service-price-alert').hidden = true;
  $('service-picker').hidden = false;
  $('service-options-wrap').hidden = true;
  $('sec-staff').hidden = true;
  $('sec-date').hidden = true;
  $('sec-time').hidden = true;
  $('sec-details').hidden = true;

  renderCategories();
  updateProgressAndRail();
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
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

function bindEvents() {
  $('global-retry-btn').addEventListener('click', () => loadCatalog());
  $('reset-top-btn').addEventListener('click', () => resetAll());
  $('brand-home-link').addEventListener('click', e => {
    e.preventDefault();
    resetAll();
  });

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

  // Auto-avance amigable entre campos del formulario (muy cómodo para personas mayores)
  $('client-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const phone = $('client-phone');
      scrollToEl(phone, { focusEl: phone });
    }
  });
  $('client-phone').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const dni = $('client-dni');
      scrollToEl(dni, { focusEl: dni });
    }
  });
  $('client-dni').addEventListener('input', e => {
    const clean = e.target.value.replace(/\D/g, '').slice(0, 8);
    if (e.target.value !== clean) e.target.value = clean;
    if (clean.length === 8) {
      scrollToEl($('final-review-box'));
    }
  });

  $('booking-form').addEventListener('submit', handleBookingSubmit);
  $('download-ics-btn').addEventListener('click', downloadIcs);
  $('book-another-btn').addEventListener('click', resetAll);
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

bindEvents();
loadCatalog();
