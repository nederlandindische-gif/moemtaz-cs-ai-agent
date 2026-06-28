// dataset_engine/rules.js

export const RULE_VERSION = "2026-03-09.4";

/**
 * @typedef {Record<string, any>} LooseRecord
 */

/* ---------------------------------
   Canonical taxonomy
---------------------------------- */
export const LEAD_LEVELS = Object.freeze([
  "cold",
  "warm",
  "warm_hot",
  "hot",
  "hot_at_risk",
]);

export const EMOTIONS = Object.freeze([
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
]);

export const INTENTS = Object.freeze([
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
]);

export const BEHAVIOUR_STAGES = Object.freeze([
  "curiosity",
  "interest",
  "evaluation",
  "decision",
  "post_decision",
  "post_purchase",
  "pre_pelunasan",
]);

export const PIPELINES = Object.freeze([
  "no_respons",
  "respons",
  "prospek",
]);

export const PRIORITY_LEVELS = Object.freeze([
  "low",
  "medium",
  "high",
  "urgent",
]);

export const PROSPECT_TYPES = Object.freeze([
  "none",
  "sample",
  "brand",
  "post_payment",
  "at_risk",
]);

export const BRAND_CHANNELS = Object.freeze([
  "mtz",
  "pcg",
  "grosir",
  "unknown",
]);

export const SOP_STAGES = Object.freeze([
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
]);

export const FINAL_SCHEMA_FIELDS = Object.freeze([
  "pipeline",
  "lead_level",
  "emotion",
  "intent",
  "behaviour_stage",
  "customer_profile",
  "sop_stage_current",
  "sop_stage_next",
  "followup_gap",
  "priority",
  "prospect_type",
  "cs_action",
  "suggested_reply",
  "tag_emotion",
  "tag_stage",
  "uncertainty_note",
]);

/* ---------------------------------
   Defaults
---------------------------------- */
const DEFAULT_PIPELINE = "respons";
const DEFAULT_LEAD_LEVEL = "cold";
const DEFAULT_INTENT = "unknown";
const DEFAULT_EMOTION = "unknown";
const DEFAULT_BEHAVIOUR_STAGE = "curiosity";
const DEFAULT_PRIORITY = "medium";
const DEFAULT_PROSPECT_TYPE = "none";
const DEFAULT_SOP_STAGE_CURRENT = "greeting_awal";
const DEFAULT_SOP_STAGE_NEXT = "share_info_tanya_balik";
const DEFAULT_BRAND_CHANNEL = "unknown";

const EMPTY_MATCHED_IN = Object.freeze({
  latest: [],
  tail: [],
  summary: [],
});

const EMPTY_STATUS_FLAGS = Object.freeze({
  is_sample_direction: false,
  is_brand_direction: false,
  is_post_payment: false,
  is_at_risk: false,
  customer_bubble_gt_5: false,
});

const EMPTY_BUBBLE_METRICS = Object.freeze({
  customer_bubble_count: 0,
  agent_bubble_count: 0,
  customer_bubble_gt_5: false,
});

const EMPTY_SOP_SIGNALS = Object.freeze({
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
});

export const DEFAULT_ANALYSIS = Object.freeze({
  rule_id: "default_unknown",
  dataset_row_id: "",
  dataset_row_label: "default_unknown",
  pipeline: DEFAULT_PIPELINE,
  lead_level: DEFAULT_LEAD_LEVEL,
  lead_level_stage: DEFAULT_LEAD_LEVEL,
  emotion: DEFAULT_EMOTION,
  intent: DEFAULT_INTENT,
  behaviour_stage: DEFAULT_BEHAVIOUR_STAGE,
  customer_profile: "customer umum yang masih perlu diarahkan ke kebutuhan utamanya",
  sop_stage_current: DEFAULT_SOP_STAGE_CURRENT,
  sop_stage_next: DEFAULT_SOP_STAGE_NEXT,
  followup_gap:
    "Kebutuhan customer belum cukup terkunci, jadi CS perlu mulai dari share info singkat lalu tanya balik.",
  priority: DEFAULT_PRIORITY,
  priority_level: DEFAULT_PRIORITY,
  prospect_type: DEFAULT_PROSPECT_TYPE,
  cs_action:
    "Mulai dari greeting sesuai waktu, share info singkat, lalu tanya balik untuk mengetahui customer lebih condong ke paket, sample, legalitas, atau brand sendiri.",
  suggested_reply:
    "Halo kak, saya bantu ya. Kakak lebih mau mulai dari info paket, sample, legalitas, atau mau bikin brand sendiri?",
  suggested_response:
    "Halo kak, saya bantu ya. Kakak lebih mau mulai dari info paket, sample, legalitas, atau mau bikin brand sendiri?",
  tag_emotion: "unknown",
  tag_stage: "curiosity",
  uncertainty_note: "",
  conversion_rate_analyzed: 20,
  confidence_score: 20,
  engine_dataset: "dataset_rules_v3",
  matched_patterns: [],
  matched_in: EMPTY_MATCHED_IN,
  matched_context_cues: [],
  rule_source: "default",
  sources_used: ["dataset"],
  status_flags: EMPTY_STATUS_FLAGS,
  bubble_metrics: EMPTY_BUBBLE_METRICS,
  sop_signals: EMPTY_SOP_SIGNALS,
});

/* ---------------------------------
   Numeric helpers
---------------------------------- */
export const PRIORITY_TO_NUMERIC = Object.freeze({
  low: 35,
  medium: 55,
  high: 75,
  urgent: 92,
});

export const LEAD_LEVEL_TO_BASE_SCORE = Object.freeze({
  cold: 30,
  warm: 52,
  warm_hot: 70,
  hot: 86,
  hot_at_risk: 82,
});

export const LEAD_LEVEL_TO_CONVERSION = Object.freeze({
  cold: 24,
  warm: 48,
  warm_hot: 66,
  hot: 84,
  hot_at_risk: 72,
});

/* ---------------------------------
   Alias normalization
---------------------------------- */
const LEAD_LEVEL_ALIASES = Object.freeze({
  cold: "cold",
  warm: "warm",
  "warm-hot": "warm_hot",
  warmhot: "warm_hot",
  warm_hot: "warm_hot",
  hot_warm: "warm_hot",
  hotwarm: "warm_hot",
  analytical: "warm_hot",
  analytic: "warm_hot",
  analitis: "warm_hot",
  hot: "hot",
  very_hot: "hot",
  veryhot: "hot",
  super_hot: "hot",
  existing: "hot",
  existing_customer: "hot",
  repeat_customer: "hot",
  hot_at_risk: "hot_at_risk",
  hotatrisk: "hot_at_risk",
  "hot-at-risk": "hot_at_risk",
});

const EMOTION_ALIASES = Object.freeze({
  curiosity: "curiosity",
  discovery: "discovery",
  interest: "discovery",
  trust_seeking: "trust_seeking",
  "trust seeking": "trust_seeking",
  trust: "trust_seeking",
  risk_aversion: "risk_aversion",
  sample_evaluation: "risk_aversion",
  budget_concern: "budget_concern",
  price_sensitivity: "budget_concern",
  analytical_thinking: "analytical_thinking",
  analytical: "analytical_thinking",
  technical_curiosity: "analytical_thinking",
  formula_compatibility: "analytical_thinking",
  competitor_awareness: "analytical_thinking",
  business_insight: "analytical_thinking",
  visual_validation: "visual_validation",
  purchase_readiness: "purchase_readiness",
  excitement: "purchase_readiness",
  brand_ownership: "brand_ownership",
  business_planning: "brand_ownership",
  creative_involvement: "brand_ownership",
  educational_support: "educational_support",
  support: "educational_support",
  trust_anxiety: "trust_anxiety",
  product_complaint: "trust_anxiety",
  product_safety_concern: "trust_anxiety",
  progress_anxiety: "progress_anxiety",
  proof_seeking: "proof_seeking",
  refund_concern: "proof_seeking",
  busy_delay: "curiosity",
  future_intention: "curiosity",
  unknown: "unknown",
});

const INTENT_ALIASES = Object.freeze({
  exploration: "exploration",
  explore: "exploration",
  discovery: "exploration",
  info: "exploration",
  trust: "trust",
  legality: "trust",
  legalitas: "trust",
  trial: "trial",
  sampling: "trial",
  sample: "trial",
  price: "price",
  pricing: "price",
  price_process: "price_process",
  "price/process": "price_process",
  process: "price_process",
  purchase: "purchase",
  order: "purchase",
  ordering: "purchase",
  branding: "branding",
  brand: "branding",
  support: "support",
  recovery: "recovery",
  trust_recovery: "trust_recovery",
  "trust/recovery": "trust_recovery",
  fulfillment: "fulfillment",
  fulfilment: "fulfillment",
  unknown: "unknown",
  emotion: "exploration",
});

const BEHAVIOUR_STAGE_ALIASES = Object.freeze({
  curiosity: "curiosity",
  interest: "interest",
  evaluation: "evaluation",
  sampling: "evaluation",
  sample: "evaluation",
  decision: "decision",
  post_decision: "post_decision",
  postdecision: "post_decision",
  post_purchase: "post_purchase",
  postpurchase: "post_purchase",
  pre_pelunasan: "pre_pelunasan",
  "pre-pelunasan": "pre_pelunasan",
  prepelunasan: "pre_pelunasan",
  decision_delay: "interest",
});

const PIPELINE_ALIASES = Object.freeze({
  no_respons: "no_respons",
  noresponse: "no_respons",
  no_response: "no_respons",
  respons: "respons",
  response: "respons",
  responded: "respons",
  prospek: "prospek",
  prospect: "prospek",
  closing: "prospek",
});

const PRIORITY_ALIASES = Object.freeze({
  low: "low",
  medium: "medium",
  normal: "medium",
  high: "high",
  urgent: "urgent",
  critical: "urgent",
});

const PROSPECT_TYPE_ALIASES = Object.freeze({
  none: "none",
  sample: "sample",
  brand: "brand",
  post_payment: "post_payment",
  postpayment: "post_payment",
  at_risk: "at_risk",
  atrisk: "at_risk",
});

const SOP_STAGE_ALIASES = Object.freeze({
  greeting_awal: "greeting_awal",
  share_info_tanya_balik: "share_info_tanya_balik",
  harga_paket_terkirim: "harga_paket_terkirim",
  prospek_sample: "prospek_sample",
  prospek_brand: "prospek_brand",
  form_terkirim: "form_terkirim",
  dp_request: "dp_request",
  invoice_konfirmasi: "invoice_konfirmasi",
  brand_development: "brand_development",
  progress_produksi: "progress_produksi",
  proof_before_pelunasan: "proof_before_pelunasan",
  resi_pengiriman: "resi_pengiriman",
  followup_contoh_produk: "followup_contoh_produk",
  followup_konten_design: "followup_konten_design",
  followup_testimoni: "followup_testimoni",
  followup_penawaran_sample: "followup_penawaran_sample",
  followup_bukti_transfer: "followup_bukti_transfer",
  followup_progress: "followup_progress",
});

const BRAND_CHANNEL_ALIASES = Object.freeze({
  mtz: "mtz",
  moemtaz: "mtz",
  moemtaz_group: "mtz",
  pcg: "pcg",
  grosir: "grosir",
  wholesale: "grosir",
  unknown: "unknown",
});

/* ---------------------------------
   Text normalization
---------------------------------- */
export const TEXT_REPLACEMENTS = Object.freeze([
  ["prodak", "produk"],
  ["prodk", "produk"],
  ["merk", "merek"],
  ["samplenya", "sample"],
  ["sampel", "sample"],
  ["sample nya", "sample"],
  ["sample-nya", "sample"],
  ["bpomnya", "bpom"],
  ["bpom nya", "bpom"],
  ["izin bpom", "bpom"],
  ["legalitasnya", "legalitas"],
  ["gmn", "gimana"],
  ["gmna", "gimana"],
  ["brp", "berapa"],
  ["utk", "untuk"],
  ["bwt", "buat"],
  ["sy", "saya"],
  ["yg", "yang"],
  ["bs", "bisa"],
  ["bsa", "bisa"],
  ["ga", "tidak"],
  ["gak", "tidak"],
  ["ngga", "tidak"],
  ["nggak", "tidak"],
  ["udh", "sudah"],
  ["udah", "sudah"],
  ["sdh", "sudah"],
  ["trf", "transfer"],
  ["dp nya", "dp"],
  ["dpnya", "dp"],
  ["invoice nya", "invoice"],
  ["mau coba dlu", "mau coba dulu"],
  ["low keuangan", "budget terbatas"],
  ["day cream", "krim siang"],
  ["night cream", "krim malam"],
  ["facial wash", "sabun wajah"],
  ["face wash", "sabun wajah"],
  ["packingnya", "packing"],
  ["tutupnya", "tutup"],
  ["video packingnya", "video packing"],
  ["real pict", "foto real"],
  ["cod kah", "cod"],
  ["tinggal trf", "tinggal transfer"],
]);

export function normalizeDatasetText(input) {
  let text = String(input || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s./%-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [from, to] of TEXT_REPLACEMENTS) {
    text = text.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, "g"), to);
  }

  text = text
    .replace(/\b(\d+)\s*jt\b/g, "$1 juta")
    .replace(/\b(\d+)\s*rb\b/g, "$1 ribu")
    .replace(/\b(\d+)\s*pc\b/g, "$1 pcs")
    .replace(/\b100pc\b/g, "100 pcs")
    .replace(/\b5item\b/g, "5 item")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

/* ---------------------------------
   Channel overrides
---------------------------------- */
export const CHANNEL_OVERRIDES = Object.freeze({
  mtz: Object.freeze({
    prepend_cs_action: "",
    append_cs_action: "",
    prepend_suggested_reply: "",
    append_suggested_reply: "",
    extra_required_artifacts: [],
  }),

  pcg: Object.freeze({
    prepend_cs_action: "",
    append_cs_action:
      " Jika relevan, tambahkan penguat trust seperti data CPKB atau dokumen resmi pendukung.",
    prepend_suggested_reply: "",
    append_suggested_reply:
      " Kalau kakak perlu, saya bisa sertakan juga data pendukung resminya ya kak.",
    extra_required_artifacts: ["data_cpkb", "dokumen_resmi_pendukung"],
  }),

  grosir: Object.freeze({
    prepend_cs_action:
      "Tanyakan dulu apakah kebutuhan customer untuk pemakaian pribadi atau untuk dijual lagi. ",
    append_cs_action: "",
    prepend_suggested_reply:
      "Sebelum saya arahkan lebih pas, boleh saya tahu dulu kak ini untuk dipakai sendiri atau mau dijual lagi ya? ",
    append_suggested_reply: "",
    extra_required_artifacts: ["tujuan_pribadi_atau_jual_lagi"],
  }),

  unknown: Object.freeze({
    prepend_cs_action: "",
    append_cs_action: "",
    prepend_suggested_reply: "",
    append_suggested_reply: "",
    extra_required_artifacts: [],
  }),
});

/* ---------------------------------
   Special branches
---------------------------------- */
export const SPECIAL_BRANCHES = Object.freeze({
  post_payment: Object.freeze({
    pipeline: "prospek",
    lead_level: "hot_at_risk",
    priority: "high",
    prospect_type: "post_payment",
    default_stage_current: "progress_produksi",
    default_stage_next: "resi_pengiriman",
    required_artifacts: ["status_real_order", "eta_tahap_berikutnya", "resi_pengiriman"],
    cs_action:
      "Fokus ke status real-time, progress order, ETA, pelunasan bila relevan, dan resi bila sudah tersedia.",
    suggested_reply:
      "Baik kak, saya cek status real order kakak sekarang ya, nanti saya informasikan posisinya dan estimasi tahap berikutnya.",
  }),

  at_risk: Object.freeze({
    pipeline: "prospek",
    lead_level: "hot_at_risk",
    priority: "urgent",
    prospect_type: "at_risk",
    default_stage_current: "proof_before_pelunasan",
    default_stage_next: "progress_produksi",
    required_artifacts: ["proof_real_order", "rekening_resmi", "identitas_pt"],
    cs_action:
      "Jangan pakai janji umum. Berikan proof konkret seperti status order real, rekening resmi PT, identitas perusahaan, foto real produk, atau video packing yang relevan.",
    suggested_reply:
      "Paham kak. Biar kakak lebih tenang, saya bantu kirim bukti yang konkret sesuai tahap order kakak ya, supaya semuanya lebih jelas.",
  }),
});

/* ---------------------------------
   No response SOP
---------------------------------- */
export const NO_RESPONSE_FOLLOWUP_SEQUENCE = Object.freeze([
  Object.freeze({
    order: 1,
    type: "contoh_produk",
    stage: "followup_contoh_produk",
    recommended_delay_hours: 24,
    required_artifacts: ["contoh_produk_relevan"],
  }),
  Object.freeze({
    order: 2,
    type: "konten_dan_design",
    stage: "followup_konten_design",
    recommended_delay_hours: 24,
    required_artifacts: ["konten_dan_design"],
  }),
  Object.freeze({
    order: 3,
    type: "testimoni",
    stage: "followup_testimoni",
    recommended_delay_hours: 24,
    required_artifacts: ["testimoni_relevan"],
  }),
  Object.freeze({
    order: 4,
    type: "penawaran_sample",
    stage: "followup_penawaran_sample",
    recommended_delay_hours: 24,
    required_artifacts: ["penawaran_sample_ringan"],
  }),
  Object.freeze({
    order: 5,
    type: "bukti_transfer",
    stage: "followup_bukti_transfer",
    recommended_delay_hours: 24,
    required_artifacts: ["trust_proof_administratif"],
  }),
  Object.freeze({
    order: 6,
    type: "tanya_progress",
    stage: "followup_progress",
    recommended_delay_hours: 24,
    required_artifacts: ["followup_progress_ringan"],
  }),
]);

/* ---------------------------------
   Required artifacts
---------------------------------- */
export const GAP_REQUIRED_ARTIFACTS = Object.freeze({
  penjelasan_bpom_dan_dokumen: Object.freeze([
    "bpom_scheme",
    "dokumen_customer",
    "penandaan_brand",
  ]),
  perbandingan_sample_vs_produksi: Object.freeze([
    "perbandingan_sample_vs_produksi",
    "revisi_1x",
  ]),
  skenario_biaya_aman: Object.freeze([
    "rincian_biaya",
    "opsi_dp",
    "estimasi_ongkir",
  ]),
  breakdown_qty_dan_item: Object.freeze([
    "breakdown_qty",
    "komposisi_item",
  ]),
  visual_proof_relevan: Object.freeze([
    "foto_atau_video_relevan",
  ]),
  rincian_isi_paket: Object.freeze([
    "rincian_paket",
  ]),
  next_closing_step: Object.freeze([
    "step_closing_terdekat",
  ]),
  form_brand_development: Object.freeze([
    "form_brand_development",
  ]),
  harga_final_dan_dp_50: Object.freeze([
    "harga_final",
    "dp_50",
    "rekening_resmi",
  ]),
  brief_brand_dan_progress: Object.freeze([
    "brief_brand",
    "status_progress",
  ]),
  rincian_sample_dan_revisi: Object.freeze([
    "harga_sample",
    "rincian_sample",
    "revisi_1x",
  ]),
  status_progress_sample: Object.freeze([
    "status_progress_sample",
  ]),
  konfirmasi_pembayaran_atau_invoice: Object.freeze([
    "status_pembayaran_aktual",
  ]),
  status_real_time_dan_eta: Object.freeze([
    "status_real_order",
    "eta_tahap_berikutnya",
  ]),
  resi_pengiriman: Object.freeze([
    "resi_pengiriman",
  ]),
  proof_real_order: Object.freeze([
    "foto_real_produk",
    "video_packing",
    "detail_item_order",
  ]),
  status_real_dan_eta: Object.freeze([
    "status_real_order",
    "eta_tahap_berikutnya",
  ]),
  trust_proof_konkret: Object.freeze([
    "rekening_resmi",
    "identitas_pt",
    "proof_relevan",
  ]),
  klarifikasi_gap_terdekat: Object.freeze([
    "klarifikasi_gap",
  ]),
  contoh_produk_relevan: Object.freeze([
    "contoh_produk_relevan",
  ]),
  konten_dan_design: Object.freeze([
    "konten_dan_design",
  ]),
  testimoni_relevan: Object.freeze([
    "testimoni_relevan",
  ]),
  penawaran_sample_ringan: Object.freeze([
    "penawaran_sample_ringan",
  ]),
  trust_proof_administratif: Object.freeze([
    "trust_proof_administratif",
  ]),
  followup_progress_ringan: Object.freeze([
    "followup_progress_ringan",
  ]),
});

export const SOP_STAGE_REQUIRED_ARTIFACTS = Object.freeze({
  greeting_awal: Object.freeze(["greeting_template", "entry_point_info"]),
  share_info_tanya_balik: Object.freeze(["entry_point_info", "clarifying_question"]),
  harga_paket_terkirim: Object.freeze(["rincian_paket"]),
  prospek_sample: Object.freeze(["harga_sample", "rincian_sample", "revisi_1x"]),
  prospek_brand: Object.freeze(["harga_final", "dp_50", "form_brand_development"]),
  form_terkirim: Object.freeze(["form_brand_development"]),
  dp_request: Object.freeze(["rekening_resmi", "nominal_dp"]),
  invoice_konfirmasi: Object.freeze(["invoice_atau_konfirmasi_admin"]),
  brand_development: Object.freeze(["brief_brand"]),
  progress_produksi: Object.freeze(["status_real_order", "eta_tahap_berikutnya"]),
  proof_before_pelunasan: Object.freeze(["proof_real_order"]),
  resi_pengiriman: Object.freeze(["resi_pengiriman"]),
  followup_contoh_produk: Object.freeze(["contoh_produk_relevan"]),
  followup_konten_design: Object.freeze(["konten_dan_design"]),
  followup_testimoni: Object.freeze(["testimoni_relevan"]),
  followup_penawaran_sample: Object.freeze(["penawaran_sample_ringan"]),
  followup_bukti_transfer: Object.freeze(["trust_proof_administratif"]),
  followup_progress: Object.freeze(["followup_progress_ringan"]),
});

export const PLAN_REQUIRED_ARTIFACTS = Object.freeze({
  greet_share_info_ask_back: Object.freeze(["entry_point_info"]),
  share_info_and_clarify_need: Object.freeze(["clarifying_question"]),
  package_price_clarification: Object.freeze(["rincian_paket"]),
  send_sample_offer: Object.freeze(["harga_sample", "rincian_sample", "revisi_1x"]),
  send_brand_offer: Object.freeze(["harga_final", "dp_50", "form_brand_development"]),
  followup_brand_form: Object.freeze(["form_brand_development"]),
  request_dp: Object.freeze(["rekening_resmi", "nominal_dp"]),
  confirm_invoice_or_payment: Object.freeze(["invoice_atau_konfirmasi_admin"]),
  continue_brand_brief: Object.freeze(["brief_brand"]),
  send_progress_update: Object.freeze(["status_real_order", "eta_tahap_berikutnya"]),
  send_proof_before_settlement: Object.freeze(["proof_real_order"]),
  send_shipping_confirmation: Object.freeze(["resi_pengiriman"]),
  send_product_examples: Object.freeze(["contoh_produk_relevan"]),
  send_design_references: Object.freeze(["konten_dan_design"]),
  send_testimonials: Object.freeze(["testimoni_relevan"]),
  offer_sample_path: Object.freeze(["penawaran_sample_ringan"]),
  send_trust_proof: Object.freeze(["trust_proof_administratif"]),
  light_progress_check: Object.freeze(["followup_progress_ringan"]),
  clarify_legality_and_documents: Object.freeze(["bpom_scheme", "dokumen_customer"]),
  clarify_sample_vs_production: Object.freeze(["perbandingan_sample_vs_produksi", "revisi_1x"]),
  send_budget_scenario: Object.freeze(["rincian_biaya", "opsi_dp"]),
  send_analytical_breakdown: Object.freeze(["breakdown_qty", "komposisi_item"]),
  send_visual_validation_assets: Object.freeze(["foto_atau_video_relevan"]),
  send_package_detail: Object.freeze(["rincian_paket"]),
  clarify_nearest_gap: Object.freeze(["klarifikasi_gap"]),
  send_brand_form: Object.freeze(["form_brand_development"]),
  send_brand_offer_and_dp: Object.freeze(["harga_final", "dp_50", "rekening_resmi"]),
  continue_brand_development: Object.freeze(["brief_brand", "status_progress"]),
  confirm_sample_payment_step: Object.freeze(["invoice_atau_instruksi_pembayaran"]),
  send_sample_progress_update: Object.freeze(["status_progress_sample"]),
  verify_payment_or_invoice: Object.freeze(["status_pembayaran_aktual"]),
  send_status_and_eta: Object.freeze(["status_real_order", "eta_tahap_berikutnya"]),
  send_resi_confirmation: Object.freeze(["resi_pengiriman"]),
  send_concrete_proof: Object.freeze(["proof_real_order", "rekening_resmi", "identitas_pt"]),
  send_real_status_recovery: Object.freeze(["status_real_order", "eta_tahap_berikutnya"]),
});

/* ---------------------------------
   SOP stage configs
---------------------------------- */
export const SOP_STAGE_CONFIGS = Object.freeze({
  greeting_awal: Object.freeze({
    stage_family: "entry",
    default_pipeline: "respons",
    default_priority: "medium",
    next_stage: "share_info_tanya_balik",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.greeting_awal,
    default_plan_action_code: "greet_share_info_ask_back",
  }),

  share_info_tanya_balik: Object.freeze({
    stage_family: "qualification",
    default_pipeline: "respons",
    default_priority: "medium",
    next_stage: "harga_paket_terkirim",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.share_info_tanya_balik,
    default_plan_action_code: "share_info_and_clarify_need",
  }),

  harga_paket_terkirim: Object.freeze({
    stage_family: "qualification",
    default_pipeline: "respons",
    default_priority: "medium",
    next_stage: "prospek_brand",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.harga_paket_terkirim,
    default_plan_action_code: "package_price_clarification",
  }),

  prospek_sample: Object.freeze({
    stage_family: "sample",
    default_pipeline: "prospek",
    default_priority: "high",
    next_stage: "invoice_konfirmasi",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.prospek_sample,
    default_plan_action_code: "send_sample_offer",
  }),

  prospek_brand: Object.freeze({
    stage_family: "brand",
    default_pipeline: "prospek",
    default_priority: "high",
    next_stage: "form_terkirim",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.prospek_brand,
    default_plan_action_code: "send_brand_offer",
  }),

  form_terkirim: Object.freeze({
    stage_family: "brand",
    default_pipeline: "prospek",
    default_priority: "high",
    next_stage: "dp_request",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.form_terkirim,
    default_plan_action_code: "followup_brand_form",
  }),

  dp_request: Object.freeze({
    stage_family: "brand",
    default_pipeline: "prospek",
    default_priority: "high",
    next_stage: "invoice_konfirmasi",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.dp_request,
    default_plan_action_code: "request_dp",
  }),

  invoice_konfirmasi: Object.freeze({
    stage_family: "administration",
    default_pipeline: "prospek",
    default_priority: "high",
    next_stage: "brand_development",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.invoice_konfirmasi,
    default_plan_action_code: "confirm_invoice_or_payment",
  }),

  brand_development: Object.freeze({
    stage_family: "brand",
    default_pipeline: "prospek",
    default_priority: "high",
    next_stage: "progress_produksi",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.brand_development,
    default_plan_action_code: "continue_brand_brief",
  }),

  progress_produksi: Object.freeze({
    stage_family: "post_payment",
    default_pipeline: "prospek",
    default_priority: "high",
    next_stage: "resi_pengiriman",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.progress_produksi,
    default_plan_action_code: "send_progress_update",
  }),

  proof_before_pelunasan: Object.freeze({
    stage_family: "at_risk",
    default_pipeline: "prospek",
    default_priority: "urgent",
    next_stage: "resi_pengiriman",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.proof_before_pelunasan,
    default_plan_action_code: "send_proof_before_settlement",
  }),

  resi_pengiriman: Object.freeze({
    stage_family: "shipping",
    default_pipeline: "prospek",
    default_priority: "high",
    next_stage: "resi_pengiriman",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.resi_pengiriman,
    default_plan_action_code: "send_shipping_confirmation",
  }),

  followup_contoh_produk: Object.freeze({
    stage_family: "no_response",
    default_pipeline: "no_respons",
    default_priority: "medium",
    next_stage: "followup_konten_design",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.followup_contoh_produk,
    default_plan_action_code: "send_product_examples",
  }),

  followup_konten_design: Object.freeze({
    stage_family: "no_response",
    default_pipeline: "no_respons",
    default_priority: "medium",
    next_stage: "followup_testimoni",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.followup_konten_design,
    default_plan_action_code: "send_design_references",
  }),

  followup_testimoni: Object.freeze({
    stage_family: "no_response",
    default_pipeline: "no_respons",
    default_priority: "medium",
    next_stage: "followup_penawaran_sample",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.followup_testimoni,
    default_plan_action_code: "send_testimonials",
  }),

  followup_penawaran_sample: Object.freeze({
    stage_family: "no_response",
    default_pipeline: "no_respons",
    default_priority: "medium",
    next_stage: "followup_bukti_transfer",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.followup_penawaran_sample,
    default_plan_action_code: "offer_sample_path",
  }),

  followup_bukti_transfer: Object.freeze({
    stage_family: "no_response",
    default_pipeline: "no_respons",
    default_priority: "medium",
    next_stage: "followup_progress",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.followup_bukti_transfer,
    default_plan_action_code: "send_trust_proof",
  }),

  followup_progress: Object.freeze({
    stage_family: "no_response",
    default_pipeline: "no_respons",
    default_priority: "medium",
    next_stage: "followup_progress",
    required_artifacts: SOP_STAGE_REQUIRED_ARTIFACTS.followup_progress,
    default_plan_action_code: "light_progress_check",
  }),
});

/* ---------------------------------
   Dataset rows (13 canonical rows)
---------------------------------- */
export const DATASET_ROWS = Object.freeze(
  [
    makeDatasetRow({
      id: "row_01_cold_curiosity_entry_package",
      label: "Cold • Curiosity • Exploration • Curiosity",
      lead_level: "cold",
      emotion: "curiosity",
      intent: "exploration",
      behaviour_stage: "curiosity",
      pipeline: "respons",
      priority: "medium",
      prospect_type: "none",
      sop_stage_current: "share_info_tanya_balik",
      sop_stage_next: "harga_paket_terkirim",
      customer_profile: "lead baru yang ingin entry point cepat seputar paket awal dan harga promo",
      patterns: [
        "halo saya dapat info terbaru",
        "bisa share harga promonya",
        "itu 1 paket kak",
        "paket awal",
        "harga promo",
        "info terbaru",
        "1 paket",
        "satu paket",
        "harga promonya",
      ],
      cs_action:
        "Jawab entry point dulu: harga paket, isi dasar, dan cocok untuk siapa. Setelah itu arahkan ke penjelasan isi paket dan skema harga.",
      suggested_reply:
        "Bisa kak. Untuk paket awal sudah include 5 item skincare dan cocok untuk mulai brand sendiri. Kakak mau saya jelaskan isi paket dan skema harganya sekalian?",
      required_artifacts: ["rincian_paket"],
      confidence_score: 56,
      conversion_rate_base: 26,
      base_score: 30,
      priority_numeric: 42,
      sop_signals: {
        curiosity_paket: true,
        detected_topics: ["paket_awal", "harga_promo"],
      },
    }),

    makeDatasetRow({
      id: "row_02_warm_discovery_package_structure",
      label: "Warm • Discovery • Exploration • Interest",
      lead_level: "warm",
      emotion: "discovery",
      intent: "exploration",
      behaviour_stage: "interest",
      pipeline: "respons",
      priority: "medium",
      prospect_type: "none",
      sop_stage_current: "harga_paket_terkirim",
      sop_stage_next: "harga_paket_terkirim",
      customer_profile: "customer yang ingin memahami struktur paket dengan angka dan pembagian item",
      patterns: [
        "isinya apa saja",
        "beda reguler silver sama gold apa",
        "100 pc meliputi 5 item",
        "100 pcs meliputi 5 item",
        "1 paket terdiri",
        "krim siang krim malam pembersih sabun pelembab",
        "paket reguler",
        "5 item",
        "masing masing 20 pcs",
      ],
      cs_action:
        "Jelaskan komposisi paket dengan angka dan pembagian item, bukan sekadar all in. Pastikan total pcs dan pembagian per item benar-benar jelas.",
      suggested_reply:
        "Untuk paket reguler totalnya 100 pcs ya kak. Standarnya terdiri dari 5 item, masing-masing 20 pcs. Kalau kakak mau saya bantu rinci satu-satu isi dan perbedaannya dengan paket lain.",
      required_artifacts: ["rincian_paket", "breakdown_qty"],
      confidence_score: 62,
      conversion_rate_base: 46,
      base_score: 50,
      priority_numeric: 55,
      sop_signals: {
        discovery_paket_structure: true,
        detected_topics: ["struktur_paket", "5_item", "100_pcs"],
      },
    }),

    makeDatasetRow({
      id: "row_03_warm_trust_seeking_legality",
      label: "Warm • Trust seeking • Trust • Evaluation",
      lead_level: "warm",
      emotion: "trust_seeking",
      intent: "trust",
      behaviour_stage: "evaluation",
      pipeline: "respons",
      priority: "high",
      prospect_type: "none",
      sop_stage_current: "harga_paket_terkirim",
      sop_stage_next: "harga_paket_terkirim",
      customer_profile: "customer yang sedang mengecek legalitas, BPOM, dan dokumen sebelum lanjut",
      patterns: [
        "sudah bpom kak",
        "paket reguler 3 juta itu bpom juga kan",
        "ada izinnya juga kan",
        "untuk bpom",
        "surat bpom nanti disertakan",
        "legalitas",
        "izin",
        "dokumen",
        "bpom",
      ],
      cs_action:
        "Jangan jawab terlalu umum. Jelaskan skema BPOM menginduk, penggunaan brand customer, penandaan produk, dan dokumen apa yang akan dipegang customer.",
      suggested_reply:
        "Baik kak, untuk paket ini BPOM atau izin skemanya menginduk ke perusahaan ya. Kalau kakak pakai brand sendiri juga bisa, dan nanti saya jelaskan dokumen serta penandaan produknya supaya kakak jelas dari awal.",
      required_artifacts: ["bpom_scheme", "dokumen_customer", "penandaan_brand"],
      confidence_score: 70,
      conversion_rate_base: 52,
      base_score: 54,
      priority_numeric: 74,
      sop_signals: {
        legality_bpom: true,
        detected_topics: ["bpom", "legalitas", "dokumen"],
      },
    }),

    makeDatasetRow({
      id: "row_04_warm_risk_aversion_sample_vs_production",
      label: "Warm • Risk aversion • Trial • Evaluation",
      lead_level: "warm",
      emotion: "risk_aversion",
      intent: "trial",
      behaviour_stage: "evaluation",
      pipeline: "respons",
      priority: "high",
      prospect_type: "sample",
      sop_stage_current: "harga_paket_terkirim",
      sop_stage_next: "prospek_sample",
      customer_profile: "customer yang ingin langkah aman dulu dan membandingkan sample versus langsung produksi",
      patterns: [
        "bisa dijelasin apa beda sample dan langsung produksi",
        "bisa lihat sample nya",
        "sample",
        "mau coba dulu",
        "buat sample 1 set berapa",
        "tester",
        "sample dulu",
        "langsung produksi",
      ],
      cs_action:
        "Terangkan fungsi sample, ukuran atau ruang lingkup sample, revisi 1x, dan kapan customer cocok lanjut ke produksi.",
      suggested_reply:
        "Boleh kak. Kalau sample, tujuannya buat cek tekstur, warna, aroma, dan feel produk dulu. Kalau langsung produksi, kakak langsung masuk tahap desain dan produksi. Saya bantu bandingkan plus-minus keduanya ya.",
      required_artifacts: ["perbandingan_sample_vs_produksi", "harga_sample", "revisi_1x"],
      confidence_score: 72,
      conversion_rate_base: 56,
      base_score: 56,
      priority_numeric: 78,
      status_flags: {
        is_sample_direction: true,
      },
      sop_signals: {
        sample_vs_produksi: true,
        detected_topics: ["sample", "langsung_produksi"],
      },
    }),

    makeDatasetRow({
      id: "row_05_warm_budget_concern",
      label: "Warm • Budget concern • Price • Evaluation",
      lead_level: "warm",
      emotion: "budget_concern",
      intent: "price",
      behaviour_stage: "evaluation",
      pipeline: "respons",
      priority: "high",
      prospect_type: "none",
      sop_stage_current: "harga_paket_terkirim",
      sop_stage_next: "prospek_sample",
      customer_profile: "customer yang tertarik punya produk sendiri tetapi sangat menjaga budget dan butuh simulasi aman",
      patterns: [
        "saya ingin punya produk sendiri tapi low keuangan",
        "budget terbatas",
        "pertimbangan yang matang sekalian untuk kalkulasinya",
        "modal aman",
        "paket 3 juta",
        "kalkulasi",
        "budget",
        "modal",
      ],
      cs_action:
        "Saat customer sensitif budget, bantu dengan skenario biaya yang realistis dan bertahap, bukan mendorong closing terlalu cepat.",
      suggested_reply:
        "Kalau budget kakak masih dijaga, saya bisa bantu hitungkan opsi paling aman dulu ya kak: mulai dari sample, atau paket reguler dengan rincian DP, pelunasan, dan ongkir supaya kakak lebih mantap.",
      required_artifacts: ["rincian_biaya", "opsi_dp", "estimasi_ongkir"],
      confidence_score: 72,
      conversion_rate_base: 58,
      base_score: 58,
      priority_numeric: 76,
      sop_signals: {
        budget_concern: true,
        detected_topics: ["budget", "kalkulasi", "modal"],
      },
    }),

    makeDatasetRow({
      id: "row_06_warm_hot_analytical_quantity_mix",
      label: "Warm-Hot • Analytical thinking • Price/Process • Evaluation",
      lead_level: "warm_hot",
      emotion: "analytical_thinking",
      intent: "price_process",
      behaviour_stage: "evaluation",
      pipeline: "respons",
      priority: "high",
      prospect_type: "none",
      sop_stage_current: "harga_paket_terkirim",
      sop_stage_next: "prospek_brand",
      customer_profile: "customer yang menghitung komposisi item, mix quantity, dan feasibility budget secara detail",
      patterns: [
        "harga per item bisa dijelaskan",
        "100 pcs itu sudah meliputi item di atas ya",
        "kalau krim siang 30 krim malam 30 toner 20 sabun wajah 10 serum 10 bisa",
        "harga per item",
        "mix qty",
        "komposisi item",
        "total pcs per item",
        "serum 10",
      ],
      cs_action:
        "Berikan breakdown final dan feasibility mix quantity dengan angka yang jelas, lalu bantu pilih skema yang paling pas untuk budget dan target jual customer.",
      suggested_reply:
        "Bisa kak, saya bantu cekkan komposisi item yang kakak mau. Nanti saya kirim rincian total pcs per item, total biaya, dan mana skema yang paling pas untuk budget serta target jual kakak.",
      required_artifacts: ["breakdown_qty", "komposisi_item", "rincian_biaya"],
      confidence_score: 78,
      conversion_rate_base: 66,
      base_score: 68,
      priority_numeric: 80,
      sop_signals: {
        analytical_quantity_mix: true,
        detected_topics: ["mix_qty", "harga_per_item", "komposisi_item"],
      },
    }),

    makeDatasetRow({
      id: "row_07_warm_hot_visual_validation",
      label: "Warm-Hot • Visual validation • Trust • Evaluation",
      lead_level: "warm_hot",
      emotion: "visual_validation",
      intent: "trust",
      behaviour_stage: "evaluation",
      pipeline: "respons",
      priority: "high",
      prospect_type: "brand",
      sop_stage_current: "harga_paket_terkirim",
      sop_stage_next: "prospek_brand",
      customer_profile: "customer yang butuh bukti visual seperti tekstur, warna isi, desain, dan packing untuk mengunci keyakinan",
      patterns: [
        "apa bisa di video isi creamnya",
        "untuk warna itu isi produk atau kemasannya",
        "untuk packing tutupnya bisa berwarna",
        "desainnya seperti apa",
        "video isi krim",
        "warna isi produk",
        "packing",
        "desain",
        "foto",
        "video",
      ],
      cs_action:
        "Gunakan foto, video, atau benchmark design sebagai alat closing. Kirim visual yang paling mendekati kebutuhan customer, bukan hanya penjelasan teks.",
      suggested_reply:
        "Siap kak, biar lebih kebayang saya kirim contoh tekstur, warna isi produk, dan referensi desain atau packing yang paling mendekati keinginan kakak. Dari situ nanti kakak tinggal pilih arahnya.",
      required_artifacts: ["foto_atau_video_relevan", "referensi_desain", "contoh_packing"],
      confidence_score: 80,
      conversion_rate_base: 68,
      base_score: 70,
      priority_numeric: 82,
      status_flags: {
        is_brand_direction: true,
      },
      sop_signals: {
        visual_validation: true,
        detected_topics: ["visual", "desain", "packing"],
      },
    }),

    makeDatasetRow({
      id: "row_08_hot_purchase_readiness",
      label: "Hot • Purchase readiness • Purchase • Decision",
      lead_level: "hot",
      emotion: "purchase_readiness",
      intent: "purchase",
      behaviour_stage: "decision",
      pipeline: "prospek",
      priority: "urgent",
      prospect_type: "brand",
      sop_stage_current: "prospek_brand",
      sop_stage_next: "dp_request",
      customer_profile: "customer yang sangat direct dan sudah siap masuk ke order, DP, rekening resmi, atau invoice",
      patterns: [
        "langsung yang 100 pcs produksi ka",
        "gimana buat pemesanannya cod kah",
        "tinggal transfer nya",
        "sudah di transfer yah ka",
        "langsung produksi",
        "cara pesan",
        "transfer",
        "invoice",
        "order sekarang",
      ],
      cs_action:
        "Begitu customer masuk tahap ini, lock total, DP, rekening resmi PT, status order, dan invoice dengan jelas.",
      suggested_reply:
        "Siap kak, total dan DP-nya saya pastikan ya. Transfer ke rekening resmi PT ini, lalu setelah masuk saya kirim konfirmasi penerimaan, invoice, dan order kakak langsung kami naikkan ke tahap berikutnya.",
      required_artifacts: ["harga_final", "dp_50", "rekening_resmi", "invoice_atau_konfirmasi_admin"],
      confidence_score: 88,
      conversion_rate_base: 86,
      base_score: 84,
      priority_numeric: 92,
      status_flags: {
        is_brand_direction: true,
      },
      sop_signals: {
        purchase_readiness: true,
        should_upgrade_to_prospek: true,
        detected_topics: ["purchase", "transfer", "invoice"],
      },
    }),

    makeDatasetRow({
      id: "row_09_hot_brand_ownership",
      label: "Hot • Brand ownership • Branding • Decision",
      lead_level: "hot",
      emotion: "brand_ownership",
      intent: "branding",
      behaviour_stage: "decision",
      pipeline: "prospek",
      priority: "high",
      prospect_type: "brand",
      sop_stage_current: "prospek_brand",
      sop_stage_next: "form_terkirim",
      customer_profile: "customer yang sudah mulai mengunci nama brand, konsep, warna utama, dan request packing",
      patterns: [
        "merek Melissa Beauty glow",
        "beauty glow di bawah nama Melissa",
        "yang mau dinamaiin Nalih skincare",
        "untuk packing kita bisa request",
        "nama brand",
        "warna utama",
        "style packing",
        "brand sendiri",
        "packing request",
      ],
      cs_action:
        "Segera ubah obrolan menjadi brand brief yang rapi: lock nama brand, konsep, warna utama, dan style packing agar tim desain bisa bergerak terarah.",
      suggested_reply:
        "Bisa kak. Kita lock dulu nama brand, konsep, warna utama, dan style packing yang kakak mau. Setelah itu tim desain tinggal buatkan opsi yang lebih terarah supaya prosesnya cepat.",
      required_artifacts: ["form_brand_development", "brief_brand", "referensi_desain"],
      confidence_score: 86,
      conversion_rate_base: 82,
      base_score: 82,
      priority_numeric: 84,
      status_flags: {
        is_brand_direction: true,
      },
      sop_signals: {
        brand_ownership: true,
        should_upgrade_to_prospek: true,
        detected_topics: ["brand", "nama_brand", "packing"],
      },
    }),

    makeDatasetRow({
      id: "row_10_hot_educational_support",
      label: "Hot • Educational support • Support • Post-decision",
      lead_level: "hot",
      emotion: "educational_support",
      intent: "support",
      behaviour_stage: "post_decision",
      pipeline: "prospek",
      priority: "high",
      prospect_type: "none",
      sop_stage_current: "brand_development",
      sop_stage_next: "brand_development",
      customer_profile: "customer yang sudah dealing tetapi butuh materi edukasi kandungan dan manfaat untuk dipakai jualan",
      patterns: [
        "arahan kandungan biar saya pelajari buat live",
        "minta brosur penjelasan kandungan dan manfaatnya",
        "materi live",
        "brosur kandungan",
        "manfaatnya",
        "buat live",
        "ringkasan kandungan",
      ],
      cs_action:
        "Siapkan ringkasan kandungan dan manfaat produk dengan bahasa yang mudah dipakai untuk live, promosi, atau edukasi agar dealing tetap terjaga dan repeat order terbuka.",
      suggested_reply:
        "Bisa kak. Nanti saya bantu minta ringkasan kandungan dan manfaat produknya dengan bahasa yang lebih mudah dipakai untuk live atau promosi, jadi kakak tidak jualan tanpa pegangan.",
      required_artifacts: ["ringkasan_kandungan", "manfaat_produk", "materi_live"],
      confidence_score: 84,
      conversion_rate_base: 78,
      base_score: 78,
      priority_numeric: 80,
      sop_signals: {
        educational_support: true,
        detected_topics: ["support", "kandungan", "manfaat"],
      },
    }),

    makeDatasetRow({
      id: "row_11_hot_at_risk_trust_anxiety",
      label: "Hot at-risk • Trust anxiety • Recovery • Post-decision",
      lead_level: "hot_at_risk",
      emotion: "trust_anxiety",
      intent: "recovery",
      behaviour_stage: "post_decision",
      pipeline: "prospek",
      priority: "urgent",
      prospect_type: "at_risk",
      sop_stage_current: "proof_before_pelunasan",
      sop_stage_next: "progress_produksi",
      customer_profile: "customer yang mulai ragu karena trauma scam dan butuh bukti konkret, bukan janji umum",
      patterns: [
        "amanah tidak kak",
        "soalnya saya pernah ketipu",
        "ini beneran tidak si kak",
        "saya semakin ragu",
        "takut ketipu",
        "amanah",
        "ragu",
        "beneran",
        "scam",
      ],
      cs_action:
        "Jangan pakai janji umum. Kirim proof konkret seperti status order real, rekening resmi PT, alamat, identitas perusahaan, dan foto real produk sesuai konteks order customer.",
      suggested_reply:
        "Paham kak. Biar kakak lebih tenang, saya kirim bukti yang konkret ya: status order kakak ada di tahap apa, foto real produk kakak, serta detail rekening dan identitas PT yang memang dipakai untuk order ini.",
      required_artifacts: ["status_real_order", "rekening_resmi", "identitas_pt", "foto_real_produk"],
      confidence_score: 90,
      conversion_rate_base: 74,
      base_score: 76,
      priority_numeric: 94,
      status_flags: {
        is_at_risk: true,
      },
      sop_signals: {
        trust_anxiety: true,
        should_upgrade_to_prospek: true,
        detected_topics: ["trust", "ragu", "scam"],
      },
    }),

    makeDatasetRow({
      id: "row_12_hot_at_risk_progress_anxiety",
      label: "Hot at-risk • Progress anxiety • Fulfillment • Post-purchase",
      lead_level: "hot_at_risk",
      emotion: "progress_anxiety",
      intent: "fulfillment",
      behaviour_stage: "post_purchase",
      pipeline: "prospek",
      priority: "urgent",
      prospect_type: "post_payment",
      sop_stage_current: "progress_produksi",
      sop_stage_next: "resi_pengiriman",
      customer_profile: "customer yang sudah bayar atau sudah order lalu mengejar status real-time, ETA, dan resi",
      patterns: [
        "kira kira kapan paketannya dikirim",
        "bagaimana perkembangan terkait pesanan saya",
        "saya tunggu ya kak",
        "kapan dikirim kak",
        "katanya setelah pelunasan bisa dikirim hari itu juga",
        "progress pesanan",
        "status order",
        "resi",
        "kapan kirim",
      ],
      cs_action:
        "Pindah ke mode status real-time: jelaskan posisi order, ETA perpindahan tahap, pelunasan bila relevan, dan resi jika sudah tersedia.",
      suggested_reply:
        "Baik kak, saya cek status real order kakak sekarang ya: posisi ada di tahap apa, estimasi pindah ke tahap berikutnya kapan, dan kalau sudah siap kirim saya kirim resi atau konfirmasi pengirimannya ke kakak.",
      required_artifacts: ["status_real_order", "eta_tahap_berikutnya", "resi_pengiriman"],
      confidence_score: 92,
      conversion_rate_base: 76,
      base_score: 78,
      priority_numeric: 95,
      status_flags: {
        is_post_payment: true,
        is_at_risk: true,
      },
      sop_signals: {
        progress_anxiety: true,
        should_upgrade_to_prospek: true,
        detected_topics: ["progress", "eta", "resi"],
      },
    }),

    makeDatasetRow({
      id: "row_13_hot_at_risk_proof_seeking",
      label: "Hot at-risk • Proof seeking • Trust/Recovery • Pre-pelunasan",
      lead_level: "hot_at_risk",
      emotion: "proof_seeking",
      intent: "trust_recovery",
      behaviour_stage: "pre_pelunasan",
      pipeline: "prospek",
      priority: "urgent",
      prospect_type: "at_risk",
      sop_stage_current: "proof_before_pelunasan",
      sop_stage_next: "resi_pengiriman",
      customer_profile: "customer yang meminta dokumentasi real order sebelum pelunasan agar rasa percaya naik",
      patterns: [
        "untuk pelunasan bisa tidak saya lihat dulu produk saya yang sudah siap kirim",
        "supaya kita bisa saling percaya",
        "bisa dilihat keseluruhan produknya",
        "saya minta video packingnya ya",
        "lihat dulu produk saya",
        "video packing",
        "sebelum pelunasan",
        "keseluruhan produk",
      ],
      cs_action:
        "Ini bukan objection harga, tapi objection trust. Jawaban terbaik adalah dokumentasi spesifik sesuai order customer: tampilan keseluruhan, detail item, dan video packing bila tersedia.",
      suggested_reply:
        "Boleh kak. Saya bantu kirim dokumentasi real untuk order kakak, mulai dari tampilan keseluruhan produk, detail item per item, sampai video packing supaya kakak bisa lebih yakin sebelum proses lanjut.",
      required_artifacts: ["proof_real_order", "video_packing", "detail_item_order"],
      confidence_score: 94,
      conversion_rate_base: 78,
      base_score: 80,
      priority_numeric: 96,
      status_flags: {
        is_at_risk: true,
      },
      sop_signals: {
        proof_seeking: true,
        should_upgrade_to_prospek: true,
        detected_topics: ["proof", "video_packing", "pelunasan"],
      },
    }),
  ].sort((a, b) => Number(b.priority_numeric || 0) - Number(a.priority_numeric || 0))
);

/* ---------------------------------
   Dataset rules for deterministic engine
---------------------------------- */
export const DATASET_RULES = Object.freeze(
  DATASET_ROWS.map((row) => makeDatasetRule(row)).sort(
    (a, b) => Number(b.priority || 0) - Number(a.priority || 0)
  )
);

/* ---------------------------------
   Helper exports
---------------------------------- */
export function getDefaultAnalysis() {
  return deepClone(DEFAULT_ANALYSIS);
}

export function getDatasetRowById(id) {
  const safeId = safeString(id);
  return DATASET_ROWS.find((item) => item.id === safeId) || null;
}

export function getDatasetRuleById(id) {
  const safeId = safeString(id);
  return DATASET_RULES.find((item) => item.id === safeId) || null;
}

export function getSopStageConfig(stage) {
  return SOP_STAGE_CONFIGS[normalizeSopStage(stage)] || null;
}

export function getRequiredArtifactsForStage(stage) {
  return cloneStringArray(
    SOP_STAGE_REQUIRED_ARTIFACTS[normalizeSopStage(stage)] || []
  );
}

export function getRequiredArtifactsForGap(gapKey) {
  return cloneStringArray(
    GAP_REQUIRED_ARTIFACTS[safeString(gapKey)] || []
  );
}

export function getRequiredArtifactsForPlan(actionCode) {
  return cloneStringArray(
    PLAN_REQUIRED_ARTIFACTS[safeString(actionCode)] || []
  );
}

export function getNoResponseFollowupByType(type) {
  const safeType = safeString(type);
  return (
    NO_RESPONSE_FOLLOWUP_SEQUENCE.find((item) => item.type === safeType) || null
  );
}

export function getNoResponseFollowupByStage(stage) {
  const safeStage = normalizeSopStage(stage);
  return (
    NO_RESPONSE_FOLLOWUP_SEQUENCE.find((item) => item.stage === safeStage) || null
  );
}

/**
 * @param {LooseRecord | null | undefined} input
 * @returns {LooseRecord}
 */
export function applyChannelOverride(input = {}) {
  const payload = toRecord(input);
  const channel = normalizeBrandChannel(payload.brand_channel || payload.channel);
  const override = CHANNEL_OVERRIDES[channel] || CHANNEL_OVERRIDES.unknown;

  const csAction = [
    safeString(override.prepend_cs_action),
    safeString(payload.cs_action),
    safeString(override.append_cs_action),
  ]
    .filter(Boolean)
    .join("");

  const suggestedReply = [
    safeString(override.prepend_suggested_reply),
    safeString(payload.suggested_reply || payload.suggested_response),
    safeString(override.append_suggested_reply),
  ]
    .filter(Boolean)
    .join("");

  const requiredArtifacts = uniqueStrings([
    ...cloneStringArray(payload.required_artifacts || []),
    ...cloneStringArray(override.extra_required_artifacts || []),
  ]);

  return {
    ...payload,
    brand_channel: channel,
    cs_action: csAction || safeString(payload.cs_action),
    suggested_reply:
      suggestedReply ||
      safeString(payload.suggested_reply || payload.suggested_response),
    suggested_response:
      suggestedReply ||
      safeString(payload.suggested_reply || payload.suggested_response),
    required_artifacts: requiredArtifacts,
  };
}

/* ---------------------------------
   Taxonomy normalization API
---------------------------------- */
export function normalizeLeadLevelStage(value) {
  return normalizeEnumValue(
    value,
    LEAD_LEVEL_ALIASES,
    LEAD_LEVELS,
    DEFAULT_LEAD_LEVEL
  );
}

export function normalizeLeadLevel(value) {
  return normalizeLeadLevelStage(value);
}

export function normalizeEmotion(value) {
  return normalizeEnumValue(
    value,
    EMOTION_ALIASES,
    EMOTIONS,
    DEFAULT_EMOTION
  );
}

export function normalizeIntent(value) {
  return normalizeEnumValue(
    value,
    INTENT_ALIASES,
    INTENTS,
    DEFAULT_INTENT
  );
}

export function normalizeBehaviourStage(value) {
  return normalizeEnumValue(
    value,
    BEHAVIOUR_STAGE_ALIASES,
    BEHAVIOUR_STAGES,
    DEFAULT_BEHAVIOUR_STAGE
  );
}

export function normalizePipeline(value) {
  return normalizeEnumValue(
    value,
    PIPELINE_ALIASES,
    PIPELINES,
    DEFAULT_PIPELINE
  );
}

export function normalizePriorityLevel(value) {
  return normalizeEnumValue(
    value,
    PRIORITY_ALIASES,
    PRIORITY_LEVELS,
    DEFAULT_PRIORITY
  );
}

export function normalizeProspectType(value) {
  return normalizeEnumValue(
    value,
    PROSPECT_TYPE_ALIASES,
    PROSPECT_TYPES,
    DEFAULT_PROSPECT_TYPE
  );
}

export function normalizeSopStage(value) {
  return normalizeEnumValue(
    value,
    SOP_STAGE_ALIASES,
    SOP_STAGES,
    DEFAULT_SOP_STAGE_CURRENT
  );
}

export function normalizeBrandChannel(value) {
  return normalizeEnumValue(
    value,
    BRAND_CHANNEL_ALIASES,
    BRAND_CHANNELS,
    DEFAULT_BRAND_CHANNEL
  );
}

/**
 * @param {LooseRecord | null | undefined} analysis
 * @returns {LooseRecord}
 */
export function normalizeAnalysisTaxonomy(analysis = {}) {
  const src = toRecord(analysis);

  const leadLevel = normalizeLeadLevelStage(
    src.lead_level || src.lead_level_stage
  );
  const emotion = normalizeEmotion(src.emotion);
  const intent = normalizeIntent(src.intent);
  const behaviourStage = normalizeBehaviourStage(
    src.behaviour_stage || src.behavior_stage
  );
  const pipeline = normalizePipeline(src.pipeline);
  const priority = normalizePriorityLevel(src.priority || src.priority_level);
  const prospectType = normalizeProspectType(src.prospect_type);
  const sopStageCurrent = normalizeSopStage(src.sop_stage_current);
  const sopStageNext = normalizeSopStage(
    src.sop_stage_next ||
      getSopStageConfig(sopStageCurrent)?.next_stage ||
      DEFAULT_SOP_STAGE_NEXT
  );
  const brandChannel = normalizeBrandChannel(src.brand_channel);
  const suggestedReply = safeString(
    src.suggested_reply ||
      src.suggested_response ||
      DEFAULT_ANALYSIS.suggested_reply
  );

  return {
    ...src,
    pipeline,
    lead_level: leadLevel,
    lead_level_stage: leadLevel,
    emotion,
    intent,
    behaviour_stage: behaviourStage,
    priority,
    priority_level: priority,
    prospect_type: prospectType,
    sop_stage_current: sopStageCurrent,
    sop_stage_next: sopStageNext,
    brand_channel: brandChannel,
    suggested_reply: suggestedReply,
    suggested_response: suggestedReply,
    tag_emotion: normalizeTag(
      safeString(src.tag_emotion || emotion || DEFAULT_EMOTION)
    ),
    tag_stage: normalizeTag(
      safeString(src.tag_stage || behaviourStage || DEFAULT_BEHAVIOUR_STAGE)
    ),
  };
}

export function isValidLeadLevel(value) {
  return LEAD_LEVELS.includes(normalizeLeadLevelStage(value));
}

export function isValidEmotion(value) {
  return EMOTIONS.includes(normalizeEmotion(value));
}

export function isValidIntent(value) {
  return INTENTS.includes(normalizeIntent(value));
}

export function isValidBehaviourStage(value) {
  return BEHAVIOUR_STAGES.includes(normalizeBehaviourStage(value));
}

export function isValidPipeline(value) {
  return PIPELINES.includes(normalizePipeline(value));
}

export function isValidPriority(value) {
  return PRIORITY_LEVELS.includes(normalizePriorityLevel(value));
}

export function isValidProspectType(value) {
  return PROSPECT_TYPES.includes(normalizeProspectType(value));
}

export function isValidSopStage(value) {
  return SOP_STAGES.includes(normalizeSopStage(value));
}

/* ---------------------------------
   Internal builders
---------------------------------- */
/**
 * @param {LooseRecord | null | undefined} input
 * @returns {Readonly<LooseRecord>}
 */
function makeDatasetRow(input = {}) {
  const src = toRecord(input);

  const leadLevel = normalizeLeadLevelStage(src.lead_level);
  const emotion = normalizeEmotion(src.emotion);
  const intent = normalizeIntent(src.intent);
  const behaviourStage = normalizeBehaviourStage(src.behaviour_stage);
  const pipeline = normalizePipeline(src.pipeline);
  const priority = normalizePriorityLevel(src.priority);
  const prospectType = normalizeProspectType(src.prospect_type);
  const sopStageCurrent = normalizeSopStage(src.sop_stage_current);
  const sopStageNext = normalizeSopStage(
    src.sop_stage_next ||
      getSopStageConfig(sopStageCurrent)?.next_stage ||
      DEFAULT_SOP_STAGE_NEXT
  );

  const suggestedReply = safeString(src.suggested_reply);
  const priorityNumeric = Number.isFinite(src.priority_numeric)
    ? Number(src.priority_numeric)
    : PRIORITY_TO_NUMERIC[priority] || PRIORITY_TO_NUMERIC.medium;

  const requiredArtifacts = uniqueStrings([
    ...cloneStringArray(src.required_artifacts),
    ...getRequiredArtifactsForStage(sopStageCurrent),
  ]);

  return Object.freeze({
    id: safeString(src.id),
    label: safeString(src.label || src.id),
    lead_level: leadLevel,
    lead_level_stage: leadLevel,
    emotion,
    intent,
    behaviour_stage: behaviourStage,
    pipeline,
    priority,
    priority_level: priority,
    priority_numeric: priorityNumeric,
    prospect_type: prospectType,
    sop_stage_current: sopStageCurrent,
    sop_stage_next: sopStageNext,
    customer_profile: safeString(src.customer_profile),
    patterns: uniqueStrings(
      cloneStringArray(src.patterns).map(normalizeDatasetText).filter(Boolean)
    ),
    negative_patterns: uniqueStrings(
      cloneStringArray(src.negative_patterns).map(normalizeDatasetText).filter(Boolean)
    ),
    cs_action: safeString(src.cs_action),
    suggested_reply: suggestedReply,
    suggested_response: suggestedReply,
    required_artifacts: requiredArtifacts,
    confidence_score: normalizePercent(src.confidence_score, 20),
    base_score:
      normalizePercent(src.base_score, LEAD_LEVEL_TO_BASE_SCORE[leadLevel] || 40),
    conversion_rate_base:
      normalizePercent(
        src.conversion_rate_base,
        LEAD_LEVEL_TO_CONVERSION[leadLevel] || 20
      ),
    status_flags: deepMergeState(EMPTY_STATUS_FLAGS, src.status_flags),
    sop_signals: deepMergeState(EMPTY_SOP_SIGNALS, src.sop_signals),
  });
}

/**
 * @param {LooseRecord | null | undefined} row
 * @returns {Readonly<LooseRecord>}
 */
function makeDatasetRule(row) {
  const src = toRecord(row);

  return Object.freeze({
    id: src.id,
    rule_id: src.id,
    dataset_row_id: src.id,
    dataset_row_label: src.label,
    lead_level_stage: src.lead_level,
    emotion: src.emotion,
    intent: src.intent,
    behaviour_stage: src.behaviour_stage,
    pipeline: src.pipeline,
    priority_level: src.priority,
    prospect_type: src.prospect_type,
    sop_stage_current: src.sop_stage_current,
    sop_stage_next: src.sop_stage_next,
    customer_profile: src.customer_profile,
    patterns: cloneStringArray(src.patterns),
    negative_patterns: cloneStringArray(src.negative_patterns),
    priority: src.priority_numeric,
    base_score: src.base_score,
    conversion_rate_base: src.conversion_rate_base,
    cs_action: src.cs_action,
    suggested_response: src.suggested_reply,
    suggested_reply: src.suggested_reply,
    required_artifacts: cloneStringArray(src.required_artifacts),
    confidence_score: src.confidence_score,
    status_flags: deepClone(src.status_flags),
    sop_signals: deepClone(src.sop_signals),
    rule_source: "dataset",
  });
}

/* ---------------------------------
   Utility helpers
---------------------------------- */
function normalizePercent(value, fallback = 20) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeEnumValue(value, aliases, validValues, fallback) {
  const token = normalizeKey(value);
  if (!token) return fallback;
  const resolved = aliases[token] || token;
  return validValues.includes(resolved) ? resolved : fallback;
}

function normalizeKey(value) {
  return safeString(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s_./-]/gu, " ")
    .replace(/[./-]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();
}

function normalizeTag(value) {
  return normalizeKey(value).slice(0, 80) || "unknown";
}

function safeString(value) {
  return String(value || "").trim();
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

function cloneStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => safeString(item)).filter(Boolean)
    : [];
}

function uniqueStrings(value) {
  return [...new Set(cloneStringArray(value))];
}

function deepClone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item));
  }

  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = deepClone(item);
    }
    return out;
  }

  return value;
}

function deepMergeState(base, extra) {
  const left = toRecord(base);
  const right = toRecord(extra);
  const out = deepClone(left);

  for (const [key, value] of Object.entries(right)) {
    if (Array.isArray(value)) {
      out[key] = uniqueStrings(value);
      continue;
    }

    if (value && typeof value === "object") {
      out[key] = deepMergeState(out[key], value);
      continue;
    }

    out[key] = value;
  }

  return out;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}