// generate_ai_backup/fallback_one/fallback_one.js

import {
  BEHAVIOUR_STAGES,
  EMOTIONS,
  INTENTS,
  LEAD_LEVELS,
  normalizeBehaviourStage as normalizeRuleBehaviourStage,
  normalizeEmotion as normalizeRuleEmotion,
  normalizeIntent as normalizeRuleIntent,
  normalizeLeadLevelStage as normalizeRuleLeadLevelStage,
} from "../../dataset_engine/rules.js";

const ALLOWED_INTENTS = Object.freeze([...INTENTS]);
const ALLOWED_EMOTIONS = Object.freeze([...EMOTIONS]);
const ALLOWED_BEHAVIOUR_STAGES = Object.freeze([...BEHAVIOUR_STAGES]);
const ALLOWED_LEAD_LEVELS = Object.freeze([...LEAD_LEVELS]);

const INTENT_ALIASES = Object.freeze({
  exploration: "exploration",
  eksplorasi: "exploration",
  info: "exploration",
  discovery: "exploration",
  riset: "exploration",

  reseller: "exploration",
  reseller_exploration: "exploration",
  "reseller exploration": "exploration",

  product_discovery: "exploration",
  "product discovery": "exploration",

  brand_building: "exploration",
  "brand building": "exploration",
  branding: "exploration",
  customization: "exploration",
  custom: "exploration",

  trust: "trust",
  legality: "trust",
  legalitas: "trust",
  legal: "trust",
  keamanan: "trust",
  verification: "trust",
  refund_concern: "trust",
  refund: "trust",

  pricing: "price",
  harga: "price",
  budget: "price",
  price: "price",
  negotiation: "price",
  negosiasi: "price",
  profit_calculation: "price",

  sampling: "process",
  sample: "process",
  ordering: "process",
  order: "process",
  timeline: "process",
  payment: "process",
  process: "process",
  post_decision: "process",
  payment_delay: "process",

  emotion: "emotion",
  emotional: "emotion",
  emosi: "emotion",

  unknown: "unknown",
});

const EMOTION_ALIASES = Object.freeze({
  curiosity: "curiosity",
  penasaran: "curiosity",
  curiousity: "curiosity",

  discovery: "discovery",

  interest: "interest",
  tertarik: "interest",

  creative_involvement: "creative_involvement",
  "creative involvement": "creative_involvement",

  trust_seeking: "trust_seeking",
  "trust seeking": "trust_seeking",
  ragu: "trust_seeking",
  refund_concern: "trust_seeking",
  refund: "trust_seeking",

  visual_validation: "visual_validation",
  visual_proof: "visual_validation",
  visual_check: "visual_validation",

  analytical_thinking: "analytical_thinking",
  analytical: "analytical_thinking",
  analitis: "analytical_thinking",

  profit_calculation: "profit_calculation",
  price_sensitivity: "profit_calculation",
  "price sensitivity": "profit_calculation",

  business_planning: "business_planning",
  business_plan: "business_planning",

  negotiation: "negotiation",
  nego: "negotiation",

  excitement: "excitement",
  urgency: "excitement",
  urgent: "excitement",
  readiness: "excitement",

  business_motivation: "business_motivation",

  sample_evaluation: "sample_evaluation",
  sample_validation: "sample_evaluation",

  busy_delay: "busy_delay",
  payment_delay: "busy_delay",
  delay_payment: "busy_delay",

  future_intention: "future_intention",

  technical_curiosity: "technical_curiosity",
  technical: "technical_curiosity",

  formula_compatibility: "formula_compatibility",
  formula_match: "formula_compatibility",
  formula_compatible: "formula_compatibility",

  competitor_awareness: "competitor_awareness",
  competitor_compare: "competitor_awareness",

  business_insight: "business_insight",

  marketing_expectation: "marketing_expectation",
  marketing_goal: "marketing_expectation",

  product_complaint: "product_complaint",
  complaint: "product_complaint",
  komplain: "product_complaint",

  product_safety_concern: "product_safety_concern",
  safety_concern: "product_safety_concern",

  confusion: "curiosity",
  marah: "product_complaint",

  unknown: "unknown",
});

const BEHAVIOUR_STAGE_ALIASES = Object.freeze({
  curiosity: "curiosity",
  curiousity: "curiosity",

  interest: "interest",

  evaluation: "evaluation",
  evaluasi: "evaluation",

  decision: "decision",
  keputusan: "decision",

  post_decision: "post_decision",
  postdecision: "post_decision",
  aftersales: "post_decision",

  decision_delay: "decision_delay",
  decisiondelay: "decision_delay",
  delay: "decision_delay",
  payment_delay: "decision_delay",

  sampling: "sampling",
  sample: "sampling",
  sample_stage: "sampling",
});

const LEAD_LEVEL_ALIASES = Object.freeze({
  cold: "cold",
  low: "cold",

  warm: "warm",
  medium: "warm",

  hot: "hot",
  high: "hot",

  very_hot: "very_hot",
  veryhot: "very_hot",
  "very hot": "very_hot",

  existing: "existing",
  existing_customer: "existing",
  repeat_customer: "existing",
  returning_customer: "existing",

  hot_warm: "hot_warm",
  hotwarm: "hot_warm",
  "hot warm": "hot_warm",
  "hot/warm": "hot_warm",

  analytical: "analytical",
  analytic: "analytical",
  analitical: "analytical",
  analitis: "analytical",
});

export async function fallbackOneGenerate(env, ctx, deps, attempt = 1) {
  if (!env.AI_FALLBACK || typeof env.AI_FALLBACK.run !== "function") {
    return { ok: false, reason: "missing_ai_fallback_binding" };
  }

  const baseAnalysis = buildBaseAnalysis(ctx);

  try {
    const payload = {
      prompt: buildWorkersAIPrompt(ctx, baseAnalysis, attempt),
      max_tokens: getWorkersAIMaxTokens(env),
    };

    const data = await env.AI_FALLBACK.run(getWorkersAIModel(env), payload);
    const out = extractWorkersAITextAny(data);
    const parser =
      deps && typeof deps.tryParseJsonLoose === "function"
        ? deps.tryParseJsonLoose
        : tryParseJsonLooseLocal;

    const parsed = parser(out);
    const normalized = normalizeWorkersAIAnalysis(parsed, ctx, baseAnalysis);

    if (normalized.ok) {
      return {
        ok: true,
        value: normalized.value,
      };
    }

    if (attempt < getWorkersAIRetryMax(env) + 1) {
      return fallbackOneGenerate(env, ctx, deps, attempt + 1);
    }

    return { ok: false, reason: normalized.reason || "workers_ai_parse_error" };
  } catch (err) {
    console.error("Workers AI fallback error:", err?.stack || String(err));

    if (attempt < getWorkersAIRetryMax(env) + 1) {
      return fallbackOneGenerate(env, ctx, deps, attempt + 1);
    }

    return { ok: false, reason: "workers_ai_runtime_error" };
  }
}

function getWorkersAIModel(env) {
  return (
    safeText(env.WORKERS_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct", 120) ||
    "@cf/meta/llama-3.1-8b-instruct"
  );
}

function getWorkersAIMaxTokens(env) {
  const n = Number(env.WORKERS_AI_MAX_TOKENS || "700");
  return Number.isFinite(n) && n >= 128 ? Math.min(n, 2048) : 700;
}

function getWorkersAIRetryMax(env) {
  const n = Number(env.WORKERS_AI_RETRY_MAX || "1");
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 3) : 1;
}

function buildWorkersAIPrompt(ctx, baseAnalysis, attempt = 1) {
  const summary = safeText(ctx?.summary || "-", 1400);
  const tail = safeText(ctx?.tail || ctx?.latestCustomerText || "(kosong)", 2600);
  const latestCustomerText = safeText(ctx?.latestCustomerText || "(kosong)", 1200);

  const priorKnowledge = {
    rule_id: baseAnalysis.rule_id,
    intent: baseAnalysis.intent,
    emotion: baseAnalysis.emotion,
    behaviour_stage: baseAnalysis.behaviour_stage,
    lead_level_stage: baseAnalysis.lead_level_stage,
    conversion_rate_analyzed: baseAnalysis.conversion_rate_analyzed,
    cs_action: baseAnalysis.cs_action,
    suggested_response: baseAnalysis.suggested_response,
    confidence_score: baseAnalysis.confidence_score,
    matched_patterns: baseAnalysis.matched_patterns,
    matched_context_cues: baseAnalysis.matched_context_cues,
    ambiguity_score: baseAnalysis.ambiguity_score,
    signal_summary: baseAnalysis.signal_summary,
  };

  if (attempt === 1) {
    return [
      "kamu AI sales analyst untuk chat CS maklon skincare.",
      "tugasmu menganalisis pesan customer dan menghasilkan object analysis final.",
      "gunakan prior knowledge dari dataset detection dan lead scoring sebagai baseline utama.",
      "jika prior knowledge sudah kuat dan konteks chat tidak memberi bukti lebih kuat, pertahankan baseline.",
      "jika latest customer text sangat pendek, ambigu, typo, atau konteks minim, jangan over-correct.",
      "jangan buat penjelasan tambahan.",
      "balas HANYA dengan JSON valid tanpa markdown.",
      "",
      "taxonomy wajib dipakai seperti ini:",
      "- intent hanya bucket besar: exploration, trust, price, process, emotion, unknown.",
      "- emotion adalah nuansa spesifik customer.",
      "- behaviour_stage adalah tahap journey customer.",
      "- lead_level_stage adalah readiness / relationship stage customer.",
      "",
      "panduan penting:",
      "- very_hot untuk customer yang sangat dekat closing, siap DP, siap transfer, siap proses.",
      "- existing untuk customer lama, reorder, post-order, komplain, atau isu setelah transaksi.",
      "- hot_warm untuk lead di tengah evaluasi kuat atau negosiasi, belum setara very_hot.",
      "- analytical untuk lead yang dominan hitung untung, teknis formula, kompatibilitas, pembanding kompetitor, insight bisnis.",
      "- post_decision untuk kondisi setelah keputusan / setelah order / setelah transaksi.",
      "- decision_delay untuk penundaan keputusan, pending bayar, belum cair, sibuk, atau musibah pribadi.",
      "- sampling untuk konteks sample, tester, evaluasi sample, atau revisi sample.",
      "",
      "mapping konsep yang sering salah:",
      "- payment_delay bukan enum langsung; biasanya map ke intent=process, emotion=busy_delay, behaviour_stage=decision_delay.",
      "- refund_concern bukan enum langsung; biasanya map ke intent=trust, emotion=trust_seeking atau product_complaint jika jelas ada keluhan produk/transaksi.",
      "- legalitas / BPOM / verifikasi => intent=trust.",
      "- visual request / minta foto / minta before after => emotion=visual_validation.",
      "- hitung margin / modal / profit => intent=price, emotion=profit_calculation, lead_level_stage sering analytical.",
      "- ready DP / siap transfer => intent=process, behaviour_stage=decision, lead_level_stage=very_hot.",
      "- komplain / rusak / bocor / iritasi => lead_level_stage sering existing dan behaviour_stage sering post_decision.",
      "",
      "aturan output:",
      `- intent hanya boleh salah satu dari: ${ALLOWED_INTENTS.join(", ")}`,
      `- emotion hanya boleh salah satu dari: ${ALLOWED_EMOTIONS.join(", ")}`,
      `- behaviour_stage hanya boleh salah satu dari: ${ALLOWED_BEHAVIOUR_STAGES.join(", ")}`,
      `- lead_level_stage hanya boleh salah satu dari: ${ALLOWED_LEAD_LEVELS.join(", ")}`,
      "- conversion_rate_analyzed harus integer 0-100",
      "- confidence_score harus integer 0-100",
      "- cs_action harus ringkas, operasional, dan jelas untuk CS",
      "- suggested_response harus natural, santai, ringan, seperti chat WhatsApp",
      "- suggested_response maksimal 220 karakter",
      "- suggested_response huruf kecil di awal, hindari terlalu formal",
      "- suggested_response jangan terlalu kaku dan jangan seperti template robot",
      "",
      "format JSON wajib tepat seperti ini:",
      '{"intent":"exploration","emotion":"curiosity","behaviour_stage":"curiosity","lead_level_stage":"cold","conversion_rate_analyzed":30,"cs_action":"Tanyakan kebutuhan utama customer lalu arahkan ke kategori produk atau alur yang relevan.","suggested_response":"kak boleh cerita dulu kak lagi cari info produk, legalitas, sample, atau mau bikin brand sendiri","confidence_score":72}',
      '{"intent":"price","emotion":"profit_calculation","behaviour_stage":"evaluation","lead_level_stage":"analytical","conversion_rate_analyzed":63,"cs_action":"Bantu hitung gambaran modal, harga jual, dan margin agar customer punya bayangan bisnis yang realistis.","suggested_response":"bisa kak nanti kita hitung gambaran modal harga jual dan potensi untungnya sesuai produk yang kakak incar ya","confidence_score":84}',
      '{"intent":"trust","emotion":"product_complaint","behaviour_stage":"post_decision","lead_level_stage":"existing","conversion_rate_analyzed":54,"cs_action":"Tangani keluhan dengan empati, minta detail kendala, batch, dan bukti pendukung agar bisa ditindaklanjuti.","suggested_response":"baik kak aku bantu follow up ya boleh info detail kendalanya dan kalau ada foto produknya sekalian ya","confidence_score":90}',
      "",
      `PRIOR KNOWLEDGE DATASET+SCORING:\n${JSON.stringify(priorKnowledge)}`,
      "",
      `RINGKASAN CHAT:\n${summary}`,
      "",
      `CHAT TERAKHIR:\n${tail}`,
      "",
      `LATEST CUSTOMER TEXT:\n${latestCustomerText}`,
    ].join("\n");
  }

  return [
    "balas HANYA json valid tanpa markdown.",
    "pakai prior knowledge dataset+scoring sebagai baseline utama.",
    "jika konteks ambigu, typo, sangat pendek, atau minim bukti, pertahankan baseline.",
    `intent hanya salah satu: ${ALLOWED_INTENTS.join(", ")}`,
    `emotion hanya salah satu: ${ALLOWED_EMOTIONS.join(", ")}`,
    `behaviour_stage hanya salah satu: ${ALLOWED_BEHAVIOUR_STAGES.join(", ")}`,
    `lead_level_stage hanya salah satu: ${ALLOWED_LEAD_LEVELS.join(", ")}`,
    "payment_delay => process + busy_delay + decision_delay.",
    "refund_concern => trust + trust_seeking atau product_complaint bila benar-benar keluhan pasca transaksi.",
    "legalitas/bpom => trust.",
    "ready dp / siap transfer => process + decision + very_hot.",
    "komplain / iritasi / bocor => existing + post_decision bila konteks pasca order.",
    "conversion_rate_analyzed integer 0-100",
    "confidence_score integer 0-100",
    "cs_action singkat dan operasional",
    "suggested_response natural dan maksimal 220 karakter",
    "jangan beri penjelasan tambahan",
    "",
    "format tepat:",
    '{"intent":"exploration","emotion":"curiosity","behaviour_stage":"curiosity","lead_level_stage":"cold","conversion_rate_analyzed":30,"cs_action":"...","suggested_response":"...","confidence_score":70}',
    "",
    `PRIOR KNOWLEDGE DATASET+SCORING:\n${JSON.stringify(priorKnowledge)}`,
    "",
    `CHAT TERAKHIR:\n${tail}`,
    "",
    `LATEST CUSTOMER TEXT:\n${latestCustomerText}`,
  ].join("\n");
}

function normalizeWorkersAIAnalysis(obj, ctx, baseAnalysis) {
  const raw = unwrapAnalysisObject(obj);

  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "workers_ai_invalid_json_shape" };
  }

  const intent = normalizeIntent(
    raw.intent ??
      raw.analysis_intent ??
      raw.intent_stage ??
      baseAnalysis.intent
  );

  const emotion = normalizeEmotion(
    raw.emotion ??
      raw.primary_emotion ??
      raw.customer_emotion ??
      baseAnalysis.emotion
  );

  const behaviourStage = normalizeBehaviourStage(
    raw.behaviour_stage ??
      raw.behavior_stage ??
      raw.stage ??
      raw.behaviour ??
      baseAnalysis.behaviour_stage
  );

  const leadLevelStage = normalizeLeadLevel(
    raw.lead_level_stage ??
      raw.lead_level ??
      raw.lead_stage ??
      baseAnalysis.lead_level_stage
  );

  const conversionRate = normalizePercent(
    raw.conversion_rate_analyzed ??
      raw.conversion_rate ??
      raw.conversion_probability ??
      raw.probability ??
      baseAnalysis.conversion_rate_analyzed
  );

  const confidenceScore = normalizePercent(
    raw.confidence_score ??
      raw.confidence ??
      baseAnalysis.confidence_score
  );

  const csAction = safeText(
    raw.cs_action ??
      raw.action ??
      raw.next_action ??
      baseAnalysis.cs_action,
    1000
  );

  const suggestedResponse = toChattyStyle(
    raw.suggested_response ??
      raw.response ??
      raw.reply ??
      raw.suggested_reply ??
      firstSuggestion(raw.suggestions) ??
      baseAnalysis.suggested_response,
    220
  );

  const hasEnoughSignal = Boolean(
    intent ||
      emotion ||
      behaviourStage ||
      leadLevelStage ||
      Number.isFinite(conversionRate) ||
      csAction ||
      suggestedResponse
  );

  if (!hasEnoughSignal) {
    return { ok: false, reason: "workers_ai_empty_analysis" };
  }

  return {
    ok: true,
    value: {
      rule_id: safeText(baseAnalysis.rule_id || "fallback_one_analysis", 80),
      intent: intent || baseAnalysis.intent,
      emotion: emotion || baseAnalysis.emotion,
      behaviour_stage: behaviourStage || baseAnalysis.behaviour_stage,
      lead_level_stage: leadLevelStage || baseAnalysis.lead_level_stage,
      conversion_rate_analyzed: Number.isFinite(conversionRate)
        ? conversionRate
        : Number(baseAnalysis.conversion_rate_analyzed || 20),
      cs_action: csAction || baseAnalysis.cs_action,
      suggested_response: suggestedResponse || baseAnalysis.suggested_response,
      confidence_score: Number.isFinite(confidenceScore)
        ? confidenceScore
        : Number(baseAnalysis.confidence_score || 65),
      matched_patterns: Array.isArray(baseAnalysis.matched_patterns)
        ? baseAnalysis.matched_patterns
        : [],
      matched_in: baseAnalysis.matched_in || {
        latest: [],
        tail: [],
        summary: [],
      },
      rule_source: "workers_ai_fallback",
      source: "fallback_one",
    },
  };
}

function unwrapAnalysisObject(obj) {
  if (!obj || typeof obj !== "object") return null;

  if (obj.analysis && typeof obj.analysis === "object") {
    return obj.analysis;
  }

  if (obj.result && typeof obj.result === "object" && !Array.isArray(obj.result)) {
    return obj.result;
  }

  return obj;
}

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

  const suggested =
    safeText(base?.suggested_response || "", 220) ||
    safeText(
      "kak boleh ceritain dulu kak lagi cari info produk, legalitas, sample, atau mau bikin brand sendiri",
      220
    );

  return {
    rule_id: safeText(base?.rule_id || "fallback_one_base", 80),
    intent: normalizeIntent(base?.intent) || "unknown",
    emotion:
      normalizeEmotion(base?.emotion) ||
      normalizeLocalEmotionToAnalysis(ctx?.latestCustomerText || ""),
    behaviour_stage: normalizeBehaviourStage(base?.behaviour_stage) || "curiosity",
    lead_level_stage: normalizeLeadLevel(base?.lead_level_stage) || "cold",
    conversion_rate_analyzed:
      normalizePercent(base?.conversion_rate_analyzed) ?? 20,
    cs_action: safeText(
      base?.cs_action ||
        "Tanyakan kebutuhan utama customer lalu arahkan ke produk, harga, legalitas, sample, atau proses yang relevan.",
      1000
    ),
    suggested_response: suggested,
    confidence_score: normalizePercent(base?.confidence_score) ?? 65,
    matched_patterns: Array.isArray(base?.matched_patterns) ? base.matched_patterns : [],
    matched_context_cues: Array.isArray(base?.matched_context_cues)
      ? base.matched_context_cues
      : [],
    ambiguity_score: normalizePercent(base?.ambiguity_score) ?? 0,
    signal_summary:
      base?.signal_summary && typeof base.signal_summary === "object"
        ? sanitizeSignalSummary(base.signal_summary)
        : {},
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

function getAliasValue(rawValue, aliasMap) {
  const key = normalizeKey(rawValue);
  if (!key) return "";
  return aliasMap[key] || key;
}

function normalizeIntent(value) {
  const raw = getAliasValue(value, INTENT_ALIASES);
  if (!raw) return "";

  const normalized = normalizeRuleIntent(raw);
  if (normalized === "unknown" && raw !== "unknown") return "";

  return ALLOWED_INTENTS.includes(normalized) ? normalized : "";
}

function normalizeEmotion(value) {
  const raw = getAliasValue(value, EMOTION_ALIASES);
  if (!raw) return "";

  const normalized = normalizeRuleEmotion(raw);
  if (normalized === "unknown" && raw !== "unknown") return "";

  return ALLOWED_EMOTIONS.includes(normalized) ? normalized : "";
}

function normalizeBehaviourStage(value) {
  const raw = getAliasValue(value, BEHAVIOUR_STAGE_ALIASES);
  if (!raw) return "";

  const normalized = normalizeRuleBehaviourStage(raw);
  if (normalized === "curiosity" && raw !== "curiosity") return "";

  return ALLOWED_BEHAVIOUR_STAGES.includes(normalized) ? normalized : "";
}

function normalizeLeadLevel(value) {
  const raw = getAliasValue(value, LEAD_LEVEL_ALIASES);
  if (!raw) return "";

  const normalized = normalizeRuleLeadLevelStage(raw);
  if (normalized === "cold" && raw !== "cold") return "";

  return ALLOWED_LEAD_LEVELS.includes(normalized) ? normalized : "";
}

function normalizePercent(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.-]/g, "").trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return null;
    return clampNumber(Math.round(n), 0, 100);
  }

  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return clampNumber(Math.round(n), 0, 100);
}

function firstSuggestion(suggestions) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return "";
  const first = suggestions[0];

  if (typeof first === "string") {
    return first;
  }

  if (first && typeof first === "object" && typeof first.text === "string") {
    return first.text;
  }

  return "";
}

function normalizeLocalEmotionToAnalysis(text) {
  const t = String(text || "").toLowerCase();

  if (/\b(komplain|keluhan|rusak|bocor|cacat|tidak sesuai)\b/.test(t)) {
    return "product_complaint";
  }

  if (/\b(iritasi|breakout|gatal|perih|bruntusan|reaksi kulit|aman tidak)\b/.test(t)) {
    return "product_safety_concern";
  }

  if (/\b(foto|video|lihat hasil|before after|kemasan|desain|real pict)\b/.test(t)) {
    return "visual_validation";
  }

  if (/\b(komposisi|kandungan|bahan aktif|formula|tekstur|ph|stabilitas)\b/.test(t)) {
    return "technical_curiosity";
  }

  if (/\b(cocok|kompatibel|kulit sensitif|bisa digabung)\b/.test(t)) {
    return "formula_compatibility";
  }

  if (/\b(margin|profit|keuntungan|roi|hpp|balik modal|harga jual)\b/.test(t)) {
    return "profit_calculation";
  }

  if (/\b(urgent|segera|cepat|hari ini|secepatnya|asap)\b/.test(t)) {
    return "excitement";
  }

  if (/\b(ready dp|siap dp|transfer|bayar|invoice|deal|lanjut order|mau proses)\b/.test(t)) {
    return "excitement";
  }

  if (/\b(belum cair|pending bayar|bayar nanti|masih sibuk|tunda dulu|pikir dulu)\b/.test(t)) {
    return "busy_delay";
  }

  if (/\b(ragu|takut|aman tidak|aman ga|aman nggak|bpom|legalitas|sertifikat)\b/.test(t)) {
    return "trust_seeking";
  }

  if (/\b(sample|tester|uji sample|minta sample)\b/.test(t)) {
    return "sample_evaluation";
  }

  if (/\b(kompetitor|brand lain|merek lain|dibanding)\b/.test(t)) {
    return "competitor_awareness";
  }

  if (/\b(brand sendiri|private label|mau bikin brand|positioning|target market)\b/.test(t)) {
    return "business_planning";
  }

  if (/\b(reseller|mau jualan|usaha skincare)\b/.test(t)) {
    return "business_motivation";
  }

  if (/\b(kok|kenapa|bingung|ga paham|nggak paham|tidak paham|gimana)\b/.test(t)) {
    return "curiosity";
  }

  if (/\b(mau|tertarik|produk apa|harga|sample|legalitas)\b/.test(t)) {
    return "interest";
  }

  if (t.trim()) {
    return "curiosity";
  }

  return "unknown";
}

function sanitizeSignalSummary(input) {
  if (!input || typeof input !== "object") return {};

  const out = {};
  const allowedKeys = [
    "qty_mentioned",
    "qty_mention_count",
    "sample_curiosity",
    "sample_purchase_intent",
    "pricing_intent",
    "profit_calculation",
    "legality_intent",
    "urgency_intent",
    "timeline_intent",
    "order_readiness",
    "ready_dp",
    "existing_customer",
    "post_decision",
    "complaint",
    "safety_concern",
    "payment_delay",
    "refund_concern",
    "negotiation",
    "visual_validation",
    "technical_curiosity",
    "formula_compatibility",
    "competitor_awareness",
    "brand_intent",
    "customization_intent",
    "specific_product_intent",
    "reseller_intent",
    "future_intention",
    "busy_delay",
    "confusion",
    "positivity",
    "analytical_signal_count",
    "dataset_match_count",
    "dataset_candidate_score",
  ];

  for (const key of allowedKeys) {
    const value = input[key];
    if (typeof value === "boolean" || Number.isFinite(value)) {
      out[key] = value;
    }
  }

  return out;
}

function extractWorkersAITextAny(data) {
  if (typeof data === "string") {
    return safeText(data, 8000);
  }

  const parts = [];

  if (typeof data?.response === "string") parts.push(data.response);
  if (typeof data?.result === "string") parts.push(data.result);
  if (typeof data?.text === "string") parts.push(data.text);
  if (typeof data?.output_text === "string") parts.push(data.output_text);
  if (typeof data?.output === "string") parts.push(data.output);
  if (typeof data?.result?.response === "string") parts.push(data.result.response);
  if (typeof data?.result?.text === "string") parts.push(data.result.text);

  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (typeof item === "string") {
        parts.push(item);
        continue;
      }

      const content = Array.isArray(item?.content) ? item.content : [];
      for (const c of content) {
        if (typeof c === "string") {
          parts.push(c);
          continue;
        }

        if (typeof c?.text === "string") parts.push(c.text);
        if (typeof c?.value === "string") parts.push(c.value);
        if (typeof c?.text?.value === "string") parts.push(c.text.value);
      }
    }
  }

  if (parts.length > 0) {
    return safeText(parts.join("\n"), 8000);
  }

  try {
    return safeText(JSON.stringify(data || {}), 8000);
  } catch {
    return "";
  }
}

function tryParseJsonLooseLocal(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // continue
  }

  const i = cleaned.indexOf("{");
  const j = cleaned.lastIndexOf("}");
  if (i >= 0 && j > i) {
    try {
      return JSON.parse(cleaned.slice(i, j + 1));
    } catch {
      // continue
    }
  }

  return null;
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

function normalizeKey(value) {
  return safeText(String(value || ""), 120)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s_./-]/gu, " ")
    .replace(/[./-]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();
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