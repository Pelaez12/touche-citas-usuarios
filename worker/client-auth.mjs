import {
  bytesToHex,
  hashPassword,
  hashText,
  normalizeClientEmail,
  validateClientPassword,
  verifyPassword
} from './crypto.mjs';
import {
  SALON_INFO,
  formatServiceName,
  limaNowParts,
  makeBookingCode,
  normalizePeruPhone
} from './scheduling.mjs';

const COOKIE_NAME = '__Host-touche_client_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 días de sesión guardada

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};

function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function sessionCookie(token, maxAge = SESSION_MAX_AGE) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function rawClientToken(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader
    .split(';')
    .map(s => s.trim())
    .find(s => s.startsWith(COOKIE_NAME + '='));
  const val = match ? match.slice(COOKIE_NAME.length + 1) : '';
  return /^[0-9a-f]{64}$/.test(val) ? val : null;
}

function normalizeFold(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateOptionalBirthday(raw, todayLima) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    Number.isNaN(Date.parse(s)) ||
    new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) !== s ||
    s > todayLima ||
    s < '1900-01-01'
  ) {
    throw Error('Ingresa una fecha de cumpleaños válida.');
  }
  return s;
}

async function bumpRateLimit(db, bucketPrefix, request, nowEpoch, maxAttempts) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const principal = await hashText(`${bucketPrefix}|${ip}`);
  const row = await db.prepare(
    `INSERT INTO web_login_limits(principal_hash, window_start, attempts) VALUES (?, ?, 1)
     ON CONFLICT(principal_hash) DO UPDATE SET
       attempts = CASE WHEN window_start < ? THEN 1 ELSE attempts + 1 END,
       window_start = CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END
     RETURNING attempts`
  ).bind(principal, nowEpoch, nowEpoch - 900, nowEpoch - 900).first();
  return (row?.attempts || 0) <= maxAttempts;
}

export async function getClientSession(request, db, now = new Date()) {
  const token = rawClientToken(request);
  if (!token || !db) return null;
  const tokenHash = await hashText(token);
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const row = await db.prepare(
    `SELECT s.token_hash AS tokenHash,
            a.id AS accountId,
            a.client_id AS clientId,
            a.email,
            c.full_name AS name,
            c.phone,
            c.dni,
            c.birthday
     FROM client_sessions s
     JOIN client_accounts a ON a.id = s.account_id
     JOIN clients c ON c.id = a.client_id
     WHERE s.token_hash = ?
       AND s.expires_at > ?
       AND a.active = 1
       AND c.archived_at IS NULL`
  ).bind(tokenHash, nowEpoch).first();
  return row || null;
}

async function loadUpcomingForClient(db, clientId, todayLima) {
  const rows = (await db.prepare(
    `SELECT a.id,
            s.name AS serviceName,
            a.starts_at AS startsAt,
            a.ends_at AS endsAt,
            COALESCE(st.display_name, NULLIF(a.assignee, ''), 'Primera especialista disponible') AS staffName
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     LEFT JOIN staff st ON st.id = a.staff_id
     WHERE a.client_id = ?
       AND a.status = 'scheduled'
       AND a.starts_at >= ?
     ORDER BY a.starts_at ASC
     LIMIT 6`
  ).bind(clientId, todayLima).all()).results;

  return rows.map(r => ({
    appointmentId: r.id,
    bookingCode: makeBookingCode(r.id),
    serviceName: formatServiceName(r.serviceName),
    date: r.startsAt.slice(0, 10),
    startTime: r.startsAt.slice(11, 16),
    endTime: r.endsAt.slice(11, 16),
    staffName: r.staffName === 'Por turno de llegada' ? 'Primera especialista disponible' : r.staffName
  }));
}

function publicClientShape(row) {
  return {
    id: row.clientId,
    name: row.name,
    email: row.email,
    phone: row.phone || '',
    dni: row.dni || '',
    birthday: row.birthday || null
  };
}

export async function handleClientAuth(request, db, readBody, { now = new Date(), sameOriginCheck = null } = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (!path.startsWith('/api/client/')) return null;

  const nowEpoch = Math.floor(now.getTime() / 1000);
  const nowIso = now.toISOString();
  const { day: todayLima } = limaNowParts(now);

  if (path === '/api/client/me' && method === 'GET') {
    const sess = await getClientSession(request, db, now);
    if (!sess) {
      return json({
        authenticated: false,
        support: {
          phone: SALON_INFO.supportPhone,
          tel: SALON_INFO.supportTel,
          whatsappUrl: SALON_INFO.supportWhatsappUrl
        }
      });
    }
    const upcomingAppointments = await loadUpcomingForClient(db, sess.clientId, todayLima);
    return json({
      authenticated: true,
      client: publicClientShape(sess),
      upcomingAppointments,
      support: {
        phone: SALON_INFO.supportPhone,
        tel: SALON_INFO.supportTel,
        whatsappUrl: SALON_INFO.supportWhatsappUrl
      }
    });
  }

  // Devuelve SOLO { id, name } de clientas aún sin cuenta vinculada (ningún dato más)
  if (path === '/api/client/unclaimed-names' && method === 'GET') {
    const allowed = await bumpRateLimit(db, 'cli-search', request, nowEpoch, 90);
    if (!allowed) {
      return json({ error: 'Demasiadas búsquedas seguidas. Espera unos minutos o escríbenos al 992 272 521.' }, 429, { 'Retry-After': '900' });
    }
    const rawQ = String(url.searchParams.get('q') || '').trim();
    const normQ = normalizeFold(rawQ);
    if (normQ.length < 2) {
      return json({ results: [] });
    }
    const rows = (await db.prepare(
      `SELECT c.id, c.full_name AS name
       FROM clients c
       WHERE c.archived_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM client_accounts ca WHERE ca.client_id = c.id)
       ORDER BY c.full_name COLLATE NOCASE`
    ).all()).results;

    const terms = normQ.split(' ').filter(Boolean);
    const matched = [];
    for (const r of rows) {
      const folded = normalizeFold(r.name);
      if (terms.every(t => folded.includes(t))) {
        matched.push({ id: r.id, name: r.name });
        if (matched.length >= 15) break;
      }
    }
    return json({ results: matched });
  }

  // Devuelve SOLO banderas booleanas de qué falta completar (jamás devuelve valores guardados)
  if (path === '/api/client/claim-requirements' && method === 'GET') {
    const clientId = String(url.searchParams.get('clientId') || '').trim();
    if (!clientId) return json({ error: 'Selecciona tu nombre de la lista.' }, 400);
    const row = await db.prepare(
      `SELECT c.id, c.full_name AS name, c.phone, c.dni, c.birthday
       FROM clients c
       WHERE c.id = ?
         AND c.archived_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM client_accounts ca WHERE ca.client_id = c.id)`
    ).bind(clientId).first();
    if (!row) {
      return json({ error: 'Ese perfil ya tiene cuenta o no está disponible. Inicia sesión o escríbenos al 992 272 521.' }, 404);
    }
    return json({
      clientId: row.id,
      name: row.name,
      needsPhone: !row.phone || !String(row.phone).trim(),
      needsDni: !row.dni || !String(row.dni).trim(),
      needsBirthday: !row.birthday || !String(row.birthday).trim()
    });
  }

  if (path === '/api/client/claim' && method === 'POST') {
    if (sameOriginCheck && !sameOriginCheck(request)) {
      return json({ error: 'Origen no permitido.' }, 403);
    }
    const allowed = await bumpRateLimit(db, 'cli-claim', request, nowEpoch, 10);
    if (!allowed) {
      return json({ error: 'Demasiados intentos seguidos. Inténtalo en unos minutos o escríbenos al 992 272 521.' }, 429, { 'Retry-After': '900' });
    }

    let body;
    try {
      body = await readBody(request);
    } catch (e) {
      return json({ error: e.message }, 400);
    }

    let email, password, phone, dni, birthday;
    const clientId = String(body?.clientId || '').trim();
    if (!clientId) return json({ error: 'Selecciona tu nombre de la lista.' }, 400);

    const existing = await db.prepare(
      `SELECT id, full_name AS name, phone, dni, birthday, archived_at AS archivedAt
       FROM clients WHERE id = ?`
    ).bind(clientId).first();
    if (!existing || existing.archivedAt) {
      return json({ error: 'No encontramos esa ficha activa. Regístrate como clienta nueva o escríbenos al 992 272 521.' }, 404);
    }
    const alreadyClaimed = await db.prepare('SELECT id FROM client_accounts WHERE client_id = ?').bind(clientId).first();
    if (alreadyClaimed) {
      return json({ error: 'Esta cuenta ya fue creada anteriormente. Inicia sesión con tu correo y contraseña o escríbenos al 992 272 521.' }, 409);
    }

    try {
      email = normalizeClientEmail(body?.email);
      password = validateClientPassword(body?.password);
      phone = normalizePeruPhone(body?.phone);
      const rawDni = String(body?.dni || '').trim().replace(/\s+/g, '');
      const needsDni = !existing.dni || !String(existing.dni).trim();
      if (needsDni) {
        if (!/^\d{8}$/.test(rawDni)) throw Error('Completa tu DNI de 8 números.');
        dni = rawDni;
      } else if (rawDni) {
        if (!/^\d{8}$/.test(rawDni)) throw Error('El DNI debe tener exactamente 8 números.');
        dni = rawDni;
      } else {
        dni = existing.dni;
      }
      birthday = validateOptionalBirthday(body?.birthday, todayLima) || existing.birthday || null;
    } catch (e) {
      return json({ error: e.message }, 400);
    }

    const emailTaken = await db.prepare('SELECT id FROM client_accounts WHERE lower(email) = ?').bind(email).first();
    if (emailTaken) {
      return json({ error: 'Este correo ya está registrado en Touché. Inicia sesión con tu correo y contraseña.' }, 409);
    }

    if (dni) {
      const dniTaken = await db.prepare('SELECT id FROM clients WHERE dni = ? AND id != ?').bind(dni, clientId).first();
      if (dniTaken) {
        return json({ error: 'Este DNI ya figura en otra ficha de Touché. Escríbenos por WhatsApp al 992 272 521 y lo resolvemos de inmediato.' }, 409);
      }
    }

    const { salt, hash } = await hashPassword(password);
    const accountId = 'clacct-' + crypto.randomUUID();
    const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await hashText(token);

    try {
      const res = await db.batch([
        db.prepare(
          `INSERT INTO client_accounts(id, client_id, email, password_hash, salt, active, created_at, updated_at, last_login_at)
           SELECT ?, ?, ?, ?, ?, 1, ?, ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM client_accounts WHERE client_id = ?)`
        ).bind(accountId, clientId, email, hash, salt, nowIso, nowIso, nowIso, clientId),
        db.prepare(
          `UPDATE clients
           SET phone = ?,
               dni = COALESCE(NULLIF(dni, ''), ?),
               birthday = COALESCE(NULLIF(birthday, ''), ?),
               in_directory = 1,
               identity_status = 'confirmed',
               updated_at = ?
           WHERE id = ? AND archived_at IS NULL`
        ).bind(phone, dni, birthday, nowIso, clientId),
        db.prepare(
          `INSERT INTO client_sessions(token_hash, account_id, expires_at, created_at)
           SELECT ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM client_accounts WHERE id = ?)`
        ).bind(tokenHash, accountId, nowEpoch + SESSION_MAX_AGE, nowEpoch, accountId),
        db.prepare(
          `INSERT INTO audit_log(id, actor, action, entity_type, entity_id, changes_json)
           SELECT ?, 'clienta-portal', 'claim-client-account', 'client', ?, ?
           WHERE EXISTS (SELECT 1 FROM client_accounts WHERE id = ?)`
        ).bind(crypto.randomUUID(), clientId, JSON.stringify({ accountId, completedFields: ['email', 'phone', 'dni'] }), accountId)
      ]);

      if (!res[0].meta.changes) {
        return json({ error: 'Esta cuenta ya fue activada. Inicia sesión con tu correo y contraseña.' }, 409);
      }
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('client_accounts.email') || msg.includes('client_accounts.client_id')) {
        return json({ error: 'Este correo o ficha ya tiene cuenta creada. Inicia sesión con tu correo.' }, 409);
      }
      if (msg.includes('clients.dni')) {
        return json({ error: 'Este DNI ya figura en otra ficha. Escríbenos por WhatsApp al 992 272 521.' }, 409);
      }
      throw err;
    }

    const upcomingAppointments = await loadUpcomingForClient(db, clientId, todayLima);
    return json(
      {
        signedIn: true,
        claimed: true,
        client: { id: clientId, name: existing.name, email, phone, dni, birthday },
        upcomingAppointments
      },
      201,
      { 'Set-Cookie': sessionCookie(token) }
    );
  }

  if (path === '/api/client/register' && method === 'POST') {
    if (sameOriginCheck && !sameOriginCheck(request)) {
      return json({ error: 'Origen no permitido.' }, 403);
    }
    const allowed = await bumpRateLimit(db, 'cli-reg', request, nowEpoch, 10);
    if (!allowed) {
      return json({ error: 'Demasiados registros seguidos desde tu conexión. Inténtalo en unos minutos o escríbenos al 992 272 521.' }, 429, { 'Retry-After': '900' });
    }

    let body;
    try {
      body = await readBody(request);
    } catch (e) {
      return json({ error: e.message }, 400);
    }

    let name, email, password, phone, dni, birthday;
    try {
      name = String(body?.name || '').trim().replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 120) throw Error('Escribe tu nombre y apellido (entre 2 y 120 caracteres).');
      email = normalizeClientEmail(body?.email);
      password = validateClientPassword(body?.password);
      phone = normalizePeruPhone(body?.phone);
      dni = String(body?.dni || '').trim().replace(/\s+/g, '');
      if (!/^\d{8}$/.test(dni)) throw Error('Ingresa tu DNI de 8 números.');
      birthday = validateOptionalBirthday(body?.birthday, todayLima);
    } catch (e) {
      return json({ error: e.message }, 400);
    }

    const emailTaken = await db.prepare('SELECT id FROM client_accounts WHERE lower(email) = ?').bind(email).first();
    if (emailTaken) {
      return json({ error: 'Este correo ya tiene cuenta en Touché. Inicia sesión con tu correo y contraseña.' }, 409);
    }
    const dniTaken = await db.prepare(
      `SELECT c.id, c.full_name AS fullName, c.phone, c.birthday, c.archived_at AS archivedAt, ca.id AS accountId
       FROM clients c
       LEFT JOIN client_accounts ca ON ca.client_id = c.id
       WHERE c.dni = ?`
    ).bind(dni).first();
    if (dniTaken && (dniTaken.archivedAt || dniTaken.accountId)) {
      return json({ error: 'Este DNI ya está registrado en Touché. Intenta iniciar sesión o escríbenos al 992 272 521 para ayudarte.' }, 409);
    }

    const { salt, hash } = await hashPassword(password);
    const linkingExisting = !!(dniTaken && !dniTaken.archivedAt && !dniTaken.accountId);
    const clientId = linkingExisting ? dniTaken.id : crypto.randomUUID();
    const accountId = 'clacct-' + crypto.randomUUID();
    const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await hashText(token);

    try {
      const clientStmt = linkingExisting
        ? db.prepare(
            `UPDATE clients
             SET phone = CASE WHEN phone IS NULL OR phone = '' THEN ? ELSE phone END,
                 birthday = CASE WHEN birthday IS NULL OR birthday = '' THEN ? ELSE birthday END,
                 updated_at = ?
             WHERE id = ?`
          ).bind(phone, birthday, nowIso, clientId)
        : db.prepare(
            `INSERT INTO clients(id, full_name, dni, phone, birthday, notes, in_directory, identity_status, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, 'confirmed', ?)`
          ).bind(clientId, name, dni, phone, birthday, 'Registrada desde portal web de clientas', nowIso);
      await db.batch([
        clientStmt,
        db.prepare(
          `INSERT INTO client_accounts(id, client_id, email, password_hash, salt, active, created_at, updated_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
        ).bind(accountId, clientId, email, hash, salt, nowIso, nowIso, nowIso),
        db.prepare(
          `INSERT INTO client_sessions(token_hash, account_id, expires_at, created_at)
           VALUES (?, ?, ?, ?)`
        ).bind(tokenHash, accountId, nowEpoch + SESSION_MAX_AGE, nowEpoch),
        db.prepare(
          `INSERT INTO audit_log(id, actor, action, entity_type, entity_id, changes_json)
           VALUES (?, 'clienta-portal', ?, 'client', ?, ?)`
        ).bind(crypto.randomUUID(), linkingExisting ? 'link-client-account-by-dni' : 'register-client-account', clientId, JSON.stringify({ accountId }))
      ]);
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('client_accounts.email')) {
        return json({ error: 'Este correo ya está registrado. Inicia sesión con tu correo y contraseña.' }, 409);
      }
      if (msg.includes('clients.dni') || msg.includes('client_accounts.client_id')) {
        return json({ error: 'Este DNI ya está registrado en Touché. Escríbenos al 992 272 521.' }, 409);
      }
      throw err;
    }

    const upcomingAppointments = linkingExisting ? await loadUpcomingForClient(db, clientId, todayLima) : [];
    return json(
      {
        signedIn: true,
        registered: true,
        client: { id: clientId, name: linkingExisting ? name : name, email, phone, dni, birthday },
        upcomingAppointments
      },
      201,
      { 'Set-Cookie': sessionCookie(token) }
    );
  }

  if (path === '/api/client/login' && method === 'POST') {
    if (sameOriginCheck && !sameOriginCheck(request)) {
      return json({ error: 'Origen no permitido.' }, 403);
    }
    const allowed = await bumpRateLimit(db, 'cli-login', request, nowEpoch, 10);
    if (!allowed) {
      return json({ error: 'Demasiados intentos de ingreso. Espera 15 minutos o escríbenos por WhatsApp al 992 272 521.' }, 429, { 'Retry-After': '900' });
    }

    let email, password;
    try {
      const body = await readBody(request);
      email = normalizeClientEmail(body?.email);
      password = String(body?.password || '');
      if (!password || password.length > 128) throw Error('Ingresa tu contraseña.');
    } catch (e) {
      return json({ error: e.message }, 400);
    }

    const account = await db.prepare(
      `SELECT a.id AS accountId,
              a.client_id AS clientId,
              a.email,
              a.password_hash AS passwordHash,
              a.salt,
              a.active,
              c.full_name AS name,
              c.phone,
              c.dni,
              c.birthday,
              c.archived_at AS archivedAt
       FROM client_accounts a
       JOIN clients c ON c.id = a.client_id
       WHERE lower(a.email) = ?`
    ).bind(email).first();

    const ok = account && !account.archivedAt && account.active && await verifyPassword(password, account.passwordHash, account.salt);
    if (!ok) {
      return json({ error: 'Correo o contraseña incorrectos. Si necesitas ayuda, escríbenos al 992 272 521.' }, 401);
    }

    const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await hashText(token);
    await db.batch([
      db.prepare('DELETE FROM client_sessions WHERE expires_at <= ?').bind(nowEpoch),
      db.prepare('INSERT INTO client_sessions(token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .bind(tokenHash, account.accountId, nowEpoch + SESSION_MAX_AGE, nowEpoch),
      db.prepare('UPDATE client_accounts SET last_login_at = ?, updated_at = ? WHERE id = ?')
        .bind(nowIso, nowIso, account.accountId)
    ]);

    const upcomingAppointments = await loadUpcomingForClient(db, account.clientId, todayLima);
    return json(
      {
        signedIn: true,
        client: publicClientShape(account),
        upcomingAppointments
      },
      200,
      { 'Set-Cookie': sessionCookie(token) }
    );
  }

  if (path === '/api/client/logout' && method === 'POST') {
    if (sameOriginCheck && !sameOriginCheck(request)) {
      return json({ error: 'Origen no permitido.' }, 403);
    }
    const sess = await getClientSession(request, db, now);
    if (sess) {
      await db.prepare('DELETE FROM client_sessions WHERE token_hash = ?').bind(sess.tokenHash).run();
    }
    return json({ signedOut: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }

  return json({ error: 'Ruta no disponible.' }, 404);
}
