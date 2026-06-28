// long-wildflower-7606/utils/collection.js

import { safeText } from "./text.js";

/**
 * Ambil value persentase yang aman 0-100.
 *
 * @param {unknown} value
 * @param {number} [fallback=20]
 * @returns {number}
 */
export function safePercent(value, fallback = 20) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Cari angka pertama yang valid dari daftar values lalu normalize ke 0-100.
 *
 * @param {...unknown} values
 * @returns {number}
 */
export function analysisPercent(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return Math.max(0, Math.min(100, Math.round(n)));
    }
  }

  return 20;
}

/**
 * Ambil string non-kosong pertama.
 *
 * @param {unknown[]} values
 * @returns {string}
 */
export function firstNonEmpty(values) {
  const arr = Array.isArray(values) ? values : [];

  for (const value of arr) {
    const s = String(value || "").trim();
    if (s) return s;
  }

  return "";
}

/**
 * Ubah value array menjadi array string yang aman.
 *
 * @param {unknown} value
 * @param {number} [maxPerItem=120]
 * @returns {string[]}
 */
export function toStringArray(value, maxPerItem = 120) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => safeText(String(x || ""), maxPerItem)).filter(Boolean);
}

/**
 * Deduplicate array string.
 *
 * @param {unknown} arr
 * @returns {string[]}
 */
export function uniqueStrings(arr) {
  return [...new Set((Array.isArray(arr) ? arr : []).filter(Boolean))];
}

/**
 * Merge object matched_in.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {{ latest: string[], tail: string[], summary: string[] }}
 */
export function mergeMatchedIn(a, b) {
  const left =
    a && typeof a === "object"
      ? /** @type {{ latest?: unknown, tail?: unknown, summary?: unknown }} */ (a)
      : { latest: [], tail: [], summary: [] };

  const right =
    b && typeof b === "object"
      ? /** @type {{ latest?: unknown, tail?: unknown, summary?: unknown }} */ (b)
      : { latest: [], tail: [], summary: [] };

  return {
    latest: uniqueStrings([...toStringArray(left.latest), ...toStringArray(right.latest)]),
    tail: uniqueStrings([...toStringArray(left.tail), ...toStringArray(right.tail)]),
    summary: uniqueStrings([...toStringArray(left.summary), ...toStringArray(right.summary)]),
  };
}

/**
 * Helper untuk push custom field Kommo.
 *
 * @param {Array<{ field_id: number, values: Array<{ value: string | number }> }>} target
 * @param {unknown} fieldId
 * @param {unknown} value
 * @returns {void}
 */
export function pushCustomFieldValue(target, fieldId, value) {
  if (!Array.isArray(target)) return;

  const id = Number(fieldId || 0);
  if (!Number.isFinite(id) || id <= 0) return;

  const normalizedValue =
    typeof value === "number"
      ? value
      : safeText(String(value || ""), 4000);

  if (normalizedValue === "" || normalizedValue === null || normalizedValue === undefined) {
    return;
  }

  target.push({
    field_id: id,
    values: [{ value: normalizedValue }],
  });
}