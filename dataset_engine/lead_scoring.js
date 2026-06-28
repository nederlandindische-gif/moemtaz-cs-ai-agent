// dataset_engine/lead_scoring.js

import {
  DEFAULT_ANALYSIS,
  normalizeAnalysisTaxonomy,
  normalizeDatasetText,
  normalizeLeadLevelStage,
  normalizePipeline,
  normalizePriorityLevel,
  normalizeProspectType,
  normalizeIntent,
  normalizeEmotion,
  normalizeBehaviourStage,
} from "./rules.js";

const SCORE_LIMITS = Object.freeze({
  MIN: 5,
  MAX: 98,
  COLD_MAX: 34,
  WARM_MAX: 52,
  WARM_HOT_MAX: 72,
  HOT_MAX: 88,
});

const CORE_WEIGHTS = Object.freeze({
  price: 12,
  sample: 15,
  form: 18,
  dp_transfer: 22,
  invoice: 20,
  trust_risk: 19,
  progress_risk: 18,
  proof_packing: 19,

  purchase_readiness: 16,
  brand_intent: 9,
  brand_lock: 11,
  legality: 8,
  budget: 7,
  analytical: 8,
  visual: 7,
  educational: 6,
  package_discovery: 6,
  curiosity_paket: 4,
  qty: 2,
  post_payment: 14,
  bubble_gt_5: 5,
  positivity: 2,
  future_delay_penalty: -7,
  confusion_penalty: -5,
});

const SIGNAL_PATTERNS = Object.freeze({
  qty: /\b(\d{1,5})\s*(pcs|pc|botol|unit|pak|dus|set|box|kg|gram|gr|item)\b/g,

  price_request:
    /\b(harga|biaya|budget|modal|promo|paket harga|paket awal|harga paket|share harga|berapa harganya)\b/g,

  curiosity_paket:
    /\b(info terbaru|1 paket|itu 1 paket|paket awal|share harga promonya|harga promo|paket berapa)\b/g,

  package_discovery:
    /\b(isinya apa saja|beda reguler|silver|gold|100 pcs|100 pc|5 item|masing masing 20 pcs|1 paket terdiri)\b/g,

  sample_request:
    /\b(sample|tester|sampel|uji sample|mau coba dulu|lihat sample|sample dulu|buat sample)\b/g,

  sample_vs_production:
    /\b(beda sample|langsung produksi|sample vs produksi|kalau sample|kalau langsung produksi|revisi 1x|revisi satu kali)\b/g,

  brand_intent:
    /\b(brand sendiri|bikin brand|buat brand|pakai merek sendiri|private label|nama brand|merek|brand development)\b/g,

  brand_lock:
    /\b(nama brand|warna utama|style packing|request packing|dinamaiin|lock brand|konsep brand)\b/g,

  form_request:
    /\b(form brand development|form brand|isi form|formnya|kirim form|form order)\b/g,

  legality:
    /\b(bpom|legalitas|izin|dokumen|izin edar|surat bpom|terdaftar|menginduk)\b/g,

  budget_concern:
    /\b(low keuangan|budget terbatas|anggaran terbatas|modal aman|kalkulasi|pertimbangan matang|budget minim)\b/g,

  analytical_mix:
    /\b(harga per item|meliputi item|mix qty|komposisi item|rincian total pcs|day cream|night cream|toner|facial wash|serum)\b/g,

  visual_validation:
    /\b(video|foto|tekstur|warna isi|packing|desain|referensi desain|contoh packing|lihat hasil)\b/g,

  educational_support:
    /\b(kandungan|manfaat|brosur|buat live|materi live|promosi|penjelasan kandungan)\b/g,

  purchase_readiness:
    /\b(langsung produksi|cara order|pemesanannya|cod|tinggal transfer|siap order|langsung yang 100 pcs produksi)\b/g,

  transfer_dp:
    /\b(transfer|dp|bayar dp|siap dp|langsung bayar|pelunasan|tinggal transfer|rekening resmi)\b/g,

  invoice_request:
    /\b(invoice|kirim invoice|konfirmasi pembayaran|bukti pembayaran|invoice_konfirmasi)\b/g,

  post_payment:
    /\b(sudah transfer|sudah bayar|sudah dp|sudah pelunasan|sudah lunas|order saya|pesanan saya)\b/g,

  trust_risk:
    /\b(amanah|tertipu|ketipu|takut scam|ragu|beneran|semakin ragu|saling percaya)\b/g,

  progress_risk:
    /\b(kapan dikirim|perkembangan pesanan|progress pesanan|status order|saya tunggu|hari itu juga|resi)\b/g,

  proof_packing:
    /\b(lihat dulu produk saya|keseluruhan produk|video packing|siap kirim|sebelum pelunasan|proof|bukti real)\b/g,

  no_response_cue:
    /\b(follow up|izin follow up|boleh saya follow up)\b/g,

  future_delay:
    /\b(nanti dulu|masih pikir|masih pertimbangan|belum sempat|masih sibuk|bulan depan|masih persiapan)\b/g,

  confusion:
    /\b(gimana|kurang paham|belum paham|maksudnya|bingung)\b/g,

  positivity:
    /\b(oke|siap|bagus|mantap|cocok|menarik|mau|lanjut|setuju)\b/g,
});

/* ---------------------------------
   Public API
---------------------------------- */

export function calculateLeadScore(input = {}) {
  const datasetBase = sanitizeDatasetBase(
    input.datasetBase || input?.detection?.dataset_base || DEFAULT_ANALYSIS
  );

  const segments = buildNormalizedSegments(input);
  const signals = collectSignals(segments, input?.detection, datasetBase, input);

  let score = clampNumber(
    Number(
      datasetBase.conversion_rate_analyzed ??
        DEFAULT_ANALYSIS.conversion_rate_analyzed ??
        20
    ),
    SCORE_LIMITS.MIN,
    SCORE_LIMITS.MAX
  );

  let confidence = clampNumber(
    Number(datasetBase.confidence_score ?? DEFAULT_ANALYSIS.confidence_score ?? 20),
    20,
    98
  );

  const scoring_breakdown = [];

  applyScore(scoring_breakdown, datasetBase.rule_id, "dataset_row_anchor", 0, () => {
    confidence += 2;
  });

  applyScore(scoring_breakdown, signals.hasPriceRequest, "price_request", CORE_WEIGHTS.price, (v) => {
    score += v;
    confidence += 4;
  });

  applyScore(scoring_breakdown, signals.hasSampleRequest, "sample_request", CORE_WEIGHTS.sample, (v) => {
    score += v;
    confidence += 5;
  });

  applyScore(scoring_breakdown, signals.hasSampleVsProduction, "sample_vs_production", 6, (v) => {
    score += v;
    confidence += 3;
  });

  applyScore(scoring_breakdown, signals.hasFormRequest, "form_request", CORE_WEIGHTS.form, (v) => {
    score += v;
    confidence += 6;
  });

  applyScore(scoring_breakdown, signals.hasTransferOrDP, "dp_transfer", CORE_WEIGHTS.dp_transfer, (v) => {
    score += v;
    confidence += 7;
  });

  applyScore(scoring_breakdown, signals.hasInvoiceRequest, "invoice_request", CORE_WEIGHTS.invoice, (v) => {
    score += v;
    confidence += 7;
  });

  applyScore(scoring_breakdown, signals.hasTrustRisk, "trust_risk", CORE_WEIGHTS.trust_risk, (v) => {
    score += v;
    confidence += 6;
  });

  applyScore(scoring_breakdown, signals.hasProgressRisk, "progress_risk", CORE_WEIGHTS.progress_risk, (v) => {
    score += v;
    confidence += 6;
  });

  applyScore(scoring_breakdown, signals.hasProofPackingRequest, "proof_packing", CORE_WEIGHTS.proof_packing, (v) => {
    score += v;
    confidence += 6;
  });

  applyScore(scoring_breakdown, signals.hasPostPayment, "post_payment", CORE_WEIGHTS.post_payment, (v) => {
    score += v;
    confidence += 5;
  });

  applyScore(scoring_breakdown, signals.hasPurchaseReadiness, "purchase_readiness", CORE_WEIGHTS.purchase_readiness, (v) => {
    score += v;
    confidence += 5;
  });

  applyScore(scoring_breakdown, signals.hasBrandIntent, "brand_intent", CORE_WEIGHTS.brand_intent, (v) => {
    score += v;
    confidence += 3;
  });

  applyScore(scoring_breakdown, signals.hasBrandLock, "brand_lock", CORE_WEIGHTS.brand_lock, (v) => {
    score += v;
    confidence += 4;
  });

  applyScore(scoring_breakdown, signals.hasLegalityIntent, "legality", CORE_WEIGHTS.legality, (v) => {
    score += v;
    confidence += 3;
  });

  applyScore(scoring_breakdown, signals.hasBudgetConcern, "budget_concern", CORE_WEIGHTS.budget, (v) => {
    score += v;
    confidence += 2;
  });

  applyScore(scoring_breakdown, signals.hasAnalyticalMix, "analytical_mix", CORE_WEIGHTS.analytical, (v) => {
    score += v;
    confidence += 3;
  });

  applyScore(scoring_breakdown, signals.hasVisualValidation, "visual_validation", CORE_WEIGHTS.visual, (v) => {
    score += v;
    confidence += 3;
  });

  applyScore(scoring_breakdown, signals.hasEducationalSupport, "educational_support", CORE_WEIGHTS.educational, (v) => {
    score += v;
    confidence += 2;
  });

  applyScore(scoring_breakdown, signals.hasPackageDiscovery, "package_discovery", CORE_WEIGHTS.package_discovery, (v) => {
    score += v;
    confidence += 2;
  });

  applyScore(scoring_breakdown, signals.hasCuriosityPaket, "curiosity_paket", CORE_WEIGHTS.curiosity_paket, (v) => {
    score += v;
    confidence += 2;
  });

  applyScore(
    scoring_breakdown,
    signals.qtyMentionCount > 0,
    "qty_mentioned",
    Math.min(8, signals.qtyMentionCount * CORE_WEIGHTS.qty),
    (v) => {
      score += v;
      confidence += 2;
    }
  );

  applyScore(scoring_breakdown, signals.customerBubbleGt5, "bubble_gt_5", CORE_WEIGHTS.bubble_gt_5, (v) => {
    score += v;
    confidence += 2;
  });

  applyScore(
    scoring_breakdown,
    signals.hasTransferOrDP && signals.hasInvoiceRequest,
    "dp_plus_invoice_combo",
    8,
    (v) => {
      score += v;
      confidence += 3;
    }
  );

  applyScore(
    scoring_breakdown,
    signals.hasTrustRisk && signals.hasProofPackingRequest,
    "trust_plus_proof_combo",
    8,
    (v) => {
      score += v;
      confidence += 3;
    }
  );

  applyScore(
    scoring_breakdown,
    signals.hasProgressRisk && signals.hasPostPayment,
    "progress_plus_post_payment_combo",
    7,
    (v) => {
      score += v;
      confidence += 3;
    }
  );

  applyScore(
    scoring_breakdown,
    signals.hasPriceRequest && signals.hasSampleRequest,
    "price_plus_sample_combo",
    5,
    (v) => {
      score += v;
      confidence += 2;
    }
  );

  applyScore(
    scoring_breakdown,
    signals.hasBrandIntent && signals.hasFormRequest,
    "brand_plus_form_combo",
    6,
    (v) => {
      score += v;
      confidence += 2;
    }
  );

  applyScore(
    scoring_breakdown,
    signals.datasetMatchedPatternCount >= 2,
    "dataset_multi_pattern_support",
    Math.min(6, signals.datasetMatchedPatternCount * 2),
    (v) => {
      score += v;
      confidence += 3;
    }
  );

  applyScore(
    scoring_breakdown,
    signals.datasetCandidateScore >= 75,
    "dataset_candidate_strength",
    4,
    (v) => {
      score += v;
      confidence += 3;
    }
  );

  applyScore(
    scoring_breakdown,
    signals.hasFutureDelay &&
      !signals.hasTransferOrDP &&
      !signals.hasInvoiceRequest &&
      !signals.hasPostPayment &&
      !signals.hasProofPackingRequest,
    "future_delay_penalty",
    CORE_WEIGHTS.future_delay_penalty,
    (v) => {
      score += v;
      confidence += 1;
    }
  );

  applyScore(
    scoring_breakdown,
    signals.hasConfusion &&
      !signals.hasPriceRequest &&
      !signals.hasSampleRequest &&
      !signals.hasBrandIntent &&
      !signals.hasLegalityIntent,
    "confusion_penalty",
    CORE_WEIGHTS.confusion_penalty,
    (v) => {
      score += v;
      confidence -= 4;
    }
  );

  applyScore(scoring_breakdown, signals.hasPositivity, "positivity_soft_bonus", CORE_WEIGHTS.positivity, (v) => {
    score += v;
  });

  score = clampNumber(Math.round(score), SCORE_LIMITS.MIN, SCORE_LIMITS.MAX);
  confidence = clampNumber(Math.round(confidence), 20, 98);

  const intent = deriveIntent(datasetBase.intent, signals);
  const emotion = deriveEmotion(datasetBase.emotion, signals);
  const behaviour_stage = deriveBehaviourStage(datasetBase.behaviour_stage, signals);
  const lead_level_stage = deriveLeadLevelStage(
    score,
    datasetBase.lead_level_stage,
    signals,
    behaviour_stage,
    intent
  );
  const prospect_type = deriveProspectType(datasetBase.prospect_type, signals);
  const should_upgrade_to_prospek = deriveShouldUpgradeToProspek(
    datasetBase.pipeline,
    signals,
    intent,
    prospect_type
  );
  const pipeline = derivePipeline(
    datasetBase.pipeline,
    signals,
    intent,
    prospect_type,
    should_upgrade_to_prospek
  );
  const priority_level = derivePriorityLevel(
    datasetBase.priority_level,
    signals,
    pipeline,
    prospect_type,
    lead_level_stage
  );

  return {
    rule_id: datasetBase.rule_id,
    dataset_row_id: datasetBase.dataset_row_id,
    dataset_row_label: datasetBase.dataset_row_label,

    pipeline,
    lead_level: lead_level_stage,
    lead_level_stage,
    priority: priority_level,
    priority_level,
    prospect_type,
    should_upgrade_to_prospek,

    intent,
    emotion,
    behaviour_stage,

    customer_profile: datasetBase.customer_profile || "",
    sop_stage_current: datasetBase.sop_stage_current,
    default_sop_stage_current: datasetBase.default_sop_stage_current,
    sop_stage_next: datasetBase.sop_stage_next,
    default_sop_stage_next: datasetBase.default_sop_stage_next,
    followup_gap: datasetBase.followup_gap,

    conversion_rate_analyzed: score,

    cs_action: datasetBase.cs_action,
    cs_action_template: datasetBase.cs_action_template,
    suggested_response: datasetBase.suggested_response,
    suggested_reply: datasetBase.suggested_reply || datasetBase.suggested_response,
    suggested_reply_template:
      datasetBase.suggested_reply_template ||
      datasetBase.suggested_reply ||
      datasetBase.suggested_response,

    confidence_score: confidence,

    matched_patterns: Array.isArray(datasetBase.matched_patterns)
      ? datasetBase.matched_patterns
      : [],
    matched_in: datasetBase.matched_in || {
      latest: [],
      tail: [],
      summary: [],
    },
    matched_context_cues: Array.isArray(datasetBase.matched_context_cues)
      ? datasetBase.matched_context_cues
      : [],
    signal_alignment_details: Array.isArray(datasetBase.signal_alignment_details)
      ? datasetBase.signal_alignment_details
      : [],

    tag_emotion: datasetBase.tag_emotion || normalizeTagToken(emotion),
    tag_stage: datasetBase.tag_stage || normalizeTagToken(behaviour_stage),
    rule_source: datasetBase.rule_source || "dataset_sop",

    status_flags: signals.status_flags,
    bubble_metrics: signals.bubble_metrics,
    sop_signals: signals.sop_signals,

    scoring_breakdown,
    signal_summary: buildSignalSummary(
      signals,
      intent,
      behaviour_stage,
      lead_level_stage,
      pipeline,
      priority_level,
      prospect_type,
      should_upgrade_to_prospek
    ),

    scoring_meta: {
      scoring_role: "hint_layer_only",
      primary_weighted_signals: [
        "price_request",
        "sample_request",
        "form_request",
        "dp_transfer",
        "invoice_request",
        "trust_risk",
        "progress_risk",
        "proof_packing",
      ],
    },
  };
}

export function buildScoredDatasetAnalysis(input = {}) {
  return calculateLeadScore(input);
}

/* ---------------------------------
   Hint derivation
---------------------------------- */

export function deriveLeadLevelStage(
  score,
  baseStage,
  signals,
  behaviourStage = "",
  intent = ""
) {
  const normalizedBase = normalizeLeadLevelStage(baseStage);
  const safeBehaviour = normalizeBehaviourStage(behaviourStage);
  const safeIntent = normalizeIntent(intent);

  if (
    signals.status_flags.is_at_risk ||
    signals.hasTrustRisk ||
    signals.hasProofPackingRequest
  ) {
    return preferLeadLevel(normalizedBase, "hot_at_risk");
  }

  if (
    signals.status_flags.is_post_payment ||
    signals.hasPostPayment ||
    signals.hasTransferOrDP ||
    signals.hasInvoiceRequest ||
    signals.hasProgressRisk ||
    safeBehaviour === "post_purchase"
  ) {
    return preferLeadLevel(normalizedBase, "hot");
  }

  if (
    signals.hasFormRequest ||
    signals.hasPurchaseReadiness ||
    signals.hasBrandLock ||
    (signals.hasBrandIntent && signals.hasPriceRequest)
  ) {
    return preferLeadLevel(normalizedBase, "hot");
  }

  if (
    signals.hasSampleRequest ||
    signals.hasSampleVsProduction ||
    signals.hasLegalityIntent ||
    signals.hasAnalyticalMix ||
    signals.hasVisualValidation ||
    signals.hasBudgetConcern ||
    (signals.customerBubbleGt5 &&
      ["trial", "price", "trust", "price_process", "branding"].includes(safeIntent))
  ) {
    return preferLeadLevel(normalizedBase, "warm_hot");
  }

  if (
    signals.hasPriceRequest ||
    signals.hasCuriosityPaket ||
    signals.hasPackageDiscovery
  ) {
    return preferLeadLevel(normalizedBase, "warm");
  }

  if (normalizedBase && normalizedBase !== "cold") {
    return normalizedBase;
  }

  if (score <= SCORE_LIMITS.COLD_MAX) return "cold";
  if (score <= SCORE_LIMITS.WARM_MAX) return "warm";
  if (score <= SCORE_LIMITS.WARM_HOT_MAX) return "warm_hot";
  if (score <= SCORE_LIMITS.HOT_MAX) return "hot";

  return "hot";
}

export function deriveBehaviourStage(baseStage, signals) {
  const normalizedBase = normalizeBehaviourStage(baseStage);

  if (signals.hasProofPackingRequest) {
    return "pre_pelunasan";
  }

  if (
    signals.status_flags.is_post_payment ||
    signals.hasPostPayment ||
    signals.hasProgressRisk
  ) {
    return "post_purchase";
  }

  if (signals.hasEducationalSupport || signals.hasTrustRisk) {
    return preferBehaviourStage(normalizedBase, "post_decision");
  }

  if (
    signals.hasTransferOrDP ||
    signals.hasInvoiceRequest ||
    signals.hasPurchaseReadiness ||
    signals.hasFormRequest ||
    signals.hasBrandLock
  ) {
    return preferBehaviourStage(normalizedBase, "decision");
  }

  if (
    signals.hasSampleRequest ||
    signals.hasSampleVsProduction ||
    signals.hasLegalityIntent ||
    signals.hasBudgetConcern ||
    signals.hasAnalyticalMix ||
    signals.hasVisualValidation
  ) {
    return preferBehaviourStage(normalizedBase, "evaluation");
  }

  if (signals.hasPackageDiscovery || signals.hasBrandIntent) {
    return preferBehaviourStage(normalizedBase, "interest");
  }

  if (signals.hasCuriosityPaket || signals.hasPriceRequest) {
    return normalizedBase || "curiosity";
  }

  return normalizedBase || "curiosity";
}

export function deriveIntent(baseIntent, signals) {
  const normalizedBase = normalizeIntent(baseIntent);

  if (signals.hasProofPackingRequest) {
    return "trust_recovery";
  }

  if (signals.hasTrustRisk) {
    return preferIntent(normalizedBase, "recovery", true);
  }

  if (
    signals.status_flags.is_post_payment ||
    signals.hasPostPayment ||
    signals.hasProgressRisk
  ) {
    return preferIntent(normalizedBase, "fulfillment", true);
  }

  if (signals.hasEducationalSupport) {
    return preferIntent(normalizedBase, "support", true);
  }

  if (signals.hasFormRequest || signals.hasBrandLock) {
    return preferIntent(normalizedBase, "branding", true);
  }

  if (signals.hasTransferOrDP || signals.hasInvoiceRequest || signals.hasPurchaseReadiness) {
    return preferIntent(normalizedBase, "purchase", true);
  }

  if (signals.hasAnalyticalMix) {
    return preferIntent(normalizedBase, "price_process", true);
  }

  if (signals.hasSampleRequest || signals.hasSampleVsProduction) {
    return preferIntent(normalizedBase, "trial", true);
  }

  if (signals.hasLegalityIntent || signals.hasVisualValidation) {
    return preferIntent(normalizedBase, "trust", false);
  }

  if (signals.hasPriceRequest || signals.hasBudgetConcern) {
    return preferIntent(normalizedBase, "price", false);
  }

  if (signals.hasCuriosityPaket || signals.hasPackageDiscovery) {
    return normalizedBase && normalizedBase !== "unknown"
      ? normalizedBase
      : "exploration";
  }

  return normalizedBase || "unknown";
}

export function deriveEmotion(baseEmotion, signals) {
  const normalizedBase = normalizeEmotion(baseEmotion);

  if (signals.hasProofPackingRequest) {
    return "proof_seeking";
  }

  if (signals.hasProgressRisk || signals.status_flags.is_post_payment) {
    return preferEmotion(normalizedBase, "progress_anxiety", true);
  }

  if (signals.hasTrustRisk) {
    return preferEmotion(normalizedBase, "trust_anxiety", true);
  }

  if (signals.hasEducationalSupport) {
    return preferEmotion(normalizedBase, "educational_support", true);
  }

  if (signals.hasFormRequest || signals.hasBrandLock) {
    return preferEmotion(normalizedBase, "brand_ownership", true);
  }

  if (signals.hasPurchaseReadiness || signals.hasTransferOrDP || signals.hasInvoiceRequest) {
    return preferEmotion(normalizedBase, "purchase_readiness", true);
  }

  if (signals.hasVisualValidation) {
    return preferEmotion(normalizedBase, "visual_validation", false);
  }

  if (signals.hasAnalyticalMix) {
    return preferEmotion(normalizedBase, "analytical_thinking", false);
  }

  if (signals.hasBudgetConcern) {
    return preferEmotion(normalizedBase, "budget_concern", false);
  }

  if (signals.hasLegalityIntent) {
    return preferEmotion(normalizedBase, "trust_seeking", false);
  }

  if (signals.hasSampleRequest || signals.hasSampleVsProduction) {
    return preferEmotion(normalizedBase, "risk_aversion", false);
  }

  if (signals.hasPackageDiscovery) {
    return normalizedBase && normalizedBase !== "unknown"
      ? normalizedBase
      : "discovery";
  }

  if (signals.hasCuriosityPaket) {
    return normalizedBase && normalizedBase !== "unknown"
      ? normalizedBase
      : "curiosity";
  }

  return normalizedBase || "unknown";
}

export function deriveProspectType(baseProspectType, signals) {
  const normalizedBase = normalizeProspectType(baseProspectType);

  if (
    signals.status_flags.is_at_risk ||
    signals.hasTrustRisk ||
    signals.hasProofPackingRequest
  ) {
    return "at_risk";
  }

  if (
    signals.status_flags.is_post_payment ||
    signals.hasPostPayment ||
    signals.hasProgressRisk
  ) {
    return "post_payment";
  }

  if (
    signals.hasFormRequest ||
    signals.hasBrandLock ||
    signals.hasBrandIntent ||
    signals.hasTransferOrDP ||
    signals.hasInvoiceRequest ||
    signals.hasPurchaseReadiness ||
    signals.status_flags.is_brand_direction
  ) {
    return "brand";
  }

  if (
    signals.hasSampleRequest ||
    signals.hasSampleVsProduction ||
    signals.status_flags.is_sample_direction
  ) {
    return normalizedBase === "brand" ? "brand" : "sample";
  }

  return normalizedBase || "none";
}

export function deriveShouldUpgradeToProspek(basePipeline, signals, intent, prospectType) {
  if (normalizePipeline(basePipeline) === "prospek") return true;
  if (normalizeProspectType(prospectType) !== "none") return true;

  if (
    signals.hasFormRequest ||
    signals.hasTransferOrDP ||
    signals.hasInvoiceRequest ||
    signals.hasPurchaseReadiness
  ) {
    return true;
  }

  if (
    signals.customerBubbleGt5 &&
    (
      ["trial", "price", "trust", "price_process", "purchase", "branding", "fulfillment", "recovery", "trust_recovery"].includes(
        normalizeIntent(intent)
      ) ||
      signals.hasPriceRequest ||
      signals.hasSampleRequest ||
      signals.hasLegalityIntent ||
      signals.hasAnalyticalMix ||
      signals.hasVisualValidation
    )
  ) {
    return true;
  }

  return false;
}

export function derivePipeline(basePipeline, signals, intent, prospectType, shouldUpgradeToProspek) {
  const normalizedBase = normalizePipeline(basePipeline);
  const safeIntent = normalizeIntent(intent);

  if (signals.hasNoResponseContext || normalizedBase === "no_respons") {
    return "no_respons";
  }

  if (
    normalizeProspectType(prospectType) !== "none" ||
    shouldUpgradeToProspek ||
    signals.hasFormRequest ||
    signals.hasTransferOrDP ||
    signals.hasInvoiceRequest ||
    signals.hasPurchaseReadiness ||
    signals.status_flags.is_post_payment ||
    signals.status_flags.is_at_risk
  ) {
    return "prospek";
  }

  if (
    signals.hasLatestCustomerMessage ||
    signals.customerBubbleCount > 0 ||
    ["exploration", "trial", "price", "trust", "price_process", "branding", "support"].includes(safeIntent)
  ) {
    return "respons";
  }

  return normalizedBase || "respons";
}

export function derivePriorityLevel(basePriority, signals, pipeline, prospectType, leadLevelStage) {
  const normalizedBase = normalizePriorityLevel(basePriority);
  const safePipeline = normalizePipeline(pipeline);
  const safeProspectType = normalizeProspectType(prospectType);
  const safeLead = normalizeLeadLevelStage(leadLevelStage);

  if (
    safeProspectType === "at_risk" ||
    signals.hasTrustRisk ||
    signals.hasProofPackingRequest ||
    signals.status_flags.is_at_risk
  ) {
    return "urgent";
  }

  if (
    safeProspectType === "post_payment" ||
    signals.hasProgressRisk ||
    signals.status_flags.is_post_payment
  ) {
    return "urgent";
  }

  if (
    signals.hasTransferOrDP ||
    signals.hasInvoiceRequest ||
    signals.hasFormRequest ||
    signals.hasPurchaseReadiness ||
    safePipeline === "prospek" ||
    safeLead === "hot"
  ) {
    return "high";
  }

  if (
    signals.hasPriceRequest ||
    signals.hasSampleRequest ||
    signals.hasBrandIntent ||
    signals.hasLegalityIntent ||
    signals.customerBubbleGt5
  ) {
    return normalizedBase === "urgent" ? "urgent" : "high";
  }

  if (
    signals.hasCuriosityPaket ||
    signals.hasPackageDiscovery ||
    safePipeline === "respons"
  ) {
    return normalizedBase || "medium";
  }

  return normalizedBase || "medium";
}

/* ---------------------------------
   Signal collection
---------------------------------- */

function collectSignals(segments, detection, datasetBase, rawInput) {
  const latest = segments.latest;
  const tail = segments.tail;
  const summary = segments.summary;
  const combined = segments.combined;

  const detectionSopSignals =
    detection?.sop_signals ||
    datasetBase.sop_signals ||
    {};

  const detectionStatusFlags =
    detection?.status_flags ||
    detectionSopSignals?.status_flags ||
    datasetBase.status_flags ||
    {};

  const detectionBubbleMetrics =
    detection?.bubble_metrics ||
    datasetBase.bubble_metrics ||
    {};

  const datasetCandidate = detection?.selected_candidate || null;

  const qtyMentionCount = countRegexMatches(combined, SIGNAL_PATTERNS.qty);

  const hasCuriosityPaket =
    hasRegex(latest, SIGNAL_PATTERNS.curiosity_paket) ||
    hasRegex(combined, SIGNAL_PATTERNS.curiosity_paket) ||
    Boolean(detectionSopSignals.curiosity_paket);

  const hasPackageDiscovery =
    hasRegex(combined, SIGNAL_PATTERNS.package_discovery) ||
    Boolean(detectionSopSignals.discovery_paket_structure);

  const hasPriceRequest =
    hasRegex(latest, SIGNAL_PATTERNS.price_request) ||
    hasRegex(combined, SIGNAL_PATTERNS.price_request) ||
    Boolean(detectionSopSignals.curiosity_paket) ||
    Boolean(detectionSopSignals.budget_concern);

  const hasSampleRequest =
    hasRegex(latest, SIGNAL_PATTERNS.sample_request) ||
    hasRegex(combined, SIGNAL_PATTERNS.sample_request) ||
    Boolean(detectionSopSignals.sample_vs_produksi) ||
    Boolean(detectionStatusFlags.is_sample_direction);

  const hasSampleVsProduction =
    hasRegex(combined, SIGNAL_PATTERNS.sample_vs_production) ||
    Boolean(detectionSopSignals.sample_vs_produksi);

  const hasBrandIntent =
    hasRegex(combined, SIGNAL_PATTERNS.brand_intent) ||
    Boolean(detectionSopSignals.brand_ownership) ||
    Boolean(detectionStatusFlags.is_brand_direction);

  const hasBrandLock =
    hasRegex(latest, SIGNAL_PATTERNS.brand_lock) ||
    hasRegex(combined, SIGNAL_PATTERNS.brand_lock) ||
    Boolean(detectionSopSignals.brand_ownership);

  const hasFormRequest =
    hasRegex(combined, SIGNAL_PATTERNS.form_request) ||
    Boolean(rawInput?.has_form_sent) ||
    Boolean(rawInput?.has_form_filled);

  const hasLegalityIntent =
    hasRegex(combined, SIGNAL_PATTERNS.legality) ||
    Boolean(detectionSopSignals.legality_bpom);

  const hasBudgetConcern =
    hasRegex(combined, SIGNAL_PATTERNS.budget_concern) ||
    Boolean(detectionSopSignals.budget_concern);

  const hasAnalyticalMix =
    hasRegex(combined, SIGNAL_PATTERNS.analytical_mix) ||
    Boolean(detectionSopSignals.analytical_quantity_mix);

  const hasVisualValidation =
    hasRegex(combined, SIGNAL_PATTERNS.visual_validation) ||
    Boolean(detectionSopSignals.visual_validation);

  const hasEducationalSupport =
    hasRegex(combined, SIGNAL_PATTERNS.educational_support) ||
    Boolean(detectionSopSignals.educational_support);

  const hasPurchaseReadiness =
    hasRegex(latest, SIGNAL_PATTERNS.purchase_readiness) ||
    hasRegex(combined, SIGNAL_PATTERNS.purchase_readiness) ||
    Boolean(detectionSopSignals.purchase_readiness);

  const hasTransferOrDP =
    hasRegex(latest, SIGNAL_PATTERNS.transfer_dp) ||
    hasRegex(combined, SIGNAL_PATTERNS.transfer_dp) ||
    Boolean(rawInput?.has_dp_paid);

  const hasInvoiceRequest =
    hasRegex(latest, SIGNAL_PATTERNS.invoice_request) ||
    hasRegex(combined, SIGNAL_PATTERNS.invoice_request) ||
    Boolean(rawInput?.has_invoice_sent);

  const hasPostPayment =
    hasRegex(combined, SIGNAL_PATTERNS.post_payment) ||
    Boolean(rawInput?.has_dp_paid) ||
    Boolean(rawInput?.has_invoice_sent) ||
    Boolean(rawInput?.has_resi_sent) ||
    Boolean(detectionStatusFlags.is_post_payment);

  const hasTrustRisk =
    hasRegex(latest, SIGNAL_PATTERNS.trust_risk) ||
    hasRegex(combined, SIGNAL_PATTERNS.trust_risk) ||
    Boolean(detectionSopSignals.trust_anxiety) ||
    Boolean(detectionStatusFlags.is_at_risk);

  const hasProgressRisk =
    hasRegex(latest, SIGNAL_PATTERNS.progress_risk) ||
    hasRegex(combined, SIGNAL_PATTERNS.progress_risk) ||
    Boolean(detectionSopSignals.progress_anxiety);

  const hasProofPackingRequest =
    hasRegex(latest, SIGNAL_PATTERNS.proof_packing) ||
    hasRegex(combined, SIGNAL_PATTERNS.proof_packing) ||
    Boolean(detectionSopSignals.proof_seeking);

  const hasFutureDelay = hasRegex(combined, SIGNAL_PATTERNS.future_delay);
  const hasConfusion =
    hasRegex(latest, SIGNAL_PATTERNS.confusion) ||
    hasRegex(combined, SIGNAL_PATTERNS.confusion);
  const hasPositivity =
    hasRegex(latest, SIGNAL_PATTERNS.positivity) ||
    hasRegex(combined, SIGNAL_PATTERNS.positivity);

  const customerBubbleCount = Math.max(
    toSafeNumber(rawInput?.customer_bubble_count),
    toSafeNumber(detectionBubbleMetrics.customer_bubble_count),
    inferCustomerBubbleCount(rawInput)
  );

  const customerBubbleGt5 =
    Boolean(detectionStatusFlags.customer_bubble_gt_5) ||
    Boolean(detectionBubbleMetrics.customer_bubble_gt_5) ||
    customerBubbleCount > 5;

  const hasLatestCustomerMessage = Boolean(latest);
  const hasNoResponseContext =
    !hasLatestCustomerMessage &&
    (
      Boolean(rawInput?.is_outbound_followup_run) ||
      Boolean(rawInput?.last_cs_action) ||
      normalizePipeline(datasetBase.pipeline) === "no_respons" ||
      hasRegex(tail, SIGNAL_PATTERNS.no_response_cue)
    );

  return {
    qtyMentionCount,

    hasCuriosityPaket,
    hasPackageDiscovery,
    hasPriceRequest,
    hasSampleRequest,
    hasSampleVsProduction,
    hasBrandIntent,
    hasBrandLock,
    hasFormRequest,
    hasLegalityIntent,
    hasBudgetConcern,
    hasAnalyticalMix,
    hasVisualValidation,
    hasEducationalSupport,
    hasPurchaseReadiness,
    hasTransferOrDP,
    hasInvoiceRequest,
    hasPostPayment,
    hasTrustRisk,
    hasProgressRisk,
    hasProofPackingRequest,
    hasFutureDelay,
    hasConfusion,
    hasPositivity,

    hasLatestCustomerMessage,
    hasNoResponseContext,

    customerBubbleCount,
    customerBubbleGt5,

    datasetMatchedPatternCount: Array.isArray(datasetCandidate?.matched_patterns)
      ? datasetCandidate.matched_patterns.length
      : Array.isArray(datasetBase.matched_patterns)
        ? datasetBase.matched_patterns.length
        : 0,

    datasetCandidateScore: Number(
      datasetCandidate?.score ??
        datasetBase.conversion_rate_analyzed ??
        datasetBase.confidence_score ??
        0
    ),

    datasetPriorityLevel: datasetBase.priority_level,

    status_flags: {
      is_sample_direction:
        Boolean(detectionStatusFlags.is_sample_direction) || hasSampleRequest,
      is_brand_direction:
        Boolean(detectionStatusFlags.is_brand_direction) || hasBrandIntent,
      is_post_payment:
        Boolean(detectionStatusFlags.is_post_payment) || hasPostPayment,
      is_at_risk:
        Boolean(detectionStatusFlags.is_at_risk) ||
        hasTrustRisk ||
        hasProofPackingRequest,
      customer_bubble_gt_5: customerBubbleGt5,
    },

    bubble_metrics: {
      customer_bubble_count: customerBubbleCount,
      agent_bubble_count: Math.max(
        toSafeNumber(detectionBubbleMetrics.agent_bubble_count),
        inferAgentBubbleCount(rawInput)
      ),
      customer_bubble_gt_5: customerBubbleGt5,
    },

    sop_signals: {
      curiosity_paket: hasCuriosityPaket,
      discovery_paket_structure: hasPackageDiscovery,
      legality_bpom: hasLegalityIntent,
      sample_vs_produksi: hasSampleVsProduction || hasSampleRequest,
      budget_concern: hasBudgetConcern,
      analytical_quantity_mix: hasAnalyticalMix,
      visual_validation: hasVisualValidation,
      purchase_readiness: hasPurchaseReadiness,
      brand_ownership: hasBrandIntent || hasBrandLock || hasFormRequest,
      educational_support: hasEducationalSupport,
      trust_anxiety: hasTrustRisk,
      progress_anxiety: hasProgressRisk,
      proof_seeking: hasProofPackingRequest,
      should_upgrade_to_prospek: Boolean(detectionSopSignals.should_upgrade_to_prospek),
      detected_topics: uniqueStrings(
        [
          hasCuriosityPaket && "curiosity_paket",
          hasPackageDiscovery && "discovery_paket_structure",
          hasLegalityIntent && "legality_bpom",
          (hasSampleVsProduction || hasSampleRequest) && "sample_vs_produksi",
          hasBudgetConcern && "budget_concern",
          hasAnalyticalMix && "analytical_quantity_mix",
          hasVisualValidation && "visual_validation",
          hasPurchaseReadiness && "purchase_readiness",
          (hasBrandIntent || hasBrandLock || hasFormRequest) && "brand_ownership",
          hasEducationalSupport && "educational_support",
          hasTrustRisk && "trust_anxiety",
          hasProgressRisk && "progress_anxiety",
          hasProofPackingRequest && "proof_seeking",
        ].filter(Boolean)
      ),
      urgency_score: clampNumber(
        (hasTransferOrDP ? 22 : 0) +
          (hasInvoiceRequest ? 20 : 0) +
          (hasTrustRisk ? 18 : 0) +
          (hasProgressRisk ? 18 : 0) +
          (hasProofPackingRequest ? 19 : 0) +
          (hasPurchaseReadiness ? 14 : 0),
        0,
        100
      ),
      status_flags: {
        is_sample_direction:
          Boolean(detectionStatusFlags.is_sample_direction) || hasSampleRequest,
        is_brand_direction:
          Boolean(detectionStatusFlags.is_brand_direction) || hasBrandIntent,
        is_post_payment:
          Boolean(detectionStatusFlags.is_post_payment) || hasPostPayment,
        is_at_risk:
          Boolean(detectionStatusFlags.is_at_risk) ||
          hasTrustRisk ||
          hasProofPackingRequest,
        customer_bubble_gt_5: customerBubbleGt5,
      },
    },

    latestTextLength: latest.length,
    tailTextLength: tail.length,
    summaryTextLength: summary.length,
  };
}

function buildSignalSummary(
  signals,
  intent,
  behaviourStage,
  leadLevelStage,
  pipeline,
  priorityLevel,
  prospectType,
  shouldUpgradeToProspek
) {
  return {
    qty_mentioned: signals.qtyMentionCount > 0,
    qty_mention_count: signals.qtyMentionCount,

    price_request: signals.hasPriceRequest,
    curiosity_paket: signals.hasCuriosityPaket,
    package_discovery: signals.hasPackageDiscovery,

    sample_request: signals.hasSampleRequest,
    sample_vs_production: signals.hasSampleVsProduction,

    brand_intent: signals.hasBrandIntent,
    brand_lock: signals.hasBrandLock,
    form_request: signals.hasFormRequest,

    legality_intent: signals.hasLegalityIntent,
    budget_concern: signals.hasBudgetConcern,
    analytical_mix: signals.hasAnalyticalMix,
    visual_validation: signals.hasVisualValidation,
    educational_support: signals.hasEducationalSupport,

    purchase_readiness: signals.hasPurchaseReadiness,
    transfer_or_dp: signals.hasTransferOrDP,
    invoice_request: signals.hasInvoiceRequest,
    post_payment: signals.hasPostPayment,

    trust_risk: signals.hasTrustRisk,
    progress_risk: signals.hasProgressRisk,
    proof_packing_request: signals.hasProofPackingRequest,

    future_delay: signals.hasFutureDelay,
    confusion: signals.hasConfusion,
    positivity: signals.hasPositivity,

    customer_bubble_count: signals.customerBubbleCount,
    customer_bubble_gt_5: signals.customerBubbleGt5,

    derived_intent: intent,
    derived_behaviour_stage: behaviourStage,
    derived_lead_level: leadLevelStage,
    derived_pipeline: pipeline,
    derived_priority: priorityLevel,
    derived_prospect_type: prospectType,
    should_upgrade_to_prospek: shouldUpgradeToProspek,

    dataset_match_count: signals.datasetMatchedPatternCount,
    dataset_candidate_score: signals.datasetCandidateScore,
    dataset_priority_level: signals.datasetPriorityLevel,

    status_flags: signals.status_flags,
    bubble_metrics: signals.bubble_metrics,
    sop_signals: signals.sop_signals,
  };
}

/* ---------------------------------
   Input sanitizing
---------------------------------- */

function sanitizeDatasetBase(input) {
  const rawBase = input && typeof input === "object" ? input : DEFAULT_ANALYSIS;
  const normalizedBase = normalizeAnalysisTaxonomy(rawBase);

  const suggestedReply = safeString(
    rawBase.suggested_reply ||
      rawBase.suggested_response ||
      DEFAULT_ANALYSIS.suggested_reply ||
      DEFAULT_ANALYSIS.suggested_response
  );

  const leadLevel = normalizeLeadLevelStage(
    normalizedBase.lead_level_stage ||
      normalizedBase.lead_level ||
      rawBase.lead_level_stage ||
      rawBase.lead_level ||
      DEFAULT_ANALYSIS.lead_level_stage ||
      DEFAULT_ANALYSIS.lead_level ||
      "cold"
  );

  const priority = normalizePriorityLevel(
    normalizedBase.priority_level ||
      normalizedBase.priority ||
      rawBase.priority_level ||
      rawBase.priority ||
      DEFAULT_ANALYSIS.priority_level ||
      DEFAULT_ANALYSIS.priority ||
      "medium"
  );

  return {
    rule_id: safeString(rawBase.rule_id || rawBase.id || DEFAULT_ANALYSIS.rule_id),
    dataset_row_id: safeString(rawBase.dataset_row_id || rawBase.rule_id || rawBase.id || ""),
    dataset_row_label: safeString(rawBase.dataset_row_label || ""),

    pipeline: normalizePipeline(
      normalizedBase.pipeline ||
        rawBase.pipeline ||
        DEFAULT_ANALYSIS.pipeline ||
        "respons"
    ),

    priority_level: priority,
    priority,

    prospect_type: normalizeProspectType(
      normalizedBase.prospect_type ||
        rawBase.prospect_type ||
        DEFAULT_ANALYSIS.prospect_type ||
        "none"
    ),

    intent: normalizeIntent(
      normalizedBase.intent ||
        rawBase.intent ||
        DEFAULT_ANALYSIS.intent ||
        "unknown"
    ),

    emotion: normalizeEmotion(
      normalizedBase.emotion ||
        rawBase.emotion ||
        DEFAULT_ANALYSIS.emotion ||
        "unknown"
    ),

    behaviour_stage: normalizeBehaviourStage(
      normalizedBase.behaviour_stage ||
        rawBase.behaviour_stage ||
        DEFAULT_ANALYSIS.behaviour_stage ||
        "curiosity"
    ),

    lead_level_stage: leadLevel,
    lead_level: leadLevel,

    customer_profile: safeString(rawBase.customer_profile || ""),

    sop_stage_current: safeString(
      rawBase.sop_stage_current || DEFAULT_ANALYSIS.sop_stage_current
    ),

    default_sop_stage_current: safeString(
      rawBase.default_sop_stage_current ||
        rawBase.sop_stage_current ||
        DEFAULT_ANALYSIS.sop_stage_current
    ),

    sop_stage_next: safeString(
      rawBase.sop_stage_next || DEFAULT_ANALYSIS.sop_stage_next
    ),

    default_sop_stage_next: safeString(
      rawBase.default_sop_stage_next ||
        rawBase.sop_stage_next ||
        DEFAULT_ANALYSIS.sop_stage_next
    ),

    followup_gap: safeString(rawBase.followup_gap || ""),

    conversion_rate_analyzed: clampNumber(
      Number(
        rawBase.conversion_rate_analyzed ??
          rawBase.conversion_rate_base ??
          DEFAULT_ANALYSIS.conversion_rate_analyzed ??
          20
      ),
      SCORE_LIMITS.MIN,
      SCORE_LIMITS.MAX
    ),

    cs_action: safeString(rawBase.cs_action || DEFAULT_ANALYSIS.cs_action),
    cs_action_template: safeString(
      rawBase.cs_action_template ||
        rawBase.cs_action ||
        DEFAULT_ANALYSIS.cs_action
    ),

    suggested_response: suggestedReply,
    suggested_reply: suggestedReply,
    suggested_reply_template: safeString(
      rawBase.suggested_reply_template || suggestedReply
    ),

    confidence_score: clampNumber(
      Number(
        rawBase.confidence_score ??
          rawBase.base_score ??
          DEFAULT_ANALYSIS.confidence_score ??
          20
      ),
      20,
      98
    ),

    matched_patterns: Array.isArray(rawBase.matched_patterns)
      ? rawBase.matched_patterns
      : [],

    matched_in: rawBase.matched_in || {
      latest: [],
      tail: [],
      summary: [],
    },

    matched_context_cues: Array.isArray(rawBase.matched_context_cues)
      ? rawBase.matched_context_cues
      : [],

    signal_alignment_details: Array.isArray(rawBase.signal_alignment_details)
      ? rawBase.signal_alignment_details
      : [],

    tag_emotion: safeString(rawBase.tag_emotion || ""),
    tag_stage: safeString(rawBase.tag_stage || ""),
    rule_source: safeString(rawBase.rule_source || "dataset_sop"),

    sop_signals:
      rawBase.sop_signals && typeof rawBase.sop_signals === "object"
        ? rawBase.sop_signals
        : {},

    status_flags:
      rawBase.status_flags && typeof rawBase.status_flags === "object"
        ? rawBase.status_flags
        : {},

    bubble_metrics:
      rawBase.bubble_metrics && typeof rawBase.bubble_metrics === "object"
        ? rawBase.bubble_metrics
        : {},
  };
}

function buildNormalizedSegments(input = {}) {
  const latestText = input.latestCustomerText || input.customer_message || "";
  const tailText = input.tail || input.recent_chat_history || "";
  const summaryText = input.summary || "";

  return {
    latest: normalizeDatasetText(latestText),
    tail: normalizeDatasetText(tailText),
    summary: normalizeDatasetText(summaryText),
    combined: normalizeDatasetText([latestText, tailText, summaryText].join(" ")),
  };
}

/* ---------------------------------
   Preference helpers
---------------------------------- */

function preferIntent(baseValue, candidateValue, strongOverride = false) {
  const base = normalizeIntent(baseValue);
  const candidate = normalizeIntent(candidateValue);

  if (!candidate) return base || "unknown";
  if (!base || base === "unknown") return candidate;
  if (base === candidate) return base;

  if (strongOverride) return candidate;
  return base;
}

function preferEmotion(baseValue, candidateValue, strongOverride = false) {
  const base = normalizeEmotion(baseValue);
  const candidate = normalizeEmotion(candidateValue);

  if (!candidate) return base || "unknown";
  if (!base || base === "unknown") return candidate;
  if (base === candidate) return base;

  if (strongOverride) return candidate;
  return base;
}

function preferBehaviourStage(baseValue, candidateValue) {
  const base = normalizeBehaviourStage(baseValue);
  const candidate = normalizeBehaviourStage(candidateValue);

  if (!candidate) return base || "curiosity";
  if (!base) return candidate;

  const rankBase = BEHAVIOUR_STAGE_RANK[base] || 0;
  const rankCandidate = BEHAVIOUR_STAGE_RANK[candidate] || 0;

  return rankCandidate >= rankBase ? candidate : base;
}

function preferLeadLevel(baseValue, candidateValue) {
  const base = normalizeLeadLevelStage(baseValue);
  const candidate = normalizeLeadLevelStage(candidateValue);

  if (!candidate) return base || "cold";
  if (!base) return candidate;
  if (base === candidate) return base;

  const rankBase = LEAD_LEVEL_RANK[base] || 0;
  const rankCandidate = LEAD_LEVEL_RANK[candidate] || 0;

  return rankCandidate >= rankBase ? candidate : base;
}

const BEHAVIOUR_STAGE_RANK = Object.freeze({
  curiosity: 1,
  interest: 2,
  evaluation: 3,
  decision: 4,
  post_decision: 5,
  pre_pelunasan: 6,
  post_purchase: 7,
});

const LEAD_LEVEL_RANK = Object.freeze({
  cold: 1,
  warm: 2,
  warm_hot: 3,
  hot: 4,
  hot_at_risk: 5,
});

/* ---------------------------------
   Utilities
---------------------------------- */

function applyScore(breakdown, condition, key, delta, applyFn) {
  if (!condition) return;
  applyFn(delta);
  breakdown.push({ key, delta });
}

function hasRegex(text, regex) {
  if (!text || !regex) return false;
  const cloned = new RegExp(regex.source, regex.flags);
  return cloned.test(text);
}

function countRegexMatches(text, regex) {
  if (!text || !regex) return 0;
  const cloned = new RegExp(regex.source, regex.flags);
  const matches = text.match(cloned);
  return Array.isArray(matches) ? matches.length : 0;
}

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

function safeString(value) {
  return String(value || "").trim();
}

function toSafeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
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