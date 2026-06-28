// long-wildflower-7606/utils/env.js

/**
 * Cek apakah key env memiliki nilai eksplisit.
 *
 * @param {Record<string, any>} env
 * @param {string} key
 * @returns {boolean}
 */
function hasExplicitEnvValue(env, key) {
  const raw = env?.[key];
  return !(raw === undefined || raw === null || raw === "");
}

/**
 * Ambil boolean dari env.
 *
 * Nilai true:
 * - "1"
 * - "true"
 * - "yes"
 * - "on"
 *
 * Nilai false:
 * - "0"
 * - "false"
 * - "no"
 * - "off"
 *
 * @param {Record<string, any>} env
 * @param {string} key
 * @param {boolean} [defaultValue=false]
 * @returns {boolean}
 */
export function getBooleanEnv(env, key, defaultValue = false) {
  const raw = env?.[key];

  if (raw === undefined || raw === null || raw === "") {
    return defaultValue;
  }

  const normalized = String(raw).trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;

  return defaultValue;
}

/**
 * Ambil angka dari env.
 *
 * @param {Record<string, any>} env
 * @param {string} key
 * @param {number} defaultValue
 * @returns {number}
 */
export function getNumberEnv(env, key, defaultValue) {
  const raw = Number(env?.[key]);
  return Number.isFinite(raw) ? raw : defaultValue;
}

/**
 * Ambil field_id numerik dari daftar key env.
 *
 * @param {Record<string, any>} env
 * @param {string[]} keys
 * @returns {number}
 */
export function getEnvFieldId(env, keys) {
  const arr = Array.isArray(keys) ? keys : [];

  for (const key of arr) {
    const n = Number(env?.[key] || 0);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return 0;
}

/**
 * Mode hemat write global.
 *
 * Saat aktif, cache prioritas rendah/menengah bisa dimatikan default
 * tanpa perlu mengubah banyak bagian kode lain.
 *
 * @param {Record<string, any>} env
 * @returns {boolean}
 */
export function shouldUseWriteSaverMode(env) {
  return getBooleanEnv(env, "WRITE_SAVER_MODE", false);
}

/**
 * Flag logging debug Kommo.
 *
 * @param {Record<string, any>} env
 * @returns {boolean}
 */
export function shouldLogKommoDebug(env) {
  return getBooleanEnv(env, "KOMMO_DEBUG", true);
}

/**
 * Wrapper log debug Kommo.
 *
 * @param {Record<string, any>} env
 * @param {string} label
 * @param {unknown} payload
 * @returns {void}
 */
export function logKommoDebug(env, label, payload) {
  if (!shouldLogKommoDebug(env)) return;

  try {
    console.log(label, payload);
  } catch (err) {
    console.error("logKommoDebug error:", err?.stack || String(err));
  }
}

/**
 * Flag logging khusus quota KV / kondisi write degraded.
 *
 * @param {Record<string, any>} env
 * @returns {boolean}
 */
export function shouldLogKvQuota(env) {
  return getBooleanEnv(env, "KV_QUOTA_LOG_ENABLED", true);
}

/**
 * Cek apakah write KV sudah dinonaktifkan dalam request yang sama.
 *
 * @param {Record<string, any>} env
 * @returns {boolean}
 */
export function isKvWriteDisabled(env) {
  return Boolean(env?.__kvWriteDisabled);
}

/**
 * Aktifkan circuit breaker write KV dalam request yang sama.
 *
 * @param {Record<string, any>} env
 * @returns {void}
 */
export function disableKvWrites(env) {
  try {
    env.__kvWriteDisabled = true;
  } catch {
    // noop
  }
}

/**
 * Log quota/degraded KV hanya sekali per request agar Observability tidak spam.
 *
 * @param {Record<string, any>} env
 * @param {string} label
 * @param {unknown} payload
 * @returns {void}
 */
export function logKvQuotaNotice(env, label, payload) {
  if (!shouldLogKvQuota(env)) return;
  if (env?.__kvQuotaExceededLogged) return;

  try {
    env.__kvQuotaExceededLogged = true;
  } catch {
    // noop
  }

  try {
    console.log(label, payload);
  } catch (err) {
    console.error("logKvQuotaNotice error:", err?.stack || String(err));
  }
}

/**
 * Cache prioritas tinggi: latest customer.
 * Default tetap aktif walau mode hemat write aktif.
 *
 * Override env:
 * - SAVE_LATEST_CUSTOMER_CACHE=true/false
 *
 * @param {Record<string, any>} env
 * @returns {boolean}
 */
export function shouldSaveLatestCustomerCache(env) {
  return getBooleanEnv(env, "SAVE_LATEST_CUSTOMER_CACHE", true);
}

/**
 * Cache prioritas tinggi: tail cache.
 * Default tetap aktif walau mode hemat write aktif.
 *
 * Override env:
 * - SAVE_TAIL_CACHE=true/false
 *
 * @param {Record<string, any>} env
 * @returns {boolean}
 */
export function shouldSaveTailCache(env) {
  return getBooleanEnv(env, "SAVE_TAIL_CACHE", true);
}

/**
 * Cache prioritas menengah: summary cache.
 * Default:
 * - normal mode  => aktif
 * - write saver  => nonaktif kecuali dioverride eksplisit
 *
 * Override env:
 * - SAVE_SUMMARY_CACHE=true/false
 *
 * @param {Record<string, any>} env
 * @returns {boolean}
 */
export function shouldSaveSummaryCache(env) {
  if (hasExplicitEnvValue(env, "SAVE_SUMMARY_CACHE")) {
    return getBooleanEnv(env, "SAVE_SUMMARY_CACHE", true);
  }

  return !shouldUseWriteSaverMode(env);
}

/**
 * Cache prioritas rendah: last analysis.
 * Default:
 * - normal mode  => aktif
 * - write saver  => nonaktif kecuali dioverride eksplisit
 *
 * Override env:
 * - SAVE_LAST_ANALYSIS_CACHE=true/false
 *
 * @param {Record<string, any>} env
 * @returns {boolean}
 */
export function shouldSaveLastAnalysis(env) {
  if (hasExplicitEnvValue(env, "SAVE_LAST_ANALYSIS_CACHE")) {
    return getBooleanEnv(env, "SAVE_LAST_ANALYSIS_CACHE", true);
  }

  return !shouldUseWriteSaverMode(env);
}

/**
 * Simpan hash dedupe per-event.
 * Ini fitur pendukung, jadi default bisa ikut dimatikan saat write saver aktif.
 *
 * Override env:
 * - SAVE_PER_EVENT_HASH=true/false
 *
 * @param {Record<string, any>} env
 * @returns {boolean}
 */
export function shouldSavePerEventHash(env) {
  if (hasExplicitEnvValue(env, "SAVE_PER_EVENT_HASH")) {
    return getBooleanEnv(env, "SAVE_PER_EVENT_HASH", true);
  }

  return !shouldUseWriteSaverMode(env);
}

/**
 * Simpan latest suggested reply ke MEM.
 * Default:
 * - baca SUGGEST_REPLY_SAVE_TO_MEM bila ada
 * - jika tidak ada, normal mode => aktif
 * - jika write saver mode => nonaktif
 *
 * Override env:
 * - SUGGEST_REPLY_SAVE_TO_MEM=true/false
 *
 * @param {Record<string, any>} env
 * @returns {boolean}
 */
export function shouldSaveSuggestReplyMem(env) {
  if (hasExplicitEnvValue(env, "SUGGEST_REPLY_SAVE_TO_MEM")) {
    return getBooleanEnv(env, "SUGGEST_REPLY_SAVE_TO_MEM", true);
  }

  return !shouldUseWriteSaverMode(env);
}

/**
 * Kontrol apakah agent message ikut memperbarui summary cache.
 * Berguna untuk hemat write agresif.
 *
 * Default:
 * - normal mode  => aktif
 * - write saver  => nonaktif kecuali dioverride eksplisit
 *
 * Override env:
 * - SAVE_AGENT_MESSAGES_TO_SUMMARY=true/false
 *
 * @param {Record<string, any>} env
 * @returns {boolean}
 */
export function shouldSaveAgentMessagesToSummary(env) {
  if (hasExplicitEnvValue(env, "SAVE_AGENT_MESSAGES_TO_SUMMARY")) {
    return getBooleanEnv(env, "SAVE_AGENT_MESSAGES_TO_SUMMARY", true);
  }

  return !shouldUseWriteSaverMode(env);
}