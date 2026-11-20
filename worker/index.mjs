import assets from './assets.generated.mjs';
import { getClientSession, handleClientAuth } from './client-auth.mjs';
import { handlePublicApi } from './public-api.mjs';

const SECURITY_BASE = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; frame-src https://www.facebook.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Strict-Transport-Security': 'max-age=15552000',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', ...SECURITY_BASE };
const STATIC_CACHE = 'public, max-age=3600, stale-while-revalidate=86400';
const CODE_CACHE = 'public, max-age=0, must-revalidate';

export function sameOrigin(request) {
  return request.headers.get('origin') === new URL(request.url).origin
    && request.headers.get('sec-fetch-site') !== 'cross-site';
}

async function readBody(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    throw Error('Se requiere formato JSON.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw Error('Faltan los datos de la reserva.');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8192) {
      await reader.cancel();
      throw Error('Los datos enviados superan el tamaño permitido.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function etagMatches(header, etag) {
  if (!header || !etag) return false;
  const target = etag.replace(/^W\//, '');
  return header.split(',').some(tag => {
    const t = tag.trim();
    return t === '*' || t.replace(/^W\//, '') === target;
  });
}

function serveAsset(path, request, status = 200) {
  const a = assets[path];
  if (!a) return new Response('No encontrado', { status: 404, headers: NO_STORE_HEADERS });
  const isHtml = path.endsWith('.html');
  const isSw = path === '/sw.js';
  const isCode = path.endsWith('.mjs') || path.endsWith('.css') || path.endsWith('.webmanifest');
  const headers = isHtml
    ? { ...NO_STORE_HEADERS, 'Content-Type': a.type }
    : isSw
      ? {
          ...SECURITY_BASE,
          'Cache-Control': 'no-cache',
          'Service-Worker-Allowed': '/',
          'Content-Type': a.type,
          ...(a.etag ? { ETag: a.etag } : {})
        }
      : {
          ...SECURITY_BASE,
          'Cache-Control': isCode ? CODE_CACHE : STATIC_CACHE,
          'Content-Type': a.type,
          ...(a.etag ? { ETag: a.etag } : {})
        };
  if (!isHtml && a.etag && etagMatches(request?.headers?.get('if-none-match'), a.etag)) {
    return new Response(null, { status: 304, headers });
  }
  const bytes = Uint8Array.from(atob(a.data), c => c.charCodeAt(0));
  return new Response(bytes, { status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/client/')) {
      try {
        const res = await handleClientAuth(request, env.DB, readBody, { sameOriginCheck: sameOrigin });
        if (res) return res;
      } catch (err) {
        console.error(JSON.stringify({ event: 'client-auth-error', path, method: request.method, message: String(err?.message || err) }));
        return new Response(
          JSON.stringify({ error: 'No pudimos completar tu solicitud en este momento. Inténtalo nuevamente o escríbenos al 992 272 521.' }),
          { status: 500, headers: { ...NO_STORE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } }
        );
      }
    }

    if (path.startsWith('/api/public/')) {
      try {
        const clientSession = path === '/api/public/book' && request.method === 'POST'
          ? await getClientSession(request, env.DB)
          : null;
        const res = await handlePublicApi(request, env.DB, readBody, { sameOriginCheck: sameOrigin, clientSession });
        if (res) return res;
      } catch (err) {
        console.error(JSON.stringify({ event: 'public-booking-error', path, method: request.method, message: String(err?.message || err) }));
        return new Response(
          JSON.stringify({ error: 'No pudimos completar tu solicitud en este momento. Inténtalo nuevamente o escríbenos al 992 272 521.' }),
          { status: 500, headers: { ...NO_STORE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } }
        );
      }
    }

    if (path.startsWith('/api/')) {
      return new Response(
        JSON.stringify({ error: 'Ruta no disponible.' }),
        { status: 404, headers: { ...NO_STORE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Método no permitido', { status: 405, headers: NO_STORE_HEADERS });
    }

    if (path === '/' || path === '/index.html' || path === '/reservar') {
      return serveAsset('/index.html', request);
    }
    return serveAsset(path, request);
  }
};
