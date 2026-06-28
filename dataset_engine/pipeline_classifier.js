// dataset_engine/pipeline_classifier.js

import {
  DEFAULT_ANALYSIS,
  normalizeAnalysisTaxonomy,
  normalizeBehaviourStage,
  normalizeBrandChannel,
  normalizeEmotion,
  normalizeIntent,
  normalizeLeadLevel,
  normalizePipeline,
  normalizePriorityLevel,
  normalizeProspectType,
  normalizeSopStage,
} from "./rules.js";
import {
  detectDatasetPattern,
  buildDatasetBaseFromDetection,
} from "./pattern_detection.js";
import { calculateLeadScore } from "./lead_scoring.js";
import {
  mergeAnalysis,
  mergeAnalysisLayers,
} from "./merge_analysis.js";

/**
 * @typedef {Record<string, any>} LooseRecord
 */

/* ---------------------------------
   Route targets
---------------------------------- */
export const ROUTE_TARGETS = Object.freeze({
  no_respons: "no_respons_followup_composer",
  respons: "respons_qualification_composer",
  prospek: "prospek_closing_composer",
});

const DEFAULT_PIPELINE_META = Object.freeze({
  route_target: ROUTE_TARGETS.respons,
  route_reason: "pipeline_respons",
  resolved_by: "pipeline_classifier",
  source: "pipeline_classifier",
});

const EMPTY_MATCHED_IN = Object.freeze({
  latest: [],
  tail: [],
  summary: [],
});

/* ---------------------------------
   Public API
---------------------------------- */

/**
 * Layer baca untuk pipeline:
 * - percaya pada final result dari merge_analysis.js
 * - hanya memastikan pipeline valid
 * - hanya menentukan route target
 *
 * Tidak menjadi resolver ulang untuk:
 * - intent
 * - emotion
 * - lead_level
 * - priority
 * - prospect_type
 *
 * @param {LooseRecord | null | undefined} input
 * @returns {LooseRecord}
 */
export function classifyPipeline(input = {}) {
  const safeInput = toRecord(input);
  const context = sanitizeClassifierContext(safeInput);
  const assembled = assembleClassificationSources(safeInput, context);
  const normalizedFinal = normalizePipelineResult(
    assembled.finalAnalysis,
    context
  );

  const pipeline = normalizePipeline(
    normalizedFinal.pipeline || DEFAULT_ANALYSIS.pipeline
  );
  const routeTarget = resolvePipelineRouteTarget(pipeline);
  const routeReason = resolveRouteReason(normalizedFinal, pipeline);

  return {
    ...normalizedFinal,
    pipeline,
    pipeline_meta: {
      ...DEFAULT_PIPELINE_META,
      ...sanitizePlainObject(normalizedFinal.pipeline_meta),
      route_target: routeTarget,
      route_reason: routeReason,
      resolved_by: "pipeline_classifier",
      source: assembled.source,
    },
    detection_meta: sanitizePlainObject(normalizedFinal.detection_meta),
  };
}

/**
 * Klasifikasi dari final analysis yang sudah jadi.
 * Cocok dipakai jika merge_analysis.js sudah dipanggil di layer sebelumnya.
 *
 * @param {LooseRecord | null | undefined} finalAnalysis
 * @param {LooseRecord | null | undefined} options
 * @returns {LooseRecord}
 */
export function classifyPipelineFromFinalAnalysis(finalAnalysis = {}, options = {}) {
  const safeOptions = toRecord(options);
  return classifyPipeline({
    ...safeOptions,
    finalAnalysis: toRecord(finalAnalysis),
  });
}

/**
 * Helper orchestration tipis:
 * pattern_detection -> lead_scoring -> merge_analysis -> pipeline route
 *
 * Penting:
 * file ini tidak mengubah keputusan bisnis final,
 * hanya membangun sumber jika belum ada dan memetakan pipeline ke route target.
 *
 * @param {LooseRecord | null | undefined} input
 * @returns {LooseRecord}
 */
export function buildPipelineClassificationBundle(input = {}) {
  const safeInput = toRecord(input);
  const context = sanitizeClassifierContext(safeInput);

  const detection =
    safeInput.detection && typeof safeInput.detection === "object"
      ? safeInput.detection
      : detectDatasetPattern(buildDetectionContext(context));

  const datasetBase =
    safeInput.datasetBase && typeof safeInput.datasetBase === "object"
      ? safeInput.datasetBase
      : detection?.dataset_base || buildDatasetBaseFromDetection(detection);

  const scoredAnalysis =
    safeInput.scoredAnalysis && typeof safeInput.scoredAnalysis === "object"
      ? safeInput.scoredAnalysis
      : calculateLeadScore({
          ...buildDetectionContext(context),
          detection,
          datasetBase,
        });

  const final = classifyPipeline({
    ...safeInput,
    ...context,
    detection,
    datasetBase,
    scoredAnalysis,
  });

  return {
    context,
    detection,
    datasetBase,
    scoredAnalysis,
    final,
  };
}

export function resolvePipelineRouteTarget(pipeline) {
  const normalized = normalizePipeline(pipeline);
  return ROUTE_TARGETS[normalized] || ROUTE_TARGETS.respons;
}

/* ---------------------------------
   Internal: source assembly
---------------------------------- */

/**
 * @param {LooseRecord | null | undefined} input
 * @param {LooseRecord | null | undefined} context
 * @returns {LooseRecord}
 */
function assembleClassificationSources(input = {}, context = {}) {
  const safeInput = toRecord(input);
  const safeContext = toRecord(context);

  if (safeInput.finalAnalysis && typeof safeInput.finalAnalysis === "object") {
    return {
      source: "provided_final_analysis",
      finalAnalysis: safeInput.finalAnalysis,
      detection:
        safeInput.detection && typeof safeInput.detection === "object"
          ? safeInput.detection
          : null,
      datasetBase:
        safeInput.datasetBase && typeof safeInput.datasetBase === "object"
          ? safeInput.datasetBase
          : null,
      scoredAnalysis:
        safeInput.scoredAnalysis && typeof safeInput.scoredAnalysis === "object"
          ? safeInput.scoredAnalysis
          : null,
    };
  }

  const detection =
    safeInput.detection && typeof safeInput.detection === "object"
      ? safeInput.detection
      : detectDatasetPattern(buildDetectionContext(safeContext));

  const datasetBase =
    safeInput.datasetBase && typeof safeInput.datasetBase === "object"
      ? safeInput.datasetBase
      : detection?.dataset_base || buildDatasetBaseFromDetection(detection);

  const scoredAnalysis =
    safeInput.scoredAnalysis && typeof safeInput.scoredAnalysis === "object"
      ? safeInput.scoredAnalysis
      : calculateLeadScore({
          ...buildDetectionContext(safeContext),
          detection,
          datasetBase,
        });

  const finalAnalysis = buildMergedFinalAnalysis({
    ...safeInput,
    crmState: safeInput.crmState || safeContext,
    detection,
    datasetBase,
    scoredAnalysis,
  });

  return {
    source: "merge_analysis",
    finalAnalysis,
    detection,
    datasetBase,
    scoredAnalysis,
  };
}

/**
 * @param {LooseRecord | null | undefined} input
 * @returns {LooseRecord}
 */
function buildMergedFinalAnalysis(input = {}) {
  const safeInput = toRecord(input);
  const hasSingleAI =
    safeInput.aiAnalysis && typeof safeInput.aiAnalysis === "object";

  if (
    hasSingleAI &&
    !safeInput.primaryAnalysis &&
    !safeInput.fallbackOneAnalysis &&
    !safeInput.fallbackTwoAnalysis
  ) {
    return mergeAnalysis({
      datasetBase: safeInput.datasetBase,
      scoredAnalysis: safeInput.scoredAnalysis,
      aiAnalysis: safeInput.aiAnalysis,
      source: safeInput.source || "ai",
      lastAnalysis: safeInput.lastAnalysis || null,
      crmState: safeInput.crmState || safeInput,
    });
  }

  return mergeAnalysisLayers({
    datasetBase: safeInput.datasetBase,
    scoredAnalysis: safeInput.scoredAnalysis,
    primaryAnalysis: safeInput.primaryAnalysis || null,
    fallbackOneAnalysis: safeInput.fallbackOneAnalysis || null,
    fallbackTwoAnalysis: safeInput.fallbackTwoAnalysis || null,
    lastAnalysis: safeInput.lastAnalysis || null,
    crmState: safeInput.crmState || safeInput,
  });
}

/* ---------------------------------
   Internal: normalization
---------------------------------- */

/**
 * @param {LooseRecord | null | undefined} input
 * @returns {LooseRecord}
 */
function sanitizeClassifierContext(input = {}) {
  const src = toRecord(input);

  const latestCustomerText = safeString(
    src.latestCustomerText || src.customer_message || ""
  );
  const tail = safeString(src.tail || src.recent_chat_history || "");
  const summary = safeString(src.summary || "");

  return {
    latestCustomerText,
    customer_message: latestCustomerText,
    tail,
    recent_chat_history: tail,
    summary,
    brand_channel: normalizeBrandChannel(src.brand_channel),
    last_cs_action: safeString(src.last_cs_action || ""),
    has_form_sent: Boolean(src.has_form_sent),
    has_form_filled: Boolean(src.has_form_filled),
    has_dp_paid: Boolean(src.has_dp_paid),
    has_invoice_sent: Boolean(src.has_invoice_sent),
    has_product_proof_sent: Boolean(src.has_product_proof_sent),
    has_resi_sent: Boolean(src.has_resi_sent),
    is_post_payment: Boolean(src.is_post_payment),
    is_at_risk: Boolean(src.is_at_risk),
    customer_bubble_count: toSafeNumber(src.customer_bubble_count),
    customer_bubble_gt_5: Boolean(
      src.customer_bubble_gt_5 || toSafeNumber(src.customer_bubble_count) > 5
    ),
  };
}

/**
 * @param {LooseRecord | null | undefined} context
 * @returns {LooseRecord}
 */
function buildDetectionContext(context = {}) {
  const src = toRecord(context);

  return {
    latestCustomerText: safeString(src.latestCustomerText || src.customer_message || ""),
    tail: safeString(src.tail || src.recent_chat_history || ""),
    summary: safeString(src.summary || ""),
  };
}

/**
 * @param {LooseRecord | null | undefined} input
 * @param {LooseRecord | null | undefined} context
 * @returns {LooseRecord}
 */
function normalizePipelineResult(input = {}, context = {}) {
  const raw = toRecord(input);
  const safeContext = toRecord(context);
  const normalized = toRecord(normalizeAnalysisTaxonomy(raw));

  const leadLevel = normalizeLeadLevel(
    raw.lead_level || raw.lead_level_stage || normalized.lead_level_stage
  );

  const priority = normalizePriorityLevel(
    raw.priority || raw.priority_level || normalized.priority || DEFAULT_ANALYSIS.priority
  );

  const suggestedReply = safeString(
    raw.suggested_reply ||
      raw.suggested_response ||
      normalized.suggested_reply ||
      DEFAULT_ANALYSIS.suggested_reply
  );

  return {
    ...DEFAULT_ANALYSIS,
    ...raw,
    ...normalized,

    brand_channel: normalizeBrandChannel(
      raw.brand_channel || safeContext.brand_channel || "unknown"
    ),

    pipeline: normalizePipeline(
      raw.pipeline || normalized.pipeline || DEFAULT_ANALYSIS.pipeline
    ),

    lead_level: leadLevel,
    lead_level_stage: leadLevel,

    emotion: normalizeEmotion(
      raw.emotion || normalized.emotion || DEFAULT_ANALYSIS.emotion
    ),

    intent: normalizeIntent(
      raw.intent || normalized.intent || DEFAULT_ANALYSIS.intent
    ),

    behaviour_stage: normalizeBehaviourStage(
      raw.behaviour_stage ||
        raw.behavior_stage ||
        normalized.behaviour_stage ||
        DEFAULT_ANALYSIS.behaviour_stage
    ),

    customer_profile: safeString(
      raw.customer_profile || normalized.customer_profile || DEFAULT_ANALYSIS.customer_profile
    ),

    sop_stage_current: normalizeSopStage(
      raw.sop_stage_current ||
        normalized.sop_stage_current ||
        DEFAULT_ANALYSIS.sop_stage_current
    ),

    sop_stage_next: normalizeSopStage(
      raw.sop_stage_next ||
        normalized.sop_stage_next ||
        DEFAULT_ANALYSIS.sop_stage_next
    ),

    followup_gap: safeString(
      raw.followup_gap || normalized.followup_gap || DEFAULT_ANALYSIS.followup_gap
    ),

    priority,
    priority_level: priority,

    prospect_type: normalizeProspectType(
      raw.prospect_type || normalized.prospect_type || DEFAULT_ANALYSIS.prospect_type
    ),

    cs_action: safeString(
      raw.cs_action || normalized.cs_action || DEFAULT_ANALYSIS.cs_action
    ),

    suggested_reply: suggestedReply,
    suggested_response: suggestedReply,

    tag_emotion: safeString(
      raw.tag_emotion || normalized.tag_emotion || normalizeTag(raw.emotion || normalized.emotion)
    ),

    tag_stage: safeString(
      raw.tag_stage ||
        normalized.tag_stage ||
        normalizeTag(raw.behaviour_stage || normalized.behaviour_stage)
    ),

    uncertainty_note: safeString(
      raw.uncertainty_note || normalized.uncertainty_note || ""
    ),

    conversion_rate_analyzed: clampNumber(
      toSafeNumber(
        raw.conversion_rate_analyzed ||
          normalized.conversion_rate_analyzed ||
          DEFAULT_ANALYSIS.conversion_rate_analyzed
      ),
      5,
      98
    ),

    confidence_score: clampNumber(
      toSafeNumber(
        raw.confidence_score ||
          normalized.confidence_score ||
          DEFAULT_ANALYSIS.confidence_score
      ),
      20,
      98
    ),

    matched_patterns: uniqueStrings([
      ...toStringArray(raw.matched_patterns),
      ...toStringArray(normalized.matched_patterns),
    ]),

    matched_context_cues: uniqueStrings([
      ...toStringArray(raw.matched_context_cues),
      ...toStringArray(normalized.matched_context_cues),
    ]),

    matched_in: sanitizeMatchedIn(raw.matched_in || normalized.matched_in),

    status_flags: sanitizePlainObject(raw.status_flags),
    bubble_metrics: sanitizePlainObject(raw.bubble_metrics),
    sop_signals: sanitizePlainObject(raw.sop_signals),

    pipeline_meta: sanitizePlainObject(raw.pipeline_meta),
    detection_meta: sanitizePlainObject(raw.detection_meta),
    stage_meta: sanitizePlainObject(raw.stage_meta),
    pipeline_meta_source: safeString(raw.pipeline_meta_source || ""),
  };
}

/* ---------------------------------
   Internal: route reasoning
---------------------------------- */

/**
 * @param {LooseRecord | null | undefined} finalAnalysis
 * @param {string} pipeline
 * @returns {string}
 */
function resolveRouteReason(finalAnalysis, pipeline) {
  const src = toRecord(finalAnalysis);
  const pipelineMeta = sanitizePlainObject(src.pipeline_meta);

  const existingReason = safeString(
    pipelineMeta.route_reason ||
      pipelineMeta.reason ||
      ""
  );

  if (existingReason) return existingReason;

  if (pipeline === "no_respons") return "pipeline_no_respons";
  if (pipeline === "prospek") return "pipeline_prospek";
  return "pipeline_respons";
}

/* ---------------------------------
   Internal: helpers
---------------------------------- */

/**
 * @param {unknown} value
 * @returns {{ latest: string[], tail: string[], summary: string[] }}
 */
function sanitizeMatchedIn(value) {
  const src = toRecord(value);

  if (!Object.keys(src).length) {
    return { ...EMPTY_MATCHED_IN };
  }

  return {
    latest: toStringArray(src.latest),
    tail: toStringArray(src.tail),
    summary: toStringArray(src.summary),
  };
}

/**
 * @param {unknown} value
 * @returns {LooseRecord}
 */
function sanitizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {LooseRecord} */ (value)
    : {};
}

/**
 * @param {unknown} value
 * @returns {LooseRecord}
 */
function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {LooseRecord} */ (value)
    : {};
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeString(item)).filter(Boolean);
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(Boolean))];
}

function safeString(value) {
  return String(value || "").trim();
}

function toSafeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizeTag(value) {
  return safeString(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 80);
}