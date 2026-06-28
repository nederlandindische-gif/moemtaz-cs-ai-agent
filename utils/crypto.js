// long-wildflower-7606/utils/crypto.js

/**
 * Buat nonce acak untuk event id / request id.
 * Lebih stabil daripada Math.random saja.
 *
 * @returns {string}
 */
export function randomNonce() {
  try {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${Date.now().toString(36)}_${hex}`;
  } catch {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Hash SHA-1 untuk dedupe note / payload.
 *
 * @param {unknown} input
 * @returns {Promise<string>}
 */
export async function sha1(input) {
  const data = new TextEncoder().encode(String(input || ""));
  const hash = await crypto.subtle.digest("SHA-1", data);

  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}