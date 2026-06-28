// dataset_engine/prospect_type.js

import {
  DEFAULT_ANALYSIS as RULES_DEFAULT_ANALYSIS,
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
  buildPipelineClassificationBundle,
  resolvePipelineRouteTarget,
} from "./pipeline_classifier.js";
import { buildSopStageBundle } from "./sop_stage_detector.js";

/* ---------------------------------
   Safe defaults
---------------------------------- */

const DEFAULT_ANALYSIS = Object.freeze({
  rule_id: "default_analysis",
  dataset_row_id: "",
  dataset_row_label: "",
  brand_channel: "unknown",
  pipeline: "respons",
  lead_level: "cold",
  lead_level_stage: "cold",
  emotion: "unknown",
  intent: "unknown",
  behaviour_stage: "curiosity",
  customer_profile: "",
  sop_stage_current: "greeting_awal",
  sop_stage_next: "share_info_tanya_balik",
  followup_gap: "",
  priority: "medium",
  priority_level: "medium",
  prospect_type: "none",
  cs_action: "",
  suggested_reply: "",
  suggested_response: "",
  tag_emotion: "unknown",
  tag_stage: "curiosity",
  uncertainty_note: "",
  conversion_rate_analyzed: 20,
  confidence_score: 20,
  matched_patterns: [],
  matched_context_cues: [],
  matched_in: {
    latest: [],
    tail: [],
    summary: [],
  },
  status_flags: {},
  bubble_metrics: {},
  sop_signals: {},
  stage_meta: {},
  pipeline_meta: {},
  prospect_meta: {},
  should_upgrade_to_prospek: false,
  ...asPlainObject(RULES_DEFAULT_ANALYSIS),
});

/* ---------------------------------
   Constants
---------------------------------- */

const BRAND_STAGES = new Set([
  "prospek_brand",
  "form_terkirim",
  "dp_request",
  "brand_development",
]);

const SAMPLE_STAGES = new Set([
  "prospek_sample",
]);

const POST_PAYMENT_STAGES = new Set([
  "invoice_konfirmasi",
  "progress_produksi",
  "resi_pengiriman",
]);

const AT_RISK_STAGES = new Set([
  "proof_before_pelunasan",
]);

const PROSPECT_ROUTE_HINTS = Object.freeze({
  none: "respons_qualification_composer",
  sample: "prospek_closing_composer",
  brand: "prospek_closing_composer",
  post_payment: "prospek_closing_composer",
  at_risk: "prospek_closing_composer",
});

const PROSPECT_PRIORITY_HINTS = Object.freeze({
  none: "medium",
  sample: "high",
  brand: "high",
  post_payment: "high",
  at_risk: "urgent",
});

const PROSPECT_LEAD_HINTS = Object.freeze({
  none: "cold",
  sample: "warm_hot",
  brand: "hot",
  post_payment: "hot",
  at_risk: "hot_at_risk",
});

/* ---------------------------------
   Public API
---------------------------------- */

/**
 * Reader tipis untuk prospect_type.
 *
 * Peran:
 * - membaca final analysis
 * - mengunci prospect_type menjadi:
 *   sample | brand | post_payment | at_risk | none
 * - memberi route hint
 *
 * Bukan tugas file ini:
 * - merge ulang taxonomy
 * - override intent / emotion / behaviour_stage
 * - membuat template bisnis baru
 */
export function detectProspectType(input = {}) {
  return buildProspectTypeBundle(input).final;
}

export function buildProspectTypeBundle(input = {}) {
  const source = asPlainObject(input);
  const context = sanitizeProspectContext(source);
  const baseBundle = buildBaseAnalysisBundle(source, context);

  const baseAnalysis = normalizeUnifiedAnalysis(
    source.finalAnalysis ||
      source.stageAnalysis ||
      source.pipelineClassification ||
      baseBundle.final ||
      {}
  );

  const prospectResolution = resolveProspectType({
    analysis: baseAnalysis,
    context,
  });

  const final = applyProspectResolution({
    analysis: baseAnalysis,
    context,
    prospectResolution,
  });

  return {
    context,
    pipelineClassification: baseBundle.pipelineClassification || null,
    stageAnalysis: baseBundle.stageAnalysis || null,
    finalAnalysis: baseAnalysis,
    prospectResolution,
    final,
  };
}

export function detectProspectTypeOnly(input = {}) {
  const bundle = buildProspectTypeBundle(input);

  return {
    prospect_type: bundle.final.prospect_type,
    should_upgrade_to_prospek: bundle.final.should_upgrade_to_prospek,
    prospect_meta: bundle.final.prospect_meta,
  };
}

/**
 * Resolver murni prospect_type.
 * Tidak mengubah ulang field taxonomy lain.
 */
export function resolveProspectType(input = {}) {
  const source = asPlainObject(input);
  const analysis = normalizeUnifiedAnalysis(
    source.analysis || source.finalAnalysis || {}
  );
  const context = sanitizeProspectContext(source.context || source);
  const signals = deriveProspectSignals({ analysis, context });

  let prospectType = "none";
  let reason = "no_prospect_signal";
  let note = "";

  const existingType = normalizeProspectType(analysis.prospect_type);

  if (existingType === "at_risk" || signals.is_at_risk) {
    prospectType = "at_risk";
    reason =
      existingType === "at_risk"
        ? "preserve_existing_at_risk"
        : "at_risk_signal";
  } else if (existingType === "post_payment" || signals.is_post_payment) {
    prospectType = "post_payment";
    reason =
      existingType === "post_payment"
        ? "preserve_existing_post_payment"
        : "post_payment_signal";
  } else if (signals.is_brand && signals.is_sample) {
    const resolved = resolveBrandSampleConflict({ analysis, context, signals });
    prospectType = resolved.prospect_type;
    reason = resolved.reason;
    note = resolved.note;
  } else if (existingType === "brand" || signals.is_brand) {
    prospectType = "brand";
    reason =
      existingType === "brand"
        ? "preserve_existing_brand"
        : "brand_signal";
  } else if (existingType === "sample" || signals.is_sample) {
    prospectType = "sample";
    reason =
      existingType === "sample"
        ? "preserve_existing_sample"
        : "sample_signal";
  }

  const normalizedProspectType = normalizeProspectType(prospectType);
  const routeTargetHint = resolveProspectRouteHint(
    normalizedProspectType,
    analysis.pipeline
  );
  const pipelineMismatch = Boolean(
    normalizedProspectType !== "none" &&
      normalizePipeline(analysis.pipeline) !== "prospek"
  );

  if (pipelineMismatch) {
    note = mergeNotes(
      note,
      "Prospect type terdeteksi, tetapi pipeline final belum berada di prospek."
    );
  }

  return {
    prospect_type: normalizedProspectType,
    should_upgrade_to_prospek:
      normalizedProspectType !== "none" ||
      Boolean(analysis.should_upgrade_to_prospek),
    reason,
    note,
    route_target_hint: routeTargetHint,
    pipeline_mismatch: pipelineMismatch,
    signals,
  };
}

/* ---------------------------------
   Base bundle bootstrap
---------------------------------- */

function buildBaseAnalysisBundle(input, context) {
  const src = asPlainObject(input);

  if (src.stageBundle && typeof src.stageBundle === "object") {
    const stageBundle = asPlainObject(src.stageBundle);
    return {
      final: stageBundle.final || stageBundle.stageAnalysis || {},
      pipelineClassification: stageBundle.pipelineClassification || null,
      stageAnalysis: stageBundle.final || null,
    };
  }

  if (src.stageAnalysis && typeof src.stageAnalysis === "object") {
    return {
      final: src.stageAnalysis,
      pipelineClassification: src.pipelineClassification || null,
      stageAnalysis: src.stageAnalysis,
    };
  }

  if (src.finalAnalysis && typeof src.finalAnalysis === "object") {
    return {
      final: src.finalAnalysis,
      pipelineClassification: src.pipelineClassification || null,
      stageAnalysis: src.finalAnalysis,
    };
  }

  if (
    src.pipelineClassificationBundle &&
    typeof src.pipelineClassificationBundle === "object"
  ) {
    const pipelineClassificationBundle = asPlainObject(src.pipelineClassificationBundle);
    const pipelineFinal = pipelineClassificationBundle.final || {};

    const stageBundle = buildSopStageBundle({
      ...src,
      ...context,
      pipelineClassificationBundle,
      pipelineClassification: pipelineFinal,
      finalAnalysis: pipelineFinal,
    });

    return {
      final: stageBundle.final || pipelineFinal,
      pipelineClassification: pipelineFinal,
      stageAnalysis: stageBundle.final || null,
    };
  }

  if (src.pipelineClassification && typeof src.pipelineClassification === "object") {
    const stageBundle = buildSopStageBundle({
      ...src,
      ...context,
      pipelineClassification: src.pipelineClassification,
      finalAnalysis: src.pipelineClassification,
    });

    return {
      final: stageBundle.final || src.pipelineClassification,
      pipelineClassification: src.pipelineClassification,
      stageAnalysis: stageBundle.final || null,
    };
  }

  const pipelineBundle = buildPipelineClassificationBundle({
    ...src,
    ...context,
  });

  const stageBundle = buildSopStageBundle({
    ...src,
    ...context,
    pipelineClassificationBundle: pipelineBundle,
    pipelineClassification: pipelineBundle.final,
    finalAnalysis: pipelineBundle.final,
  });

  return {
    final: stageBundle.final || pipelineBundle.final || {},
    pipelineClassification: pipelineBundle.final || null,
    stageAnalysis: stageBundle.final || null,
  };
}

/* ---------------------------------
   Prospect signal derivation
---------------------------------- */

function deriveProspectSignals({ analysis, context }) {
  const prospectType = normalizeProspectType(analysis.prospect_type);
  const stageCurrent = normalizeSopStage(analysis.sop_stage_current);
  const stageNext = normalizeSopStage(analysis.sop_stage_next);
  const stageMeta = sanitizePlainObject(analysis.stage_meta);
  const stageFamily = safeString(stageMeta.stage_family || "");
  const intent = normalizeIntent(analysis.intent);
  const emotion = normalizeEmotion(analysis.emotion);
  const behaviourStage = normalizeBehaviourStage(analysis.behaviour_stage);

  const statusFlags = sanitizeFlags(analysis.status_flags);
  const sopSignals = sanitizeSignals(analysis.sop_signals);

  const isAtRisk =
    prospectType === "at_risk" ||
    Boolean(context.is_at_risk) ||
    Boolean(statusFlags.is_at_risk) ||
    AT_RISK_STAGES.has(stageCurrent) ||
    AT_RISK_STAGES.has(stageNext) ||
    stageFamily === "at_risk" ||
    intent === "recovery" ||
    intent === "trust_recovery" ||
    ["trust_anxiety", "progress_anxiety", "proof_seeking"].includes(emotion) ||
    sopSignals.trust_anxiety ||
    sopSignals.progress_anxiety ||
    sopSignals.proof_seeking;

  const isPostPayment =
    !isAtRisk &&
    (
      prospectType === "post_payment" ||
      Boolean(context.is_post_payment) ||
      Boolean(context.has_dp_paid) ||
      Boolean(context.has_invoice_sent) ||
      Boolean(context.has_resi_sent) ||
      Boolean(statusFlags.is_post_payment) ||
      stageFamily === "post_payment" ||
      stageFamily === "shipping" ||
      POST_PAYMENT_STAGES.has(stageCurrent) ||
      POST_PAYMENT_STAGES.has(stageNext) ||
      intent === "fulfillment" ||
      behaviourStage === "post_purchase"
    );

  const isBrand =
    !isAtRisk &&
    !isPostPayment &&
    (
      prospectType === "brand" ||
      Boolean(context.has_form_sent) ||
      Boolean(context.has_form_filled) ||
      Boolean(statusFlags.is_brand_direction) ||
      stageFamily === "brand" ||
      BRAND_STAGES.has(stageCurrent) ||
      BRAND_STAGES.has(stageNext) ||
      intent === "branding" ||
      emotion === "brand_ownership" ||
      sopSignals.brand_ownership
    );

  const isSample =
    !isAtRisk &&
    !isPostPayment &&
    (
      prospectType === "sample" ||
      Boolean(statusFlags.is_sample_direction) ||
      stageFamily === "sample" ||
      SAMPLE_STAGES.has(stageCurrent) ||
      SAMPLE_STAGES.has(stageNext) ||
      intent === "trial" ||
      emotion === "risk_aversion" ||
      sopSignals.sample_vs_produksi
    );

  return {
    is_at_risk: Boolean(isAtRisk),
    is_post_payment: Boolean(isPostPayment),
    is_brand: Boolean(isBrand),
    is_sample: Boolean(isSample),

    stage_current: stageCurrent,
    stage_next: stageNext,
    stage_family: stageFamily,

    status_flags: statusFlags,
    sop_signals: sopSignals,
  };
}

function resolveBrandSampleConflict({ analysis, context, signals }) {
  if (normalizeProspectType(analysis.prospect_type) === "brand") {
    return {
      prospect_type: "brand",
      reason: "brand_wins_from_existing_final_analysis",
      note: "",
    };
  }

  if (normalizeProspectType(analysis.prospect_type) === "sample") {
    return {
      prospect_type: "sample",
      reason: "sample_wins_from_existing_final_analysis",
      note: "",
    };
  }

  if (context.has_form_sent || context.has_form_filled) {
    return {
      prospect_type: "brand",
      reason: "brand_wins_from_form_state",
      note: "Sinyal brand dan sample muncul bersamaan, tetapi form brand membuat jalur brand lebih kuat.",
    };
  }

  if (signals.stage_family === "brand" || BRAND_STAGES.has(signals.stage_current)) {
    return {
      prospect_type: "brand",
      reason: "brand_wins_from_stage",
      note: "Sinyal brand dan sample muncul bersamaan, tetapi stage saat ini lebih dekat ke jalur brand.",
    };
  }

  if (signals.stage_family === "sample" || SAMPLE_STAGES.has(signals.stage_current)) {
    return {
      prospect_type: "sample",
      reason: "sample_wins_from_stage",
      note: "Sinyal brand dan sample muncul bersamaan, tetapi stage saat ini lebih dekat ke jalur sample.",
    };
  }

  if (normalizeIntent(analysis.intent) === "branding") {
    return {
      prospect_type: "brand",
      reason: "brand_wins_from_intent",
      note: "Sinyal brand dan sample muncul bersamaan, lalu intent branding dipakai sebagai penentu.",
    };
  }

  if (normalizeIntent(analysis.intent) === "trial") {
    return {
      prospect_type: "sample",
      reason: "sample_wins_from_intent",
      note: "Sinyal brand dan sample muncul bersamaan, lalu intent trial dipakai sebagai penentu.",
    };
  }

  return {
    prospect_type: "brand",
    reason: "brand_default_on_conflict",
    note: "Sinyal brand dan sample muncul bersamaan, jadi jalur brand dipilih sebagai default yang paling aman.",
  };
}

/* ---------------------------------
   Apply resolution
---------------------------------- */

function applyProspectResolution({ analysis, context, prospectResolution }) {
  const base = normalizeUnifiedAnalysis(analysis);
  const resolution = asPlainObject(prospectResolution);

  const lockedProspectType = normalizeProspectType(
    resolution.prospect_type || base.prospect_type
  );

  const uncertaintyNote = mergeNotes(
    base.uncertainty_note,
    safeString(resolution.note || ""),
    buildProspectUncertaintyNote({
      base,
      context,
      prospectResolution: resolution,
    })
  );

  return normalizeUnifiedAnalysis({
    ...base,
    prospect_type: lockedProspectType,
    should_upgrade_to_prospek:
      lockedProspectType !== "none" || Boolean(base.should_upgrade_to_prospek),
    uncertainty_note: uncertaintyNote,
    prospect_meta: {
      ...sanitizePlainObject(base.prospect_meta),
      reason: safeString(resolution.reason || ""),
      route_target_hint: safeString(resolution.route_target_hint || ""),
      pipeline_mismatch: Boolean(resolution.pipeline_mismatch),
      priority_hint: inferPriorityHint(
        lockedProspectType,
        base.priority || base.priority_level
      ),
      lead_level_hint: inferLeadLevelHint(
        lockedProspectType,
        base.lead_level || base.lead_level_stage
      ),
      signals: {
        is_sample: Boolean(resolution.signals?.is_sample),
        is_brand: Boolean(resolution.signals?.is_brand),
        is_post_payment: Boolean(resolution.signals?.is_post_payment),
        is_at_risk: Boolean(resolution.signals?.is_at_risk),
      },
      stage_family: safeString(resolution.signals?.stage_family || ""),
      stage_current: safeString(resolution.signals?.stage_current || ""),
      stage_next: safeString(resolution.signals?.stage_next || ""),
    },
  });
}

/* ---------------------------------
   Hints and uncertainty
---------------------------------- */

function resolveProspectRouteHint(prospectType, pipeline) {
  const type = normalizeProspectType(prospectType);
  if (type !== "none") {
    return PROSPECT_ROUTE_HINTS[type] || "prospek_closing_composer";
  }

  return resolvePipelineRouteTarget(
    normalizePipeline(pipeline || DEFAULT_ANALYSIS.pipeline)
  );
}

function inferPriorityHint(prospectType, fallbackPriority) {
  const type = normalizeProspectType(prospectType);
  if (type === "none") {
    return normalizePriorityLevel(fallbackPriority || DEFAULT_ANALYSIS.priority);
  }

  return normalizePriorityLevel(
    PROSPECT_PRIORITY_HINTS[type] || fallbackPriority || DEFAULT_ANALYSIS.priority
  );
}

function inferLeadLevelHint(prospectType, fallbackLeadLevel) {
  const type = normalizeProspectType(prospectType);
  if (type === "none") {
    return normalizeLeadLevel(fallbackLeadLevel || DEFAULT_ANALYSIS.lead_level);
  }

  return normalizeLeadLevel(
    PROSPECT_LEAD_HINTS[type] || fallbackLeadLevel || DEFAULT_ANALYSIS.lead_level
  );
}

function buildProspectUncertaintyNote({ base, context, prospectResolution }) {
  const resolution = asPlainObject(prospectResolution);
  const notes = [];

  if (
    resolution.prospect_type === "brand" &&
    resolution.signals?.is_sample
  ) {
    notes.push("Ada sinyal sample dan brand bersamaan, tetapi jalur brand dipilih sebagai yang paling kuat.");
  }

  if (
    resolution.prospect_type === "sample" &&
    resolution.signals?.is_brand
  ) {
    notes.push("Ada sinyal brand dan sample bersamaan, tetapi jalur sample dipilih sebagai yang paling kuat.");
  }

  if (
    resolution.prospect_type === "post_payment" &&
    !context.has_dp_paid &&
    !context.has_invoice_sent &&
    !context.has_resi_sent
  ) {
    notes.push("Post-payment terutama dibaca dari stage atau final analysis, bukan hanya boolean pembayaran.");
  }

  if (
    resolution.prospect_type === "at_risk" &&
    !context.is_at_risk &&
    !context.has_product_proof_sent
  ) {
    notes.push("At-risk dibaca konservatif dari sinyal trust atau progress yang kuat.");
  }

  if (
    resolution.pipeline_mismatch &&
    normalizePipeline(base.pipeline) !== "prospek"
  ) {
    notes.push("Prospect type sudah terkunci, tetapi pipeline final perlu dipastikan tetap konsisten di merge layer.");
  }

  return notes.join(" ");
}

/* ---------------------------------
   Normalization
---------------------------------- */

function sanitizeProspectContext(input = {}) {
  const src = asPlainObject(input);

  return {
    latestCustomerText: safeString(src.latestCustomerText || src.customer_message || ""),
    latest_customer_text: safeString(
      src.latest_customer_text || src.latestCustomerText || src.customer_message || ""
    ),
    customer_message: safeString(src.customer_message || src.latestCustomerText || ""),
    tail: safeString(src.tail || src.recent_chat_history || ""),
    recent_chat_history: safeString(src.recent_chat_history || src.tail || ""),
    summary: safeString(src.summary || ""),
    brand_channel: normalizeBrandChannel(src.brand_channel),
    has_form_sent: Boolean(src.has_form_sent),
    has_form_filled: Boolean(src.has_form_filled),
    has_dp_paid: Boolean(src.has_dp_paid),
    has_invoice_sent: Boolean(src.has_invoice_sent),
    has_product_proof_sent: Boolean(src.has_product_proof_sent),
    has_resi_sent: Boolean(src.has_resi_sent),
    is_post_payment: Boolean(src.is_post_payment),
    is_at_risk: Boolean(src.is_at_risk),
  };
}

function normalizeUnifiedAnalysis(input = {}) {
  const raw = asPlainObject(input);
  const normalized = asPlainObject(normalizeAnalysisTaxonomy(raw));

  const suggestedReply = safeString(
    raw.suggested_reply ||
      raw.suggested_response ||
      normalized.suggested_reply ||
      normalized.suggested_response ||
      DEFAULT_ANALYSIS.suggested_reply
  );

  const leadLevel = normalizeLeadLevel(
    raw.lead_level || raw.lead_level_stage || normalized.lead_level_stage
  );

  const priority = normalizePriorityLevel(
    raw.priority || raw.priority_level || normalized.priority || DEFAULT_ANALYSIS.priority
  );

  return {
    ...DEFAULT_ANALYSIS,
    ...raw,
    ...normalized,

    brand_channel: normalizeBrandChannel(raw.brand_channel || "unknown"),

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

    stage_meta: sanitizePlainObject(raw.stage_meta),
    pipeline_meta: sanitizePlainObject(raw.pipeline_meta),
    prospect_meta: sanitizePlainObject(raw.prospect_meta),

    should_upgrade_to_prospek: Boolean(
      raw.should_upgrade_to_prospek || normalized.should_upgrade_to_prospek
    ),
  };
}

/* ---------------------------------
   Sanitizers
---------------------------------- */

function sanitizeFlags(input) {
  const raw = asPlainObject(input);
  return {
    is_sample_direction: Boolean(raw.is_sample_direction),
    is_brand_direction: Boolean(raw.is_brand_direction),
    is_post_payment: Boolean(raw.is_post_payment),
    is_at_risk: Boolean(raw.is_at_risk),
  };
}

function sanitizeSignals(input) {
  const raw = asPlainObject(input);
  return {
    sample_vs_produksi: Boolean(raw.sample_vs_produksi),
    brand_ownership: Boolean(raw.brand_ownership),
    trust_anxiety: Boolean(raw.trust_anxiety),
    progress_anxiety: Boolean(raw.progress_anxiety),
    proof_seeking: Boolean(raw.proof_seeking),
  };
}

function sanitizeMatchedIn(value) {
  const raw = asPlainObject(value);
  return {
    latest: uniqueStrings(toStringArray(raw.latest)),
    tail: uniqueStrings(toStringArray(raw.tail)),
    summary: uniqueStrings(toStringArray(raw.summary)),
  };
}

function sanitizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

/* ---------------------------------
   Utilities
---------------------------------- */

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function mergeNotes(...values) {
  return uniqueStrings(
    (Array.isArray(values) ? values : [])
      .map((value) => safeString(value))
      .filter(Boolean)
  ).join(" ");
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeString(item)).filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
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