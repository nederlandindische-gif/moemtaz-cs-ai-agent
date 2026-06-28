// generate_ai_backup/fallback_two/fallback_two.js

import {
  DEFAULT_ANALYSIS,
  normalizeBehaviourStage as normalizeRuleBehaviourStage,
  normalizeDatasetText,
  normalizeEmotion as normalizeRuleEmotion,
  normalizeIntent as normalizeRuleIntent,
  normalizeLeadLevelStage as normalizeRuleLeadLevelStage,
} from "../../dataset_engine/rules.js";
import {
  normalizeLocalEmotionToAnalysis as normalizeRuntimeEmotion,
} from "../../utils/emotion.js";

const SCORE_LIMITS = Object.freeze({
  MIN: 5,
  MAX: 98,
  COLD_MAX: 42,
  WARM_MAX: 68,
  HOT_MAX: 84,
});

const AGGRESSIVE_TEXT_REPLACEMENTS = Object.freeze([
  ["berp", "berapa"],
  ["brapa", "berapa"],
  ["berap", "berapa"],
  ["blm", "belum"],
  ["belom", "belum"],
  ["dp nya", "dp"],
  ["dpnya", "dp"],
  ["bpom nya", "bpom"],
  ["bpomnya", "bpom"],
  ["refundnya", "refund"],
  ["solusinya", "solusi"],
  ["carinya", "cari"],
  ["ngedempul", "dempul"],
  ["ngga", "tidak"],
  ["nggak", "tidak"],
  ["gak", "tidak"],
  ["ga", "tidak"],
  ["sampel", "sample"],
  ["samplenya", "sample"],
  ["pricelist", "price list"],
  ["mau dp", "siap dp"],
]);

const NORMALIZED_TEXT_REPLACEMENTS = Object.freeze(
  AGGRESSIVE_TEXT_REPLACEMENTS.map(([from, to]) => ({
    regex: new RegExp(`\\b${escapeRegExp(normalizeDatasetText(from))}\\b`, "g"),
    to: normalizeDatasetText(to),
  }))
);

const QTY_REGEX = /\b(\d{1,5})\s*(pcs|botol|unit|pak|dus|set|box)\b/g;
const MONEY_REGEX = /\b\d+\s*(juta|ribu|jt|rb|k)\b/g;

const SIGNAL_GROUPS = compilePatternGroups({
  existingCustomer: [
    "reorder",
    "repeat order",
    "restock",
    "order lagi",
    "order ulang",
    "tambah order",
    "batch berikutnya",
    "customer lama",
    "pelanggan lama",
  ],
  postDecision: [
    "sudah order",
    "sudah transfer",
    "sudah bayar",
    "barang sampai",
    "resi",
    "pengiriman",
    "batch sebelumnya",
  ],
  complaint: [
    "komplain",
    "keluhan",
    "produk bermasalah",
    "rusak",
    "bocor",
    "cacat",
    "tidak sesuai",
    "warna berubah",
    "aroma berubah",
    "tekstur berubah",
  ],
  safetyConcern: [
    "iritasi",
    "bruntusan",
    "breakout",
    "gatal",
    "perih",
    "reaksi kulit",
    "tidak aman",
  ],
  refundConcern: [
    "refund",
    "retur",
    "pengembalian dana",
    "uang kembali",
    "kompensasi",
  ],
  paymentDelay: [
    "belum cair",
    "pending bayar",
    "bayar nanti",
    "dp nanti",
    "belum bisa bayar",
    "menunggu dana",
    "payment delay",
  ],
  lifeEventDelay: [
    "meninggal",
    "berduka",
    "musibah",
    "sakit",
    "rawat inap",
    "urusan keluarga",
  ],
  visualValidation: [
    "foto produk",
    "lihat hasil",
    "before after",
    "contoh kemasan",
    "video produk",
    "real pict",
    "foto asli",
    "lihat kemasan",
  ],
  legality: [
    "bpom",
    "legalitas",
    "izin",
    "sertifikat",
    "halal",
    "legal",
    "terdaftar",
  ],
  sampleCuriosity: [
    "sample",
    "tester",
    "uji sample",
    "minta sample",
    "sample dulu",
    "lihat sample",
  ],
  samplePurchaseIntent: [
    "order sample",
    "beli sample",
    "kirim sample",
    "lanjut sample",
    "invoice sample",
    "sample berbayar",
  ],
  technicalCuriosity: [
    "komposisi",
    "kandungan",
    "bahan aktif",
    "formula",
    "tekstur",
    "ph",
    "stabilitas",
    "spesifikasi formula",
  ],
  formulaCompatibility: [
    "cocok",
    "kompatibel",
    "kulit sensitif",
    "bisa digabung",
    "aman dipakai harian",
    "dempul",
    "lengket",
    "berat di muka",
  ],
  competitorAwareness: [
    "kompetitor",
    "brand lain",
    "merek lain",
    "dibanding",
    "saingan produk",
  ],
  marketingExpectation: [
    "target market",
    "produk yang laku",
    "marketing",
    "positioning",
    "branding premium",
    "produk viral",
    "gampang dijual",
  ],
  productionCuriosity: [
    "produksi",
    "proses produksi",
    "alur produksi",
    "workflow",
    "pabrik",
    "prosedur",
    "tahapan maklon",
  ],
  profitCalculation: [
    "margin",
    "profit",
    "keuntungan",
    "hpp",
    "roi",
    "balik modal",
    "harga jual",
    "omzet",
  ],
  negotiation: [
    "negosiasi",
    "nego",
    "diskon",
    "lebih murah",
    "harga terbaik",
    "best price",
    "bisa kurang",
  ],
  pricing: [
    "harga",
    "biaya",
    "budget",
    "modal",
    "price list",
    "paket harga",
    "3 juta",
    "2 juta",
    "1 juta",
    "kisaran harga",
  ],
  readyDP: [
    "siap dp",
    "transfer dp",
    "langsung bayar",
    "kirim invoice",
    "lanjut pembayaran",
    "siap transfer",
  ],
  orderReadiness: [
    "mau lanjut",
    "siap order",
    "deal",
    "oke lanjut",
    "cara order",
    "step order",
    "mau proses",
    "lanjut order",
  ],
  timeline: [
    "urgent",
    "segera",
    "cepat",
    "hari ini",
    "kapan bisa jadi",
    "berapa lama",
    "timeline",
    "estimasi",
    "target launch",
  ],
  customization: [
    "custom",
    "request warna",
    "request kemasan",
    "kemasan elegan",
    "desain kemasan",
    "formula sendiri",
    "aroma sendiri",
  ],
  brand: [
    "brand sendiri",
    "bikin brand",
    "buat brand",
    "merek sendiri",
    "private label",
  ],
  product: [
    "sabun",
    "serum",
    "lotion",
    "krim",
    "cream",
    "night cream",
    "day cream",
    "facial wash",
    "body lotion",
    "skincare",
  ],
  productList: [
    "produk apa aja",
    "produk apa saja",
    "list produk",
    "daftar produk",
    "jual apa aja",
    "jual apa saja",
  ],
  reseller: [
    "reseller",
    "keuntungan reseller",
    "margin reseller",
    "join reseller",
    "mau jualan",
    "usaha skincare",
  ],
  busyDelay: [
    "masih sibuk",
    "tunda dulu",
    "pikir dulu",
    "belum sempat",
    "cek lagi nanti",
    "diskusi dulu",
  ],
  futureIntention: [
    "nanti dulu",
    "bulan depan",
    "masih planning",
    "masih persiapan",
    "kalau sudah siap",
    "baru planning",
  ],
  confusion: [
    "kok",
    "bingung",
    "tidak paham",
    "gimana",
    "maksudnya",
    "jadi solusinya",
    "jawabannya gimana",
  ],
  positive: [
    "oke",
    "siap",
    "mantap",
    "bagus",
    "menarik",
    "cocok",
    "setuju",
  ],
});

const DEFAULT_SUGGESTION_RULES = compileReplyRules([
  {
    patterns: ["komplain", "keluhan", "produk bermasalah", "bocor", "rusak", "tidak sesuai"],
    replies: [
      "baik kak aku bantu follow up ya, boleh info detail kendalanya dan kalau ada foto produknya sekalian ya",
      "siap kak aku bantu cek ya, boleh cerita detail masalah produknya apa dan sejak kapan kejadian",
      "baik kak, aku bantu tindak lanjuti ya, boleh kirim detail keluhannya biar aku catat dengan tepat",
    ],
  },
  {
    patterns: ["iritasi", "bruntusan", "gatal", "perih", "breakout", "reaksi kulit"],
    replies: [
      "baik kak aku bantu catat dulu ya, produk yang dipakai apa dan reaksinya seperti apa",
      "siap kak, boleh info detail reaksinya ya biar aku bantu arahkan penanganan yang aman",
      "baik kak, aku bantu follow up ya, boleh ceritain keluhannya dan kalau ada foto kondisi kulitnya sekalian",
    ],
  },
  {
    patterns: ["refund", "retur", "pengembalian dana", "uang kembali"],
    replies: [
      "baik kak aku bantu cek dulu kronologinya ya biar bisa diarahkan ke tindak lanjut yang tepat",
      "siap kak, boleh info detail kendalanya dan status pesanan atau pembayarannya dulu ya",
      "baik kak, aku bantu follow up refund concern-nya ya, boleh ceritain urutannya dulu",
    ],
  },
  {
    patterns: ["reorder", "repeat order", "restock", "order lagi", "tambah order"],
    replies: [
      "siap kak, kalau mau reorder atau tambah quantity nanti aku bantu cek alurnya biar lebih cepat ya",
      "boleh kak, aku bantu cek kebutuhan reorder-nya ya, mau quantity yang sama atau ada perubahan",
      "siap kak, buat order ulang nanti kita cek quantity sama detail yang mau dilanjutkan ya",
    ],
  },
  {
    patterns: ["siap dp", "transfer dp", "langsung bayar", "kirim invoice", "lanjut pembayaran"],
    replies: [
      "siap kak, kalau mau lanjut pembayaran nanti aku bantu arahkan ke step terdekatnya ya",
      "oke kak, kalau udah siap dp kita bisa langsung rapikan detail produk dan proses berikutnya ya",
      "siap kak, aku bantu urutin dari detail produk sampai langkah pembayarannya ya",
    ],
  },
  {
    patterns: ["belum cair", "pending bayar", "bayar nanti", "dp nanti", "belum bisa bayar"],
    replies: [
      "baik kak tidak apa apa, nanti aku bantu rangkum dulu poin pentingnya biar pas dananya siap bisa lanjut lagi",
      "siap kak, kalau masih pending pembayaran juga gapapa, nanti kita lanjut pas timing-nya lebih enak ya",
      "baik kak, aku bantu simpulkan dulu kebutuhannya ya biar nanti gampang dilanjutkan lagi",
    ],
  },
  {
    patterns: ["foto produk", "lihat hasil", "before after", "contoh kemasan", "real pict", "video produk"],
    replies: [
      "bisa kak nanti aku bantu share contoh visual atau kemasan yang relevan biar kakak lebih kebayang ya",
      "boleh kak, nanti aku bantu arahkan ke contoh hasil atau kemasan yang paling sesuai sama kebutuhan kakak",
      "siap kak, kita bisa mulai dari contoh visual dulu biar kakak lebih mantap lihat arahnya",
    ],
  },
  {
    patterns: ["sample", "tester", "uji sample", "minta sample", "order sample", "beli sample"],
    replies: [
      "bisa kak, biasanya kita mulai dari sample dulu biar kakak bisa cek hasilnya sebelum lanjut produksi",
      "siap kak, kalau mau sample nanti aku bantu jelasin alurnya ya dari sample sampai langkah berikutnya",
      "boleh kak, kita bisa mulai dari sample dulu terus nanti dievaluasi sebelum lanjut produksi",
    ],
  },
  {
    patterns: ["komposisi", "kandungan", "bahan aktif", "formula", "tekstur", "ph", "stabilitas"],
    replies: [
      "siap kak, untuk detail teknis formula nanti disesuaikan sama tujuan produk ya, kakak pengennya fokus manfaat apa",
      "boleh kak, nanti aku bantu jelasin dari sisi formula atau spesifikasi yang paling relevan buat kebutuhan kakak",
      "bisa kak, kita cek dari sisi formula dan target produknya dulu biar penjelasannya pas",
    ],
  },
  {
    patterns: ["cocok", "kompatibel", "kulit sensitif", "dempul", "lengket", "berat di muka"],
    replies: [
      "baik kak, untuk kecocokan formula nanti perlu disesuaikan sama target kulit dan fungsi produknya ya",
      "boleh kak, kita cek dulu kebutuhan formula dan target pemakaiannya biar lebih pas",
      "siap kak, nanti aku bantu arahkan formula yang lebih sesuai sama preferensi hasil yang kakak mau",
    ],
  },
  {
    patterns: ["margin", "profit", "keuntungan", "hpp", "roi", "balik modal"],
    replies: [
      "bisa kak, nanti kita hitung gambaran modal harga jual dan potensi untungnya sesuai produk yang kakak incar ya",
      "siap kak, aku bantu arahkan dari sisi modal, harga jual, dan margin biar lebih kebayang",
      "boleh kak, kita cek dulu produknya terus aku bantu kasih gambaran hitung untungnya ya",
    ],
  },
  {
    patterns: ["target market", "produk yang laku", "marketing", "positioning", "branding premium"],
    replies: [
      "boleh kak, nanti kita arahkan ke produk yang paling cocok sama target market dan gaya jualan kakak ya",
      "siap kak, aku bantu bahas dari sisi target market dan positioning biar produknya lebih pas",
      "bisa kak, nanti kita cek kategori produk yang paling potensial buat arah market kakak",
    ],
  },
  {
    patterns: ["produksi", "proses produksi", "pabrik", "alur produksi", "workflow"],
    replies: [
      "siap kak, aku jelasin alurnya dari awal sampai jadi ya biar kakak lebih kebayang step produksinya",
      "boleh kak, nanti aku bantu urutin proses produksi yang paling relevan buat kebutuhan kakak",
      "bisa kak, kita bahas dulu alur produksinya biar lebih jelas dari tahap awal sampai jadi",
    ],
  },
  {
    patterns: ["bpom", "legalitas", "izin", "sertifikat", "legal"],
    replies: [
      "untuk legalitas bisa dibantu kak, nanti aku jelasin juga soal bpom dan alurnya biar lebih jelas",
      "boleh kak, nanti aku bantu arahkan jalur legalitas yang sesuai sama jenis produk kakak",
      "aman kak, nanti aku bantu jelasin proses legalitas dan alurnya juga",
    ],
  },
  {
    patterns: ["harga", "biaya", "budget", "modal", "3 juta", "2 juta"],
    replies: [
      "untuk harga biasanya ngikut jenis produk quantity dan detail kebutuhan kak, kakak lagi kepikiran produk apa dulu",
      "boleh kak aku bantu cek arahnya ya, kakak lagi fokus ke produk apa dan target budget berapa",
      "siap kak, biar lebih pas nanti aku arahkan dari jenis produk sama kisaran kebutuhannya ya",
    ],
  },
  {
    patterns: ["mau lanjut", "siap order", "deal", "oke lanjut", "cara order", "step order"],
    replies: [
      "siap kak kita bisa lanjut ke step berikutnya ya, aku bantu urutin dari produk yang dipilih sampai proses ordernya",
      "oke kak nanti aku bantu dari penentuan produk sampai alur ordernya",
      "siap kak, biar enak aku jelasin urutan proses order yang paling pas buat kebutuhan kakak",
    ],
  },
  {
    patterns: ["kok", "jawaban", "gitu", "bingung", "tidak paham", "gimana", "maksudnya"],
    replies: [
      "siap kak aku jelasin yang lebih simpel ya, kakak paling pengen tahu bagian produk harga legalitas atau alurnya dulu",
      "tenang kak nanti aku bantu urutin pelan pelan dari bagian yang paling penting dulu",
      "biar lebih jelas kak, kakak paling pengen tahu bagian produk harga legalitas sample atau alurnya dulu",
    ],
  },
  {
    patterns: ["mau buat", "brand sendiri", "maklon", "produksi", "pabrik"],
    replies: [
      "siap kak, kakak mau bikin produk apa dulu buat brandnya",
      "boleh kak aku bantu arahin, pengennya fokus ke kategori produk yang mana dulu",
      "oke kak nanti kita cocokin dulu produk yang paling pas buat kebutuhan brand kakak",
    ],
  },
]);

const EMOTION_FALLBACK_RULES = compileEmotionRules([
  { emotion: "product_complaint", patterns: ["komplain", "keluhan", "produk bermasalah", "rusak", "bocor", "tidak sesuai"] },
  { emotion: "product_safety_concern", patterns: ["iritasi", "bruntusan", "breakout", "gatal", "perih", "reaksi kulit"] },
  { emotion: "trust_seeking", patterns: ["refund", "retur", "pengembalian dana", "uang kembali"] },
  { emotion: "busy_delay", patterns: ["belum cair", "pending bayar", "bayar nanti", "dp nanti", "masih sibuk", "tunda dulu"] },
  { emotion: "visual_validation", patterns: ["foto produk", "lihat hasil", "before after", "contoh kemasan", "video produk", "real pict"] },
  { emotion: "technical_curiosity", patterns: ["komposisi", "kandungan", "bahan aktif", "formula", "tekstur", "ph", "stabilitas"] },
  { emotion: "formula_compatibility", patterns: ["cocok", "kompatibel", "kulit sensitif", "dempul", "lengket"] },
  { emotion: "profit_calculation", patterns: ["margin", "profit", "keuntungan", "hpp", "roi", "balik modal"] },
  { emotion: "marketing_expectation", patterns: ["target market", "produk yang laku", "marketing", "positioning"] },
  { emotion: "excitement", patterns: ["mau lanjut", "siap order", "deal", "siap dp", "transfer dp"] },
  { emotion: "trust_seeking", patterns: ["bpom", "legalitas", "izin", "sertifikat", "aman tidak"] },
  { emotion: "sample_evaluation", patterns: ["sample", "tester", "uji sample", "minta sample", "order sample"] },
  { emotion: "competitor_awareness", patterns: ["kompetitor", "brand lain", "merek lain", "dibanding"] },
  { emotion: "business_planning", patterns: ["brand sendiri", "private label", "mau bikin brand", "target market"] },
  { emotion: "business_motivation", patterns: ["reseller", "mau jualan", "usaha skincare"] },
  { emotion: "curiosity", patterns: ["kok", "kenapa", "bingung", "tidak paham", "gimana", "maksudnya"] },
  { emotion: "interest", patterns: ["produk apa", "harga", "sample", "legalitas", "mau bikin"] },
]);

const DEFAULT_FALLBACK_SUGGESTIONS = Object.freeze([
  "boleh kak aku bantu, kakak lagi cari info produk legalitas sample atau mau bikin brand sendiri dulu",
  "siap kak, biar aku arahin yang pas, kakak lagi fokus ke produk harga legalitas sample atau prosesnya dulu",
  "oke kak, ceritain dulu kebutuhan utamanya ya biar aku bantu jelasin yang paling relevan",
]);

export function fallbackTwoGenerate(ctx) {
  const latestCustomerText = String(ctx?.latestCustomerText || "");
  const tail = String(ctx?.tail || "");
  const summary = String(ctx?.summary || "");

  const base = buildBaseAnalysis(ctx);
  const signals = collectSignals({
    latestCustomerText,
    tail,
    summary,
  });

  const intent = deriveIntent(base.intent, signals);
  const emotion = deriveEmotion(base.emotion, signals, latestCustomerText);
  const behaviourStage = deriveBehaviourStage(base.behaviour_stage, signals);

  const conversionRate = deriveConversionRate(base.conversion_rate_analyzed, signals);
  const leadLevelStage = deriveLeadLevelStage(base.lead_level_stage, conversionRate, signals);
  const confidenceScore = deriveConfidenceScore(base.confidence_score, signals);

  const csAction = deriveCsAction(intent, behaviourStage, signals, base.cs_action);
  const suggestedResponse = deriveSuggestedResponse(
    intent,
    behaviourStage,
    signals,
    latestCustomerText,
    base.suggested_response
  );

  return {
    ok: true,
    value: {
      rule_id: safeText(base.rule_id || "fallback_two_local_heuristic", 80),
      intent,
      emotion,
      behaviour_stage: behaviourStage,
      lead_level_stage: leadLevelStage,
      conversion_rate_analyzed: conversionRate,
      cs_action: csAction,
      suggested_response: suggestedResponse,
      confidence_score: confidenceScore,
      matched_patterns: mergeMatchedPatterns(base.matched_patterns, signals),
      matched_in: mergeMatchedIn(base.matched_in, signals),
      rule_source: "local_heuristic",
      source: "fallback_two",
    },
  };
}

/* ---------------------------------
   Public helpers kept for compatibility
---------------------------------- */

export function defaultSuggestions(latestCustomerText) {
  const text = normalizeText(latestCustomerText);

  for (const rule of DEFAULT_SUGGESTION_RULES) {
    if (includesAnyNormalized(text, rule.patterns)) {
      return rule.replies.slice(0, 3);
    }
  }

  return DEFAULT_FALLBACK_SUGGESTIONS.slice(0, 3);
}

export function inferEmotionsFallback(text) {
  const normalized = normalizeText(text || "");
  const out = [];

  for (const rule of EMOTION_FALLBACK_RULES) {
    if (includesAnyNormalized(normalized, rule.patterns)) {
      out.push(rule.emotion);
    }
  }

  if (!out.length && normalized.trim()) {
    out.push("curiosity");
  }

  return uniqueStrings(out).slice(0, 3);
}

/* ---------------------------------
   Core heuristic analysis
---------------------------------- */

function buildBaseAnalysis(ctx) {
  const scored =
    ctx?.scoredAnalysis && typeof ctx.scoredAnalysis === "object"
      ? ctx.scoredAnalysis
      : null;

  const dataset =
    ctx?.datasetBase && typeof ctx.datasetBase === "object"
      ? ctx.datasetBase
      : null;

  const base = {
    ...(dataset || {}),
    ...(scored || {}),
  };

  return {
    rule_id: safeText(base?.rule_id || "fallback_two_base", 80),
    intent: normalizeIntent(base?.intent) || DEFAULT_ANALYSIS.intent,
    emotion:
      normalizeEmotion(base?.emotion) ||
      normalizeLocalEmotionToAnalysisSafe(ctx?.latestCustomerText || ""),
    behaviour_stage:
      normalizeBehaviourStage(base?.behaviour_stage) ||
      DEFAULT_ANALYSIS.behaviour_stage,
    lead_level_stage:
      normalizeLeadLevel(base?.lead_level_stage) ||
      DEFAULT_ANALYSIS.lead_level_stage,
    conversion_rate_analyzed: clampNumber(
      Number(base?.conversion_rate_analyzed || DEFAULT_ANALYSIS.conversion_rate_analyzed),
      0,
      100
    ),
    cs_action: safeText(
      base?.cs_action ||
        "Tanyakan kebutuhan utama customer lalu arahkan ke produk, harga, legalitas, sample, atau proses yang relevan.",
      1000
    ),
    suggested_response: safeText(
      base?.suggested_response || defaultSuggestions(ctx?.latestCustomerText || "")[0] || "",
      220
    ),
    confidence_score: clampNumber(
      Number(base?.confidence_score || 58),
      20,
      98
    ),
    matched_patterns: Array.isArray(base?.matched_patterns) ? base.matched_patterns : [],
    matched_in:
      base?.matched_in && typeof base.matched_in === "object"
        ? {
            latest: toStringArray(base.matched_in.latest),
            tail: toStringArray(base.matched_in.tail),
            summary: toStringArray(base.matched_in.summary),
          }
        : {
            latest: [],
            tail: [],
            summary: [],
          },
  };
}

function collectSignals(input) {
  const latest = normalizeText(input?.latestCustomerText || "");
  const tail = normalizeText(input?.tail || "");
  const summary = normalizeText(input?.summary || "");
  const combined = [latest, tail, summary].filter(Boolean).join(" ").trim();

  const matchedPatterns = [];
  const matchedIn = {
    latest: [],
    tail: [],
    summary: [],
  };

  /** @type {Record<string, boolean>} */
  const flags = {};

  for (const [groupName, patterns] of Object.entries(SIGNAL_GROUPS)) {
    const latestHits = collectMatchedPatterns(latest, patterns);
    const tailHits = collectMatchedPatterns(tail, patterns);
    const summaryHits = collectMatchedPatterns(summary, patterns);
    const combinedHits = collectMatchedPatterns(combined, patterns);

    if (latestHits.length > 0) matchedIn.latest.push(...latestHits);
    if (tailHits.length > 0) matchedIn.tail.push(...tailHits);
    if (summaryHits.length > 0) matchedIn.summary.push(...summaryHits);
    if (combinedHits.length > 0) matchedPatterns.push(...combinedHits);

    flags[groupName] = combinedHits.length > 0;
  }

  const qtyMentionCount = countQtyMentions(combined);
  const moneyMentionCount = countMoneyMentions(combined);

  if (qtyMentionCount > 0) matchedPatterns.push("qty_mention");
  if (moneyMentionCount > 0) matchedPatterns.push("money_mention");

  const signals = {
    latest,
    tail,
    summary,
    combined,

    hasExistingCustomer: Boolean(flags.existingCustomer),
    hasPostDecision: Boolean(flags.postDecision),
    hasComplaint: Boolean(flags.complaint),
    hasSafetyConcern: Boolean(flags.safetyConcern),
    hasRefundConcern: Boolean(flags.refundConcern),
    hasPaymentDelay: Boolean(flags.paymentDelay),
    hasLifeEventDelay: Boolean(flags.lifeEventDelay),
    hasVisualValidation: Boolean(flags.visualValidation),
    hasLegality: Boolean(flags.legality),
    hasSampleCuriosity: Boolean(flags.sampleCuriosity),
    hasSamplePurchaseIntent: Boolean(flags.samplePurchaseIntent),
    hasTechnicalCuriosity: Boolean(flags.technicalCuriosity),
    hasFormulaCompatibility: Boolean(flags.formulaCompatibility),
    hasCompetitorAwareness: Boolean(flags.competitorAwareness),
    hasMarketingExpectation: Boolean(flags.marketingExpectation),
    hasProductionCuriosity: Boolean(flags.productionCuriosity),
    hasProfitCalculation: Boolean(flags.profitCalculation),
    hasNegotiation: Boolean(flags.negotiation),
    hasPricing: Boolean(flags.pricing) || moneyMentionCount > 0,
    hasReadyDP: Boolean(flags.readyDP),
    hasOrderReadiness: Boolean(flags.orderReadiness),
    hasTimeline: Boolean(flags.timeline),
    hasCustomization: Boolean(flags.customization),
    hasBrand: Boolean(flags.brand),
    hasSpecificProduct: Boolean(flags.product),
    hasProductList: Boolean(flags.productList),
    hasReseller: Boolean(flags.reseller),
    hasBusyDelay: Boolean(flags.busyDelay),
    hasFutureIntention: Boolean(flags.futureIntention),
    hasConfusion: Boolean(flags.confusion),
    hasPositive: Boolean(flags.positive),

    qtyMentionCount,
    moneyMentionCount,

    matchedPatterns: uniqueStrings(matchedPatterns),
    matchedIn: {
      latest: uniqueStrings(matchedIn.latest),
      tail: uniqueStrings(matchedIn.tail),
      summary: uniqueStrings(matchedIn.summary),
    },
  };

  signals.hasDecisionDelay =
    signals.hasPaymentDelay ||
    signals.hasBusyDelay ||
    signals.hasFutureIntention ||
    signals.hasLifeEventDelay;

  signals.hasSampling =
    signals.hasSampleCuriosity || signals.hasSamplePurchaseIntent;

  signals.hasAnalytical =
    signals.hasTechnicalCuriosity ||
    signals.hasFormulaCompatibility ||
    signals.hasCompetitorAwareness ||
    signals.hasProfitCalculation ||
    signals.hasMarketingExpectation ||
    signals.hasProductionCuriosity;

  signals.hasPostOrderContext =
    signals.hasExistingCustomer ||
    signals.hasPostDecision ||
    signals.hasComplaint ||
    signals.hasRefundConcern ||
    signals.hasSafetyConcern;

  return signals;
}

function deriveIntent(baseIntent, signals) {
  if (
    signals.hasComplaint ||
    signals.hasSafetyConcern ||
    signals.hasRefundConcern ||
    signals.hasLegality ||
    signals.hasVisualValidation ||
    signals.hasFormulaCompatibility
  ) {
    return "trust";
  }

  if (
    signals.hasReadyDP ||
    signals.hasOrderReadiness ||
    signals.hasTimeline ||
    signals.hasPostDecision ||
    signals.hasSamplePurchaseIntent ||
    signals.hasProductionCuriosity
  ) {
    return "process";
  }

  if (
    signals.hasPricing ||
    signals.hasProfitCalculation ||
    signals.hasNegotiation
  ) {
    return "price";
  }

  if (signals.hasDecisionDelay) {
    return "emotion";
  }

  if (
    signals.hasTechnicalCuriosity ||
    signals.hasCompetitorAwareness ||
    signals.hasMarketingExpectation ||
    signals.hasBrand ||
    signals.hasCustomization ||
    signals.hasSpecificProduct ||
    signals.hasProductList ||
    signals.hasReseller ||
    signals.hasSampleCuriosity
  ) {
    return "exploration";
  }

  if (baseIntent && baseIntent !== "unknown") {
    return normalizeIntent(baseIntent) || "unknown";
  }

  return "exploration";
}

function deriveEmotion(baseEmotion, signals, latestCustomerText) {
  if (signals.hasComplaint) return "product_complaint";
  if (signals.hasSafetyConcern) return "product_safety_concern";
  if (signals.hasRefundConcern) return signals.hasComplaint ? "product_complaint" : "trust_seeking";
  if (signals.hasPaymentDelay || signals.hasBusyDelay || signals.hasLifeEventDelay) return "busy_delay";
  if (signals.hasFutureIntention) return "future_intention";
  if (signals.hasNegotiation) return "negotiation";
  if (signals.hasVisualValidation) return "visual_validation";
  if (signals.hasFormulaCompatibility) return "formula_compatibility";
  if (signals.hasTechnicalCuriosity || signals.hasProductionCuriosity) return "technical_curiosity";
  if (signals.hasCompetitorAwareness) return "competitor_awareness";
  if (signals.hasMarketingExpectation) return "marketing_expectation";
  if (signals.hasProfitCalculation) return "profit_calculation";
  if (signals.hasLegality) return "trust_seeking";
  if (signals.hasSamplePurchaseIntent || signals.hasSampleCuriosity) return "sample_evaluation";
  if (signals.hasCustomization) return "creative_involvement";

  if (
    signals.hasBrand &&
    (signals.hasPricing || signals.hasProfitCalculation || signals.hasSpecificProduct)
  ) {
    return "business_planning";
  }

  if (signals.hasReseller) return "business_motivation";
  if (signals.hasReadyDP || signals.hasOrderReadiness || signals.hasTimeline) return "excitement";
  if (signals.hasSpecificProduct || signals.hasBrand || signals.hasProductList) return "interest";
  if (signals.hasConfusion) return "curiosity";

  if (baseEmotion && baseEmotion !== "unknown") {
    return normalizeEmotion(baseEmotion) || "unknown";
  }

  return inferEmotionsFallback(latestCustomerText || "")[0] || "unknown";
}

function deriveBehaviourStage(baseStage, signals) {
  if (signals.hasComplaint || signals.hasSafetyConcern || signals.hasRefundConcern || signals.hasPostDecision) {
    return "post_decision";
  }

  if (signals.hasDecisionDelay) {
    return "decision_delay";
  }

  if (signals.hasSampling) {
    return "sampling";
  }

  if (signals.hasReadyDP || signals.hasOrderReadiness) {
    return "decision";
  }

  if (
    signals.hasPricing ||
    signals.hasProfitCalculation ||
    signals.hasLegality ||
    signals.hasVisualValidation ||
    signals.hasTechnicalCuriosity ||
    signals.hasFormulaCompatibility ||
    signals.hasCompetitorAwareness ||
    signals.hasMarketingExpectation ||
    signals.hasProductionCuriosity ||
    signals.hasTimeline ||
    signals.hasNegotiation ||
    signals.qtyMentionCount > 0
  ) {
    return "evaluation";
  }

  if (
    signals.hasSpecificProduct ||
    signals.hasBrand ||
    signals.hasCustomization ||
    signals.hasReseller ||
    signals.hasProductList
  ) {
    return "interest";
  }

  if (baseStage && baseStage !== "unknown") {
    return normalizeBehaviourStage(baseStage) || "curiosity";
  }

  return "curiosity";
}

function deriveConversionRate(baseScore, signals) {
  let score = Number.isFinite(Number(baseScore)) ? Number(baseScore) : 20;

  if (signals.hasReseller) score += 6;
  if (signals.hasProductList) score += 5;
  if (signals.hasSpecificProduct) score += 7;
  if (signals.hasBrand) score += 8;
  if (signals.hasCustomization) score += 6;

  if (signals.hasLegality) score += 7;
  if (signals.hasVisualValidation) score += 5;

  if (signals.hasPricing) score += 5;
  if (signals.hasProfitCalculation) score += 7;
  if (signals.hasNegotiation) score += 6;

  if (signals.hasSampleCuriosity) score += 4;
  if (signals.hasSamplePurchaseIntent) score += 8;

  if (signals.hasTechnicalCuriosity) score += 6;
  if (signals.hasFormulaCompatibility) score += 7;
  if (signals.hasCompetitorAwareness) score += 5;
  if (signals.hasMarketingExpectation) score += 6;
  if (signals.hasProductionCuriosity) score += 5;

  if (signals.hasTimeline) score += 8;
  if (signals.hasOrderReadiness) score += 14;
  if (signals.hasReadyDP) score += 18;

  if (signals.hasExistingCustomer) score += 10;
  if (signals.hasPostDecision) score += 5;

  if (signals.qtyMentionCount > 0) score += 8;
  if (signals.moneyMentionCount > 0) score += 4;
  if (signals.hasPositive) score += 3;

  if (signals.hasDecisionDelay) score -= 8;
  if (signals.hasRefundConcern) score -= 9;
  if (signals.hasComplaint) score -= 7;
  if (signals.hasSafetyConcern) score -= 9;
  if (signals.hasConfusion && !signals.hasOrderReadiness && !signals.hasReadyDP) score -= 5;

  return clampNumber(Math.round(score), SCORE_LIMITS.MIN, SCORE_LIMITS.MAX);
}

function deriveLeadLevelStage(baseLeadLevel, conversionRate, signals) {
  if (signals.hasPostOrderContext) return "existing";

  if (signals.hasReadyDP) return "very_hot";

  if (
    signals.hasOrderReadiness &&
    (signals.hasTimeline || signals.qtyMentionCount > 0 || signals.moneyMentionCount > 0)
  ) {
    return "very_hot";
  }

  if (signals.hasOrderReadiness) return "hot";

  if (
    signals.hasNegotiation ||
    (signals.hasPricing && signals.qtyMentionCount > 0) ||
    (signals.hasPricing && signals.hasTimeline)
  ) {
    return "hot_warm";
  }

  if (signals.hasAnalytical) {
    return "analytical";
  }

  if (baseLeadLevel && baseLeadLevel !== "unknown") {
    const normalizedBase = normalizeLeadLevel(baseLeadLevel);
    if (normalizedBase === "existing") return "existing";
    if (normalizedBase === "analytical" && !signals.hasOrderReadiness) return "analytical";
  }

  if (conversionRate <= SCORE_LIMITS.COLD_MAX) return "cold";
  if (conversionRate <= SCORE_LIMITS.WARM_MAX) return "warm";
  if (conversionRate <= SCORE_LIMITS.HOT_MAX) return "hot";

  return "very_hot";
}

function deriveConfidenceScore(baseConfidence, signals) {
  let confidence = Number.isFinite(Number(baseConfidence)) ? Number(baseConfidence) : 58;

  const matchCount = Array.isArray(signals.matchedPatterns) ? signals.matchedPatterns.length : 0;

  if (matchCount >= 1) confidence += 5;
  if (matchCount >= 3) confidence += 5;
  if (matchCount >= 6) confidence += 5;

  if (signals.hasSpecificProduct || signals.hasBrand) confidence += 4;
  if (signals.hasReadyDP || signals.hasOrderReadiness) confidence += 7;
  if (signals.hasExistingCustomer || signals.hasComplaint || signals.hasSafetyConcern) confidence += 7;
  if (signals.hasTechnicalCuriosity || signals.hasProfitCalculation || signals.hasMarketingExpectation) confidence += 5;

  if (
    signals.hasConfusion &&
    !signals.hasSpecificProduct &&
    !signals.hasBrand &&
    !signals.hasTechnicalCuriosity
  ) {
    confidence -= 5;
  }

  if (signals.hasDecisionDelay && matchCount <= 2) {
    confidence -= 2;
  }

  return clampNumber(Math.round(confidence), 20, 92);
}

function deriveCsAction(intent, behaviourStage, signals, baseAction) {
  if (signals.hasComplaint) {
    return "Tangani keluhan dengan empati, minta detail kendala, batch, dan bukti pendukung lalu arahkan ke tindak lanjut yang jelas.";
  }

  if (signals.hasSafetyConcern) {
    return "Tangani concern keamanan dengan hati-hati, gali kronologi pemakaian, kondisi kulit, dan detail produk untuk tindak lanjut yang aman.";
  }

  if (signals.hasRefundConcern) {
    return "Bangun trust dan cek kronologi transaksi atau kendala secara lengkap sebelum mengarahkan ke tindak lanjut refund atau solusi lain.";
  }

  if (signals.hasPaymentDelay || signals.hasLifeEventDelay) {
    return "Jangan paksa closing; rangkum poin penting dan jaga percakapan tetap hangat agar mudah dilanjutkan saat customer siap.";
  }

  if (signals.hasExistingCustomer && !signals.hasComplaint) {
    return "Percepat alur karena customer sudah existing, lalu cek apakah ada perubahan quantity, formula, atau target produksi berikutnya.";
  }

  if (signals.hasReadyDP) {
    return "Arahkan ke langkah konkret terdekat: finalisasi produk, quantity, invoice atau pembayaran, lalu pastikan follow-up penutupan jelas.";
  }

  if (intent === "process" && behaviourStage === "sampling") {
    return "Arahkan customer ke alur sample atau evaluasi sample terlebih dahulu sebelum produksi penuh.";
  }

  if (signals.hasVisualValidation) {
    return "Berikan visual yang paling relevan lalu arahkan customer memilih konsep, kemasan, atau hasil yang paling sesuai ekspektasi.";
  }

  if (signals.hasTechnicalCuriosity || signals.hasFormulaCompatibility || signals.hasProductionCuriosity) {
    return "Jawab sisi teknis secukupnya lalu tarik ke tujuan produk, target market, dan langkah proses yang paling relevan.";
  }

  if (signals.hasMarketingExpectation) {
    return "Arahkan diskusi ke target market, positioning, dan kategori produk yang paling feasible untuk dijual.";
  }

  if (signals.hasProfitCalculation) {
    return "Bantu customer berpikir dari sisi unit economics: modal, HPP, harga jual, margin, dan skenario volume.";
  }

  if (intent === "price") {
    return "Jelaskan bahwa harga tergantung jenis produk, quantity, formula, dan detail kebutuhan lalu arahkan customer memilih fokus produk.";
  }

  if (intent === "trust") {
    return "Bangun trust dengan menjelaskan legalitas, keamanan proses, atau bukti pendukung yang paling relevan dengan konteks customer.";
  }

  if (intent === "exploration") {
    return "Gali kebutuhan utama customer lalu arahkan ke kategori produk, target market, atau konsep brand yang paling relevan.";
  }

  if (baseAction) {
    return baseAction;
  }

  return "Gali kebutuhan utama customer lalu arahkan ke produk, harga, legalitas, sample, atau proses sesuai konteks.";
}

function deriveSuggestedResponse(intent, behaviourStage, signals, latestCustomerText, baseSuggested) {
  const defaults = defaultSuggestions(latestCustomerText || "");

  if (signals.hasComplaint) {
    return toChattyStyle(
      "baik kak aku bantu follow up ya, boleh info detail kendalanya dan kalau ada foto produknya sekalian ya",
      220
    );
  }

  if (signals.hasSafetyConcern) {
    return toChattyStyle(
      "baik kak aku bantu catat dulu ya, produk yang dipakai apa dan reaksinya seperti apa",
      220
    );
  }

  if (signals.hasRefundConcern) {
    return toChattyStyle(
      "baik kak aku bantu cek dulu kronologinya ya biar bisa diarahkan ke tindak lanjut yang tepat",
      220
    );
  }

  if (signals.hasExistingCustomer && !signals.hasComplaint) {
    return toChattyStyle(
      "siap kak, kalau mau reorder atau tambah quantity nanti aku bantu cek alurnya biar lebih cepat ya",
      220
    );
  }

  if (signals.hasPaymentDelay || signals.hasLifeEventDelay) {
    return toChattyStyle(
      "baik kak tidak apa apa, nanti aku bantu rangkum dulu poin pentingnya biar pas kakak siap bisa lanjut lagi",
      220
    );
  }

  if (signals.hasVisualValidation) {
    return toChattyStyle(
      "bisa kak nanti aku bantu share contoh visual atau kemasan yang relevan biar kakak lebih kebayang ya",
      220
    );
  }

  if (signals.hasSamplePurchaseIntent || behaviourStage === "sampling") {
    return toChattyStyle(
      "bisa kak, biasanya kita mulai dari sample dulu biar kakak bisa cek hasilnya sebelum lanjut produksi",
      220
    );
  }

  if (signals.hasTechnicalCuriosity || signals.hasProductionCuriosity) {
    return toChattyStyle(
      "siap kak, untuk detail teknis atau alur produksinya nanti aku bantu jelasin sesuai tujuan produknya ya",
      220
    );
  }

  if (signals.hasFormulaCompatibility) {
    return toChattyStyle(
      "baik kak, untuk kecocokan formula nanti perlu disesuaikan sama target kulit dan fungsi produknya ya",
      220
    );
  }

  if (signals.hasMarketingExpectation) {
    return toChattyStyle(
      "boleh kak, nanti kita arahkan ke produk yang paling cocok sama target market dan gaya jualan kakak ya",
      220
    );
  }

  if (signals.hasProfitCalculation) {
    return toChattyStyle(
      "bisa kak, nanti kita hitung gambaran modal harga jual dan potensi untungnya sesuai produk yang kakak incar ya",
      220
    );
  }

  if (signals.hasReadyDP) {
    return toChattyStyle(
      "siap kak, kalau udah siap dp kita bisa langsung rapikan detail produk dan langkah berikutnya ya",
      220
    );
  }

  if (intent === "process" && signals.hasOrderReadiness) {
    return toChattyStyle(
      "siap kak kita bisa lanjut ke step berikutnya ya, aku bantu urutin dari produk yang dipilih sampai proses ordernya",
      220
    );
  }

  if (intent === "price") {
    return toChattyStyle(
      "untuk harga biasanya ngikut jenis produk quantity dan detail kebutuhan kak, kakak lagi kepikiran produk apa dulu",
      220
    );
  }

  if (intent === "trust") {
    return toChattyStyle(
      "untuk legalitas atau pengecekan yang kakak tanyain bisa dibantu ya, nanti aku jelasin alurnya biar lebih jelas",
      220
    );
  }

  if (signals.hasConfusion) {
    return toChattyStyle(
      "siap kak aku jelasin yang lebih simpel ya, kakak paling pengen tahu bagian produk harga legalitas sample atau alurnya dulu",
      220
    );
  }

  if (baseSuggested) {
    return toChattyStyle(baseSuggested, 220);
  }

  if (Array.isArray(defaults) && defaults.length > 0) {
    return toChattyStyle(defaults[0], 220);
  }

  return toChattyStyle(
    "boleh kak aku bantu, kakak lagi cari info produk legalitas sample atau mau bikin brand sendiri dulu",
    220
  );
}

/* ---------------------------------
   Utility helpers
---------------------------------- */

function mergeMatchedPatterns(basePatterns, signals) {
  return uniqueStrings([
    ...(Array.isArray(basePatterns)
      ? basePatterns.map((x) => safeText(String(x || ""), 120))
      : []),
    ...(Array.isArray(signals?.matchedPatterns) ? signals.matchedPatterns : []),
  ]);
}

function mergeMatchedIn(baseMatchedIn, signals) {
  const base = baseMatchedIn && typeof baseMatchedIn === "object"
    ? baseMatchedIn
    : { latest: [], tail: [], summary: [] };

  return {
    latest: uniqueStrings([
      ...toStringArray(base.latest),
      ...toStringArray(signals?.matchedIn?.latest),
    ]),
    tail: uniqueStrings([
      ...toStringArray(base.tail),
      ...toStringArray(signals?.matchedIn?.tail),
    ]),
    summary: uniqueStrings([
      ...toStringArray(base.summary),
      ...toStringArray(signals?.matchedIn?.summary),
    ]),
  };
}

function normalizeIntent(value) {
  return normalizeRuleIntent(value || "");
}

function normalizeEmotion(value) {
  return normalizeRuleEmotion(value || "");
}

function normalizeBehaviourStage(value) {
  return normalizeRuleBehaviourStage(value || "");
}

function normalizeLeadLevel(value) {
  return normalizeRuleLeadLevelStage(value || "");
}

function normalizeLocalEmotionToAnalysisSafe(text) {
  const runtimeValue = normalizeEmotion(normalizeRuntimeEmotion(text || ""));
  if (runtimeValue && runtimeValue !== "unknown") {
    return runtimeValue;
  }

  const inferred = inferEmotionsFallback(text || "")[0];
  return normalizeEmotion(inferred || "unknown") || "unknown";
}

function countQtyMentions(text) {
  const matches = String(text || "").match(QTY_REGEX);
  return Array.isArray(matches) ? matches.length : 0;
}

function countMoneyMentions(text) {
  const matches = String(text || "").match(MONEY_REGEX);
  return Array.isArray(matches) ? matches.length : 0;
}

function normalizeText(value) {
  let text = normalizeDatasetText(value || "");

  text = text
    .replace(/\b(\d+)\s*jt\b/g, "$1 juta")
    .replace(/\b(\d+)\s*rb\b/g, "$1 ribu")
    .replace(/\b(\d+)\s*k\b/g, "$1 ribu");

  for (const item of NORMALIZED_TEXT_REPLACEMENTS) {
    text = text.replace(item.regex, item.to);
  }

  return text.replace(/\s+/g, " ").trim();
}

function collectMatchedPatterns(text, patterns) {
  if (!text || !Array.isArray(patterns) || patterns.length === 0) {
    return [];
  }

  const hits = [];
  for (const pattern of patterns) {
    if (text.includes(pattern)) {
      hits.push(pattern);
    }
  }
  return hits;
}

function includesAnyNormalized(text, patterns) {
  if (!text || !Array.isArray(patterns) || patterns.length === 0) {
    return false;
  }

  for (const pattern of patterns) {
    if (text.includes(pattern)) {
      return true;
    }
  }

  return false;
}

function compilePatternGroups(rawGroups) {
  const out = {};

  for (const [key, patterns] of Object.entries(rawGroups || {})) {
    out[key] = uniqueStrings(
      (Array.isArray(patterns) ? patterns : [])
        .map((pattern) => normalizeText(pattern))
        .filter(Boolean)
    );
  }

  return Object.freeze(out);
}

function compileReplyRules(rawRules) {
  return Object.freeze(
    (Array.isArray(rawRules) ? rawRules : []).map((rule) => ({
      patterns: uniqueStrings(
        (Array.isArray(rule?.patterns) ? rule.patterns : [])
          .map((pattern) => normalizeText(pattern))
          .filter(Boolean)
      ),
      replies: Array.isArray(rule?.replies) ? rule.replies.slice(0, 3) : [],
    }))
  );
}

function compileEmotionRules(rawRules) {
  return Object.freeze(
    (Array.isArray(rawRules) ? rawRules : []).map((rule) => ({
      emotion: safeText(String(rule?.emotion || ""), 80),
      patterns: uniqueStrings(
        (Array.isArray(rule?.patterns) ? rule.patterns : [])
          .map((pattern) => normalizeText(pattern))
          .filter(Boolean)
      ),
    }))
  );
}

function toChattyStyle(text, max = 220) {
  let s = String(text || "").trim();
  if (!s) return "";

  s = s
    .replace(/\bKalau\b/g, "kalo")
    .replace(/\bkalau\b/g, "kalo")
    .replace(/\bBegitu\b/g, "gitu")
    .replace(/\bbegitu\b/g, "gitu")
    .replace(/\bMemang\b/g, "emang")
    .replace(/\bmemang\b/g, "emang")
    .replace(/\bTidak\b/g, "ga")
    .replace(/\btidak\b/g, "ga")
    .replace(/\bSudah\b/g, "udah")
    .replace(/\bsudah\b/g, "udah")
    .replace(/\bUntuk\b/g, "buat")
    .replace(/\buntuk\b/g, "buat")
    .replace(/\bDengan\b/g, "sama")
    .replace(/\bdengan\b/g, "sama")
    .replace(/\bSaya\b/g, "aku")
    .replace(/\bsaya\b/g, "aku")
    .replace(/\bAnda\b/g, "kak")
    .replace(/\banda\b/g, "kak")
    .replace(/[.,!?;:]+/g, "")
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (s) {
    s = s.charAt(0).toLowerCase() + s.slice(1);
  }

  s = s
    .replace(/\bkamu\b/g, "kak")
    .replace(/\bapabila\b/g, "kalo")
    .replace(/\bnamun\b/g, "tapi")
    .replace(/\bkarena\b/g, "soalnya")
    .replace(/\bterlebih dahulu\b/g, "dulu")
    .replace(/\bselanjutnya\b/g, "abis itu")
    .replace(/\bakan\b/g, "bakal")
    .replace(/\s+/g, " ")
    .trim();

  return s.slice(0, max).trim();
}

function uniqueStrings(arr) {
  return [...new Set((Array.isArray(arr) ? arr : []).filter(Boolean))];
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((x) => safeText(String(x || ""), 120))
    .filter(Boolean);
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function safeText(x, max = 2000) {
  return (typeof x === "string" ? x : "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}