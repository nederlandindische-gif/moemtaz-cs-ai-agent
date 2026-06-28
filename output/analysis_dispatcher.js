// output/analysis_dispatcher.js

import { kommoAddLeadNote } from "../kommo/kommo_api.js";

import { safeText } from "../utils/text.js";
import { logKommoDebug, getBooleanEnv } from "../utils/env.js";
import { sha1 } from "../utils/crypto.js";

import { formatNote } from "../formatters/note_formatter.js";

import {
  buildSuggestedReplyPayload,
  publishSuggestedReplyChannels,
} from "./suggested_reply_service.js";

/**
 * @typedef {Record<string, any>} AnyRecord
 */

/**
 * @typedef {{
 *   noteHashKey: (convKey: string, eventId: string) => string,
 *   suggestReplyHashKey: (convKey: string, eventId: string) => string,
 *   getNoteHashTtlSeconds: (env: AnyRecord) => number,
 *   getSuggestReplyHashTtlSeconds: (env: AnyRecord) => number,
 *   hasPerEventHash: (env: AnyRecord, key: string, hash: string) => Promise<boolean>,
 *   rememberPerEventHash: (
 *     env: AnyRecord,
 *     key: string,
 *     hash: string,
 *     ttlSeconds: number,
 *     priority?: string
 *   ) => Promise<void>,
 *   saveLastAnalysisCache: (
 *     env: AnyRecord,
 *     convKey: string,
 *     payload: {
 *       eventId: string,
 *       analysis: AnyRecord,
 *       latestCustomerText: string,
 *       summary: string,
 *       tail: string
 *     }
 *   ) => Promise<void>,
 *   buildRuntimeContext: (
 *     env: AnyRecord,
 *     payload: { convKey: string, fallbackCustomerText?: string }
 *   ) => Promise<{
 *     latestCustomerText: string,
 *     tail: string,
 *     summary: string,
 *     lastAnalysis: AnyRecord | null,
 *     crmState?: AnyRecord,
 *     processMode?: string,
 *     metrics?: AnyRecord
 *   }>,
 *   analyzeLeadOneCall: (
 *     env: AnyRecord,
 *     ctx: {
 *       convKey: string,
 *       summary: string,
 *       tail: string,
 *       latestCustomerText: string,
 *       lastAnalysis: AnyRecord | null,
 *       crmState?: AnyRecord,
 *       processMode?: string,
 *       metrics?: AnyRecord
 *     }
 *   ) => Promise<AnyRecord | null>,
 *   buildMinimalDatasetBase: (latestCustomerText: string) => AnyRecord,
 * }} AnalysisDispatcherDeps
 */

/**
 * Main analysis note default dimatikan.
 * Aktifkan jika memang perlu:
 * KOMMO_MAIN_ANALYSIS_NOTE_ENABLED=true
 *
 * @param {AnyRecord} env
 * @returns {boolean}
 */
export function shouldSendMainAnalysisNote(env) {
  return getBooleanEnv(env, "KOMMO_MAIN_ANALYSIS_NOTE_ENABLED", false);
}

/**
 * @param {AnyRecord} env
 * @param {string} key
 * @param {string} hash
 * @param {number} ttlSeconds
 * @param {AnalysisDispatcherDeps} deps
 * @param {AnyRecord} meta
 * @returns {Promise<void>}
 */
async function rememberHashBestEffort(env, key, hash, ttlSeconds, deps, meta = {}) {
  try {
    await deps.rememberPerEventHash(env, key, hash, ttlSeconds);
  } catch (err) {
    logKommoDebug(env, "KOMMO_HASH_REMEMBER_SKIPPED", {
      ...meta,
      key: safeText(key || "", 180),
      error_message: safeText(err?.message || String(err), 300),
    });
  }
}

/**
 * @param {AnyRecord} env
 * @param {string} key
 * @param {string} hash
 * @param {AnalysisDispatcherDeps} deps
 * @param {AnyRecord} meta
 * @returns {Promise<boolean>}
 */
async function hasHashBestEffort(env, key, hash, deps, meta = {}) {
  try {
    return Boolean(await deps.hasPerEventHash(env, key, hash));
  } catch (err) {
    logKommoDebug(env, "KOMMO_HASH_CHECK_SKIPPED", {
      ...meta,
      key: safeText(key || "", 180),
      error_message: safeText(err?.message || String(err), 300),
    });
    return false;
  }
}

/**
 * @param {AnyRecord} env
 * @param {number} entityId
 * @param {string} noteText
 * @returns {Promise<boolean>}
 */
async function sendKommoLeadNoteBestEffort(env, entityId, noteText) {
  try {
    return Boolean(await kommoAddLeadNote(env, entityId, noteText));
  } catch (err) {
    logKommoDebug(env, "KOMMO_ANALYSIS_NOTE_SEND_ERROR", {
      entity_id: entityId,
      error_message: safeText(err?.message || String(err), 300),
    });
    return false;
  }
}

/**
 * @param {AnyRecord | null | undefined} analysis
 * @returns {AnyRecord}
 */
function buildAnalysisLogSnapshot(analysis) {
  const a = analysis && typeof analysis === "object" ? analysis : {};

  return {
    rule_id: safeText(a.rule_id || "", 120),
    dataset_row_id: safeText(a.dataset_row_id || "", 120),
    dataset_row_label: safeText(a.dataset_row_label || "", 180),
    rule_source: safeText(a.rule_source || "", 80),
    engine_dataset: safeText(a.engine_dataset || "", 80),

    intent: safeText(a.intent || "", 80),
    emotion: safeText(a.emotion || "", 80),
    behaviour_stage: safeText(a.behaviour_stage || "", 80),
    lead_level: safeText(a.lead_level || a.lead_level_stage || "", 80),

    pipeline: safeText(a.pipeline || "", 80),
    priority: safeText(a.priority || a.priority_level || "", 80),
    prospect_type: safeText(a.prospect_type || "", 80),

    sop_stage_current: safeText(a.sop_stage_current || "", 80),
    sop_stage_next: safeText(a.sop_stage_next || "", 80),

    followup_gap_preview: safeText(a.followup_gap || "", 220),
    cs_action_preview: safeText(a.cs_action || "", 220),
    suggested_response_preview: safeText(
      a.suggested_response || a.suggested_reply || "",
      220
    ),

    conversion_rate_analyzed: Number(a.conversion_rate_analyzed || 0),
    confidence_score: Number(a.confidence_score || 0),

    route_target: safeText(a.route_target || "", 120),
    plan_type_final: safeText(a.plan_type_final || "", 120),
    execute_mode_final: safeText(a.execute_mode_final || "", 80),
    next_required_artifact: safeText(a.next_required_artifact || "", 120),
    note_publish_strategy: safeText(a.note_publish_strategy || "", 80),
  };
}

/**
 * Snapshot canonical khusus untuk jalur suggested reply.
 * @param {AnyRecord | null | undefined} payload
 * @returns {AnyRecord}
 */
function buildSuggestedReplyLogSnapshot(payload) {
  const a = payload && typeof payload === "object" ? payload : {};

  return {
    pipeline: safeText(a.pipeline || "", 80),
    prospect_type: safeText(a.prospect_type || "", 80),
    priority: safeText(a.priority || a.priority_level || "", 80),
    sop_stage_current: safeText(a.sop_stage_current || "", 80),
    sop_stage_next: safeText(a.sop_stage_next || "", 80),

    route_target: safeText(a.route_target || "", 120),
    plan_type_final: safeText(a.plan_type_final || "", 120),
    execute_mode_final: safeText(a.execute_mode_final || "", 80),
    note_publish_strategy: safeText(a.note_publish_strategy || "", 80),

    next_required_artifact: safeText(a.next_required_artifact || "", 120),
    required_artifacts_final_count: Array.isArray(a.required_artifacts_final)
      ? a.required_artifacts_final.length
      : 0,

    confidence_score: Number(a.confidence_score || 0),
    suggested_response_preview: safeText(a.suggested_response || "", 220),
    cs_action_preview: safeText(a.cs_action || "", 220),
  };
}

/**
 * @param {AnyRecord | null | undefined} payload
 * @returns {AnyRecord}
 */
function buildRuntimeLogSnapshot(payload) {
  const p = payload && typeof payload === "object" ? payload : {};

  return {
    process_mode: safeText(p.processMode || "", 80),
    customer_bubble_count: Number(p.metrics?.customer_bubble_count || 0),
    agent_bubble_count: Number(p.metrics?.agent_bubble_count || 0),
    hours_since_last_customer_reply: Number(p.metrics?.hours_since_last_customer_reply || 0),
    hours_since_last_cs_action: Number(p.metrics?.hours_since_last_cs_action || 0),
    has_form_sent: Boolean(p.crmState?.has_form_sent),
    has_form_filled: Boolean(p.crmState?.has_form_filled),
    has_dp_paid: Boolean(p.crmState?.has_dp_paid),
    has_invoice_sent: Boolean(p.crmState?.has_invoice_sent),
    has_product_proof_sent: Boolean(p.crmState?.has_product_proof_sent),
    has_resi_sent: Boolean(p.crmState?.has_resi_sent),
    is_post_payment: Boolean(p.crmState?.is_post_payment),
    is_at_risk: Boolean(p.crmState?.is_at_risk),
    brand_channel: safeText(p.crmState?.brand_channel || "", 80),
  };
}

/**
 * @param {AnyRecord} env
 * @param {string} convKey
 * @param {number} entityId
 * @param {string} eventId
 * @param {string} noteText
 * @param {string} dispatchReason
 * @param {AnalysisDispatcherDeps} deps
 * @returns {Promise<void>}
 */
async function maybeSendMainAnalysisNote(
  env,
  convKey,
  entityId,
  eventId,
  noteText,
  dispatchReason,
  deps
) {
  const mainAnalysisNoteEnabled = shouldSendMainAnalysisNote(env);

  if (!mainAnalysisNoteEnabled) {
    logKommoDebug(env, "KOMMO_ANALYSIS_NOTE_DISABLED", {
      conv_key: convKey,
      entity_id: entityId,
      event_id: eventId,
      dispatch_reason: dispatchReason,
      reason: "main_analysis_note_disabled",
    });
    return;
  }

  const noteHash = await sha1(noteText);
  const noteHashKey = deps.noteHashKey(convKey, eventId);

  const alreadySent = await hasHashBestEffort(
    env,
    noteHashKey,
    noteHash,
    deps,
    {
      conv_key: convKey,
      entity_id: entityId,
      event_id: eventId,
      dispatch_reason: dispatchReason,
      hash_type: "main_analysis_note",
    }
  );

  if (alreadySent) {
    logKommoDebug(env, "KOMMO_ANALYSIS_NOTE_SKIPPED", {
      conv_key: convKey,
      entity_id: entityId,
      event_id: eventId,
      dispatch_reason: dispatchReason,
      reason: "per_event_note_hash_duplicate",
    });
    return;
  }

  const noteOk = await sendKommoLeadNoteBestEffort(env, entityId, noteText);

  logKommoDebug(env, "KOMMO_ANALYSIS_NOTE_RESULT", {
    conv_key: convKey,
    entity_id: entityId,
    event_id: eventId,
    dispatch_reason: dispatchReason,
    note_ok: noteOk,
  });

  if (!noteOk) return;

  await rememberHashBestEffort(
    env,
    noteHashKey,
    noteHash,
    deps.getNoteHashTtlSeconds(env),
    deps,
    {
      conv_key: convKey,
      entity_id: entityId,
      event_id: eventId,
      dispatch_reason: dispatchReason,
      hash_type: "main_analysis_note",
    }
  );
}

/**
 * @param {AnyRecord} env
 * @param {string} convKey
 * @param {number} entityId
 * @param {string} eventId
 * @param {AnyRecord} analysis
 * @param {string} latestCustomerText
 * @param {string} summary
 * @param {string} tail
 * @param {string} dispatchReason
 * @param {AnalysisDispatcherDeps} deps
 * @returns {Promise<void>}
 */
async function maybePublishSuggestedReply(
  env,
  convKey,
  entityId,
  eventId,
  analysis,
  latestCustomerText,
  summary,
  tail,
  dispatchReason,
  deps
) {
  try {
    logKommoDebug(env, "KOMMO_SUGGEST_REPLY_BUILD_START", {
      conv_key: convKey,
      entity_id: entityId,
      event_id: eventId,
      dispatch_reason: dispatchReason,
      latest_customer_text_len: safeText(latestCustomerText || "", 2000).length,
      summary_len: safeText(summary || "", 2000).length,
      tail_len: safeText(tail || "", 4000).length,
    });

    const suggestPayload = buildSuggestedReplyPayload({
      convKey,
      entityId,
      eventId,
      analysis,
      latestCustomerText,
      summary,
      tail,
    });

    logKommoDebug(env, "KOMMO_SUGGEST_REPLY_PAYLOAD_READY", {
      conv_key: convKey,
      entity_id: entityId,
      event_id: eventId,
      dispatch_reason: dispatchReason,
      payload_note_publish_strategy: safeText(suggestPayload?.note_publish_strategy || "", 80),
      payload_route_target: safeText(suggestPayload?.route_target || "", 120),
      payload_plan_type_final: safeText(suggestPayload?.plan_type_final || "", 120),
      payload_execute_mode_final: safeText(suggestPayload?.execute_mode_final || "", 80),
      payload_next_required_artifact: safeText(suggestPayload?.next_required_artifact || "", 120),
      payload_required_artifacts_final_count: Array.isArray(suggestPayload?.required_artifacts_final)
        ? suggestPayload.required_artifacts_final.length
        : 0,
      suggested_response_len: safeText(suggestPayload?.suggested_response || "", 2000).length,
      cs_action_len: safeText(suggestPayload?.cs_action || "", 2000).length,
      ...buildSuggestedReplyLogSnapshot(suggestPayload),
    });

    const suggestHash = await sha1(JSON.stringify(suggestPayload));
    const suggestHashKey = deps.suggestReplyHashKey(convKey, eventId);

    const suggestAlreadySent = await hasHashBestEffort(
      env,
      suggestHashKey,
      suggestHash,
      deps,
      {
        conv_key: convKey,
        entity_id: entityId,
        event_id: eventId,
        dispatch_reason: dispatchReason,
        hash_type: "suggested_reply",
      }
    );

    if (suggestAlreadySent) {
      logKommoDebug(env, "KOMMO_SUGGEST_REPLY_SKIPPED", {
        conv_key: convKey,
        entity_id: entityId,
        event_id: eventId,
        dispatch_reason: dispatchReason,
        reason: "per_event_suggest_hash_duplicate",
        ...buildSuggestedReplyLogSnapshot(suggestPayload),
      });
      return;
    }

    const suggestResult = await publishSuggestedReplyChannels(env, suggestPayload);

    logKommoDebug(env, "KOMMO_SUGGEST_REPLY_RESULT", {
      conv_key: convKey,
      entity_id: entityId,
      event_id: eventId,
      dispatch_reason: dispatchReason,
      sent_any: Boolean(suggestResult?.sentAny),
      mem_saved: Boolean(suggestResult?.memSaved),
      webhook_sent: Boolean(suggestResult?.webhookSent),
      kommo_note_sent: Boolean(suggestResult?.kommoNoteSent),
      kommo_field_sent: Boolean(suggestResult?.kommoFieldSent),
      kommo_analysis_note_sent: Boolean(suggestResult?.kommoAnalysisNoteSent),
      kommo_content_note_sent: Boolean(suggestResult?.kommoContentNoteSent),
      ...buildSuggestedReplyLogSnapshot(suggestPayload),
    });

    if (!suggestResult?.sentAny) return;

    await rememberHashBestEffort(
      env,
      suggestHashKey,
      suggestHash,
      deps.getSuggestReplyHashTtlSeconds(env),
      deps,
      {
        conv_key: convKey,
        entity_id: entityId,
        event_id: eventId,
        dispatch_reason: dispatchReason,
        hash_type: "suggested_reply",
      }
    );
  } catch (err) {
    logKommoDebug(env, "KOMMO_SUGGEST_REPLY_FATAL", {
      conv_key: convKey,
      entity_id: entityId,
      event_id: eventId,
      dispatch_reason: dispatchReason,
      error_message: safeText(err?.message || String(err), 300),
      ...buildAnalysisLogSnapshot(analysis),
    });
    throw err;
  }
}

/**
 * @param {AnyRecord} env
 * @param {string} convKey
 * @param {{
 *   eventId: string,
 *   analysis: AnyRecord,
 *   latestCustomerText: string,
 *   summary: string,
 *   tail: string
 * }} payload
 * @param {AnalysisDispatcherDeps} deps
 * @param {AnyRecord} meta
 * @returns {Promise<void>}
 */
async function saveLastAnalysisCacheBestEffort(env, convKey, payload, deps, meta = {}) {
  try {
    await deps.saveLastAnalysisCache(env, convKey, payload);
  } catch (err) {
    logKommoDebug(env, "KOMMO_LAST_ANALYSIS_CACHE_SKIPPED", {
      ...meta,
      conv_key: convKey,
      error_message: safeText(err?.message || String(err), 300),
    });
  }
}

/**
 * @param {AnyRecord} env
 * @param {string} convKey
 * @param {number} entityId
 * @param {string} eventId
 * @param {string} fallbackNoteText
 * @param {string} dispatchReason
 * @returns {Promise<void>}
 */
async function sendSuggestedReplyFailureFallbackNote(
  env,
  convKey,
  entityId,
  eventId,
  fallbackNoteText,
  dispatchReason
) {
  const noteText = safeText(fallbackNoteText || "", 5000);
  if (!noteText) return;

  const fallbackNoteOk = await sendKommoLeadNoteBestEffort(env, entityId, noteText);

  logKommoDebug(env, "KOMMO_SUGGEST_REPLY_FALLBACK_NOTE_RESULT", {
    conv_key: convKey,
    entity_id: entityId,
    event_id: eventId,
    dispatch_reason: dispatchReason,
    fallback_note_ok: Boolean(fallbackNoteOk),
  });
}

/**
 * @param {AnyRecord} env
 * @param {{
 *   convKey: string,
 *   entityId: number,
 *   eventId: string,
 *   analysis: AnyRecord,
 *   latestCustomerText: string,
 *   summary: string,
 *   tail: string,
 *   noteText?: string,
 *   dispatchReason?: string,
 *   processMode?: string,
 *   crmState?: AnyRecord,
 *   metrics?: AnyRecord
 * }} params
 * @param {AnalysisDispatcherDeps} deps
 * @returns {Promise<void>}
 */
export async function dispatchAnalysisOutputs(
  env,
  {
    convKey,
    entityId,
    eventId,
    analysis,
    latestCustomerText,
    summary,
    tail,
    noteText,
    dispatchReason = "normal",
    processMode = "",
    crmState = {},
    metrics = {},
  },
  deps
) {
  const safeNoteText = safeText(noteText || formatNote(analysis), 5000);

  logKommoDebug(env, "KOMMO_ANALYSIS_DISPATCH", {
    conv_key: convKey,
    entity_id: entityId,
    event_id: eventId,
    dispatch_reason: dispatchReason,
    main_analysis_note_enabled: shouldSendMainAnalysisNote(env),
    ...buildAnalysisLogSnapshot(analysis),
    ...buildRuntimeLogSnapshot({
      processMode,
      crmState,
      metrics,
    }),
  });

  await maybeSendMainAnalysisNote(
    env,
    convKey,
    entityId,
    eventId,
    safeNoteText,
    dispatchReason,
    deps
  );

  try {
    await maybePublishSuggestedReply(
      env,
      convKey,
      entityId,
      eventId,
      analysis,
      latestCustomerText,
      summary,
      tail,
      dispatchReason,
      deps
    );
  } catch (err) {
    logKommoDebug(env, "KOMMO_SUGGEST_REPLY_FATAL_HANDLED", {
      conv_key: convKey,
      entity_id: entityId,
      event_id: eventId,
      dispatch_reason: dispatchReason,
      error_message: safeText(err?.message || String(err), 300),
      fallback_note_attempted: !shouldSendMainAnalysisNote(env),
    });

    if (!shouldSendMainAnalysisNote(env)) {
      await sendSuggestedReplyFailureFallbackNote(
        env,
        convKey,
        entityId,
        eventId,
        safeNoteText,
        `${dispatchReason}_suggest_reply_fallback`
      );
    }
  }

  await saveLastAnalysisCacheBestEffort(
    env,
    convKey,
    {
      eventId,
      analysis,
      latestCustomerText,
      summary,
      tail,
    },
    deps,
    {
      entity_id: entityId,
      event_id: eventId,
      dispatch_reason: dispatchReason,
    }
  );
}

/**
 * @param {AnyRecord} env
 * @param {{
 *   convKey: string,
 *   entityId: number,
 *   eventId: string,
 *   fallbackCustomerText?: string,
 *   dispatchReason?: string,
 *   processMode?: string,
 *   crmState?: AnyRecord,
 *   metrics?: AnyRecord
 * }} params
 * @param {AnalysisDispatcherDeps} deps
 * @returns {Promise<void>}
 */
export async function dispatchFallbackAnalysisOutputs(
  env,
  {
    convKey,
    entityId,
    eventId,
    fallbackCustomerText = "",
    dispatchReason = "fallback",
    processMode = "",
    crmState = {},
    metrics = {},
  },
  deps
) {
  try {
    const runtime = await deps.buildRuntimeContext(env, {
      convKey,
      fallbackCustomerText,
    });

    let analysis = null;

    if (runtime.lastAnalysis) {
      analysis = runtime.lastAnalysis;
    }

    if (!analysis) {
      try {
        analysis = await deps.analyzeLeadOneCall(env, {
          convKey,
          summary: runtime.summary,
          tail: runtime.tail,
          latestCustomerText: runtime.latestCustomerText,
          lastAnalysis: runtime.lastAnalysis,
          crmState: runtime.crmState || crmState,
          processMode: runtime.processMode || processMode,
          metrics: runtime.metrics || metrics,
        });
      } catch (analysisErr) {
        console.error(
          "dispatchFallbackAnalysisOutputs analyze error:",
          analysisErr?.stack || String(analysisErr)
        );
      }
    }

    if (!analysis) {
      analysis = deps.buildMinimalDatasetBase(
        runtime.latestCustomerText || fallbackCustomerText
      );
    }

    await dispatchAnalysisOutputs(
      env,
      {
        convKey,
        entityId,
        eventId,
        analysis,
        latestCustomerText: runtime.latestCustomerText || fallbackCustomerText,
        summary: runtime.summary || "-",
        tail: runtime.tail || "-",
        noteText: formatNote(analysis),
        dispatchReason,
        processMode: runtime.processMode || processMode,
        crmState: runtime.crmState || crmState,
        metrics: runtime.metrics || metrics,
      },
      deps
    );
  } catch (err) {
    console.error("dispatchFallbackAnalysisOutputs error:", err?.stack || String(err));

    try {
      const minimalText = safeText(fallbackCustomerText, 600);
      const minimalAnalysis = deps.buildMinimalDatasetBase(minimalText);

      await dispatchAnalysisOutputs(
        env,
        {
          convKey,
          entityId,
          eventId,
          analysis: minimalAnalysis,
          latestCustomerText: minimalText,
          summary: minimalText ? `• Pesan terbaru: ${safeText(minimalText, 120)}` : "-",
          tail: minimalText ? `Customer: ${safeText(minimalText, 300)}` : "-",
          noteText: formatNote(minimalAnalysis),
          dispatchReason: `${dispatchReason}_minimal`,
          processMode,
          crmState,
          metrics,
        },
        deps
      );
    } catch (minimalErr) {
      console.error(
        "dispatchFallbackAnalysisOutputs minimal error:",
        minimalErr?.stack || String(minimalErr)
      );
    }
  }
}