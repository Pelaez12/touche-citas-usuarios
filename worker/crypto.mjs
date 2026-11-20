const encoder = new TextEncoder();
const PBKDF2_ITERATIONS = 100000;

export function constantTimeEqual(a, b) {
  const left = a instanceof Uint8Array ? a : new Uint8Array(a);
  const right = b instanceof Uint8Array ? b : new Uint8Array(b);
  if (left.byteLength !== right.byteLength) return false;
  if (typeof crypto?.subtle?.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(left, right);
  }
  let diff = 0;
  for (let i = 0; i < left.byteLength; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

export function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function hashText(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return bytesToHex(digest);
}

export function normalizeClientEmail(value) {
  const clean = String(value || '').trim().toLowerCase();
  if (
    !clean ||
    clean.length > 120 ||
    !/^[a-z0-9._+-]{2,64}@[a-z0-9.-]+\.[a-z]{2,24}$/.test(clean) ||
    clean.includes('..')
  ) {
    throw Error('Ingresa un correo válido (por ejemplo, tunombre@gmail.com).');
  }
  return clean;
}

export function validateClientPassword(value) {
  if (typeof value !== 'string' || value.length < 6 || value.length > 128 || !value.trim()) {
    throw Error('Tu contraseña debe tener al menos 6 caracteres.');
  }
  return value;
}

export async function hashPassword(password, saltHex = bytesToHex(crypto.getRandomValues(new Uint8Array(16)))) {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return { salt: saltHex, hash: `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${bytesToHex(derived)}` };
}

export async function verifyPassword(password, storedHash, salt) {
  if (typeof password !== 'string' || !storedHash || !salt) return false;
  if (!storedHash.startsWith('pbkdf2_sha256$')) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const iterations = Number(parts[1]);
  const expectedHex = parts[2];
  if (!Number.isInteger(iterations) || iterations < 1000 || !/^[0-9a-f]{64}$/.test(expectedHex)) return false;
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: hexToBytes(salt), iterations, hash: 'SHA-256' },
      keyMaterial,
      256
    )
  );
  return constantTimeEqual(derived, hexToBytes(expectedHex));
}
