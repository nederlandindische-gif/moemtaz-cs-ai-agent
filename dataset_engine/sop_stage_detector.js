// dataset_engine/sop_stage_detector.js

import {
  DEFAULT_ANALYSIS,
  NO_RESPONSE_FOLLOWUP_SEQUENCE,
  getNoResponseFollowupByType,
  getSopStageConfig,
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
  classifyPipeline,
  resolvePipelineRouteTarget,
} from "./pipeline_classifier.js";

/**
 * @typedef {Record<string, any>} LooseRecord
 */

/* ---------------------------------
   Constants
---------------------------------- */

const STAGE_FAMILIES = Object.freeze({
  followup: "followup",
  qualification: "qualification",
  sample: "sample",
  brand: "brand",
  post_payment: "post_payment",
  at_risk: "at_risk",
  shipping: "shipping",
  generic: "generic",
});

const FOLLOWUP_STAGE_TO_TYPE = Object.freeze({
  followup_contoh_produk: "contoh_produk",
  followup_konten_design: "konten_dan_design",
  followup_testimoni: "testimoni",
  followup_penawaran_sample: "penawaran_sample",
  followup_bukti_transfer: "bukti_transfer",
  followup_progress: "tanya_progress",
});

const TYPE_TO_FOLLOWUP_STAGE = Object.freeze(
  Object.entries(FOLLOWUP_STAGE_TO_TYPE).reduce((acc, [stage, type]) => {
    acc[type] = stage;
    return acc;
  }, {})
);

const STAGE_ORDER = Object.freeze({
  greeting_awal: 1,
  share_info_tanya_balik: 2,
  harga_paket_terkirim: 3,
  prospek_sample: 4,
  prospek_brand: 5,
  form_terkirim: 6,
  dp_request: 7,
  invoice_konfirmasi: 8,
  brand_development: 9,
  progress_produksi: 10,
  proof_before_pelunasan: 11,
  resi_pengiriman: 12,

  followup_contoh_produk: 101,
  followup_konten_design: 102,
  followup_testimoni: 103,
  followup_penawaran_sample: 104,
  followup_bukti_transfer: 105,
  followup_progress: 106,
});

/* ---------------------------------
   Public API
---------------------------------- */

/**
 * Read-only SOP stage mapper.
 *
 * Tugas file ini:
 * - membaca final analysis yang sudah jadi
 * - menentukan sop_stage_current
 * - menentukan sop_stage_next
 * - memberi stage_reason
 *
 * Tidak bertugas:
 * - merge ulang taxonomy bisnis
 * - override ulang intent/emotion/lead_level/priority
 * - membuat template reply/action baru
 *
 * @param {LooseRecord | null | undefined} input
 * @returns {LooseRecord}
 */
export function detectSopStage(input = {}) {
  return buildSopStageBundle(input).final;
}

/**
 * Bundle lengkap untuk debugging atau orchestration.
 *
 * @param {LooseRecord | null | undefined} input
 * @returns {LooseRecord}
 */
export function buildSopStageBundle(input = {}) {
  const safeInput = toRecord(input);
  const context = sanitizeSopContext(safeInput);
  const classificationBundle = buildBaseClassificationBundle(safeInput, context);

  const baseAnalysis = normalizeUnifiedAnalysis(
    safeInput.finalAnalysis ||
      safeInput.mergedAnalysis ||
      safeInput.pipelineClassification ||
      classificationBundle.final ||
      {}
  );

  const stageResolution = resolveSopStage({
    analysis: baseAnalysis,
    context,
  });

  const final = applyStageResolution({
    analysis: baseAnalysis,
    context,
    stageResolution,
  });

  return {
    context,
    pipelineClassification: classificationBundle.final,
    detection: classificationBundle.detection || null,
    datasetBase: classificationBundle.datasetBase || null,
    scoredAnalysis: classificationBundle.scoredAnalysis || null,
    stageResolution,
    final,
  };
}

/**
 * Resolver murni current/next stage.
 *
 * @param {LooseRecord | null | undefined} input
 * @returns {LooseRecord}
 */
export function resolveSopStage(input = {}) {
  const safeInput = toRecord(input);
  const analysis = normalizeUnifiedAnalysis(
    safeInput.analysis || safeInput.finalAnalysis || {}
  );
  const context = sanitizeSopContext(safeInput.context || safeInput);

  if (analysis.pipeline === "no_respons") {
    return resolveNoResponseStages({ analysis, context });
  }

  if (analysis.prospect_type === "at_risk") {
    return resolveAtRiskStages({ analysis, context });
  }

  if (analysis.prospect_type === "post_payment") {
    return resolvePostPaymentStages({ analysis, context });
  }

  if (analysis.prospect_type === "brand") {
    return resolveBrandStages({ analysis, context });
  }

  if (analysis.prospect_type === "sample") {
    return resolveSampleStages({ analysis, context });
  }

  return resolveQualificationStages({ analysis });
}

/**
 * Helper ringan jika hanya butuh stage.
 *
 * @param {LooseRecord | null | undefined} input
 * @returns {LooseRecord}
 */
export function detectSopStagesOnly(input = {}) {
  const bundle = buildSopStageBundle(input);

  return {
    sop_stage_current: bundle.final.sop_stage_current,
    sop_stage_next: bundle.final.sop_stage_next,
    stage_meta: bundle.final.stage_meta,
  };
}

/* ---------------------------------
   Base classification bootstrap
---------------------------------- */

/**
 * @param {LooseRecord} input
 * @param {LooseRecord} context
 * @returns {LooseRecord}
 */
function buildBaseClassificationBundle(input, context) {
  const safeInput = toRecord(input);

  if (
    safeInput.pipelineClassificationBundle &&
    typeof safeInput.pipelineClassificationBundle === "object"
  ) {
    return safeInput.pipelineClassificationBundle;
  }

  if (safeInput.pipelineClassification && typeof safeInput.pipelineClassification === "object") {
    return {
      final: classifyPipeline({
        ...context,
        finalAnalysis: safeInput.pipelineClassification,
      }),
      detection: null,
      datasetBase: null,
      scoredAnalysis: null,
    };
  }

  if (safeInput.finalAnalysis && typeof safeInput.finalAnalysis === "object") {
    return {
      final: classifyPipeline({
        ...context,
        finalAnalysis: safeInput.finalAnalysis,
      }),
      detection: null,
      datasetBase: null,
      scoredAnalysis: null,
    };
  }

  return buildPipelineClassificationBundle({
    ...safeInput,
    ...context,
  });
}

/* ---------------------------------
   Stage resolvers
---------------------------------- */

function resolveNoResponseStages({ analysis, context }) {
  const currentFromAnalysis = normalizeSopStage(analysis.sop_stage_current);

  if (isFollowupStage(currentFromAnalysis)) {
    const currentType = mapFollowupStageToType(currentFromAnalysis);
    const nextFollowup = getNextNoResponseFollowupLocal(currentType);

    return buildStageResolution({
      current: currentFromAnalysis,
      next: mapFollowupTypeToStage(nextFollowup?.type) || currentFromAnalysis,
      stage_family: STAGE_FAMILIES.followup,
      stage_reason: "preserve_existing_no_response_stage",
      followup_type_current: currentType,
      followup_type_next: safeString(nextFollowup?.type || ""),
    });
  }

  const inferredLastType = inferLastCompletedFollowupType({ analysis, context });
  if (inferredLastType) {
    const currentFollowup = getNextNoResponseFollowupLocal(inferredLastType);
    const currentStage =
      mapFollowupTypeToStage(currentFollowup?.type) ||
      mapFollowupTypeToStage(NO_RESPONSE_FOLLOWUP_SEQUENCE[0]?.type) ||
      "followup_contoh_produk";

    const nextFollowup = getNextNoResponseFollowupLocal(currentFollowup?.type || "");
    const nextStage =
      mapFollowupTypeToStage(nextFollowup?.type) || currentStage;

    return buildStageResolution({
      current: currentStage,
      next: nextStage,
      stage_family: STAGE_FAMILIES.followup,
      stage_reason: "infer_next_no_response_stage_from_last_followup",
      followup_type_current: safeString(currentFollowup?.type || ""),
      followup_type_next: safeString(nextFollowup?.type || ""),
    });
  }

  const firstType = safeString(NO_RESPONSE_FOLLOWUP_SEQUENCE[0]?.type || "contoh_produk");
  const second = getNextNoResponseFollowupLocal(firstType);

  return buildStageResolution({
    current: mapFollowupTypeToStage(firstType) || "followup_contoh_produk",
    next: mapFollowupTypeToStage(second?.type) || "followup_konten_design",
    stage_family: STAGE_FAMILIES.followup,
    stage_reason: "start_default_no_response_sequence",
    followup_type_current: firstType,
    followup_type_next: safeString(second?.type || ""),
  });
}

function resolveAtRiskStages({ analysis, context }) {
  const currentFromAnalysis = normalizeSopStage(analysis.sop_stage_current);

  if (
    currentFromAnalysis &&
    isKnownStage(currentFromAnalysis) &&
    isStageCompatibleWithProspectType(currentFromAnalysis, "at_risk")
  ) {
    return buildStageResolution({
      current: currentFromAnalysis,
      next: resolveNextStage(currentFromAnalysis, analysis.sop_stage_next),
      stage_family: STAGE_FAMILIES.at_risk,
      stage_reason: "preserve_existing_at_risk_stage",
    });
  }

  if (context.has_resi_sent) {
    return buildStageResolution({
      current: "resi_pengiriman",
      next: "resi_pengiriman",
      stage_family: STAGE_FAMILIES.shipping,
      stage_reason: "at_risk_shipping_already_sent",
    });
  }

  if (
    analysis.behaviour_stage === "pre_pelunasan" ||
    analysis.emotion === "proof_seeking"
  ) {
    return buildStageResolution({
      current: "proof_before_pelunasan",
      next: resolveNextStage("proof_before_pelunasan", analysis.sop_stage_next, "invoice_konfirmasi"),
      stage_family: STAGE_FAMILIES.at_risk,
      stage_reason: "at_risk_proof_seeking_stage",
    });
  }

  if (
    analysis.behaviour_stage === "post_purchase" ||
    analysis.emotion === "progress_anxiety" ||
    context.has_dp_paid ||
    context.has_invoice_sent
  ) {
    return buildStageResolution({
      current: "progress_produksi",
      next: resolveNextStage("progress_produksi", analysis.sop_stage_next, "resi_pengiriman"),
      stage_family: STAGE_FAMILIES.at_risk,
      stage_reason: "at_risk_progress_monitoring_stage",
    });
  }

  return buildStageResolution({
    current: "invoice_konfirmasi",
    next: resolveNextStage("invoice_konfirmasi", analysis.sop_stage_next, "progress_produksi"),
    stage_family: STAGE_FAMILIES.at_risk,
    stage_reason: "at_risk_invoice_confirmation_stage",
  });
}

function resolvePostPaymentStages({ analysis, context }) {
  const currentFromAnalysis = normalizeSopStage(analysis.sop_stage_current);

  if (
    currentFromAnalysis &&
    isKnownStage(currentFromAnalysis) &&
    isStageCompatibleWithProspectType(currentFromAnalysis, "post_payment")
  ) {
    return buildStageResolution({
      current: currentFromAnalysis,
      next: resolveNextStage(currentFromAnalysis, analysis.sop_stage_next),
      stage_family: currentFromAnalysis === "resi_pengiriman"
        ? STAGE_FAMILIES.shipping
        : STAGE_FAMILIES.post_payment,
      stage_reason: "preserve_existing_post_payment_stage",
    });
  }

  if (context.has_resi_sent) {
    return buildStageResolution({
      current: "resi_pengiriman",
      next: "resi_pengiriman",
      stage_family: STAGE_FAMILIES.shipping,
      stage_reason: "post_payment_shipping_completed",
    });
  }

  if (context.has_dp_paid || context.has_invoice_sent) {
    return buildStageResolution({
      current: "progress_produksi",
      next: resolveNextStage("progress_produksi", analysis.sop_stage_next, "resi_pengiriman"),
      stage_family: STAGE_FAMILIES.post_payment,
      stage_reason: "post_payment_progress_stage",
    });
  }

  return buildStageResolution({
    current: "invoice_konfirmasi",
    next: resolveNextStage("invoice_konfirmasi", analysis.sop_stage_next, "progress_produksi"),
    stage_family: STAGE_FAMILIES.post_payment,
    stage_reason: "post_payment_invoice_confirmation_stage",
  });
}

function resolveBrandStages({ analysis, context }) {
  const currentFromAnalysis = normalizeSopStage(analysis.sop_stage_current);

  if (
    currentFromAnalysis &&
    isKnownStage(currentFromAnalysis) &&
    isStageCompatibleWithProspectType(currentFromAnalysis, "brand")
  ) {
    return buildStageResolution({
      current: currentFromAnalysis,
      next: resolveNextStage(currentFromAnalysis, analysis.sop_stage_next),
      stage_family: resolveStageFamily(currentFromAnalysis),
      stage_reason: "preserve_existing_brand_stage",
    });
  }

  if (context.has_resi_sent) {
    return buildStageResolution({
      current: "resi_pengiriman",
      next: "resi_pengiriman",
      stage_family: STAGE_FAMILIES.shipping,
      stage_reason: "brand_shipping_completed",
    });
  }

  if (context.has_dp_paid || context.has_invoice_sent) {
    return buildStageResolution({
      current: "invoice_konfirmasi",
      next: resolveNextStage("invoice_konfirmasi", analysis.sop_stage_next, "brand_development"),
      stage_family: STAGE_FAMILIES.brand,
      stage_reason: "brand_invoice_confirmation_stage",
    });
  }

  if (context.has_form_sent || context.has_form_filled) {
    return buildStageResolution({
      current: "form_terkirim",
      next: resolveNextStage("form_terkirim", analysis.sop_stage_next, "dp_request"),
      stage_family: STAGE_FAMILIES.brand,
      stage_reason: "brand_form_stage",
    });
  }

  return buildStageResolution({
    current: "prospek_brand",
    next: resolveNextStage("prospek_brand", analysis.sop_stage_next, "form_terkirim"),
    stage_family: STAGE_FAMILIES.brand,
    stage_reason: "brand_initial_prospect_stage",
  });
}

function resolveSampleStages({ analysis, context }) {
  const currentFromAnalysis = normalizeSopStage(analysis.sop_stage_current);

  if (
    currentFromAnalysis &&
    isKnownStage(currentFromAnalysis) &&
    isStageCompatibleWithProspectType(currentFromAnalysis, "sample")
  ) {
    return buildStageResolution({
      current: currentFromAnalysis,
      next: resolveNextStage(currentFromAnalysis, analysis.sop_stage_next),
      stage_family: resolveStageFamily(currentFromAnalysis),
      stage_reason: "preserve_existing_sample_stage",
    });
  }

  if (context.has_resi_sent) {
    return buildStageResolution({
      current: "resi_pengiriman",
      next: "resi_pengiriman",
      stage_family: STAGE_FAMILIES.shipping,
      stage_reason: "sample_shipping_completed",
    });
  }

  if (context.has_dp_paid || context.has_invoice_sent) {
    return buildStageResolution({
      current: "invoice_konfirmasi",
      next: resolveNextStage("invoice_konfirmasi", analysis.sop_stage_next, "progress_produksi"),
      stage_family: STAGE_FAMILIES.sample,
      stage_reason: "sample_invoice_confirmation_stage",
    });
  }

  return buildStageResolution({
    current: "prospek_sample",
    next: resolveNextStage("prospek_sample", analysis.sop_stage_next, "invoice_konfirmasi"),
    stage_family: STAGE_FAMILIES.sample,
    stage_reason: "sample_initial_prospect_stage",
  });
}

function resolveQualificationStages({ analysis }) {
  const currentFromAnalysis = normalizeSopStage(analysis.sop_stage_current);

  if (
    currentFromAnalysis &&
    isKnownStage(currentFromAnalysis) &&
    isStageCompatibleWithProspectType(currentFromAnalysis, "none")
  ) {
    return buildStageResolution({
      current: currentFromAnalysis,
      next: resolveNextStage(currentFromAnalysis, analysis.sop_stage_next),
      stage_family: resolveStageFamily(currentFromAnalysis),
      stage_reason: "preserve_existing_qualification_stage",
    });
  }

  if (analysis.behaviour_stage === "curiosity" || analysis.emotion === "curiosity") {
    return buildStageResolution({
      current: "greeting_awal",
      next: resolveNextStage("greeting_awal", analysis.sop_stage_next, "share_info_tanya_balik"),
      stage_family: STAGE_FAMILIES.qualification,
      stage_reason: "qualification_curiosity_entry",
    });
  }

  if (
    analysis.behaviour_stage === "interest" ||
    analysis.emotion === "discovery" ||
    analysis.intent === "exploration"
  ) {
    return buildStageResolution({
      current: "share_info_tanya_balik",
      next: resolveNextStage("share_info_tanya_balik", analysis.sop_stage_next, "harga_paket_terkirim"),
      stage_family: STAGE_FAMILIES.qualification,
      stage_reason: "qualification_interest_stage",
    });
  }

  if (analysis.behaviour_stage === "evaluation") {
    return buildStageResolution({
      current: "harga_paket_terkirim",
      next: resolveNextStage("harga_paket_terkirim", analysis.sop_stage_next, "share_info_tanya_balik"),
      stage_family: STAGE_FAMILIES.qualification,
      stage_reason: "qualification_evaluation_stage",
    });
  }

  return buildStageResolution({
    current: "share_info_tanya_balik",
    next: resolveNextStage("share_info_tanya_balik", analysis.sop_stage_next, "harga_paket_terkirim"),
    stage_family: STAGE_FAMILIES.generic,
    stage_reason: "qualification_default_stage",
  });
}

/* ---------------------------------
   Final application
---------------------------------- */

function applyStageResolution({ analysis, context, stageResolution }) {
  const current = normalizeSopStage(stageResolution.current);
  const next = normalizeSopStage(stageResolution.next);
  const routeTarget = resolvePipelineRouteTarget(analysis.pipeline);

  return normalizeUnifiedAnalysis({
    ...analysis,
    brand_channel: context.brand_channel,
    sop_stage_current: current,
    sop_stage_next: next,
    stage_meta: {
      ...sanitizePlainObject(analysis.stage_meta),
      stage_family: safeString(stageResolution.stage_family),
      stage_reason: safeString(stageResolution.stage_reason),
      current_stage_order: getStageOrder(current),
      next_stage_order: getStageOrder(next),
      followup_type_current: safeString(stageResolution.followup_type_current || ""),
      followup_type_next: safeString(stageResolution.followup_type_next || ""),
      route_target: routeTarget,
    },
    uncertainty_note: mergeUncertaintyNotes(
      analysis.uncertainty_note,
      buildStageUncertaintyNote({
        analysis,
        context,
        stageResolution,
      })
    ),
  });
}

/* ---------------------------------
   Stage helpers
---------------------------------- */

function resolveNextStage(currentStage, explicitNextStage, fallbackNextStage = "") {
  const explicitRaw = safeString(explicitNextStage);
  if (explicitRaw) {
    const explicit = normalizeSopStage(explicitRaw);
    if (explicit && isKnownStage(explicit)) return explicit;
  }

  const configNextRaw = safeString(
    getSopStageConfig(currentStage)?.next_stage || ""
  );
  if (configNextRaw) {
    const configNext = normalizeSopStage(configNextRaw);
    if (configNext && isKnownStage(configNext)) return configNext;
  }

  const fallbackRaw = safeString(fallbackNextStage);
  if (fallbackRaw) {
    const fallback = normalizeSopStage(fallbackRaw);
    if (fallback && isKnownStage(fallback)) return fallback;
  }

  return normalizeSopStage(currentStage || DEFAULT_ANALYSIS.sop_stage_next);
}

function resolveStageFamily(stage) {
  const normalized = normalizeSopStage(stage);

  if (isFollowupStage(normalized)) return STAGE_FAMILIES.followup;
  if (["greeting_awal", "share_info_tanya_balik", "harga_paket_terkirim"].includes(normalized)) {
    return STAGE_FAMILIES.qualification;
  }
  if (["prospek_sample"].includes(normalized)) return STAGE_FAMILIES.sample;
  if (["prospek_brand", "form_terkirim", "dp_request", "brand_development"].includes(normalized)) {
    return STAGE_FAMILIES.brand;
  }
  if (["invoice_konfirmasi", "progress_produksi"].includes(normalized)) {
    return STAGE_FAMILIES.post_payment;
  }
  if (["proof_before_pelunasan"].includes(normalized)) return STAGE_FAMILIES.at_risk;
  if (["resi_pengiriman"].includes(normalized)) return STAGE_FAMILIES.shipping;

  return STAGE_FAMILIES.generic;
}

function isStageCompatibleWithProspectType(stage, prospectType) {
  const normalizedStage = normalizeSopStage(stage);
  const normalizedProspect = normalizeProspectType(prospectType);

  if (!normalizedStage) return false;
  if (isFollowupStage(normalizedStage)) return normalizedProspect === "none";

  if (normalizedProspect === "at_risk") {
    return [
      "invoice_konfirmasi",
      "progress_produksi",
      "proof_before_pelunasan",
      "resi_pengiriman",
    ].includes(normalizedStage);
  }

  if (normalizedProspect === "post_payment") {
    return [
      "invoice_konfirmasi",
      "brand_development",
      "progress_produksi",
      "resi_pengiriman",
    ].includes(normalizedStage);
  }

  if (normalizedProspect === "brand") {
    return [
      "prospek_brand",
      "form_terkirim",
      "dp_request",
      "invoice_konfirmasi",
      "brand_development",
      "progress_produksi",
      "resi_pengiriman",
    ].includes(normalizedStage);
  }

  if (normalizedProspect === "sample") {
    return [
      "prospek_sample",
      "invoice_konfirmasi",
      "progress_produksi",
      "resi_pengiriman",
    ].includes(normalizedStage);
  }

  return [
    "greeting_awal",
    "share_info_tanya_balik",
    "harga_paket_terkirim",
  ].includes(normalizedStage);
}

function isKnownStage(stage) {
  const rawStage = safeString(stage);
  if (!rawStage) return false;

  const normalized = normalizeSopStage(rawStage);
  if (!normalized) return false;

  return Boolean(
    getSopStageConfig(normalized) ||
      STAGE_ORDER[normalized]
  );
}

function isFollowupStage(stage) {
  return Object.prototype.hasOwnProperty.call(
    FOLLOWUP_STAGE_TO_TYPE,
    normalizeSopStage(stage)
  );
}

function mapFollowupStageToType(stage) {
  return FOLLOWUP_STAGE_TO_TYPE[normalizeSopStage(stage)] || "";
}

function mapFollowupTypeToStage(type) {
  return TYPE_TO_FOLLOWUP_STAGE[safeString(type)] || "";
}

function inferLastCompletedFollowupType({ analysis, context }) {
  const explicitType = safeString(context.last_followup_type || "").toLowerCase();
  if (explicitType && getNoResponseFollowupByType(explicitType)) {
    return explicitType;
  }

  const currentStage = normalizeSopStage(analysis.sop_stage_current);
  if (isFollowupStage(currentStage)) {
    return mapFollowupStageToType(currentStage);
  }

  const actionText = safeString(context.last_cs_action || "").toLowerCase();
  if (!actionText) return "";

  if (containsAny(actionText, ["contoh produk", "produk contoh"])) {
    return "contoh_produk";
  }
  if (containsAny(actionText, ["konten", "design", "desain"])) {
    return "konten_dan_design";
  }
  if (containsAny(actionText, ["testimoni", "testi"])) {
    return "testimoni";
  }
  if (containsAny(actionText, ["sample"])) {
    return "penawaran_sample";
  }
  if (containsAny(actionText, ["bukti transfer", "transfer"])) {
    return "bukti_transfer";
  }
  if (containsAny(actionText, ["progress"])) {
    return "tanya_progress";
  }

  return "";
}

function getNextNoResponseFollowupLocal(type) {
  const safeType = safeString(type);
  if (!safeType) {
    return NO_RESPONSE_FOLLOWUP_SEQUENCE[0] || null;
  }

  const sequence = Array.isArray(NO_RESPONSE_FOLLOWUP_SEQUENCE)
    ? NO_RESPONSE_FOLLOWUP_SEQUENCE
    : [];

  const index = sequence.findIndex(
    (item) => safeString(item?.type) === safeType
  );

  if (index === -1) {
    return sequence[0] || null;
  }

  if (index >= sequence.length - 1) {
    return sequence[index] || null;
  }

  return sequence[index + 1] || null;
}

/* ---------------------------------
   Normalization
---------------------------------- */

function normalizeUnifiedAnalysis(input = {}) {
  const raw = toRecord(input);
  const normalized = toRecord(normalizeAnalysisTaxonomy(raw));

  const suggestedReply = safeString(
    raw.suggested_reply ||
      raw.suggested_response ||
      normalized.suggested_reply ||
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

    pipeline_meta: sanitizePlainObject(raw.pipeline_meta),
    detection_meta: sanitizePlainObject(raw.detection_meta),
    stage_meta: sanitizePlainObject(raw.stage_meta),
  };
}

function sanitizeSopContext(input = {}) {
  const src = toRecord(input);

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
    last_cs_action: safeString(src.last_cs_action || ""),
    last_followup_type: safeString(src.last_followup_type || ""),
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

function buildStageResolution(input = {}) {
  const raw = toRecord(input);
  const current = normalizeSopStage(raw.current || DEFAULT_ANALYSIS.sop_stage_current);
  const next = normalizeSopStage(raw.next || DEFAULT_ANALYSIS.sop_stage_next);

  return {
    current,
    next,
    stage_family: safeString(raw.stage_family || STAGE_FAMILIES.generic),
    stage_reason: safeString(raw.stage_reason || "stage_resolution"),
    followup_type_current: safeString(raw.followup_type_current || ""),
    followup_type_next: safeString(raw.followup_type_next || ""),
  };
}

/* ---------------------------------
   Uncertainty
---------------------------------- */

function buildStageUncertaintyNote({ analysis, context, stageResolution }) {
  const notes = [];

  if (
    analysis.pipeline === "no_respons" &&
    !context.last_followup_type &&
    !context.last_cs_action &&
    stageResolution.stage_reason === "start_default_no_response_sequence"
  ) {
    notes.push("Urutan follow-up no respons dimulai dari default SOP karena riwayat follow-up terakhir belum eksplisit.");
  }

  if (
    analysis.prospect_type === "brand" &&
    !context.has_form_sent &&
    !context.has_form_filled &&
    stageResolution.current === "prospek_brand"
  ) {
    notes.push("Jalur brand sudah jelas, tetapi status form brand belum terkonfirmasi.");
  }

  if (
    analysis.prospect_type === "sample" &&
    !context.has_invoice_sent &&
    stageResolution.current === "prospek_sample"
  ) {
    notes.push("Jalur sample terdeteksi, tetapi invoice atau pembayaran sample belum terlihat.");
  }

  if (
    analysis.prospect_type === "post_payment" &&
    !context.has_dp_paid &&
    !context.has_invoice_sent &&
    !context.has_resi_sent
  ) {
    notes.push("Tahap post-payment terutama dibaca dari hasil final analysis, bukan hanya boolean pembayaran.");
  }

  if (
    analysis.prospect_type === "at_risk" &&
    !context.is_at_risk &&
    !context.has_product_proof_sent
  ) {
    notes.push("Tahap at-risk dibaca konservatif dari sinyal trust atau progress yang kuat.");
  }

  return notes.join(" ");
}

function mergeUncertaintyNotes(...values) {
  return uniqueStrings(
    (Array.isArray(values) ? values : [])
      .map((value) => safeString(value))
      .filter(Boolean)
  ).join(" ");
}

/* ---------------------------------
   Utilities
---------------------------------- */

function getStageOrder(stage) {
  return STAGE_ORDER[normalizeSopStage(stage)] || 0;
}

function sanitizeMatchedIn(value) {
  const raw = toRecord(value);
  return {
    latest: uniqueStrings(toStringArray(raw.latest)),
    tail: uniqueStrings(toStringArray(raw.tail)),
    summary: uniqueStrings(toStringArray(raw.summary)),
  };
}

function sanitizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {LooseRecord} */ (value)
    : {};
}

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {LooseRecord} */ (value)
    : {};
}

function containsAny(text, needles) {
  const haystack = safeString(text).toLowerCase();
  if (!haystack) return false;

  return (Array.isArray(needles) ? needles : []).some((needle) =>
    haystack.includes(String(needle || "").toLowerCase())
  );
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