// long-wildflower-7606/kommo/kommo_api.js

/**
 * Helper text sanitizer agar aman dipakai untuk payload dan log.
 * @param {unknown} value
 * @param {number} [max=2000]
 * @returns {string}
 */
function safeText(value, max = 2000) {
  const text =
    typeof value === "string"
      ? value
      : value === null || value === undefined
        ? ""
        : String(value);

  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Ambil base URL API Kommo dari env.
 * @param {Record<string, any>} env
 * @returns {string}
 */
export function getKommoBaseUrl(env) {
  const subdomain = safeText(env?.KOMMO_SUBDOMAIN || "", 120);
  if (!subdomain) return "";
  return `https://${subdomain}.kommo.com/api/v4`;
}

/**
 * Header auth standar Kommo API.
 * @param {Record<string, any>} env
 * @returns {{ Authorization: string, "Content-Type": string, Accept: string }}
 */
export function getKommoAuthHeaders(env) {
  return {
    Authorization: `Bearer ${safeText(env?.KOMMO_LONG_LIVED_TOKEN || "", 4000)}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * Validasi env minimum untuk request ke Kommo.
 * @param {Record<string, any>} env
 * @returns {boolean}
 */
function hasKommoCredentials(env) {
  return Boolean(
    safeText(env?.KOMMO_SUBDOMAIN || "", 120) &&
    safeText(env?.KOMMO_LONG_LIVED_TOKEN || "", 4000)
  );
}

/**
 * Tambah note ke lead Kommo.
 * @param {Record<string, any>} env
 * @param {number|string} leadId
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function kommoAddLeadNote(env, leadId, text) {
  if (!hasKommoCredentials(env)) {
    console.error("Kommo env missing: KOMMO_SUBDOMAIN or KOMMO_LONG_LIVED_TOKEN");
    return false;
  }

  const numericLeadId = Number(leadId || 0);
  if (!Number.isFinite(numericLeadId) || numericLeadId <= 0) {
    console.error("Kommo add note failed: invalid leadId", leadId);
    return false;
  }

  const url = `${getKommoBaseUrl(env)}/leads/notes`;

  const payload = [
    {
      entity_id: numericLeadId,
      note_type: "common",
      params: {
        text: safeText(text, 5000),
      },
    },
  ];

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: getKommoAuthHeaders(env),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error("Kommo add note failed:", res.status, err);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Kommo add note error:", err?.stack || String(err));
    return false;
  }
}

/**
 * Patch custom fields ke lead Kommo.
 * Disiapkan supaya modul API ini siap dipakai saat nanti worker dipisah lebih lanjut.
 *
 * @param {Record<string, any>} env
 * @param {number|string} leadId
 * @param {Array<{ field_id: number, values: Array<{ value: string | number }> }>} customFieldsValues
 * @returns {Promise<boolean>}
 */
export async function kommoPatchLeadCustomFields(env, leadId, customFieldsValues) {
  if (!hasKommoCredentials(env)) {
    console.error("Kommo env missing: KOMMO_SUBDOMAIN or KOMMO_LONG_LIVED_TOKEN");
    return false;
  }

  const numericLeadId = Number(leadId || 0);
  if (!Number.isFinite(numericLeadId) || numericLeadId <= 0) {
    console.error("Kommo patch lead custom fields failed: invalid leadId", leadId);
    return false;
  }

  const fields = Array.isArray(customFieldsValues)
    ? customFieldsValues.filter(
        (item) =>
          item &&
          typeof item === "object" &&
          Number.isFinite(Number(item.field_id)) &&
          Number(item.field_id) > 0 &&
          Array.isArray(item.values) &&
          item.values.length > 0
      )
    : [];

  if (!fields.length) {
    return false;
  }

  const url = `${getKommoBaseUrl(env)}/leads`;

  const payload = [
    {
      id: numericLeadId,
      custom_fields_values: fields,
    },
  ];

  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: getKommoAuthHeaders(env),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(
        "Kommo patch lead custom fields failed:",
        res.status,
        err,
        JSON.stringify(payload)
      );
      return false;
    }

    return true;
  } catch (err) {
    console.error("Kommo patch lead custom fields error:", err?.stack || String(err));
    return false;
  }
}