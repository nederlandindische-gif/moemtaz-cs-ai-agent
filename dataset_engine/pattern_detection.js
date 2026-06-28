// dataset_engine/pattern_detection.js

import * as Rules from "./rules.js";

/* ---------------------------------
   Safe rules bridge
---------------------------------- */

/** @type {Record<string, any>} */
const RULES_BRIDGE = /** @type {Record<string, any>} */ (Rules);

const DATASET_RULES = Array.isArray(Rules.DATASET_RULES)
  ? Rules.DATASET_RULES
  : [];

const DEFAULT_ANALYSIS = Object.freeze({
  rule_id: "default_analysis",
  dataset_row_id: "",
  dataset_row_label: "",
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
  brand_channel: "unknown",
  ...asPlainObject(Rules.DEFAULT_ANALYSIS),
});

const normalizeDatasetText =
  typeof Rules.normalizeDatasetText === "function"
    ? Rules.normalizeDatasetText
    : fallbackNormalizeDatasetText;

const normalizeBrandChannel =
  typeof Rules.normalizeBrandChannel === "function"
    ? Rules.normalizeBrandChannel
    : (value) => normalizeEnum(value, ["mtz", "pcg", "grosir", "unknown"], "unknown");

const applyChannelOverride =
  typeof Rules.applyChannelOverride === "function"
    ? Rules.applyChannelOverride
    : null;

const applyRuleContextCompat =
  typeof RULES_BRIDGE.applyRuleContext === "function"
    ? RULES_BRIDGE.applyRuleContext
    : fallbackApplyRuleContext;

const isPostPaymentContextCompat =
  typeof RULES_BRIDGE.isPostPaymentContext === "function"
    ? RULES_BRIDGE.isPostPaymentContext
    : fallbackIsPostPaymentContext;

const isAtRiskContextCompat =
  typeof RULES_BRIDGE.isAtRiskContext === "function"
    ? RULES_BRIDGE.isAtRiskContext
    : fallbackIsAtRiskContext;

/* ---------------------------------
   Typedefs
---------------------------------- */

/**
 * @typedef {{
 *   is_sample_direction: boolean,
 *   is_brand_direction: boolean,
 *   is_post_payment: boolean,
 *   is_at_risk: boolean,
 *   customer_bubble_gt_5: boolean
 * }} StatusFlags
 */

/**
 * @typedef {{
 *   customer_bubble_count: number,
 *   agent_bubble_count: number,
 *   customer_bubble_gt_5: boolean
 * }} BubbleMetrics
 */

/**
 * @typedef {{
 *   curiosity_paket: boolean,
 *   discovery_paket_structure: boolean,
 *   legality_bpom: boolean,
 *   sample_vs_produksi: boolean,
 *   budget_concern: boolean,
 *   analytical_quantity_mix: boolean,
 *   visual_validation: boolean,
 *   purchase_readiness: boolean,
 *   brand_ownership: boolean,
 *   educational_support: boolean,
 *   trust_anxiety: boolean,
 *   progress_anxiety: boolean,
 *   proof_seeking: boolean,
 *   should_upgrade_to_prospek: boolean,
 *   detected_topics: string[],
 *   urgency_score: number,
 *   status_flags: StatusFlags
 * }} SopSignals
 */

/* ---------------------------------
   Defaults
---------------------------------- */

const DEFAULT_OPTIONS = Object.freeze({
  maxCandidates: 7,

  latestWeight: 1.9,
  tailWeight: 1.05,
  summaryWeight: 0.72,
  combinedWeight: 0.45,

  baseRuleWeight: 0.38,
  priorityWeight: 0.2,

  primarySignalWeight: 1.35,
  supportSignalWeight: 0.55,
  explicitDetectorBonus: 16,

  exactPatternBoost: 8,
  tokenCoverageBoost: 5,
  repeatedPatternBonusCap: 10,

  negativePenalty: 18,
  ambiguityPenalty: 9,
  closeScoreGapThreshold: 9,

  minCandidateScore: 28,
  minConfidenceForMatch: 30,
  minSignalStrength: 10,
  noMatchConfidence: 20,
});

const SIGNAL_KEYS = Object.freeze([
  "curiosity_paket",
  "discovery_paket_structure",
  "legality_bpom",
  "sample_vs_produksi",
  "budget_concern",
  "analytical_quantity_mix",
  "visual_validation",
  "purchase_readiness",
  "brand_ownership",
  "educational_support",
  "trust_anxiety",
  "progress_anxiety",
  "proof_seeking",
]);

const EMPTY_STATUS_FLAGS = Object.freeze(
  /** @type {StatusFlags} */ ({
    is_sample_direction: false,
    is_brand_direction: false,
    is_post_payment: false,
    is_at_risk: false,
    customer_bubble_gt_5: false,
  })
);

const EMPTY_BUBBLE_METRICS = Object.freeze(
  /** @type {BubbleMetrics} */ ({
    customer_bubble_count: 0,
    agent_bubble_count: 0,
    customer_bubble_gt_5: false,
  })
);

const EMPTY_SOP_SIGNALS = Object.freeze(
  /** @type {SopSignals} */ ({
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
    status_flags: { ...EMPTY_STATUS_FLAGS },
  })
);

const TEXT_REPLACEMENTS = Object.freeze([
  ["berp", "berapa"],
  ["brapa", "berapa"],
  ["berap", "berapa"],
  ["gmna", "gimana"],
  ["gmn", "gimana"],
  ["belom", "belum"],
  ["blm", "belum"],
  ["sampel", "sample"],
  ["samplenya", "sample"],
  ["sample nya", "sample"],
  ["bpomnya", "bpom"],
  ["bpom nya", "bpom"],
  ["trf", "transfer"],
  ["dpnya", "dp"],
  ["dp nya", "dp"],
  ["ngga", "tidak"],
  ["nggak", "tidak"],
  ["gak", "tidak"],
  ["ga", "tidak"],
  ["ketipu", "tertipu"],
  ["yg", "yang"],
  ["utk", "untuk"],
  ["sy", "saya"],
  ["facial wash", "sabun wajah"],
  ["face wash", "sabun wajah"],
  ["day cream", "krim siang"],
  ["night cream", "krim malam"],
]);

const STOPWORDS = new Set([
  "yang",
  "dan",
  "atau",
  "di",
  "ke",
  "dari",
  "untuk",
  "dengan",
  "itu",
  "ini",
  "apa",
  "ada",
  "jadi",
  "kak",
  "ya",
  "nih",
  "dong",
  "sih",
  "nya",
  "aku",
  "saya",
  "kami",
  "kita",
  "mau",
  "ingin",
  "lagi",
  "lebih",
  "aja",
  "juga",
  "bisa",
  "boleh",
  "tolong",
  "mohon",
  "info",
  "halo",
  "hai",
  "hello",
]);

const CANONICAL_TOKEN_MAP = Object.freeze({
  harga: "harga",
  biaya: "harga",
  promo: "harga",
  paket: "paket",
  reguler: "paket",
  silver: "paket",
  gold: "paket",

  bpom: "bpom",
  legalitas: "legalitas",
  legal: "legalitas",
  izin: "legalitas",
  dokumen: "dokumen",
  surat: "dokumen",

  sample: "sample",
  tester: "sample",
  produksi: "produksi",
  revisi: "revisi",

  budget: "budget",
  modal: "budget",
  anggaran: "budget",
  kalkulasi: "budget",

  video: "visual",
  foto: "visual",
  gambar: "visual",
  tekstur: "visual",
  desain: "visual",
  kemasan: "visual",
  packing: "packing",
  warna: "visual",

  transfer: "payment",
  bayar: "payment",
  dp: "payment",
  invoice: "invoice",
  pelunasan: "pelunasan",

  brand: "brand",
  merek: "brand",
  private: "brand",
  label: "brand",

  progress: "progress",
  perkembangan: "progress",
  kirim: "shipping",
  dikirim: "shipping",
  resi: "resi",
  pesanan: "order",
  order: "order",

  kandungan: "kandungan",
  manfaat: "manfaat",
  brosur: "brosur",
  live: "live",
  promosi: "promosi",

  amanah: "trust_risk",
  scam: "trust_risk",
  tertipu: "trust_risk",
  ragu: "trust_risk",
  beneran: "trust_risk",

  pcs: "qty",
  pc: "qty",
  item: "qty",
  botol: "qty",
  unit: "qty",

  serum: "produk",
  toner: "produk",
  sabun: "produk",
  "sabun wajah": "produk",
  pelembab: "produk",
  pembersih: "produk",
  "krim siang": "produk",
  "krim malam": "produk",
});

const PRODUCT_MIX_NAMES = Object.freeze([
  "krim siang",
  "krim malam",
  "toner",
  "serum",
  "sabun wajah",
  "sabun",
  "pelembab",
  "pembersih",
]);

const SIGNAL_SPECS = Object.freeze({
  curiosity_paket: Object.freeze({
    exactPhrases: [
      "harga promo",
      "share harga promonya",
      "share harga",
      "paket awal",
      "itu 1 paket",
      "satu paket",
      "1 paket",
      "paket berapa",
      "info paket",
    ],
    regexes: [/\b(harga|promo)\b/, /\b(1|satu)\s+paket\b/, /\bpaket\b/],
    tokenGroups: [
      ["harga", "paket"],
      ["promo", "paket"],
    ],
  }),

  discovery_paket_structure: Object.freeze({
    exactPhrases: [
      "isinya apa saja",
      "beda reguler silver sama gold",
      "100 pcs",
      "100 pc",
      "5 item",
      "masing masing 20 pcs",
      "1 paket terdiri",
    ],
    regexes: [
      /\b100\s*(pcs|pc)\b/,
      /\b5\s*item\b/,
      /\bmasing[\s-]*masing\s*20\s*(pcs|pc)\b/,
      /\b(beda|perbedaan)\b.*\b(reguler|silver|gold)\b/,
    ],
    tokenGroups: [
      ["100", "qty"],
      ["5", "item"],
      ["paket", "paket"],
    ],
  }),

  legality_bpom: Object.freeze({
    exactPhrases: [
      "surat bpom",
      "izin edar",
      "terdaftar bpom",
      "bpom juga",
      "menginduk",
    ],
    regexes: [
      /\bbpom\b/,
      /\blegalitas\b/,
      /\bizin\b/,
      /\bdokumen\b/,
      /\bsurat\b/,
      /\bmenginduk\b/,
    ],
    tokenGroups: [["bpom"], ["legalitas"], ["izin"]],
  }),

  sample_vs_produksi: Object.freeze({
    exactPhrases: [
      "beda sample",
      "langsung produksi",
      "mau coba dulu",
      "buat sample",
      "order sample",
      "uji sample",
    ],
    regexes: [
      /\bsample\b/,
      /\btester\b/,
      /\blangsung\s+produksi\b/,
      /\brevisi\b/,
      /\bcoba\b/,
    ],
    tokenGroups: [
      ["sample", "produksi"],
      ["sample", "revisi"],
    ],
  }),

  budget_concern: Object.freeze({
    exactPhrases: ["low keuangan", "pertimbangan yang matang", "budget terbatas"],
    regexes: [
      /\bbudget\b/,
      /\bmodal\b/,
      /\banggaran\b/,
      /\bkalkulasi\b/,
      /\bkeuangan\b/,
      /\bpertimbangan\b/,
    ],
    tokenGroups: [["budget"], ["modal"], ["kalkulasi"]],
  }),

  analytical_quantity_mix: Object.freeze({
    exactPhrases: [
      "harga per item",
      "meliputi item",
      "komposisi item",
      "rincian total pcs",
      "mix qty",
      "30 30 20 10 10",
    ],
    regexes: [
      /\bharga\s+per\s+item\b/,
      /\bkomposisi\b/,
      /\bmeliputi\b/,
      /\btotal\s*(pcs|pc)\b/,
      /\b\d{1,3}\s+\d{1,3}\s+\d{1,3}\b/,
    ],
    tokenGroups: [
      ["harga", "item"],
      ["qty", "item"],
      ["produk", "qty"],
    ],
  }),

  visual_validation: Object.freeze({
    exactPhrases: [
      "video isi",
      "warna isi",
      "contoh packing",
      "referensi desain",
      "foto produk",
      "video packing",
    ],
    regexes: [
      /\bfoto\b/,
      /\bvideo\b/,
      /\btekstur\b/,
      /\bwarna\b/,
      /\bpacking\b/,
      /\bkemasan\b/,
      /\bdesain\b/,
    ],
    tokenGroups: [["visual"], ["packing"], ["visual", "packing"]],
  }),

  purchase_readiness: Object.freeze({
    exactPhrases: [
      "langsung yang 100 pcs produksi",
      "cara order",
      "pemesanannya",
      "tinggal transfer",
      "siap order",
      "minta invoice",
      "langsung produksi",
      "sudah transfer",
    ],
    regexes: [
      /\bcara\s+order\b/,
      /\bpemesanannya\b/,
      /\bsiap\s+order\b/,
      /\btransfer\b/,
      /\bdp\b/,
      /\binvoice\b/,
      /\blangsung\s+produksi\b/,
      /\bsudah\s+transfer\b/,
    ],
    tokenGroups: [["payment"], ["invoice"], ["order", "payment"]],
  }),

  brand_ownership: Object.freeze({
    exactPhrases: [
      "nama brand",
      "brand sendiri",
      "private label",
      "style packing",
      "warna utama",
      "request packing",
      "merek",
    ],
    regexes: [
      /\bnama\s+brand\b/,
      /\bbrand\s+sendiri\b/,
      /\bprivate\s+label\b/,
      /\bmerek\b/,
      /\bstyle\s+packing\b/,
      /\bwarna\s+utama\b/,
      /\brequest\s+packing\b/,
    ],
    tokenGroups: [["brand"], ["brand", "packing"]],
  }),

  educational_support: Object.freeze({
    exactPhrases: [
      "buat live",
      "materi live",
      "brosur penjelasan kandungan",
      "penjelasan kandungan",
    ],
    regexes: [/\bkandungan\b/, /\bmanfaat\b/, /\bbrosur\b/, /\blive\b/, /\bpromosi\b/],
    tokenGroups: [["kandungan"], ["manfaat"], ["brosur"]],
  }),

  trust_anxiety: Object.freeze({
    exactPhrases: [
      "pernah tertipu",
      "takut scam",
      "semakin ragu",
      "supaya percaya",
      "beneran tidak",
    ],
    regexes: [/\bamanah\b/, /\btertipu\b/, /\bscam\b/, /\bragu\b/, /\bbeneran\b/, /\bpercaya\b/],
    tokenGroups: [["trust_risk"], ["trust_risk", "proof"]],
  }),

  progress_anxiety: Object.freeze({
    exactPhrases: [
      "kapan dikirim",
      "perkembangan pesanan",
      "progress pesanan",
      "status order",
      "saya tunggu",
      "hari itu juga",
    ],
    regexes: [
      /\bkapan\s+dikirim\b/,
      /\bprogress\b/,
      /\bperkembangan\b/,
      /\bstatus\s+order\b/,
      /\bresi\b/,
      /\bsaya\s+tunggu\b/,
    ],
    tokenGroups: [["progress"], ["shipping"], ["resi"]],
  }),

  proof_seeking: Object.freeze({
    exactPhrases: [
      "lihat dulu produk saya",
      "keseluruhan produk",
      "video packing",
      "supaya kita bisa saling percaya",
      "sebelum pelunasan",
      "bukti real",
      "produk yang sudah siap kirim",
    ],
    regexes: [
      /\blihat\s+dulu\b/,
      /\bvideo\s+packing\b/,
      /\bkeseluruhan\s+produk\b/,
      /\bsebelum\s+pelunasan\b/,
      /\bbukti\b/,
      /\bsiap\s+kirim\b/,
    ],
    tokenGroups: [["proof"], ["proof", "pelunasan"], ["visual", "packing"]],
  }),
});

const EXPLICIT_ROW_DETECTORS = Object.freeze([
  Object.freeze({
    key: "curiosity_paket",
    label: "curiosity_paket",
    signal_key: "curiosity_paket",
    intent: "exploration",
    emotion: "curiosity",
    behaviour_stage: "curiosity",
    support_signals: ["discovery_paket_structure"],
  }),
  Object.freeze({
    key: "discovery_paket_structure",
    label: "discovery_paket_structure",
    signal_key: "discovery_paket_structure",
    intent: "exploration",
    emotion: "discovery",
    behaviour_stage: "interest",
    support_signals: ["curiosity_paket"],
  }),
  Object.freeze({
    key: "legality_bpom",
    label: "legality_bpom",
    signal_key: "legality_bpom",
    intent: "trust",
    emotion: "trust_seeking",
    behaviour_stage: "evaluation",
    support_signals: ["visual_validation"],
  }),
  Object.freeze({
    key: "sample_vs_produksi",
    label: "sample_vs_produksi",
    signal_key: "sample_vs_produksi",
    intent: "trial",
    emotion: "risk_aversion",
    behaviour_stage: "evaluation",
    support_signals: ["budget_concern"],
  }),
  Object.freeze({
    key: "budget_concern",
    label: "budget_concern",
    signal_key: "budget_concern",
    intent: "price",
    emotion: "budget_concern",
    behaviour_stage: "evaluation",
    support_signals: ["curiosity_paket", "discovery_paket_structure"],
  }),
  Object.freeze({
    key: "analytical_quantity_mix",
    label: "analytical_quantity_mix",
    signal_key: "analytical_quantity_mix",
    intent: "price_process",
    emotion: "analytical_thinking",
    behaviour_stage: "evaluation",
    support_signals: ["discovery_paket_structure", "budget_concern"],
  }),
  Object.freeze({
    key: "visual_validation",
    label: "visual_validation",
    signal_key: "visual_validation",
    intent: "trust",
    emotion: "visual_validation",
    behaviour_stage: "evaluation",
    support_signals: ["brand_ownership", "legality_bpom"],
  }),
  Object.freeze({
    key: "purchase_readiness",
    label: "purchase_readiness",
    signal_key: "purchase_readiness",
    intent: "purchase",
    emotion: "purchase_readiness",
    behaviour_stage: "decision",
    support_signals: ["brand_ownership"],
  }),
  Object.freeze({
    key: "brand_ownership",
    label: "brand_ownership",
    signal_key: "brand_ownership",
    intent: "branding",
    emotion: "brand_ownership",
    behaviour_stage: "decision",
    support_signals: ["purchase_readiness", "visual_validation"],
  }),
  Object.freeze({
    key: "educational_support",
    label: "educational_support",
    signal_key: "educational_support",
    intent: "support",
    emotion: "educational_support",
    behaviour_stage: "post_decision",
    support_signals: ["brand_ownership"],
  }),
  Object.freeze({
    key: "trust_anxiety",
    label: "trust_anxiety",
    signal_key: "trust_anxiety",
    intent: "recovery",
    emotion: "trust_anxiety",
    behaviour_stage: "post_decision",
    support_signals: ["proof_seeking"],
  }),
  Object.freeze({
    key: "progress_anxiety",
    label: "progress_anxiety",
    signal_key: "progress_anxiety",
    intent: "fulfillment",
    emotion: "progress_anxiety",
    behaviour_stage: "post_purchase",
    support_signals: ["purchase_readiness"],
  }),
  Object.freeze({
    key: "proof_seeking",
    label: "proof_seeking",
    signal_key: "proof_seeking",
    intent: "trust_recovery",
    emotion: "proof_seeking",
    behaviour_stage: "pre_pelunasan",
    support_signals: ["trust_anxiety", "progress_anxiety"],
  }),
]);

const ROW_KEY_SET = new Set(EXPLICIT_ROW_DETECTORS.map((item) => item.key));

/* ---------------------------------
   Public API
---------------------------------- */

export function detectDatasetPattern(input, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...asPlainObject(options) };
  const context = buildDetectionContext(input);
  const segments = buildNormalizedSegments(input);
  const bubbleMetrics = buildBubbleMetrics(input, segments);
  const signalDetections = buildSignalDetections(segments);
  const sopSignals = buildSopSignals({
    signalDetections,
    context,
    bubbleMetrics,
    segments,
  });

  const candidates = [];

  for (const rule of DATASET_RULES) {
    const candidate = scoreRuleAgainstSegments({
      rule,
      context,
      segments,
      signalDetections,
      sopSignals,
      bubbleMetrics,
      opts,
    });

    if (candidate) {
      candidates.push(candidate);
    }
  }

  candidates.sort(sortCandidates);
  applyCompetitiveAmbiguity(candidates, opts);

  const trimmedCandidates = candidates.slice(0, opts.maxCandidates);
  const selectedCandidate = trimmedCandidates[0] || null;

  if (!shouldAcceptCandidate(selectedCandidate, trimmedCandidates, sopSignals, opts)) {
    return {
      matched: false,
      selected_rule: null,
      selected_candidate: null,
      candidates: [],
      normalized_segments: segments,
      detection_context: context,
      signal_detections: signalDetections,
      sop_signals: sopSignals,
      bubble_metrics: bubbleMetrics,
      dataset_base: buildDefaultDatasetBase({
        segments,
        context,
        sopSignals,
        bubbleMetrics,
        signalDetections,
        opts,
      }),
    };
  }

  return {
    matched: true,
    selected_rule: selectedCandidate.rule,
    selected_candidate: selectedCandidate,
    candidates: trimmedCandidates,
    normalized_segments: segments,
    detection_context: context,
    signal_detections: signalDetections,
    sop_signals: sopSignals,
    bubble_metrics: bubbleMetrics,
    dataset_base: buildDatasetBaseFromCandidate({
      candidate: selectedCandidate,
      segments,
      context,
      sopSignals,
      bubbleMetrics,
      signalDetections,
    }),
  };
}

export function detectDatasetCandidates(input, options = {}) {
  return detectDatasetPattern(input, options).candidates;
}

export function buildDatasetBaseFromDetection(detection) {
  const det = asPlainObject(detection);

  if (!det.matched || !det.selected_candidate) {
    return {
      ...buildDefaultDatasetBase({
        segments: det.normalized_segments || buildNormalizedSegments(""),
        context: det.detection_context || buildDetectionContext(""),
        sopSignals: det.sop_signals || createEmptySopSignals(),
        bubbleMetrics: det.bubble_metrics || createEmptyBubbleMetrics(),
        signalDetections: det.signal_detections || {},
        opts: DEFAULT_OPTIONS,
      }),
    };
  }

  return {
    ...buildDatasetBaseFromCandidate({
      candidate: det.selected_candidate,
      segments: det.normalized_segments || buildNormalizedSegments(""),
      context: det.detection_context || buildDetectionContext(""),
      sopSignals: det.sop_signals || createEmptySopSignals(),
      bubbleMetrics: det.bubble_metrics || createEmptyBubbleMetrics(),
      signalDetections: det.signal_detections || {},
    }),
  };
}

export function buildDatasetBaseFromCandidate({
  candidate,
  segments,
  context,
  sopSignals,
  bubbleMetrics,
  signalDetections,
}) {
  void signalDetections;

  const safeCandidate = asPlainObject(candidate);
  const baseRule = asPlainObject(safeCandidate.rule);

  if (Object.keys(baseRule).length === 0) {
    return buildDefaultDatasetBase({
      segments,
      context,
      sopSignals,
      bubbleMetrics,
      signalDetections: {},
      opts: DEFAULT_OPTIONS,
    });
  }

  const safeContext = asPlainObject(context);
  const safeSegments = asPlainObject(segments);
  const safeSignals = asPlainObject(sopSignals);

  const resolvedRule = asPlainObject(
    applyRuleContextCompat(baseRule, {
      ...safeContext,
      latest_customer_text: safeContext.latest_customer_text || safeSegments.latest || "",
      customer_message: safeContext.customer_message || safeSegments.latest || "",
      recent_chat_history: safeContext.recent_chat_history || safeSegments.tail || "",
      summary: safeContext.summary || safeSegments.summary || "",
      brand_channel: safeContext.brand_channel,
      is_post_payment: Boolean(safeSignals.status_flags?.is_post_payment),
      is_at_risk: Boolean(safeSignals.status_flags?.is_at_risk),
    })
  );

  const suggestedReply = firstNonEmpty([
    resolvedRule.suggested_reply,
    resolvedRule.suggested_response,
    DEFAULT_ANALYSIS.suggested_reply,
    DEFAULT_ANALYSIS.suggested_response,
    "Halo kak, saya bantu ya. Kakak lagi cari info paket, sample, legalitas, atau mau bikin brand sendiri dulu?",
  ]);

  const leadLevel = firstNonEmpty([
    resolvedRule.lead_level,
    resolvedRule.lead_level_stage,
    DEFAULT_ANALYSIS.lead_level,
    DEFAULT_ANALYSIS.lead_level_stage,
    "cold",
  ]);

  const priority = firstNonEmpty([
    resolvedRule.priority,
    resolvedRule.priority_level,
    DEFAULT_ANALYSIS.priority,
    DEFAULT_ANALYSIS.priority_level,
    "medium",
  ]);

  const quantities = mergeQuantitySignals([
    safeSegments?.meta?.latest?.quantities,
    safeSegments?.meta?.tail?.quantities,
    safeSegments?.meta?.summary?.quantities,
  ]);

  return {
    rule_id: safeString(resolvedRule.id || resolvedRule.rule_id || "dataset_rule"),
    dataset_row_id: safeString(
      resolvedRule.dataset_row_id ||
        resolvedRule.id ||
        safeCandidate.explicit_row_detector_key ||
        ""
    ),
    dataset_row_label: safeString(
      resolvedRule.dataset_row_label ||
        resolvedRule.label ||
        safeCandidate.explicit_row_detector_key ||
        ""
    ),

    pipeline: firstNonEmpty([
      resolvedRule.pipeline,
      DEFAULT_ANALYSIS.pipeline,
      "respons",
    ]),
    default_pipeline: firstNonEmpty([
      resolvedRule.default_pipeline,
      resolvedRule.pipeline,
      DEFAULT_ANALYSIS.pipeline,
      "respons",
    ]),

    lead_level: leadLevel,
    lead_level_stage: leadLevel,

    emotion: safeString(resolvedRule.emotion || DEFAULT_ANALYSIS.emotion || "unknown"),
    intent: safeString(resolvedRule.intent || DEFAULT_ANALYSIS.intent || "unknown"),
    behaviour_stage: safeString(
      resolvedRule.behaviour_stage || DEFAULT_ANALYSIS.behaviour_stage || "curiosity"
    ),

    customer_profile: safeString(
      resolvedRule.customer_profile || DEFAULT_ANALYSIS.customer_profile || ""
    ),

    sop_stage_current: firstNonEmpty([
      resolvedRule.sop_stage_current,
      DEFAULT_ANALYSIS.sop_stage_current,
      "greeting_awal",
    ]),
    default_sop_stage_current: firstNonEmpty([
      resolvedRule.default_sop_stage_current,
      resolvedRule.sop_stage_current,
      DEFAULT_ANALYSIS.sop_stage_current,
      "greeting_awal",
    ]),

    sop_stage_next: firstNonEmpty([
      resolvedRule.sop_stage_next,
      DEFAULT_ANALYSIS.sop_stage_next,
      "share_info_tanya_balik",
    ]),
    default_sop_stage_next: firstNonEmpty([
      resolvedRule.default_sop_stage_next,
      resolvedRule.sop_stage_next,
      DEFAULT_ANALYSIS.sop_stage_next,
      "share_info_tanya_balik",
    ]),

    followup_gap: safeString(
      resolvedRule.followup_gap || DEFAULT_ANALYSIS.followup_gap || ""
    ),

    priority,
    priority_level: priority,

    prospect_type: firstNonEmpty([
      resolvedRule.prospect_type,
      DEFAULT_ANALYSIS.prospect_type,
      "none",
    ]),

    cs_action: firstNonEmpty([
      resolvedRule.cs_action,
      DEFAULT_ANALYSIS.cs_action,
      "",
    ]),
    cs_action_template: firstNonEmpty([
      resolvedRule.cs_action_template,
      resolvedRule.cs_action,
      DEFAULT_ANALYSIS.cs_action,
      "",
    ]),

    suggested_reply: suggestedReply,
    suggested_response: suggestedReply,
    suggested_reply_template: firstNonEmpty([
      resolvedRule.suggested_reply_template,
      resolvedRule.suggested_reply,
      resolvedRule.suggested_response,
      suggestedReply,
    ]),

    tag_emotion: firstNonEmpty([
      resolvedRule.tag_emotion,
      normalizeTag(resolvedRule.emotion),
      DEFAULT_ANALYSIS.tag_emotion,
      "",
    ]),
    tag_stage: firstNonEmpty([
      resolvedRule.tag_stage,
      normalizeTag(resolvedRule.behaviour_stage),
      DEFAULT_ANALYSIS.tag_stage,
      "",
    ]),

    uncertainty_note: safeString(
      resolvedRule.uncertainty_note || DEFAULT_ANALYSIS.uncertainty_note || ""
    ),

    conversion_rate_analyzed: clampNumber(
      Number(
        resolvedRule.conversion_rate_analyzed ??
          resolvedRule.conversion_rate_base ??
          DEFAULT_ANALYSIS.conversion_rate_analyzed ??
          20
      ),
      5,
      98
    ),

    confidence_score: clampNumber(
      Number(safeCandidate.confidence_score ?? DEFAULT_ANALYSIS.confidence_score ?? 20),
      20,
      98
    ),

    matched_patterns: uniqueStrings(safeCandidate.matched_patterns),
    negative_patterns: uniqueStrings(safeCandidate.negative_patterns),
    matched_context_cues: uniqueStrings(safeCandidate.matched_context_cues),
    signal_alignment_details: uniqueStrings(safeCandidate.signal_alignment_details),

    ambiguity_score: clampNumber(Number(safeCandidate.ambiguity_score || 0), 0, 100),

    matched_in: sanitizeMatchedIn(safeCandidate.matched_in),
    rule_source: "dataset_sop",
    normalized_text: safeString(safeSegments.combined || "", 12000),

    sop_signals: safeSignals || createEmptySopSignals(),
    status_flags: safeSignals.status_flags || createEmptyStatusFlags(),
    bubble_metrics: bubbleMetrics || createEmptyBubbleMetrics(),
    brand_channel: safeContext.brand_channel || "unknown",

    explicit_row_detector_key: safeString(safeCandidate.explicit_row_detector_key || ""),
    primary_signal_key: safeString(safeCandidate.primary_signal_key || ""),
    required_artifacts: uniqueStrings(
      toStringArray(
        resolvedRule.required_artifacts ||
          resolvedRule.requiredArtifacts ||
          resolvedRule.artifacts
      )
    ),

    special_branch_applied: uniqueStrings(
      toStringArray(resolvedRule.special_branch_applied)
    ),

    detected_quantities: quantities,

    selected_candidate_meta: {
      score: Number(safeCandidate.score || 0),
      positive_match_count: Number(safeCandidate.positive_match_count || 0),
      negative_match_count: Number(safeCandidate.negative_match_count || 0),
      context_match_count: Number(safeCandidate.context_match_count || 0),
      signal_alignment_count: Number(safeCandidate.signal_alignment_count || 0),
      signal_alignment_score: Number(safeCandidate.signal_alignment_score || 0),
    },
  };
}

/* ---------------------------------
   Context / segments
---------------------------------- */

function buildDetectionContext(input) {
  if (typeof input === "string") {
    const text = safeString(input, 4000);

    return {
      latest_customer_text: text,
      customer_message: text,
      recent_chat_history: text,
      summary: "",
      brand_channel: "unknown",
      last_cs_action: "",
      last_followup_type: "",
      has_form_sent: false,
      has_form_filled: false,
      has_dp_paid: false,
      has_invoice_sent: false,
      has_product_proof_sent: false,
      has_resi_sent: false,
      customer_bubble_count: 0,
      is_outbound_followup_run: false,
      is_post_payment: false,
      is_at_risk: false,
    };
  }

  const src = asPlainObject(input);
  const latestText = safeString(
    src.latestCustomerText || src.customer_message || src.latest_customer_text || "",
    4000
  );

  return {
    latest_customer_text: latestText,
    customer_message: latestText,
    recent_chat_history: safeString(
      src.tail || src.recent_chat_history || "",
      12000
    ),
    summary: safeString(src.summary || "", 6000),
    brand_channel: normalizeBrandChannel(src.brand_channel),
    last_cs_action: safeString(src.last_cs_action || "", 500),
    last_followup_type: safeString(src.last_followup_type || "", 120),

    has_form_sent: Boolean(src.has_form_sent),
    has_form_filled: Boolean(src.has_form_filled),
    has_dp_paid: Boolean(src.has_dp_paid),
    has_invoice_sent: Boolean(src.has_invoice_sent),
    has_product_proof_sent: Boolean(src.has_product_proof_sent),
    has_resi_sent: Boolean(src.has_resi_sent),

    customer_bubble_count: toSafeNumber(src.customer_bubble_count),
    is_outbound_followup_run: Boolean(src.is_outbound_followup_run),
    is_post_payment: Boolean(src.is_post_payment),
    is_at_risk: Boolean(src.is_at_risk),
  };
}

function buildNormalizedSegments(input) {
  if (typeof input === "string") {
    const normalized = aggressiveNormalizeDatasetText(input);

    return {
      latest: normalized,
      tail: normalized,
      summary: normalized,
      combined: normalized,
      meta: {
        latest: buildSegmentMeta(normalized),
        tail: buildSegmentMeta(normalized),
        summary: buildSegmentMeta(normalized),
        combined: buildSegmentMeta(normalized),
      },
    };
  }

  const src = asPlainObject(input);

  const latest = aggressiveNormalizeDatasetText(
    src.latestCustomerText || src.customer_message || src.latest_customer_text || ""
  );
  const tail = aggressiveNormalizeDatasetText(
    src.tail || src.recent_chat_history || ""
  );
  const summary = aggressiveNormalizeDatasetText(src.summary || "");

  const combined = aggressiveNormalizeDatasetText(
    [latest, tail, summary].filter(Boolean).join(" ")
  );

  return {
    latest,
    tail,
    summary,
    combined,
    meta: {
      latest: buildSegmentMeta(latest),
      tail: buildSegmentMeta(tail),
      summary: buildSegmentMeta(summary),
      combined: buildSegmentMeta(combined),
    },
  };
}

function aggressiveNormalizeDatasetText(input) {
  let text = normalizeDatasetText(input || "");

  for (const [from, to] of TEXT_REPLACEMENTS) {
    text = text.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, "g"), to);
  }

  text = text
    .replace(/\b(\d+)\s*jt\b/g, "$1 juta")
    .replace(/\b(\d+)\s*rb\b/g, "$1 ribu")
    .replace(/\b(\d+)\s*k\b/g, "$1 ribu")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

function buildSegmentMeta(text) {
  const normalizedText = aggressiveNormalizeDatasetText(text || "");
  const tokens = tokenize(normalizedText);
  const canonicalTokens = tokens.map(canonicalizeToken);
  const tokenSet = new Set(tokens);
  const canonicalTokenSet = new Set(canonicalTokens);

  const contentTokens = tokens.filter((token) => !STOPWORDS.has(token));
  const contentCanonicalTokens = canonicalTokens.filter(
    (token) => !STOPWORDS.has(token)
  );

  return {
    text: normalizedText,
    tokens,
    canonicalTokens,
    tokenSet,
    canonicalTokenSet,
    contentTokens,
    contentCanonicalTokens,
    quantities: extractQuantitySignals(normalizedText),
  };
}

/* ---------------------------------
   Explicit signal detectors
---------------------------------- */

function buildSignalDetections(segments) {
  const detections = {};

  for (const key of SIGNAL_KEYS) {
    detections[key] = detectSignalAcrossSegments(key, segments);
  }

  return detections;
}

function detectSignalAcrossSegments(signalKey, segments) {
  const spec = SIGNAL_SPECS[signalKey];
  const latest = detectSignalInSegment(spec, signalKey, segments.latest, segments.meta.latest);
  const tail = detectSignalInSegment(spec, signalKey, segments.tail, segments.meta.tail);
  const summary = detectSignalInSegment(spec, signalKey, segments.summary, segments.meta.summary);
  const combined = detectSignalInSegment(spec, signalKey, segments.combined, segments.meta.combined);

  const weightedScore =
    latest.score * DEFAULT_OPTIONS.latestWeight +
    tail.score * DEFAULT_OPTIONS.tailWeight +
    summary.score * DEFAULT_OPTIONS.summaryWeight +
    combined.score * DEFAULT_OPTIONS.combinedWeight;

  const matched =
    combined.matched ||
    latest.matched ||
    tail.matched ||
    summary.matched;

  return {
    key: signalKey,
    matched,
    weighted_score: Math.round(weightedScore),
    hit_count:
      latest.hit_count +
      tail.hit_count +
      summary.hit_count +
      combined.hit_count,
    latest,
    tail,
    summary,
    combined,
    matched_examples: uniqueStrings([
      ...latest.matched_examples,
      ...tail.matched_examples,
      ...summary.matched_examples,
      ...combined.matched_examples,
    ]),
    reasons: uniqueStrings([
      ...latest.reasons,
      ...tail.reasons,
      ...summary.reasons,
      ...combined.reasons,
    ]),
  };
}

function detectSignalInSegment(spec, signalKey, text, meta) {
  const phraseHits = [];
  const regexHits = [];
  const tokenGroupHits = [];

  for (const phrase of spec?.exactPhrases || []) {
    const normalizedPhrase = aggressiveNormalizeDatasetText(phrase);
    if (normalizedPhrase && text.includes(normalizedPhrase)) {
      phraseHits.push(normalizedPhrase);
    }
  }

  for (const regex of spec?.regexes || []) {
    if (regex instanceof RegExp && regex.test(text)) {
      regexHits.push(regex.source);
    }
  }

  for (const group of spec?.tokenGroups || []) {
    const groupTokens = group.map(canonicalizeToken).filter(Boolean);
    const hit =
      groupTokens.length > 0 &&
      groupTokens.every((token) => meta.canonicalTokenSet.has(token));
    if (hit) {
      tokenGroupHits.push(groupTokens.join("+"));
    }
  }

  const custom = detectCustomSignal(signalKey, text, meta);

  const score =
    phraseHits.length * 8 +
    regexHits.length * 6 +
    tokenGroupHits.length * 5 +
    (custom.score || 0);

  const matched = score >= 8;

  return {
    matched,
    score,
    hit_count:
      phraseHits.length +
      regexHits.length +
      tokenGroupHits.length +
      Number(custom.hit_count || 0),
    matched_examples: uniqueStrings([
      ...phraseHits,
      ...regexHits.map((item) => `re:${item}`),
      ...tokenGroupHits.map((item) => `tokens:${item}`),
      ...toStringArray(custom.matched_examples),
    ]),
    reasons: uniqueStrings([...toStringArray(custom.reasons)]),
  };
}

function detectCustomSignal(signalKey, text, meta) {
  switch (signalKey) {
    case "curiosity_paket":
      return detectCuriosityPaket(text, meta);
    case "discovery_paket_structure":
      return detectDiscoveryPaketStructure(text, meta);
    case "legality_bpom":
      return detectLegalityBpom(text);
    case "sample_vs_produksi":
      return detectSampleVsProduksi(text);
    case "budget_concern":
      return detectBudgetConcern(text);
    case "analytical_quantity_mix":
      return detectAnalyticalQuantityMix(text, meta);
    case "visual_validation":
      return detectVisualValidation(text);
    case "purchase_readiness":
      return detectPurchaseReadiness(text);
    case "brand_ownership":
      return detectBrandOwnership(text);
    case "educational_support":
      return detectEducationalSupport(text);
    case "trust_anxiety":
      return detectTrustAnxiety(text);
    case "progress_anxiety":
      return detectProgressAnxiety(text);
    case "proof_seeking":
      return detectProofSeeking(text);
    default:
      return zeroCustomSignal();
  }
}

function detectCuriosityPaket(text, meta) {
  let score = 0;
  const reasons = [];
  const matched_examples = [];

  const asksPrice = /\b(harga|promo|biaya)\b/.test(text);
  const asksPackage = /\bpaket\b/.test(text);
  const asksEntry = /\b(1|satu)\s+paket\b/.test(text);

  if (asksPrice && asksPackage) {
    score += 8;
    reasons.push("price_plus_package");
    matched_examples.push("harga+paket");
  }

  if (asksEntry) {
    score += 6;
    reasons.push("single_package_entry");
    matched_examples.push("1 paket");
  }

  if (meta.contentTokens.length <= 6 && asksPackage) {
    score += 2;
    reasons.push("short_entry_query");
  }

  return {
    score,
    hit_count: score > 0 ? 1 : 0,
    matched_examples,
    reasons,
  };
}

function detectDiscoveryPaketStructure(text, meta) {
  let score = 0;
  const reasons = [];
  const matched_examples = [];

  const has100Pcs = /\b100\s*(pcs|pc)\b/.test(text);
  const has5Item = /\b5\s*item\b/.test(text);
  const packageDiff = /\b(beda|perbedaan)\b.*\b(reguler|silver|gold)\b/.test(text);
  const productCount = PRODUCT_MIX_NAMES.filter((name) => text.includes(name)).length;

  if (has100Pcs) {
    score += 7;
    reasons.push("has_100_pcs");
    matched_examples.push("100 pcs");
  }

  if (has5Item) {
    score += 6;
    reasons.push("has_5_item");
    matched_examples.push("5 item");
  }

  if (packageDiff) {
    score += 6;
    reasons.push("package_tier_diff");
    matched_examples.push("reguler silver gold");
  }

  if (productCount >= 3) {
    score += 7;
    reasons.push("product_mix_structure");
    matched_examples.push("product_mix");
  }

  if (meta.quantities.has_100_pcs && meta.quantities.has_5_item_hint) {
    score += 6;
    reasons.push("strong_100pcs_5item_structure");
  }

  return {
    score,
    hit_count: matched_examples.length,
    matched_examples,
    reasons,
  };
}

function detectLegalityBpom(text) {
  let score = 0;
  const reasons = [];
  const matched_examples = [];

  if (/\bbpom\b/.test(text)) {
    score += 8;
    reasons.push("mentions_bpom");
    matched_examples.push("bpom");
  }

  if (/\b(legalitas|izin|izin edar)\b/.test(text)) {
    score += 7;
    reasons.push("mentions_legality");
    matched_examples.push("legalitas_or_izin");
  }

  if (/\b(dokumen|surat)\b/.test(text)) {
    score += 4;
    reasons.push("mentions_document");
    matched_examples.push("dokumen");
  }

  if (/\bmenginduk\b/.test(text)) {
    score += 4;
    reasons.push("asks_scheme");
    matched_examples.push("menginduk");
  }

  return {
    score,
    hit_count: matched_examples.length,
    matched_examples,
    reasons,
  };
}

function detectSampleVsProduksi(text) {
  let score = 0;
  const reasons = [];
  const matched_examples = [];

  const hasSample = /\b(sample|tester)\b/.test(text);
  const hasProduction = /\b(produksi|langsung produksi)\b/.test(text);
  const hasRevision = /\brevisi\b/.test(text);
  const hasTrialLanguage = /\b(coba dulu|uji sample|buat sample)\b/.test(text);

  if (hasSample) {
    score += 7;
    reasons.push("mentions_sample");
    matched_examples.push("sample");
  }

  if (hasSample && hasProduction) {
    score += 8;
    reasons.push("sample_vs_production_compare");
    matched_examples.push("sample_vs_produksi");
  }

  if (hasRevision) {
    score += 4;
    reasons.push("mentions_revision");
    matched_examples.push("revisi");
  }

  if (hasTrialLanguage) {
    score += 4;
    reasons.push("trial_language");
    matched_examples.push("coba_dulu");
  }

  return {
    score,
    hit_count: matched_examples.length,
    matched_examples,
    reasons,
  };
}

function detectBudgetConcern(text) {
  let score = 0;
  const reasons = [];
  const matched_examples = [];

  if (/\bbudget\b/.test(text)) {
    score += 8;
    reasons.push("mentions_budget");
    matched_examples.push("budget");
  }

  if (/\b(modal|anggaran|keuangan)\b/.test(text)) {
    score += 6;
    reasons.push("mentions_financial_limit");
    matched_examples.push("modal_anggaran");
  }

  if (/\b(kalkulasi|pertimbangan)\b/.test(text)) {
    score += 5;
    reasons.push("mentions_calculation");
    matched_examples.push("kalkulasi");
  }

  if (/\blow\s+keuangan\b/.test(text)) {
    score += 4;
    reasons.push("explicit_low_budget");
    matched_examples.push("low_keuangan");
  }

  return {
    score,
    hit_count: matched_examples.length,
    matched_examples,
    reasons,
  };
}

function detectAnalyticalQuantityMix(text, meta) {
  let score = 0;
  const reasons = [];
  const matched_examples = [];

  if (/\bharga\s+per\s+item\b/.test(text)) {
    score += 8;
    reasons.push("price_per_item");
    matched_examples.push("harga_per_item");
  }

  if (hasQuantityMixRequest(text)) {
    score += 10;
    reasons.push("quantity_mix_request");
    matched_examples.push("quantity_mix");
  }

  if (meta.quantities.mix_breakdown.length >= 2) {
    score += 7;
    reasons.push("explicit_mix_breakdown");
    matched_examples.push("mix_breakdown");
  }

  if (/\b(meliputi|komposisi|rincian)\b/.test(text)) {
    score += 4;
    reasons.push("distribution_language");
    matched_examples.push("distribution_language");
  }

  return {
    score,
    hit_count: matched_examples.length,
    matched_examples,
    reasons,
  };
}

function detectVisualValidation(text) {
  let score = 0;
  const reasons = [];
  const matched_examples = [];

  if (/\b(foto|video)\b/.test(text)) {
    score += 7;
    reasons.push("asks_photo_video");
    matched_examples.push("foto_video");
  }

  if (/\b(tekstur|warna isi)\b/.test(text)) {
    score += 6;
    reasons.push("asks_texture_or_fill_color");
    matched_examples.push("tekstur_warna_isi");
  }

  if (/\b(packing|kemasan|desain|referensi desain)\b/.test(text)) {
    score += 7;
    reasons.push("asks_packaging_design");
    matched_examples.push("packing_design");
  }

  return {
    score,
    hit_count: matched_examples.length,
    matched_examples,
    reasons,
  };
}

function detectPurchaseReadiness(text) {
  let score = 0;
  const reasons = [];
  const matched_examples = [];

  if (/\blangsung\s+produksi\b/.test(text)) {
    score += 8;
    reasons.push("direct_to_production");
    matched_examples.push("langsung_produksi");
  }

  if (/\b(cara order|pemesanannya|siap order)\b/.test(text)) {
    score += 8;
    reasons.push("asks_order_step");
    matched_examples.push("order_step");
  }

  if (/\b(transfer|dp|invoice)\b/.test(text)) {
    score += 8;
    reasons.push("payment_step_language");
    matched_examples.push("payment_step");
  }

  if (/\bsudah\s+transfer\b/.test(text)) {
    score += 8;
    reasons.push("already_transferred");
    matched_examples.push("sudah_transfer");
  }

  return {
    score,
    hit_count: matched_examples.length,
    matched_examples,
    reasons,
  };
}

function detectBrandOwnership(text) {
  let score = 0;
  const reasons = [];
  const matched_examples = [];

  if (/\b(nama brand|brand sendiri|private label|merek)\b/.test(text)) {
    score += 8;
    reasons.push("mentions_brand_identity");
    matched_examples.push("brand_identity");
  }

  if (/\b(style packing|warna utama|request packing)\b/.test(text)) {
    score += 7;
    reasons.push("mentions_brand_brief");
    matched_examples.push("brand_brief");
  }

  if (/\bdinamaiin\b/.test(text)) {
    score += 4;
    reasons.push("explicit_naming");
    matched_examples.push("dinamaiin");
  }

  return {
    score,
    hit_count: matched_examples.length,
    matched_examples,
    reasons,
  };
}

function detectEducationalSupport(text) {
  let score = 0;
  const reasons = [];
  const matched_examples = [];

  if (/\bkandungan\b/.test(text)) {
    score += 7;
    reasons.push("asks_ingredient");
    matched_examples.push("kandungan");
  }

  if (/\bmanfaat\b/.test(text)) {
    score += 6;
    reasons.push("asks_benefit");
    matched_examples.push("manfaat");
  }

  if (/\bbrosur\b/.test(text)) {
    score += 6;
    reasons.push("asks_brochure");
    matched_examples.push("brosur");
  }

  if (/\b(live|promosi)\b/.test(text)) {
    score += 4;
    reasons.push("needs_sales_material");
    matched_examples.push("live_promosi");
  }

  return {
    score,
    hit_count: matched_examples.length,
    matched_examples,
    reasons,
  };
}

function detectTrustAnxiety(text) {
  let score = 0;
  const reasons = [];
  const matched_examples = [];

  if (/\b(amanah|scam)\b/.test(text)) {
    score += 8;
    reasons.push("asks_trustworthiness");
    matched_examples.push("amanah_scam");
  }

  if (/\b(tertipu|ragu)\b/.test(text)) {
    score += 8;
    reasons.push("expresses_doubt");
    matched_examples.push("tertipu_ragu");
  }

  if (/\bbeneran\b/.test(text)) {
    score += 5;
    reasons.push("asks_if_real");
    matched_examples.push("beneran");
  }

  return {
    score,
    hit_count: matched_examples.length,
    matched_examples,
    reasons,
  };
}

function detectProgressAnxiety(text) {
  let score = 0;
  const reasons = [];
  const matched_examples = [];

  if (/\bkapan\s+dikirim\b/.test(text)) {
    score += 8;
    reasons.push("asks_shipping_eta");
    matched_examples.push("kapan_dikirim");
  }

  if (/\b(progress|perkembangan)\s+pesanan\b/.test(text)) {
    score += 8;
    reasons.push("asks_order_progress");
    matched_examples.push("progress_pesanan");
  }

  if (/\b(status\s+order|resi)\b/.test(text)) {
    score += 7;
    reasons.push("asks_status_or_resi");
    matched_examples.push("status_order_resi");
  }

  if (/\bsaya\s+tunggu\b/.test(text)) {
    score += 4;
    reasons.push("waiting_pressure");
    matched_examples.push("saya_tunggu");
  }

  return {
    score,
    hit_count: matched_examples.length,
    matched_examples,
    reasons,
  };
}

function detectProofSeeking(text) {
  let score = 0;
  const reasons = [];
  const matched_examples = [];

  if (/\blihat\s+dulu\b/.test(text)) {
    score += 6;
    reasons.push("wants_to_see_first");
    matched_examples.push("lihat_dulu");
  }

  if (/\b(video\s+packing|keseluruhan\s+produk)\b/.test(text)) {
    score += 8;
    reasons.push("asks_specific_proof");
    matched_examples.push("video_packing_or_keseluruhan");
  }

  if (/\b(sebelum\s+pelunasan|siap\s+kirim)\b/.test(text)) {
    score += 6;
    reasons.push("proof_before_final_payment");
    matched_examples.push("before_pelunasan");
  }

  if (/\bbukti\b/.test(text)) {
    score += 5;
    reasons.push("explicit_proof_request");
    matched_examples.push("bukti");
  }

  return {
    score,
    hit_count: matched_examples.length,
    matched_examples,
    reasons,
  };
}

function zeroCustomSignal() {
  return {
    score: 0,
    hit_count: 0,
    matched_examples: [],
    reasons: [],
  };
}

/* ---------------------------------
   Final SOP signals
---------------------------------- */

function buildSopSignals({ signalDetections, context, bubbleMetrics, segments }) {
  const combinedText = safeString(segments?.combined || "", 12000);

  /** @type {SopSignals} */
  const out = createEmptySopSignals();

  out.curiosity_paket = Boolean(signalDetections.curiosity_paket?.matched);
  out.discovery_paket_structure = Boolean(signalDetections.discovery_paket_structure?.matched);
  out.legality_bpom = Boolean(signalDetections.legality_bpom?.matched);
  out.sample_vs_produksi = Boolean(signalDetections.sample_vs_produksi?.matched);
  out.budget_concern = Boolean(signalDetections.budget_concern?.matched);
  out.analytical_quantity_mix = Boolean(signalDetections.analytical_quantity_mix?.matched);
  out.visual_validation = Boolean(signalDetections.visual_validation?.matched);
  out.purchase_readiness = Boolean(signalDetections.purchase_readiness?.matched);
  out.brand_ownership = Boolean(signalDetections.brand_ownership?.matched);
  out.educational_support = Boolean(signalDetections.educational_support?.matched);
  out.trust_anxiety = Boolean(signalDetections.trust_anxiety?.matched);
  out.progress_anxiety = Boolean(signalDetections.progress_anxiety?.matched);
  out.proof_seeking = Boolean(signalDetections.proof_seeking?.matched);

  const isSampleDirection = out.sample_vs_produksi;
  const isBrandDirection =
    out.brand_ownership ||
    Boolean(context.has_form_sent) ||
    Boolean(context.has_form_filled);

  const textPostPayment =
    /\b(sudah\s+transfer|sudah\s+bayar|invoice|pelunasan|resi)\b/.test(combinedText) ||
    out.progress_anxiety;

  const isPostPayment =
    Boolean(context.is_post_payment) ||
    Boolean(context.has_dp_paid) ||
    Boolean(context.has_invoice_sent) ||
    Boolean(context.has_resi_sent) ||
    Boolean(
      isPostPaymentContextCompat({
        ...asPlainObject(context),
        latest_customer_text: context.latest_customer_text || combinedText,
        customer_message: context.customer_message || combinedText,
      })
    ) ||
    textPostPayment;

  const isAtRisk =
    Boolean(context.is_at_risk) ||
    out.trust_anxiety ||
    out.proof_seeking ||
    Boolean(
      isAtRiskContextCompat({
        ...asPlainObject(context),
        latest_customer_text: context.latest_customer_text || combinedText,
        customer_message: context.customer_message || combinedText,
      })
    );

  const bubbleGt5 = Boolean(bubbleMetrics.customer_bubble_gt_5);

  const shouldUpgradeToProspek =
    isPostPayment ||
    isAtRisk ||
    isBrandDirection ||
    (bubbleGt5 &&
      (out.purchase_readiness ||
        out.sample_vs_produksi ||
        out.brand_ownership ||
        out.visual_validation ||
        out.analytical_quantity_mix));

  const urgencyScore = clampNumber(
    (out.purchase_readiness ? 24 : 0) +
      (out.brand_ownership ? 14 : 0) +
      (out.analytical_quantity_mix ? 10 : 0) +
      (isPostPayment ? 18 : 0) +
      (isAtRisk ? 28 : 0) +
      (bubbleGt5 ? 8 : 0),
    0,
    100
  );

  out.detected_topics = buildDetectedTopicsFromSignalMap(signalDetections);
  out.should_upgrade_to_prospek = shouldUpgradeToProspek;
  out.urgency_score = urgencyScore;
  out.status_flags = {
    is_sample_direction: Boolean(isSampleDirection),
    is_brand_direction: Boolean(isBrandDirection),
    is_post_payment: Boolean(isPostPayment),
    is_at_risk: Boolean(isAtRisk),
    customer_bubble_gt_5: Boolean(bubbleGt5),
  };

  return out;
}

function createEmptySopSignals() {
  return {
    ...EMPTY_SOP_SIGNALS,
    detected_topics: [],
    status_flags: createEmptyStatusFlags(),
  };
}

function createEmptyStatusFlags() {
  return { ...EMPTY_STATUS_FLAGS };
}

function buildDetectedTopicsFromSignalMap(signalDetections) {
  const topics = [];
  const map = asPlainObject(signalDetections);

  for (const key of SIGNAL_KEYS) {
    if (map[key] && typeof map[key] === "object" && map[key].matched) {
      topics.push(key);
    }
  }

  return uniqueStrings(topics);
}

/* ---------------------------------
   Bubble metrics
---------------------------------- */

function buildBubbleMetrics(input, segments) {
  const src = asPlainObject(input);

  const explicitCount = toSafeNumber(src.customer_bubble_count);
  const tailText = safeString(src.tail || src.recent_chat_history || "", 12000);
  const summaryText = safeString(src.summary || "", 6000);

  const inferredFromTail = countCustomerBubblesFromTranscript(tailText);
  const inferredFromSummary = countCustomerBubblesFromTranscript(summaryText);
  const fallbackLatest = segments?.latest ? 1 : 0;

  const customerBubbleCount = Math.max(
    explicitCount,
    inferredFromTail,
    inferredFromSummary,
    fallbackLatest
  );

  return {
    customer_bubble_count: customerBubbleCount,
    agent_bubble_count: countAgentBubblesFromTranscript(tailText),
    customer_bubble_gt_5: customerBubbleCount > 5,
  };
}

function createEmptyBubbleMetrics() {
  return { ...EMPTY_BUBBLE_METRICS };
}

/* ---------------------------------
   Rule scoring
---------------------------------- */

function scoreRuleAgainstSegments({
  rule,
  context,
  segments,
  signalDetections,
  sopSignals,
  bubbleMetrics,
  opts,
}) {
  void context;

  const safeRule = asPlainObject(rule);

  const explicitRowDetectorKey = resolveRuleDetectorKey(safeRule);
  const explicitRow =
    EXPLICIT_ROW_DETECTORS.find((item) => item.key === explicitRowDetectorKey) || null;

  const primarySignalKey = explicitRow?.signal_key || "";
  const primarySignal = primarySignalKey ? signalDetections[primarySignalKey] : null;

  const positiveMatches = collectRulePatternMatches(safeRule.patterns, segments);
  const negativeMatches = collectRulePatternMatches(safeRule.negative_patterns, segments);

  const supportSignalKeys = explicitRow?.support_signals || [];
  const supportSignalScore = supportSignalKeys.reduce((total, key) => {
    const signal = signalDetections[key];
    return total + (signal?.matched
      ? Math.round(signal.weighted_score * opts.supportSignalWeight)
      : 0);
  }, 0);

  const contextBonus = computeContextBonus({
    rule: safeRule,
    explicitRow,
    sopSignals,
    bubbleMetrics,
  });

  const baseScore =
    Number(safeRule.base_score || 0) * opts.baseRuleWeight +
    Number(safeRule.priority || 0) * opts.priorityWeight;

  const positiveScore = positiveMatches.score;
  const negativePenalty =
    negativeMatches.score > 0 ? negativeMatches.score + opts.negativePenalty : 0;

  const primarySignalScore =
    primarySignal?.matched
      ? Math.round(primarySignal.weighted_score * opts.primarySignalWeight) +
        opts.explicitDetectorBonus
      : 0;

  const rawScore =
    baseScore +
    positiveScore +
    primarySignalScore +
    supportSignalScore +
    contextBonus -
    negativePenalty;

  const score = clampNumber(Math.round(rawScore), 0, 1000);

  const signalAlignmentDetails = uniqueStrings([
    primarySignal?.matched ? primarySignalKey : "",
    ...supportSignalKeys.filter((key) => signalDetections[key]?.matched),
  ]);

  const matchedContextCues = uniqueStrings([
    explicitRow?.key ? `explicit_row:${explicitRow.key}` : "",
    contextBonus > 0 && sopSignals.status_flags.is_post_payment ? "context_post_payment" : "",
    contextBonus > 0 && sopSignals.status_flags.is_at_risk ? "context_at_risk" : "",
    bubbleMetrics.customer_bubble_gt_5 ? "context_bubble_gt_5" : "",
  ]);

  const confidenceScore = buildConfidenceScore({
    score,
    positiveMatchCount: positiveMatches.patterns.length,
    exactMatchCount: positiveMatches.exact_count,
    tokenCoverageMatchCount: positiveMatches.token_coverage_count,
    negativeMatchCount: negativeMatches.patterns.length,
    primarySignalMatched: Boolean(primarySignal?.matched),
    supportSignalCount: signalAlignmentDetails.length,
    hasExplicitRow: Boolean(explicitRow),
  });

  const ambiguityScore = buildAmbiguityScore({
    primarySignalMatched: Boolean(primarySignal?.matched),
    positiveMatchCount: positiveMatches.patterns.length,
    exactMatchCount: positiveMatches.exact_count,
    segments,
  });

  const candidate = {
    rule_id: safeString(safeRule.id || safeRule.rule_id || ""),
    rule: safeRule,
    score,
    confidence_score: confidenceScore,
    ambiguity_score: ambiguityScore,

    explicit_row_detector_key: safeString(explicitRowDetectorKey),
    primary_signal_key: safeString(primarySignalKey),

    matched_patterns: positiveMatches.patterns,
    negative_patterns: negativeMatches.patterns,

    matched_context_cues: matchedContextCues,
    signal_alignment_details: signalAlignmentDetails,

    positive_match_count: positiveMatches.patterns.length,
    negative_match_count: negativeMatches.patterns.length,
    exact_match_count: positiveMatches.exact_count,
    token_coverage_count: positiveMatches.token_coverage_count,
    context_match_count: matchedContextCues.length,
    signal_alignment_count: signalAlignmentDetails.length,
    signal_alignment_score:
      Math.max(primarySignalScore, 0) + Math.max(supportSignalScore, 0),

    matched_in: {
      latest: positiveMatches.matched_in.latest,
      tail: positiveMatches.matched_in.tail,
      summary: positiveMatches.matched_in.summary,
    },

    match_detail: {
      latest: { matched_patterns: positiveMatches.matched_in.latest },
      tail: { matched_patterns: positiveMatches.matched_in.tail },
      summary: { matched_patterns: positiveMatches.matched_in.summary },
    },

    occurrences: {
      latest: positiveMatches.occurrences.latest,
      tail: positiveMatches.occurrences.tail,
      summary: positiveMatches.occurrences.summary,
      total:
        positiveMatches.occurrences.latest +
        positiveMatches.occurrences.tail +
        positiveMatches.occurrences.summary,
    },
  };

  const hasEnoughSignal =
    score >= opts.minCandidateScore ||
    (primarySignal?.matched && primarySignal.weighted_score >= opts.minSignalStrength) ||
    positiveMatches.patterns.length >= 2;

  if (!hasEnoughSignal) {
    return null;
  }

  return candidate;
}

function collectRulePatternMatches(patterns, segments) {
  const out = {
    patterns: [],
    matched_in: { latest: [], tail: [], summary: [] },
    occurrences: { latest: 0, tail: 0, summary: 0 },
    score: 0,
    exact_count: 0,
    token_coverage_count: 0,
  };

  for (const rawPattern of Array.isArray(patterns) ? patterns : []) {
    const pattern = aggressiveNormalizeDatasetText(rawPattern);
    if (!pattern) continue;

    const patternMeta = buildPatternMeta(pattern);

    const latest = matchPatternAgainstSegment(patternMeta, segments.meta.latest);
    const tail = matchPatternAgainstSegment(patternMeta, segments.meta.tail);
    const summary = matchPatternAgainstSegment(patternMeta, segments.meta.summary);

    const matchedAnywhere = latest.matched || tail.matched || summary.matched;
    if (!matchedAnywhere) continue;

    out.patterns.push(pattern);

    if (latest.matched) {
      out.matched_in.latest.push(pattern);
      out.occurrences.latest += latest.occurrences;
      out.score += latest.score * DEFAULT_OPTIONS.latestWeight;
      if (latest.mode === "exact") out.exact_count += 1;
      if (latest.mode === "token_coverage") out.token_coverage_count += 1;
    }

    if (tail.matched) {
      out.matched_in.tail.push(pattern);
      out.occurrences.tail += tail.occurrences;
      out.score += tail.score * DEFAULT_OPTIONS.tailWeight;
      if (tail.mode === "exact") out.exact_count += 1;
      if (tail.mode === "token_coverage") out.token_coverage_count += 1;
    }

    if (summary.matched) {
      out.matched_in.summary.push(pattern);
      out.occurrences.summary += summary.occurrences;
      out.score += summary.score * DEFAULT_OPTIONS.summaryWeight;
      if (summary.mode === "exact") out.exact_count += 1;
      if (summary.mode === "token_coverage") out.token_coverage_count += 1;
    }
  }

  out.patterns = uniqueStrings(out.patterns);
  out.matched_in.latest = uniqueStrings(out.matched_in.latest);
  out.matched_in.tail = uniqueStrings(out.matched_in.tail);
  out.matched_in.summary = uniqueStrings(out.matched_in.summary);
  out.score = Math.round(
    out.score +
      Math.min(
        Math.max(
          out.occurrences.latest + out.occurrences.tail + out.occurrences.summary - out.patterns.length,
          0
        ),
        DEFAULT_OPTIONS.repeatedPatternBonusCap
      )
  );

  return out;
}

function buildPatternMeta(pattern) {
  const tokens = tokenize(pattern);
  const canonicalTokens = tokens.map(canonicalizeToken);
  const contentTokens = canonicalTokens.filter((token) => !STOPWORDS.has(token));

  return {
    pattern,
    tokens,
    canonicalTokens,
    contentTokens,
    isMultiWord: tokens.length > 1,
  };
}

function matchPatternAgainstSegment(patternMeta, segmentMeta) {
  if (!patternMeta?.pattern || !segmentMeta?.text) {
    return noPatternMatch();
  }

  const exactOccurrences = countPatternOccurrences(segmentMeta.text, patternMeta.pattern);
  if (exactOccurrences > 0) {
    return {
      matched: true,
      occurrences: exactOccurrences,
      mode: "exact",
      score:
        (patternMeta.isMultiWord
          ? DEFAULT_OPTIONS.exactPatternBoost
          : DEFAULT_OPTIONS.exactPatternBoost - 2) + Math.min(exactOccurrences, 3),
    };
  }

  if (patternMeta.contentTokens.length > 0) {
    const coverage = countCanonicalOverlap(
      patternMeta.contentTokens,
      segmentMeta.contentCanonicalTokens
    );

    const ratio = coverage / patternMeta.contentTokens.length;
    const ordered = hasOrderedCoverage(
      patternMeta.contentTokens,
      segmentMeta.contentCanonicalTokens
    );

    if (ratio >= 1 || (patternMeta.contentTokens.length >= 3 && ratio >= 0.67 && ordered)) {
      return {
        matched: true,
        occurrences: 1,
        mode: "token_coverage",
        score: DEFAULT_OPTIONS.tokenCoverageBoost + Math.round(ratio * 4),
      };
    }
  }

  return noPatternMatch();
}

function noPatternMatch() {
  return {
    matched: false,
    occurrences: 0,
    mode: "",
    score: 0,
  };
}

function computeContextBonus({ rule, explicitRow, sopSignals, bubbleMetrics }) {
  let bonus = 0;

  const signalKey = explicitRow?.signal_key || "";
  if (signalKey && sopSignals[signalKey]) {
    bonus += 12;
  }

  if (rule?.prospect_type === "brand" && sopSignals.status_flags.is_brand_direction) {
    bonus += 8;
  }

  if (rule?.prospect_type === "sample" && sopSignals.status_flags.is_sample_direction) {
    bonus += 8;
  }

  if (rule?.prospect_type === "post_payment" && sopSignals.status_flags.is_post_payment) {
    bonus += 10;
  }

  if (rule?.prospect_type === "at_risk" && sopSignals.status_flags.is_at_risk) {
    bonus += 10;
  }

  if (rule?.pipeline === "prospek" && sopSignals.should_upgrade_to_prospek) {
    bonus += 8;
  }

  if (bubbleMetrics.customer_bubble_gt_5 && rule?.pipeline !== "no_respons") {
    bonus += 4;
  }

  return bonus;
}

function buildConfidenceScore({
  score,
  positiveMatchCount,
  exactMatchCount,
  tokenCoverageMatchCount,
  negativeMatchCount,
  primarySignalMatched,
  supportSignalCount,
  hasExplicitRow,
}) {
  let confidence = 18;

  confidence += Math.min(Math.floor(score / 18), 28);
  confidence += Math.min(positiveMatchCount * 7, 21);
  confidence += Math.min(exactMatchCount * 4, 16);
  confidence += Math.min(tokenCoverageMatchCount * 3, 12);
  confidence += Math.min(supportSignalCount * 4, 16);

  if (primarySignalMatched) confidence += 12;
  if (hasExplicitRow) confidence += 6;

  confidence -= Math.min(negativeMatchCount * 10, 24);

  return clampNumber(Math.round(confidence), 20, 98);
}

function buildAmbiguityScore({
  primarySignalMatched,
  positiveMatchCount,
  exactMatchCount,
  segments,
}) {
  let ambiguity = 0;
  const latestTokenCount = segments?.meta?.latest?.contentTokens?.length || 0;

  if (!primarySignalMatched) ambiguity += 24;
  if (positiveMatchCount <= 1) ambiguity += 16;
  if (exactMatchCount === 0) ambiguity += 10;
  if (latestTokenCount <= 3) ambiguity += 10;

  return clampNumber(ambiguity, 0, 100);
}

function shouldAcceptCandidate(selectedCandidate, candidates, sopSignals, opts) {
  if (!selectedCandidate) return false;

  if (
    selectedCandidate.score < opts.minCandidateScore &&
    selectedCandidate.confidence_score < opts.minConfidenceForMatch
  ) {
    return false;
  }

  if (!selectedCandidate.primary_signal_key && selectedCandidate.positive_match_count === 0) {
    return false;
  }

  if (
    selectedCandidate.primary_signal_key &&
    !sopSignals[selectedCandidate.primary_signal_key] &&
    selectedCandidate.positive_match_count === 0
  ) {
    return false;
  }

  const second =
    Array.isArray(candidates) && candidates.length > 1 ? candidates[1] : null;

  if (
    second &&
    Math.abs((selectedCandidate.score || 0) - (second.score || 0)) <= opts.closeScoreGapThreshold &&
    selectedCandidate.confidence_score < 36
  ) {
    return false;
  }

  return true;
}

function sortCandidates(a, b) {
  if ((b?.score || 0) !== (a?.score || 0)) {
    return (b?.score || 0) - (a?.score || 0);
  }

  if ((b?.confidence_score || 0) !== (a?.confidence_score || 0)) {
    return (b?.confidence_score || 0) - (a?.confidence_score || 0);
  }

  if ((b?.signal_alignment_score || 0) !== (a?.signal_alignment_score || 0)) {
    return (b?.signal_alignment_score || 0) - (a?.signal_alignment_score || 0);
  }

  if ((b?.exact_match_count || 0) !== (a?.exact_match_count || 0)) {
    return (b?.exact_match_count || 0) - (a?.exact_match_count || 0);
  }

  return Number(b?.rule?.priority || 0) - Number(a?.rule?.priority || 0);
}

function applyCompetitiveAmbiguity(candidates, opts) {
  if (!Array.isArray(candidates) || candidates.length < 2) return;

  const first = candidates[0];
  const second = candidates[1];
  const gap = Math.abs((first?.score || 0) - (second?.score || 0));

  if (gap <= opts.closeScoreGapThreshold) {
    first.confidence_score = clampNumber(first.confidence_score - 6, 20, 98);
    second.confidence_score = clampNumber(second.confidence_score - 4, 20, 98);

    first.ambiguity_score = clampNumber((first.ambiguity_score || 0) + 10, 0, 100);
    second.ambiguity_score = clampNumber((second.ambiguity_score || 0) + 8, 0, 100);
  }
}

/* ---------------------------------
   Explicit row resolver
---------------------------------- */

function resolveRuleDetectorKey(rule) {
  const safeRule = asPlainObject(rule);

  const id = normalizeLooseKey(safeRule.id || "");
  const datasetRowId = normalizeLooseKey(safeRule.dataset_row_id || "");
  const label = normalizeLooseKey(safeRule.dataset_row_label || safeRule.label || "");
  const emotion = normalizeLooseKey(safeRule.emotion || "");
  const intent = normalizeLooseKey(safeRule.intent || "");
  const behaviourStage = normalizeLooseKey(safeRule.behaviour_stage || "");

  const directCandidates = [datasetRowId, id, label];

  for (const candidate of directCandidates) {
    for (const key of ROW_KEY_SET) {
      if (candidate.includes(key)) return key;
    }
  }

  for (const item of EXPLICIT_ROW_DETECTORS) {
    const emotionMatch = emotion === normalizeLooseKey(item.emotion);
    const intentMatch = intent === normalizeLooseKey(item.intent);
    const stageMatch = behaviourStage === normalizeLooseKey(item.behaviour_stage);

    if (emotionMatch && intentMatch) return item.key;
    if (emotionMatch && stageMatch) return item.key;
  }

  return "";
}

/* ---------------------------------
   Default dataset base
---------------------------------- */

function buildDefaultDatasetBase({
  segments,
  context,
  sopSignals,
  bubbleMetrics,
  signalDetections,
  opts,
}) {
  const strongestSignalKey = findStrongestSignalKey(signalDetections);
  const suggestedReply = firstNonEmpty([
    DEFAULT_ANALYSIS.suggested_reply,
    DEFAULT_ANALYSIS.suggested_response,
    "Halo kak, saya bantu ya. Kakak lagi cari info paket, sample, legalitas, atau mau bikin brand sendiri dulu?",
  ]);

  return {
    rule_id: safeString(DEFAULT_ANALYSIS.rule_id || "default_analysis"),
    dataset_row_id: "",
    dataset_row_label: "",

    pipeline: firstNonEmpty([DEFAULT_ANALYSIS.pipeline, "respons"]),
    default_pipeline: firstNonEmpty([DEFAULT_ANALYSIS.pipeline, "respons"]),

    lead_level: firstNonEmpty([
      DEFAULT_ANALYSIS.lead_level,
      DEFAULT_ANALYSIS.lead_level_stage,
      "cold",
    ]),
    lead_level_stage: firstNonEmpty([
      DEFAULT_ANALYSIS.lead_level,
      DEFAULT_ANALYSIS.lead_level_stage,
      "cold",
    ]),

    emotion: firstNonEmpty([DEFAULT_ANALYSIS.emotion, "unknown"]),
    intent: firstNonEmpty([DEFAULT_ANALYSIS.intent, "unknown"]),
    behaviour_stage: firstNonEmpty([DEFAULT_ANALYSIS.behaviour_stage, "curiosity"]),
    customer_profile: firstNonEmpty([DEFAULT_ANALYSIS.customer_profile, ""]),

    sop_stage_current: firstNonEmpty([
      DEFAULT_ANALYSIS.sop_stage_current,
      "greeting_awal",
    ]),
    default_sop_stage_current: firstNonEmpty([
      DEFAULT_ANALYSIS.sop_stage_current,
      "greeting_awal",
    ]),

    sop_stage_next: firstNonEmpty([
      DEFAULT_ANALYSIS.sop_stage_next,
      "share_info_tanya_balik",
    ]),
    default_sop_stage_next: firstNonEmpty([
      DEFAULT_ANALYSIS.sop_stage_next,
      "share_info_tanya_balik",
    ]),

    followup_gap: firstNonEmpty([DEFAULT_ANALYSIS.followup_gap, ""]),

    priority: firstNonEmpty([
      DEFAULT_ANALYSIS.priority,
      DEFAULT_ANALYSIS.priority_level,
      "medium",
    ]),
    priority_level: firstNonEmpty([
      DEFAULT_ANALYSIS.priority,
      DEFAULT_ANALYSIS.priority_level,
      "medium",
    ]),

    prospect_type: firstNonEmpty([DEFAULT_ANALYSIS.prospect_type, "none"]),
    cs_action: firstNonEmpty([DEFAULT_ANALYSIS.cs_action, ""]),
    cs_action_template: firstNonEmpty([DEFAULT_ANALYSIS.cs_action, ""]),

    suggested_reply: suggestedReply,
    suggested_response: suggestedReply,
    suggested_reply_template: suggestedReply,

    tag_emotion: firstNonEmpty([
      DEFAULT_ANALYSIS.tag_emotion,
      normalizeTag(DEFAULT_ANALYSIS.emotion),
      "",
    ]),
    tag_stage: firstNonEmpty([
      DEFAULT_ANALYSIS.tag_stage,
      normalizeTag(DEFAULT_ANALYSIS.behaviour_stage),
      "",
    ]),

    uncertainty_note: "Belum ada rule dataset yang cukup kuat untuk dipilih secara tegas.",
    conversion_rate_analyzed: clampNumber(
      Number(DEFAULT_ANALYSIS.conversion_rate_analyzed || 20),
      5,
      98
    ),
    confidence_score: clampNumber(
      Number(opts?.noMatchConfidence || DEFAULT_ANALYSIS.confidence_score || 20),
      20,
      98
    ),

    matched_patterns: [],
    negative_patterns: [],
    matched_context_cues: strongestSignalKey ? [`strongest_signal:${strongestSignalKey}`] : [],
    signal_alignment_details: uniqueStrings(sopSignals?.detected_topics || []),
    ambiguity_score: 100,
    matched_in: {
      latest: [],
      tail: [],
      summary: [],
    },

    rule_source: "default",
    normalized_text: safeString(segments?.combined || "", 12000),
    sop_signals: sopSignals || createEmptySopSignals(),
    status_flags: sopSignals?.status_flags || createEmptyStatusFlags(),
    bubble_metrics: bubbleMetrics || createEmptyBubbleMetrics(),
    brand_channel: context?.brand_channel || "unknown",

    explicit_row_detector_key: "",
    primary_signal_key: strongestSignalKey,
    required_artifacts: [],

    special_branch_applied: [],
    detected_quantities: mergeQuantitySignals([
      segments?.meta?.latest?.quantities,
      segments?.meta?.tail?.quantities,
      segments?.meta?.summary?.quantities,
    ]),

    selected_candidate_meta: {
      score: 0,
      positive_match_count: 0,
      negative_match_count: 0,
      context_match_count: 0,
      signal_alignment_count: 0,
      signal_alignment_score: 0,
    },
  };
}

/* ---------------------------------
   Quantity helpers
---------------------------------- */

function extractQuantitySignals(text) {
  const safeTextValue = String(text || "");
  const qtyMatches = [];
  const regex = /\b(\d{1,4})\s*(pcs|pc|item|botol|unit)\b/g;
  let match;

  while ((match = regex.exec(safeTextValue)) !== null) {
    qtyMatches.push({
      qty: Number(match[1]),
      unit: match[2],
    });
  }

  const mixBreakdown = [];
  for (const productName of PRODUCT_MIX_NAMES) {
    const patternA = new RegExp(`\\b${escapeRegExp(productName)}\\s*(\\d{1,4})\\b`, "g");
    const patternB = new RegExp(`\\b(\\d{1,4})\\s*${escapeRegExp(productName)}\\b`, "g");

    let a;
    while ((a = patternA.exec(safeTextValue)) !== null) {
      mixBreakdown.push({
        product: productName,
        qty: Number(a[1]),
      });
    }

    let b;
    while ((b = patternB.exec(safeTextValue)) !== null) {
      mixBreakdown.push({
        product: productName,
        qty: Number(b[1]),
      });
    }
  }

  return {
    qty_mentions: qtyMatches,
    mix_breakdown: dedupeMixBreakdown(mixBreakdown),
    total_qty_mentioned: qtyMatches.reduce((sum, item) => sum + Number(item.qty || 0), 0),
    has_100_pcs: qtyMatches.some((item) => item.qty === 100 && /pc|pcs/.test(item.unit)),
    has_5_item_hint: /\b5\s*item\b/.test(safeTextValue),
  };
}

function mergeQuantitySignals(list) {
  const items = Array.isArray(list) ? list.filter(Boolean) : [];
  const qtyMentions = [];
  const mixBreakdown = [];

  let totalQtyMentioned = 0;
  let has100Pcs = false;
  let has5ItemHint = false;

  for (const item of items) {
    for (const qty of item.qty_mentions || []) {
      qtyMentions.push(qty);
      totalQtyMentioned += Number(qty.qty || 0);
      if (Number(qty.qty) === 100 && /pc|pcs/.test(String(qty.unit || ""))) {
        has100Pcs = true;
      }
    }

    for (const mix of item.mix_breakdown || []) {
      mixBreakdown.push(mix);
    }

    if (item.has_5_item_hint) has5ItemHint = true;
  }

  return {
    qty_mentions: qtyMentions.slice(0, 20),
    mix_breakdown: dedupeMixBreakdown(mixBreakdown).slice(0, 20),
    total_qty_mentioned: totalQtyMentioned,
    has_100_pcs: has100Pcs,
    has_5_item_hint: has5ItemHint,
  };
}

function dedupeMixBreakdown(items) {
  const out = [];
  const seen = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    const product = safeString(item?.product || "", 80);
    const qty = Number(item?.qty || 0);
    if (!product || !qty) continue;

    const key = `${product}:${qty}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ product, qty });
  }

  return out;
}

function hasQuantityMixRequest(text) {
  const safeTextValue = String(text || "");
  const numberCount = (safeTextValue.match(/\b\d{1,4}\b/g) || []).length;
  const hasQtyUnits = /\b(\d{1,4})\s*(pcs|pc|item|botol|unit)\b/.test(safeTextValue);
  const hasMultipleProductNames =
    PRODUCT_MIX_NAMES.filter((name) => safeTextValue.includes(name)).length >= 2;
  const hasDistributionLanguage =
    /\b(meliputi|masing[\s-]*masing|rincian|per item|komposisi|mix qty|total pcs)\b/.test(
      safeTextValue
    );

  return (hasMultipleProductNames && numberCount >= 3) || (hasQtyUnits && hasDistributionLanguage);
}

/* ---------------------------------
   Matching helpers
---------------------------------- */

function tokenize(text) {
  return String(text || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function canonicalizeToken(token) {
  const value = String(token || "").trim();
  if (!value) return "";

  if (/^\d+$/.test(value)) return value;

  if (CANONICAL_TOKEN_MAP[value]) {
    return CANONICAL_TOKEN_MAP[value];
  }

  if (value.endsWith("nya") && CANONICAL_TOKEN_MAP[value.slice(0, -3)]) {
    return CANONICAL_TOKEN_MAP[value.slice(0, -3)];
  }

  return value;
}

function countCanonicalOverlap(patternTokens, textTokens) {
  if (!Array.isArray(patternTokens) || !Array.isArray(textTokens)) return 0;

  const usedIndexes = new Set();
  let count = 0;

  for (const patternToken of patternTokens) {
    const index = textTokens.findIndex(
      (textToken, idx) => !usedIndexes.has(idx) && textToken === patternToken
    );

    if (index >= 0) {
      usedIndexes.add(index);
      count += 1;
    }
  }

  return count;
}

function hasOrderedCoverage(patternTokens, textTokens) {
  if (!Array.isArray(patternTokens) || !Array.isArray(textTokens) || patternTokens.length === 0) {
    return false;
  }

  let pos = 0;
  for (const token of patternTokens) {
    const idx = textTokens.findIndex((textToken, i) => i >= pos && textToken === token);
    if (idx === -1) return false;
    pos = idx + 1;
  }

  return true;
}

function countPatternOccurrences(text, pattern) {
  if (!text || !pattern) return 0;

  if (pattern.includes(" ")) {
    return countPhraseOccurrences(text, pattern);
  }

  return countWholeWordOccurrences(text, pattern);
}

function countPhraseOccurrences(text, phrase) {
  let count = 0;
  let start = 0;

  while (start < text.length) {
    const idx = text.indexOf(phrase, start);
    if (idx === -1) break;
    count += 1;
    start = idx + phrase.length;
  }

  return count;
}

function countWholeWordOccurrences(text, word) {
  const regex = new RegExp(`(^|\\s)${escapeRegExp(word)}(?=\\s|$)`, "g");
  let count = 0;

  while (regex.exec(text) !== null) {
    count += 1;
  }

  return count;
}

/* ---------------------------------
   Bubble helpers
---------------------------------- */

function countCustomerBubblesFromTranscript(text) {
  const matches = String(text || "").match(/(^|\n)\s*customer\s*:/gi);
  return Array.isArray(matches) ? matches.length : 0;
}

function countAgentBubblesFromTranscript(text) {
  const matches = String(text || "").match(/(^|\n)\s*agent\s*:/gi);
  return Array.isArray(matches) ? matches.length : 0;
}

/* ---------------------------------
   Utility helpers
---------------------------------- */

function findStrongestSignalKey(signalDetections) {
  let bestKey = "";
  let bestScore = -1;

  for (const key of SIGNAL_KEYS) {
    const score = Number(signalDetections?.[key]?.weighted_score || 0);
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  return bestScore > 0 ? bestKey : "";
}

function sanitizeMatchedIn(value) {
  const input = asPlainObject(value);
  return {
    latest: uniqueStrings(toStringArray(input.latest)),
    tail: uniqueStrings(toStringArray(input.tail)),
    summary: uniqueStrings(toStringArray(input.summary)),
  };
}

function firstNonEmpty(values) {
  for (const value of Array.isArray(values) ? values : []) {
    const str = safeString(value);
    if (str) return str;
  }
  return "";
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

function normalizeLooseKey(value) {
  return safeString(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function normalizeTag(value) {
  return normalizeLooseKey(value).slice(0, 80);
}

function uniqueStrings(arr) {
  return [...new Set((Array.isArray(arr) ? arr : []).filter(Boolean))];
}

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function toSafeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function safeString(value, maxLen = 400) {
  return String(value || "").trim().slice(0, maxLen);
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/* ---------------------------------
   Fallback bridges
---------------------------------- */

function fallbackNormalizeDatasetText(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s./%-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackApplyRuleContext(rule, context) {
  const baseRule = asPlainObject(rule);
  const ctx = asPlainObject(context);

  const merged = {
    ...baseRule,
    brand_channel: normalizeBrandChannel(
      ctx.brand_channel || baseRule.brand_channel || "unknown"
    ),
  };

  if (applyChannelOverride) {
    return asPlainObject(applyChannelOverride(merged));
  }

  return merged;
}

function fallbackIsPostPaymentContext(input) {
  const src = asPlainObject(input);
  const text = safeString(
    src.latest_customer_text || src.customer_message || src.recent_chat_history || ""
  ).toLowerCase();

  return Boolean(
    src.is_post_payment ||
      src.has_dp_paid ||
      src.has_invoice_sent ||
      src.has_resi_sent ||
      /\b(sudah transfer|sudah bayar|invoice|pelunasan|resi|status order|kapan dikirim)\b/.test(text)
  );
}

function fallbackIsAtRiskContext(input) {
  const src = asPlainObject(input);
  const text = safeString(
    src.latest_customer_text || src.customer_message || src.recent_chat_history || ""
  ).toLowerCase();

  return Boolean(
    src.is_at_risk ||
      /\b(amanah|tertipu|ketipu|scam|ragu|beneran|bukti|lihat dulu|video packing)\b/.test(text)
  );
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