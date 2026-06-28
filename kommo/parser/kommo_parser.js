// long-wildflower-7606/kommo/parser/kommo_parser.js

const MAX_RAW_TEXT_SCAN = 100000;
const MAX_MESSAGES_PER_PAYLOAD = 100;
const MAX_JSON_WALK_DEPTH = 2;

/**
 * Sanitizer text umum.
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
 * Type guard untuk memastikan value adalah object biasa / record.
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
export function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Deteksi apakah raw body terlihat seperti JSON walau content-type tidak tepat.
 * @param {unknown} raw
 * @returns {boolean}
 */
export function looksLikeJsonPayload(raw) {
  const trimmed = safeText(raw, MAX_RAW_TEXT_SCAN).trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/**
 * Normalisasi entity type Kommo supaya konsisten.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeKommoEntityType(value) {
  let raw = "";

  if (isRecord(value)) {
    const obj = /** @type {Record<string, any>} */ (value);

    raw = safeText(
      obj.entity_type ??
        obj.entityType ??
        obj.entity ??
        obj.entity_type_id ??
        obj.entityTypeId ??
        obj.type ??
        "",
      80
    ).toLowerCase();
  } else {
    raw = safeText(value, 80).toLowerCase();
  }

  if (!raw) return "";

  if (["lead", "leads", "2"].includes(raw)) return "lead";
  if (["contact", "contacts", "1"].includes(raw)) return "contact";
  if (["company", "companies", "3"].includes(raw)) return "company";
  if (["customer", "customers"].includes(raw)) return "customer";
  if (["chat", "message", "incoming_message"].includes(raw)) return raw;

  return raw;
}

/**
 * Ambil text pesan dari berbagai kemungkinan bentuk payload Kommo.
 * @param {Record<string, any>} message
 * @returns {string}
 */
export function extractInboundText(message) {
  if (!isRecord(message)) return "";

  const directCandidates = [
    message.text,
    message.message,
    message.body,
    message.content,
    message.caption,
    message.comment,
    message.description,
    message["message[text]"],
    message["text[value]"],
    message["content[text]"],
  ];

  for (const candidate of directCandidates) {
    const out = coerceInboundTextValue(candidate, 0);
    if (out) return out;
  }

  const preferredEntryCandidates = Object.entries(message)
    .filter(([key]) => /(text|message|body|content|caption|comment|description)/i.test(key))
    .map(([, value]) => value);

  for (const candidate of preferredEntryCandidates) {
    const out = coerceInboundTextValue(candidate, 0);
    if (out) return out;
  }

  return "";
}

/**
 * Helper rekursif untuk paksa value jadi text message.
 * @param {unknown} value
 * @param {number} [depth=0]
 * @returns {string}
 */
export function coerceInboundTextValue(value, depth = 0) {
  if (depth > 3) return "";

  if (typeof value === "string") {
    return safeText(value, 2000);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return safeText(String(value), 2000);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const out = coerceInboundTextValue(item, depth + 1);
      if (out) return out;
    }
    return "";
  }

  if (isRecord(value)) {
    const preferredKeys = [
      "text",
      "message",
      "body",
      "content",
      "caption",
      "comment",
      "description",
      "value",
      "plain",
      "html",
    ];

    for (const key of preferredKeys) {
      const out = coerceInboundTextValue(value[key], depth + 1);
      if (out) return out;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      if (!/(text|message|body|content|caption|comment|description|value)/i.test(key)) {
        continue;
      }
      const out = coerceInboundTextValue(nestedValue, depth + 1);
      if (out) return out;
    }
  }

  return "";
}

/**
 * Ambil entity id dari kemungkinan field Kommo yang berbeda.
 * @param {Record<string, any>} message
 * @returns {number}
 */
export function extractKommoEntityId(message) {
  if (!isRecord(message)) return 0;

  const candidates = [
    message.entity_id,
    message.entityId,
    message.lead_id,
    message.leadId,
    message.lead?.id,
    message.entity?.id,
  ];

  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return 0;
}

/**
 * Ambil stable message id jika ada.
 * @param {Record<string, any>} message
 * @returns {string}
 */
export function extractKommoMessageId(message) {
  if (!isRecord(message)) return "";

  const candidates = [
    message.id,
    message.message_id,
    message.messageId,
    message.msg_id,
    message.msgId,
    message.event_id,
    message.eventId,
    message.chat_message_id,
    message.chatMessageId,
  ];

  for (const candidate of candidates) {
    const out = safeText(candidate, 120);
    if (out) return out;
  }

  return "";
}

/**
 * Ambil timestamp message dalam ms jika ada.
 * @param {Record<string, any>} message
 * @returns {number}
 */
export function extractKommoMessageTimestamp(message) {
  if (!isRecord(message)) return 0;

  const candidates = [
    message.created_at,
    message.createdAt,
    message.updated_at,
    message.updatedAt,
    message.timestamp,
    message.ts,
    message.time,
    message.sent_at,
    message.date_create,
    message.date,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return candidate < 1e12 ? candidate * 1000 : candidate;
    }

    if (typeof candidate === "string" && candidate.trim()) {
      const asNumber = Number(candidate);
      if (Number.isFinite(asNumber) && asNumber > 0) {
        return asNumber < 1e12 ? asNumber * 1000 : asNumber;
      }

      const parsed = Date.parse(candidate);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  return 0;
}

/**
 * Cek apakah object terlihat seperti message object Kommo.
 * Dibikin lebih ketat supaya object biasa tidak dianggap message.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function looksLikeKommoMessageObject(value) {
  if (!isRecord(value)) return false;

  const obj = /** @type {Record<string, any>} */ (value);
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;

  const entityType = normalizeKommoEntityType(
    obj.entity_type ??
      obj.entityType ??
      obj.entity ??
      obj.entity_type_id ??
      obj.entityTypeId
  );

  const entityId = extractKommoEntityId(obj);
  const messageId = extractKommoMessageId(obj);
  const text = extractInboundText(obj);

  const hasEntitySignal = Boolean(entityId) || Boolean(entityType);
  const hasTextSignal = Boolean(text);
  const hasMessageIdentitySignal =
    Boolean(messageId) ||
    "message_type" in obj ||
    "messageType" in obj ||
    "direction" in obj ||
    "type" in obj;

  return (hasEntitySignal && hasTextSignal) || (hasMessageIdentitySignal && hasTextSignal);
}

/**
 * Normalisasi kumpulan candidate message ke array object.
 * Sekarang lebih ketat: hanya ambil object yang benar-benar mirip message.
 *
 * @param {unknown} value
 * @returns {Array<Record<string, any>>}
 */
export function normalizeMessageCollection(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.filter((item) => looksLikeKommoMessageObject(item));
  }

  if (isRecord(value)) {
    if (looksLikeKommoMessageObject(value)) {
      return [value];
    }

    const objectValues = Object.values(value).filter((item) => looksLikeKommoMessageObject(item));
    if (objectValues.length > 0) {
      return /** @type {Array<Record<string, any>>} */ (objectValues);
    }
  }

  return [];
}

/**
 * Cari candidate array message dari node JSON secara terbatas.
 * Ini mencegah parser nyasar ke object random/history yang tidak relevan.
 *
 * @param {unknown} root
 * @param {number} [depth=0]
 * @returns {Array<Record<string, any>>}
 */
export function findKommoMessageCollectionsDeep(root, depth = 0) {
  if (depth > MAX_JSON_WALK_DEPTH) return [];

  const direct = normalizeMessageCollection(root);
  if (direct.length > 0) return direct;

  if (Array.isArray(root)) {
    const flattened = root.filter((item) => looksLikeKommoMessageObject(item));
    if (flattened.length > 0) {
      return /** @type {Array<Record<string, any>>} */ (flattened);
    }

    for (const item of root) {
      const nested = findKommoMessageCollectionsDeep(item, depth + 1);
      if (nested.length > 0) return nested;
    }
    return [];
  }

  if (!isRecord(root)) return [];

  const preferredKeys = [
    "message",
    "messages",
    "message_add",
    "data",
    "payload",
    "result",
    "_embedded",
    "incoming",
    "webhook",
  ];

  for (const key of preferredKeys) {
    const nested = findKommoMessageCollectionsDeep(root[key], depth + 1);
    if (nested.length > 0) return nested;
  }

  return [];
}

/**
 * Ekstrak messages dari payload JSON Kommo.
 * Prioritaskan jalur yang lazim dipakai webhook Kommo.
 *
 * @param {unknown} json
 * @returns {Array<Record<string, any>>}
 */
export function extractKommoMessagesFromJson(json) {
  const root = isRecord(json) ? json : null;

  const candidates = [
    root?.message?.add,
    root?.messages,
    root?.message_add,
    root?.data?.message?.add,
    root?.data?.messages,
    root?.payload?.message?.add,
    root?.payload?.messages,
    root?.result?.message?.add,
    root?.result?.messages,
    root?._embedded?.messages,
    root?.incoming?.messages,
    root?.webhook?.message?.add,
    root?.webhook?.messages,
    Array.isArray(json) ? json : null,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeMessageCollection(candidate);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  const fallback = findKommoMessageCollectionsDeep(json, 0);
  if (fallback.length > 0) {
    return fallback;
  }

  if (looksLikeKommoMessageObject(json)) {
    return [/** @type {Record<string, any>} */ (json)];
  }

  return [];
}

/**
 * Parse payload x-www-form-urlencoded Kommo.
 * Hasilnya mempertahankan field asli.
 *
 * @param {URLSearchParams} params
 * @returns {Array<Record<string, any>>}
 */
export function parseKommoForm(params) {
  /** @type {Map<string, Record<string, any>>} */
  const byIdx = new Map();

  for (const [k, v] of params.entries()) {
    const m = k.match(/^message\[add\]\[(\d+)\]\[(.+)\]$/);
    if (!m) continue;

    const idx = m[1];
    const field = m[2];

    const obj = byIdx.get(idx) || {};
    obj[field] = v;
    byIdx.set(idx, obj);
  }

  return [...byIdx.values()].filter((item) => looksLikeKommoMessageObject(item) || extractInboundText(item));
}

/**
 * Normalisasi 1 message agar field utamanya seragam.
 * Fungsi ini tetap menyimpan field asli melalui spread.
 *
 * @param {Record<string, any>} message
 * @returns {Record<string, any>}
 */
export function normalizeKommoMessage(message) {
  const source = isRecord(message) ? message : {};

  const text = extractInboundText(source);
  const entityId = extractKommoEntityId(source);
  const entityType = normalizeKommoEntityType(
    source.entity_type ??
      source.entityType ??
      source.entity ??
      source.entity_type_id ??
      source.entityTypeId
  );

  const direction = safeText(
    source.type ??
      source.direction ??
      source.message_type ??
      source.msg_type ??
      source.messageType ??
      "incoming",
    80
  ).toLowerCase();

  const messageId = extractKommoMessageId(source);
  const ts = extractKommoMessageTimestamp(source);

  return {
    ...source,
    id: safeText(source.id ?? messageId, 120),
    message_id: messageId,
    ts,
    text,
    entity_id: entityId,
    entity_type: entityType,
    type: direction || "incoming",
  };
}

/**
 * Fingerprint untuk dedupe message.
 *
 * @param {Record<string, any>} message
 * @returns {string}
 */
export function buildKommoMessageFingerprint(message) {
  const messageId = safeText(message?.message_id ?? message?.id, 120);
  if (messageId) return `id:${messageId}`;

  const entityId = Number(message?.entity_id || 0);
  const entityType = safeText(message?.entity_type, 40).toLowerCase();
  const type = safeText(message?.type, 40).toLowerCase();
  const ts = Number(message?.ts || 0);
  const text = safeText(message?.text, 500).toLowerCase();

  return `fp:${entityType}|${entityId}|${type}|${ts}|${text}`;
}

/**
 * Dedupe dan rapikan kumpulan message hasil parsing.
 *
 * @param {Array<Record<string, any>>} messages
 * @returns {Array<Record<string, any>>}
 */
export function dedupeKommoMessages(messages) {
  /** @type {Map<string, Record<string, any>>} */
  const byFingerprint = new Map();

  for (const raw of Array.isArray(messages) ? messages : []) {
    const normalized = normalizeKommoMessage(raw);

    if (!normalized.text) continue;

    const fingerprint = buildKommoMessageFingerprint(normalized);

    const prev = byFingerprint.get(fingerprint);
    if (!prev) {
      byFingerprint.set(fingerprint, normalized);
      continue;
    }

    const prevTs = Number(prev.ts || 0);
    const nextTs = Number(normalized.ts || 0);

    if (nextTs >= prevTs) {
      byFingerprint.set(fingerprint, normalized);
    }
  }

  return [...byFingerprint.values()]
    .sort((a, b) => {
      const leftTs = Number(a?.ts || 0);
      const rightTs = Number(b?.ts || 0);

      if (leftTs !== rightTs) return leftTs - rightTs;

      const leftId = safeText(a?.message_id ?? a?.id, 120);
      const rightId = safeText(b?.message_id ?? b?.id, 120);
      return leftId.localeCompare(rightId);
    })
    .slice(-MAX_MESSAGES_PER_PAYLOAD);
}

/**
 * Entry utama parser webhook Kommo.
 * Return array message yang sudah dinormalisasi:
 * - text
 * - entity_id
 * - entity_type
 * - type
 * - message_id
 * - ts
 *
 * @param {unknown} rawBody
 * @param {string} contentType
 * @returns {Array<Record<string, any>>}
 */
export function extractKommoMessagesFromRaw(rawBody, contentType = "") {
  const raw = typeof rawBody === "string" ? rawBody : "";
  const safeContentType = safeText(contentType || "", 200).toLowerCase();

  if (safeContentType.includes("application/x-www-form-urlencoded")) {
    return dedupeKommoMessages(parseKommoForm(new URLSearchParams(raw)));
  }

  if (safeContentType.includes("application/json") || looksLikeJsonPayload(raw)) {
    try {
      const json = JSON.parse(raw || "{}");
      return dedupeKommoMessages(extractKommoMessagesFromJson(json));
    } catch (err) {
      console.error("KOMMO_WEBHOOK_JSON_PARSE_ERROR", err?.stack || String(err));
      return [];
    }
  }

  if (raw.includes("message%5Badd%5D") || raw.includes("message[add]")) {
    return dedupeKommoMessages(parseKommoForm(new URLSearchParams(raw)));
  }

  return [];
}