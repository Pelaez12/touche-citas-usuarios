export const SALON_INFO = {
  name: 'Touché Hair Studio',
  address: 'Calle Las Tiendas 261, Dpto. 201, Surquillo',
  reference: 'Frente al Metro de Aramburú · Timbre 201',
  mapsUrl: 'https://maps.app.goo.gl/52v9AbJ4YCYamjrn7',
  reviewsUrl: 'https://share.google/853a4lw4yLho9O4xB',
  socials: {
    facebook: 'https://www.facebook.com/ToucheSalonSpa/reels/',
    instagram: 'https://www.instagram.com/touchesalonspa?utm_source=ig_web_button_share_sheet&evlk=ZDNlZDc0MzIxNw==',
    tiktok: 'https://www.tiktok.com/@touchesalonspa'
  },
  supportPhone: '992 272 521',
  supportTel: '+51992272521',
  supportWhatsappUrl: 'https://wa.me/51992272521',
  paymentsNote: 'Aceptamos todas las tarjetas (cuotas sin intereses), Yape, Plin, efectivo y transferencia.',
  pricePolicyNote: 'Los precios son referenciales. En servicios de color y alisados, el monto final se confirma en salón tras evaluar el largo y estado de tu cabello.'
};

export const CATEGORY_ORDER = [
  'ASESORÍA',
  'COLOR',
  'CORTE',
  'TRATAMIENTO',
  'QUÍMICO',
  'PEINADO',
  'MANOS / PIES',
  'MAQUILLAJE',
  'DEPILACION'
];

export const CATEGORY_LABELS = {
  'ASESORÍA': 'Asesoría gratis',
  'COLOR': 'Color y Shades',
  'CORTE': 'Corte',
  'TRATAMIENTO': 'Tratamientos',
  'QUÍMICO': 'Alisados y Botox',
  'PEINADO': 'Peinados',
  'MANOS / PIES': 'Manos y pies',
  'MAQUILLAJE': 'Maquillaje',
  'DEPILACION': 'Depilación'
};

export const EVAL_PRICE_CATEGORIES = new Set(['COLOR', 'QUÍMICO']);
const CAP_RANK = { primary: 1, junior: 2, plan_b: 3 };
export const MAX_BOOKING_DAYS_AHEAD = 60;
export const SLOT_STEP_MINUTES = 30;
export const SAME_DAY_LEAD_MINUTES = 30;

export function validDay(day) {
  return typeof day === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(day)
    && !Number.isNaN(Date.parse(day))
    && new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) === day
    && day >= '2025-01-01'
    && day <= '2100-12-31';
}

export function validTime(t) {
  return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

export function toMinutes(hhmm) {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

export function fromMinutes(mins) {
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

export function addDays(day, delta) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function limaNowParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return { day, minutes };
}

const WORD_FIXES = new Map([
  ['depilacion', 'depilación'],
  ['aplicacion', 'aplicación'],
  ['iluminacion', 'iluminación'],
  ['exfoliacion', 'exfoliación'],
  ['evaluacion', 'evaluación'],
  ['diagnostico', 'diagnóstico'],
  ['clasica', 'clásica'],
  ['clasico', 'clásico'],
  ['raiz', 'raíz'],
  ['bano', 'baño'],
  ['nina', 'niña'],
  ['pestanas', 'pestañas'],
  ['quimico', 'químico'],
  ['asesoria', 'asesoría'],
  ['ligths', 'lights'],
  ['eq', 'EQ'],
  ['xl', 'XL'],
  ['spa', 'Spa'],
  ['1x1', '1x1'],
  ['redken', 'Redken'],
  ['davines', 'Davines'],
  ['alfaparf', 'Alfaparf'],
  ['moroccanoil', 'Moroccanoil'],
  ['acidic', 'Acidic'],
  ['bonding', 'Bonding'],
  ['shades', 'Shades'],
  ['botox', 'Botox'],
  ['infinite', 'Infinite'],
  ['shine', 'Shine']
]);

export function formatServiceName(rawName) {
  const clean = String(rawName || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  if (/[a-záéíóúñ]/.test(clean)) return clean;
  const fixedPhrase = clean.replace(/HIGH\s+LIGTHS/i, 'HIGHLIGHTS');
  const words = fixedPhrase.toLowerCase().split(' ').map((w, idx) => {
    const mapped = WORD_FIXES.get(w) || w;
    if (idx === 0) return mapped.charAt(0).toUpperCase() + mapped.slice(1);
    return mapped;
  });
  return words.join(' ');
}

export function effectiveDuration(service) {
  if (Number.isInteger(service.durationMinutes) && service.durationMinutes > 0) {
    const max = Number.isInteger(service.durationMaxMinutes) && service.durationMaxMinutes >= service.durationMinutes
      ? service.durationMaxMinutes
      : service.durationMinutes;
    return { durationMinutes: service.durationMinutes, durationMaxMinutes: max };
  }
  const cat = String(service.category || '').toUpperCase();
  const upperName = String(service.name || '').toUpperCase();
  if (cat === 'ASESORÍA') return { durationMinutes: 20, durationMaxMinutes: 20 };
  if (cat === 'QUÍMICO') {
    if (upperName.includes('CERQUILLO') || upperName.includes('VINCHA')) {
      return { durationMinutes: 60, durationMaxMinutes: 60 };
    }
    if (upperName.includes('BOTOX')) {
      return { durationMinutes: 120, durationMaxMinutes: 150 };
    }
    return { durationMinutes: 180, durationMaxMinutes: 240 };
  }
  if (cat === 'MANOS / PIES') return { durationMinutes: 45, durationMaxMinutes: 60 };
  if (cat === 'MAQUILLAJE') {
    if (upperName.includes('PESTAÑ') || upperName.includes('CEJA')) {
      return { durationMinutes: 45, durationMaxMinutes: 45 };
    }
    return { durationMinutes: 60, durationMaxMinutes: 90 };
  }
  if (cat === 'DEPILACION') return { durationMinutes: 30, durationMaxMinutes: 30 };
  if (cat === 'CORTE') return { durationMinutes: 40, durationMaxMinutes: 60 };
  if (cat === 'TRATAMIENTO') return { durationMinutes: 35, durationMaxMinutes: 45 };
  if (cat === 'PEINADO') return { durationMinutes: 60, durationMaxMinutes: 90 };
  if (cat === 'COLOR') return { durationMinutes: 120, durationMaxMinutes: 150 };
  return { durationMinutes: 60, durationMaxMinutes: 60 };
}

export function sanitizePublicSpecialty(summary, role) {
  const cleaned = String(summary || '')
    .replace(/\(\s*apoyo temporal[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s,;:-]+$/, '')
    .trim();
  if (cleaned) return cleaned;
  if (role === 'manicurist') return 'Especialista en manos y pies';
  if (role === 'junior_stylist_assistant') return 'Especialista en color e hidrataciones';
  return 'Estilista especialista Touché';
}

export function resolveCapability(staffId, service, categoryCaps, serviceOverrides) {
  const override = serviceOverrides.find(o => o.staffId === staffId && o.serviceId === service.id);
  if (override) return override.capabilityLevel === 'disabled' ? null : override.capabilityLevel;
  const cat = categoryCaps.find(c => c.staffId === staffId && c.category === service.category);
  return cat ? cat.capabilityLevel : null;
}

export function getStaffDayStatus(member, day, exceptions) {
  const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
  const dayEx = exceptions.filter(e => e.staffId === member.id && e.exceptionDate === day);
  const extra = dayEx.find(e => e.kind === 'extra_shift');
  const leave = dayEx.find(e => e.kind === 'urgent_leave' || e.kind === 'rest_override');
  const blocks = dayEx.filter(e => e.kind === 'partial_block' && e.startsTime && e.endsTime);
  if (leave) {
    return {
      working: false,
      reason: leave.kind === 'urgent_leave' ? (leave.reason || 'Permiso') : (leave.reason || 'Cambio de descanso'),
      blocks
    };
  }
  if (member.restWeekday === weekday && !extra) {
    return { working: false, reason: 'Día de descanso semanal', blocks };
  }
  return { working: true, reason: extra ? (extra.reason || 'Turno extraordinario') : '', blocks };
}

export function rankCandidatesForSlot({
  staff,
  service,
  day,
  startTime,
  endTime,
  categoryCaps,
  serviceOverrides,
  exceptions,
  shifts,
  dayAppointments
}) {
  const startsAt = `${day}T${startTime}:00-05:00`;
  const endsAt = `${day}T${endTime}:00-05:00`;
  const shiftMap = new Map(shifts.filter(s => s.day === day && s.status === 'present').map(s => [s.staffId, s.turnOrder]));
  const absentSet = new Set(shifts.filter(s => s.day === day && s.status === 'absent').map(s => s.staffId));
  return staff
    .filter(m => m.active && m.canHoldAppointments)
    .map(m => {
      const capability = resolveCapability(m.id, service, categoryCaps, serviceOverrides);
      const dayStatus = getStaffDayStatus(m, day, exceptions);
      const partialConflict = dayStatus.blocks.find(b => b.startsTime < endTime && b.endsTime > startTime);
      const apptConflict = dayAppointments.find(
        a => a.status === 'scheduled' && a.staffId === m.id && a.startsAt < endsAt && a.endsAt > startsAt
      );
      const dayLoad = dayAppointments.filter(
        a => a.status === 'scheduled' && a.staffId === m.id && a.startsAt.startsWith(day)
      ).length;
      let available = true;
      let unavailableReason = '';
      if (!capability) {
        available = false;
        unavailableReason = 'No habilitada para este servicio';
      } else if (absentSet.has(m.id)) {
        available = false;
        unavailableReason = 'No disponible hoy';
      } else if (!dayStatus.working) {
        available = false;
        unavailableReason = dayStatus.reason;
      } else if (partialConflict) {
        available = false;
        unavailableReason = 'Horario no disponible';
      } else if (apptConflict) {
        available = false;
        unavailableReason = 'Horario ocupado';
      }
      return {
        staffId: m.id,
        displayName: m.displayName,
        shortName: m.shortName || m.displayName,
        role: m.role,
        seniorityTier: m.seniorityTier,
        capability,
        available,
        unavailableReason,
        turnOrder: shiftMap.get(m.id) ?? null,
        dayLoad
      };
    })
    .sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      const ra = CAP_RANK[a.capability] || 9;
      const rb = CAP_RANK[b.capability] || 9;
      if (ra !== rb) return ra - rb;
      const ta = a.turnOrder ?? 999;
      const tb = b.turnOrder ?? 999;
      if (ta !== tb) return ta - tb;
      if (a.dayLoad !== b.dayLoad) return a.dayLoad - b.dayLoad;
      return a.displayName.localeCompare(b.displayName, 'es');
    });
}

export function computeDaySlots({
  date,
  prefs,
  service,
  staffId = null,
  staff,
  categoryCaps,
  serviceOverrides,
  exceptions,
  shifts,
  dayAppointments,
  now = new Date()
}) {
  const { day: todayLima, minutes: nowLimaMin } = limaNowParts(now);
  const maxDay = addDays(todayLima, MAX_BOOKING_DAYS_AHEAD);
  if (date < todayLima || date > maxDay) {
    return { closed: true, reason: date < todayLima ? 'past' : 'too_far', slots: [] };
  }
  const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  if (!prefs.weekdays.includes(weekday)) {
    return { closed: true, reason: 'closed_weekday', slots: [] };
  }

  const { durationMinutes } = effectiveDuration(service);
  const openMin = toMinutes(prefs.openTime);
  const closeMin = toMinutes(prefs.closeTime);
  let minStart = openMin;
  if (date === todayLima) {
    const earliest = nowLimaMin + SAME_DAY_LEAD_MINUTES;
    const rounded = Math.ceil(earliest / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES;
    minStart = Math.max(openMin, rounded);
  }

  const dayAppts = dayAppointments.filter(a => a.status === 'scheduled' && a.startsAt.startsWith(date));
  const slots = [];
  for (let start = openMin; start + durationMinutes <= closeMin; start += SLOT_STEP_MINUTES) {
    if (start < minStart) continue;
    const startTime = fromMinutes(start);
    const endTime = fromMinutes(start + durationMinutes);
    const startsAt = `${date}T${startTime}:00-05:00`;
    const endsAt = `${date}T${endTime}:00-05:00`;
    const ranked = rankCandidatesForSlot({
      staff,
      service,
      day: date,
      startTime,
      endTime,
      categoryCaps,
      serviceOverrides,
      exceptions,
      shifts,
      dayAppointments: dayAppts
    });

    let slotOpen = false;
    if (staffId) {
      const cand = ranked.find(c => c.staffId === staffId);
      slotOpen = !!(cand && cand.available);
    } else {
      const freeCount = ranked.filter(c => c.available).length;
      const overlappingPool = dayAppts.filter(
        a => !a.staffId && a.startsAt < endsAt && a.endsAt > startsAt
      ).length;
      slotOpen = freeCount > overlappingPool;
    }

    if (slotOpen) {
      slots.push({
        time: startTime,
        endTime,
        period: start < 13 * 60 ? 'morning' : 'afternoon'
      });
    }
  }
  return { closed: false, reason: slots.length ? 'ok' : 'no_slots', slots };
}

export function normalizePeruPhone(raw) {
  const text = String(raw || '').trim();
  if (!text) throw Error('Ingresa tu número de celular para confirmar tu cita.');
  if (!/^[+\d\s().-]+$/.test(text)) throw Error('Ingresa un número de celular válido.');
  let digits = text.replace(/\D/g, '');
  if (digits.startsWith('51') && digits.length === 11) {
    digits = digits.slice(2);
  }
  if (digits.length < 7 || digits.length > 15) {
    throw Error('Ingresa un celular válido (por ejemplo, 987 654 321).');
  }
  return digits;
}

export function validateBookingPayload(input, { sessionClient = null } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Error('Faltan datos para completar la reserva.');
  }
  const serviceId = String(input.serviceId || '').trim();
  if (!serviceId) throw Error('Selecciona un servicio.');
  const date = String(input.date || '').trim();
  const time = String(input.time || '').trim();
  if (!validDay(date) || !validTime(time)) {
    throw Error('Selecciona un día y una hora disponibles.');
  }
  const staffId = typeof input.staffId === 'string' && input.staffId.trim() ? input.staffId.trim() : null;
  const notes = String(input.notes || '').trim().slice(0, 500);

  if (sessionClient) {
    return {
      name: sessionClient.name,
      dni: sessionClient.dni || null,
      phone: sessionClient.phone || '',
      serviceId,
      date,
      time,
      staffId,
      notes
    };
  }

  const name = String(input.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) {
    throw Error('Escribe tu nombre y apellido (entre 2 y 120 caracteres).');
  }
  const dni = String(input.dni || '').trim().replace(/\s+/g, '');
  if (!/^\d{8}$/.test(dni)) {
    throw Error('Ingresa tu DNI de 8 dígitos.');
  }
  const phone = normalizePeruPhone(input.phone);
  return { name, dni, phone, serviceId, date, time, staffId, notes };
}

export function makeBookingCode(appointmentId) {
  const hex = String(appointmentId || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return 'TCH-' + (hex.slice(0, 6) || '000000');
}
