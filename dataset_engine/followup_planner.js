// @ts-nocheck
// dataset_engine/followup_planner.js

import * as Rules from "./rules.js";
import {
  buildFollowupGapBundle,
} from "./followup_gap.js";
import {
  resolvePipelineRouteTarget,
} from "./pipeline_classifier.js";

/* ---------------------------------
   Rules bridge
---------------------------------- */

/** @type {Record<string, any>} */
const RULES_ANY = /** @type {Record<string, any>} */ (Rules);

const DEFAULT_ANALYSIS = /** @type {Record<string, any>} */ (
  RULES_ANY.DEFAULT_ANALYSIS ||
    Object.freeze({
      rule_id: "default_analysis",
      dataset_row_id: "",
      dataset_row_label: "default_analysis",

      pipeline: "respons",
      lead_level: "cold",
      lead_level_stage: "cold",
      emotion: "curiosity",
      intent: "exploration",
      behaviour_stage: "curiosity",
      customer_profile: "",

      sop_stage_current: "greeting_awal",
      sop_stage_next: "share_info_tanya_balik",
      followup_gap: "",

      priority: "medium",
      priority_level: "medium",
      prospect_type: "none",
      should_upgrade_to_prospek: false,

      cs_action: "",
      suggested_reply: "",
      suggested_response: "",

      route_target: "",
      required_artifacts: [],
      required_artifacts_final: [],
      next_required_artifact: "",
      execute_mode_final: "",
      plan_type_final: "",

      reply_source: "unknown",
      action_source: "unknown",
      confidence_source: "unknown",
      render_mode: "canonical_only",
      note_publish_strategy: "single_canonical_note",
      canonical_analysis_version: "planner_v2_canonical",

      tag_emotion: "curiosity",
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
      followup_meta: {},
      followup_plan: {},
      planner_meta: {},
    })
);

const normalizeAnalysisTaxonomy =
  typeof RULES_ANY.normalizeAnalysisTaxonomy === "function"
    ? RULES_ANY.normalizeAnalysisTaxonomy
    : (value) => (value && typeof value === "object" ? value : {});

const normalizePipeline =
  typeof RULES_ANY.normalizePipeline === "function"
    ? RULES_ANY.normalizePipeline
    : (value) => normalizeEnum(value, ["no_respons", "respons", "prospek"], "respons");

const normalizeLeadLevel =
  typeof RULES_ANY.normalizeLeadLevel === "function"
    ? RULES_ANY.normalizeLeadLevel
    : typeof RULES_ANY.normalizeLeadLevelStage === "function"
      ? RULES_ANY.normalizeLeadLevelStage
      : (value) =>
          normalizeEnum(
            value,
            ["cold", "warm", "warm_hot", "hot", "hot_at_risk"],
            "cold"
          );

const normalizePriorityLevel =
  typeof RULES_ANY.normalizePriorityLevel === "function"
    ? RULES_ANY.normalizePriorityLevel
    : (value) => normalizeEnum(value, ["low", "medium", "high", "urgent"], "medium");

const normalizeProspectType =
  typeof RULES_ANY.normalizeProspectType === "function"
    ? RULES_ANY.normalizeProspectType
    : (value) =>
        normalizeEnum(value, ["none", "sample", "brand", "post_payment", "at_risk"], "none");

const normalizeIntent =
  typeof RULES_ANY.normalizeIntent === "function"
    ? RULES_ANY.normalizeIntent
    : (value) =>
        normalizeEnum(
          value,
          [
            "exploration",
            "trust",
            "trial",
            "price",
            "price_process",
            "purchase",
            "branding",
            "support",
            "recovery",
            "fulfillment",
            "trust_recovery",
            "unknown",
          ],
          "unknown"
        );

const normalizeEmotion =
  typeof RULES_ANY.normalizeEmotion === "function"
    ? RULES_ANY.normalizeEmotion
    : (value) =>
        normalizeEnum(
          value,
          [
            "curiosity",
            "discovery",
            "trust_seeking",
            "risk_aversion",
            "budget_concern",
            "analytical_thinking",
            "visual_validation",
            "purchase_readiness",
            "brand_ownership",
            "educational_support",
            "trust_anxiety",
            "progress_anxiety",
            "proof_seeking",
            "unknown",
          ],
          "unknown"
        );

const normalizeBehaviourStage =
  typeof RULES_ANY.normalizeBehaviourStage === "function"
    ? RULES_ANY.normalizeBehaviourStage
    : (value) =>
        normalizeEnum(
          value,
          [
            "curiosity",
            "interest",
            "evaluation",
            "decision",
            "post_decision",
            "post_purchase",
            "pre_pelunasan",
          ],
          "curiosity"
        );

const normalizeSopStage =
  typeof RULES_ANY.normalizeSopStage === "function"
    ? RULES_ANY.normalizeSopStage
    : (value) =>
        normalizeEnum(
          value,
          [
            "greeting_awal",
            "share_info_tanya_balik",
            "harga_paket_terkirim",
            "prospek_sample",
            "prospek_brand",
            "form_terkirim",
            "dp_request",
            "invoice_konfirmasi",
            "brand_development",
            "progress_produksi",
            "proof_before_pelunasan",
            "resi_pengiriman",
            "followup_contoh_produk",
            "followup_konten_design",
            "followup_testimoni",
            "followup_penawaran_sample",
            "followup_bukti_transfer",
            "followup_progress",
          ],
          "share_info_tanya_balik"
        );

const normalizeBrandChannel =
  typeof RULES_ANY.normalizeBrandChannel === "function"
    ? RULES_ANY.normalizeBrandChannel
    : (value) => normalizeEnum(value, ["mtz", "pcg", "grosir", "unknown"], "unknown");

const NO_RESPONSE_FOLLOWUP_SEQUENCE = Array.isArray(RULES_ANY.NO_RESPONSE_FOLLOWUP_SEQUENCE)
  ? RULES_ANY.NO_RESPONSE_FOLLOWUP_SEQUENCE
  : [];

const getNoResponseFollowupByType =
  typeof RULES_ANY.getNoResponseFollowupByType === "function"
    ? RULES_ANY.getNoResponseFollowupByType
    : null;

/* ---------------------------------
   Planner constants
---------------------------------- */

const EXECUTE_MODES = Object.freeze({
  send_now: "send_now",
  wait_then_send: "wait_then_send",
  verify_then_send: "verify_then_send",
});

const PLAN_TYPES = Object.freeze({
  no_respons_followup: "no_respons_followup",
  respons_qualification: "respons_qualification",
  sample_closing: "sample_closing",
  brand_closing: "brand_closing",
  post_payment_update: "post_payment_update",
  at_risk_recovery: "at_risk_recovery",
  generic_next_step: "generic_next_step",
});

const PLAN_TYPE_TO_PROSPECT_TYPE = Object.freeze({
  [PLAN_TYPES.no_respons_followup]: "none",
  [PLAN_TYPES.respons_qualification]: "none",
  [PLAN_TYPES.sample_closing]: "sample",
  [PLAN_TYPES.brand_closing]: "brand",
  [PLAN_TYPES.post_payment_update]: "post_payment",
  [PLAN_TYPES.at_risk_recovery]: "at_risk",
  [PLAN_TYPES.generic_next_step]: "none",
});

const PLAN_TYPE_TO_ROUTE_TARGET = Object.freeze({
  [PLAN_TYPES.no_respons_followup]: "no_respons_followup_composer",
  [PLAN_TYPES.respons_qualification]: "respons_qualification_composer",
  [PLAN_TYPES.sample_closing]: "prospek_closing_composer",
  [PLAN_TYPES.brand_closing]: "prospek_closing_composer",
  [PLAN_TYPES.post_payment_update]: "post_payment_progress_composer",
  [PLAN_TYPES.at_risk_recovery]: "at_risk_recovery_composer",
  [PLAN_TYPES.generic_next_step]: "respons_qualification_composer",
});

const FOLLOWUP_STAGE_TO_TYPE = Object.freeze({
  followup_contoh_produk: "contoh_produk",
  followup_konten_design: "konten_dan_design",
  followup_testimoni: "testimoni",
  followup_penawaran_sample: "penawaran_sample",
  followup_bukti_transfer: "bukti_transfer",
  followup_progress: "tanya_progress",
});

const FALLBACK_ACTION_CODE_BY_GAP = Object.freeze({
  no_response_contoh_produk: "send_product_examples_followup",
  no_response_konten_design: "send_design_reference_followup",
  no_response_testimoni: "send_testimonial_followup",
  no_response_penawaran_sample: "offer_sample_followup",
  no_response_bukti_transfer: "send_trust_proof_followup",
  no_response_progress: "light_progress_followup",

  qualification_legality_detail: "clarify_legality_and_documents",
  qualification_sample_comparison: "compare_sample_vs_production",
  qualification_budget_scenario: "send_budget_scenario",
  qualification_analytical_breakdown: "send_qty_breakdown",
  qualification_visual_proof: "send_visual_proof",
  qualification_package_detail: "send_package_breakdown",
  qualification_purchase_lock: "lock_next_closing_step",

  sample_invoice: "send_sample_offer_and_payment_step",
  sample_progress: "verify_sample_progress",
  brand_form: "send_brand_form",
  brand_dp_invoice: "send_brand_offer_and_invoice",
  brand_development: "continue_brand_brief",
  post_payment_confirmation: "verify_payment_or_invoice",
  post_payment_progress: "verify_progress_and_eta",
  post_payment_shipping: "send_shipping_confirmation",
  at_risk_proof: "verify_and_send_concrete_proof",
  at_risk_progress: "verify_and_send_real_status",
  at_risk_trust: "send_trust_reassurance_with_proof",
  generic: "close_nearest_gap",
});

const FALLBACK_GUARDRAILS_BY_PLAN_TYPE = Object.freeze({
  [PLAN_TYPES.no_respons_followup]: Object.freeze([
    "hindari hard closing terlalu cepat",
    "ikuti urutan follow-up bertahap",
    "gunakan materi yang paling relevan dengan gap customer",
  ]),

  [PLAN_TYPES.respons_qualification]: Object.freeze([
    "tutup gap paling dekat dengan detail konkret",
    "jangan melebar ke topik yang belum diminta",
    "gunakan angka, dokumen, atau contoh yang relevan jika tersedia",
  ]),

  [PLAN_TYPES.sample_closing]: Object.freeze([
    "jelaskan fungsi sample dengan jelas",
    "jangan lompat ke progress produksi jika belum waktunya",
    "gunakan rincian sample yang aktual",
  ]),

  [PLAN_TYPES.brand_closing]: Object.freeze([
    "jaga alur brand tetap rapi",
    "gunakan langkah administrasi resmi",
    "jangan klaim progress yang belum ada",
  ]),

  [PLAN_TYPES.post_payment_update]: Object.freeze([
    "cek status aktual dulu sebelum kirim update",
    "hindari janji umum tanpa data order",
    "gunakan ETA atau resi hanya jika benar tersedia",
  ]),

  [PLAN_TYPES.at_risk_recovery]: Object.freeze([
    "wajib proof konkret jika menyentuh trust atau progres",
    "hindari jawaban umum",
    "fokus menurunkan kecemasan customer",
  ]),

  [PLAN_TYPES.generic_next_step]: Object.freeze([
    "fokus ke gap prioritas terdekat",
    "jangan mengubah arah percakapan terlalu jauh",
    "gunakan data yang benar-benar tersedia",
  ]),
});

const LEAD_LEVEL_ORDER = Object.freeze([
  "cold",
  "warm",
  "warm_hot",
  "hot",
  "hot_at_risk",
]);

const PRIORITY_ORDER = Object.freeze([
  "low",
  "medium",
  "high",
  "urgent",
]);

const VERIFY_REQUIRED_ARTIFACTS = Object.freeze([
  "status_real_order",
  "eta",
  "eta_tahap_berikutnya",
  "resi_pengiriman",
  "proof_real_order",
  "foto_real_produk",
  "video_packing",
  "konfirmasi_pembayaran",
  "invoice",
  "status_progress_sample",
]);

/* ---------------------------------
   Public API
---------------------------------- */

export function planFollowup(input = {}) {
  return buildFollowupPlannerBundle(input).final;
}

export function detectFollowupPlanOnly(input = {}) {
  const bundle = buildFollowupPlannerBundle(input);

  return {
    followup_plan: bundle.final.followup_plan,
    planner_meta: bundle.final.planner_meta,
    route_target: bundle.final.route_target,
    required_artifacts_final: bundle.final.required_artifacts_final,
    next_required_artifact: bundle.final.next_required_artifact,
    execute_mode_final: bundle.final.execute_mode_final,
    plan_type_final: bundle.final.plan_type_final,
    suggested_response: bundle.final.suggested_response,
    cs_action: bundle.final.cs_action,
    confidence_score: bundle.final.confidence_score,
  };
}

export function buildFollowupPlannerBundle(input = {}) {
  const src = asPlainObject(input);
  const context = sanitizePlannerContext(src);

  const baseAnalysis =
    src.finalAnalysis && typeof src.finalAnalysis === "object"
      ? normalizeUnifiedAnalysis(src.finalAnalysis)
      : src.gapAnalysis && typeof src.gapAnalysis === "object"
        ? normalizeUnifiedAnalysis(src.gapAnalysis)
        : src.gapBundle && typeof src.gapBundle === "object"
          ? normalizeUnifiedAnalysis(src.gapBundle.final || {})
          : normalizeUnifiedAnalysis(
              buildFollowupGapBundle({
                ...src,
                ...context,
              }).final || {}
            );

  const followupPlan = resolveFollowupPlan({
    analysis: baseAnalysis,
    context,
  });

  const final = applyFollowupPlan({
    analysis: baseAnalysis,
    context,
    followupPlan,
  });

  return {
    context,
    base_analysis: baseAnalysis,
    followup_plan: followupPlan,
    final,
  };
}

export function resolveFollowupPlan(input = {}) {
  const src = asPlainObject(input);
  const analysis = normalizeUnifiedAnalysis(
    src.analysis || src.finalAnalysis || {}
  );
  const context = sanitizePlannerContext(src.context || src);

  const planType = derivePlanType({ analysis, context });
  const gapKey = safeString(analysis.followup_meta?.gap_key || "");
  const gapCategory = safeString(analysis.followup_meta?.gap_category || "");
  void gapCategory;

  const prospectType = deriveCanonicalProspectType({
    analysis,
    context,
    followupPlan: { plan_type: planType },
  });

  const routeTarget = resolveRouteTarget({
    pipeline: analysis.pipeline,
    planType,
    prospectType,
  });

  const planDefinition = resolvePlanDefinition({
    gapKey,
    planType,
    currentStage: analysis.sop_stage_current,
  });

  const requiredArtifacts = deriveRequiredArtifacts({
    analysis,
    planDefinition,
    gapKey,
    planType,
  });

  const missingStateFlags = deriveMissingStateFlags({
    analysis,
    context,
    requiredArtifacts,
    planType,
  });

  const nextActionCode = deriveNextActionCode({
    analysis,
    gapKey,
    planType,
    planDefinition,
  });

  const executeMode = deriveExecuteMode({
    analysis,
    context,
    gapKey,
    requiredArtifacts,
    planType,
  });

  const recommendedDelayHours = deriveRecommendedDelayHours({
    analysis,
    context,
    executeMode,
    planType,
  });

  const guardrails = deriveGuardrails({
    analysis,
    context,
    planType,
    gapKey,
    planDefinition,
  });

  return sanitizeFollowupPlan({
    plan_type: planType,
    next_action_code: nextActionCode,
    execute_mode: executeMode,
    recommended_delay_hours: recommendedDelayHours,
    required_artifacts: requiredArtifacts,
    missing_state_flags: missingStateFlags,
    guardrails,
    route_target: routeTarget,
    plan_reason: safeString(planDefinition.reason || buildPlanReason(gapKey, planType)),
    gap_reference: safeString(
      analysis.followup_meta?.gap_key ||
        analysis.followup_gap ||
        ""
    ),
  });
}

/* ---------------------------------
   Final application
---------------------------------- */

function applyFollowupPlan({ analysis, context, followupPlan }) {
  const base = normalizeUnifiedAnalysis(analysis);
  const plan = sanitizeFollowupPlan(followupPlan);

  const canonicalOverrides = buildPlannerCanonicalOverrides({
    analysis: base,
    context,
    followupPlan: plan,
  });

  const finalStatusFlags = mergePlainObjects(
    base.status_flags,
    {
      is_at_risk: canonicalOverrides.prospect_type === "at_risk",
      is_post_payment: canonicalOverrides.prospect_type === "post_payment",
      planner_canonicalized: true,
      planner_requires_single_render: true,
    }
  );

  const finalFollowupMeta = mergePlainObjects(
    base.followup_meta,
    {
      next_required_artifact: canonicalOverrides.next_required_artifact,
      required_artifacts_final: canonicalOverrides.required_artifacts_final,
      execute_mode_final: canonicalOverrides.execute_mode_final,
      plan_type_final: canonicalOverrides.plan_type_final,
    }
  );

  return normalizeUnifiedAnalysis({
    ...base,

    raw_model_suggested_response: safeString(base.suggested_response || base.suggested_reply),
    raw_model_cs_action: safeString(base.cs_action),
    raw_model_confidence_score: toSafeNumber(base.confidence_score),

    ...canonicalOverrides,

    uncertainty_note: mergeNotes(
      base.uncertainty_note,
      buildPlannerUncertaintyNote({
        analysis: {
          ...base,
          ...canonicalOverrides,
        },
        context,
        followupPlan: plan,
      })
    ),

    status_flags: finalStatusFlags,
    followup_meta: finalFollowupMeta,
    followup_plan: plan,

    planner_meta: mergePlainObjects(
      base.planner_meta,
      {
        route_target: canonicalOverrides.route_target,
        execute_mode: plan.execute_mode,
        recommended_delay_hours: plan.recommended_delay_hours,
        next_action_code: plan.next_action_code,
        plan_type: plan.plan_type,
        required_artifact_count: plan.required_artifacts.length,
        missing_state_flag_count: plan.missing_state_flags.length,
        current_stage: normalizeSopStage(base.sop_stage_current),
        next_stage: normalizeSopStage(base.sop_stage_next),
        pipeline: normalizePipeline(base.pipeline),
        base_prospect_type: normalizeProspectType(base.prospect_type),
        prospect_type: canonicalOverrides.prospect_type,
        gap_key: safeString(base.followup_meta?.gap_key || ""),
        gap_category: safeString(base.followup_meta?.gap_category || ""),
        gap_priority_reason: safeString(base.followup_meta?.gap_priority_reason || ""),
        primary_artifact: canonicalOverrides.next_required_artifact,
        reply_source: canonicalOverrides.reply_source,
        action_source: canonicalOverrides.action_source,
        confidence_source: canonicalOverrides.confidence_source,
        render_mode: canonicalOverrides.render_mode,
        note_publish_strategy: canonicalOverrides.note_publish_strategy,
        canonical_analysis_version: canonicalOverrides.canonical_analysis_version,
        planner_owned_fields: [
          "prospect_type",
          "priority_level",
          "lead_level_stage",
          "behaviour_stage",
          "route_target",
          "required_artifacts_final",
          "next_required_artifact",
          "execute_mode_final",
          "plan_type_final",
          "cs_action",
          "suggested_response",
          "confidence_score",
        ],
      }
    ),
  });
}

function buildPlannerCanonicalOverrides({ analysis, context, followupPlan }) {
  const plan = sanitizeFollowupPlan(followupPlan);

  const prospectType = deriveCanonicalProspectType({
    analysis,
    context,
    followupPlan: plan,
  });

  const priorityLevel = deriveCanonicalPriorityLevel({
    analysis,
    context,
    followupPlan: plan,
    prospectType,
  });

  const leadLevel = deriveCanonicalLeadLevel({
    analysis,
    followupPlan: plan,
    prospectType,
    priorityLevel,
  });

  const behaviourStage = deriveCanonicalBehaviourStage({
    analysis,
    followupPlan: plan,
    prospectType,
  });

  const routeTarget = resolveRouteTarget({
    pipeline: analysis.pipeline,
    planType: plan.plan_type,
    prospectType,
  });

  const requiredArtifactsFinal = uniqueStrings(toStringArray(plan.required_artifacts));
  const nextRequiredArtifact = safeString(firstArrayItem(requiredArtifactsFinal));
  const executeModeFinal = safeString(plan.execute_mode || EXECUTE_MODES.send_now);
  const planTypeFinal = safeString(plan.plan_type || PLAN_TYPES.generic_next_step);

  const actionDecision = buildCanonicalCsAction({
    analysis,
    context,
    followupPlan: plan,
    prospectType,
    requiredArtifactsFinal,
  });

  const replyDecision = buildCanonicalSuggestedResponse({
    analysis,
    context,
    followupPlan: plan,
    prospectType,
    requiredArtifactsFinal,
  });

  const confidenceScore = derivePlannerConfidenceScore({
    analysis,
    context,
    followupPlan: plan,
    prospectType,
    requiredArtifactsFinal,
    replySource: replyDecision.source,
    actionSource: actionDecision.source,
  });

  return {
    prospect_type: prospectType,
    should_upgrade_to_prospek: Boolean(
      analysis.should_upgrade_to_prospek ||
        ["sample", "brand", "post_payment", "at_risk"].includes(prospectType) ||
        normalizePipeline(analysis.pipeline) === "prospek"
    ),

    priority: priorityLevel,
    priority_level: priorityLevel,

    lead_level: leadLevel,
    lead_level_stage: leadLevel,

    behaviour_stage: behaviourStage,

    route_target: routeTarget,

    required_artifacts: requiredArtifactsFinal,
    required_artifacts_final: requiredArtifactsFinal,
    next_required_artifact: nextRequiredArtifact,

    execute_mode_final: executeModeFinal,
    plan_type_final: planTypeFinal,

    cs_action: actionDecision.text,
    suggested_reply: replyDecision.text,
    suggested_response: replyDecision.text,

    confidence_score: confidenceScore,

    reply_source: replyDecision.source,
    action_source: actionDecision.source,
    confidence_source: "planner_adjusted",

    render_mode: "canonical_only",
    note_publish_strategy: "single_canonical_note",
    canonical_analysis_version: "planner_v2_canonical",
  };
}

/* ---------------------------------
   Canonical derivation
---------------------------------- */

function derivePlanType(input = {}) {
  const src = asPlainObject(input);
  const analysis = normalizeUnifiedAnalysis(src.analysis || input);
  const context = sanitizePlannerContext(src.context || {});
  const pipeline = normalizePipeline(analysis.pipeline);
  const prospectType = normalizeProspectType(analysis.prospect_type);
  const gapKey = safeString(analysis.followup_meta?.gap_key || "");
  const statusFlags = sanitizePlainObject(analysis.status_flags);

  if (pipeline === "no_respons") return PLAN_TYPES.no_respons_followup;

  if (
    prospectType === "at_risk" ||
    context.is_at_risk ||
    statusFlags.is_at_risk === true ||
    gapKey.startsWith("at_risk_")
  ) {
    return PLAN_TYPES.at_risk_recovery;
  }

  if (
    prospectType === "post_payment" ||
    context.is_post_payment ||
    statusFlags.is_post_payment === true ||
    gapKey.startsWith("post_payment_")
  ) {
    return PLAN_TYPES.post_payment_update;
  }

  if (prospectType === "brand") return PLAN_TYPES.brand_closing;
  if (prospectType === "sample") return PLAN_TYPES.sample_closing;
  if (pipeline === "respons") return PLAN_TYPES.respons_qualification;

  return PLAN_TYPES.generic_next_step;
}

function deriveCanonicalProspectType({ analysis, context, followupPlan }) {
  const planType = safeString(followupPlan?.plan_type || "");
  const mapped = PLAN_TYPE_TO_PROSPECT_TYPE[planType] || "";

  if (mapped && mapped !== "none") return mapped;
  if (context.is_at_risk) return "at_risk";
  if (context.is_post_payment) return "post_payment";

  return normalizeProspectType(analysis.prospect_type);
}

function deriveCanonicalPriorityLevel({ analysis, context, followupPlan, prospectType }) {
  void context;

  const current = normalizePriorityLevel(analysis.priority || analysis.priority_level);
  const planType = safeString(followupPlan?.plan_type || "");
  const executeMode = safeString(followupPlan?.execute_mode || "");

  if (prospectType === "at_risk" || planType === PLAN_TYPES.at_risk_recovery) {
    return "urgent";
  }

  if (prospectType === "post_payment" || planType === PLAN_TYPES.post_payment_update) {
    return executeMode === EXECUTE_MODES.verify_then_send
      ? maxPriority(current, "high")
      : maxPriority(current, "medium");
  }

  if (["brand", "sample"].includes(prospectType) || normalizePipeline(analysis.pipeline) === "prospek") {
    return maxPriority(current, "high");
  }

  if (planType === PLAN_TYPES.no_respons_followup) {
    return maxPriority(current, "medium");
  }

  return current;
}

function deriveCanonicalLeadLevel({ analysis, followupPlan, prospectType, priorityLevel }) {
  const current = normalizeLeadLevel(analysis.lead_level_stage || analysis.lead_level);
  const planType = safeString(followupPlan?.plan_type || "");

  if (prospectType === "at_risk" || planType === PLAN_TYPES.at_risk_recovery) {
    return "hot_at_risk";
  }

  if (prospectType === "post_payment" || planType === PLAN_TYPES.post_payment_update) {
    return maxLeadLevel(current, "hot");
  }

  if (priorityLevel === "urgent") {
    return maxLeadLevel(current, "hot");
  }

  if (["brand", "sample"].includes(prospectType) || normalizePipeline(analysis.pipeline) === "prospek") {
    return maxLeadLevel(current, "warm_hot");
  }

  return current;
}

function deriveCanonicalBehaviourStage({ analysis, followupPlan, prospectType }) {
  const current = normalizeBehaviourStage(analysis.behaviour_stage);
  const planType = safeString(followupPlan?.plan_type || "");

  if (prospectType === "at_risk" || planType === PLAN_TYPES.at_risk_recovery) {
    return "post_purchase";
  }

  if (prospectType === "post_payment" || planType === PLAN_TYPES.post_payment_update) {
    return current === "pre_pelunasan" ? "pre_pelunasan" : "post_purchase";
  }

  if ([PLAN_TYPES.brand_closing, PLAN_TYPES.sample_closing].includes(planType)) {
    return ["curiosity", "interest", "evaluation"].includes(current)
      ? "decision"
      : current;
  }

  return current;
}

function buildCanonicalCsAction({
  analysis,
  context,
  followupPlan,
  prospectType,
  requiredArtifactsFinal,
}) {
  const current = safeString(analysis.cs_action);
  const planType = safeString(followupPlan?.plan_type || "");
  const executeMode = safeString(followupPlan?.execute_mode || "");
  const nextArtifact = safeString(firstArrayItem(requiredArtifactsFinal));

  if (planType === PLAN_TYPES.at_risk_recovery || prospectType === "at_risk") {
    return {
      text: "verifikasi status/order real terlebih dulu, siapkan proof konkret, lalu jawab dengan bukti spesifik sebelum memberi janji progres.",
      source: "planner_override",
    };
  }

  if (planType === PLAN_TYPES.post_payment_update || prospectType === "post_payment") {
    if (executeMode === EXECUTE_MODES.send_now && context.has_resi_sent) {
      return {
        text: "kirim konfirmasi pengiriman yang sudah tersedia, sertakan nomor resi atau status kirim aktual.",
        source: "planner_override",
      };
    }

    return {
      text: "cek status aktual order atau pengiriman terlebih dulu, lalu kirim update yang sesuai data real beserta ETA atau resi jika memang tersedia.",
      source: "planner_override",
    };
  }

  if (planType === PLAN_TYPES.no_respons_followup) {
    const fallbackText = current || "lanjutkan follow-up bertahap sesuai gap paling relevan, tetap singkat dan tidak hard closing terlalu cepat.";
    return {
      text: fallbackText,
      source: current ? "model_output" : "planner_fallback",
    };
  }

  if (
    executeMode === EXECUTE_MODES.verify_then_send ||
    requiredArtifactsFinal.some((artifact) => VERIFY_REQUIRED_ARTIFACTS.includes(artifact))
  ) {
    return {
      text: `verifikasi ${humanizeForSentence(nextArtifact || "data real yang dibutuhkan")} terlebih dulu, lalu jawab dengan detail yang sudah terkonfirmasi.`,
      source: "planner_override",
    };
  }

  return {
    text: current || "tutup gap terdekat dengan detail konkret dan arahkan ke next step yang paling realistis.",
    source: current ? "model_output" : "planner_fallback",
  };
}

function buildCanonicalSuggestedResponse({
  analysis,
  context,
  followupPlan,
  prospectType,
  requiredArtifactsFinal,
}) {
  void context;

  const current = safeString(analysis.suggested_response || analysis.suggested_reply);
  const planType = safeString(followupPlan?.plan_type || "");
  const executeMode = safeString(followupPlan?.execute_mode || "");
  const nextArtifact = safeString(firstArrayItem(requiredArtifactsFinal));

  if (planType === PLAN_TYPES.at_risk_recovery || prospectType === "at_risk") {
    return {
      text: "siap kak, saya cekkan status real ordernya dulu ya. setelah terverifikasi saya update detail progres beserta bukti yang tersedia supaya lebih jelas.",
      source: "planner_override",
    };
  }

  if (planType === PLAN_TYPES.post_payment_update || prospectType === "post_payment") {
    if (executeMode === EXECUTE_MODES.send_now && context.has_resi_sent) {
      return {
        text: "siap kak, untuk status kirimnya sudah ada ya. saya kirimkan update pengiriman beserta data resinya supaya bisa langsung dicek.",
        source: "planner_override",
      };
    }

    return {
      text: "siap kak, saya cek status real ordernya dulu ya supaya update yang saya kirim akurat. setelah itu saya informasikan detail progresnya, termasuk estimasi atau resi kalau memang sudah tersedia.",
      source: "planner_override",
    };
  }

  if (
    executeMode === EXECUTE_MODES.verify_then_send &&
    (
      !current ||
      isGenericOperationalReply(current) ||
      requiredArtifactsFinal.some((artifact) => VERIFY_REQUIRED_ARTIFACTS.includes(artifact))
    )
  ) {
    return {
      text: `siap kak, saya cek ${humanizeForSentence(nextArtifact || "data realnya")} dulu ya supaya informasi yang saya kirim akurat. setelah terverifikasi saya update detailnya.`,
      source: "planner_override",
    };
  }

  return {
    text:
      current ||
      "siap kak, saya bantu arahkan ke langkah berikutnya yang paling pas berdasarkan kebutuhan kakak sekarang.",
    source: current ? "model_output" : "planner_fallback",
  };
}

function derivePlannerConfidenceScore({
  analysis,
  context,
  followupPlan,
  prospectType,
  requiredArtifactsFinal,
  replySource,
  actionSource,
}) {
  let score = clampNumber(toSafeNumber(analysis.confidence_score), 20, 98);

  if (safeString(followupPlan?.execute_mode || "") === EXECUTE_MODES.verify_then_send) {
    score -= 8;
  }

  if (safeString(followupPlan?.plan_type || "") === PLAN_TYPES.at_risk_recovery || prospectType === "at_risk") {
    score -= 10;
  }

  if (Array.isArray(followupPlan?.missing_state_flags) && followupPlan.missing_state_flags.length > 0) {
    score -= Math.min(12, followupPlan.missing_state_flags.length * 4);
  }

  if (
    requiredArtifactsFinal.some((artifact) =>
      ["proof_real_order", "foto_real_produk", "video_packing"].includes(artifact)
    ) &&
    !context.has_product_proof_sent
  ) {
    score -= 6;
  }

  if (
    requiredArtifactsFinal.includes("resi_pengiriman") &&
    !context.has_resi_sent
  ) {
    score -= 4;
  }

  if (replySource === "planner_override") {
    score -= 2;
  }

  if (actionSource === "planner_override") {
    score -= 2;
  }

  return clampNumber(score, 20, 98);
}

function isGenericOperationalReply(text) {
  const safe = safeString(text).toLowerCase();
  if (!safe) return true;

  return [
    "lagi diproses",
    "sedang diproses",
    "estimasi",
    "nanti saya kasih",
    "akan saya kasih",
    "akan diinfokan",
    "segera kami update",
    "segera saya update",
    "nanti saya update",
    "kami cek dulu",
  ].some((needle) => safe.includes(needle));
}

/* ---------------------------------
   Plan derivation
---------------------------------- */

function deriveNextActionCode({ analysis, gapKey, planType, planDefinition }) {
  const definition = asPlainObject(planDefinition);

  const explicit = safeString(
    definition.next_action_code ||
      definition.action_code ||
      definition.nextActionCode
  );
  if (explicit) return explicit;

  if (gapKey && FALLBACK_ACTION_CODE_BY_GAP[gapKey]) {
    return FALLBACK_ACTION_CODE_BY_GAP[gapKey];
  }

  const currentStage = normalizeSopStage(analysis.sop_stage_current);
  if (analysis.pipeline === "no_respons") {
    const followupType =
      FOLLOWUP_STAGE_TO_TYPE[currentStage] ||
      inferFollowupTypeFromLastAction(analysis.cs_action) ||
      "";
    if (followupType) {
      return FALLBACK_ACTION_CODE_BY_GAP[`no_response_${followupType}`] || "continue_no_response_followup";
    }
    return "continue_no_response_followup";
  }

  switch (planType) {
    case PLAN_TYPES.brand_closing:
      return "continue_brand_closing";
    case PLAN_TYPES.sample_closing:
      return "continue_sample_closing";
    case PLAN_TYPES.post_payment_update:
      return "continue_post_payment_update";
    case PLAN_TYPES.at_risk_recovery:
      return "continue_at_risk_recovery";
    case PLAN_TYPES.respons_qualification:
      return "continue_respons_qualification";
    default:
      return "next_action";
  }
}

function deriveRequiredArtifacts({ analysis, planDefinition, gapKey, planType }) {
  const definition = asPlainObject(planDefinition);
  const artifacts = [];

  artifacts.push(
    ...toStringArray(
      definition.required_artifacts ||
        definition.requiredArtifacts ||
        definition.artifacts
    )
  );

  artifacts.push(
    ...toStringArray(analysis.followup_meta?.required_artifacts)
  );

  if (typeof RULES_ANY.getRequiredArtifactsForPlan === "function") {
    artifacts.push(...toStringArray(RULES_ANY.getRequiredArtifactsForPlan(planType)));
  }

  if (typeof RULES_ANY.getRequiredArtifactsForGap === "function") {
    artifacts.push(...toStringArray(RULES_ANY.getRequiredArtifactsForGap(gapKey)));
  }

  if (typeof RULES_ANY.getRequiredArtifactsForStage === "function") {
    artifacts.push(
      ...toStringArray(
        RULES_ANY.getRequiredArtifactsForStage(normalizeSopStage(analysis.sop_stage_current))
      )
    );
  }

  const stageDefinition = findStageDefinition(normalizeSopStage(analysis.sop_stage_current));
  if (stageDefinition) {
    artifacts.push(
      ...toStringArray(
        stageDefinition.required_artifacts ||
          stageDefinition.requiredArtifacts ||
          stageDefinition.artifacts
      )
    );
  }

  const primaryArtifact = safeString(analysis.followup_meta?.primary_artifact || "");
  if (primaryArtifact) artifacts.unshift(primaryArtifact);

  return uniqueStrings(artifacts);
}

function deriveGuardrails({ analysis, context, planType, gapKey, planDefinition }) {
  const definition = asPlainObject(planDefinition);
  const guardrails = [];

  guardrails.push(
    ...toStringArray(
      definition.guardrails ||
        definition.plan_guardrails ||
        definition.guardrail_list
    )
  );

  if (typeof RULES_ANY.getGuardrailsForPlan === "function") {
    guardrails.push(...toStringArray(RULES_ANY.getGuardrailsForPlan(planType)));
  }

  if (typeof RULES_ANY.getGuardrailsForGap === "function") {
    guardrails.push(...toStringArray(RULES_ANY.getGuardrailsForGap(gapKey)));
  }

  if (typeof RULES_ANY.getGuardrailsForStage === "function") {
    guardrails.push(
      ...toStringArray(
        RULES_ANY.getGuardrailsForStage(normalizeSopStage(analysis.sop_stage_current))
      )
    );
  }

  const stageDefinition = findStageDefinition(normalizeSopStage(analysis.sop_stage_current));
  if (stageDefinition) {
    guardrails.push(
      ...toStringArray(
        stageDefinition.guardrails ||
          stageDefinition.plan_guardrails ||
          stageDefinition.guardrail_list
      )
    );
  }

  guardrails.push(...toStringArray(FALLBACK_GUARDRAILS_BY_PLAN_TYPE[planType]));

  if (
    normalizePipeline(analysis.pipeline) === "no_respons" &&
    context.customer_bubble_gt_5
  ) {
    guardrails.push("tetap jaga follow-up singkat walau bubble sebelumnya tinggi");
  }

  if (planType === PLAN_TYPES.at_risk_recovery) {
    guardrails.push("hindari jawaban defensif atau terlalu generik");
  }

  if (planType === PLAN_TYPES.post_payment_update) {
    guardrails.push("jangan memberi ETA bila status real belum diverifikasi");
  }

  return uniqueStrings(guardrails);
}

function deriveExecuteMode({ analysis, context, gapKey, requiredArtifacts, planType }) {
  void context;

  const pipeline = normalizePipeline(analysis.pipeline);
  const prospectType = normalizeProspectType(analysis.prospect_type);

  if (pipeline === "no_respons" || planType === PLAN_TYPES.no_respons_followup) {
    return EXECUTE_MODES.wait_then_send;
  }

  if (prospectType === "at_risk" || planType === PLAN_TYPES.at_risk_recovery) {
    return EXECUTE_MODES.verify_then_send;
  }

  if (prospectType === "post_payment" || planType === PLAN_TYPES.post_payment_update) {
    if (
      gapKey === "post_payment_shipping" &&
      context.has_resi_sent
    ) {
      return EXECUTE_MODES.send_now;
    }
    return EXECUTE_MODES.verify_then_send;
  }

  if (
    [
      "at_risk_proof",
      "at_risk_progress",
      "at_risk_trust",
      "post_payment_confirmation",
      "post_payment_progress",
      "sample_progress",
    ].includes(gapKey)
  ) {
    return EXECUTE_MODES.verify_then_send;
  }

  if (
    requiredArtifacts.some((artifact) => VERIFY_REQUIRED_ARTIFACTS.includes(artifact))
  ) {
    return EXECUTE_MODES.verify_then_send;
  }

  return EXECUTE_MODES.send_now;
}

function deriveRecommendedDelayHours({ analysis, context, executeMode, planType }) {
  void context;
  void planType;

  if (executeMode !== EXECUTE_MODES.wait_then_send) return 0;

  const currentStage = normalizeSopStage(analysis.sop_stage_current);
  const followupType = FOLLOWUP_STAGE_TO_TYPE[currentStage] || "";

  if (followupType && getNoResponseFollowupByType) {
    const cfg = getNoResponseFollowupByType(followupType);
    return toSafeNumber(cfg?.recommended_delay_hours);
  }

  if (followupType) {
    const found = NO_RESPONSE_FOLLOWUP_SEQUENCE.find(
      (item) => safeString(item?.type) === followupType
    );
    return toSafeNumber(found?.recommended_delay_hours || 24);
  }

  return 24;
}

function deriveMissingStateFlags({ analysis, context, requiredArtifacts, planType }) {
  const missing = [];

  if (
    requiredArtifacts.includes("form_brand_development") &&
    !context.has_form_sent &&
    !context.has_form_filled
  ) {
    missing.push("has_form_sent_or_has_form_filled");
  }

  if (
    requiredArtifacts.some((item) =>
      ["invoice", "konfirmasi_pembayaran", "dp_50", "instruksi_pembayaran_sample"].includes(item)
    ) &&
    !context.has_invoice_sent &&
    !context.has_dp_paid
  ) {
    missing.push("has_invoice_sent_or_has_dp_paid");
  }

  if (
    requiredArtifacts.includes("resi_pengiriman") &&
    !context.has_resi_sent
  ) {
    missing.push("has_resi_sent");
  }

  if (
    requiredArtifacts.some((item) =>
      ["proof_real_order", "foto_real_produk", "video_packing"].includes(item)
    ) &&
    !context.has_product_proof_sent
  ) {
    missing.push("has_product_proof_sent");
  }

  if (
    (normalizeProspectType(analysis.prospect_type) === "brand" || planType === PLAN_TYPES.brand_closing) &&
    !context.has_form_sent &&
    !context.has_form_filled
  ) {
    missing.push("has_form_sent_or_has_form_filled");
  }

  if (
    (normalizeProspectType(analysis.prospect_type) === "post_payment" || planType === PLAN_TYPES.post_payment_update) &&
    !context.has_invoice_sent &&
    !context.has_dp_paid
  ) {
    missing.push("has_invoice_sent_or_has_dp_paid");
  }

  return uniqueStrings(missing);
}

/* ---------------------------------
   Rules lookup
---------------------------------- */

function resolvePlanDefinition({ gapKey, planType, currentStage }) {
  const candidates = [];

  if (gapKey) {
    candidates.push(
      findPlanDefinitionByKey(gapKey),
      findOperationalDefinitionByGap(gapKey)
    );
  }

  if (currentStage) {
    candidates.push(findPlanDefinitionByStage(currentStage));
  }

  if (planType) {
    candidates.push(findPlanDefinitionByPlanType(planType));
  }

  return candidates.find(Boolean) || {};
}

function findPlanDefinitionByKey(key) {
  const catalogs = [
    RULES_ANY.FOLLOWUP_PLAN_DEFINITIONS,
    RULES_ANY.OPERATIONAL_PLAN_DEFINITIONS,
    RULES_ANY.PLAN_DEFINITIONS,
  ].filter(Boolean);

  const safeKey = safeString(key);

  for (const catalog of catalogs) {
    if (Array.isArray(catalog)) {
      const found = catalog.find(
        (item) =>
          safeString(item?.key) === safeKey ||
          safeString(item?.id) === safeKey ||
          safeString(item?.gap_key) === safeKey
      );
      if (found) return found;
    }

    if (catalog && typeof catalog === "object" && catalog[safeKey]) {
      return catalog[safeKey];
    }
  }

  if (typeof RULES_ANY.getFollowupPlanDefinition === "function") {
    return RULES_ANY.getFollowupPlanDefinition(safeKey) || null;
  }

  return null;
}

function findOperationalDefinitionByGap(gapKey) {
  const operationalCatalogs = [
    RULES_ANY.FOLLOWUP_GAP_DEFINITIONS,
    RULES_ANY.GAP_DEFINITIONS,
    RULES_ANY.SOP_GAP_DEFINITIONS,
  ].filter(Boolean);

  const safeKey = safeString(gapKey);

  for (const catalog of operationalCatalogs) {
    const found =
      Array.isArray(catalog)
        ? catalog.find(
            (item) =>
              safeString(item?.key) === safeKey ||
              safeString(item?.id) === safeKey ||
              safeString(item?.gap_key) === safeKey
          )
        : catalog?.[safeKey];

    if (found) return found;
  }

  return null;
}

function findPlanDefinitionByStage(stage) {
  const catalogs = [
    RULES_ANY.FOLLOWUP_PLAN_DEFINITIONS,
    RULES_ANY.OPERATIONAL_PLAN_DEFINITIONS,
    RULES_ANY.SOP_STAGE_DEFINITIONS,
    RULES_ANY.SOP_STAGE_RULES,
  ].filter(Boolean);

  const safeStage = normalizeSopStage(stage);

  for (const catalog of catalogs) {
    if (Array.isArray(catalog)) {
      const found = catalog.find(
        (item) =>
          normalizeSopStage(item?.stage || item?.id || item?.key) === safeStage
      );
      if (found) return found;
    }

    if (catalog && typeof catalog === "object" && catalog[safeStage]) {
      return catalog[safeStage];
    }
  }

  return null;
}

function findPlanDefinitionByPlanType(planType) {
  const catalogs = [
    RULES_ANY.FOLLOWUP_PLAN_DEFINITIONS,
    RULES_ANY.OPERATIONAL_PLAN_DEFINITIONS,
    RULES_ANY.PLAN_DEFINITIONS,
  ].filter(Boolean);

  const safeType = safeString(planType);

  for (const catalog of catalogs) {
    if (Array.isArray(catalog)) {
      const found = catalog.find(
        (item) =>
          safeString(item?.plan_type) === safeType ||
          safeString(item?.type) === safeType
      );
      if (found) return found;
    }

    if (catalog && typeof catalog === "object" && catalog[safeType]) {
      return catalog[safeType];
    }
  }

  return null;
}

function findStageDefinition(stage) {
  const catalogs = [
    RULES_ANY.SOP_STAGE_DEFINITIONS,
    RULES_ANY.SOP_STAGE_RULES,
    RULES_ANY.SOP_STAGE_MAP,
  ].filter(Boolean);

  const safeStage = normalizeSopStage(stage);

  for (const catalog of catalogs) {
    if (Array.isArray(catalog)) {
      const found = catalog.find(
        (item) =>
          normalizeSopStage(item?.stage || item?.id || item?.key) === safeStage
      );
      if (found) return found;
    }

    if (catalog && typeof catalog === "object" && catalog[safeStage]) {
      return catalog[safeStage];
    }
  }

  return null;
}

/* ---------------------------------
   Helpers
---------------------------------- */

function buildPlanReason(gapKey, planType) {
  if (gapKey) return `followup_plan_from_gap:${gapKey}`;
  return `followup_plan_from_type:${planType}`;
}

function inferFollowupTypeFromLastAction(lastAction) {
  const text = safeString(lastAction).toLowerCase();
  if (!text) return "";

  if (containsAny(text, ["contoh produk", "produk contoh"])) return "contoh_produk";
  if (containsAny(text, ["konten", "design", "desain"])) return "konten_dan_design";
  if (containsAny(text, ["testimoni", "testi"])) return "testimoni";
  if (containsAny(text, ["sample"])) return "penawaran_sample";
  if (containsAny(text, ["bukti transfer", "transfer"])) return "bukti_transfer";
  if (containsAny(text, ["progress"])) return "tanya_progress";

  return "";
}

function resolveRouteTarget(input) {
  if (typeof input === "string") {
    if (typeof resolvePipelineRouteTarget === "function") {
      return resolvePipelineRouteTarget(input);
    }

    const safe = normalizePipeline(input);
    if (safe === "no_respons") return "no_respons_followup_composer";
    if (safe === "prospek") return "prospek_closing_composer";
    return "respons_qualification_composer";
  }

  const src = asPlainObject(input);
  const planType = safeString(src.planType || src.plan_type || "");
  const prospectType = normalizeProspectType(src.prospectType || src.prospect_type || "none");
  const pipeline = normalizePipeline(src.pipeline || "respons");

  if (PLAN_TYPE_TO_ROUTE_TARGET[planType]) {
    return PLAN_TYPE_TO_ROUTE_TARGET[planType];
  }

  if (prospectType === "at_risk") return "at_risk_recovery_composer";
  if (prospectType === "post_payment") return "post_payment_progress_composer";
  if (prospectType === "brand" || prospectType === "sample") return "prospek_closing_composer";

  if (typeof resolvePipelineRouteTarget === "function") {
    return resolvePipelineRouteTarget(pipeline);
  }

  if (pipeline === "no_respons") return "no_respons_followup_composer";
  if (pipeline === "prospek") return "prospek_closing_composer";
  return "respons_qualification_composer";
}

function buildPlannerUncertaintyNote({ analysis, context, followupPlan }) {
  const notes = [];

  if (
    normalizePipeline(analysis.pipeline) === "no_respons" &&
    followupPlan.execute_mode === EXECUTE_MODES.wait_then_send &&
    !context.last_cs_action &&
    !context.last_followup_type
  ) {
    notes.push("Planner no respons memakai urutan SOP default karena riwayat follow-up terakhir belum eksplisit.");
  }

  if (
    normalizeProspectType(analysis.prospect_type) === "post_payment" &&
    followupPlan.execute_mode === EXECUTE_MODES.verify_then_send &&
    !context.has_invoice_sent &&
    !context.has_dp_paid
  ) {
    notes.push("Planner memilih verifikasi dulu karena bukti pembayaran atau invoice belum cukup eksplisit.");
  }

  if (
    normalizeProspectType(analysis.prospect_type) === "at_risk" &&
    !context.has_product_proof_sent
  ) {
    notes.push("Planner memprioritaskan proof konkret karena customer terdeteksi sensitif terhadap trust atau progres.");
  }

  return notes.join(" ");
}

/* ---------------------------------
   Builders / sanitizers
---------------------------------- */

function sanitizeFollowupPlan(input = {}) {
  const src = asPlainObject(input);

  return {
    plan_type: safeString(src.plan_type || PLAN_TYPES.generic_next_step),
    next_action_code: safeString(src.next_action_code || "next_action"),
    execute_mode: normalizeExecuteModeToken(src.execute_mode || EXECUTE_MODES.send_now),
    recommended_delay_hours: toSafeNumber(src.recommended_delay_hours),
    required_artifacts: uniqueStrings(toStringArray(src.required_artifacts)),
    missing_state_flags: uniqueStrings(toStringArray(src.missing_state_flags)),
    guardrails: uniqueStrings(toStringArray(src.guardrails)),
    route_target: safeString(src.route_target || resolveRouteTarget("respons")),
    plan_reason: safeString(src.plan_reason || "followup_plan_resolution"),
    gap_reference: safeString(src.gap_reference || ""),
  };
}

function sanitizePlannerContext(input = {}) {
  const src = asPlainObject(input);

  return {
    latestCustomerText: safeString(src.latestCustomerText || src.customer_message || ""),
    customer_message: safeString(src.customer_message || src.latestCustomerText || ""),
    latest_customer_text: safeString(
      src.latest_customer_text || src.latestCustomerText || src.customer_message || ""
    ),
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
    is_outbound_followup_run: Boolean(src.is_outbound_followup_run),
    is_post_payment: Boolean(src.is_post_payment),
    is_at_risk: Boolean(src.is_at_risk),
    customer_bubble_count: toSafeNumber(src.customer_bubble_count),
    customer_bubble_gt_5: Boolean(
      src.customer_bubble_gt_5 || toSafeNumber(src.customer_bubble_count) > 5
    ),
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

    should_upgrade_to_prospek: Boolean(
      raw.should_upgrade_to_prospek || normalized.should_upgrade_to_prospek
    ),

    cs_action: safeString(
      raw.cs_action || normalized.cs_action || DEFAULT_ANALYSIS.cs_action
    ),

    suggested_reply: suggestedReply,
    suggested_response: suggestedReply,

    route_target: safeString(
      raw.route_target ||
        normalized.route_target ||
        DEFAULT_ANALYSIS.route_target
    ),

    required_artifacts: uniqueStrings([
      ...toStringArray(raw.required_artifacts),
      ...toStringArray(normalized.required_artifacts),
    ]),

    required_artifacts_final: uniqueStrings([
      ...toStringArray(raw.required_artifacts_final),
      ...toStringArray(normalized.required_artifacts_final),
    ]),

    next_required_artifact: safeString(
      raw.next_required_artifact ||
        normalized.next_required_artifact ||
        ""
    ),

    execute_mode_final: normalizeExecuteModeToken(
      raw.execute_mode_final ||
        normalized.execute_mode_final ||
        ""
    ),

    plan_type_final: safeString(
      raw.plan_type_final ||
        normalized.plan_type_final ||
        ""
    ),

    reply_source: safeString(raw.reply_source || normalized.reply_source || "unknown"),
    action_source: safeString(raw.action_source || normalized.action_source || "unknown"),
    confidence_source: safeString(raw.confidence_source || normalized.confidence_source || "unknown"),
    render_mode: safeString(raw.render_mode || normalized.render_mode || "canonical_only"),
    note_publish_strategy: safeString(
      raw.note_publish_strategy ||
        normalized.note_publish_strategy ||
        "single_canonical_note"
    ),
    canonical_analysis_version: safeString(
      raw.canonical_analysis_version ||
        normalized.canonical_analysis_version ||
        "planner_v2_canonical"
    ),

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
    followup_meta: sanitizePlainObject(raw.followup_meta),
    followup_plan: sanitizePlainObject(raw.followup_plan),
    planner_meta: sanitizePlainObject(raw.planner_meta),
  };
}

function sanitizeMatchedIn(input) {
  const raw = asPlainObject(input);
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
    ? /** @type {Record<string, any>} */ (value)
    : {};
}

function containsAny(text, needles) {
  const hay = safeString(text).toLowerCase();
  if (!hay) return false;

  return (Array.isArray(needles) ? needles : []).some((needle) =>
    hay.includes(String(needle || "").toLowerCase())
  );
}

function firstArrayItem(value) {
  return Array.isArray(value) && value.length > 0 ? value[0] : "";
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => safeString(item)).filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [safeString(value)];
  }

  return [];
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function mergeNotes(...values) {
  return uniqueStrings(
    (Array.isArray(values) ? values : [])
      .map((value) => safeString(value))
      .filter(Boolean)
  ).join(" ");
}

function mergePlainObjects(...values) {
  const out = {};
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, value);
    }
  }
  return out;
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

function normalizeEnum(value, allowed, fallback) {
  const token = safeString(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  return allowed.includes(token) ? token : fallback;
}

function normalizeExecuteModeToken(value) {
  return normalizeEnum(
    value,
    [EXECUTE_MODES.send_now, EXECUTE_MODES.wait_then_send, EXECUTE_MODES.verify_then_send],
    ""
  );
}

function maxPriority(left, right) {
  const a = normalizePriorityLevel(left);
  const b = normalizePriorityLevel(right);
  return PRIORITY_ORDER.indexOf(a) >= PRIORITY_ORDER.indexOf(b) ? a : b;
}

function maxLeadLevel(left, right) {
  const a = normalizeLeadLevel(left);
  const b = normalizeLeadLevel(right);
  return LEAD_LEVEL_ORDER.indexOf(a) >= LEAD_LEVEL_ORDER.indexOf(b) ? a : b;
}

function humanizeForSentence(value) {
  const safe = safeString(value);
  if (!safe) return "data yang dibutuhkan";

  return safe
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}