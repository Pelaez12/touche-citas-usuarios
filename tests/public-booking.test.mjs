import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/index.mjs';
import { handlePublicApi } from '../worker/public-api.mjs';
import { formatServiceName } from '../worker/scheduling.mjs';

function makeD1Adapter(sqlite) {
  function prepare(sql) {
    let params = [];
    const stmtObj = {
      bind(...args) {
        params = args;
        return stmtObj;
      },
      async first() {
        const stmt = sqlite.prepare(sql);
        return stmt.get(...params) ?? null;
      },
      async all() {
        const stmt = sqlite.prepare(sql);
        const results = stmt.all(...params);
        return { results, meta: { changes: 0 } };
      },
      async run() {
        const stmt = sqlite.prepare(sql);
        const info = stmt.run(...params);
        return { meta: { changes: Number(info.changes || 0) } };
      },
      _exec() {
        const isSelect = /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
        const stmt = sqlite.prepare(sql);
        if (isSelect) {
          const results = stmt.all(...params);
          return { results, meta: { changes: 0 } };
        }
        const info = stmt.run(...params);
        return { results: [], meta: { changes: Number(info.changes || 0) } };
      }
    };
    return stmtObj;
  }

  return {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const out = statements.map(s => s._exec());
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    }
  };
}

function createTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE clients (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      dni TEXT CHECK(dni IS NULL OR (length(dni)=8 AND dni NOT GLOB '*[^0-9]*')),
      phone TEXT,
      birthday TEXT,
      birthday_raw TEXT,
      in_directory INTEGER NOT NULL DEFAULT 1,
      identity_status TEXT NOT NULL DEFAULT 'confirmed',
      notes TEXT NOT NULL DEFAULT '',
      archived_at TEXT,
      updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX clients_unique_dni ON clients(dni) WHERE dni IS NOT NULL;
    CREATE TABLE services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price_cents INTEGER,
      duration_minutes INTEGER,
      duration_max_minutes INTEGER,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE staff (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      short_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'stylist',
      seniority_tier TEXT NOT NULL DEFAULT 'senior',
      can_hold_appointments INTEGER NOT NULL DEFAULT 1,
      rest_weekday INTEGER,
      specialty_summary TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE staff_category_capabilities (
      staff_id TEXT NOT NULL REFERENCES staff(id),
      category TEXT NOT NULL,
      capability_level TEXT NOT NULL,
      PRIMARY KEY(staff_id, category)
    );
    CREATE TABLE staff_service_overrides (
      staff_id TEXT NOT NULL REFERENCES staff(id),
      service_id TEXT NOT NULL REFERENCES services(id),
      capability_level TEXT NOT NULL,
      PRIMARY KEY(staff_id, service_id)
    );
    CREATE TABLE staff_schedule_exceptions (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL REFERENCES staff(id),
      exception_date TEXT NOT NULL,
      kind TEXT NOT NULL,
      starts_time TEXT,
      ends_time TEXT,
      reason TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE staff_daily_shifts (
      day TEXT NOT NULL,
      staff_id TEXT NOT NULL REFERENCES staff(id),
      turn_order INTEGER NOT NULL,
      checked_in_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'present',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(day, staff_id)
    );
    CREATE TABLE agenda_preferences (
      id TEXT PRIMARY KEY CHECK(id='salon'),
      open_time TEXT NOT NULL,
      close_time TEXT NOT NULL,
      weekdays_json TEXT NOT NULL
    );
    CREATE TABLE appointments (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id),
      service_id TEXT NOT NULL REFERENCES services(id),
      staff_id TEXT REFERENCES staff(id),
      assignment_mode TEXT NOT NULL DEFAULT 'requested',
      confirmation_status TEXT NOT NULL DEFAULT 'unconfirmed',
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      assignee TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'scheduled',
      treatment_id TEXT,
      updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE appointment_events (
      id TEXT PRIMARY KEY,
      appointment_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      previous_starts_at TEXT,
      previous_ends_at TEXT,
      previous_staff_id TEXT,
      next_starts_at TEXT,
      next_ends_at TEXT,
      next_staff_id TEXT,
      note TEXT NOT NULL DEFAULT '',
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      changes_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE web_login_limits (
      principal_hash TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      attempts INTEGER NOT NULL
    );

    INSERT INTO agenda_preferences VALUES ('salon', '09:00', '19:00', '[1,2,3,4,5,6]');

    INSERT INTO services(id, name, category, price_cents, duration_minutes, duration_max_minutes, active) VALUES
      ('touche-evaluacion-capilar', 'Evaluación y diagnóstico capilar', 'ASESORÍA', 0, 20, 20, 1),
      ('catalog-24', 'CORTE DAMA', 'CORTE', 8000, 40, 60, 1),
      ('catalog-64', 'SHADES BAÑO DE COLOR MEDIANO', 'COLOR', 20000, 90, 120, 1),
      ('catalog-14', 'MANICURE GEL COLOR', 'MANOS / PIES', 5500, NULL, NULL, 1),
      ('catalog-50', 'HIGH LIGTHS MEDIANO', 'COLOR', 40000, 180, 240, 1);

    INSERT INTO staff(id, display_name, short_name, role, seniority_tier, can_hold_appointments, rest_weekday, specialty_summary, active) VALUES
      ('staff-milagros', 'Milagros Núñez', 'Mili', 'stylist', 'senior', 1, 1, 'Estilista colorista y cortes', 1),
      ('staff-miriam', 'Miriam Pecho', 'Miriam', 'stylist', 'senior', 1, 2, 'Estilista colorista, alisado y peinados (apoyo temporal: uñas y depilación)', 1),
      ('staff-maritza', 'Maritza Trucios', 'Maritza', 'stylist', 'senior', 1, 3, 'Estilista colorista y botox (apoyo temporal: uñas)', 1),
      ('staff-silvia', 'Silvia Rodríguez', 'Silvia', 'reception', 'support', 0, NULL, 'Recepción', 1);

    INSERT INTO staff_category_capabilities(staff_id, category, capability_level) VALUES
      ('staff-milagros', 'COLOR', 'primary'),
      ('staff-milagros', 'CORTE', 'primary'),
      ('staff-milagros', 'ASESORÍA', 'primary'),
      ('staff-miriam', 'COLOR', 'primary'),
      ('staff-miriam', 'ASESORÍA', 'primary'),
      ('staff-miriam', 'MANOS / PIES', 'plan_b'),
      ('staff-maritza', 'COLOR', 'primary'),
      ('staff-maritza', 'ASESORÍA', 'primary'),
      ('staff-maritza', 'MANOS / PIES', 'plan_b');

    INSERT INTO clients(id, full_name, dni, phone, archived_at) VALUES
      ('client-existing', 'Clienta Secreta Real', '12345678', '987111222', NULL),
      ('client-archived', 'Clienta Archivada', '87654321', '987000111', '2026-01-01T00:00:00Z');
  `);
  return { sqlite, db: makeD1Adapter(sqlite) };
}

const FIXED_NOW = new Date('2026-11-19T14:10:00Z'); // 09:10 AM Lima (Thursday)

async function callApi(db, path, { method = 'GET', body = undefined, ip = '203.0.113.10', origin = 'https://citas.touche.test' } = {}) {
  const headers = new Headers({ 'cf-connecting-ip': ip });
  if (origin) headers.set('origin', origin);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const req = new Request(`https://citas.touche.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const readBody = async r => r.json();
  const sameOriginCheck = r => r.headers.get('origin') === new URL(r.url).origin;
  const res = await handlePublicApi(req, db, readBody, { now: FIXED_NOW, sameOriginCheck });
  return { status: res.status, data: await res.json(), headers: res.headers };
}

test('formatServiceName converts uppercase catalog labels cleanly', () => {
  assert.equal(formatServiceName('CORTE DAMA'), 'Corte dama');
  assert.equal(formatServiceName('SHADES BAÑO DE COLOR MEDIANO'), 'Shades baño de color mediano');
  assert.equal(formatServiceName('HIGH LIGTHS MEDIANO'), 'Highlights mediano');
  assert.equal(formatServiceName('Evaluación y diagnóstico capilar'), 'Evaluación y diagnóstico capilar');
});

test('GET /api/public/catalog exposes active services & eligible specialists with zero client PII or internal staff info', async () => {
  const { db } = createTestDb();
  const { status, data } = await callApi(db, '/api/public/catalog');
  assert.equal(status, 200);
  assert.equal(data.services.length, 5);
  assert.equal(data.staff.some(s => s.id === 'staff-silvia'), false, 'Reception must not be bookable');
  assert.equal(data.staff.length, 3);
  const miriam = data.staff.find(s => s.id === 'staff-miriam');
  assert.ok(!miriam.specialtySummary.includes('apoyo temporal'), 'Internal ops text should be sanitized');
  assert.equal(Object.hasOwn(miriam, 'restWeekday'), false, 'Rest weekday must never be exposed publicly');
  assert.equal(Object.hasOwn(miriam, 'role'), false, 'Internal role must never be exposed publicly');
  assert.equal(Object.hasOwn(miriam, 'seniorityTier'), false, 'Internal seniority must never be exposed publicly');
  assert.deepEqual(data.serviceEligibleStaff['catalog-24'], ['staff-milagros']);
  assert.deepEqual(
    [...data.serviceEligibleStaff['catalog-14']].sort(),
    ['staff-maritza', 'staff-miriam']
  );
  const raw = JSON.stringify(data);
  assert.ok(!raw.includes('Clienta Secreta Real'));
  assert.ok(!raw.includes('12345678'));
  assert.ok(!raw.includes('987111222'));
  assert.ok(!raw.includes('plan_b'));
  assert.ok(!raw.includes('restWeekday'));
});

test('GET /api/public/availability respects Sundays, rest days, exceptions, and same-day lead time', async () => {
  const { db, sqlite } = createTestDb();

  // Sunday 2026-11-22 -> closed
  const sun = await callApi(db, '/api/public/availability?serviceId=catalog-24&date=2026-11-22');
  assert.equal(sun.status, 200);
  assert.equal(sun.data.closed, true);
  assert.equal(sun.data.slots.length, 0);

  // Monday 2026-11-23 -> Milagros rests (weekday 1), so Corte has 0 slots
  const monCorte = await callApi(db, '/api/public/availability?serviceId=catalog-24&date=2026-11-23');
  assert.equal(monCorte.status, 200);
  assert.equal(monCorte.data.slots.length, 0);

  // Monday 2026-11-23 -> Shades has Miriam & Maritza available!
  const monShades = await callApi(db, '/api/public/availability?serviceId=catalog-64&date=2026-11-23');
  assert.equal(monShades.status, 200);
  assert.ok(monShades.data.slots.length > 0);
  assert.equal(monShades.data.slots[0].time, '09:00');
  // Last slot for 90-min service closing at 19:00 is 17:30
  assert.equal(monShades.data.slots.at(-1).time, '17:30');

  // Today (Thursday 2026-11-19 at 09:10 AM Lima): 09:00 and 09:30 (< 09:40) are excluded; earliest is 10:00
  const todayCorte = await callApi(db, '/api/public/availability?serviceId=catalog-24&date=2026-11-19');
  assert.equal(todayCorte.status, 200);
  assert.equal(todayCorte.data.slots[0].time, '10:00');

  // Monthly calendar for Miriam (rest_weekday = 2, Tuesday): every Tuesday is silently disabled with 0 slots and no personal reason leaked
  const miriamMonth = await callApi(db, '/api/public/days?serviceId=catalog-64&staffId=staff-miriam&month=2026-11');
  assert.equal(miriamMonth.status, 200);
  const tue24 = miriamMonth.data.days.find(d => d.date === '2026-11-24');
  const wed25 = miriamMonth.data.days.find(d => d.date === '2026-11-25');
  assert.equal(tue24.availableCount, 0, 'Miriam Tuesday must be disabled');
  assert.ok(wed25.availableCount > 0, 'Miriam Wednesday must be open');
  assert.ok(!JSON.stringify(miriamMonth.data).toLowerCase().includes('descans'), 'Must never leak rest-day text');

  // Add a partial_block on Milagros 10:00-11:30 on 2026-11-26 (Thursday)
  sqlite.exec(`INSERT INTO staff_schedule_exceptions(id, staff_id, exception_date, kind, starts_time, ends_time, reason)
    VALUES ('ex-1', 'staff-milagros', '2026-11-26', 'partial_block', '10:00', '11:30', 'Médico')`);
  const thuCorte = await callApi(db, '/api/public/availability?serviceId=catalog-24&date=2026-11-26&staffId=staff-milagros');
  assert.equal(thuCorte.status, 200);
  const times = thuCorte.data.slots.map(s => s.time);
  assert.ok(times.includes('09:00'));
  assert.ok(!times.includes('09:30'), '09:30+40min=10:10 overlaps 10:00-11:30 block');
  assert.ok(!times.includes('10:00'));
  assert.ok(!times.includes('11:00'));
  assert.ok(times.includes('11:30'));
});

test('POST /api/public/book enforces specialty, prevents double booking, links existing DNI safely, and rate-limits', async () => {
  const { db, sqlite } = createTestDb();

  // Cross-origin rejected
  const csrf = await callApi(db, '/api/public/book', {
    method: 'POST',
    origin: 'https://evil.example',
    body: { serviceId: 'catalog-24', date: '2026-11-26', time: '10:00', name: 'Ana', phone: '999888777', dni: '44556677' }
  });
  assert.equal(csrf.status, 403);

  // Incompatible specialist (Maritza does not cut hair)
  const wrongSpec = await callApi(db, '/api/public/book', {
    method: 'POST',
    body: { serviceId: 'catalog-24', staffId: 'staff-maritza', date: '2026-11-26', time: '10:00', name: 'Ana Test', phone: '999888777', dni: '44556677' }
  });
  assert.equal(wrongSpec.status, 400);

  // Valid booking for brand-new client with specific stylist
  const ok1 = await callApi(db, '/api/public/book', {
    method: 'POST',
    body: {
      serviceId: 'catalog-24',
      staffId: 'staff-milagros',
      date: '2026-11-26',
      time: '10:00',
      name: 'Sofía Mendoza',
      phone: '+51 987 654 321',
      dni: '44556677',
      notes: 'Puntas y capas suaves'
    }
  });
  assert.equal(ok1.status, 201);
  assert.equal(ok1.data.booked, true);
  assert.match(ok1.data.bookingCode, /^TCH-[A-Z0-9]{6}$/);
  assert.equal(ok1.data.endTime, '10:40');
  assert.equal(ok1.data.staffName, 'Milagros Núñez');
  assert.equal(ok1.data.assignmentMode, 'requested');

  const storedClient = sqlite.prepare('SELECT full_name, phone, dni FROM clients WHERE dni = ?').get('44556677');
  assert.equal(storedClient.full_name, 'Sofía Mendoza');
  assert.equal(storedClient.phone, '987654321');
  const storedEvent = sqlite.prepare('SELECT event_type, actor FROM appointment_events WHERE appointment_id = ?').get(ok1.data.appointmentId);
  assert.equal(storedEvent.event_type, 'created');
  assert.equal(storedEvent.actor, 'reserva-web-clienta');

  // Overlapping slot on Milagros blocked with 409
  const dupSlot = await callApi(db, '/api/public/book', {
    method: 'POST',
    body: {
      serviceId: 'catalog-24',
      staffId: 'staff-milagros',
      date: '2026-11-26',
      time: '10:30',
      name: 'Otra Clienta',
      phone: '911222333',
      dni: '55667788'
    }
  });
  assert.equal(dupSlot.status, 409);

  // Existing active client DNI reused WITHOUT leaking stored PII or overwriting name/phone
  const existingBook = await callApi(db, '/api/public/book', {
    method: 'POST',
    body: {
      serviceId: 'touche-evaluacion-capilar',
      staffId: null,
      date: '2026-11-26',
      time: '11:00',
      name: 'Otro Nombre Escrito',
      phone: '900000001',
      dni: '12345678'
    }
  });
  assert.equal(existingBook.status, 201);
  assert.equal(existingBook.data.assignmentMode, 'pool_turn');
  assert.ok(!JSON.stringify(existingBook.data).includes('Clienta Secreta Real'));
  assert.ok(!JSON.stringify(existingBook.data).includes('987111222'));
  const unchangedClient = sqlite.prepare('SELECT full_name, phone FROM clients WHERE id = ?').get('client-existing');
  assert.equal(unchangedClient.full_name, 'Clienta Secreta Real');
  assert.equal(unchangedClient.phone, '987111222');

  // Archived client DNI rejected neutrally
  const arch = await callApi(db, '/api/public/book', {
    method: 'POST',
    body: {
      serviceId: 'touche-evaluacion-capilar',
      date: '2026-11-26',
      time: '12:00',
      name: 'Alguien',
      phone: '911111111',
      dni: '87654321'
    }
  });
  assert.equal(arch.status, 409);
  assert.ok(!arch.data.error.includes('Clienta Archivada'));

  // Rate limit kicks in after 10 attempts from same IP
  for (let i = 0; i < 6; i++) {
    await callApi(db, '/api/public/book', { method: 'POST', ip: '198.51.100.7', body: { bad: true } });
  }
  for (let i = 0; i < 4; i++) {
    await callApi(db, '/api/public/book', { method: 'POST', ip: '198.51.100.7', body: { bad: true } });
  }
  const limited = await callApi(db, '/api/public/book', { method: 'POST', ip: '198.51.100.7', body: { bad: true } });
  assert.equal(limited.status, 429);
});

test('Worker serves HTML, CSS, SW, and strict security headers', async () => {
  const { db } = createTestDb();
  const resHtml = await worker.fetch(new Request('https://citas.touche.test/'), { DB: db });
  assert.equal(resHtml.status, 200);
  assert.match(resHtml.headers.get('content-type') || '', /text\/html/);
  assert.match(resHtml.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.equal(resHtml.headers.get('cache-control'), 'no-store');

  const resSw = await worker.fetch(new Request('https://citas.touche.test/sw.js'), { DB: db });
  assert.equal(resSw.status, 200);
  assert.equal(resSw.headers.get('service-worker-allowed'), '/');

  const resCss = await worker.fetch(new Request('https://citas.touche.test/style.css'), { DB: db });
  assert.equal(resCss.status, 200);
  const etag = resCss.headers.get('etag');
  assert.ok(etag);
  const res304 = await worker.fetch(new Request('https://citas.touche.test/style.css', { headers: { 'if-none-match': etag } }), { DB: db });
  assert.equal(res304.status, 304);

  const resPrivate = await worker.fetch(new Request('https://citas.touche.test/api/clients'), { DB: db });
  assert.equal(resPrivate.status, 404);
});
