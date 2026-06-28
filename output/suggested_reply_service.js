// output/suggested_reply_service.js

import { kommoAddLeadNote, kommoPatchLeadCustomFields } from "../kommo/kommo_api.js";

import { safeText, safeDisplay } from "../utils/text.js";
import {
  getEnvFieldId,
  logKommoDebug,
  shouldSaveSuggestReplyMem,
  isKvWriteDisabled,
  disableKvWrites,
  logKvQuotaNotice,
} from "../utils/env.js";
import {
  safePercent,
  toStringArray,
  uniqueStrings,
  pushCustomFieldValue,
} from "../utils/collection.js";

import {
  formatNote,
  formatSuggestedReplyAnalysisNote,
  formatSuggestedReplyContentNote,
  shouldPublishAuxiliarySuggestedReplyNotes,
} from "../formatters/note_formatter.js";

const MAX_WEBHOOK_ERROR_PREVIEW = 1000;
const MAX_MEM_SUMMARY = 700;
const MAX_MEM_TAIL = 1200;
const MAX_WEBHOOK_SUMMARY = 1200;
const MAX_WEBHOOK_TAIL = 2400;
const MAX_MEM_CS_ACTION = 900;
const MAX_WEBHOOK_CS_ACTION = 1200;

const MAX_META_DEPTH = 4;
const MAX_META_KEYS = 40;
const MAX_META_ARRAY = 30;

const PIPELINES = new Set(["no_respons", "respons", "prospek"]);
const PROSPECT_TYPES = new Set(["sample", "brand", "post_payment", "at_risk", "none"]);
const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const EXECUTE_MODES = new Set(["send_now", "wait_then_send", "verify_then_send"]);

const DEFAULT_ROUTE_TARGETS = Object.freeze({
  no_respons: "no_respons_followup_composer",
  respons: "respons_qualification_composer",
  prospek: "prospek_closing_composer",
});

const CANONICAL_PLAN_TO_COMPOSER_FAMILY = Object.freeze({
  no_respons_followup: "no_respons_followup",
  respons_qualification: "respons_qualification",
  sample_closing: "sample_closing",
  brand_closing: "brand_closing",
  post_payment_update: "post_payment_update",
  at_risk_recovery: "at_risk_recovery",
  generic_next_step: "generic_next_step",
});

const COMPOSER_FAMILY_TO_TARGET = Object.freeze({
  no_respons_followup: "no_respons_followup_composer",
  respons_qualification: "respons_qualification_composer",
  sample_closing: "prospek_closing_composer",
  brand_closing: "prospek_closing_composer",
  post_payment_update: "post_payment_progress_composer",
  at_risk_recovery: "at_risk_recovery_composer",
  prospek_closing: "prospek_closing_composer",
  generic_next_step: "respons_qualification_composer",
});

/**
 * @typedef {{
 *   noteSent: boolean,
 *   analysisNoteSent: boolean,
 *   contentNoteSent: boolean,
 *   fieldSent: boolean
 * }} SuggestedReplyKommoPublishResult
 */

/**
 * @typedef {{
 *   sentAny: boolean,
 *   memSaved: boolean,
 *   webhookSent: boolean,
 *   kommoNoteSent: boolean,
 *   kommoFieldSent: boolean,
 *   kommoAnalysisNoteSent: boolean,
 *   kommoContentNoteSent: boolean
 * }} SuggestedReplyChannelPublishResult
 */

/**
 * @returns {SuggestedReplyKommoPublishResult}
 */
function createEmptyKommoPublishResult() {
  return {
    noteSent: false,
    analysisNoteSent: false,
    contentNoteSent: false,
    fieldSent: false,
  };
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function getErrorMessage(err) {
  if (err instanceof Error) {
    return err.message || "";
  }

  if (typeof err === "object" && err !== null && "message" in err) {
    return String(/** @type {{ message?: unknown }} */ (err).message || "");
  }

  return String(err || "");
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function getErrorStack(err) {
  if (err instanceof Error) {
    return err.stack || err.message || String(err);
  }

  if (typeof err === "object" && err !== null && "stack" in err) {
    return String(/** @type {{ stack?: unknown }} */ (err).stack || getErrorMessage(err));
  }

  return getErrorMessage(err);
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isKvPutLimitExceededError(err) {
  const msg = getErrorMessage(err).toLowerCase();
  return msg.includes("kv put() limit exceeded for the day");
}

/**
 * @param {Record<string, any>} env
 * @returns {number}
 */
export function getSuggestedReplyMemTtlSeconds(env) {
  const n = Number(env.SUGGEST_REPLY_MEM_TTL_SECONDS || "3600");
  return Number.isFinite(n) && n >= 60 ? Math.min(n, 7 * 24 * 3600) : 3600;
}

/**
 * @param {Record<string, any>} env
 * @returns {string}
 */
export function getSuggestReplyWebhookUrl(env) {
  return safeText(
    env.SUGGEST_REPLY_WEBHOOK_URL ||
      env.SUGGESTED_RESPONSE_WEBHOOK_URL ||
      "",
    2000
  );
}

/**
 * @param {Record<string, any>} env
 * @returns {string}
 */
export function getSuggestReplyWebhookToken(env) {
  return safeText(
    env.SUGGEST_REPLY_WEBHOOK_TOKEN ||
      env.SUGGESTED_RESPONSE_WEBHOOK_TOKEN ||
      "",
    500
  );
}

/**
 * @param {Record<string, any>} env
 * @returns {boolean}
 */
export function shouldSendSuggestedReplyToKommoNote(env) {
  return Boolean(env && String(env.KOMMO_SUGGEST_REPLY_NOTE_ENABLED ?? "true").toLowerCase() !== "false");
}

/* ---------------------------------
   Normalizers
---------------------------------- */

/**
 * @param {unknown} value
 * @param {number} [maxLen]
 * @returns {string}
 */
function normalizeToken(value, maxLen = 120) {
  return safeText(String(value || ""), maxLen)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizePipeline(value) {
  const normalized = normalizeToken(value, 80);
  return PIPELINES.has(normalized) ? normalized : "respons";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeProspectType(value) {
  const normalized = normalizeToken(value, 80);
  return PROSPECT_TYPES.has(normalized) ? normalized : "none";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizePriority(value) {
  const normalized = normalizeToken(value, 80);
  return PRIORITIES.has(normalized) ? normalized : "medium";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeExecuteMode(value) {
  const normalized = normalizeToken(value, 80);
  return EXECUTE_MODES.has(normalized) ? normalized : "send_now";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeBrandChannel(value) {
  const normalized = normalizeToken(value, 80);
  return normalized || "unknown";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizePlanType(value) {
  return normalizeToken(value, 120) || "generic_next_step";
}

/* ---------------------------------
   Meta sanitizers
---------------------------------- */

/**
 * @param {unknown} value
 * @param {number} [maxLen]
 * @returns {string}
 */
function safeShortString(value, maxLen = 220) {
  return safeText(value == null ? "" : String(value), maxLen);
}

/**
 * @param {unknown} value
 * @param {WeakSet<object>} seen
 * @param {number} depth
 * @param {{
 *   maxDepth?: number,
 *   maxKeys?: number,
 *   maxArray?: number,
 *   maxString?: number
 * }} [opts]
 * @returns {any}
 */
function sanitizeJsonValue(value, seen, depth, opts = {}) {
  const maxDepth = Number.isFinite(opts.maxDepth) ? Number(opts.maxDepth) : MAX_META_DEPTH;
  const maxKeys = Number.isFinite(opts.maxKeys) ? Number(opts.maxKeys) : MAX_META_KEYS;
  const maxArray = Number.isFinite(opts.maxArray) ? Number(opts.maxArray) : MAX_META_ARRAY;
  const maxString = Number.isFinite(opts.maxString) ? Number(opts.maxString) : 260;

  if (value == null) return null;

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "string") {
      return safeText(value, maxString);
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    return value;
  }

  if (depth >= maxDepth) {
    if (Array.isArray(value)) {
      return value
        .slice(0, maxArray)
        .map((item) => safeShortString(item, maxString))
        .filter(Boolean);
    }

    if (typeof value === "object") {
      return "[truncated]";
    }

    return safeShortString(value, maxString);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, maxArray)
      .map((item) => sanitizeJsonValue(item, seen, depth + 1, opts))
      .filter((item) => item !== undefined);
  }

  if (typeof value === "object") {
    const obj = /** @type {Record<string, any>} */ (value);

    if (seen.has(obj)) {
      return "[circular]";
    }

    seen.add(obj);

    const out = {};
    const keys = Object.keys(obj).slice(0, maxKeys);

    for (const key of keys) {
      const normalizedKey = safeText(key, 100);
      if (!normalizedKey) continue;

      out[normalizedKey] = sanitizeJsonValue(obj[key], seen, depth + 1, opts);
    }

    return out;
  }

  return safeShortString(value, maxString);
}

/**
 * @param {unknown} value
 * @param {{
 *   maxDepth?: number,
 *   maxKeys?: number,
 *   maxArray?: number,
 *   maxString?: number
 * }} [opts]
 * @returns {Record<string, any>}
 */
function sanitizeJsonObject(value, opts = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const seen = new WeakSet();
  const sanitized = sanitizeJsonValue(value, seen, 0, opts);

  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized
    : {};
}

/**
 * @param {unknown} value
 * @param {number} [maxItems]
 * @param {number} [maxLen]
 * @returns {string[]}
 */
function toCompactStringArray(value, maxItems = 20, maxLen = 120) {
  return uniqueStrings(
    toStringArray(value)
      .map((x) => safeText(String(x || ""), maxLen))
      .filter(Boolean)
  ).slice(0, maxItems);
}

/* ---------------------------------
   Analysis readers
---------------------------------- */

/**
 * @param {Record<string, any>} analysis
 * @returns {string}
 */
function resolveBrandChannelFromAnalysis(analysis) {
  return normalizeBrandChannel(
    analysis?.brand_channel ||
      analysis?.crm_state?.brand_channel ||
      analysis?.runtime_context?.brand_channel ||
      analysis?.pipeline_meta?.brand_channel ||
      analysis?.prospect_meta?.brand_channel ||
      analysis?.stage_meta?.brand_channel ||
      "unknown"
  );
}

/**
 * @param {Record<string, any>} analysis
 * @returns {boolean}
 */
function resolveAtRiskFlagFromAnalysis(analysis) {
  return Boolean(
    normalizeProspectType(analysis?.prospect_type) === "at_risk" ||
      analysis?.status_flags?.is_at_risk === true
  );
}

/**
 * @param {Record<string, any>} analysis
 * @returns {string}
 */
function resolveRouteTargetFromAnalysis(analysis) {
  const canonicalRoute = safeText(analysis?.route_target || "", 120);
  if (canonicalRoute) return canonicalRoute;

  const pipeline = normalizePipeline(analysis?.pipeline);
  return DEFAULT_ROUTE_TARGETS[pipeline] || DEFAULT_ROUTE_TARGETS.respons;
}

/* ---------------------------------
   Composer selection
---------------------------------- */

/**
 * @param {Record<string, any>} analysis
 * @returns {Record<string, any>}
 */
export function resolveComposerSelection(analysis) {
  const pipeline = normalizePipeline(analysis?.pipeline);
  const prospectType = normalizeProspectType(analysis?.prospect_type);
  const priority = normalizePriority(analysis?.priority_level || analysis?.priority);
  const brandChannel = resolveBrandChannelFromAnalysis(analysis);
  const executeMode = normalizeExecuteMode(analysis?.execute_mode_final);
  const planType = normalizePlanType(analysis?.plan_type_final);
  const isAtRisk = resolveAtRiskFlagFromAnalysis(analysis);

  let composerFamily =
    CANONICAL_PLAN_TO_COMPOSER_FAMILY[planType] ||
    "generic_next_step";
  let composerReason = "canonical_plan_type";

  if (!CANONICAL_PLAN_TO_COMPOSER_FAMILY[planType]) {
    if (pipeline === "no_respons") {
      composerFamily = "no_respons_followup";
      composerReason = "pipeline_no_respons_fallback";
    } else if (isAtRisk || prospectType === "at_risk") {
      composerFamily = "at_risk_recovery";
      composerReason = "at_risk_fallback";
    } else if (prospectType === "post_payment") {
      composerFamily = "post_payment_update";
      composerReason = "post_payment_fallback";
    } else if (prospectType === "brand") {
      composerFamily = "brand_closing";
      composerReason = "brand_fallback";
    } else if (prospectType === "sample") {
      composerFamily = "sample_closing";
      composerReason = "sample_fallback";
    } else if (pipeline === "prospek") {
      composerFamily = "prospek_closing";
      composerReason = "prospek_pipeline_fallback";
    } else {
      composerFamily = "respons_qualification";
      composerReason = "respons_pipeline_fallback";
    }
  }

  const baseRouteTarget =
    COMPOSER_FAMILY_TO_TARGET[composerFamily] ||
    resolveRouteTargetFromAnalysis(analysis);

  const routeTarget =
    safeText(analysis?.route_target || baseRouteTarget, 120) || baseRouteTarget;

  const variantParts = [composerFamily];

  if (prospectType !== "none" && prospectType !== "at_risk") {
    variantParts.push(prospectType);
  }

  if (brandChannel !== "unknown") {
    variantParts.push(brandChannel);
  }

  if (priority === "high" || priority === "urgent") {
    variantParts.push(priority);
  }

  if (isAtRisk) {
    variantParts.push("trust_sensitive");
  }

  const composerKey = uniqueStrings(variantParts).join("_");

  return {
    route_target: safeText(routeTarget, 120),
    composer_family: safeText(composerFamily, 120),
    composer_key: safeText(composerKey, 160),
    composer_reason: safeText(composerReason, 160),
    pipeline,
    prospect_type: prospectType,
    brand_channel: brandChannel,
    priority,
    at_risk: isAtRisk,
    execute_mode: executeMode,
    plan_type: safeText(planType, 120),
    next_action_code: safeText(
      analysis?.followup_plan?.next_action_code || "",
      120
    ),
  };
}

/* ---------------------------------
   Compact payload builders
---------------------------------- */

/**
 * Payload ringkas untuk penyimpanan MEM.
 *
 * @param {Record<string, any>} payload
 * @returns {Record<string, any>}
 */
export function buildSuggestedReplyMemPayload(payload) {
  const src = payload && typeof payload === "object" ? payload : {};

  return {
    type: safeText(src.type || "ai_suggested_reply", 80),
    generated_at: safeText(src.generated_at || "", 80),
    conv_key: safeText(src.conv_key || "", 120),
    lead_id: Number(src.lead_id || 0),
    event_id: safeText(src.event_id || "", 80),

    rule_id: safeText(src.rule_id || "", 80),
    dataset_row_id: safeText(src.dataset_row_id || "", 80),
    dataset_row_label: safeText(src.dataset_row_label || "", 160),
    rule_source: safeText(src.rule_source || "", 80),
    engine_dataset: safeText(src.engine_dataset || "unknown", 80),

    intent: safeText(src.intent || "unknown", 80),
    emotion: safeText(src.emotion || "unknown", 80),
    behaviour_stage: safeText(src.behaviour_stage || "curiosity", 80),
    lead_level_stage: safeText(src.lead_level_stage || "cold", 80),

    pipeline: safeText(src.pipeline || "respons", 80),
    priority: safeText(src.priority || "medium", 80),
    prospect_type: safeText(src.prospect_type || "none", 80),
    brand_channel: safeText(src.brand_channel || "unknown", 80),

    sop_stage_current: safeText(src.sop_stage_current || "", 80),
    sop_stage_next: safeText(src.sop_stage_next || "", 80),

    conversion_rate_analyzed: safePercent(src.conversion_rate_analyzed, 20),
    confidence_score: safePercent(src.confidence_score, 20),

    followup_gap: safeText(src.followup_gap || "", 320),
    uncertainty_note: safeText(src.uncertainty_note || "", 320),

    route_target: safeText(src.route_target || "", 160),
    required_artifacts_final: toCompactStringArray(src.required_artifacts_final, 12, 160),
    next_required_artifact: safeText(src.next_required_artifact || "", 160),
    execute_mode_final: safeText(src.execute_mode_final || "", 80),
    plan_type_final: safeText(src.plan_type_final || "", 120),
    note_publish_strategy: safeText(src.note_publish_strategy || "", 80),

    cs_action: safeText(src.cs_action || "", MAX_MEM_CS_ACTION),
    suggested_response: safeText(src.suggested_response || "", 260),

    latest_customer_text: safeText(src.latest_customer_text || "", 500),
    summary: safeText(src.summary || "-", MAX_MEM_SUMMARY),
    tail: safeText(src.tail || "-", MAX_MEM_TAIL),

    composer_selection: sanitizeJsonObject(src.composer_selection, {
      maxDepth: 3,
      maxKeys: 20,
      maxArray: 12,
      maxString: 120,
    }),
    followup_plan: sanitizeJsonObject(src.followup_plan, {
      maxDepth: 3,
      maxKeys: 25,
      maxArray: 12,
      maxString: 160,
    }),

    matched_patterns: toCompactStringArray(src.matched_patterns, 12, 120),
    matched_in:
      src.matched_in && typeof src.matched_in === "object"
        ? {
            latest: toCompactStringArray(src.matched_in.latest, 12, 120),
            tail: toCompactStringArray(src.matched_in.tail, 12, 120),
            summary: toCompactStringArray(src.matched_in.summary, 12, 120),
          }
        : {
            latest: [],
            tail: [],
            summary: [],
          },
    sources_used: Array.isArray(src.sources_used)
      ? uniqueStrings(src.sources_used.map((x) => safeText(String(x || ""), 80))).slice(0, 8)
      : [],
  };
}

/**
 * Payload ringkas untuk webhook.
 *
 * @param {Record<string, any>} payload
 * @returns {Record<string, any>}
 */
export function buildSuggestedReplyWebhookPayload(payload) {
  const src = payload && typeof payload === "object" ? payload : {};

  return {
    type: safeText(src.type || "ai_suggested_reply", 80),
    generated_at: safeText(src.generated_at || "", 80),
    conv_key: safeText(src.conv_key || "", 120),
    lead_id: Number(src.lead_id || 0),
    event_id: safeText(src.event_id || "", 80),

    rule_id: safeText(src.rule_id || "", 80),
    dataset_row_id: safeText(src.dataset_row_id || "", 80),
    dataset_row_label: safeText(src.dataset_row_label || "", 180),
    rule_source: safeText(src.rule_source || "", 80),
    engine_dataset: safeText(src.engine_dataset || "unknown", 80),

    intent: safeText(src.intent || "unknown", 80),
    emotion: safeText(src.emotion || "unknown", 80),
    behaviour_stage: safeText(src.behaviour_stage || "curiosity", 80),
    lead_level_stage: safeText(src.lead_level_stage || "cold", 80),

    pipeline: safeText(src.pipeline || "respons", 80),
    priority: safeText(src.priority || "medium", 80),
    prospect_type: safeText(src.prospect_type || "none", 80),
    brand_channel: safeText(src.brand_channel || "unknown", 80),
    should_upgrade_to_prospek: Boolean(src.should_upgrade_to_prospek),

    sop_stage_current: safeText(src.sop_stage_current || "", 80),
    sop_stage_next: safeText(src.sop_stage_next || "", 80),

    conversion_rate_analyzed: safePercent(src.conversion_rate_analyzed, 20),
    confidence_score: safePercent(src.confidence_score, 20),

    followup_gap: safeText(src.followup_gap || "", 600),
    uncertainty_note: safeText(src.uncertainty_note || "", 600),

    route_target: safeText(src.route_target || "", 160),
    required_artifacts_final: toCompactStringArray(src.required_artifacts_final, 20, 160),
    next_required_artifact: safeText(src.next_required_artifact || "", 160),
    execute_mode_final: safeText(src.execute_mode_final || "", 80),
    plan_type_final: safeText(src.plan_type_final || "", 120),
    note_publish_strategy: safeText(src.note_publish_strategy || "", 80),

    cs_action: safeText(src.cs_action || "", MAX_WEBHOOK_CS_ACTION),
    suggested_response: safeText(src.suggested_response || "", 320),

    latest_customer_text: safeText(src.latest_customer_text || "", 700),
    summary: safeText(src.summary || "-", MAX_WEBHOOK_SUMMARY),
    tail: safeText(src.tail || "-", MAX_WEBHOOK_TAIL),

    composer_selection: sanitizeJsonObject(src.composer_selection, {
      maxDepth: 4,
      maxKeys: 30,
      maxArray: 20,
      maxString: 220,
    }),
    followup_plan: sanitizeJsonObject(src.followup_plan, {
      maxDepth: 4,
      maxKeys: 35,
      maxArray: 20,
      maxString: 260,
    }),

    matched_patterns: toCompactStringArray(src.matched_patterns, 20, 120),
    matched_in:
      src.matched_in && typeof src.matched_in === "object"
        ? {
            latest: toCompactStringArray(src.matched_in.latest, 20, 120),
            tail: toCompactStringArray(src.matched_in.tail, 20, 120),
            summary: toCompactStringArray(src.matched_in.summary, 20, 120),
          }
        : {
            latest: [],
            tail: [],
            summary: [],
          },
    sources_used: Array.isArray(src.sources_used)
      ? uniqueStrings(src.sources_used.map((x) => safeText(String(x || ""), 80))).slice(0, 10)
      : [],
  };
}

/* ---------------------------------
   MEM
---------------------------------- */

/**
 * Simpan suggestlatest ke MEM sebagai best-effort.
 *
 * @param {Record<string, any>} env
 * @param {Record<string, any>} payload
 * @returns {Promise<boolean>}
 */
export async function saveSuggestedReplyToMemBestEffort(env, payload) {
  if (!env?.MEM) return false;
  if (!shouldSaveSuggestReplyMem(env)) return false;
  if (!payload?.conv_key) return false;

  if (isKvWriteDisabled(env)) {
    logKommoDebug(env, "SUGGEST_REPLY_MEM_SKIPPED", {
      conv_key: safeText(payload?.conv_key || "", 120),
      reason: "kv_write_disabled",
    });
    return false;
  }

  try {
    const compactPayload = buildSuggestedReplyMemPayload(payload);

    await env.MEM.put(
      `suggestlatest:${compactPayload.conv_key}`,
      JSON.stringify(compactPayload),
      { expirationTtl: getSuggestedReplyMemTtlSeconds(env) }
    );

    return true;
  } catch (err) {
    if (isKvPutLimitExceededError(err)) {
      disableKvWrites(env);
      logKvQuotaNotice(env, "KV_WRITE_QUOTA_REACHED", {
        scope: "suggested_reply_service.saveSuggestedReplyToMemBestEffort",
        conv_key: safeText(payload?.conv_key || "", 120),
      });
      return false;
    }

    console.error("Suggested reply MEM store error:", getErrorStack(err));
    return false;
  }
}

/* ---------------------------------
   Webhook
---------------------------------- */

/**
 * @param {Record<string, any>} env
 * @param {Record<string, any>} payload
 * @returns {Promise<boolean>}
 */
export async function sendSuggestedReplyWebhook(env, payload) {
  const webhookUrl = getSuggestReplyWebhookUrl(env);
  if (!webhookUrl) return false;

  try {
    const token = getSuggestReplyWebhookToken(env);
    const webhookPayload = buildSuggestedReplyWebhookPayload(payload);
    const body = JSON.stringify(webhookPayload);

    /** @type {Record<string, string>} */
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers["X-Webhook-Token"] = token;
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body,
    });

    if (!res.ok) {
      const errText = safeText(await res.text().catch(() => ""), MAX_WEBHOOK_ERROR_PREVIEW);
      console.error("Suggested reply webhook failed:", res.status, errText);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Suggested reply webhook error:", getErrorStack(err));
    return false;
  }
}

/* ---------------------------------
   Payload builder
---------------------------------- */

/**
 * @param {{
 *   convKey: string,
 *   entityId: number | string,
 *   eventId: string,
 *   analysis: Record<string, any>,
 *   latestCustomerText: string,
 *   summary?: string,
 *   tail?: string
 * }} params
 * @returns {Record<string, any>}
 */
export function buildSuggestedReplyPayload({
  convKey,
  entityId,
  eventId,
  analysis,
  latestCustomerText,
  summary = "-",
  tail = "-",
}) {
  const result = analysis && typeof analysis === "object" ? analysis : {};

  const pipeline = normalizePipeline(result.pipeline);
  const priority = normalizePriority(result.priority_level || result.priority);
  const prospectType = normalizeProspectType(result.prospect_type);
  const brandChannel = resolveBrandChannelFromAnalysis(result);

  const followupPlan = sanitizeJsonObject(result.followup_plan, {
    maxDepth: 4,
    maxKeys: 35,
    maxArray: 25,
    maxString: 260,
  });

  const composerSelection = resolveComposerSelection({
    ...result,
    pipeline,
    priority,
    prospect_type: prospectType,
    brand_channel: brandChannel,
  });

  const routeTarget = safeText(
    result.route_target || composerSelection.route_target || "",
    160
  );

  const requiredArtifactsFinal = toCompactStringArray(
    result.required_artifacts_final,
    20,
    160
  );

  const nextRequiredArtifact = safeText(
    result.next_required_artifact || "",
    160
  );

  const executeModeFinal = safeText(
    result.execute_mode_final || "",
    80
  );

  const planTypeFinal = safeText(
    result.plan_type_final || "",
    120
  );

  const notePublishStrategy = safeText(
    result.note_publish_strategy || "single_canonical_note",
    80
  );

  const suggestedResponse = safeText(
    result.suggested_response || "",
    320
  );

  return {
    type: "ai_suggested_reply",
    generated_at: new Date().toISOString(),
    conv_key: safeText(convKey || "", 120),
    lead_id: Number(entityId || 0),
    event_id: safeText(eventId || "", 80),

    rule_id: safeText(result.rule_id || "", 80),
    dataset_row_id: safeText(result.dataset_row_id || "", 80),
    dataset_row_label: safeText(result.dataset_row_label || "", 180),
    rule_source: safeText(result.rule_source || "", 80),
    engine_dataset: safeText(result.engine_dataset || "unknown", 80),

    intent: safeText(result.intent || "unknown", 80),
    emotion: safeText(result.emotion || "unknown", 80),
    behaviour_stage: safeText(result.behaviour_stage || "curiosity", 80),
    lead_level_stage: safeText(
      result.lead_level_stage || result.lead_level || "cold",
      80
    ),

    pipeline,
    priority,
    priority_level: priority,
    prospect_type: prospectType,
    should_upgrade_to_prospek: Boolean(result.should_upgrade_to_prospek),

    brand_channel: brandChannel,

    sop_stage_current: safeText(result.sop_stage_current || "", 80),
    sop_stage_next: safeText(result.sop_stage_next || "", 80),

    customer_profile: safeText(result.customer_profile || "", 220),
    tag_emotion: safeText(result.tag_emotion || "", 120),
    tag_stage: safeText(result.tag_stage || "", 120),

    conversion_rate_analyzed: safePercent(result.conversion_rate_analyzed, 20),
    confidence_score: safePercent(result.confidence_score, 20),

    followup_gap: safeText(result.followup_gap || "", 1200),
    uncertainty_note: safeText(result.uncertainty_note || "", 1200),

    route_target: routeTarget,
    required_artifacts_final: requiredArtifactsFinal,
    next_required_artifact: nextRequiredArtifact,
    execute_mode_final: executeModeFinal,
    plan_type_final: planTypeFinal,
    note_publish_strategy: notePublishStrategy,

    cs_action: safeText(result.cs_action || "", 1200),
    suggested_reply: suggestedResponse,
    suggested_response: suggestedResponse,

    latest_customer_text: safeText(latestCustomerText || "", 700),
    summary: safeText(summary || "-", 1200),
    tail: safeText(tail || "-", 2400),

    composer_selection: composerSelection,
    followup_plan: followupPlan,

    matched_patterns: toCompactStringArray(result.matched_patterns, 20, 120),
    matched_in:
      result.matched_in && typeof result.matched_in === "object"
        ? {
            latest: toCompactStringArray(result.matched_in.latest, 20, 120),
            tail: toCompactStringArray(result.matched_in.tail, 20, 120),
            summary: toCompactStringArray(result.matched_in.summary, 20, 120),
          }
        : {
            latest: [],
            tail: [],
            summary: [],
          },
    sources_used: Array.isArray(result.sources_used)
      ? uniqueStrings(result.sources_used.map((x) => safeText(String(x || ""), 80))).slice(0, 10)
      : [],
  };
}

/* ---------------------------------
   Publish all channels
---------------------------------- */

/**
 * @param {Record<string, any>} env
 * @param {Record<string, any>} payload
 * @returns {Promise<SuggestedReplyChannelPublishResult>}
 */
export async function publishSuggestedReplyChannels(env, payload) {
  let memSaved = false;
  let webhookSent = false;
  let kommoNoteSent = false;
  let kommoFieldSent = false;
  let kommoAnalysisNoteSent = false;
  let kommoContentNoteSent = false;

  memSaved = await saveSuggestedReplyToMemBestEffort(env, payload);

  const webhookPromise = sendSuggestedReplyWebhook(env, payload);
  const kommoPromise = publishSuggestedReplyToKommo(env, payload);

  try {
    webhookSent = Boolean(await webhookPromise);
  } catch (err) {
    console.error("Suggested reply webhook pipeline error:", getErrorStack(err));
  }

  try {
    const kommoBridge = await kommoPromise;
    kommoNoteSent = Boolean(kommoBridge.noteSent);
    kommoFieldSent = Boolean(kommoBridge.fieldSent);
    kommoAnalysisNoteSent = Boolean(kommoBridge.analysisNoteSent);
    kommoContentNoteSent = Boolean(kommoBridge.contentNoteSent);
  } catch (err) {
    console.error("Suggested reply Kommo pipeline error:", getErrorStack(err));
  }

  return {
    sentAny:
      memSaved ||
      webhookSent ||
      kommoNoteSent ||
      kommoFieldSent ||
      kommoAnalysisNoteSent ||
      kommoContentNoteSent,
    memSaved,
    webhookSent,
    kommoNoteSent,
    kommoFieldSent,
    kommoAnalysisNoteSent,
    kommoContentNoteSent,
  };
}

/* ---------------------------------
   Kommo publish helpers
---------------------------------- */

/**
 * @param {Record<string, any>} env
 * @param {number} leadId
 * @param {string} noteText
 * @param {string} logKey
 * @param {Record<string, any>} meta
 * @returns {Promise<boolean>}
 */
async function sendKommoNoteBestEffort(env, leadId, noteText, logKey, meta = {}) {
  const safeNote = safeText(noteText || "", 5000);
  if (!safeNote) return false;

  try {
    return Boolean(await kommoAddLeadNote(env, leadId, safeNote));
  } catch (err) {
    logKommoDebug(env, logKey, {
      ...meta,
      lead_id: leadId,
      error_message: safeText(err?.message || String(err), 300),
    });
    return false;
  }
}

/**
 * @param {Record<string, any>} payload
 * @returns {Record<string, any>}
 */
function buildAuxFallbackPayload(payload) {
  return {
    ...(payload && typeof payload === "object" ? payload : {}),
    note_publish_strategy: "multi_note_legacy",
  };
}

/* ---------------------------------
   Kommo publish
---------------------------------- */

/**
 * @param {Record<string, any>} env
 * @param {Record<string, any>} payload
 * @returns {Promise<SuggestedReplyKommoPublishResult>}
 */
export async function publishSuggestedReplyToKommo(env, payload) {
  /** @type {SuggestedReplyKommoPublishResult} */
  const out = createEmptyKommoPublishResult();

  if (!payload?.lead_id) {
    return out;
  }

  const leadId = Number(payload.lead_id || 0);
  if (!leadId) {
    return out;
  }

  if (shouldSendSuggestedReplyToKommoNote(env)) {
    const shouldPublishAuxNotes = shouldPublishAuxiliarySuggestedReplyNotes(payload);

    logKommoDebug(env, "SUGGEST_REPLY_NOTE_MODE", {
      lead_id: leadId,
      conv_key: safeText(payload?.conv_key || "", 120),
      note_publish_strategy: safeText(payload?.note_publish_strategy || "", 80),
      should_publish_aux_notes: shouldPublishAuxNotes,
    });

    if (!shouldPublishAuxNotes) {
      const canonicalNoteText = formatNote(payload);

      logKommoDebug(env, "SUGGEST_REPLY_CANONICAL_NOTE_PREPARED", {
        lead_id: leadId,
        conv_key: safeText(payload?.conv_key || "", 120),
        note_publish_strategy: safeText(payload?.note_publish_strategy || "", 80),
        canonical_note_len: safeText(canonicalNoteText || "", 6000).length,
      });

      out.noteSent = await sendKommoNoteBestEffort(
        env,
        leadId,
        canonicalNoteText,
        "SUGGEST_REPLY_CANONICAL_NOTE_ERROR",
        {
          conv_key: safeText(payload?.conv_key || "", 120),
          note_publish_strategy: safeText(payload?.note_publish_strategy || "", 80),
        }
      );

      if (!out.noteSent) {
        const fallbackPayload = buildAuxFallbackPayload(payload);

        const fallbackContentNoteText = formatSuggestedReplyContentNote(fallbackPayload);
        out.contentNoteSent = await sendKommoNoteBestEffort(
          env,
          leadId,
          fallbackContentNoteText,
          "SUGGEST_REPLY_FALLBACK_CONTENT_NOTE_ERROR",
          {
            conv_key: safeText(payload?.conv_key || "", 120),
            note_publish_strategy: safeText(payload?.note_publish_strategy || "", 80),
          }
        );

        if (!out.contentNoteSent) {
          const fallbackAnalysisNoteText = formatSuggestedReplyAnalysisNote(fallbackPayload);
          out.analysisNoteSent = await sendKommoNoteBestEffort(
            env,
            leadId,
            fallbackAnalysisNoteText,
            "SUGGEST_REPLY_FALLBACK_ANALYSIS_NOTE_ERROR",
            {
              conv_key: safeText(payload?.conv_key || "", 120),
              note_publish_strategy: safeText(payload?.note_publish_strategy || "", 80),
            }
          );
        }

        out.noteSent = out.noteSent || out.contentNoteSent || out.analysisNoteSent;

        logKommoDebug(env, "SUGGEST_REPLY_CANONICAL_NOTE_FALLBACK_RESULT", {
          lead_id: leadId,
          conv_key: safeText(payload?.conv_key || "", 120),
          canonical_note_sent: Boolean(out.noteSent && !out.contentNoteSent && !out.analysisNoteSent),
          fallback_content_note_sent: Boolean(out.contentNoteSent),
          fallback_analysis_note_sent: Boolean(out.analysisNoteSent),
        });
      }

      logKommoDebug(env, "SUGGEST_REPLY_AUX_NOTES_SKIPPED", {
        lead_id: leadId,
        conv_key: safeText(payload?.conv_key || "", 120),
        note_publish_strategy: safeText(payload?.note_publish_strategy || "", 80),
      });
    } else {
      const analysisNoteText = formatSuggestedReplyAnalysisNote(payload);
      const contentNoteText = formatSuggestedReplyContentNote(payload);

      const [analysisNoteResult, contentNoteResult] = await Promise.allSettled([
        analysisNoteText
          ? sendKommoNoteBestEffort(
              env,
              leadId,
              analysisNoteText,
              "SUGGEST_REPLY_ANALYSIS_NOTE_ERROR",
              { conv_key: safeText(payload?.conv_key || "", 120) }
            )
          : Promise.resolve(false),
        contentNoteText
          ? sendKommoNoteBestEffort(
              env,
              leadId,
              contentNoteText,
              "SUGGEST_REPLY_CONTENT_NOTE_ERROR",
              { conv_key: safeText(payload?.conv_key || "", 120) }
            )
          : Promise.resolve(false),
      ]);

      if (analysisNoteResult?.status === "fulfilled") {
        out.analysisNoteSent = Boolean(analysisNoteResult.value);
      } else if (analysisNoteResult) {
        console.error("Suggested reply analysis note error:", getErrorStack(analysisNoteResult.reason));
      }

      if (contentNoteResult?.status === "fulfilled") {
        out.contentNoteSent = Boolean(contentNoteResult.value);
      } else if (contentNoteResult) {
        console.error("Suggested reply content note error:", getErrorStack(contentNoteResult.reason));
      }

      out.noteSent = out.analysisNoteSent || out.contentNoteSent;

      if (!out.noteSent) {
        const canonicalNoteText = formatNote(payload);
        out.noteSent = await sendKommoNoteBestEffort(
          env,
          leadId,
          canonicalNoteText,
          "SUGGEST_REPLY_AUX_TO_CANONICAL_FALLBACK_ERROR",
          {
            conv_key: safeText(payload?.conv_key || "", 120),
            note_publish_strategy: safeText(payload?.note_publish_strategy || "", 80),
          }
        );
      }
    }
  }

  const fieldValues = buildKommoSuggestedReplyCustomFields(env, payload);
  if (fieldValues.length > 0) {
    try {
      out.fieldSent = await kommoPatchLeadCustomFields(env, leadId, fieldValues);
    } catch (err) {
      console.error("Suggested reply custom fields error:", getErrorStack(err));
    }
  }

  return out;
}

/* ---------------------------------
   Kommo custom fields
---------------------------------- */

/**
 * @param {Record<string, any>} env
 * @param {Record<string, any>} payload
 * @returns {Array<{ field_id: number, values: Array<{ value: string | number }> }>}
 */
export function buildKommoSuggestedReplyCustomFields(env, payload) {
  const fields = [];
  const composerSelection =
    payload?.composer_selection && typeof payload.composer_selection === "object"
      ? payload.composer_selection
      : {};

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_SUGGESTED_REPLY_FIELD_ID"]),
    safeText(payload?.suggested_response || "", 1000)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_ANALYSIS_FIELD_ID"]),
    buildSuggestedReplyAnalysisFieldText(payload)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_INTENT_FIELD_ID"]),
    safeText(payload?.intent || "", 120)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_EMOTION_FIELD_ID"]),
    safeText(payload?.emotion || "", 120)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_BEHAVIOUR_STAGE_FIELD_ID"]),
    safeText(payload?.behaviour_stage || "", 120)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_LEAD_LEVEL_STAGE_FIELD_ID"]),
    safeText(payload?.lead_level_stage || "", 120)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_CS_ACTION_FIELD_ID"]),
    safeText(payload?.cs_action || "", 1000)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_RULE_ID_FIELD_ID"]),
    safeText(payload?.rule_id || "", 120)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_CONVERSION_RATE_FIELD_ID"]),
    Number.isFinite(Number(payload?.conversion_rate_analyzed))
      ? Math.max(0, Math.min(100, Math.round(Number(payload.conversion_rate_analyzed))))
      : ""
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_PIPELINE_FIELD_ID"]),
    safeText(payload?.pipeline || "", 120)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_PRIORITY_FIELD_ID"]),
    safeText(payload?.priority || "", 120)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_PROSPECT_TYPE_FIELD_ID"]),
    safeText(payload?.prospect_type || "", 120)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_BRAND_CHANNEL_FIELD_ID"]),
    safeText(payload?.brand_channel || "", 120)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_SOP_STAGE_CURRENT_FIELD_ID"]),
    safeText(payload?.sop_stage_current || "", 120)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_SOP_STAGE_NEXT_FIELD_ID"]),
    safeText(payload?.sop_stage_next || "", 120)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_FOLLOWUP_GAP_FIELD_ID"]),
    safeText(payload?.followup_gap || "", 1000)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_COMPOSER_KEY_FIELD_ID"]),
    safeText(composerSelection?.composer_key || "", 160)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_ROUTE_TARGET_FIELD_ID"]),
    safeText(payload?.route_target || composerSelection?.route_target || "", 160)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_PLAN_EXECUTE_MODE_FIELD_ID"]),
    safeText(payload?.execute_mode_final || "", 120)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_NEXT_ACTION_CODE_FIELD_ID"]),
    safeText(payload?.followup_plan?.next_action_code || "", 160)
  );

  pushCustomFieldValue(
    fields,
    getEnvFieldId(env, ["KOMMO_AI_NEXT_REQUIRED_ARTIFACT_FIELD_ID"]),
    safeText(payload?.next_required_artifact || "", 160)
  );

  return fields;
}

/* ---------------------------------
   Analysis field summary
---------------------------------- */

/**
 * @param {Record<string, any>} payload
 * @returns {string}
 */
export function buildSuggestedReplyAnalysisFieldText(payload) {
  const composerSelection =
    payload?.composer_selection && typeof payload.composer_selection === "object"
      ? payload.composer_selection
      : {};

  const intent = safeDisplay(payload?.intent, "unknown").toUpperCase();
  const emotion = safeDisplay(payload?.emotion, "unknown").toUpperCase();
  const behaviourStage = safeDisplay(payload?.behaviour_stage, "curiosity").toUpperCase();
  const leadLevelStage = safeDisplay(payload?.lead_level_stage, "cold").toUpperCase();
  const pipeline = safeDisplay(payload?.pipeline, "respons").toUpperCase();
  const prospectType = safeDisplay(payload?.prospect_type, "none").toUpperCase();
  const priority = safeDisplay(payload?.priority, "medium").toUpperCase();
  const sopStageCurrent = safeDisplay(payload?.sop_stage_current, "-");
  const sopStageNext = safeDisplay(payload?.sop_stage_next, "-");
  const conversionRate = safePercent(payload?.conversion_rate_analyzed, 20);
  const confidenceScore = safePercent(payload?.confidence_score, 20);

  const routeTarget = safeDisplay(payload?.route_target, "-");
  const nextArtifact = safeDisplay(payload?.next_required_artifact, "-");
  const planType = safeDisplay(payload?.plan_type_final, "-");
  const executeMode = safeDisplay(payload?.execute_mode_final, "-");
  const notePublishStrategy = safeDisplay(payload?.note_publish_strategy, "-");
  const composerKey = safeDisplay(composerSelection?.composer_key, "-");

  return safeText(
    [
      `Intent: ${intent}`,
      `Emotion: ${emotion}`,
      `Behaviour: ${behaviourStage}`,
      `Lead: ${leadLevelStage}`,
      `Pipeline: ${pipeline}`,
      `Prospect: ${prospectType}`,
      `Priority: ${priority}`,
      `SOP: ${sopStageCurrent} -> ${sopStageNext}`,
      `Route: ${routeTarget}`,
      `Artifact: ${nextArtifact}`,
      `Plan: ${planType}`,
      `Execute: ${executeMode}`,
      `NoteStrategy: ${notePublishStrategy}`,
      `Composer: ${composerKey}`,
      `CVR: ${conversionRate}%`,
      `Conf: ${confidenceScore}%`,
    ].join(" | "),
    1900
  );
}