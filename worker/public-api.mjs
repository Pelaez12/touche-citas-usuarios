import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  EVAL_PRICE_CATEGORIES,
  MAX_BOOKING_DAYS_AHEAD,
  SALON_INFO,
  SAME_DAY_LEAD_MINUTES,
  addDays,
  computeDaySlots,
  effectiveDuration,
  formatServiceName,
  fromMinutes,
  limaNowParts,
  makeBookingCode,
  rankCandidatesForSlot,
  resolveCapability,
  sanitizePublicSpecialty,
  toMinutes,
  validDay,
  validateBookingPayload
} from './scheduling.mjs';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};

function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...extra } });
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function loadPrefs(db) {
  const row = await db.prepare("SELECT open_time, close_time, weekdays_json FROM agenda_preferences WHERE id = 'salon'").first();
  if (!row) return { openTime: '09:00', closeTime: '19:00', weekdays: [1, 2, 3, 4, 5, 6] };
  return { openTime: row.open_time, closeTime: row.close_time, weekdays: JSON.parse(row.weekdays_json) };
}

async function loadStaffGraph(db, startDay, endDayExclusive) {
  const [staffRes, catRes, ovrRes, exRes, shiftRes] = await db.batch([
    db.prepare(`SELECT id, display_name AS displayName, short_name AS shortName, role, seniority_tier AS seniorityTier,
      can_hold_appointments AS canHoldAppointments, rest_weekday AS restWeekday, specialty_summary AS specialtySummary, active
      FROM staff WHERE active = 1 AND can_hold_appointments = 1
      ORDER BY CASE role WHEN 'stylist' THEN 1 WHEN 'junior_stylist_assistant' THEN 2 WHEN 'manicurist' THEN 3 ELSE 4 END,
      display_name COLLATE NOCASE`),
    db.prepare('SELECT staff_id AS staffId, category, capability_level AS capabilityLevel FROM staff_category_capabilities'),
    db.prepare('SELECT staff_id AS staffId, service_id AS serviceId, capability_level AS capabilityLevel FROM staff_service_overrides'),
    db.prepare(`SELECT id, staff_id AS staffId, exception_date AS exceptionDate, kind, starts_time AS startsTime, ends_time AS endsTime, reason
      FROM staff_schedule_exceptions WHERE exception_date >= ? AND exception_date < ? ORDER BY exception_date, starts_time`).bind(startDay, endDayExclusive),
    db.prepare('SELECT day, staff_id AS staffId, turn_order AS turnOrder, status FROM staff_daily_shifts WHERE day >= ? AND day < ? ORDER BY turn_order').bind(startDay, endDayExclusive)
  ]);
  return {
    staff: staffRes.results.map(s => ({ ...s, active: !!s.active, canHoldAppointments: !!s.canHoldAppointments })),
    categoryCaps: catRes.results,
    serviceOverrides: ovrRes.results,
    exceptions: exRes.results,
    shifts: shiftRes.results
  };
}

function buildPublicService(row) {
  const { durationMinutes, durationMaxMinutes } = effectiveDuration(row);
  return {
    id: row.id,
    name: formatServiceName(row.name),
    rawName: row.name,
    category: row.category,
    categoryLabel: CATEGORY_LABELS[row.category] || row.category,
    priceCents: row.priceCents ?? null,
    isFree: row.priceCents === 0 || row.id === 'touche-evaluacion-capilar',
    requiresEvalPrice: EVAL_PRICE_CATEGORIES.has(row.category),
    featured: row.id === 'touche-evaluacion-capilar',
    durationMinutes,
    durationMaxMinutes
  };
}

export async function handlePublicApi(request, db, readBody, { now = new Date(), sameOriginCheck = null, clientSession = null } = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (!path.startsWith('/api/public/')) return null;

  if (path === '/api/public/catalog' && method === 'GET') {
    const [prefs, svcRes, staffRes, catRes, ovrRes] = await Promise.all([
      loadPrefs(db),
      db.prepare(`SELECT id, name, category, price_cents AS priceCents, duration_minutes AS durationMinutes, duration_max_minutes AS durationMaxMinutes
        FROM services WHERE active = 1 ORDER BY category, name COLLATE NOCASE`).all(),
      db.prepare(`SELECT id, display_name AS displayName, short_name AS shortName, role, seniority_tier AS seniorityTier,
        rest_weekday AS restWeekday, specialty_summary AS specialtySummary
        FROM staff WHERE active = 1 AND can_hold_appointments = 1
        ORDER BY CASE role WHEN 'stylist' THEN 1 WHEN 'junior_stylist_assistant' THEN 2 WHEN 'manicurist' THEN 3 ELSE 4 END,
        display_name COLLATE NOCASE`).all(),
      db.prepare('SELECT staff_id AS staffId, category, capability_level AS capabilityLevel FROM staff_category_capabilities').all(),
      db.prepare('SELECT staff_id AS staffId, service_id AS serviceId, capability_level AS capabilityLevel FROM staff_service_overrides').all()
    ]);

    const services = svcRes.results.map(buildPublicService);
    const categoriesPresent = [...new Set(services.map(s => s.category))].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a);
      const ib = CATEGORY_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    const categories = categoriesPresent.map(code => ({
      code,
      label: CATEGORY_LABELS[code] || code,
      count: services.filter(s => s.category === code).length
    }));

    const staff = staffRes.results.map(m => ({
      id: m.id,
      displayName: m.displayName,
      shortName: m.shortName || m.displayName.split(/\s+/)[0],
      specialtySummary: sanitizePublicSpecialty(m.specialtySummary, m.role)
    }));

    // Map each service to its eligible public staff IDs (no internal levels or rest days exposed)
    const serviceEligibleStaff = {};
    for (const svc of services) {
      const eligible = [];
      for (const m of staff) {
        const cap = resolveCapability(m.id, svc, catRes.results, ovrRes.results);
        if (cap) eligible.push(m.id);
      }
      serviceEligibleStaff[svc.id] = eligible;
    }

    const { day: todayLima } = limaNowParts(now);
    return json({
      today: todayLima,
      maxDate: addDays(todayLima, MAX_BOOKING_DAYS_AHEAD),
      salon: { ...SALON_INFO, ...prefs },
      categories,
      services,
      staff,
      serviceEligibleStaff
    });
  }

  if (path === '/api/public/days' && method === 'GET') {
    const serviceId = String(url.searchParams.get('serviceId') || '').trim();
    const staffId = String(url.searchParams.get('staffId') || '').trim() || null;
    if (!serviceId) return json({ error: 'Selecciona un servicio para ver los días disponibles.' }, 400);

    const serviceRow = await db.prepare(`SELECT id, name, category, price_cents AS priceCents, duration_minutes AS durationMinutes, duration_max_minutes AS durationMaxMinutes
      FROM services WHERE id = ? AND active = 1`).bind(serviceId).first();
    if (!serviceRow) return json({ error: 'Servicio no disponible.' }, 404);
    const service = buildPublicService(serviceRow);

    const { day: todayLima } = limaNowParts(now);
    const maxDay = addDays(todayLima, MAX_BOOKING_DAYS_AHEAD);

    const monthParam = url.searchParams.get('month');
    let rangeStart;
    let rangeEnd;
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const mStart = `${monthParam}-01`;
      if (!validDay(mStart)) return json({ error: 'Mes no válido.' }, 400);
      const nextM = new Date(mStart + 'T12:00:00Z');
      nextM.setUTCMonth(nextM.getUTCMonth() + 1);
      rangeStart = mStart;
      rangeEnd = addDays(nextM.toISOString().slice(0, 10), -1);
    } else {
      const startParam = url.searchParams.get('start') || todayLima;
      if (!validDay(startParam)) return json({ error: 'Fecha inicial no válida.' }, 400);
      const count = Math.min(31, Math.max(1, Number(url.searchParams.get('count') || 14) || 14));
      rangeStart = startParam < todayLima ? todayLima : startParam;
      rangeEnd = addDays(rangeStart, count - 1);
    }

    const fetchEndExclusive = addDays(rangeEnd, 1);
    const [prefs, graph, apptsRes] = await Promise.all([
      loadPrefs(db),
      loadStaffGraph(db, rangeStart, fetchEndExclusive),
      db.prepare(`SELECT id, staff_id AS staffId, starts_at AS startsAt, ends_at AS endsAt, status
        FROM appointments WHERE status = 'scheduled' AND starts_at >= ? AND starts_at < ?`).bind(rangeStart, fetchEndExclusive).all()
    ]);

    const days = [];
    for (let cursor = rangeStart; cursor <= rangeEnd; cursor = addDays(cursor, 1)) {
      const result = computeDaySlots({
        date: cursor,
        prefs,
        service,
        staffId,
        staff: graph.staff,
        categoryCaps: graph.categoryCaps,
        serviceOverrides: graph.serviceOverrides,
        exceptions: graph.exceptions,
        shifts: graph.shifts,
        dayAppointments: apptsRes.results,
        now
      });
      days.push({
        date: cursor,
        closed: result.closed,
        reason: result.reason,
        availableCount: result.slots.length,
        firstSlot: result.slots[0]?.time || null
      });
    }

    return json({ today: todayLima, maxDate: maxDay, serviceId, staffId, days });
  }

  if (path === '/api/public/availability' && method === 'GET') {
    const serviceId = String(url.searchParams.get('serviceId') || '').trim();
    const date = String(url.searchParams.get('date') || '').trim();
    const staffId = String(url.searchParams.get('staffId') || '').trim() || null;
    if (!serviceId || !validDay(date)) {
      return json({ error: 'Indica un servicio y una fecha válidos.' }, 400);
    }
    const serviceRow = await db.prepare(`SELECT id, name, category, price_cents AS priceCents, duration_minutes AS durationMinutes, duration_max_minutes AS durationMaxMinutes
      FROM services WHERE id = ? AND active = 1`).bind(serviceId).first();
    if (!serviceRow) return json({ error: 'Servicio no disponible.' }, 404);
    const service = buildPublicService(serviceRow);

    const nextDay = addDays(date, 1);
    const [prefs, graph, apptsRes] = await Promise.all([
      loadPrefs(db),
      loadStaffGraph(db, date, nextDay),
      db.prepare(`SELECT id, staff_id AS staffId, starts_at AS startsAt, ends_at AS endsAt, status
        FROM appointments WHERE status = 'scheduled' AND starts_at >= ? AND starts_at < ?`).bind(date, nextDay).all()
    ]);

    if (staffId) {
      const member = graph.staff.find(m => m.id === staffId);
      if (!member) return json({ error: 'Especialista no disponible.' }, 404);
      const cap = resolveCapability(staffId, service, graph.categoryCaps, graph.serviceOverrides);
      if (!cap) return json({ error: 'Esta especialista no realiza el servicio elegido.' }, 400);
    }

    const result = computeDaySlots({
      date,
      prefs,
      service,
      staffId,
      staff: graph.staff,
      categoryCaps: graph.categoryCaps,
      serviceOverrides: graph.serviceOverrides,
      exceptions: graph.exceptions,
      shifts: graph.shifts,
      dayAppointments: apptsRes.results,
      now
    });

    // Also compute whether ANY specialist has slots if a specific stylist was full/resting
    let anyStaffAvailableCount = result.slots.length;
    if (staffId && !result.closed && result.slots.length === 0) {
      const poolResult = computeDaySlots({
        date,
        prefs,
        service,
        staffId: null,
        staff: graph.staff,
        categoryCaps: graph.categoryCaps,
        serviceOverrides: graph.serviceOverrides,
        exceptions: graph.exceptions,
        shifts: graph.shifts,
        dayAppointments: apptsRes.results,
        now
      });
      anyStaffAvailableCount = poolResult.slots.length;
    }

    return json({
      date,
      serviceId,
      staffId,
      durationMinutes: service.durationMinutes,
      openTime: prefs.openTime,
      closeTime: prefs.closeTime,
      closed: result.closed,
      reason: result.reason,
      slots: result.slots,
      anyStaffAvailableCount
    });
  }

  if (path === '/api/public/book' && method === 'POST') {
    if (sameOriginCheck && !sameOriginCheck(request)) {
      return json({ error: 'Origen no permitido.' }, 403);
    }

    // Rate limit per IP using existing web_login_limits table with isolated key prefix
    const nowEpoch = Math.floor(now.getTime() / 1000);
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    const principal = await sha256Hex('pub-book|' + ip);
    const rateRow = await db.prepare(
      `INSERT INTO web_login_limits(principal_hash, window_start, attempts) VALUES (?, ?, 1)
       ON CONFLICT(principal_hash) DO UPDATE SET
         attempts = CASE WHEN window_start < ? THEN 1 ELSE attempts + 1 END,
         window_start = CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END
       RETURNING attempts`
    ).bind(principal, nowEpoch, nowEpoch - 900, nowEpoch - 900).first();
    if ((rateRow?.attempts || 0) > 10) {
      return json(
        { error: 'Recibimos varias reservas seguidas desde tu conexión. Inténtalo nuevamente en unos minutos.' },
        429,
        { 'Retry-After': '900' }
      );
    }

    let payload;
    try {
      payload = validateBookingPayload(await readBody(request), { sessionClient: clientSession });
    } catch (e) {
      return json({ error: e.message }, 400);
    }

    const serviceRow = await db.prepare(`SELECT id, name, category, price_cents AS priceCents, duration_minutes AS durationMinutes, duration_max_minutes AS durationMaxMinutes
      FROM services WHERE id = ? AND active = 1`).bind(payload.serviceId).first();
    if (!serviceRow) return json({ error: 'El servicio elegido ya no está disponible.' }, 404);
    const service = buildPublicService(serviceRow);

    const { day: todayLima, minutes: nowLimaMin } = limaNowParts(now);
    const maxDay = addDays(todayLima, MAX_BOOKING_DAYS_AHEAD);
    if (payload.date < todayLima) return json({ error: 'Elige una fecha a partir de hoy.' }, 400);
    if (payload.date > maxDay) return json({ error: `Puedes agendar con hasta ${MAX_BOOKING_DAYS_AHEAD} días de anticipación.` }, 400);

    const prefs = await loadPrefs(db);
    const weekday = new Date(payload.date + 'T12:00:00Z').getUTCDay();
    if (!prefs.weekdays.includes(weekday)) {
      return json({ error: 'El salón no atiende ese día. Elige de lunes a sábado.' }, 400);
    }

    const startMin = toMinutes(payload.time);
    const endMin = startMin + service.durationMinutes;
    if (endMin >= 1440) return json({ error: 'La cita debe terminar el mismo día.' }, 400);
    const endTime = fromMinutes(endMin);
    if (payload.time < prefs.openTime || endTime > prefs.closeTime) {
      return json({ error: 'Ese horario queda fuera del horario de atención del salón.' }, 400);
    }
    if (payload.date === todayLima && startMin < nowLimaMin + SAME_DAY_LEAD_MINUTES) {
      return json({ error: 'Ese horario ya pasó o está demasiado próximo. Elige una hora posterior.' }, 400);
    }

    const nextDay = addDays(payload.date, 1);
    const [graph, apptsRes] = await Promise.all([
      loadStaffGraph(db, payload.date, nextDay),
      db.prepare(`SELECT id, staff_id AS staffId, starts_at AS startsAt, ends_at AS endsAt, status
        FROM appointments WHERE status = 'scheduled' AND starts_at >= ? AND starts_at < ?`).bind(payload.date, nextDay).all()
    ]);

    const startsAt = `${payload.date}T${payload.time}:00-05:00`;
    const endsAt = `${payload.date}T${endTime}:00-05:00`;
    const ranked = rankCandidatesForSlot({
      staff: graph.staff,
      service,
      day: payload.date,
      startTime: payload.time,
      endTime,
      categoryCaps: graph.categoryCaps,
      serviceOverrides: graph.serviceOverrides,
      exceptions: graph.exceptions,
      shifts: graph.shifts,
      dayAppointments: apptsRes.results
    });

    let assignmentMode = 'pool_turn';
    let chosenStaffId = null;
    let chosenAssignee = 'Por turno de llegada';
    let publicStaffName = 'Primera especialista disponible';

    if (payload.staffId) {
      assignmentMode = 'requested';
      const cand = ranked.find(c => c.staffId === payload.staffId);
      if (!cand) return json({ error: 'La especialista seleccionada no está disponible.' }, 400);
      if (!cand.capability) return json({ error: 'La especialista seleccionada no realiza ese servicio.' }, 400);
      if (!cand.available) {
        return json({ error: `${cand.shortName} ya no tiene libre ese horario. Elige otra hora o «Primera especialista disponible».` }, 409);
      }
      chosenStaffId = cand.staffId;
      chosenAssignee = cand.shortName;
      publicStaffName = cand.displayName;
    } else {
      const freeCandidates = ranked.filter(c => c.available);
      const overlappingPool = apptsRes.results.filter(
        a => !a.staffId && a.startsAt < endsAt && a.endsAt > startsAt
      ).length;
      if (freeCandidates.length <= overlappingPool) {
        return json({ error: 'Ese horario acaba de ocuparse. Por favor elige otra hora libre.' }, 409);
      }
      const hasCheckIn = graph.shifts.some(s => s.day === payload.date && s.status === 'present');
      if (hasCheckIn) {
        chosenStaffId = freeCandidates[0].staffId;
        chosenAssignee = freeCandidates[0].shortName;
        publicStaffName = freeCandidates[0].displayName;
      }
    }

    // Client resolution: prefer authenticated client session, otherwise resolve strictly by exact 8-digit DNI
    const nowIso = now.toISOString();
    let clientId;
    if (clientSession?.clientId) {
      clientId = clientSession.clientId;
    } else {
      let existingClient = await db.prepare('SELECT id, phone, archived_at AS archivedAt FROM clients WHERE dni = ?').bind(payload.dni).first();
      if (existingClient?.archivedAt) {
        return json(
          { error: 'No pudimos completar tu reserva en línea con este documento. Por favor comunícate con recepción al 992 272 521.' },
          409
        );
      }

      if (existingClient) {
        clientId = existingClient.id;
        if ((!existingClient.phone || !String(existingClient.phone).trim()) && payload.phone) {
          await db.prepare('UPDATE clients SET phone = ?, updated_at = ? WHERE id = ? AND (phone IS NULL OR phone = "")')
            .bind(payload.phone, nowIso, clientId).run();
        }
      } else {
        clientId = crypto.randomUUID();
        try {
          await db.batch([
            db.prepare(`INSERT INTO clients(id, full_name, dni, phone, notes, in_directory, identity_status, updated_at)
              VALUES (?, ?, ?, ?, ?, 1, 'confirmed', ?)`)
              .bind(clientId, payload.name, payload.dni, payload.phone, 'Registrada desde agenda web de clientas', nowIso),
            db.prepare('INSERT INTO audit_log(id, actor, action, entity_type, entity_id, changes_json) VALUES (?, ?, ?, ?, ?, ?)')
              .bind(crypto.randomUUID(), 'reserva-web-clienta', 'public-create-client', 'client', clientId, JSON.stringify({ source: 'web-clienta' }))
          ]);
        } catch (err) {
          if (/UNIQUE constraint failed: clients\.dni/.test(String(err?.message))) {
            const raceClient = await db.prepare('SELECT id, archived_at AS archivedAt FROM clients WHERE dni = ?').bind(payload.dni).first();
            if (!raceClient || raceClient.archivedAt) {
              return json({ error: 'No pudimos completar tu reserva en línea. Intenta nuevamente.' }, 409);
            }
            clientId = raceClient.id;
          } else {
            throw err;
          }
        }
      }
    }

    const appointmentId = crypto.randomUUID();
    const bookingNotes = payload.notes
      ? `Reserva web · ${payload.notes}`
      : 'Reserva web de clienta';
    const guard = `NOT EXISTS(
      SELECT 1 FROM appointments
      WHERE status = 'scheduled'
        AND id <> ?
        AND starts_at < ?
        AND ends_at > ?
        AND (
          client_id = ?
          OR (? IS NOT NULL AND staff_id = ?)
          OR (? IS NULL AND ? <> '' AND ? <> 'Por turno de llegada' AND lower(assignee) = lower(?))
        )
    )`;
    const guardParams = [
      appointmentId,
      endsAt,
      startsAt,
      clientId,
      chosenStaffId,
      chosenStaffId,
      chosenStaffId,
      chosenAssignee,
      chosenAssignee,
      chosenAssignee
    ];

    const insertStmt = db.prepare(
      `INSERT INTO appointments(id, client_id, service_id, staff_id, assignment_mode, starts_at, ends_at, assignee, notes, status, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?
       WHERE ${guard}`
    ).bind(
      appointmentId,
      clientId,
      service.id,
      chosenStaffId,
      assignmentMode,
      startsAt,
      endsAt,
      chosenAssignee,
      bookingNotes,
      nowIso,
      ...guardParams
    );

    const eventStmt = db.prepare(
      `INSERT INTO appointment_events(id, appointment_id, event_type, next_starts_at, next_ends_at, next_staff_id, note, actor)
       SELECT ?, ?, 'created', ?, ?, ?, ?, 'reserva-web-clienta'
       WHERE EXISTS(SELECT 1 FROM appointments WHERE id = ?)`
    ).bind(
      crypto.randomUUID(),
      appointmentId,
      startsAt,
      endsAt,
      chosenStaffId,
      assignmentMode === 'pool_turn' ? 'Reserva web · primera especialista disponible' : `Reserva web · especialista elegida (${chosenAssignee})`,
      appointmentId
    );

    const auditStmt = db.prepare(
      `INSERT INTO audit_log(id, actor, action, entity_type, entity_id, changes_json)
       SELECT ?, 'reserva-web-clienta', 'public-create-appointment', 'appointment', ?, ?
       WHERE EXISTS(SELECT 1 FROM appointments WHERE id = ?)`
    ).bind(
      crypto.randomUUID(),
      appointmentId,
      JSON.stringify({ serviceId: service.id, assignmentMode, date: payload.date, startTime: payload.time }),
      appointmentId
    );

    const results = await db.batch([insertStmt, eventStmt, auditStmt]);
    if (!results[0].meta.changes) {
      return json(
        { error: 'Ese horario acaba de reservarse o ya tienes una cita registrada en ese mismo horario. Elige otra hora.' },
        409
      );
    }

    return json({
      booked: true,
      bookingCode: makeBookingCode(appointmentId),
      appointmentId,
      clientName: payload.name,
      date: payload.date,
      startTime: payload.time,
      endTime,
      durationMinutes: service.durationMinutes,
      durationMaxMinutes: service.durationMaxMinutes,
      serviceId: service.id,
      serviceName: service.name,
      serviceCategory: service.category,
      priceCents: service.priceCents,
      isFree: service.isFree,
      requiresEvalPrice: service.requiresEvalPrice,
      staffName: publicStaffName,
      assignmentMode,
      salon: { ...SALON_INFO, ...prefs }
    }, 201);
  }

  return json({ error: 'Ruta no disponible.' }, 404);
}
