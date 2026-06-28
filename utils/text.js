// long-wildflower-7606/utils/text.js

/**
 * Sanitizer text umum.
 * - convert ke string
 * - rapikan whitespace
 * - trim
 * - potong panjang maksimum
 *
 * @param {unknown} value
 * @param {number} [max=2000]
 * @returns {string}
 */
export function safeText(value, max = 2000) {
  const text =
    typeof value === "string"
      ? value
      : value === null || value === undefined
        ? ""
        : String(value);

  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Sanitizer text yang mempertahankan baris baru (newline).
 * - convert ke string
 * - rapikan spasi berlebih, abaikan newline
 * - potong panjang maksimum
 *
 * @param {unknown} value
 * @param {number} [max=2000]
 * @returns {string}
 */
export function safeMultilineText(value, max = 2000) {
  const text =
    typeof value === "string"
      ? value
      : value === null || value === undefined
        ? ""
        : String(value);

  return text.replace(/[^\S\r\n]+/g, " ").trim().slice(0, max);
}

/**
 * Tampilkan value dengan fallback bila kosong.
 *
 * @param {unknown} value
 * @param {string} [fallback="-"]
 * @param {number} [max=1200]
 * @returns {string}
 */
export function safeDisplay(value, fallback = "-", max = 1200) {
  const out = safeText(value, max);
  return out || fallback;
}

/**
 * Sanitizer untuk bagian key KV / cache key.
 *
 * @param {unknown} value
 * @param {number} [max=120]
 * @returns {string}
 */
export function safeKvPart(value, max = 120) {
  return safeText(value, max)
    .replace(/[^\w.-]/g, "_")
    .slice(0, max);
}