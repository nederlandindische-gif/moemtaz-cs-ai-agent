// worker.js
import { primaryGenerate } from "./generate_ai_backup/primary_generate/primary_generate.js";
import {
  fallbackTwoGenerate,
  defaultSuggestions,
} from "./generate_ai_backup/fallback_two/fallback_two.js";
import { fallbackOneGenerate } from "./generate_ai_backup/fallback_one/fallback_one.js";

import {
  DEFAULT_ANALYSIS,
  normalizeAnalysisTaxonomy,
  normalizePipeline,
  normalizeLeadLevelStage,
  normalizePriorityLevel,
  normalizeProspectType,
  normalizeIntent,
  normalizeEmotion,
  normalizeBehaviourStage,
  normalizeSopStage,
  normalizeBrandChannel,
} from "./dataset_engine/rules.js";
import { detectDatasetPattern } from "./dataset_engine/pattern_detection.js";
import { calculateLeadScore } from "./dataset_engine/lead_scoring.js";
import { mergeAnalysisLayers } from "./dataset_engine/merge_analysis.js";
import { buildFollowupPlannerBundle } from "./dataset_engine/followup_planner.js";

import {
  extractKommoMessagesFromRaw as parseKommoWebhookPayload,
} from "./kommo/parser/kommo_parser.js";
import {
  kommoAddLeadNote,
} from "./kommo/kommo_api.js";

import {
  safeText,
  safeKvPart,
} from "./utils/text.js";
import {
  getBooleanEnv,
  logKommoDebug,
} from "./utils/env.js";
import {
  randomNonce,
  sha1,
} from "./utils/crypto.js";
import {
  safePercent,
  analysisPercent,
  firstNonEmpty,
  toStringArray,
  uniqueStrings,
  mergeMatchedIn,
} from "./utils/collection.js";
import {
  extractOutputAnyText,
  tryParseJsonLoose,
} from "./utils/ai_output.js";
import {
  normalizeLocalEmotionToAnalysis,
} from "./utils/emotion.js";

import { formatNote } from "./formatters/note_formatter.js";

import {
  dispatchAnalysisOutputs,
  dispatchFallbackAnalysisOutputs,
} from "./output/analysis_dispatcher.js";
import {
  buildSuggestedReplyPayload,
  publishSuggestedReplyChannels,
} from "./output/suggested_reply_service.js";

const PROCESS_MODES = Object.freeze({
  incoming_customer_response: "incoming_customer_response",
  scheduled_no_response_followup: "scheduled_no_response_followup",
  post_payment_progress_check: "post_payment_progress_check",
});

const ROUTE_TARGETS = Object.freeze({
  no_respons: "no_respons_followup_composer",
  respons: "respons_qualification_composer",
  prospek: "prospek_closing_composer",
});

/**
 * @typedef {{
 *   rule_id: string,
 *   dataset_row_id?: string,
 *   dataset_row_label?: string,
 *   pipeline: string,
 *   lead_level: string,
 *   lead_level_stage: string,
 *   priority: string,
 *   priority_level: string,
 *   prospect_type: string,
 *   should_upgrade_to_prospek: boolean,
 *   intent: string,
 *   emotion: string,
 *   behaviour_stage: string,
 *   customer_profile: string,
 *   sop_stage_current: string,
 *   sop_stage_next: string,
 *   followup_gap: string,
 *   cs_action: string,
 *   suggested_reply: string,
 *   suggested_response: string,
 *   confidence_score: number,
 *   conversion_rate_analyzed: number,
 *   matched_patterns: string[],
 *   matched_in: { latest: string[], tail: string[], summary: string[] },
 *   matched_context_cues?: string[],
 *   signal_alignment_details?: string[],
 *   rule_source: string,
 *   sources_used: string[],
 *   merge_meta: Record<string, any>,
 *   stage_meta?: Record<string, any>,
 *   pipeline_meta?: Record<string, any>,
 *   prospect_meta?: Record<string, any>,
 *   followup_meta?: Record<string, any>,
 *   followup_plan?: Record<string, any>,
 *   planner_meta?: Record<string, any>,
 *   status_flags?: Record<string, any>,
 *   bubble_metrics?: Record<string, any>,
 *   sop_signals?: Record<string, any>,
 *   engine_dataset?: string,
 *   process_mode?: string,
 *   analysis_mode?: string,
 *   uncertainty_note?: string,
 *   route_target?: string,
 *   runtime_context?: Record<string, any>,
 *   signal_summary?: Record<string, any>,
 *   scoring_breakdown?: Array<Record<string, any>>,
 *   scoring_meta?: Record<string, any>
 * }} FinalAnalysis
 */

/* -----------------------------
   Worker entry
------------------------------ */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/kommo/incoming-message" && request.method === "POST") {
      if (env.WEBHOOK_TOKEN && url.searchParams.get("token") !== env.WEBHOOK_TOKEN) {
        return new Response("Unauthorized", { status: 401 });
      }

      const contentType = request.headers.get("content-type") || "";
      let rawBody = "";

      try {
        rawBody = await request.text();
      } catch (e) {
        console.error("Failed to read request body:", e?.stack || String(e));
      }

      resetKvWriteState(env);
      ctx.waitUntil(handleKommoRaw(rawBody, contentType, env));
      return new Response("OK", { status: 200 });
    }

    if (
      (url.pathname === "/scheduler/workflow" || url.pathname === "/scheduler/followup") &&
      request.method === "POST"
    ) {
      const expectedToken = getSchedulerToken(env);
      if (expectedToken && url.searchParams.get("token") !== expectedToken) {
        return new Response("Unauthorized", { status: 401 });
      }

      const contentType = request.headers.get("content-type") || "";
      let rawBody = "";

      try {
        rawBody = await request.text();
      } catch (e) {
        console.error("Failed to read scheduler request body:", e?.stack || String(e));
      }

      resetKvWriteState(env);
      const result = await handleSchedulerRequest(rawBody, contentType, env, { url });
      return Response.json(result);
    }

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        worker_role: "workflow_orchestrator",
        supported_modes: Object.values(PROCESS_MODES),
      });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    resetKvWriteState(env);
    ctx.waitUntil(handleCronScheduledWorkflow(event, env));
  },
};

/* -----------------------------
   Scheduler / cron entry
------------------------------ */
function getSchedulerToken(env) {
  return safeText(env.SCHEDULER_TOKEN || env.WEBHOOK_TOKEN || "", 120);
}

async function handleCronScheduledWorkflow(event, env) {
  const rawItems = safeText(env.SCHEDULED_WORKFLOW_ITEMS_JSON || "", 400000);
  if (!rawItems) {
    return;
  }

  let parsed = null;
  try {
    parsed = tryParseJsonLoose(rawItems);
  } catch (err) {
    console.error("handleCronScheduledWorkflow parse error:", err?.stack || String(err));
    return;
  }

  if (!parsed) {
    return;
  }

  try {
    await handleSchedulerPayload(parsed, env, {
      source: "cron",
      scheduledTime: Number(event?.scheduledTime || Date.now()),
      defaultMode: normalizeProcessMode(
        env.SCHEDULED_WORKFLOW_MODE || PROCESS_MODES.scheduled_no_response_followup
      ),
    });
  } catch (err) {
    console.error("handleCronScheduledWorkflow error:", err?.stack || String(err));
  }
}

async function handleSchedulerRequest(rawBody, contentType, env, { url }) {
  const bodyText = typeof rawBody === "string" ? rawBody : "";
  const ct = safeText(contentType || "", 120).toLowerCase();

  let parsed = null;

  if (bodyText.trim()) {
    try {
      parsed = tryParseJsonLoose(bodyText);
    } catch (err) {
      console.error("handleSchedulerRequest parse error:", err?.stack || String(err));
    }
  }

  if (!parsed) {
    parsed = {};
  }

  if (
    !Array.isArray(parsed) &&
    typeof parsed === "object" &&
    parsed !== null &&
    url.searchParams.get("mode")
  ) {
    parsed.mode = url.searchParams.get("mode");
  }

  logKommoDebug(env, "SCHEDULER_REQUEST_RECEIVED", {
    content_type: ct,
    mode_query: safeText(url.searchParams.get("mode") || "", 80),
    raw_preview: safeText(bodyText, 500),
  });

  return handleSchedulerPayload(parsed, env, {
    source: "http",
    defaultMode: normalizeProcessMode(
      url.searchParams.get("mode") || PROCESS_MODES.scheduled_no_response_followup
    ),
  });
}

async function handleSchedulerPayload(payload, env, meta = {}) {
  const source = safeText(meta.source || "scheduler", 40);
  const defaultMode = normalizeProcessMode(
    payload?.mode ||
      payload?.process_mode ||
      meta.defaultMode ||
      PROCESS_MODES.scheduled_no_response_followup
  );

  const rawItems = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.leads)
        ? payload.leads
        : Array.isArray(payload?.data)
          ? payload.data
          : payload && typeof payload === "object" && Object.keys(payload).length > 0
            ? [payload]
            : [];

  const items = rawItems
    .map((item, index) => normalizeSchedulerItem(item, defaultMode, index))
    .filter(Boolean);

  const results = [];

  for (const item of items) {
    try {
      const result = await processScheduledWorkflow(env, item, { source });
      results.push(result);
    } catch (err) {
      console.error("processScheduledWorkflow error:", err?.stack || String(err));
      results.push({
        mode: item.mode,
        entity_id: item.entityId,
        conv_key: item.convKey,
        dispatched: false,
        skipped_reason: "unexpected_error",
        error_message: safeText(err?.message || String(err), 240),
      });
    }
  }

  return {
    ok: true,
    source,
    default_mode: defaultMode,
    received_items: rawItems.length,
    normalized_items: items.length,
    processed_items: results.length,
    dispatched_count: results.filter((x) => x?.dispatched).length,
    skipped_count: results.filter((x) => !x?.dispatched).length,
    results,
  };
}

function normalizeSchedulerItem(item, defaultMode, index = 0) {
  const src = asPlainObject(item);
  const entityId = toSafeNumber(
    src.entityId ??
      src.entity_id ??
      src.leadId ??
      src.lead_id ??
      src.id ??
      0
  );

  const convKey = safeText(
    src.convKey ||
      src.conv_key ||
      (entityId ? `lead:${entityId}` : ""),
    120
  );

  if (!convKey) return null;

  const crmState = normalizeCrmStateInput(
    src.crmState || src.crm_state || src
  );

  const normalizedEntityId = entityId || extractEntityIdFromConvKey(convKey);

  return {
    index,
    mode: normalizeProcessMode(src.mode || src.process_mode || defaultMode),
    entityId: normalizedEntityId,
    convKey,
    eventId: safeText(src.eventId || src.event_id || "", 120),
    latestCustomerText: safeText(
      src.latestCustomerText ||
        src.latest_customer_text ||
        src.customer_message ||
        "",
      2000
    ),
    crmState,
    skipDispatch: Boolean(src.skip_dispatch),
    label: safeText(src.label || src.scheduler_label || "", 120),
  };
}

async function processScheduledWorkflow(env, item, meta = {}) {
  if (!item?.convKey || !item?.entityId) {
    return {
      mode: item?.mode || PROCESS_MODES.scheduled_no_response_followup,
      entity_id: item?.entityId || 0,
      conv_key: item?.convKey || "",
      dispatched: false,
      skipped_reason: "missing_entity_or_conv_key",
    };
  }

  if (env.MEM && hasMeaningfulCrmPatch(item.crmState)) {
    await saveRuntimeCrmState(
      env,
      item.convKey,
      item.crmState,
      getMessageTtlSeconds(env),
      "medium"
    );
  }

  const runtime = await buildRuntimeContext(env, {
    convKey: item.convKey,
    fallbackCustomerText: item.latestCustomerText,
    mode: item.mode,
    runtimeOverrides: {
      crmState: item.crmState,
    },
  });

  const analysis = await analyzeLeadOneCall(env, {
    convKey: item.convKey,
    summary: runtime.summary,
    tail: runtime.tail,
    latestCustomerText: runtime.latestCustomerText,
    lastAnalysis: runtime.lastAnalysis,
    mode: item.mode,
    crmState: runtime.crmState,
  });

  const gate = shouldDispatchWorkflow(item.mode, runtime, analysis, env);
  const workflowEventId =
    item.eventId ||
    buildWorkflowEventId({
      mode: item.mode,
      entityId: item.entityId,
      convKey: item.convKey,
      runtime,
      analysis,
    });

  if (item.skipDispatch || !gate.allowed) {
    return {
      mode: item.mode,
      entity_id: item.entityId,
      conv_key: item.convKey,
      dispatched: false,
      skipped_reason: item.skipDispatch ? "skip_dispatch_flag" : gate.reason,
      route_target: getRouteTargetFromAnalysis(analysis),
      pipeline: safeText(analysis.pipeline || "", 80),
      prospect_type: safeText(analysis.prospect_type || "", 80),
      followup_plan_type: safeText(analysis.followup_plan?.plan_type || "", 80),
      hours_since_last_customer_reply: toSafeNumber(
        runtime.crmState.hours_since_last_customer_reply
      ),
      hours_since_last_cs_action: toSafeNumber(
        runtime.crmState.hours_since_last_cs_action
      ),
    };
  }

  await dispatchAnalysisOutputs(
    env,
    {
      convKey: item.convKey,
      entityId: item.entityId,
      eventId: workflowEventId,
      analysis,
      latestCustomerText: runtime.latestCustomerText,
      summary: runtime.summary,
      tail: runtime.tail,
      noteText: formatNote(analysis),
      dispatchReason: item.mode || meta.source || "scheduler",
    },
    getAnalysisDispatcherDeps()
  );

  return {
    mode: item.mode,
    entity_id: item.entityId,
    conv_key: item.convKey,
    event_id: workflowEventId,
    dispatched: true,
    route_target: getRouteTargetFromAnalysis(analysis),
    pipeline: safeText(analysis.pipeline || "", 80),
    prospect_type: safeText(analysis.prospect_type || "", 80),
    followup_plan_type: safeText(analysis.followup_plan?.plan_type || "", 80),
    execute_mode: safeText(analysis.followup_plan?.execute_mode || "", 80),
    recommended_delay_hours: toSafeNumber(
      analysis.followup_plan?.recommended_delay_hours
    ),
  };
}

function shouldDispatchWorkflow(mode, runtime, analysis, env) {
  const safeMode = normalizeProcessMode(mode);
  const pipeline = normalizePipeline(analysis?.pipeline);
  const prospectType = normalizeProspectType(analysis?.prospect_type);

  if (safeMode === PROCESS_MODES.incoming_customer_response) {
    return { allowed: true, reason: "incoming_customer_response" };
  }

  const hasContext = Boolean(
    runtime?.hasContext ||
      runtime?.latestCustomerText ||
      runtime?.tail ||
      runtime?.summary ||
      runtime?.crmState?.last_cs_action
  );

  if (!hasContext) {
    return { allowed: false, reason: "missing_runtime_context" };
  }

  if (safeMode === PROCESS_MODES.scheduled_no_response_followup) {
    const planType = safeText(analysis?.followup_plan?.plan_type || "", 80);
    const minHours = Math.max(
      toSafeNumber(analysis?.followup_plan?.recommended_delay_hours),
      getNoResponseSchedulerMinHours(env)
    );

    if (pipeline !== "no_respons" && planType !== "no_respons_followup") {
      return { allowed: false, reason: "not_no_response_path" };
    }

    const lastCustomerTs = toSafeNumber(runtime?.crmState?.last_customer_reply_ts);
    const lastCsTs = toSafeNumber(runtime?.crmState?.last_cs_action_ts);

    if (lastCustomerTs > 0 && lastCsTs > 0 && lastCustomerTs >= lastCsTs) {
      return { allowed: false, reason: "customer_already_replied_after_last_cs_action" };
    }

    const hoursSinceCustomer = toSafeNumber(
      runtime?.crmState?.hours_since_last_customer_reply
    );
    const hoursSinceCs = toSafeNumber(
      runtime?.crmState?.hours_since_last_cs_action
    );

    if (hoursSinceCustomer > 0 && hoursSinceCustomer < minHours) {
      return { allowed: false, reason: "too_soon_since_last_customer_reply" };
    }

    if (hoursSinceCs > 0 && hoursSinceCs < minHours) {
      return { allowed: false, reason: "too_soon_since_last_cs_action" };
    }

    return { allowed: true, reason: "eligible_no_response_followup" };
  }

  if (safeMode === PROCESS_MODES.post_payment_progress_check) {
    const isPostPayment =
      prospectType === "post_payment" ||
      Boolean(analysis?.status_flags?.is_post_payment) ||
      Boolean(analysis?.sop_signals?.status_flags?.is_post_payment);

    if (!isPostPayment) {
      return { allowed: false, reason: "not_post_payment_path" };
    }

    const minHours = getPostPaymentSchedulerMinHours(env);
    const hoursSinceCs = toSafeNumber(
      runtime?.crmState?.hours_since_last_cs_action
    );

    if (hoursSinceCs > 0 && hoursSinceCs < minHours) {
      return { allowed: false, reason: "too_soon_since_last_cs_action" };
    }

    return { allowed: true, reason: "eligible_post_payment_progress_check" };
  }

  return { allowed: false, reason: "unknown_process_mode" };
}

function buildWorkflowEventId({ mode, entityId, convKey, runtime, analysis }) {
  void analysis;

  const safeMode = normalizeProcessMode(mode);
  const latestCustomerEventId = safeText(runtime?.latestCustomerEventId || "", 80);
  const lastCustomerTs = toSafeNumber(runtime?.crmState?.last_customer_reply_ts);
  const lastCsTs = toSafeNumber(runtime?.crmState?.last_cs_action_ts);

  return safeText(
    [
      safeMode,
      entityId || extractEntityIdFromConvKey(convKey) || 0,
      latestCustomerEventId || lastCustomerTs || "no_customer_event",
      lastCsTs || "no_cs_ts",
    ].join(":"),
    120
  );
}

function getNoResponseSchedulerMinHours(env) {
  const n = Number(env.NO_RESPONSE_SCHEDULER_MIN_HOURS || "24");
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 240) : 24;
}

function getPostPaymentSchedulerMinHours(env) {
  const n = Number(env.POST_PAYMENT_PROGRESS_MIN_HOURS || "12");
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 240) : 12;
}

function normalizeProcessMode(value) {
  const raw = safeText(value || "", 80).toLowerCase();

  if (
    raw === PROCESS_MODES.incoming_customer_response ||
    raw === "incoming" ||
    raw === "inbound" ||
    raw === "incoming_response"
  ) {
    return PROCESS_MODES.incoming_customer_response;
  }

  if (
    raw === PROCESS_MODES.scheduled_no_response_followup ||
    raw === "no_response" ||
    raw === "scheduled_no_response" ||
    raw === "scheduled_followup"
  ) {
    return PROCESS_MODES.scheduled_no_response_followup;
  }

  if (
    raw === PROCESS_MODES.post_payment_progress_check ||
    raw === "post_payment" ||
    raw === "post_payment_check" ||
    raw === "progress_check"
  ) {
    return PROCESS_MODES.post_payment_progress_check;
  }

  return PROCESS_MODES.incoming_customer_response;
}

function getRouteTargetFromAnalysis(analysis) {
  const pipeline = normalizePipeline(analysis?.pipeline);

  return firstNonEmpty([
    safeText(analysis?.planner_meta?.route_target || "", 80),
    safeText(analysis?.followup_plan?.route_target || "", 80),
    safeText(analysis?.followup_meta?.route_target || "", 80),
    ROUTE_TARGETS[pipeline] || ROUTE_TARGETS.respons,
  ]);
}

/* -----------------------------
   Helper: normalize webhook messages
------------------------------ */
function extractMessageTimestamp(rawMessage, fallbackTs = Date.now()) {
  const candidates = [
    rawMessage?.created_at,
    rawMessage?.createdAt,
    rawMessage?.timestamp,
    rawMessage?.ts,
    rawMessage?.time,
    rawMessage?.sent_at,
    rawMessage?.updated_at,
    rawMessage?.date_create,
    rawMessage?.created,
  ];

  for (const value of candidates) {
    const parsed = parseTimestampMs(value);
    if (parsed > 0) return parsed;
  }

  return fallbackTs;
}

function extractStableMessageEventId(rawMessage, fallbackId = "") {
  const rawId = safeText(
    rawMessage?.event_id ??
      rawMessage?.eventId ??
      rawMessage?.message_id ??
      rawMessage?.messageId ??
      rawMessage?.msg_id ??
      rawMessage?.msgId ??
      rawMessage?.id ??
      "",
    80
  );

  return rawId || safeText(fallbackId || randomNonce(), 80);
}

function normalizeKommoMessage(rawMessage, index = 0) {
  const text = safeText(
    rawMessage?.text ??
      rawMessage?.message ??
      rawMessage?.body ??
      rawMessage?.content ??
      rawMessage?.caption ??
      "",
    2000
  );

  const entityId = Number(
    rawMessage?.entity_id ??
      rawMessage?.entityId ??
      rawMessage?.lead_id ??
      rawMessage?.leadId ??
      rawMessage?.lead?.id ??
      rawMessage?.entity?.id ??
      0
  );

  const entityType = safeText(
    rawMessage?.entity_type ??
      rawMessage?.entityType ??
      rawMessage?.entity ??
      "",
    80
  ).toLowerCase();

  const direction = safeText(
    rawMessage?.type ??
      rawMessage?.direction ??
      rawMessage?.message_type ??
      rawMessage?.msg_type ??
      rawMessage?.messageType ??
      "",
    80
  ).toLowerCase();

  const role =
    ["outgoing", "out", "agent", "manager", "operator"].includes(direction)
      ? "agent"
      : "customer";

  const ts = extractMessageTimestamp(rawMessage, Date.now() + index);

  const eventId = extractStableMessageEventId(
    rawMessage,
    `${entityType || "unknown"}:${entityId || 0}:${role}:${ts}:${index}`
  );

  return {
    raw: rawMessage,
    index,
    text,
    entityId,
    entityType,
    direction,
    role,
    ts,
    eventId,
    convKey: entityId ? `lead:${entityId}` : "",
  };
}

function compareNormalizedMessages(a, b) {
  const leftTs = Number(a?.ts || 0);
  const rightTs = Number(b?.ts || 0);

  if (leftTs !== rightTs) return leftTs - rightTs;

  const leftIndex = Number(a?.index || 0);
  const rightIndex = Number(b?.index || 0);

  return leftIndex - rightIndex;
}

async function isStillLatestCustomerEvent(env, convKey, eventId) {
  if (!env.MEM) return true;

  const latestCustomerRaw = await safeKvGetJson(env, latestCustomerKey(convKey));
  const latestCustomer = sanitizeLatestCustomer(latestCustomerRaw);

  if (!latestCustomer?.eventId) return true;

  return latestCustomer.eventId === safeText(eventId || "", 80);
}

/* -----------------------------
   Main handler
------------------------------ */
async function handleKommoRaw(rawBody, contentType, env) {
  try {
    const raw = typeof rawBody === "string" ? rawBody : "";
    const safeContentType = safeText(contentType || "", 200).toLowerCase();

    logKommoDebug(env, "KOMMO_WEBHOOK_RAW", {
      content_type: safeContentType || "(empty)",
      raw_preview: safeText(raw, 600),
      raw_length: raw.length,
    });

    const parsedMessages = parseKommoWebhookPayload(rawBody, contentType);

    logKommoDebug(env, "KOMMO_MESSAGES_EXTRACTED", {
      content_type: contentType,
      count: Array.isArray(parsedMessages) ? parsedMessages.length : 0,
      sample_keys:
        Array.isArray(parsedMessages) && parsedMessages[0]
          ? Object.keys(parsedMessages[0]).slice(0, 20)
          : [],
    });

    /** @type {any[]} */
    const normalizedMessages = [];

    for (let i = 0; i < (Array.isArray(parsedMessages) ? parsedMessages.length : 0); i += 1) {
      const rawMessage = parsedMessages[i];

      try {
        const normalized = normalizeKommoMessage(rawMessage, i);

        logKommoDebug(env, "KOMMO_MSG_RAW_FIELDS", {
          entity_type_raw:
            rawMessage?.entity_type ??
            rawMessage?.entityType ??
            rawMessage?.entity ??
            rawMessage?.entity_type_id ??
            rawMessage?.entityTypeId ??
            "",
          entity_id_raw:
            rawMessage?.entity_id ??
            rawMessage?.entityId ??
            rawMessage?.lead_id ??
            rawMessage?.leadId ??
            rawMessage?.lead?.id ??
            rawMessage?.entity?.id ??
            "",
          type_raw:
            rawMessage?.type ??
            rawMessage?.direction ??
            rawMessage?.message_type ??
            rawMessage?.msg_type ??
            rawMessage?.messageType ??
            "",
          text_raw_preview: safeText(
            String(
              rawMessage?.text ??
                rawMessage?.message ??
                rawMessage?.body ??
                rawMessage?.content ??
                rawMessage?.caption ??
                ""
            ),
            120
          ),
          keys: Object.keys(rawMessage || {}).slice(0, 30),
        });

        logKommoDebug(env, "KOMMO_MSG_NORMALIZED", {
          entity_type: normalized.entityType,
          entity_id: normalized.entityId,
          type: normalized.direction || "(empty)",
          role: normalized.role,
          ts: normalized.ts,
          event_id: normalized.eventId,
          has_text: Boolean(normalized.text),
          text_preview: normalized.text.slice(0, 120),
        });

        if (!normalized.text || normalized.entityType !== "lead" || !normalized.entityId) {
          logKommoDebug(env, "KOMMO_MSG_SKIPPED", {
            reason: {
              missing_text: !normalized.text,
              invalid_entity_type: normalized.entityType !== "lead",
              invalid_entity_id: !normalized.entityId,
            },
            normalized_entity_type: normalized.entityType,
            normalized_entity_id: normalized.entityId,
            text_preview: normalized.text.slice(0, 120),
          });
          continue;
        }

        normalizedMessages.push(normalized);
      } catch (errPerNormalize) {
        console.error(
          "handleKommoRaw normalize message error:",
          errPerNormalize?.stack || String(errPerNormalize)
        );
      }
    }

    if (normalizedMessages.length === 0) {
      logKommoDebug(env, "KOMMO_NO_VALID_MESSAGES", {
        content_type: safeContentType || "(empty)",
      });
      return;
    }

    normalizedMessages.sort(compareNormalizedMessages);

    /** @type {Map<string, any>} */
    const latestCustomerByLead = new Map();

    for (const msg of normalizedMessages) {
      try {
        const crmStatePatch = extractCrmStateFromRawMessage(msg.raw, msg);

        if (env.MEM) {
          try {
            await saveConversationMessage(env, msg.convKey, {
              eventId: msg.eventId,
              role: msg.role,
              text: msg.text,
              ts: msg.ts,
              crmStatePatch,
            });
          } catch (err) {
            console.error("saveConversationMessage error:", err?.stack || String(err));
          }
        }

        if (msg.role !== "customer") {
          logKommoDebug(env, "KOMMO_MSG_NON_CUSTOMER_SKIPPED", {
            entity_id: msg.entityId,
            role: msg.role,
            type: msg.direction || "(empty)",
            event_id: msg.eventId,
          });
          continue;
        }

        latestCustomerByLead.set(msg.convKey, {
          ...msg,
          crmStatePatch,
        });
      } catch (errPerMessage) {
        console.error("handleKommoRaw message processing error:", errPerMessage?.stack || String(errPerMessage));
      }
    }

    logKommoDebug(env, "KOMMO_LATEST_CUSTOMER_PER_LEAD", {
      total_valid_messages: normalizedMessages.length,
      unique_leads_to_process: latestCustomerByLead.size,
      leads: [...latestCustomerByLead.values()].map((item) => ({
        conv_key: item.convKey,
        entity_id: item.entityId,
        event_id: item.eventId,
        ts: item.ts,
        text_preview: safeText(item.text, 120),
      })),
    });

    /** @type {Promise<unknown>[]} */
    const jobs = [];

    for (const latestCustomer of latestCustomerByLead.values()) {
      const {
        convKey,
        entityId,
        eventId,
        text,
        crmStatePatch,
      } = latestCustomer;

      if (!env.MEM) {
        jobs.push(
          processInboundWithoutMemory(env, {
            convKey,
            entityId,
            eventId,
            latestCustomerText: text,
            crmStatePatch,
          })
        );
        continue;
      }

      jobs.push(
        processAfterDebounce(env, {
          convKey,
          entityId,
          eventId,
          fallbackCustomerText: text,
        })
      );
    }

    if (jobs.length > 0) {
      await Promise.allSettled(jobs);
    }
  } catch (err) {
    console.error("handleKommoRaw error:", err?.stack || String(err));
  }
}

async function processInboundWithoutMemory(env, {
  convKey,
  entityId,
  eventId,
  latestCustomerText,
  crmStatePatch,
}) {
  try {
    const runtime = await buildRuntimeContext(env, {
      convKey,
      fallbackCustomerText: latestCustomerText,
      mode: PROCESS_MODES.incoming_customer_response,
      runtimeOverrides: {
        crmState: crmStatePatch,
      },
    });

    const analysis = await analyzeLeadOneCall(env, {
      convKey,
      summary: runtime.summary,
      tail: runtime.tail,
      latestCustomerText: runtime.latestCustomerText,
      lastAnalysis: runtime.lastAnalysis,
      mode: PROCESS_MODES.incoming_customer_response,
      crmState: runtime.crmState,
    });

    await dispatchAnalysisOutputs(
      env,
      {
        convKey,
        entityId,
        eventId,
        analysis,
        latestCustomerText: runtime.latestCustomerText,
        summary: runtime.summary,
        tail: runtime.tail,
        noteText: formatNote(analysis),
        dispatchReason: PROCESS_MODES.incoming_customer_response,
      },
      getAnalysisDispatcherDeps()
    );
  } catch (err) {
    console.error("processInboundWithoutMemory error:", err?.stack || String(err));

    await dispatchFallbackAnalysisOutputs(
      env,
      {
        convKey,
        entityId,
        eventId,
        fallbackCustomerText: latestCustomerText,
        dispatchReason: "unexpected_error",
      },
      getAnalysisDispatcherDeps()
    );
  }
}

/* -----------------------------
   Main processing
------------------------------ */
function getDebounceMs(env) {
  const sec = Number(env.DEBOUNCE_SECONDS || "5");
  const safe = Number.isFinite(sec) && sec >= 1 ? Math.min(sec, 20) : 5;
  return safe * 1000;
}

function noteHashKey(convKey, eventId) {
  return `notehash:${convKey}:${safeKvPart(eventId || "unknown")}`;
}

function suggestReplyHashKey(convKey, eventId) {
  return `suggesthash:${convKey}:${safeKvPart(eventId || "unknown")}`;
}

function latestCustomerKey(convKey) {
  return `latest_customer:${convKey}`;
}

function latestAgentKey(convKey) {
  return `latest_agent:${convKey}`;
}

function tailCacheKey(convKey) {
  return `tail_cache:${convKey}`;
}

function summaryCacheKey(convKey) {
  return `summary_cache:${convKey}`;
}

function lastAnalysisKey(convKey) {
  return `last_analysis:${convKey}`;
}

function crmStateKey(convKey) {
  return `crm_state:${convKey}`;
}

function getNoteHashTtlSeconds(env) {
  const n = Number(env.NOTE_HASH_TTL_SECONDS || "300");
  return Number.isFinite(n) && n >= 30 ? Math.min(n, 3600) : 300;
}

function getSuggestReplyHashTtlSeconds(env) {
  const n = Number(env.SUGGEST_REPLY_HASH_TTL_SECONDS || String(getNoteHashTtlSeconds(env)));
  return Number.isFinite(n) && n >= 30 ? Math.min(n, 3600) : getNoteHashTtlSeconds(env);
}

function getAnalysisDispatcherDeps() {
  return {
    noteHashKey,
    suggestReplyHashKey,
    getNoteHashTtlSeconds,
    getSuggestReplyHashTtlSeconds,
    hasPerEventHash,
    rememberPerEventHash,
    saveLastAnalysisCache,
    buildRuntimeContext,
    analyzeLeadOneCall,
    buildMinimalDatasetBase,
  };
}

async function processAfterDebounce(env, { convKey, entityId, eventId, fallbackCustomerText = "" }) {
  try {
    logKommoDebug(env, "PROCESS_AFTER_DEBOUNCE_START", {
      conv_key: convKey,
      entity_id: entityId,
      event_id: eventId,
      fallback_customer_text_preview: safeText(fallbackCustomerText, 160),
    });

    const debounceMs = getDebounceMs(env);
    if (debounceMs > 0) {
      await sleep(debounceMs);
    }

    if (!(await isStillLatestCustomerEvent(env, convKey, eventId))) {
      logKommoDebug(env, "PROCESS_AFTER_DEBOUNCE_EXIT", {
        reason: "stale_event_after_debounce",
        conv_key: convKey,
        entity_id: entityId,
        event_id: eventId,
      });
      return;
    }

    const runtime = await buildRuntimeContext(env, {
      convKey,
      fallbackCustomerText,
      mode: PROCESS_MODES.incoming_customer_response,
    });

    if (!(await isStillLatestCustomerEvent(env, convKey, eventId))) {
      logKommoDebug(env, "PROCESS_AFTER_DEBOUNCE_EXIT", {
        reason: "stale_event_before_analysis",
        conv_key: convKey,
        entity_id: entityId,
        event_id: eventId,
      });
      return;
    }

    const analysis = await analyzeLeadOneCall(env, {
      convKey,
      summary: runtime.summary,
      tail: runtime.tail,
      latestCustomerText: runtime.latestCustomerText,
      lastAnalysis: runtime.lastAnalysis,
      mode: PROCESS_MODES.incoming_customer_response,
      crmState: runtime.crmState,
    });

    if (!(await isStillLatestCustomerEvent(env, convKey, eventId))) {
      logKommoDebug(env, "PROCESS_AFTER_DEBOUNCE_EXIT", {
        reason: "stale_event_before_dispatch",
        conv_key: convKey,
        entity_id: entityId,
        event_id: eventId,
      });
      return;
    }

    await dispatchAnalysisOutputs(
      env,
      {
        convKey,
        entityId,
        eventId,
        analysis,
        latestCustomerText: runtime.latestCustomerText,
        summary: runtime.summary,
        tail: runtime.tail,
        noteText: formatNote(analysis),
        dispatchReason: PROCESS_MODES.incoming_customer_response,
      },
      getAnalysisDispatcherDeps()
    );
  } catch (err) {
    console.error("processAfterDebounce error:", err?.stack || String(err));

    logKommoDebug(env, "PROCESS_AFTER_DEBOUNCE_EXIT", {
      reason: "unexpected_error",
      conv_key: convKey,
      entity_id: entityId,
      event_id: eventId,
      fallback_mode: "dispatch_note_anyway_from_catch",
      error_message: safeText(err?.message || String(err), 300),
    });

    try {
      if (!(await isStillLatestCustomerEvent(env, convKey, eventId))) {
        logKommoDebug(env, "PROCESS_AFTER_DEBOUNCE_EXIT", {
          reason: "stale_event_before_fallback_dispatch",
          conv_key: convKey,
          entity_id: entityId,
          event_id: eventId,
        });
        return;
      }

      await dispatchFallbackAnalysisOutputs(
        env,
        {
          convKey,
          entityId,
          eventId,
          fallbackCustomerText,
          dispatchReason: "unexpected_error",
        },
        getAnalysisDispatcherDeps()
      );
    } catch (fallbackErr) {
      console.error(
        "processAfterDebounce fallback dispatch error:",
        fallbackErr?.stack || String(fallbackErr)
      );
    }
  }
}

async function hasPerEventHash(env, key, hash) {
  if (!env.MEM) return false;
  if (!shouldAllowLowPriorityKvWrites(env)) return false;
  if (isKvWriteDisabled(env)) return false;

  try {
    const lastHash = await env.MEM.get(key);
    return Boolean(lastHash && lastHash === hash);
  } catch (err) {
    console.error("hasPerEventHash error:", err?.stack || String(err));
    return false;
  }
}

async function rememberPerEventHash(env, key, hash, ttlSeconds, priority = "low") {
  if (!canAttemptKvWrite(env, priority)) return;

  try {
    await env.MEM.put(key, hash, {
      expirationTtl: ttlSeconds,
    });
  } catch (err) {
    if (isKvPutLimitExceededError(err)) {
      disableKvWritesForRequest(env, key, err);
      return;
    }

    console.error("rememberPerEventHash error:", err?.stack || String(err));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -----------------------------
   Deterministic KV state
------------------------------ */
function getMessageTtlSeconds(env) {
  const n = Number(env.MESSAGE_TTL_SECONDS || String(7 * 24 * 3600));
  return Number.isFinite(n) && n >= 3600 ? Math.min(n, 30 * 24 * 3600) : 7 * 24 * 3600;
}

function getTailMessages(env) {
  const n = Number(env.TAIL_MESSAGES || "6");
  return Number.isFinite(n) && n >= 2 ? Math.min(n, 20) : 6;
}

function getSummaryWindowMessages(env) {
  const n = Number(env.SUMMARY_WINDOW_MESSAGES || "12");
  return Number.isFinite(n) && n >= 4 ? Math.min(n, 30) : 12;
}

function getSummaryLineLimit(env) {
  return Math.min(Math.max(getSummaryWindowMessages(env), 4), 12);
}

function shouldAllowMediumPriorityKvWrites(env) {
  return getBooleanEnv(env, "KV_MEDIUM_PRIORITY_WRITES_ENABLED", true);
}

function shouldAllowLowPriorityKvWrites(env) {
  return getBooleanEnv(env, "KV_LOW_PRIORITY_WRITES_ENABLED", true);
}

function shouldSaveTailCache(env) {
  return getBooleanEnv(env, "KV_TAIL_CACHE_ENABLED", true);
}

function shouldSaveSummaryCache(env) {
  return getBooleanEnv(env, "KV_SUMMARY_CACHE_ENABLED", true);
}

function shouldSaveLatestCustomerCache(env) {
  return getBooleanEnv(env, "KV_LATEST_CUSTOMER_CACHE_ENABLED", true);
}

function shouldSaveLatestAgentCache(env) {
  return getBooleanEnv(env, "KV_LATEST_AGENT_CACHE_ENABLED", true);
}

function shouldSaveCrmStateCache(env) {
  return getBooleanEnv(env, "KV_CRM_STATE_CACHE_ENABLED", true);
}

function shouldPersistLastAnalysisCache(env) {
  return getBooleanEnv(env, "KV_LAST_ANALYSIS_CACHE_ENABLED", true);
}

function shouldIncludeAgentMessagesInTail(env) {
  return getBooleanEnv(env, "KV_TAIL_INCLUDE_AGENT_MESSAGES", true);
}

function shouldIncludeAgentMessagesInSummary(env) {
  return getBooleanEnv(env, "KV_SUMMARY_INCLUDE_AGENT_MESSAGES", false);
}

function getKvWriteState(env) {
  if (!env.__kvWriteState || typeof env.__kvWriteState !== "object") {
    env.__kvWriteState = {
      disabled: false,
      quotaLogged: false,
    };
  }

  return env.__kvWriteState;
}

function resetKvWriteState(env) {
  env.__kvWriteState = {
    disabled: false,
    quotaLogged: false,
  };
}

function isKvWriteDisabled(env) {
  return Boolean(getKvWriteState(env).disabled);
}

function isKvPutLimitExceededError(err) {
  const message = safeText(
    String(err?.message || err?.stack || String(err || "")),
    500
  ).toLowerCase();

  return (
    message.includes("kv put() limit exceeded for the day") ||
    message.includes("put() limit exceeded for the day")
  );
}

function disableKvWritesForRequest(env, key, err) {
  const state = getKvWriteState(env);
  state.disabled = true;

  if (!state.quotaLogged) {
    state.quotaLogged = true;
    console.log("KV write quota exceeded; disabling KV writes for this request.", {
      key: safeText(key || "", 160),
      message: safeText(err?.message || String(err), 300),
    });
  }
}

function canAttemptKvWrite(env, priority = "medium") {
  if (!env.MEM) return false;
  if (isKvWriteDisabled(env)) return false;

  if (priority === "low") {
    return shouldAllowLowPriorityKvWrites(env);
  }

  if (priority === "medium") {
    return shouldAllowMediumPriorityKvWrites(env);
  }

  return true;
}

async function safeKvGetJson(env, key) {
  if (!env.MEM) return null;

  try {
    return await env.MEM.get(key, { type: "json" });
  } catch (err) {
    console.error("safeKvGetJson error:", key, err?.stack || String(err));
    return null;
  }
}

async function safeKvPutJson(env, key, value, ttlSeconds, priority = "medium") {
  if (!canAttemptKvWrite(env, priority)) return false;

  try {
    await env.MEM.put(key, JSON.stringify(value), {
      expirationTtl: ttlSeconds,
    });
    return true;
  } catch (err) {
    if (isKvPutLimitExceededError(err)) {
      disableKvWritesForRequest(env, key, err);
      return false;
    }

    console.error("safeKvPutJson error:", key, err?.stack || String(err));
    return false;
  }
}

function toVoidPromise(promise) {
  return Promise.resolve(promise).then(() => {});
}

function normalizeStoredMessage(input) {
  if (!input || typeof input !== "object") return null;

  const text = safeText(input?.text || "", 2000);
  if (!text) return null;

  return {
    eventId: safeText(input?.eventId || "", 80),
    role: input?.role === "agent" ? "agent" : "customer",
    text,
    ts: Number(input?.ts) || 0,
  };
}

function sanitizeLatestCustomer(input) {
  const normalized = normalizeStoredMessage(input);
  return normalized && normalized.role === "customer" ? normalized : null;
}

function sanitizeLatestAgent(input) {
  const normalized = normalizeStoredMessage(input);
  return normalized && normalized.role === "agent" ? normalized : null;
}

function sanitizeTailCache(input) {
  const src = asPlainObject(input);
  const entries = Array.isArray(src.entries)
    ? src.entries.map(normalizeStoredMessage).filter(Boolean).sort((a, b) => a.ts - b.ts)
    : [];

  return {
    entries,
    transcript: safeText(src.transcript || buildTailTranscript(entries, entries.length || 1), 2400),
    updated_at: Number(src.updated_at) || 0,
  };
}

function sanitizeSummaryCache(input) {
  const src = asPlainObject(input);
  const lines = Array.isArray(src.lines)
    ? src.lines.map((x) => safeText(String(x || ""), 180)).filter(Boolean)
    : [];
  const text = safeText(src.text || lines.join("\n"), 1200);

  return {
    lines,
    text,
    updated_at: Number(src.updated_at) || 0,
  };
}

function sanitizeCachedAnalysis(input) {
  const src = asPlainObject(input);
  const analysis = src.analysis && typeof src.analysis === "object" ? src.analysis : src;
  if (!analysis || typeof analysis !== "object") return null;

  const taxonomy = normalizeAnalysisTaxonomy(analysis);

  const suggestedReply = firstNonEmpty([
    safeText(analysis.suggested_reply || "", 220),
    safeText(analysis.suggested_response || "", 220),
    "",
  ]);

  const pipeline = normalizePipeline(
    analysis.pipeline || taxonomy.pipeline || DEFAULT_ANALYSIS.pipeline || "respons"
  );
  const leadLevel = normalizeLeadLevelStage(
    analysis.lead_level ||
      analysis.lead_level_stage ||
      taxonomy.lead_level_stage ||
      DEFAULT_ANALYSIS.lead_level_stage ||
      "cold"
  );
  const priority = normalizePriorityLevel(
    analysis.priority ||
      analysis.priority_level ||
      DEFAULT_ANALYSIS.priority_level ||
      "medium"
  );
  const prospectType = normalizeProspectType(
    analysis.prospect_type || DEFAULT_ANALYSIS.prospect_type || "none"
  );

  return {
    rule_id: safeText(analysis.rule_id || "", 80),
    dataset_row_id: safeText(analysis.dataset_row_id || "", 80),
    dataset_row_label: safeText(analysis.dataset_row_label || "", 120),

    pipeline,
    lead_level: leadLevel,
    lead_level_stage: leadLevel,
    priority,
    priority_level: priority,
    prospect_type: prospectType,
    should_upgrade_to_prospek: Boolean(
      analysis.should_upgrade_to_prospek || pipeline === "prospek" || prospectType !== "none"
    ),

    intent: normalizeIntent(analysis.intent || taxonomy.intent || "unknown"),
    emotion: normalizeEmotion(analysis.emotion || taxonomy.emotion || "unknown"),
    behaviour_stage: normalizeBehaviourStage(
      analysis.behaviour_stage || taxonomy.behaviour_stage || "curiosity"
    ),

    customer_profile: safeText(analysis.customer_profile || "", 200),
    sop_stage_current: normalizeSopStage(
      analysis.sop_stage_current || DEFAULT_ANALYSIS.sop_stage_current
    ),
    sop_stage_next: normalizeSopStage(
      analysis.sop_stage_next || DEFAULT_ANALYSIS.sop_stage_next
    ),
    followup_gap: safeText(analysis.followup_gap || "", 1200),

    conversion_rate_analyzed: safePercent(
      analysis.conversion_rate_analyzed,
      20
    ),
    confidence_score: safePercent(
      analysis.confidence_score,
      20
    ),

    cs_action: safeText(analysis.cs_action || "", 1200),
    suggested_reply: suggestedReply,
    suggested_response: suggestedReply,

    matched_patterns: toStringArray(analysis.matched_patterns).slice(0, 20),
    matched_in:
      analysis.matched_in && typeof analysis.matched_in === "object"
        ? {
            latest: toStringArray(analysis.matched_in.latest).slice(0, 20),
            tail: toStringArray(analysis.matched_in.tail).slice(0, 20),
            summary: toStringArray(analysis.matched_in.summary).slice(0, 20),
          }
        : { latest: [], tail: [], summary: [] },

    matched_context_cues: toStringArray(analysis.matched_context_cues).slice(0, 20),
    signal_alignment_details: toStringArray(analysis.signal_alignment_details).slice(0, 20),

    rule_source: safeText(analysis.rule_source || "", 80),
    sources_used: Array.isArray(analysis.sources_used)
      ? uniqueStrings(analysis.sources_used.map((x) => safeText(String(x || ""), 80))).slice(0, 12)
      : [],
    merge_meta: analysis.merge_meta && typeof analysis.merge_meta === "object" ? analysis.merge_meta : {},

    stage_meta: analysis.stage_meta && typeof analysis.stage_meta === "object" ? analysis.stage_meta : {},
    pipeline_meta: analysis.pipeline_meta && typeof analysis.pipeline_meta === "object" ? analysis.pipeline_meta : {},
    prospect_meta: analysis.prospect_meta && typeof analysis.prospect_meta === "object" ? analysis.prospect_meta : {},
    followup_meta: analysis.followup_meta && typeof analysis.followup_meta === "object" ? analysis.followup_meta : {},
    followup_plan: analysis.followup_plan && typeof analysis.followup_plan === "object" ? analysis.followup_plan : {},
    planner_meta: analysis.planner_meta && typeof analysis.planner_meta === "object" ? analysis.planner_meta : {},

    status_flags: analysis.status_flags && typeof analysis.status_flags === "object" ? analysis.status_flags : {},
    bubble_metrics: analysis.bubble_metrics && typeof analysis.bubble_metrics === "object" ? analysis.bubble_metrics : {},
    sop_signals: analysis.sop_signals && typeof analysis.sop_signals === "object" ? analysis.sop_signals : {},

    engine_dataset: safeText(analysis.engine_dataset || "", 80),
    process_mode: safeText(analysis.process_mode || analysis.analysis_mode || "", 80),
    analysis_mode: safeText(analysis.analysis_mode || analysis.process_mode || "", 80),
    uncertainty_note: safeText(analysis.uncertainty_note || "", 800),
    route_target: safeText(
      analysis.route_target ||
        analysis.planner_meta?.route_target ||
        analysis.followup_meta?.route_target ||
        analysis.followup_plan?.route_target ||
        "",
      80
    ),

    runtime_context:
      analysis.runtime_context && typeof analysis.runtime_context === "object"
        ? analysis.runtime_context
        : {},
  };
}

async function saveConversationMessage(env, convKey, entry) {
  if (!env.MEM) return;
  if (isKvWriteDisabled(env)) return;

  const normalized = normalizeStoredMessage({
    eventId: safeText(entry?.eventId || randomNonce(), 80),
    role: entry?.role === "agent" ? "agent" : "customer",
    text: safeText(entry?.text || "", 2000),
    ts: Number(entry?.ts) || Date.now(),
  });

  if (!normalized) return;

  const ttl = getMessageTtlSeconds(env);
  const crmStatePatch = normalizeCrmStateInput(entry?.crmStatePatch || {});

  /** @type {Promise<void>[]} */
  const tasks = [];

  if (
    shouldSaveTailCache(env) &&
    (normalized.role === "customer" || shouldIncludeAgentMessagesInTail(env))
  ) {
    tasks.push(saveTailCache(env, convKey, normalized, ttl));
  }

  if (
    shouldSaveSummaryCache(env) &&
    (normalized.role === "customer" || shouldIncludeAgentMessagesInSummary(env))
  ) {
    tasks.push(saveSummaryCache(env, convKey, normalized, ttl));
  }

  if (normalized.role === "customer" && shouldSaveLatestCustomerCache(env)) {
    tasks.push(
      toVoidPromise(
        safeKvPutJson(
          env,
          latestCustomerKey(convKey),
          normalized,
          ttl,
          "high"
        )
      )
    );
  }

  if (normalized.role === "agent" && shouldSaveLatestAgentCache(env)) {
    tasks.push(
      toVoidPromise(
        safeKvPutJson(
          env,
          latestAgentKey(convKey),
          normalized,
          ttl,
          "high"
        )
      )
    );
  }

  if (shouldSaveCrmStateCache(env)) {
    const rolePatch =
      normalized.role === "customer"
        ? {
            last_customer_reply_ts: normalized.ts,
            latest_customer_event_id: normalized.eventId,
            customer_bubble_count: 1,
          }
        : {
            last_cs_action: normalized.text,
            last_cs_action_ts: normalized.ts,
            latest_agent_event_id: normalized.eventId,
            last_followup_type:
              crmStatePatch.last_followup_type || inferFollowupTypeFromAction(normalized.text),
            agent_bubble_count: 1,
          };

    tasks.push(
      saveRuntimeCrmState(
        env,
        convKey,
        mergeCrmStates(crmStatePatch, rolePatch),
        ttl,
        "medium"
      )
    );
  }

  if (tasks.length === 0) return;
  await Promise.allSettled(tasks);
}

async function saveTailCache(env, convKey, message, ttlSeconds) {
  if (!canAttemptKvWrite(env, "high")) return;

  const existingRaw = await safeKvGetJson(env, tailCacheKey(convKey));
  const existing = sanitizeTailCache(existingRaw);

  const mergedEntries = dedupeMessagesByEventId([
    ...existing.entries,
    message,
  ]).sort((a, b) => a.ts - b.ts);

  const limitedEntries = mergedEntries.slice(-getTailMessages(env));
  const transcript = buildTailTranscript(limitedEntries, getTailMessages(env));

  if (
    transcript === existing.transcript &&
    storedMessagesEqual(existing.entries, limitedEntries)
  ) {
    return;
  }

  await safeKvPutJson(
    env,
    tailCacheKey(convKey),
    {
      entries: limitedEntries,
      transcript,
      updated_at: message.ts,
    },
    ttlSeconds,
    "high"
  );
}

async function saveSummaryCache(env, convKey, message, ttlSeconds) {
  if (!canAttemptKvWrite(env, "medium")) return;

  const existingRaw = await safeKvGetJson(env, summaryCacheKey(convKey));
  const existing = sanitizeSummaryCache(existingRaw);

  const signalLines = extractSignals(message.text);
  const latestLine =
    message.role === "customer"
      ? `• Pesan terbaru: ${safeText(message.text, 120)}`
      : "";

  const mergedLines = mergeSummaryLines(
    existing.lines,
    signalLines,
    latestLine,
    getSummaryLineLimit(env)
  );

  const text = mergedLines.join("\n").slice(0, getSummaryMaxChars(env)) || "-";

  if (sameStringArray(existing.lines, mergedLines) && existing.text === text) {
    return;
  }

  await safeKvPutJson(
    env,
    summaryCacheKey(convKey),
    {
      lines: mergedLines,
      text,
      updated_at: message.ts,
    },
    ttlSeconds,
    "medium"
  );
}

async function saveRuntimeCrmState(env, convKey, patch, ttlSeconds, priority = "medium") {
  if (!env.MEM) return;
  if (!shouldSaveCrmStateCache(env)) return;
  if (!canAttemptKvWrite(env, priority)) return;

  const normalizedPatch = normalizeCrmStateInput(patch);
  if (!hasMeaningfulCrmPatch(normalizedPatch)) return;

  const existingRaw = await safeKvGetJson(env, crmStateKey(convKey));
  const existing = sanitizeCrmState(existingRaw);
  const merged = mergeCrmStates(existing, normalizedPatch);

  if (JSON.stringify(existing) === JSON.stringify(merged)) {
    return;
  }

  await safeKvPutJson(
    env,
    crmStateKey(convKey),
    merged,
    ttlSeconds,
    priority
  );
}

async function saveLastAnalysisCache(env, convKey, {
  eventId,
  analysis,
  latestCustomerText,
  summary,
  tail,
}) {
  if (!env.MEM) return;
  if (!shouldPersistLastAnalysisCache(env)) return;
  if (!canAttemptKvWrite(env, "low")) return;

  const ttl = getMessageTtlSeconds(env);
  const sanitized = sanitizeCachedAnalysis({ analysis });

  if (!sanitized) return;

  const comparablePayload = {
    analysis: sanitized,
    latest_customer_text: safeText(latestCustomerText || "", 600),
    summary: safeText(summary || "", 1200),
    tail: safeText(tail || "", 2400),
  };

  const cacheHash = await sha1(JSON.stringify(comparablePayload));
  const existingRaw = await safeKvGetJson(env, lastAnalysisKey(convKey));
  const existingHash = safeText(existingRaw?.cache_hash || "", 80);

  if (existingHash && existingHash === cacheHash) {
    return;
  }

  await safeKvPutJson(
    env,
    lastAnalysisKey(convKey),
    {
      event_id: safeText(eventId || "", 80),
      analysis: sanitized,
      latest_customer_text: comparablePayload.latest_customer_text,
      summary: comparablePayload.summary,
      tail: comparablePayload.tail,
      cache_hash: cacheHash,
      updated_at: Date.now(),
    },
    ttl,
    "low"
  );
}

function dedupeMessagesByEventId(messages) {
  const map = new Map();
  const arr = Array.isArray(messages) ? messages : [];

  for (const item of arr) {
    const normalized = normalizeStoredMessage(item);
    if (!normalized) continue;
    const key = normalized.eventId || `${normalized.role}:${normalized.ts}:${normalized.text}`;
    map.set(key, normalized);
  }

  return [...map.values()];
}

function formatTranscriptLine(role, text, maxText = 300) {
  return `${role === "agent" ? "Agent" : "Customer"}: ${safeText(text || "", maxText)}`;
}

function appendTranscriptLine(existingTranscript, line, maxLines) {
  const lines = String(existingTranscript || "")
    .split("\n")
    .map((x) => safeText(x, 400))
    .filter(Boolean);

  lines.push(safeText(line, 400));
  return lines.slice(-Math.max(1, maxLines)).join("\n");
}

function tailIncludesText(tail, text) {
  const safeTail = safeText(String(tail || ""), 4000).toLowerCase();
  const safeNeedle = safeText(String(text || ""), 600).toLowerCase();
  if (!safeTail || !safeNeedle) return false;
  return safeTail.includes(safeNeedle);
}

function mergeSummaryLines(existingLines, signalLines, latestLine, maxLines) {
  const out = [];

  const pushUnique = (line) => {
    const safeLine = safeText(String(line || ""), 180);
    if (!safeLine) return;

    const idx = out.findIndex((x) => x.toLowerCase() === safeLine.toLowerCase());
    if (idx >= 0) {
      out.splice(idx, 1);
    }
    out.push(safeLine);
  };

  for (const line of Array.isArray(existingLines) ? existingLines : []) {
    if (/^•\s*pesan terbaru:/i.test(line)) continue;
    pushUnique(line);
  }

  for (const line of Array.isArray(signalLines) ? signalLines : []) {
    pushUnique(line);
  }

  if (latestLine) {
    pushUnique(latestLine);
  }

  return out.slice(-Math.max(1, maxLines));
}

function ensureLatestSummaryLine(summaryText, latestCustomerText, maxChars, maxLines) {
  const lines = String(summaryText || "")
    .split("\n")
    .map((x) => safeText(x, 180))
    .filter(Boolean)
    .filter((line) => !/^•\s*pesan terbaru:/i.test(line));

  if (latestCustomerText) {
    lines.push(`• Pesan terbaru: ${safeText(latestCustomerText, 120)}`);
  }

  const deduped = [];
  for (const line of lines) {
    const idx = deduped.findIndex((x) => x.toLowerCase() === line.toLowerCase());
    if (idx >= 0) deduped.splice(idx, 1);
    deduped.push(line);
  }

  return deduped.slice(-Math.max(1, maxLines)).join("\n").slice(0, maxChars) || "-";
}

function buildTailTranscript(messages, tailN) {
  const arr = Array.isArray(messages) ? messages : [];
  const slice = arr.slice(Math.max(0, arr.length - tailN));
  return slice.map((m) => formatTranscriptLine(m.role, m.text, 300)).join("\n");
}

function storedMessageSignature(message) {
  const normalized = normalizeStoredMessage(message);
  if (!normalized) return "";
  return [
    normalized.eventId,
    normalized.role,
    String(normalized.ts),
    normalized.text,
  ].join("|");
}

function storedMessagesEqual(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];

  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {
    if (storedMessageSignature(a[i]) !== storedMessageSignature(b[i])) {
      return false;
    }
  }

  return true;
}

function sameStringArray(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];

  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {
    if (safeText(String(a[i] || ""), 180) !== safeText(String(b[i] || ""), 180)) {
      return false;
    }
  }

  return true;
}

/* -----------------------------
   CRM state normalization
------------------------------ */
function normalizeCrmStateInput(input = {}) {
  const src = asPlainObject(input);

  const hasFormSent = getLooseBoolean([
    src.has_form_sent,
    src.hasFormSent,
    src.form_sent,
  ]);

  const hasFormFilled = getLooseBoolean([
    src.has_form_filled,
    src.hasFormFilled,
    src.form_filled,
  ]);

  const hasDpPaid = getLooseBoolean([
    src.has_dp_paid,
    src.hasDpPaid,
    src.dp_paid,
  ]);

  const hasInvoiceSent = getLooseBoolean([
    src.has_invoice_sent,
    src.hasInvoiceSent,
    src.invoice_sent,
  ]);

  const hasProductProofSent = getLooseBoolean([
    src.has_product_proof_sent,
    src.hasProductProofSent,
    src.product_proof_sent,
  ]);

  const hasResiSent = getLooseBoolean([
    src.has_resi_sent,
    src.hasResiSent,
    src.resi_sent,
  ]);

  return {
    brand_channel: normalizeBrandChannel(
      src.brand_channel ||
        src.brandChannel ||
        "unknown"
    ),

    last_cs_action: safeText(
      src.last_cs_action ||
        src.lastCsAction ||
        "",
      500
    ),

    last_followup_type: safeText(
      src.last_followup_type ||
        src.lastFollowupType ||
        "",
      80
    ),

    has_form_sent: hasFormSent,
    has_form_filled: hasFormFilled,
    has_dp_paid: hasDpPaid,
    has_invoice_sent: hasInvoiceSent,
    has_product_proof_sent: hasProductProofSent,
    has_resi_sent: hasResiSent,

    is_outbound_followup_run: getLooseBoolean([
      src.is_outbound_followup_run,
      src.isOutboundFollowupRun,
      src.outbound_followup_run,
    ]),

    is_post_payment: getLooseBoolean([
      src.is_post_payment,
      src.isPostPayment,
    ]) || hasDpPaid || hasInvoiceSent || hasResiSent,

    is_at_risk: getLooseBoolean([
      src.is_at_risk,
      src.isAtRisk,
    ]),

    customer_bubble_count: toSafeNumber(
      src.customer_bubble_count ?? src.customerBubbleCount ?? 0
    ),

    agent_bubble_count: toSafeNumber(
      src.agent_bubble_count ?? src.agentBubbleCount ?? 0
    ),

    customer_bubble_gt_5: Boolean(
      src.customer_bubble_gt_5 ||
        src.customerBubbleGt5 ||
        toSafeNumber(src.customer_bubble_count ?? src.customerBubbleCount) > 5
    ),

    hours_since_last_customer_reply: toSafeNumber(
      src.hours_since_last_customer_reply ?? src.hoursSinceLastCustomerReply ?? 0
    ),

    hours_since_last_cs_action: toSafeNumber(
      src.hours_since_last_cs_action ?? src.hoursSinceLastCsAction ?? 0
    ),

    last_customer_reply_ts: parseTimestampMs(
      src.last_customer_reply_ts ??
        src.lastCustomerReplyTs ??
        0
    ),

    last_cs_action_ts: parseTimestampMs(
      src.last_cs_action_ts ??
        src.lastCsActionTs ??
        0
    ),

    latest_customer_event_id: safeText(
      src.latest_customer_event_id ||
        src.latestCustomerEventId ||
        "",
      80
    ),

    latest_agent_event_id: safeText(
      src.latest_agent_event_id ||
        src.latestAgentEventId ||
        "",
      80
    ),
  };
}

function sanitizeCrmState(input = {}) {
  return normalizeCrmStateInput(input);
}

function mergeCrmStates(...states) {
  const list = Array.isArray(states) ? states : [];
  let merged = normalizeCrmStateInput({});

  for (const state of list) {
    const patch = normalizeCrmStateInput(state);

    const nextLastCsActionTs = Math.max(
      toSafeNumber(merged.last_cs_action_ts),
      toSafeNumber(patch.last_cs_action_ts)
    );

    const nextLastCustomerReplyTs = Math.max(
      toSafeNumber(merged.last_customer_reply_ts),
      toSafeNumber(patch.last_customer_reply_ts)
    );

    merged = {
      brand_channel:
        patch.brand_channel && patch.brand_channel !== "unknown"
          ? patch.brand_channel
          : merged.brand_channel,

      last_cs_action:
        patch.last_cs_action &&
        (
          !merged.last_cs_action ||
          toSafeNumber(patch.last_cs_action_ts) >= toSafeNumber(merged.last_cs_action_ts)
        )
          ? patch.last_cs_action
          : merged.last_cs_action,

      last_followup_type:
        patch.last_followup_type &&
        (
          !merged.last_followup_type ||
          toSafeNumber(patch.last_cs_action_ts) >= toSafeNumber(merged.last_cs_action_ts)
        )
          ? patch.last_followup_type
          : merged.last_followup_type,

      has_form_sent: Boolean(merged.has_form_sent || patch.has_form_sent),
      has_form_filled: Boolean(merged.has_form_filled || patch.has_form_filled),
      has_dp_paid: Boolean(merged.has_dp_paid || patch.has_dp_paid),
      has_invoice_sent: Boolean(merged.has_invoice_sent || patch.has_invoice_sent),
      has_product_proof_sent: Boolean(
        merged.has_product_proof_sent || patch.has_product_proof_sent
      ),
      has_resi_sent: Boolean(merged.has_resi_sent || patch.has_resi_sent),

      is_outbound_followup_run: Boolean(
        merged.is_outbound_followup_run || patch.is_outbound_followup_run
      ),

      is_post_payment: Boolean(
        merged.is_post_payment ||
          patch.is_post_payment ||
          merged.has_dp_paid ||
          patch.has_dp_paid ||
          merged.has_invoice_sent ||
          patch.has_invoice_sent ||
          merged.has_resi_sent ||
          patch.has_resi_sent
      ),

      is_at_risk: Boolean(merged.is_at_risk || patch.is_at_risk),

      customer_bubble_count: Math.max(
        toSafeNumber(merged.customer_bubble_count),
        toSafeNumber(patch.customer_bubble_count)
      ),

      agent_bubble_count: Math.max(
        toSafeNumber(merged.agent_bubble_count),
        toSafeNumber(patch.agent_bubble_count)
      ),

      customer_bubble_gt_5: Boolean(
        merged.customer_bubble_gt_5 ||
          patch.customer_bubble_gt_5 ||
          Math.max(
            toSafeNumber(merged.customer_bubble_count),
            toSafeNumber(patch.customer_bubble_count)
          ) > 5
      ),

      hours_since_last_customer_reply: Math.max(
        toSafeNumber(merged.hours_since_last_customer_reply),
        toSafeNumber(patch.hours_since_last_customer_reply)
      ),

      hours_since_last_cs_action: Math.max(
        toSafeNumber(merged.hours_since_last_cs_action),
        toSafeNumber(patch.hours_since_last_cs_action)
      ),

      last_customer_reply_ts: nextLastCustomerReplyTs,
      last_cs_action_ts: nextLastCsActionTs,

      latest_customer_event_id:
        toSafeNumber(patch.last_customer_reply_ts) >= toSafeNumber(merged.last_customer_reply_ts) &&
        patch.latest_customer_event_id
          ? patch.latest_customer_event_id
          : merged.latest_customer_event_id,

      latest_agent_event_id:
        toSafeNumber(patch.last_cs_action_ts) >= toSafeNumber(merged.last_cs_action_ts) &&
        patch.latest_agent_event_id
          ? patch.latest_agent_event_id
          : merged.latest_agent_event_id,
    };
  }

  return normalizeCrmStateInput(merged);
}

function hasMeaningfulCrmPatch(state) {
  const s = normalizeCrmStateInput(state);

  return Boolean(
    (s.brand_channel && s.brand_channel !== "unknown") ||
      s.last_cs_action ||
      s.last_followup_type ||
      s.has_form_sent ||
      s.has_form_filled ||
      s.has_dp_paid ||
      s.has_invoice_sent ||
      s.has_product_proof_sent ||
      s.has_resi_sent ||
      s.is_outbound_followup_run ||
      s.is_post_payment ||
      s.is_at_risk ||
      s.customer_bubble_count > 0 ||
      s.agent_bubble_count > 0 ||
      s.last_customer_reply_ts > 0 ||
      s.last_cs_action_ts > 0 ||
      s.latest_customer_event_id ||
      s.latest_agent_event_id
  );
}

function extractCrmStateFromRawMessage(rawMessage, normalizedMessage) {
  const base = normalizeCrmStateInput(
    rawMessage?.crm_state ||
      rawMessage?.crmState ||
      rawMessage?.lead ||
      rawMessage?.entity ||
      rawMessage ||
      {}
  );

  const rolePatch =
    normalizedMessage?.role === "customer"
      ? {
          last_customer_reply_ts: normalizedMessage.ts,
          latest_customer_event_id: normalizedMessage.eventId,
          customer_bubble_count: 1,
        }
      : {
          last_cs_action: normalizedMessage?.text || "",
          last_cs_action_ts: normalizedMessage?.ts || 0,
          latest_agent_event_id: normalizedMessage?.eventId || "",
          last_followup_type:
            base.last_followup_type || inferFollowupTypeFromAction(normalizedMessage?.text || ""),
          agent_bubble_count: 1,
        };

  return mergeCrmStates(base, rolePatch);
}

function inferFollowupTypeFromAction(text) {
  const safe = safeText(text || "", 400).toLowerCase();
  if (!safe) return "";

  if (containsAny(safe, ["contoh produk", "produk contoh"])) return "contoh_produk";
  if (containsAny(safe, ["konten", "design", "desain"])) return "konten_dan_design";
  if (containsAny(safe, ["testimoni", "testi"])) return "testimoni";
  if (containsAny(safe, ["sample"])) return "penawaran_sample";
  if (containsAny(safe, ["bukti transfer", "transfer"])) return "bukti_transfer";
  if (containsAny(safe, ["progress"])) return "tanya_progress";

  return "";
}

/* -----------------------------
   Heuristic summary
------------------------------ */
function getSummaryMaxChars(env) {
  const n = Number(env.SUMMARY_MAX_CHARS || "500");
  return Number.isFinite(n) && n >= 150 ? Math.min(n, 1200) : 500;
}

function extractSignals(text) {
  const t = String(text || "").toLowerCase();
  const out = [];

  if (t.includes("maklon") || t.includes("produksi") || t.includes("pabrik")) {
    out.push("• Minat maklon/produksi");
  }

  if (t.includes("sample") || t.includes("sampel")) {
    out.push("• Arah ke sample");
  }

  if (t.includes("bpom") || t.includes("legalitas")) {
    out.push("• Tanya legalitas/BPOM");
  }

  if (t.includes("merek") || t.includes("brand")) {
    out.push("• Tanya brand/merek");
  }

  const qty = t.match(/\b(\d{2,5})\s*(pcs|botol|unit)\b/);
  if (qty) {
    out.push(`• Qty: ${qty[1]} ${qty[2]}`);
  }

  if (t.includes("urgent") || t.includes("segera") || t.includes("cepat") || t.includes("hari ini")) {
    out.push("• Urgent");
  }

  if (t.includes("harga") || t.includes("budget") || t.includes("biaya")) {
    out.push("• Tertarik biaya/budget");
  }

  if (t.includes("resi") || t.includes("kapan dikirim") || t.includes("progress")) {
    out.push("• Butuh progress/status");
  }

  if (t.includes("amanah") || t.includes("ragu") || t.includes("scam")) {
    out.push("• Ada sinyal trust anxiety");
  }

  return out;
}

/* -----------------------------
   Runtime context
------------------------------ */
async function buildRuntimeContext(env, {
  convKey,
  fallbackCustomerText = "",
  mode = PROCESS_MODES.incoming_customer_response,
  runtimeOverrides = {},
}) {
  const fallbackText = safeText(fallbackCustomerText, 600);
  const safeMode = normalizeProcessMode(mode);
  const safeRuntimeOverrides = asPlainObject(runtimeOverrides);
  const overrideCrmState = normalizeCrmStateInput(
    safeRuntimeOverrides.crmState || safeRuntimeOverrides.crm_state || {}
  );

  if (!env.MEM) {
    const crmState = mergeCrmStates(
      overrideCrmState,
      {
        is_outbound_followup_run:
          safeMode === PROCESS_MODES.scheduled_no_response_followup,
        is_post_payment:
          overrideCrmState.is_post_payment ||
          safeMode === PROCESS_MODES.post_payment_progress_check,
        customer_bubble_count: Math.max(
          toSafeNumber(overrideCrmState.customer_bubble_count),
          fallbackText ? 1 : 0
        ),
        customer_bubble_gt_5:
          Boolean(overrideCrmState.customer_bubble_gt_5) ||
          toSafeNumber(overrideCrmState.customer_bubble_count) > 5,
      }
    );

    const latestCustomerText = fallbackText;
    const tail = fallbackText ? `Customer: ${safeText(fallbackText, 300)}` : "-";
    const summary = fallbackText ? `• Pesan terbaru: ${safeText(fallbackText, 120)}` : "-";

    return {
      mode: safeMode,
      convKey,
      latestCustomerText,
      tail,
      summary,
      tailEntries: [],
      lastAnalysis: null,
      latestCustomerTs: crmState.last_customer_reply_ts || 0,
      latestAgentTs: crmState.last_cs_action_ts || 0,
      latestCustomerEventId: crmState.latest_customer_event_id || "",
      latestAgentEventId: crmState.latest_agent_event_id || "",
      crmState: decorateRuntimeCrmState(crmState),
      hasContext: Boolean(latestCustomerText),
    };
  }

  const [
    latestCustomerRaw,
    latestAgentRaw,
    tailCacheRaw,
    summaryCacheRaw,
    lastAnalysisRaw,
    crmStateRaw,
  ] = await Promise.all([
    safeKvGetJson(env, latestCustomerKey(convKey)),
    safeKvGetJson(env, latestAgentKey(convKey)),
    safeKvGetJson(env, tailCacheKey(convKey)),
    safeKvGetJson(env, summaryCacheKey(convKey)),
    safeKvGetJson(env, lastAnalysisKey(convKey)),
    safeKvGetJson(env, crmStateKey(convKey)),
  ]);

  const latestCustomer = sanitizeLatestCustomer(latestCustomerRaw);
  const latestAgent = sanitizeLatestAgent(latestAgentRaw);
  const tailCache = sanitizeTailCache(tailCacheRaw);
  const summaryCache = sanitizeSummaryCache(summaryCacheRaw);
  const cachedAnalysis = sanitizeCachedAnalysis(lastAnalysisRaw);
  const storedCrmState = sanitizeCrmState(crmStateRaw);

  const fallbackCustomerFromTail = findLatestMessageByRole(tailCache.entries, "customer");
  const fallbackAgentFromTail = findLatestMessageByRole(tailCache.entries, "agent");

  let latestCustomerText = safeText(
    latestCustomer?.text ||
      fallbackCustomerFromTail?.text ||
      "",
    600
  );

  if (!latestCustomerText) {
    latestCustomerText = fallbackText;
  }

  let tail = safeText(tailCache.transcript || "", 2400);
  if (!tail && latestCustomerText) {
    tail = formatTranscriptLine("customer", latestCustomerText, 300);
  }

  if (fallbackText && !tailIncludesText(tail, fallbackText)) {
    tail = appendTranscriptLine(
      tail,
      formatTranscriptLine("customer", fallbackText, 300),
      getTailMessages(env)
    );
  }

  let summary = safeText(summaryCache.text || "", 1200);
  summary = ensureLatestSummaryLine(
    summary,
    latestCustomerText || fallbackText,
    getSummaryMaxChars(env),
    getSummaryLineLimit(env)
  );

  const customerBubblesFromTail = countMessagesByRole(tailCache.entries, "customer");
  const agentBubblesFromTail = countMessagesByRole(tailCache.entries, "agent");

  const lastCustomerReplyTs = Math.max(
    toSafeNumber(latestCustomer?.ts),
    toSafeNumber(fallbackCustomerFromTail?.ts),
    toSafeNumber(storedCrmState.last_customer_reply_ts),
    toSafeNumber(overrideCrmState.last_customer_reply_ts)
  );

  const lastCsActionTs = Math.max(
    toSafeNumber(latestAgent?.ts),
    toSafeNumber(fallbackAgentFromTail?.ts),
    toSafeNumber(storedCrmState.last_cs_action_ts),
    toSafeNumber(overrideCrmState.last_cs_action_ts)
  );

  const runtimeCrmState = mergeCrmStates(
    storedCrmState,
    overrideCrmState,
    {
      last_customer_reply_ts: lastCustomerReplyTs,
      last_cs_action_ts: lastCsActionTs,
      latest_customer_event_id:
        safeText(
          latestCustomer?.eventId ||
            fallbackCustomerFromTail?.eventId ||
            storedCrmState.latest_customer_event_id ||
            overrideCrmState.latest_customer_event_id ||
            "",
          80
        ),
      latest_agent_event_id:
        safeText(
          latestAgent?.eventId ||
            fallbackAgentFromTail?.eventId ||
            storedCrmState.latest_agent_event_id ||
            overrideCrmState.latest_agent_event_id ||
            "",
          80
        ),
      last_cs_action:
        safeText(
          storedCrmState.last_cs_action ||
            latestAgent?.text ||
            fallbackAgentFromTail?.text ||
            overrideCrmState.last_cs_action ||
            "",
          500
        ),
      customer_bubble_count: Math.max(
        toSafeNumber(storedCrmState.customer_bubble_count),
        toSafeNumber(overrideCrmState.customer_bubble_count),
        customerBubblesFromTail,
        latestCustomerText ? 1 : 0
      ),
      agent_bubble_count: Math.max(
        toSafeNumber(storedCrmState.agent_bubble_count),
        toSafeNumber(overrideCrmState.agent_bubble_count),
        agentBubblesFromTail,
        safeText(
          storedCrmState.last_cs_action ||
            latestAgent?.text ||
            fallbackAgentFromTail?.text ||
            overrideCrmState.last_cs_action ||
            "",
          40
        )
          ? 1
          : 0
      ),
      customer_bubble_gt_5:
        Math.max(
          toSafeNumber(storedCrmState.customer_bubble_count),
          toSafeNumber(overrideCrmState.customer_bubble_count),
          customerBubblesFromTail,
          latestCustomerText ? 1 : 0
        ) > 5,
      is_outbound_followup_run:
        Boolean(storedCrmState.is_outbound_followup_run) ||
        Boolean(overrideCrmState.is_outbound_followup_run) ||
        safeMode === PROCESS_MODES.scheduled_no_response_followup,
      is_post_payment:
        Boolean(storedCrmState.is_post_payment) ||
        Boolean(overrideCrmState.is_post_payment) ||
        safeMode === PROCESS_MODES.post_payment_progress_check,
    }
  );

  const decoratedCrmState = decorateRuntimeCrmState(runtimeCrmState);

  return {
    mode: safeMode,
    convKey,
    latestCustomerText: latestCustomerText || fallbackText,
    tail: tail || (fallbackText ? `Customer: ${safeText(fallbackText, 300)}` : "-"),
    summary: summary || "-",
    tailEntries: tailCache.entries,
    lastAnalysis: cachedAnalysis,
    latestCustomerTs: lastCustomerReplyTs,
    latestAgentTs: lastCsActionTs,
    latestCustomerEventId: decoratedCrmState.latest_customer_event_id || "",
    latestAgentEventId: decoratedCrmState.latest_agent_event_id || "",
    crmState: decoratedCrmState,
    hasContext: Boolean(
      latestCustomerText ||
        tailCache.entries.length ||
        summaryCache.lines.length ||
        decoratedCrmState.last_cs_action
    ),
  };
}

function decorateRuntimeCrmState(input) {
  const state = sanitizeCrmState(input);
  const now = Date.now();

  const hoursSinceLastCustomerReply =
    state.last_customer_reply_ts > 0
      ? roundHours((now - state.last_customer_reply_ts) / 3600000)
      : 0;

  const hoursSinceLastCsAction =
    state.last_cs_action_ts > 0
      ? roundHours((now - state.last_cs_action_ts) / 3600000)
      : 0;

  return {
    ...state,
    customer_bubble_gt_5:
      Boolean(state.customer_bubble_gt_5) ||
      toSafeNumber(state.customer_bubble_count) > 5,
    hours_since_last_customer_reply: hoursSinceLastCustomerReply,
    hours_since_last_cs_action: hoursSinceLastCsAction,
  };
}

/* -----------------------------
   Analysis orchestration
------------------------------ */
async function analyzeLeadOneCall(env, ctx) {
  const shared = {
    safeText,
    extractOutputAnyText,
    tryParseJsonLoose,
  };

  const safeMode = normalizeProcessMode(
    ctx?.mode || ctx?.process_mode || ctx?.workflow_mode || PROCESS_MODES.incoming_customer_response
  );

  const crmState = decorateRuntimeCrmState(
    mergeCrmStates(
      normalizeCrmStateInput(ctx?.crmState || {}),
      {
        is_outbound_followup_run:
          safeMode === PROCESS_MODES.scheduled_no_response_followup,
        is_post_payment:
          safeMode === PROCESS_MODES.post_payment_progress_check,
      }
    )
  );

  const detectionInput = {
    latestCustomerText: ctx?.latestCustomerText || "",
    customer_message: ctx?.latestCustomerText || "",
    tail: ctx?.tail || "",
    recent_chat_history: ctx?.tail || "",
    summary: ctx?.summary || "",

    brand_channel: crmState.brand_channel,
    last_cs_action: crmState.last_cs_action,
    last_followup_type: crmState.last_followup_type,

    has_form_sent: crmState.has_form_sent,
    has_form_filled: crmState.has_form_filled,
    has_dp_paid: crmState.has_dp_paid,
    has_invoice_sent: crmState.has_invoice_sent,
    has_product_proof_sent: crmState.has_product_proof_sent,
    has_resi_sent: crmState.has_resi_sent,

    is_outbound_followup_run: crmState.is_outbound_followup_run,
    is_post_payment: crmState.is_post_payment,
    is_at_risk: crmState.is_at_risk,

    customer_bubble_count: crmState.customer_bubble_count,
    customer_bubble_gt_5: crmState.customer_bubble_gt_5,
  };

  const detection = detectDatasetPattern(detectionInput);
  const datasetBase =
    detection?.dataset_base || buildMinimalDatasetBase(ctx?.latestCustomerText || "");

  const scoredAnalysis = calculateLeadScore({
    ...detectionInput,
    detection,
    datasetBase,
  });

  let primaryAnalysis = null;
  let fallbackOneAnalysis = null;
  let fallbackTwoAnalysis = null;
  let engineDataset = "deterministic_dataset_engine";

  try {
    const primary = await primaryGenerate(
      env,
      {
        ...ctx,
        ...detectionInput,
        mode: safeMode,
        process_mode: safeMode,
        workflow_mode: safeMode,
        crmState,
        runtimeContext: crmState,
        datasetBase,
        scoredAnalysis,
        detection,
      },
      shared
    );

    if (primary?.ok) {
      primaryAnalysis = primary.value;
      engineDataset = "primary_generate";
    }
  } catch (err) {
    console.error("primaryGenerate orchestration error:", err?.stack || String(err));
  }

  if (!primaryAnalysis) {
    try {
      const fallbackOne = await fallbackOneGenerate(
        env,
        {
          ...ctx,
          ...detectionInput,
          mode: safeMode,
          process_mode: safeMode,
          workflow_mode: safeMode,
          crmState,
          runtimeContext: crmState,
          datasetBase,
          scoredAnalysis,
          detection,
        },
        shared
      );

      if (fallbackOne?.ok) {
        fallbackOneAnalysis = fallbackOne.value;
        engineDataset = "fallback_one";
      }
    } catch (err) {
      console.error("fallbackOneGenerate orchestration error:", err?.stack || String(err));
    }
  }

  if (!primaryAnalysis && !fallbackOneAnalysis) {
    try {
      const fallbackTwo = fallbackTwoGenerate({
        ...ctx,
        ...detectionInput,
        mode: safeMode,
        process_mode: safeMode,
        workflow_mode: safeMode,
        crmState,
        runtimeContext: crmState,
        datasetBase,
        scoredAnalysis,
        detection,
      });

      if (fallbackTwo?.ok) {
        fallbackTwoAnalysis = fallbackTwo.value;
        engineDataset = "fallback_two";
      }
    } catch (err) {
      console.error("fallbackTwoGenerate orchestration error:", err?.stack || String(err));
    }
  }

  const merged = mergeAnalysisLayers({
    datasetBase,
    scoredAnalysis,
    primaryAnalysis,
    fallbackOneAnalysis,
    fallbackTwoAnalysis,
    lastAnalysis: ctx?.lastAnalysis || null,
    crmState,
  });

  const plannerBundle = buildFollowupPlannerBundle({
    ...detectionInput,
    detection,
    datasetBase,
    scoredAnalysis,
    mergedAnalysis: merged,
    finalAnalysis: merged,
  });

  return sanitizeFinalWorkflowAnalysis(
    plannerBundle?.final || merged,
    {
      detection,
      datasetBase,
      scoredAnalysis,
      merged,
      latestCustomerText: ctx?.latestCustomerText || "",
      engineDataset,
      processMode: safeMode,
      crmState,
    }
  );
}

function sanitizeFinalWorkflowAnalysis(
  finalAnalysis,
  meta = {}
) {
  const final = finalAnalysis && typeof finalAnalysis === "object" ? finalAnalysis : {};
  const merged = meta?.merged && typeof meta.merged === "object" ? meta.merged : {};
  const scored = meta?.scoredAnalysis && typeof meta.scoredAnalysis === "object" ? meta.scoredAnalysis : {};
  const dataset = meta?.datasetBase && typeof meta.datasetBase === "object" ? meta.datasetBase : {};
  const taxonomy = normalizeAnalysisTaxonomy(final);
  const crmState = decorateRuntimeCrmState(meta?.crmState || {});
  const processMode = normalizeProcessMode(meta?.processMode || final.process_mode);

  const pipeline = normalizePipeline(
    final.pipeline ||
      taxonomy.pipeline ||
      merged.pipeline ||
      scored.pipeline ||
      dataset.pipeline ||
      "respons"
  );

  const leadLevel = normalizeLeadLevelStage(
    final.lead_level ||
      final.lead_level_stage ||
      taxonomy.lead_level_stage ||
      merged.lead_level_stage ||
      scored.lead_level_stage ||
      dataset.lead_level_stage ||
      "cold"
  );

  const priority = normalizePriorityLevel(
    final.priority ||
      final.priority_level ||
      scored.priority ||
      scored.priority_level ||
      dataset.priority ||
      dataset.priority_level ||
      DEFAULT_ANALYSIS.priority_level ||
      "medium"
  );

  const prospectType = normalizeProspectType(
    final.prospect_type ||
      scored.prospect_type ||
      dataset.prospect_type ||
      DEFAULT_ANALYSIS.prospect_type ||
      "none"
  );

  const suggestedReply = firstNonEmpty([
    safeText(final.suggested_reply || "", 220),
    safeText(final.suggested_response || "", 220),
    safeText(merged.suggested_response || "", 220),
    safeText(scored.suggested_reply || "", 220),
    safeText(scored.suggested_response || "", 220),
    safeText(dataset.suggested_reply || "", 220),
    safeText(dataset.suggested_response || "", 220),
    safeText(defaultSuggestions(meta?.latestCustomerText || "")[0] || "", 220),
    "boleh kak saya bantu, kakak lagi cari info harga, sample, legalitas, brand, atau progres order dulu",
  ]);

  const csAction = firstNonEmpty([
    safeText(final.cs_action || "", 1200),
    safeText(merged.cs_action || "", 1200),
    safeText(scored.cs_action || "", 1200),
    safeText(dataset.cs_action || "", 1200),
    "Tutup gap terdekat, siapkan artefak yang dibutuhkan, dan arahkan ke next step yang paling realistis.",
  ]);

  const routeTarget = firstNonEmpty([
    safeText(final.route_target || "", 80),
    safeText(final.planner_meta?.route_target || "", 80),
    safeText(final.followup_plan?.route_target || "", 80),
    safeText(final.followup_meta?.route_target || "", 80),
    ROUTE_TARGETS[pipeline] || ROUTE_TARGETS.respons,
  ]);

  const bubbleMetrics = {
    ...(dataset.bubble_metrics && typeof dataset.bubble_metrics === "object" ? dataset.bubble_metrics : {}),
    ...(scored.bubble_metrics && typeof scored.bubble_metrics === "object" ? scored.bubble_metrics : {}),
    ...(merged.bubble_metrics && typeof merged.bubble_metrics === "object" ? merged.bubble_metrics : {}),
    ...(final.bubble_metrics && typeof final.bubble_metrics === "object" ? final.bubble_metrics : {}),
    customer_bubble_count: Math.max(
      toSafeNumber(final?.bubble_metrics?.customer_bubble_count),
      toSafeNumber(scored?.bubble_metrics?.customer_bubble_count),
      toSafeNumber(dataset?.bubble_metrics?.customer_bubble_count),
      toSafeNumber(crmState.customer_bubble_count)
    ),
    agent_bubble_count: Math.max(
      toSafeNumber(final?.bubble_metrics?.agent_bubble_count),
      toSafeNumber(scored?.bubble_metrics?.agent_bubble_count),
      toSafeNumber(dataset?.bubble_metrics?.agent_bubble_count),
      toSafeNumber(crmState.agent_bubble_count)
    ),
  };

  bubbleMetrics.customer_bubble_gt_5 =
    Boolean(final?.bubble_metrics?.customer_bubble_gt_5) ||
    Boolean(scored?.bubble_metrics?.customer_bubble_gt_5) ||
    Boolean(dataset?.bubble_metrics?.customer_bubble_gt_5) ||
    bubbleMetrics.customer_bubble_count > 5;

  const matchedIn = mergeMatchedIn(
    mergeMatchedIn(
      mergeMatchedIn(dataset.matched_in, scored.matched_in),
      merged.matched_in
    ),
    final.matched_in
  );

  return {
    rule_id: firstNonEmpty([
      safeText(final.rule_id || "", 80),
      safeText(merged.rule_id || "", 80),
      safeText(scored.rule_id || "", 80),
      safeText(dataset.rule_id || "", 80),
      "final_analysis",
    ]),

    dataset_row_id: firstNonEmpty([
      safeText(final.dataset_row_id || "", 80),
      safeText(scored.dataset_row_id || "", 80),
      safeText(dataset.dataset_row_id || "", 80),
      "",
    ]),

    dataset_row_label: firstNonEmpty([
      safeText(final.dataset_row_label || "", 120),
      safeText(scored.dataset_row_label || "", 120),
      safeText(dataset.dataset_row_label || "", 120),
      "",
    ]),

    pipeline,
    lead_level: leadLevel,
    lead_level_stage: leadLevel,

    priority,
    priority_level: priority,

    prospect_type: prospectType,
    should_upgrade_to_prospek: Boolean(
      final.should_upgrade_to_prospek ||
        scored.should_upgrade_to_prospek ||
        pipeline === "prospek" ||
        prospectType !== "none"
    ),

    intent: normalizeIntent(
      final.intent ||
        taxonomy.intent ||
        merged.intent ||
        scored.intent ||
        dataset.intent ||
        "unknown"
    ),

    emotion: normalizeEmotion(
      final.emotion ||
        taxonomy.emotion ||
        merged.emotion ||
        scored.emotion ||
        dataset.emotion ||
        normalizeLocalEmotionToAnalysis(meta?.latestCustomerText || "")
    ),

    behaviour_stage: normalizeBehaviourStage(
      final.behaviour_stage ||
        taxonomy.behaviour_stage ||
        merged.behaviour_stage ||
        scored.behaviour_stage ||
        dataset.behaviour_stage ||
        "curiosity"
    ),

    customer_profile: firstNonEmpty([
      safeText(final.customer_profile || "", 200),
      safeText(scored.customer_profile || "", 200),
      safeText(dataset.customer_profile || "", 200),
      "",
    ]),

    sop_stage_current: normalizeSopStage(
      final.sop_stage_current ||
        scored.sop_stage_current ||
        dataset.sop_stage_current ||
        DEFAULT_ANALYSIS.sop_stage_current
    ),

    sop_stage_next: normalizeSopStage(
      final.sop_stage_next ||
        scored.sop_stage_next ||
        dataset.sop_stage_next ||
        DEFAULT_ANALYSIS.sop_stage_next
    ),

    followup_gap: firstNonEmpty([
      safeText(final.followup_gap || "", 1200),
      safeText(scored.followup_gap || "", 1200),
      safeText(dataset.followup_gap || "", 1200),
      "",
    ]),

    cs_action: csAction,
    suggested_reply: suggestedReply,
    suggested_response: suggestedReply,

    tag_emotion: firstNonEmpty([
      safeText(final.tag_emotion || "", 80),
      safeText(scored.tag_emotion || "", 80),
      normalizeTagToken(
        normalizeEmotion(
          final.emotion ||
            taxonomy.emotion ||
            merged.emotion ||
            scored.emotion ||
            dataset.emotion ||
            "unknown"
        )
      ),
    ]),

    tag_stage: firstNonEmpty([
      safeText(final.tag_stage || "", 80),
      safeText(scored.tag_stage || "", 80),
      normalizeTagToken(
        normalizeBehaviourStage(
          final.behaviour_stage ||
            taxonomy.behaviour_stage ||
            merged.behaviour_stage ||
            scored.behaviour_stage ||
            dataset.behaviour_stage ||
            "curiosity"
        )
      ),
    ]),

    uncertainty_note: firstNonEmpty([
      safeText(final.uncertainty_note || "", 800),
      safeText(merged.uncertainty_note || "", 800),
      "",
    ]),

    conversion_rate_analyzed: analysisPercent(
      final.conversion_rate_analyzed,
      merged.conversion_rate_analyzed,
      scored.conversion_rate_analyzed,
      dataset.conversion_rate_analyzed,
      20
    ),

    confidence_score: analysisPercent(
      final.confidence_score,
      merged.confidence_score,
      scored.confidence_score,
      dataset.confidence_score,
      20
    ),

    matched_patterns: uniqueStrings([
      ...toStringArray(dataset.matched_patterns),
      ...toStringArray(scored.matched_patterns),
      ...toStringArray(merged.matched_patterns),
      ...toStringArray(final.matched_patterns),
    ]),

    matched_in: matchedIn,

    matched_context_cues: uniqueStrings([
      ...toStringArray(dataset.matched_context_cues),
      ...toStringArray(scored.matched_context_cues),
      ...toStringArray(merged.matched_context_cues),
      ...toStringArray(final.matched_context_cues),
    ]),

    signal_alignment_details: uniqueStrings([
      ...toStringArray(dataset.signal_alignment_details),
      ...toStringArray(scored.signal_alignment_details),
      ...toStringArray(merged.signal_alignment_details),
      ...toStringArray(final.signal_alignment_details),
    ]),

    rule_source: firstNonEmpty([
      safeText(final.rule_source || "", 80),
      safeText(merged.rule_source || "", 80),
      safeText(scored.rule_source || "", 80),
      safeText(dataset.rule_source || "", 80),
      "dataset",
    ]),

    sources_used: Array.isArray(merged.sources_used)
      ? uniqueStrings(merged.sources_used.map((x) => safeText(String(x || ""), 80)))
      : uniqueStrings([
          "dataset",
          "lead_scoring",
          meta?.engineDataset || "deterministic_dataset_engine",
        ]),

    merge_meta: merged.merge_meta && typeof merged.merge_meta === "object" ? merged.merge_meta : {},

    stage_meta: final.stage_meta && typeof final.stage_meta === "object" ? final.stage_meta : {},
    pipeline_meta: final.pipeline_meta && typeof final.pipeline_meta === "object" ? final.pipeline_meta : {},
    prospect_meta: final.prospect_meta && typeof final.prospect_meta === "object" ? final.prospect_meta : {},
    followup_meta: final.followup_meta && typeof final.followup_meta === "object" ? final.followup_meta : {},
    followup_plan: final.followup_plan && typeof final.followup_plan === "object" ? final.followup_plan : {},
    planner_meta: final.planner_meta && typeof final.planner_meta === "object" ? final.planner_meta : {},

    status_flags:
      final.status_flags && typeof final.status_flags === "object"
        ? final.status_flags
        : scored.status_flags && typeof scored.status_flags === "object"
          ? scored.status_flags
          : merged.status_flags && typeof merged.status_flags === "object"
            ? merged.status_flags
            : dataset.status_flags && typeof dataset.status_flags === "object"
              ? dataset.status_flags
              : {},

    bubble_metrics: bubbleMetrics,

    sop_signals:
      final.sop_signals && typeof final.sop_signals === "object"
        ? final.sop_signals
        : scored.sop_signals && typeof scored.sop_signals === "object"
          ? scored.sop_signals
          : merged.sop_signals && typeof merged.sop_signals === "object"
            ? merged.sop_signals
            : dataset.sop_signals && typeof dataset.sop_signals === "object"
              ? dataset.sop_signals
              : {},

    scoring_breakdown: Array.isArray(scored.scoring_breakdown)
      ? scored.scoring_breakdown
      : [],

    signal_summary:
      scored.signal_summary && typeof scored.signal_summary === "object"
        ? scored.signal_summary
        : {},

    scoring_meta:
      scored.scoring_meta && typeof scored.scoring_meta === "object"
        ? scored.scoring_meta
        : {},

    engine_dataset: safeText(
      meta?.engineDataset ||
        final.engine_dataset ||
        "deterministic_dataset_engine",
      80
    ),

    process_mode: processMode,
    analysis_mode: processMode,

    route_target: routeTarget,

    customer_bubble_count: toSafeNumber(bubbleMetrics.customer_bubble_count),
    agent_bubble_count: toSafeNumber(bubbleMetrics.agent_bubble_count),
    hours_since_last_customer_reply: toSafeNumber(
      crmState.hours_since_last_customer_reply
    ),
    hours_since_last_cs_action: toSafeNumber(
      crmState.hours_since_last_cs_action
    ),

    runtime_context: {
      ...crmState,
      process_mode: processMode,
      route_target: routeTarget,
    },
  };
}

function buildMinimalDatasetBase(latestCustomerText) {
  const localEmotion = normalizeLocalEmotionToAnalysis(latestCustomerText);
  const suggested =
    defaultSuggestions(latestCustomerText)[0] ||
    "kak boleh ceritain dulu kak lagi cari info harga, sample, legalitas, brand, atau progress order";

  return {
    ...DEFAULT_ANALYSIS,
    rule_id: "fallback_minimal",
    dataset_row_id: "fallback_minimal",
    dataset_row_label: "fallback_minimal",
    pipeline: "respons",
    priority: "medium",
    priority_level: "medium",
    prospect_type: "none",
    intent: "unknown",
    emotion: localEmotion,
    behaviour_stage: "curiosity",
    lead_level: "cold",
    lead_level_stage: "cold",
    conversion_rate_analyzed: 20,
    confidence_score: 20,
    cs_action: "Gali kebutuhan utama customer lalu arahkan ke gap terdekat dengan detail konkret.",
    suggested_response: suggested,
    suggested_reply: suggested,
    rule_source: "fallback_minimal",
    sources_used: ["fallback_minimal"],
    merge_meta: {},
    matched_patterns: [],
    matched_in: {
      latest: [],
      tail: [],
      summary: [],
    },
    sop_stage_current: DEFAULT_ANALYSIS.sop_stage_current,
    sop_stage_next: DEFAULT_ANALYSIS.sop_stage_next,
    followup_gap: "",
    status_flags: {},
    bubble_metrics: {},
    sop_signals: {},
  };
}

function buildNoMemoryAnalysis(latestCustomerText) {
  const base = buildMinimalDatasetBase(latestCustomerText);

  return {
    ...base,
    process_mode: PROCESS_MODES.incoming_customer_response,
    analysis_mode: PROCESS_MODES.incoming_customer_response,
    engine_dataset: "no_memory_minimal",
    route_target: ROUTE_TARGETS.respons,
    runtime_context: {},
  };
}

/* -----------------------------
   Utilities for runtime metrics
------------------------------ */
function findLatestMessageByRole(entries, role) {
  const arr = Array.isArray(entries) ? entries : [];
  const filtered = arr.filter((x) => x?.role === role).sort((a, b) => b.ts - a.ts);
  return filtered[0] || null;
}

function countMessagesByRole(entries, role) {
  const arr = Array.isArray(entries) ? entries : [];
  return arr.reduce((total, item) => total + (item?.role === role ? 1 : 0), 0);
}

function roundHours(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}

function parseTimestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value;
  }

  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    const asNumber = Number(trimmed);

    if (Number.isFinite(asNumber) && asNumber > 0) {
      return asNumber < 1e12 ? asNumber * 1000 : asNumber;
    }

    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function extractEntityIdFromConvKey(convKey) {
  const safe = safeText(convKey || "", 120);
  const match = safe.match(/lead:(\d+)/i);
  return match ? toSafeNumber(match[1]) : 0;
}

function getLooseBoolean(values) {
  const arr = Array.isArray(values) ? values : [values];

  for (const value of arr) {
    if (typeof value === "boolean") return value;

    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
    }

    if (typeof value === "string") {
      const raw = value.trim().toLowerCase();
      if (["1", "true", "yes", "y"].includes(raw)) return true;
      if (["0", "false", "no", "n"].includes(raw)) return false;
    }
  }

  return false;
}

/* -----------------------------
   Input / output compatibility
------------------------------ */
function containsAny(text, needles) {
  const hay = safeText(text || "", 800).toLowerCase();
  if (!hay) return false;

  return (Array.isArray(needles) ? needles : []).some((needle) =>
    hay.includes(String(needle || "").toLowerCase())
  );
}

/* -----------------------------
   Utilities used by dispatcher deps
------------------------------ */
function buildMinimalOrchestratedAnalysis(latestCustomerText, mode = PROCESS_MODES.incoming_customer_response) {
  const analysis = buildNoMemoryAnalysis(latestCustomerText);
  return {
    ...analysis,
    process_mode: mode,
    analysis_mode: mode,
  };
}

/* -----------------------------
   Output helpers / backward-compatible fallbacks
------------------------------ */
async function publishDirectSuggestedReply(env, {
  convKey,
  entityId,
  eventId,
  analysis,
  latestCustomerText,
  summary,
  tail,
}) {
  return publishSuggestedReplyChannels(
    env,
    buildSuggestedReplyPayload({
      convKey,
      entityId,
      eventId,
      analysis,
      latestCustomerText,
      summary,
      tail,
    })
  );
}

/* -----------------------------
   Legacy-compatible dispatcher helpers
------------------------------ */
function buildCompatibleLegacyAnalysis(analysis) {
  const safe = sanitizeCachedAnalysis(analysis) || buildMinimalOrchestratedAnalysis("", PROCESS_MODES.incoming_customer_response);

  return {
    rule_id: safe.rule_id,
    intent: safe.intent,
    emotion: safe.emotion,
    behaviour_stage: safe.behaviour_stage,
    lead_level_stage: safe.lead_level_stage,
    conversion_rate_analyzed: safe.conversion_rate_analyzed,
    cs_action: safe.cs_action,
    suggested_response: safe.suggested_response,
    confidence_score: safe.confidence_score,
    engine_dataset: safe.engine_dataset || "workflow_orchestrator",
    matched_patterns: safe.matched_patterns,
    matched_in: safe.matched_in,
    rule_source: safe.rule_source,
    sources_used: safe.sources_used,
    merge_meta: safe.merge_meta,
  };
}

/* -----------------------------
   Analysis fallback helpers
------------------------------ */
async function safeAddKommoNote(env, entityId, noteText) {
  if (!entityId) return;
  try {
    await kommoAddLeadNote(env, entityId, noteText);
  } catch (err) {
    console.error("safeAddKommoNote error:", err?.stack || String(err));
  }
}

/* -----------------------------
   Existing dispatcher compatibility
------------------------------ */
async function dispatchDirectWithoutDispatcher(env, {
  convKey,
  entityId,
  eventId,
  analysis,
  latestCustomerText,
  summary,
  tail,
}) {
  const noteText = formatNote(analysis);

  await Promise.allSettled([
    safeAddKommoNote(env, entityId, noteText),
    publishDirectSuggestedReply(env, {
      convKey,
      entityId,
      eventId,
      analysis,
      latestCustomerText,
      summary,
      tail,
    }),
  ]);
}

/* -----------------------------
   Final compatibility helpers
------------------------------ */
function normalizeTagToken(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

/* -----------------------------
   Utility helpers
------------------------------ */
function inferCustomerBubbleCount(input = {}) {
  const transcript = String(input.tail || input.recent_chat_history || "");
  if (!transcript) return 0;
  const matches = transcript.match(/(^|\n)\s*customer\s*:/gi);
  return Array.isArray(matches) ? matches.length : 0;
}

function inferAgentBubbleCount(input = {}) {
  const transcript = String(input.tail || input.recent_chat_history || "");
  if (!transcript) return 0;
  const matches = transcript.match(/(^|\n)\s*agent\s*:/gi);
  return Array.isArray(matches) ? matches.length : 0;
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function toSafeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * @param {any} value
 * @returns {Record<string, any>}
 */
function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}