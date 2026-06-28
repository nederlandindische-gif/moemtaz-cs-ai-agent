// long-wildflower-7606/utils/ai_output.js

import { safeText } from "./text.js";

/**
 * Ambil text output dari berbagai bentuk response model / API.
 *
 * Support:
 * - data.output_text
 * - data.output[].content[]
 * - content type: output_text / text / output_json / json
 *
 * @param {unknown} data
 * @returns {string}
 */
export function extractOutputAnyText(data) {
  const src =
    data && typeof data === "object"
      ? /** @type {Record<string, any>} */ (data)
      : {};

  const direct = safeText(src.output_text || "", 8000);
  if (direct) return direct;

  const output = Array.isArray(src.output) ? src.output : [];
  const parts = [];

  for (const item of output) {
    const row =
      item && typeof item === "object"
        ? /** @type {Record<string, any>} */ (item)
        : {};

    const content = Array.isArray(row.content) ? row.content : [];

    for (const c of content) {
      const entry =
        c && typeof c === "object"
          ? /** @type {Record<string, any>} */ (c)
          : {};

      if (entry.type === "output_text" || entry.type === "text") {
        if (typeof entry.text === "string") {
          parts.push(entry.text);
        } else if (entry.text && typeof entry.text === "object" && typeof entry.text.value === "string") {
          parts.push(entry.text.value);
        } else if (typeof entry.value === "string") {
          parts.push(entry.value);
        }
        continue;
      }

      if (entry.type === "output_json" || entry.type === "json") {
        if (entry.json && typeof entry.json === "object") {
          parts.push(JSON.stringify(entry.json));
        } else if (typeof entry.text === "string") {
          parts.push(entry.text);
        } else if (typeof entry.value === "string") {
          parts.push(entry.value);
        }
      }
    }
  }

  return safeText(parts.join("\n"), 8000);
}

/**
 * Parse JSON dari text yang kadang berisi:
 * - code fence ```json
 * - text tambahan sebelum / sesudah JSON
 *
 * @param {unknown} text
 * @returns {any | null}
 */
export function tryParseJsonLoose(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // continue
  }

  const i = cleaned.indexOf("{");
  const j = cleaned.lastIndexOf("}");

  if (i >= 0 && j > i) {
    try {
      return JSON.parse(cleaned.slice(i, j + 1));
    } catch {
      // continue
    }
  }

  return null;
}