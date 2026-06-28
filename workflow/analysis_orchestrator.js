import { primaryGenerate } from "../generate_ai_backup/primary_generate/primary_generate.js";
import {
  fallbackTwoGenerate,
  defaultSuggestions,
} from "../generate_ai_backup/fallback_two/fallback_two.js";
import { fallbackOneGenerate } from "../generate_ai_backup/fallback_one/fallback_one.js";

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
} from "../dataset_engine/rules.js";
import { detectDatasetPattern } from "../dataset_engine/pattern_detection.js";
import { calculateLeadScore } from "../dataset_engine/lead_scoring.js";
import { mergeAnalysisLayers } from "../dataset_engine/merge_analysis.js";
import { buildFollowupPlannerBundle } from "../dataset_engine/followup_planner.js";

import { safeText } from "../utils/text.js";
import {
  safePercent,
  analysisPercent,
  firstNonEmpty,
  toStringArray,
  uniqueStrings,
  mergeMatchedIn,
} from "../utils/collection.js";
import {
  extractOutputAnyText,
  tryParseJsonLoose,
} from "../utils/ai_output.js";
import { normalizeLocalEmotionToAnalysis } from "../utils/emotion.js";

export const PROCESS_MODES = Object.freeze({
  incoming_customer_response: "incoming_customer_response",
  scheduled_no_response_followup: "scheduled_no_response_followup",
  post_payment_progress_check: "post_payment_progress_check",
});

export const ROUTE_TARGETS = Object.freeze({
  no_respons: "no_respons_followup_composer",
  respons: "respons_qualification_composer",
  prospek: "prospek_closing_composer",
});

/**
 * @typedef {Record<string, any>} PlainObject
 */

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
 *   scoring_meta?: Record<string, any>,
 *   tag_emotion?: string,
 *   tag_stage?: string,
 *   customer_bubble_count?: number,
 *   agent_bubble_count?: number,
 *   hours_since_last_customer_reply?: number,
 *   hours_since_last_cs_action?: number
 * }} FinalAnalysis
 */

export function normalizeProcessMode(value) {
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

export function getRouteTargetFromAnalysis(analysis) {
  const pipeline = normalizePipeline(analysis?.pipeline);

  return firstNonEmpty([
    safeText(analysis?.planner_meta?.route_target || "", 80),
    safeText(analysis?.followup_plan?.route_target || "", 80),
    safeText(analysis?.followup_meta?.route_target || "", 80),
    ROUTE_TARGETS[pipeline] || ROUTE_TARGETS.respons,
  ]);
}

/**
 * @param {any} env
 * @param {Record<string, any>} ctx
 * @returns {Promise<FinalAnalysis>}
 */
export async function analyzeLeadOneCall(env, ctx = {}) {
  const shared = {
    safeText,
    extractOutputAnyText,
    tryParseJsonLoose,
  };

  const safeMode = normalizeProcessMode(
    ctx?.mode ||
      ctx?.process_mode ||
      ctx?.workflow_mode ||
      PROCESS_MODES.incoming_customer_response
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

/**
 * @param {any} finalAnalysis
 * @param {Record<string, any>} meta
 * @returns {FinalAnalysis}
 */
export function sanitizeFinalWorkflowAnalysis(finalAnalysis, meta = {}) {
  const final = finalAnalysis && typeof finalAnalysis === "object" ? finalAnalysis : {};
  const merged = meta?.merged && typeof meta.merged === "object" ? meta.merged : {};
  const scored =
    meta?.scoredAnalysis && typeof meta.scoredAnalysis === "object"
      ? meta.scoredAnalysis
      : {};
  const dataset =
    meta?.datasetBase && typeof meta.datasetBase === "object"
      ? meta.datasetBase
      : {};
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
    ...(dataset.bubble_metrics && typeof dataset.bubble_metrics === "object"
      ? dataset.bubble_metrics
      : {}),
    ...(scored.bubble_metrics && typeof scored.bubble_metrics === "object"
      ? scored.bubble_metrics
      : {}),
    ...(merged.bubble_metrics && typeof merged.bubble_metrics === "object"
      ? merged.bubble_metrics
      : {}),
    ...(final.bubble_metrics && typeof final.bubble_metrics === "object"
      ? final.bubble_metrics
      : {}),
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

    merge_meta:
      merged.merge_meta && typeof merged.merge_meta === "object"
        ? merged.merge_meta
        : {},

    stage_meta:
      final.stage_meta && typeof final.stage_meta === "object"
        ? final.stage_meta
        : {},
    pipeline_meta:
      final.pipeline_meta && typeof final.pipeline_meta === "object"
        ? final.pipeline_meta
        : {},
    prospect_meta:
      final.prospect_meta && typeof final.prospect_meta === "object"
        ? final.prospect_meta
        : {},
    followup_meta:
      final.followup_meta && typeof final.followup_meta === "object"
        ? final.followup_meta
        : {},
    followup_plan:
      final.followup_plan && typeof final.followup_plan === "object"
        ? final.followup_plan
        : {},
    planner_meta:
      final.planner_meta && typeof final.planner_meta === "object"
        ? final.planner_meta
        : {},

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

export function buildMinimalDatasetBase(latestCustomerText = "") {
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

export function buildNoMemoryAnalysis(latestCustomerText = "") {
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

function normalizeTagToken(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

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

    is_post_payment:
      getLooseBoolean([
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

function toSafeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * @param {any} value
 * @returns {PlainObject}
 */
function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}