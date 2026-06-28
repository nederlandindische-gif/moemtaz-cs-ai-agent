// dataset_engine/merge_analysis.js

import {
  DEFAULT_ANALYSIS,
  SPECIAL_BRANCHES,
  applyChannelOverride,
  getRequiredArtifactsForStage,
  getSopStageConfig,
  normalizeAnalysisTaxonomy,
  normalizeBehaviourStage,
  normalizeBrandChannel,
  normalizeEmotion,
  normalizeIntent,
  normalizeLeadLevel,
  normalizeLeadLevelStage,
  normalizePipeline,
  normalizePriorityLevel,
  normalizeProspectType,
  normalizeSopStage,
} from "./rules.js";

const SCORE_LIMITS = Object.freeze({
  CONVERSION_MIN: 5,
  CONVERSION_MAX: 98,
  CONFIDENCE_MIN: 20,
  CONFIDENCE_MAX: 98,
});

const FIELD_PRIORITY = Object.freeze({
  pipeline: "crm_lock_then_deterministic_then_ai_then_history",
  lead_level: "special_branch_then_deterministic_then_ai_then_history",
  emotion: "special_branch_then_deterministic_then_ai_then_history",
  intent: "derived_from_emotion_or_deterministic_then_ai",
  behaviour_stage: "special_branch_then_emotion_map_then_deterministic_then_ai",
  prospect_type: "crm_lock_then_signal_lock_then_deterministic_then_ai",
  sop_stage_current: "special_branch_then_context_then_deterministic_then_history",
  sop_stage_next: "from_stage_config_or_special_branch",
  priority: "special_branch_then_pipeline_then_deterministic_then_ai",
  cs_action: "special_branch_or_deterministic_template_then_ai_if_better",
  suggested_reply: "special_branch_or_deterministic_template_then_ai_if_better",
});

const GENERIC_ACTION_HINTS = Object.freeze([
  "tanyakan kebutuhan utama",
  "gali kebutuhan customer",
  "sesuai konteks percakapan",
  "arahkan ke",
]);

const GENERIC_REPLY_HINTS = Object.freeze([
  "boleh kak aku bantu",
  "kak boleh ceritain dulu",
  "saya bantu ya",
  "lagi cari info",
]);

const LEGACY_AI_EMOTION_MAP = Object.freeze({
  interest: "discovery",
  creative_involvement: "brand_ownership",
  excitement: "purchase_readiness",
  sample_evaluation: "risk_aversion",
  technical_curiosity: "analytical_thinking",
  formula_compatibility: "analytical_thinking",
  competitor_awareness: "analytical_thinking",
  business_insight: "analytical_thinking",
  business_planning: "brand_ownership",
  marketing_expectation: "brand_ownership",
  product_complaint: "trust_anxiety",
  product_safety_concern: "trust_anxiety",
  busy_delay: "curiosity",
  future_intention: "curiosity",
  negotiation: "budget_concern",
  business_motivation: "discovery",
});

const LEGACY_AI_INTENT_MAP = Object.freeze({
  process: "price_process",
  price_process: "price_process",
  pricing: "price",
  ordering: "purchase",
  order: "purchase",
  legality: "trust",
  branding: "branding",
  support: "support",
  recovery: "recovery",
  fulfillment: "fulfillment",
  trust_recovery: "trust_recovery",
  sampling: "trial",
  sample: "trial",
  emotion: "exploration",
});

const LEGACY_AI_STAGE_MAP = Object.freeze({
  sampling: "evaluation",
  decision_delay: "interest",
  post_decision: "post_decision",
  post_purchase: "post_purchase",
  pre_pelunasan: "pre_pelunasan",
});

const LEGACY_AI_LEAD_LEVEL_MAP = Object.freeze({
  analytical: "warm_hot",
  hot_warm: "warm_hot",
  very_hot: "hot",
  existing: "hot",
});

const LEAD_LEVEL_SCORE_MAP = Object.freeze({
  cold: 28,
  warm: 50,
  warm_hot: 68,
  hot: 84,
  hot_at_risk: 78,
});

const SPECIAL_EMOTIONS = Object.freeze({
  AT_RISK: new Set(["trust_anxiety", "progress_anxiety", "proof_seeking"]),
  HOT: new Set(["purchase_readiness", "brand_ownership", "educational_support"]),
  WARM_HOT: new Set(["analytical_thinking", "visual_validation"]),
  WARM: new Set(["discovery", "trust_seeking", "risk_aversion", "budget_concern"]),
});

/* ---------------------------------
   Public API
---------------------------------- */

export function mergeAnalysis(input = {}) {
  const context = sanitizeCrmState(input.crmState || input);
  const datasetBase = sanitizeBaseAnalysis(input.datasetBase, "dataset_base");
  const scoredAnalysis = sanitizeBaseAnalysis(input.scoredAnalysis, "scored_analysis");
  const aiAnalysis = sanitizeAIAnalysis(input.aiAnalysis || null);
  const lastAnalysis = sanitizeHistoricalAnalysis(input.lastAnalysis || null);

  const deterministic = composeDeterministicAnalysis({
    datasetBase,
    scoredAnalysis,
    lastAnalysis,
  });

  const mergedStatusFlags = mergeStatusFlags(
    datasetBase.status_flags,
    scoredAnalysis.status_flags,
    lastAnalysis.status_flags,
    context.status_flags
  );

  const mergedBubbleMetrics = mergeBubbleMetrics(
    datasetBase.bubble_metrics,
    scoredAnalysis.bubble_metrics,
    lastAnalysis.bubble_metrics,
    context.bubble_metrics
  );

  const mergedSopSignals = mergeSopSignals(
    datasetBase.sop_signals,
    scoredAnalysis.sop_signals,
    lastAnalysis.sop_signals,
    context.sop_signals
  );

  const locks = buildHardLocks({
    deterministic,
    aiAnalysis,
    lastAnalysis,
    context,
    mergedStatusFlags,
    mergedBubbleMetrics,
    mergedSopSignals,
  });

  const finalEmotion = resolveEmotion({
    locks,
    deterministic,
    aiAnalysis,
    lastAnalysis,
  });

  const finalIntent = resolveIntent({
    locks,
    finalEmotion,
    deterministic,
    aiAnalysis,
    lastAnalysis,
  });

  const finalBehaviourStage = resolveBehaviourStage({
    locks,
    finalEmotion,
    finalIntent,
    deterministic,
    aiAnalysis,
    lastAnalysis,
  });

  const finalProspectType = resolveProspectType({
    locks,
    finalEmotion,
    finalIntent,
    finalBehaviourStage,
    deterministic,
    aiAnalysis,
    lastAnalysis,
  });

  const finalLeadLevel = resolveLeadLevel({
    locks,
    finalEmotion,
    finalIntent,
    finalBehaviourStage,
    finalProspectType,
    deterministic,
    aiAnalysis,
    lastAnalysis,
  });

  const finalPipeline = resolvePipeline({
    locks,
    finalLeadLevel,
    finalProspectType,
    deterministic,
    aiAnalysis,
    lastAnalysis,
  });

  const finalPriority = resolvePriority({
    locks,
    finalEmotion,
    finalIntent,
    finalPipeline,
    finalProspectType,
    deterministic,
    aiAnalysis,
    lastAnalysis,
  });

  const specialBranch = resolveSpecialBranch({
    locks,
    finalEmotion,
    finalProspectType,
  });

  const finalSopStageCurrent = resolveSopStageCurrent({
    locks,
    specialBranch,
    finalEmotion,
    finalIntent,
    finalPipeline,
    finalProspectType,
    deterministic,
    lastAnalysis,
  });

  const finalSopStageNext = resolveSopStageNext({
    specialBranch,
    finalSopStageCurrent,
    deterministic,
    lastAnalysis,
  });

  const finalConversionRate = resolveConversionRate({
    deterministic,
    aiAnalysis,
    lastAnalysis,
    finalLeadLevel,
    finalProspectType,
  });

  const finalConfidenceScore = resolveConfidenceScore({
    deterministic,
    aiAnalysis,
    lastAnalysis,
    locks,
  });

  const customerProfile = resolveCustomerProfile({
    deterministic,
    lastAnalysis,
    finalLeadLevel,
    finalEmotion,
    finalIntent,
    finalProspectType,
  });

  const followupGap = resolveFollowupGap({
    deterministic,
    lastAnalysis,
    specialBranch,
    finalSopStageCurrent,
    finalSopStageNext,
    finalProspectType,
    finalPipeline,
    finalEmotion,
  });

  const templateTexts = resolveTemplateTexts({
    deterministic,
    specialBranch,
    aiAnalysis,
    finalEmotion,
    finalIntent,
    finalSopStageCurrent,
  });

  const mergedMatchedPatterns = uniqueStrings([
    ...toStringArray(datasetBase.matched_patterns),
    ...toStringArray(scoredAnalysis.matched_patterns),
    ...toStringArray(lastAnalysis.matched_patterns),
    ...toStringArray(aiAnalysis.matched_patterns),
  ]);

  const mergedMatchedIn = mergeMatchedIn(
    mergeMatchedIn(datasetBase.matched_in, scoredAnalysis.matched_in),
    mergeMatchedIn(lastAnalysis.matched_in, aiAnalysis.matched_in)
  );

  const matchedContextCues = uniqueStrings([
    ...toStringArray(datasetBase.matched_context_cues),
    ...toStringArray(scoredAnalysis.matched_context_cues),
    ...toStringArray(lastAnalysis.matched_context_cues),
    ...toStringArray(aiAnalysis.matched_context_cues),
  ]);

  const requiredArtifacts = uniqueStrings([
    ...toStringArray(templateTexts.required_artifacts),
    ...toStringArray(getRequiredArtifactsForStage(finalSopStageCurrent)),
    ...toStringArray(specialBranch?.required_artifacts),
  ]);

  const baseOutput = normalizeAnalysisTaxonomy({
    ...DEFAULT_ANALYSIS,
    rule_id:
      chooseFirstNonEmpty(
        deterministic.rule_id,
        scoredAnalysis.rule_id,
        datasetBase.rule_id,
        aiAnalysis.rule_id,
        lastAnalysis.rule_id,
        DEFAULT_ANALYSIS.rule_id
      ) || DEFAULT_ANALYSIS.rule_id,

    dataset_row_id:
      chooseFirstNonEmpty(
        deterministic.dataset_row_id,
        scoredAnalysis.dataset_row_id,
        datasetBase.dataset_row_id,
        lastAnalysis.dataset_row_id
      ) || "",

    dataset_row_label:
      chooseFirstNonEmpty(
        deterministic.dataset_row_label,
        scoredAnalysis.dataset_row_label,
        datasetBase.dataset_row_label,
        lastAnalysis.dataset_row_label
      ) || "",

    pipeline: finalPipeline,
    lead_level: finalLeadLevel,
    lead_level_stage: finalLeadLevel,
    emotion: finalEmotion,
    intent: finalIntent,
    behaviour_stage: finalBehaviourStage,
    customer_profile: customerProfile,
    sop_stage_current: finalSopStageCurrent,
    sop_stage_next: finalSopStageNext,
    followup_gap: followupGap,
    priority: finalPriority,
    priority_level: finalPriority,
    prospect_type: finalProspectType,
    cs_action: templateTexts.cs_action,
    suggested_reply: templateTexts.suggested_reply,
    suggested_response: templateTexts.suggested_reply,
    tag_emotion: normalizeTag(finalEmotion),
    tag_stage: normalizeTag(finalBehaviourStage),
    uncertainty_note: buildUncertaintyNote({
      deterministic,
      aiAnalysis,
      lastAnalysis,
      context,
      locks,
      finalEmotion,
      finalIntent,
      finalProspectType,
      finalSopStageCurrent,
    }),
    conversion_rate_analyzed: finalConversionRate,
    confidence_score: finalConfidenceScore,
    engine_dataset: chooseFirstNonEmpty(
      deterministic.engine_dataset,
      scoredAnalysis.engine_dataset,
      datasetBase.engine_dataset,
      aiAnalysis.engine_dataset,
      "dataset_rules_v3"
    ),
    matched_patterns: mergedMatchedPatterns,
    matched_in: mergedMatchedIn,
    matched_context_cues: matchedContextCues,
    rule_source: "merge_analysis",
    sources_used: buildSourcesUsed({
      deterministic,
      aiAnalysis,
      lastAnalysis,
      specialBranch,
      source: input.source,
    }),
    status_flags: mergedStatusFlags,
    bubble_metrics: mergedBubbleMetrics,
    sop_signals: {
      ...mergedSopSignals,
      should_upgrade_to_prospek: Boolean(
        mergedSopSignals.should_upgrade_to_prospek ||
          locks.should_upgrade_to_prospek
      ),
    },
    stage_meta: {
      current: finalSopStageCurrent,
      next: finalSopStageNext,
      stage_family: safeString(getSopStageConfig(finalSopStageCurrent)?.stage_family || ""),
      required_artifacts: requiredArtifacts,
    },
    pipeline_meta: {
      route_target: resolveRouteTarget(finalPipeline),
      reason: locks.pipeline_reason,
    },
    prospect_meta: {
      prospect_type: finalProspectType,
      reason: locks.prospect_reason,
      required_artifacts: requiredArtifacts,
    },
    followup_meta: {
      next_required_artifact: requiredArtifacts[0] || "",
      route_target: resolveRouteTarget(finalPipeline),
    },
    merge_meta: {
      field_priority: FIELD_PRIORITY,
      special_branch_applied: safeString(specialBranch?.type || ""),
      crm_state_used: summarizeCrmState(context),
      pipeline_reason: locks.pipeline_reason,
      prospect_reason: locks.prospect_reason,
      deterministic: summarizeMergeSource(deterministic),
      ai: summarizeMergeSource(aiAnalysis),
      last_analysis: summarizeMergeSource(lastAnalysis),
    },
  });

  const channelAdjusted = applyChannelOverride({
    ...baseOutput,
    brand_channel: context.brand_channel,
    required_artifacts: requiredArtifacts,
  });

  return {
    ...baseOutput,
    brand_channel: context.brand_channel,
    cs_action: safeString(channelAdjusted.cs_action || baseOutput.cs_action),
    suggested_reply: safeString(
      channelAdjusted.suggested_reply || baseOutput.suggested_reply
    ),
    suggested_response: safeString(
      channelAdjusted.suggested_reply || baseOutput.suggested_reply
    ),
    stage_meta: {
      ...baseOutput.stage_meta,
      required_artifacts: uniqueStrings([
        ...toStringArray(baseOutput.stage_meta?.required_artifacts),
        ...toStringArray(channelAdjusted.required_artifacts),
      ]),
    },
    prospect_meta: {
      ...baseOutput.prospect_meta,
      required_artifacts: uniqueStrings([
        ...toStringArray(baseOutput.prospect_meta?.required_artifacts),
        ...toStringArray(channelAdjusted.required_artifacts),
      ]),
    },
    followup_meta: {
      ...baseOutput.followup_meta,
      next_required_artifact:
        uniqueStrings(channelAdjusted.required_artifacts)[0] ||
        baseOutput.followup_meta?.next_required_artifact ||
        "",
    },
  };
}

export function mergeAnalysisLayers(input = {}) {
  const chosenAI = pickFirstUsableAI([
    { source: "primary", value: input.primaryAnalysis },
    { source: "fallback_one", value: input.fallbackOneAnalysis },
    { source: "fallback_two", value: input.fallbackTwoAnalysis },
  ]);

  return mergeAnalysis({
    datasetBase: input.datasetBase,
    scoredAnalysis: input.scoredAnalysis,
    aiAnalysis: chosenAI?.value || null,
    source: chosenAI?.source || "none",
    crmState: input.crmState || input,
    lastAnalysis: input.lastAnalysis || null,
  });
}

/* ---------------------------------
   Sanitizers
---------------------------------- */

export function sanitizeAIAnalysis(input) {
  if (!input || typeof input !== "object") {
    return {
      has_meaningful_ai_data: false,
      matched_patterns: [],
      matched_in: emptyMatchedIn(),
      matched_context_cues: [],
    };
  }

  const rawIntent = safeString(
    input.intent ??
      input.analysis_intent ??
      input.intent_stage
  );
  const rawEmotion = safeString(
    input.emotion ??
      input.primary_emotion ??
      firstArrayItem(input.emotions)
  );
  const rawBehaviourStage = safeString(
    input.behaviour_stage ??
      input.behavior_stage ??
      input.behaviour ??
      input.stage
  );
  const rawLeadLevel = safeString(
    input.lead_level_stage ??
      input.lead_level ??
      input.lead_stage
  );

  const intent = normalizeIntent(
    LEGACY_AI_INTENT_MAP[normalizeTag(rawIntent)] || rawIntent
  );

  const emotion = normalizeEmotion(
    LEGACY_AI_EMOTION_MAP[normalizeTag(rawEmotion)] || rawEmotion
  );

  const behaviour_stage = normalizeBehaviourStage(
    LEGACY_AI_STAGE_MAP[normalizeTag(rawBehaviourStage)] || rawBehaviourStage
  );

  const lead_level_stage = normalizeLeadLevelStage(
    LEGACY_AI_LEAD_LEVEL_MAP[normalizeTag(rawLeadLevel)] || rawLeadLevel
  );

  const conversion_rate_analyzed = normalizePercent(
    input.conversion_rate_analyzed ??
      input.conversion_rate ??
      input.probability ??
      input.conversion_probability,
    null
  );

  const confidence_score = normalizePercent(
    input.confidence_score ?? input.confidence,
    null
  );

  const cs_action = safeString(
    input.cs_action ??
      input.action ??
      input.next_action
  );

  const suggested_reply = safeString(
    input.suggested_reply ??
      input.suggested_response ??
      input.response ??
      input.reply
  );

  const suggestions = toStringArray(input.suggestions);
  const matched_patterns = toStringArray(input.matched_patterns);
  const matched_context_cues = toStringArray(input.matched_context_cues);

  const matched_in =
    input.matched_in && typeof input.matched_in === "object"
      ? {
          latest: toStringArray(input.matched_in.latest),
          tail: toStringArray(input.matched_in.tail),
          summary: toStringArray(input.matched_in.summary),
        }
      : emptyMatchedIn();

  const hasMeaningfulAIData = Boolean(
    intent !== "unknown" ||
      emotion !== "unknown" ||
      behaviour_stage !== DEFAULT_ANALYSIS.behaviour_stage ||
      lead_level_stage !== DEFAULT_ANALYSIS.lead_level_stage ||
      Number.isFinite(conversion_rate_analyzed) ||
      Number.isFinite(confidence_score) ||
      cs_action ||
      suggested_reply ||
      suggestions.length > 0
  );

  return {
    rule_id: safeString(input.rule_id || input.id || ""),
    dataset_row_id: safeString(input.dataset_row_id || ""),
    dataset_row_label: safeString(input.dataset_row_label || ""),
    pipeline: normalizePipeline(input.pipeline || ""),
    lead_level: lead_level_stage,
    lead_level_stage,
    emotion,
    intent,
    behaviour_stage,
    prospect_type: normalizeProspectType(input.prospect_type || ""),
    sop_stage_current: normalizeSopStage(input.sop_stage_current || ""),
    sop_stage_next: normalizeSopStage(input.sop_stage_next || ""),
    customer_profile: safeString(input.customer_profile || ""),
    followup_gap: safeString(input.followup_gap || ""),
    priority: normalizePriorityLevel(input.priority || input.priority_level || ""),
    priority_level: normalizePriorityLevel(input.priority || input.priority_level || ""),
    cs_action,
    suggested_reply: suggested_reply || suggestions[0] || "",
    suggested_response: suggested_reply || suggestions[0] || "",
    confidence_score,
    conversion_rate_analyzed,
    matched_patterns,
    matched_context_cues,
    matched_in,
    status_flags: sanitizeStatusFlags(input.status_flags),
    bubble_metrics: sanitizeBubbleMetrics(input.bubble_metrics),
    sop_signals: sanitizeSopSignals(input.sop_signals),
    source: safeString(input.source || ""),
    engine_dataset: safeString(input.engine_dataset || ""),
    has_meaningful_ai_data: hasMeaningfulAIData,
  };
}

function sanitizeBaseAnalysis(input, source = "base") {
  const raw = input && typeof input === "object" ? input : {};
  const normalized = normalizeAnalysisTaxonomy(raw);

  const suggestedReply = safeString(
    raw.suggested_reply ||
      raw.suggested_response ||
      normalized.suggested_reply ||
      DEFAULT_ANALYSIS.suggested_reply
  );

  return {
    rule_id: safeString(raw.rule_id || raw.id || ""),
    dataset_row_id: safeString(raw.dataset_row_id || ""),
    dataset_row_label: safeString(raw.dataset_row_label || ""),
    pipeline: normalizePipeline(normalized.pipeline || DEFAULT_ANALYSIS.pipeline),
    lead_level: normalizeLeadLevelStage(
      normalized.lead_level || normalized.lead_level_stage || DEFAULT_ANALYSIS.lead_level_stage
    ),
    lead_level_stage: normalizeLeadLevelStage(
      normalized.lead_level || normalized.lead_level_stage || DEFAULT_ANALYSIS.lead_level_stage
    ),
    emotion: normalizeEmotion(normalized.emotion || DEFAULT_ANALYSIS.emotion),
    intent: normalizeIntent(normalized.intent || DEFAULT_ANALYSIS.intent),
    behaviour_stage: normalizeBehaviourStage(
      normalized.behaviour_stage || DEFAULT_ANALYSIS.behaviour_stage
    ),
    customer_profile: safeString(raw.customer_profile || ""),
    sop_stage_current: normalizeSopStage(
      raw.sop_stage_current || normalized.sop_stage_current || DEFAULT_ANALYSIS.sop_stage_current
    ),
    sop_stage_next: normalizeSopStage(
      raw.sop_stage_next ||
        normalized.sop_stage_next ||
        getSopStageConfig(raw.sop_stage_current || normalized.sop_stage_current)?.next_stage ||
        DEFAULT_ANALYSIS.sop_stage_next
    ),
    followup_gap: safeString(raw.followup_gap || ""),
    priority: normalizePriorityLevel(
      raw.priority || raw.priority_level || normalized.priority || DEFAULT_ANALYSIS.priority
    ),
    priority_level: normalizePriorityLevel(
      raw.priority || raw.priority_level || normalized.priority || DEFAULT_ANALYSIS.priority
    ),
    prospect_type: normalizeProspectType(
      raw.prospect_type || normalized.prospect_type || DEFAULT_ANALYSIS.prospect_type
    ),
    cs_action: safeString(raw.cs_action || ""),
    suggested_reply: suggestedReply,
    suggested_response: suggestedReply,
    tag_emotion: normalizeTag(raw.tag_emotion || normalized.emotion || DEFAULT_ANALYSIS.emotion),
    tag_stage: normalizeTag(
      raw.tag_stage || normalized.behaviour_stage || DEFAULT_ANALYSIS.behaviour_stage
    ),
    uncertainty_note: safeString(raw.uncertainty_note || ""),
    conversion_rate_analyzed: normalizePercent(
      raw.conversion_rate_analyzed ?? raw.conversion_rate_base,
      DEFAULT_ANALYSIS.conversion_rate_analyzed
    ),
    confidence_score: normalizePercent(
      raw.confidence_score ?? raw.base_score,
      DEFAULT_ANALYSIS.confidence_score
    ),
    engine_dataset: safeString(raw.engine_dataset || source),
    matched_patterns: toStringArray(raw.matched_patterns),
    matched_context_cues: toStringArray(raw.matched_context_cues),
    matched_in:
      raw.matched_in && typeof raw.matched_in === "object"
        ? {
            latest: toStringArray(raw.matched_in.latest),
            tail: toStringArray(raw.matched_in.tail),
            summary: toStringArray(raw.matched_in.summary),
          }
        : emptyMatchedIn(),
    status_flags: sanitizeStatusFlags(raw.status_flags),
    bubble_metrics: sanitizeBubbleMetrics(raw.bubble_metrics),
    sop_signals: sanitizeSopSignals(raw.sop_signals),
    rule_source: safeString(raw.rule_source || source),
    sources_used: toStringArray(raw.sources_used),
    merge_meta: raw.merge_meta && typeof raw.merge_meta === "object" ? raw.merge_meta : {},
  };
}

function sanitizeHistoricalAnalysis(input) {
  return sanitizeBaseAnalysis(input, "last_analysis");
}

function sanitizeCrmState(input) {
  const raw = input && typeof input === "object" ? input : {};

  const hasDpPaid = Boolean(raw.has_dp_paid);
  const hasInvoiceSent = Boolean(raw.has_invoice_sent);
  const hasFormSent = Boolean(raw.has_form_sent);
  const hasFormFilled = Boolean(raw.has_form_filled);
  const hasProductProofSent = Boolean(raw.has_product_proof_sent);
  const hasResiSent = Boolean(raw.has_resi_sent);

  const customerBubbleCount = toSafeNumber(raw.customer_bubble_count);
  const agentBubbleCount = toSafeNumber(raw.agent_bubble_count);

  return {
    brand_channel: normalizeBrandChannel(raw.brand_channel),
    last_cs_action: safeString(raw.last_cs_action || ""),
    is_post_payment: Boolean(raw.is_post_payment || hasDpPaid || hasInvoiceSent || hasResiSent),
    is_at_risk: Boolean(raw.is_at_risk),
    has_form_sent: hasFormSent,
    has_form_filled: hasFormFilled,
    has_dp_paid: hasDpPaid,
    has_invoice_sent: hasInvoiceSent,
    has_product_proof_sent: hasProductProofSent,
    has_resi_sent: hasResiSent,
    status_flags: {
      is_sample_direction: false,
      is_brand_direction: Boolean(hasFormSent || hasFormFilled),
      is_post_payment: Boolean(raw.is_post_payment || hasDpPaid || hasInvoiceSent || hasResiSent),
      is_at_risk: Boolean(raw.is_at_risk),
      customer_bubble_gt_5: Boolean(raw.customer_bubble_gt_5 || customerBubbleCount > 5),
    },
    bubble_metrics: {
      customer_bubble_count: customerBubbleCount,
      agent_bubble_count: agentBubbleCount,
      customer_bubble_gt_5: Boolean(raw.customer_bubble_gt_5 || customerBubbleCount > 5),
    },
    sop_signals: sanitizeSopSignals(raw.sop_signals),
  };
}

/* ---------------------------------
   Compose deterministic base
---------------------------------- */

function composeDeterministicAnalysis({ datasetBase, scoredAnalysis, lastAnalysis }) {
  const output = {
    ...sanitizeBaseAnalysis(DEFAULT_ANALYSIS, "default"),
    ...datasetBase,
  };

  output.rule_id = chooseFirstNonEmpty(
    datasetBase.rule_id,
    scoredAnalysis.rule_id,
    lastAnalysis.rule_id,
    DEFAULT_ANALYSIS.rule_id
  );
  output.dataset_row_id = chooseFirstNonEmpty(
    datasetBase.dataset_row_id,
    scoredAnalysis.dataset_row_id,
    lastAnalysis.dataset_row_id,
    ""
  );
  output.dataset_row_label = chooseFirstNonEmpty(
    datasetBase.dataset_row_label,
    scoredAnalysis.dataset_row_label,
    lastAnalysis.dataset_row_label,
    ""
  );

  output.pipeline = chooseField(
    scoredAnalysis.pipeline,
    datasetBase.pipeline,
    lastAnalysis.pipeline,
    DEFAULT_ANALYSIS.pipeline
  );

  output.lead_level = chooseField(
    scoredAnalysis.lead_level_stage || scoredAnalysis.lead_level,
    datasetBase.lead_level_stage || datasetBase.lead_level,
    lastAnalysis.lead_level_stage || lastAnalysis.lead_level,
    DEFAULT_ANALYSIS.lead_level_stage
  );
  output.lead_level_stage = output.lead_level;

  output.emotion = chooseField(
    scoredAnalysis.emotion,
    datasetBase.emotion,
    lastAnalysis.emotion,
    DEFAULT_ANALYSIS.emotion
  );

  output.intent = chooseField(
    scoredAnalysis.intent,
    datasetBase.intent,
    lastAnalysis.intent,
    DEFAULT_ANALYSIS.intent
  );

  output.behaviour_stage = chooseField(
    scoredAnalysis.behaviour_stage,
    datasetBase.behaviour_stage,
    lastAnalysis.behaviour_stage,
    DEFAULT_ANALYSIS.behaviour_stage
  );

  output.customer_profile = chooseLongerText(
    datasetBase.customer_profile,
    scoredAnalysis.customer_profile,
    lastAnalysis.customer_profile,
    DEFAULT_ANALYSIS.customer_profile
  );

  output.sop_stage_current = chooseField(
    scoredAnalysis.sop_stage_current,
    datasetBase.sop_stage_current,
    lastAnalysis.sop_stage_current,
    DEFAULT_ANALYSIS.sop_stage_current
  );

  output.sop_stage_next = chooseField(
    scoredAnalysis.sop_stage_next,
    datasetBase.sop_stage_next,
    lastAnalysis.sop_stage_next,
    getSopStageConfig(output.sop_stage_current)?.next_stage || DEFAULT_ANALYSIS.sop_stage_next
  );

  output.followup_gap = chooseLongerText(
    scoredAnalysis.followup_gap,
    datasetBase.followup_gap,
    lastAnalysis.followup_gap,
    DEFAULT_ANALYSIS.followup_gap
  );

  output.priority = chooseField(
    scoredAnalysis.priority,
    datasetBase.priority,
    lastAnalysis.priority,
    DEFAULT_ANALYSIS.priority
  );
  output.priority_level = output.priority;

  output.prospect_type = chooseField(
    scoredAnalysis.prospect_type,
    datasetBase.prospect_type,
    lastAnalysis.prospect_type,
    DEFAULT_ANALYSIS.prospect_type
  );

  output.cs_action = chooseDeterministicText(
    datasetBase.cs_action,
    scoredAnalysis.cs_action,
    lastAnalysis.cs_action,
    DEFAULT_ANALYSIS.cs_action
  );

  output.suggested_reply = chooseDeterministicText(
    datasetBase.suggested_reply || datasetBase.suggested_response,
    scoredAnalysis.suggested_reply || scoredAnalysis.suggested_response,
    lastAnalysis.suggested_reply || lastAnalysis.suggested_response,
    DEFAULT_ANALYSIS.suggested_reply
  );
  output.suggested_response = output.suggested_reply;

  output.conversion_rate_analyzed = clampNumber(
    Math.round(
      weightedAverage([
        [scoredAnalysis.conversion_rate_analyzed, 0.66],
        [datasetBase.conversion_rate_analyzed, 0.26],
        [lastAnalysis.conversion_rate_analyzed, 0.08],
      ], DEFAULT_ANALYSIS.conversion_rate_analyzed)
    ),
    SCORE_LIMITS.CONVERSION_MIN,
    SCORE_LIMITS.CONVERSION_MAX
  );

  output.confidence_score = clampNumber(
    Math.round(
      weightedAverage([
        [scoredAnalysis.confidence_score, 0.54],
        [datasetBase.confidence_score, 0.30],
        [lastAnalysis.confidence_score, 0.16],
      ], DEFAULT_ANALYSIS.confidence_score)
    ),
    SCORE_LIMITS.CONFIDENCE_MIN,
    SCORE_LIMITS.CONFIDENCE_MAX
  );

  output.matched_patterns = uniqueStrings([
    ...toStringArray(datasetBase.matched_patterns),
    ...toStringArray(scoredAnalysis.matched_patterns),
    ...toStringArray(lastAnalysis.matched_patterns),
  ]);

  output.matched_context_cues = uniqueStrings([
    ...toStringArray(datasetBase.matched_context_cues),
    ...toStringArray(scoredAnalysis.matched_context_cues),
    ...toStringArray(lastAnalysis.matched_context_cues),
  ]);

  output.matched_in = mergeMatchedIn(
    mergeMatchedIn(datasetBase.matched_in, scoredAnalysis.matched_in),
    lastAnalysis.matched_in
  );

  output.engine_dataset = chooseFirstNonEmpty(
    scoredAnalysis.engine_dataset,
    datasetBase.engine_dataset,
    lastAnalysis.engine_dataset,
    "dataset_rules_v3"
  );

  output.status_flags = mergeStatusFlags(
    datasetBase.status_flags,
    scoredAnalysis.status_flags,
    lastAnalysis.status_flags
  );

  output.bubble_metrics = mergeBubbleMetrics(
    datasetBase.bubble_metrics,
    scoredAnalysis.bubble_metrics,
    lastAnalysis.bubble_metrics
  );

  output.sop_signals = mergeSopSignals(
    datasetBase.sop_signals,
    scoredAnalysis.sop_signals,
    lastAnalysis.sop_signals
  );

  return output;
}

/* ---------------------------------
   Hard locks
---------------------------------- */

function buildHardLocks({
  deterministic,
  aiAnalysis,
  lastAnalysis,
  context,
  mergedStatusFlags,
  mergedBubbleMetrics,
  mergedSopSignals,
}) {
  const bubbleGt5 = Boolean(
    mergedBubbleMetrics.customer_bubble_gt_5 ||
      toSafeNumber(mergedBubbleMetrics.customer_bubble_count) > 5
  );

  const isSampleDirection = Boolean(
    mergedStatusFlags.is_sample_direction ||
      deterministic.prospect_type === "sample" ||
      aiAnalysis.prospect_type === "sample" ||
      lastAnalysis.prospect_type === "sample" ||
      deterministic.intent === "trial" ||
      aiAnalysis.intent === "trial" ||
      mergedSopSignals.sample_vs_produksi
  );

  const isBrandDirection = Boolean(
    context.has_form_sent ||
      context.has_form_filled ||
      mergedStatusFlags.is_brand_direction ||
      deterministic.prospect_type === "brand" ||
      aiAnalysis.prospect_type === "brand" ||
      lastAnalysis.prospect_type === "brand" ||
      deterministic.intent === "branding" ||
      aiAnalysis.intent === "branding" ||
      deterministic.emotion === "brand_ownership" ||
      mergedSopSignals.brand_ownership
  );

  const isPostPayment = Boolean(
    context.is_post_payment ||
      context.has_dp_paid ||
      context.has_invoice_sent ||
      context.has_resi_sent ||
      mergedStatusFlags.is_post_payment ||
      deterministic.prospect_type === "post_payment" ||
      aiAnalysis.prospect_type === "post_payment" ||
      lastAnalysis.prospect_type === "post_payment" ||
      mergedSopSignals.progress_anxiety
  );

  const isAtRisk = Boolean(
    context.is_at_risk ||
      mergedStatusFlags.is_at_risk ||
      deterministic.prospect_type === "at_risk" ||
      aiAnalysis.prospect_type === "at_risk" ||
      lastAnalysis.prospect_type === "at_risk" ||
      mergedSopSignals.trust_anxiety ||
      mergedSopSignals.proof_seeking ||
      mergedSopSignals.progress_anxiety ||
      ["trust_anxiety", "proof_seeking", "progress_anxiety"].includes(deterministic.emotion) ||
      ["trust_anxiety", "proof_seeking", "progress_anxiety"].includes(aiAnalysis.emotion)
  );

  const noResponseByStage = safeString(deterministic.sop_stage_current).startsWith("followup_");
  const noResponseByHistory = safeString(lastAnalysis.sop_stage_current).startsWith("followup_");
  const isNoResponse = Boolean(
    deterministic.pipeline === "no_respons" ||
      aiAnalysis.pipeline === "no_respons" ||
      lastAnalysis.pipeline === "no_respons" ||
      noResponseByStage ||
      noResponseByHistory
  );

  const purchaseSignal = Boolean(
    mergedSopSignals.purchase_readiness ||
      deterministic.intent === "purchase" ||
      aiAnalysis.intent === "purchase" ||
      deterministic.emotion === "purchase_readiness" ||
      aiAnalysis.emotion === "purchase_readiness"
  );

  const shouldUpgradeToProspek = Boolean(
    mergedSopSignals.should_upgrade_to_prospek ||
      (bubbleGt5 && (isSampleDirection || isBrandDirection || purchaseSignal)) ||
      purchaseSignal
  );

  return {
    is_sample_direction: isSampleDirection,
    is_brand_direction: isBrandDirection,
    is_post_payment: isPostPayment,
    is_at_risk: isAtRisk,
    is_no_response: isNoResponse,
    should_upgrade_to_prospek: shouldUpgradeToProspek,
    pipeline_reason: buildPipelineReason({
      isNoResponse,
      isSampleDirection,
      isBrandDirection,
      isPostPayment,
      isAtRisk,
      shouldUpgradeToProspek,
      bubbleGt5,
    }),
    prospect_reason: buildProspectReason({
      isSampleDirection,
      isBrandDirection,
      isPostPayment,
      isAtRisk,
    }),
  };
}

/* ---------------------------------
   Final resolvers
---------------------------------- */

function resolveEmotion({ locks, deterministic, aiAnalysis, lastAnalysis }) {
  if (locks.is_at_risk) {
    if (deterministic.emotion === "proof_seeking" || aiAnalysis.emotion === "proof_seeking") {
      return "proof_seeking";
    }
    if (locks.is_post_payment || deterministic.emotion === "progress_anxiety" || aiAnalysis.emotion === "progress_anxiety") {
      return "progress_anxiety";
    }
    return "trust_anxiety";
  }

  if (locks.is_post_payment && (deterministic.emotion === "progress_anxiety" || aiAnalysis.emotion === "progress_anxiety")) {
    return "progress_anxiety";
  }

  if (locks.is_brand_direction && (deterministic.emotion === "brand_ownership" || aiAnalysis.emotion === "brand_ownership")) {
    return "brand_ownership";
  }

  if (locks.is_sample_direction && (deterministic.emotion === "risk_aversion" || aiAnalysis.emotion === "risk_aversion")) {
    return "risk_aversion";
  }

  return chooseCanonicalValue(
    [
      deterministic.emotion,
      aiAnalysis.has_meaningful_ai_data ? aiAnalysis.emotion : "",
      lastAnalysis.emotion,
      DEFAULT_ANALYSIS.emotion,
    ],
    normalizeEmotion,
    DEFAULT_ANALYSIS.emotion
  );
}

function resolveIntent({ locks, finalEmotion, deterministic, aiAnalysis, lastAnalysis }) {
  if (locks.is_at_risk) {
    if (finalEmotion === "proof_seeking") return "trust_recovery";
    if (finalEmotion === "progress_anxiety") return "fulfillment";
    return "recovery";
  }

  if (locks.is_post_payment) {
    if (finalEmotion === "educational_support") return "support";
    return "fulfillment";
  }

  if (locks.is_brand_direction && finalEmotion === "brand_ownership") {
    return "branding";
  }

  if (locks.is_sample_direction && finalEmotion === "risk_aversion") {
    return "trial";
  }

  const mappedFromEmotion = mapIntentFromEmotion(finalEmotion);
  const deterministicIntent = chooseCanonicalValue(
    [
      deterministic.intent,
      aiAnalysis.has_meaningful_ai_data ? aiAnalysis.intent : "",
      lastAnalysis.intent,
    ],
    normalizeIntent,
    DEFAULT_ANALYSIS.intent
  );

  const hasMappedIntent = hasKnownIntent(mappedFromEmotion);
  const hasDeterministicIntent = hasKnownIntent(deterministicIntent);

  if (hasMappedIntent) {
    if (!hasDeterministicIntent) {
      return mappedFromEmotion;
    }

    if (isCompatibleIntentWithEmotion(deterministicIntent, finalEmotion)) {
      return deterministicIntent;
    }

    return mappedFromEmotion;
  }

  return deterministicIntent;
}

function resolveBehaviourStage({
  locks,
  finalEmotion,
  finalIntent,
  deterministic,
  aiAnalysis,
  lastAnalysis,
}) {
  if (locks.is_at_risk) {
    if (finalEmotion === "proof_seeking") return "pre_pelunasan";
    if (finalEmotion === "progress_anxiety") return "post_purchase";
    return "post_decision";
  }

  if (locks.is_post_payment) {
    return "post_purchase";
  }

  if (locks.is_brand_direction && finalEmotion === "brand_ownership") {
    return "decision";
  }

  if (locks.is_sample_direction && finalEmotion === "risk_aversion") {
    return "evaluation";
  }

  const mappedFromEmotion = mapBehaviourStageFromEmotion(finalEmotion);
  const deterministicStage = chooseCanonicalValue(
    [
      deterministic.behaviour_stage,
      aiAnalysis.has_meaningful_ai_data ? aiAnalysis.behaviour_stage : "",
      lastAnalysis.behaviour_stage,
    ],
    normalizeBehaviourStage,
    DEFAULT_ANALYSIS.behaviour_stage
  );

  if (
    mappedFromEmotion !== DEFAULT_ANALYSIS.behaviour_stage &&
    deterministicStage === DEFAULT_ANALYSIS.behaviour_stage
  ) {
    return mappedFromEmotion;
  }

  if (isCompatibleStageWithEmotion(deterministicStage, finalEmotion, finalIntent)) {
    return deterministicStage;
  }

  return mappedFromEmotion || deterministicStage || DEFAULT_ANALYSIS.behaviour_stage;
}

function resolveProspectType({
  locks,
  finalEmotion,
  finalIntent,
  finalBehaviourStage,
  deterministic,
  aiAnalysis,
  lastAnalysis,
}) {
  if (locks.is_at_risk) return "at_risk";
  if (locks.is_post_payment) return "post_payment";
  if (locks.is_brand_direction) return "brand";
  if (locks.is_sample_direction) return "sample";

  const inferred = inferProspectTypeFromResolved({
    finalEmotion,
    finalIntent,
    finalBehaviourStage,
  });
  if (inferred !== "none") return inferred;

  return chooseCanonicalValue(
    [
      deterministic.prospect_type,
      aiAnalysis.has_meaningful_ai_data ? aiAnalysis.prospect_type : "",
      lastAnalysis.prospect_type,
      DEFAULT_ANALYSIS.prospect_type,
    ],
    normalizeProspectType,
    DEFAULT_ANALYSIS.prospect_type
  );
}

function resolveLeadLevel({
  locks,
  finalEmotion,
  finalIntent,
  finalBehaviourStage,
  finalProspectType,
  deterministic,
  aiAnalysis,
  lastAnalysis,
}) {
  if (locks.is_at_risk || finalProspectType === "at_risk" || finalEmotion === "progress_anxiety") {
    return "hot_at_risk";
  }

  if (
    finalProspectType === "post_payment" ||
    finalEmotion === "purchase_readiness" ||
    finalEmotion === "brand_ownership" ||
    finalEmotion === "educational_support" ||
    finalBehaviourStage === "decision" ||
    finalBehaviourStage === "post_decision"
  ) {
    return "hot";
  }

  if (
    SPECIAL_EMOTIONS.WARM_HOT.has(finalEmotion) ||
    finalIntent === "price_process"
  ) {
    return "warm_hot";
  }

  if (
    SPECIAL_EMOTIONS.WARM.has(finalEmotion) ||
    finalBehaviourStage === "interest" ||
    finalBehaviourStage === "evaluation"
  ) {
    return "warm";
  }

  const deterministicLead = chooseCanonicalValue(
    [
      deterministic.lead_level,
      aiAnalysis.has_meaningful_ai_data ? aiAnalysis.lead_level_stage : "",
      lastAnalysis.lead_level_stage,
      DEFAULT_ANALYSIS.lead_level_stage,
    ],
    normalizeLeadLevelStage,
    DEFAULT_ANALYSIS.lead_level_stage
  );

  if (deterministicLead && deterministicLead !== DEFAULT_ANALYSIS.lead_level_stage) {
    return deterministicLead;
  }

  return mapLeadLevelFromEmotion(finalEmotion);
}

function resolvePipeline({
  locks,
  finalLeadLevel,
  finalProspectType,
  deterministic,
  aiAnalysis,
  lastAnalysis,
}) {
  if (locks.is_no_response) return "no_respons";

  if (
    finalProspectType !== "none" ||
    locks.should_upgrade_to_prospek ||
    ["hot", "hot_at_risk"].includes(finalLeadLevel)
  ) {
    return "prospek";
  }

  const deterministicPipeline = chooseCanonicalValue(
    [
      deterministic.pipeline,
      aiAnalysis.has_meaningful_ai_data ? aiAnalysis.pipeline : "",
      lastAnalysis.pipeline,
      DEFAULT_ANALYSIS.pipeline,
    ],
    normalizePipeline,
    DEFAULT_ANALYSIS.pipeline
  );

  return deterministicPipeline === "no_respons" ? "respons" : deterministicPipeline;
}

function resolvePriority({
  locks,
  finalEmotion,
  finalIntent,
  finalPipeline,
  finalProspectType,
  deterministic,
  aiAnalysis,
  lastAnalysis,
}) {
  if (locks.is_at_risk || finalProspectType === "at_risk") return "urgent";
  if (locks.is_post_payment || finalProspectType === "post_payment") return "high";

  if (
    finalPipeline === "prospek" ||
    finalIntent === "purchase" ||
    finalIntent === "branding" ||
    finalIntent === "support" ||
    finalEmotion === "purchase_readiness" ||
    finalEmotion === "brand_ownership"
  ) {
    return "high";
  }

  const chosen = chooseCanonicalValue(
    [
      deterministic.priority,
      aiAnalysis.has_meaningful_ai_data ? aiAnalysis.priority : "",
      lastAnalysis.priority,
      DEFAULT_ANALYSIS.priority,
    ],
    normalizePriorityLevel,
    DEFAULT_ANALYSIS.priority
  );

  return chosen || DEFAULT_ANALYSIS.priority;
}

function resolveSpecialBranch({ locks, finalEmotion, finalProspectType }) {
  if (locks.is_at_risk || finalProspectType === "at_risk") {
    return {
      type: "at_risk",
      ...SPECIAL_BRANCHES.at_risk,
    };
  }

  if (locks.is_post_payment || finalProspectType === "post_payment" || finalEmotion === "progress_anxiety") {
    return {
      type: "post_payment",
      ...SPECIAL_BRANCHES.post_payment,
    };
  }

  return null;
}

function resolveSopStageCurrent({
  locks,
  specialBranch,
  finalEmotion,
  finalIntent,
  finalPipeline,
  finalProspectType,
  deterministic,
  lastAnalysis,
}) {
  if (specialBranch?.default_stage_current) {
    if (specialBranch.type === "at_risk" && finalEmotion === "proof_seeking") {
      return "proof_before_pelunasan";
    }
    if (specialBranch.type === "post_payment") {
      return "progress_produksi";
    }
    return normalizeSopStage(specialBranch.default_stage_current);
  }

  if (finalPipeline === "no_respons") {
    const current = normalizeSopStage(
      deterministic.sop_stage_current || lastAnalysis.sop_stage_current
    );
    if (safeString(current).startsWith("followup_")) return current;
    return "followup_contoh_produk";
  }

  if (finalProspectType === "sample") {
    if (locks.is_post_payment) return "invoice_konfirmasi";
    return "prospek_sample";
  }

  if (finalProspectType === "brand") {
    if (locks.is_post_payment) return "brand_development";
    if (locks.is_brand_direction && deterministic.sop_stage_current === "form_terkirim") return "form_terkirim";
    if (locks.is_brand_direction && deterministic.sop_stage_current === "dp_request") return "dp_request";
    return "prospek_brand";
  }

  if (finalIntent === "support" || finalEmotion === "educational_support") {
    return "brand_development";
  }

  if (
    finalEmotion === "trust_seeking" ||
    finalEmotion === "risk_aversion" ||
    finalEmotion === "budget_concern" ||
    finalEmotion === "analytical_thinking" ||
    finalEmotion === "visual_validation"
  ) {
    return "harga_paket_terkirim";
  }

  if (finalEmotion === "discovery") return "harga_paket_terkirim";
  if (finalEmotion === "curiosity") return "share_info_tanya_balik";

  return normalizeSopStage(
    deterministic.sop_stage_current ||
      lastAnalysis.sop_stage_current ||
      DEFAULT_ANALYSIS.sop_stage_current
  );
}

function resolveSopStageNext({ specialBranch, finalSopStageCurrent, deterministic, lastAnalysis }) {
  if (specialBranch?.default_stage_next) {
    return normalizeSopStage(specialBranch.default_stage_next);
  }

  return normalizeSopStage(
    getSopStageConfig(finalSopStageCurrent)?.next_stage ||
      deterministic.sop_stage_next ||
      lastAnalysis.sop_stage_next ||
      DEFAULT_ANALYSIS.sop_stage_next
  );
}

function resolveConversionRate({
  deterministic,
  aiAnalysis,
  lastAnalysis,
  finalLeadLevel,
  finalProspectType,
}) {
  const deterministicScore = clampNumber(
    Number(deterministic.conversion_rate_analyzed || LEAD_LEVEL_SCORE_MAP[finalLeadLevel] || 30),
    SCORE_LIMITS.CONVERSION_MIN,
    SCORE_LIMITS.CONVERSION_MAX
  );

  const aiScore = Number.isFinite(aiAnalysis.conversion_rate_analyzed)
    ? aiAnalysis.conversion_rate_analyzed
    : null;

  const historyScore = Number.isFinite(lastAnalysis.conversion_rate_analyzed)
    ? lastAnalysis.conversion_rate_analyzed
    : null;

  let score = weightedAverage(
    [
      [deterministicScore, 0.72],
      [aiScore, 0.18],
      [historyScore, 0.10],
    ],
    deterministicScore
  );

  if (finalProspectType === "at_risk") score = Math.max(score, 72);
  if (finalProspectType === "post_payment") score = Math.max(score, 74);
  if (finalLeadLevel === "hot") score = Math.max(score, 82);
  if (finalLeadLevel === "warm_hot") score = Math.max(score, 64);
  if (finalLeadLevel === "warm") score = Math.max(score, 44);

  return clampNumber(Math.round(score), SCORE_LIMITS.CONVERSION_MIN, SCORE_LIMITS.CONVERSION_MAX);
}

function resolveConfidenceScore({ deterministic, aiAnalysis, lastAnalysis, locks }) {
  const base = Number.isFinite(deterministic.confidence_score)
    ? deterministic.confidence_score
    : DEFAULT_ANALYSIS.confidence_score;
  const ai = Number.isFinite(aiAnalysis.confidence_score)
    ? aiAnalysis.confidence_score
    : null;
  const history = Number.isFinite(lastAnalysis.confidence_score)
    ? lastAnalysis.confidence_score
    : null;

  let confidence = weightedAverage(
    [
      [base, 0.68],
      [ai, 0.18],
      [history, 0.14],
    ],
    base
  );

  if (locks.is_at_risk || locks.is_post_payment) confidence += 4;
  if (locks.should_upgrade_to_prospek) confidence += 3;
  if (locks.is_no_response) confidence += 2;

  return clampNumber(Math.round(confidence), SCORE_LIMITS.CONFIDENCE_MIN, SCORE_LIMITS.CONFIDENCE_MAX);
}

function resolveCustomerProfile({
  deterministic,
  lastAnalysis,
  finalLeadLevel,
  finalEmotion,
  finalIntent,
  finalProspectType,
}) {
  const deterministicProfile = chooseLongerText(
    deterministic.customer_profile,
    lastAnalysis.customer_profile,
    ""
  );

  if (deterministicProfile) return deterministicProfile;

  if (finalProspectType === "at_risk" && finalEmotion === "proof_seeking") {
    return "customer yang meminta dokumentasi real order sebelum pelunasan agar rasa percaya naik";
  }

  if (finalProspectType === "post_payment") {
    return "customer yang sudah bayar atau sudah order lalu mengejar status real-time, ETA, dan resi";
  }

  if (finalProspectType === "brand") {
    return "customer yang sudah condong ke brand sendiri dan butuh langkah rapi menuju form, DP, dan brief brand";
  }

  if (finalProspectType === "sample") {
    return "customer yang ingin langkah aman dulu dengan jalur sample sebelum produksi";
  }

  if (finalLeadLevel === "warm_hot" && finalEmotion === "visual_validation") {
    return "customer yang butuh bukti visual untuk mengunci keyakinan sebelum maju ke closing";
  }

  if (finalLeadLevel === "warm_hot" && finalIntent === "price_process") {
    return "customer yang menghitung mix quantity, komposisi item, dan skema biaya secara detail";
  }

  if (finalLeadLevel === "warm") {
    return "customer yang sudah merespons dan sedang mengevaluasi detail paket, trust, sample, atau budget";
  }

  return DEFAULT_ANALYSIS.customer_profile;
}

function resolveFollowupGap({
  deterministic,
  lastAnalysis,
  specialBranch,
  finalSopStageCurrent,
  finalSopStageNext,
  finalProspectType,
  finalPipeline,
  finalEmotion,
}) {
  const explicitGap = chooseLongerText(
    deterministic.followup_gap,
    lastAnalysis.followup_gap,
    ""
  );
  if (explicitGap && !isGenericGap(explicitGap)) return explicitGap;

  if (specialBranch?.type === "at_risk") {
    return "Customer sedang sensitif pada trust, jadi gap terdekat adalah proof konkret yang relevan sesuai tahap order.";
  }

  if (specialBranch?.type === "post_payment") {
    return "Customer sudah masuk fase pasca pembayaran atau pasca order, jadi gap terdekat adalah status real-time, ETA, atau resi yang aktual.";
  }

  if (finalPipeline === "no_respons") {
    return "Customer belum merespons, jadi gap terdekat adalah follow-up bertahap yang paling relevan sesuai urutan SOP.";
  }

  if (finalProspectType === "sample") {
    return "Customer sudah condong ke sample, jadi gap terdekat adalah rincian sample, revisi 1x, dan langkah lanjut yang paling jelas.";
  }

  if (finalProspectType === "brand") {
    return "Customer sudah condong ke brand, jadi gap terdekat adalah mengunci brief brand, form, atau langkah administrasi berikutnya.";
  }

  if (finalEmotion === "trust_seeking") {
    return "Customer masih butuh penjelasan konkret soal legalitas, dokumen, dan penandaan produk.";
  }

  if (finalEmotion === "visual_validation") {
    return "Customer masih butuh bukti visual yang relevan seperti tekstur, warna isi, desain, atau packing.";
  }

  if (finalEmotion === "analytical_thinking") {
    return "Customer masih butuh breakdown yang jelas terkait item, total pcs, dan skema biaya yang paling feasible.";
  }

  return `Tahap saat ini ada di ${finalSopStageCurrent}, jadi gap terdekat adalah menutup langkah menuju ${finalSopStageNext} dengan detail yang lebih konkret.`;
}

function resolveTemplateTexts({
  deterministic,
  specialBranch,
  aiAnalysis,
  finalEmotion,
  finalIntent,
  finalSopStageCurrent,
}) {
  const fallbackAction = buildFallbackAction(finalEmotion, finalIntent, finalSopStageCurrent);
  const fallbackReply = buildFallbackReply(finalEmotion, finalIntent, finalSopStageCurrent);

  const deterministicAction = chooseDeterministicText(
    specialBranch?.cs_action,
    deterministic.cs_action,
    fallbackAction
  );
  const deterministicReply = chooseDeterministicText(
    specialBranch?.suggested_reply,
    deterministic.suggested_reply || deterministic.suggested_response,
    fallbackReply
  );

  const finalAction =
    shouldUseAiText(aiAnalysis.cs_action, deterministicAction)
      ? aiAnalysis.cs_action
      : deterministicAction;

  const finalReply =
    shouldUseAiText(aiAnalysis.suggested_reply || aiAnalysis.suggested_response, deterministicReply, true)
      ? (aiAnalysis.suggested_reply || aiAnalysis.suggested_response)
      : deterministicReply;

  return {
    cs_action: safeString(finalAction || fallbackAction || DEFAULT_ANALYSIS.cs_action),
    suggested_reply: safeString(finalReply || fallbackReply || DEFAULT_ANALYSIS.suggested_reply),
    required_artifacts: uniqueStrings([
      ...toStringArray(getRequiredArtifactsForStage(finalSopStageCurrent)),
      ...toStringArray(specialBranch?.required_artifacts),
    ]),
  };
}

/* ---------------------------------
   Builders
---------------------------------- */

function buildFallbackAction(finalEmotion, finalIntent, finalSopStageCurrent) {
  if (finalEmotion === "trust_seeking") {
    return "Jelaskan legalitas, dokumen yang diterima customer, dan skema penandaan brand dengan detail yang konkret.";
  }

  if (finalEmotion === "risk_aversion") {
    return "Bandingkan sample versus langsung produksi dengan bahasa sederhana, lalu arahkan ke opsi paling aman untuk tahap sekarang.";
  }

  if (finalEmotion === "budget_concern") {
    return "Bantu customer dengan simulasi biaya yang realistis, bertahap, dan tidak terasa memaksa.";
  }

  if (finalEmotion === "analytical_thinking") {
    return "Kirim breakdown item, total pcs, dan skema biaya yang paling feasible sesuai target customer.";
  }

  if (finalEmotion === "visual_validation") {
    return "Kirim visual yang paling relevan seperti tekstur, warna isi, desain, atau packing agar customer lebih yakin.";
  }

  if (finalEmotion === "purchase_readiness") {
    return "Kunci langkah pembelian dengan total, DP, rekening resmi, dan konfirmasi administrasi yang jelas.";
  }

  if (finalEmotion === "brand_ownership") {
    return "Ubah obrolan menjadi brief brand yang rapi, lalu kunci nama brand, konsep, warna utama, dan style packing.";
  }

  if (finalEmotion === "educational_support") {
    return "Siapkan ringkasan kandungan dan manfaat produk yang mudah dipakai untuk live atau promosi.";
  }

  if (finalEmotion === "trust_anxiety" || finalEmotion === "proof_seeking") {
    return "Turunkan rasa ragu customer dengan bukti konkret yang relevan sesuai tahap order, bukan jawaban umum.";
  }

  if (finalEmotion === "progress_anxiety") {
    return "Pindahkan komunikasi ke mode status real-time: posisi order, ETA, dan resi jika tersedia.";
  }

  if (safeString(finalSopStageCurrent).startsWith("followup_")) {
    return "Lanjutkan follow-up sesuai urutan SOP tanpa hard closing yang terlalu cepat.";
  }

  if (finalIntent === "branding") {
    return "Arahkan customer ke langkah brand yang paling dekat dan paling rapi.";
  }

  if (finalIntent === "trial") {
    return "Arahkan customer ke jalur sample yang paling aman dan paling jelas.";
  }

  return DEFAULT_ANALYSIS.cs_action;
}

function buildFallbackReply(finalEmotion, finalIntent, finalSopStageCurrent) {
  if (finalEmotion === "trust_seeking") {
    return "Baik kak, nanti saya jelaskan legalitas, dokumen, dan penandaan produknya dengan lebih konkret ya supaya kakak jelas dari awal.";
  }

  if (finalEmotion === "risk_aversion") {
    return "Boleh kak, saya bantu bandingkan sample dan langsung produksi ya, termasuk fungsi sample dan kapan lebih cocok lanjut produksi.";
  }

  if (finalEmotion === "budget_concern") {
    return "Kalau budget kakak masih dijaga, saya bantu hitungkan opsi paling aman dulu ya kak supaya lebih mantap.";
  }

  if (finalEmotion === "analytical_thinking") {
    return "Siap kak, saya bantu rinci total pcs per item dan skema biayanya ya supaya lebih jelas.";
  }

  if (finalEmotion === "visual_validation") {
    return "Siap kak, saya bantu kirim contoh visual yang paling mendekati keinginan kakak ya supaya lebih kebayang.";
  }

  if (finalEmotion === "purchase_readiness") {
    return "Siap kak, next step-nya saya bantu kunci total, DP, dan administrasinya ya supaya prosesnya rapi.";
  }

  if (finalEmotion === "brand_ownership") {
    return "Bisa kak, kita lock dulu nama brand, konsep, dan style packing yang kakak mau ya supaya prosesnya lebih cepat.";
  }

  if (finalEmotion === "educational_support") {
    return "Bisa kak, nanti saya bantu siapkan ringkasan kandungan dan manfaat produknya dengan bahasa yang lebih mudah dipakai ya.";
  }

  if (finalEmotion === "trust_anxiety" || finalEmotion === "proof_seeking") {
    return "Paham kak, saya bantu kirim bukti yang konkret dan relevan dulu ya supaya kakak lebih tenang.";
  }

  if (finalEmotion === "progress_anxiety") {
    return "Baik kak, saya cek status real order kakak sekarang ya lalu saya infokan tahap dan estimasi berikutnya.";
  }

  if (safeString(finalSopStageCurrent).startsWith("followup_")) {
    return "Halo kak, saya izin follow up ya. Saya bantu kirim yang paling relevan dulu supaya kakak lebih kebayang.";
  }

  if (finalIntent === "branding") {
    return "Siap kak, saya bantu arahkan ke langkah brand yang paling dekat dulu ya.";
  }

  if (finalIntent === "trial") {
    return "Boleh kak, saya bantu arahkan ke opsi sample yang paling aman dulu ya.";
  }

  return DEFAULT_ANALYSIS.suggested_reply;
}

/* ---------------------------------
   Merge helpers
---------------------------------- */

function mergeStatusFlags(...items) {
  const list = items.filter((item) => item && typeof item === "object");
  return {
    is_sample_direction: list.some((item) => Boolean(item.is_sample_direction)),
    is_brand_direction: list.some((item) => Boolean(item.is_brand_direction)),
    is_post_payment: list.some((item) => Boolean(item.is_post_payment)),
    is_at_risk: list.some((item) => Boolean(item.is_at_risk)),
    customer_bubble_gt_5: list.some((item) => Boolean(item.customer_bubble_gt_5)),
  };
}

function mergeBubbleMetrics(...items) {
  const list = items.filter((item) => item && typeof item === "object");
  const customerBubbleCount = Math.max(
    0,
    ...list.map((item) => toSafeNumber(item.customer_bubble_count))
  );
  const agentBubbleCount = Math.max(
    0,
    ...list.map((item) => toSafeNumber(item.agent_bubble_count))
  );

  return {
    customer_bubble_count: customerBubbleCount,
    agent_bubble_count: agentBubbleCount,
    customer_bubble_gt_5: list.some(
      (item) => Boolean(item.customer_bubble_gt_5) || toSafeNumber(item.customer_bubble_count) > 5
    ),
  };
}

function mergeSopSignals(...items) {
  const list = items.filter((item) => item && typeof item === "object");

  const merged = {
    curiosity_paket: false,
    discovery_paket_structure: false,
    legality_bpom: false,
    sample_vs_produksi: false,
    budget_concern: false,
    analytical_quantity_mix: false,
    visual_validation: false,
    purchase_readiness: false,
    brand_ownership: false,
    educational_support: false,
    trust_anxiety: false,
    progress_anxiety: false,
    proof_seeking: false,
    should_upgrade_to_prospek: false,
    detected_topics: [],
    urgency_score: 0,
  };

  for (const item of list) {
    for (const key of Object.keys(merged)) {
      if (key === "detected_topics") {
        merged.detected_topics = uniqueStrings([
          ...merged.detected_topics,
          ...toStringArray(item.detected_topics),
        ]);
        continue;
      }

      if (key === "urgency_score") {
        merged.urgency_score = Math.max(
          merged.urgency_score,
          toSafeNumber(item.urgency_score)
        );
        continue;
      }

      merged[key] = Boolean(merged[key] || item[key]);
    }
  }

  return merged;
}

export function mergeMatchedIn(baseMatchedIn, otherMatchedIn) {
  const left = baseMatchedIn && typeof baseMatchedIn === "object" ? baseMatchedIn : emptyMatchedIn();
  const right = otherMatchedIn && typeof otherMatchedIn === "object" ? otherMatchedIn : emptyMatchedIn();

  return {
    latest: uniqueStrings([...toStringArray(left.latest), ...toStringArray(right.latest)]),
    tail: uniqueStrings([...toStringArray(left.tail), ...toStringArray(right.tail)]),
    summary: uniqueStrings([...toStringArray(left.summary), ...toStringArray(right.summary)]),
  };
}

/* ---------------------------------
   Reason / uncertainty helpers
---------------------------------- */

function buildPipelineReason({
  isNoResponse,
  isSampleDirection,
  isBrandDirection,
  isPostPayment,
  isAtRisk,
  shouldUpgradeToProspek,
  bubbleGt5,
}) {
  if (isNoResponse) return "followup_stage_or_history_locked_no_respons";
  if (isAtRisk) return "at_risk_locked_prospek";
  if (isPostPayment) return "post_payment_locked_prospek";
  if (isBrandDirection) return "brand_direction_locked_prospek";
  if (isSampleDirection) return "sample_direction_locked_prospek";
  if (shouldUpgradeToProspek) return bubbleGt5 ? "bubble_gt_5_upgrade_to_prospek" : "strong_signal_upgrade_to_prospek";
  return "default_respons";
}

function buildProspectReason({
  isSampleDirection,
  isBrandDirection,
  isPostPayment,
  isAtRisk,
}) {
  if (isAtRisk) return "at_risk_signal";
  if (isPostPayment) return "post_payment_signal";
  if (isBrandDirection) return "brand_signal";
  if (isSampleDirection) return "sample_signal";
  return "no_locked_prospect_type";
}

function buildUncertaintyNote({
  deterministic,
  aiAnalysis,
  lastAnalysis,
  context,
  locks,
  finalEmotion,
  finalIntent,
  finalProspectType,
  finalSopStageCurrent,
}) {
  const notes = [];

  if (
    aiAnalysis.has_meaningful_ai_data &&
    deterministic.emotion &&
    aiAnalysis.emotion &&
    deterministic.emotion !== aiAnalysis.emotion &&
    !locks.is_at_risk &&
    !locks.is_post_payment
  ) {
    notes.push("Ada perbedaan sinyal antara deterministic engine dan AI classifier, jadi resolver memakai aturan deterministic sebagai dasar utama.");
  }

  if (
    lastAnalysis.rule_id &&
    safeString(lastAnalysis.sop_stage_current) === safeString(finalSopStageCurrent) &&
    !deterministic.rule_id
  ) {
    notes.push("Sebagian kontinuitas tahap dibantu oleh historical last analysis karena sinyal baru masih minim.");
  }

  if (
    finalProspectType === "post_payment" &&
    !context.has_dp_paid &&
    !context.has_invoice_sent &&
    !context.has_resi_sent
  ) {
    notes.push("Post-payment dipilih dari kombinasi sinyal percakapan dan history, bukan hanya dari boolean pembayaran.");
  }

  if (
    finalProspectType === "at_risk" &&
    !context.has_product_proof_sent &&
    (finalEmotion === "trust_anxiety" || finalEmotion === "proof_seeking")
  ) {
    notes.push("At-risk diprioritaskan karena sinyal trust atau proof lebih kuat daripada sinyal closing biasa.");
  }

  if (
    finalIntent === "branding" &&
    !context.has_form_sent &&
    !context.has_form_filled
  ) {
    notes.push("Jalur branding sudah kuat, tetapi status form brand belum eksplisit.");
  }

  return notes.join(" ");
}

/* ---------------------------------
   Template selectors
---------------------------------- */

function chooseDeterministicText(...values) {
  const candidates = values.map((value) => safeString(value)).filter(Boolean);
  for (const candidate of candidates) {
    if (!isGenericBusinessText(candidate)) return candidate;
  }
  return candidates[0] || "";
}

function chooseLongerText(...values) {
  return values
    .map((value) => safeString(value))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || "";
}

function shouldUseAiText(aiText, deterministicText, isReply = false) {
  const ai = safeString(aiText);
  const deterministic = safeString(deterministicText);

  if (!ai) return false;
  if (!deterministic) return true;
  if (isGenericBusinessText(deterministic)) return true;
  if (ai.length < deterministic.length * 0.7) return false;

  const genericList = isReply ? GENERIC_REPLY_HINTS : GENERIC_ACTION_HINTS;
  const safeAi = ai.toLowerCase();
  if (genericList.some((hint) => safeAi.includes(hint))) return false;

  return false;
}

function isGenericBusinessText(text) {
  const safe = safeString(text).toLowerCase();
  if (!safe) return true;
  if (safe.length < 30) return true;

  return GENERIC_ACTION_HINTS.some((hint) => safe.includes(hint)) ||
    GENERIC_REPLY_HINTS.some((hint) => safe.includes(hint));
}

function isGenericGap(text) {
  const safe = safeString(text).toLowerCase();
  if (!safe) return true;
  return safe.includes("gap terdekat") && safe.length < 120;
}

/* ---------------------------------
   Mappers
---------------------------------- */

function mapIntentFromEmotion(emotion) {
  switch (normalizeEmotion(emotion)) {
    case "curiosity":
    case "discovery":
      return "exploration";
    case "trust_seeking":
    case "visual_validation":
      return "trust";
    case "risk_aversion":
      return "trial";
    case "budget_concern":
      return "price";
    case "analytical_thinking":
      return "price_process";
    case "purchase_readiness":
      return "purchase";
    case "brand_ownership":
      return "branding";
    case "educational_support":
      return "support";
    case "trust_anxiety":
      return "recovery";
    case "progress_anxiety":
      return "fulfillment";
    case "proof_seeking":
      return "trust_recovery";
    default:
      return "unknown";
  }
}

function mapBehaviourStageFromEmotion(emotion) {
  switch (normalizeEmotion(emotion)) {
    case "curiosity":
      return "curiosity";
    case "discovery":
      return "interest";
    case "trust_seeking":
    case "risk_aversion":
    case "budget_concern":
    case "analytical_thinking":
    case "visual_validation":
      return "evaluation";
    case "purchase_readiness":
    case "brand_ownership":
      return "decision";
    case "educational_support":
    case "trust_anxiety":
      return "post_decision";
    case "progress_anxiety":
      return "post_purchase";
    case "proof_seeking":
      return "pre_pelunasan";
    default:
      return DEFAULT_ANALYSIS.behaviour_stage;
  }
}

function mapLeadLevelFromEmotion(emotion) {
  const e = normalizeEmotion(emotion);
  if (SPECIAL_EMOTIONS.AT_RISK.has(e)) return "hot_at_risk";
  if (SPECIAL_EMOTIONS.HOT.has(e)) return "hot";
  if (SPECIAL_EMOTIONS.WARM_HOT.has(e)) return "warm_hot";
  if (SPECIAL_EMOTIONS.WARM.has(e)) return "warm";
  return "cold";
}

function inferProspectTypeFromResolved({ finalEmotion, finalIntent, finalBehaviourStage }) {
  if (["trust_anxiety", "proof_seeking", "progress_anxiety"].includes(finalEmotion)) {
    return "at_risk";
  }

  if (finalBehaviourStage === "post_purchase" || finalIntent === "fulfillment") {
    return "post_payment";
  }

  if (finalIntent === "branding" || finalEmotion === "brand_ownership") {
    return "brand";
  }

  if (finalIntent === "trial" || finalEmotion === "risk_aversion") {
    return "sample";
  }

  return "none";
}

function isCompatibleIntentWithEmotion(intent, emotion) {
  return mapIntentFromEmotion(emotion) === normalizeIntent(intent);
}

function isCompatibleStageWithEmotion(stage, emotion, intent) {
  const normalizedStage = normalizeBehaviourStage(stage);
  const mapped = mapBehaviourStageFromEmotion(emotion);
  if (normalizedStage === mapped) return true;

  if (normalizeIntent(intent) === "support" && normalizedStage === "post_decision") return true;
  if (normalizeIntent(intent) === "branding" && normalizedStage === "decision") return true;
  return false;
}

function hasKnownIntent(value) {
  const normalized = normalizeIntent(value);
  return safeString(normalized) && normalized !== safeString(DEFAULT_ANALYSIS.intent);
}

/* ---------------------------------
   Utility
---------------------------------- */

function chooseField(...values) {
  return values.map((value) => safeString(value)).find(Boolean) || "";
}

function chooseFirstNonEmpty(...values) {
  return chooseField(...values);
}

function chooseCanonicalValue(values, normalizer, fallback) {
  const arr = Array.isArray(values) ? values : [];
  for (const value of arr) {
    const raw = safeString(value);
    if (!raw) continue;
    const normalized = normalizer(raw);
    if (safeString(normalized) && normalized !== "unknown") return normalized;
  }
  return fallback;
}

function weightedAverage(weightedValues, fallback = 0) {
  const items = Array.isArray(weightedValues) ? weightedValues : [];
  let numerator = 0;
  let denominator = 0;

  for (const item of items) {
    const value = Array.isArray(item) ? Number(item[0]) : NaN;
    const weight = Array.isArray(item) ? Number(item[1]) : NaN;
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
    numerator += value * weight;
    denominator += weight;
  }

  if (denominator <= 0) return Number(fallback) || 0;
  return numerator / denominator;
}

function pickFirstUsableAI(items) {
  for (const item of Array.isArray(items) ? items : []) {
    const sanitized = sanitizeAIAnalysis(item?.value);
    if (sanitized.has_meaningful_ai_data) {
      return {
        source: safeString(item?.source || sanitized.source || "ai"),
        value: sanitized,
      };
    }
  }

  return null;
}

function buildSourcesUsed({ deterministic, aiAnalysis, lastAnalysis, specialBranch, source }) {
  const out = ["dataset", "lead_scoring", "merge_analysis"];

  if (deterministic.rule_id) out.push("deterministic");
  if (aiAnalysis.has_meaningful_ai_data) out.push(safeString(source || aiAnalysis.source || "ai"));
  if (lastAnalysis.rule_id) out.push("last_analysis");
  if (specialBranch?.type) out.push(`special_branch:${specialBranch.type}`);

  return uniqueStrings(out);
}

function summarizeCrmState(context) {
  return {
    brand_channel: context.brand_channel,
    has_form_sent: context.has_form_sent,
    has_form_filled: context.has_form_filled,
    has_dp_paid: context.has_dp_paid,
    has_invoice_sent: context.has_invoice_sent,
    has_product_proof_sent: context.has_product_proof_sent,
    has_resi_sent: context.has_resi_sent,
    is_post_payment: context.is_post_payment,
    is_at_risk: context.is_at_risk,
    customer_bubble_count: context.bubble_metrics?.customer_bubble_count || 0,
  };
}

function summarizeMergeSource(source) {
  if (!source || typeof source !== "object") return null;
  return {
    rule_id: safeString(source.rule_id || ""),
    pipeline: safeString(source.pipeline || ""),
    lead_level: safeString(source.lead_level || source.lead_level_stage || ""),
    emotion: safeString(source.emotion || ""),
    intent: safeString(source.intent || ""),
    behaviour_stage: safeString(source.behaviour_stage || ""),
    prospect_type: safeString(source.prospect_type || ""),
    sop_stage_current: safeString(source.sop_stage_current || ""),
    confidence_score: Number.isFinite(source.confidence_score) ? source.confidence_score : null,
  };
}

function resolveRouteTarget(pipeline) {
  const safePipeline = normalizePipeline(pipeline);
  if (safePipeline === "no_respons") return "no_respons_followup_composer";
  if (safePipeline === "prospek") return "prospek_closing_composer";
  return "respons_qualification_composer";
}

function emptyMatchedIn() {
  return {
    latest: [],
    tail: [],
    summary: [],
  };
}

function sanitizeStatusFlags(input) {
  const raw = input && typeof input === "object" ? input : {};
  return {
    is_sample_direction: Boolean(raw.is_sample_direction),
    is_brand_direction: Boolean(raw.is_brand_direction),
    is_post_payment: Boolean(raw.is_post_payment),
    is_at_risk: Boolean(raw.is_at_risk),
    customer_bubble_gt_5: Boolean(raw.customer_bubble_gt_5),
  };
}

function sanitizeBubbleMetrics(input) {
  const raw = input && typeof input === "object" ? input : {};
  return {
    customer_bubble_count: toSafeNumber(raw.customer_bubble_count),
    agent_bubble_count: toSafeNumber(raw.agent_bubble_count),
    customer_bubble_gt_5: Boolean(
      raw.customer_bubble_gt_5 || toSafeNumber(raw.customer_bubble_count) > 5
    ),
  };
}

function sanitizeSopSignals(input) {
  const raw = input && typeof input === "object" ? input : {};
  return {
    curiosity_paket: Boolean(raw.curiosity_paket),
    discovery_paket_structure: Boolean(raw.discovery_paket_structure),
    legality_bpom: Boolean(raw.legality_bpom),
    sample_vs_produksi: Boolean(raw.sample_vs_produksi),
    budget_concern: Boolean(raw.budget_concern),
    analytical_quantity_mix: Boolean(raw.analytical_quantity_mix),
    visual_validation: Boolean(raw.visual_validation),
    purchase_readiness: Boolean(raw.purchase_readiness),
    brand_ownership: Boolean(raw.brand_ownership),
    educational_support: Boolean(raw.educational_support),
    trust_anxiety: Boolean(raw.trust_anxiety),
    progress_anxiety: Boolean(raw.progress_anxiety),
    proof_seeking: Boolean(raw.proof_seeking),
    should_upgrade_to_prospek: Boolean(raw.should_upgrade_to_prospek),
    detected_topics: uniqueStrings(toStringArray(raw.detected_topics)),
    urgency_score: toSafeNumber(raw.urgency_score),
  };
}

function normalizePercent(value, fallback = DEFAULT_ANALYSIS.confidence_score) {
  if (value === null || value === undefined || value === "") return fallback;
  const n =
    typeof value === "string"
      ? Number(String(value).replace(/[^\d.-]/g, "").trim())
      : Number(value);

  if (!Number.isFinite(n)) return fallback;
  return clampNumber(Math.round(n), 0, 100);
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeString(item)).filter(Boolean);
}

function firstArrayItem(value) {
  return Array.isArray(value) && value.length > 0 ? value[0] : undefined;
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(Boolean))];
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

function safeString(value) {
  return String(value || "").trim();
}

function toSafeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}