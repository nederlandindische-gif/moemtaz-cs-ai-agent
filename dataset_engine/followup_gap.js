// dataset_engine/followup_gap.js

import * as Rules from "./rules.js";
import {
  buildPipelineClassificationBundle,
  resolvePipelineRouteTarget,
} from "./pipeline_classifier.js";
import { buildSopStageBundle } from "./sop_stage_detector.js";
import { buildProspectTypeBundle } from "./prospect_type.js";

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
   Constants
---------------------------------- */

const GAP_CATEGORY = Object.freeze({
  no_respons: "no_respons_followup_gap",
  qualification: "qualification_gap",
  sample: "sample_gap",
  brand: "brand_gap",
  post_payment: "post_payment_gap",
  at_risk: "at_risk_gap",
  generic: "generic_gap",
});

const FOLLOWUP_STAGE_TO_TYPE = Object.freeze({
  followup_contoh_produk: "contoh_produk",
  followup_konten_design: "konten_dan_design",
  followup_testimoni: "testimoni",
  followup_penawaran_sample: "penawaran_sample",
  followup_bukti_transfer: "bukti_transfer",
  followup_progress: "tanya_progress",
});

const FOLLOWUP_TYPE_TO_GAP_KEY = Object.freeze({
  contoh_produk: "no_response_contoh_produk",
  konten_dan_design: "no_response_konten_design",
  testimoni: "no_response_testimoni",
  penawaran_sample: "no_response_penawaran_sample",
  bukti_transfer: "no_response_bukti_transfer",
  tanya_progress: "no_response_progress",
});

const FALLBACK_GAP_DEFINITIONS = Object.freeze({
  no_response_contoh_produk: Object.freeze({
    key: "no_response_contoh_produk",
    gap_category: GAP_CATEGORY.no_respons,
    followup_gap:
      "Customer belum merespons dan contoh produk yang relevan belum dikirim sebagai pancingan follow-up berikutnya.",
    required_artifacts: ["contoh_produk_relevan"],
    priority_reason:
      "Tanpa contoh produk yang relevan, follow-up no respons cenderung terasa generik dan lebih mudah diabaikan.",
  }),

  no_response_konten_design: Object.freeze({
    key: "no_response_konten_design",
    gap_category: GAP_CATEGORY.no_respons,
    followup_gap:
      "Customer belum merespons dan referensi konten atau desain yang mendekati kebutuhannya belum dipakai untuk menghidupkan obrolan lagi.",
    required_artifacts: ["konten_dan_design_referensi"],
    priority_reason:
      "Visual atau referensi desain sering menjadi pemicu respons berikutnya ketika follow-up teks biasa mulai melemah.",
  }),

  no_response_testimoni: Object.freeze({
    key: "no_response_testimoni",
    gap_category: GAP_CATEGORY.no_respons,
    followup_gap:
      "Customer belum merespons dan social proof seperti testimoni belum diberikan sebagai penguat trust berikutnya.",
    required_artifacts: ["testimoni_relevan"],
    priority_reason:
      "Saat respons menurun, social proof membantu menaikkan trust tanpa harus melakukan hard closing.",
  }),

  no_response_penawaran_sample: Object.freeze({
    key: "no_response_penawaran_sample",
    gap_category: GAP_CATEGORY.no_respons,
    followup_gap:
      "Customer belum merespons dan belum ada penawaran sample yang ringan sebagai langkah aman sebelum produksi.",
    required_artifacts: ["penawaran_sample", "rincian_sample"],
    priority_reason:
      "Penawaran sample adalah jembatan aman untuk lead yang belum siap langsung masuk ke produksi atau brand penuh.",
  }),

  no_response_bukti_transfer: Object.freeze({
    key: "no_response_bukti_transfer",
    gap_category: GAP_CATEGORY.no_respons,
    followup_gap:
      "Customer belum merespons dan trust proof administratif seperti rekening resmi atau bukti administrasi belum dipakai sebagai penguat.",
    required_artifacts: ["trust_proof_administratif"],
    priority_reason:
      "Untuk lead yang ragu, bukti administratif yang aman dibagikan sering lebih efektif daripada mengulang penawaran.",
  }),

  no_response_progress: Object.freeze({
    key: "no_response_progress",
    gap_category: GAP_CATEGORY.no_respons,
    followup_gap:
      "Customer belum merespons dan belum ada follow-up progres yang ringan untuk memancing balasan tanpa terasa menekan.",
    required_artifacts: ["followup_progress_ringan"],
    priority_reason:
      "Follow-up progres ringan membantu menghidupkan percakapan kembali saat semua materi utama sudah pernah dikirim.",
  }),

  qualification_legality_detail: Object.freeze({
    key: "qualification_legality_detail",
    gap_category: GAP_CATEGORY.qualification,
    followup_gap:
      "Belum ada penjelasan konkret tentang skema BPOM atau izin, dokumen yang diterima customer, dan penandaan brand pada produk.",
    required_artifacts: ["penjelasan_bpom", "rincian_dokumen"],
    priority_reason:
      "Legalitas adalah gap trust yang menghambat customer untuk lanjut jika belum dijawab secara konkret.",
  }),

  qualification_sample_comparison: Object.freeze({
    key: "qualification_sample_comparison",
    gap_category: GAP_CATEGORY.qualification,
    followup_gap:
      "Belum ada perbandingan yang jelas antara sample dan langsung produksi, termasuk fungsi sample dan revisi 1x.",
    required_artifacts: ["perbandingan_sample_vs_produksi", "rincian_revisi_1x"],
    priority_reason:
      "Saat customer masih ragu, perbandingan sample versus produksi adalah gap keputusan yang paling dekat untuk ditutup.",
  }),

  qualification_budget_scenario: Object.freeze({
    key: "qualification_budget_scenario",
    gap_category: GAP_CATEGORY.qualification,
    followup_gap:
      "Belum ada skenario biaya yang aman seperti rincian paket, DP, pelunasan, atau ongkir untuk membantu customer mengambil keputusan.",
    required_artifacts: ["skenario_biaya", "rincian_dp_pelunasan"],
    priority_reason:
      "Untuk customer sensitif budget, keputusan sering tertahan bukan di minat, tetapi di kurangnya gambaran biaya yang aman.",
  }),

  qualification_analytical_breakdown: Object.freeze({
    key: "qualification_analytical_breakdown",
    gap_category: GAP_CATEGORY.qualification,
    followup_gap:
      "Belum ada breakdown rinci tentang komposisi item, total pcs per item, atau feasibility mix quantity sesuai kebutuhan customer.",
    required_artifacts: ["breakdown_qty_item", "feasibility_mix_qty"],
    priority_reason:
      "Lead analitis butuh breakdown konkret sebelum bisa maju ke langkah komersial berikutnya.",
  }),

  qualification_visual_proof: Object.freeze({
    key: "qualification_visual_proof",
    gap_category: GAP_CATEGORY.qualification,
    followup_gap:
      "Belum ada bukti visual yang cukup seperti tekstur, warna isi, kemasan, atau referensi desain yang mendekati keinginan customer.",
    required_artifacts: ["foto_produk", "video_produk", "referensi_desain"],
    priority_reason:
      "Validasi visual sering menjadi faktor penentu agar lead berhenti membayangkan sendiri dan mulai mengunci arah.",
  }),

  qualification_package_detail: Object.freeze({
    key: "qualification_package_detail",
    gap_category: GAP_CATEGORY.qualification,
    followup_gap:
      "Rincian isi paket, pembagian item, atau struktur 5 item dan 100 pcs belum dijelaskan cukup jelas.",
    required_artifacts: ["rincian_isi_paket", "pembagian_item_qty"],
    priority_reason:
      "Sebelum customer bisa membandingkan atau memilih, struktur paket harus dipahami secara konkret.",
  }),

  qualification_purchase_lock: Object.freeze({
    key: "qualification_purchase_lock",
    gap_category: GAP_CATEGORY.qualification,
    followup_gap:
      "Customer sudah cukup dekat ke pembelian, tetapi langkah konkret seperti form, DP, invoice, atau alur berikutnya belum dikunci.",
    required_artifacts: ["next_closing_step"],
    priority_reason:
      "Begitu lead sudah dekat ke keputusan, gap tertinggi bukan lagi informasi umum melainkan langkah konkret berikutnya.",
  }),

  sample_invoice: Object.freeze({
    key: "sample_invoice",
    gap_category: GAP_CATEGORY.sample,
    followup_gap:
      "Customer sudah mengarah ke sample, tetapi harga sample, rincian sample, revisi 1x, dan langkah pembayaran sample belum terkunci.",
    required_artifacts: ["rincian_sample", "revisi_1x", "instruksi_pembayaran_sample"],
    priority_reason:
      "Untuk jalur sample, gap utama biasanya ada di rincian komersial dan rasa aman sebelum customer mau lanjut.",
  }),

  sample_progress: Object.freeze({
    key: "sample_progress",
    gap_category: GAP_CATEGORY.sample,
    followup_gap:
      "Jalur sample sudah berjalan, tetapi progress sample atau hasil evaluasinya belum cukup jelas untuk langkah lanjut.",
    required_artifacts: ["status_progress_sample"],
    priority_reason:
      "Setelah sample bergerak, keputusan lanjut sangat bergantung pada kejelasan progres dan hasil evaluasinya.",
  }),

  brand_form: Object.freeze({
    key: "brand_form",
    gap_category: GAP_CATEGORY.brand,
    followup_gap:
      "Customer sudah mengarah ke brand, tetapi Form Brand Development belum dikirim atau belum diisi.",
    required_artifacts: ["form_brand_development"],
    priority_reason:
      "Tanpa form atau brief brand yang rapi, jalur brand sulit maju ke DP, desain, dan produksi dengan aman.",
  }),

  brand_dp_invoice: Object.freeze({
    key: "brand_dp_invoice",
    gap_category: GAP_CATEGORY.brand,
    followup_gap:
      "Arah brand sudah cukup jelas, tetapi harga final, DP 50 persen, atau invoice belum dikunci.",
    required_artifacts: ["harga_final_brand", "dp_50", "invoice"],
    priority_reason:
      "Setelah brief brand cukup masuk, hambatan berikutnya biasanya ada pada penguncian langkah komersial resmi.",
  }),

  brand_development: Object.freeze({
    key: "brand_development",
    gap_category: GAP_CATEGORY.brand,
    followup_gap:
      "Administrasi brand sudah bergerak, tetapi detail brand brief atau status proses brand development belum cukup rapi.",
    required_artifacts: ["brief_brand", "progress_brand_development"],
    priority_reason:
      "Brand lead butuh kejelasan brief dan progres agar tidak merasa prosesnya menggantung.",
  }),

  post_payment_confirmation: Object.freeze({
    key: "post_payment_confirmation",
    gap_category: GAP_CATEGORY.post_payment,
    followup_gap:
      "Customer sudah terdengar seperti fase setelah pembayaran, tetapi bukti atau konfirmasi pembayaran belum cukup eksplisit.",
    required_artifacts: ["konfirmasi_pembayaran", "invoice"],
    priority_reason:
      "Sebelum bicara progress terlalu jauh, status pembayaran harus dipastikan agar informasi tetap akurat.",
  }),

  post_payment_progress: Object.freeze({
    key: "post_payment_progress",
    gap_category: GAP_CATEGORY.post_payment,
    followup_gap:
      "Status real-time order, ETA, progress, atau resi belum diberikan cukup jelas kepada customer pasca pembayaran.",
    required_artifacts: ["status_real_order", "eta", "resi_pengiriman"],
    priority_reason:
      "Setelah pembayaran, gap terbesar bukan lagi penawaran tetapi kejelasan progres dan kepastian langkah berikutnya.",
  }),

  post_payment_shipping: Object.freeze({
    key: "post_payment_shipping",
    gap_category: GAP_CATEGORY.post_payment,
    followup_gap:
      "Tahap pengiriman sudah dekat atau berjalan, tetapi konfirmasi resi dan update pengiriman belum tertib.",
    required_artifacts: ["resi_pengiriman"],
    priority_reason:
      "Di fase akhir, resi adalah artefak paling penting untuk menutup kecemasan customer dan mencegah follow-up berulang.",
  }),

  at_risk_proof: Object.freeze({
    key: "at_risk_proof",
    gap_category: GAP_CATEGORY.at_risk,
    followup_gap:
      "Customer sedang sensitif pada trust dan meminta bukti konkret, tetapi dokumentasi real order atau proof spesifik belum cukup jelas.",
    required_artifacts: ["proof_real_order", "foto_real_produk", "video_packing"],
    priority_reason:
      "Untuk at-risk, jawaban umum justru memperbesar keraguan. Gap prioritas tertingginya adalah bukti konkret.",
  }),

  at_risk_progress: Object.freeze({
    key: "at_risk_progress",
    gap_category: GAP_CATEGORY.at_risk,
    followup_gap:
      "Customer masih cemas pada progres, tetapi status real order, ETA, atau tahap berikutnya belum dijelaskan cukup konkret.",
    required_artifacts: ["status_real_order", "eta"],
    priority_reason:
      "Saat trust mulai goyah karena progres, update status real-time menjadi gap yang paling mendesak untuk ditutup.",
  }),

  at_risk_trust: Object.freeze({
    key: "at_risk_trust",
    gap_category: GAP_CATEGORY.at_risk,
    followup_gap:
      "Customer membutuhkan trust proof yang lebih konkret seperti rekening resmi, identitas perusahaan, atau bukti status proses.",
    required_artifacts: ["trust_proof_konkret"],
    priority_reason:
      "Pada lead at-risk, trust proof yang konkret lebih penting daripada memperpanjang penjelasan umum.",
  }),

  generic: Object.freeze({
    key: "generic",
    gap_category: GAP_CATEGORY.generic,
    followup_gap:
      "Masih ada informasi yang belum cukup terkunci untuk membuat next step customer benar-benar jelas.",
    required_artifacts: ["klarifikasi_gap_terdekat"],
    priority_reason:
      "Saat gap spesifik belum terbaca kuat, langkah paling aman adalah menutup kekosongan informasi yang paling dekat dengan tahap customer saat ini.",
  }),
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

/* ---------------------------------
   Public API
---------------------------------- */

/**
 * Peran file ini:
 * - membaca gap yang belum tertutup
 * - menentukan artifact apa yang kurang
 * - menjelaskan kenapa gap ini prioritas
 *
 * File ini tidak:
 * - menjadi planner
 * - override besar taxonomy final
 * - membuat template balasan baru
 */
export function detectFollowupGap(input = {}) {
  return buildFollowupGapBundle(input).final;
}

export function detectFollowupGapOnly(input = {}) {
  const bundle = buildFollowupGapBundle(input);

  return {
    followup_gap: bundle.final.followup_gap,
    required_artifacts: bundle.final.followup_meta?.required_artifacts || [],
    primary_artifact: bundle.final.followup_meta?.primary_artifact || "",
    gap_priority_reason: bundle.final.followup_meta?.gap_priority_reason || "",
    followup_meta: bundle.final.followup_meta || {},
  };
}

export function buildFollowupGapBundle(input = {}) {
  const context = sanitizeFollowupGapContext(input);
  const baseBundle = buildBaseAnalysisBundle(input, context);

  const baseAnalysis = normalizeUnifiedAnalysis(
    input.finalAnalysis ||
      input.prospectAnalysis ||
      input.stageAnalysis ||
      input.pipelineClassification ||
      baseBundle.final ||
      {}
  );

  const gapResolution = resolveFollowupGap({
    analysis: baseAnalysis,
    context,
  });

  const final = applyGapResolution({
    analysis: baseAnalysis,
    context,
    gapResolution,
  });

  return {
    context,
    pipelineClassification: baseBundle.pipelineClassification || null,
    stageAnalysis: baseBundle.stageAnalysis || null,
    prospectAnalysis: baseBundle.prospectAnalysis || null,
    finalAnalysis: baseAnalysis,
    gapResolution,
    final,
  };
}

export function resolveFollowupGap(input = {}) {
  const analysis = normalizeUnifiedAnalysis(
    input.analysis || input.finalAnalysis || {}
  );
  const context = sanitizeFollowupGapContext(input.context || input);
  const signals = deriveGapSignals({ analysis, context });

  if (analysis.pipeline === "no_respons") {
    return resolveNoResponseGap({ analysis, context, signals });
  }

  if (analysis.prospect_type === "at_risk") {
    return resolveAtRiskGap({ analysis, context, signals });
  }

  if (analysis.prospect_type === "post_payment") {
    return resolvePostPaymentGap({ analysis, context, signals });
  }

  if (analysis.prospect_type === "brand") {
    return resolveBrandGap({ analysis, context, signals });
  }

  if (analysis.prospect_type === "sample") {
    return resolveSampleGap({ analysis, context, signals });
  }

  return resolveQualificationGap({ analysis, context, signals });
}

/* ---------------------------------
   Base bundle bootstrap
---------------------------------- */

function buildBaseAnalysisBundle(input, context) {
  const src = asPlainObject(input);

  if (src.prospectBundle && typeof src.prospectBundle === "object") {
    return {
      final: src.prospectBundle.final || {},
      pipelineClassification:
        src.prospectBundle.pipelineClassification || null,
      stageAnalysis: src.prospectBundle.stageAnalysis || null,
      prospectAnalysis: src.prospectBundle.final || null,
    };
  }

  if (src.prospectAnalysis && typeof src.prospectAnalysis === "object") {
    return {
      final: src.prospectAnalysis,
      pipelineClassification: src.pipelineClassification || null,
      stageAnalysis: src.stageAnalysis || null,
      prospectAnalysis: src.prospectAnalysis,
    };
  }

  if (src.stageBundle && typeof src.stageBundle === "object") {
    const stageFinal = src.stageBundle.final || {};
    const prospectBundle = buildProspectTypeBundle({
      ...src,
      ...context,
      stageBundle: src.stageBundle,
      stageAnalysis: stageFinal,
      finalAnalysis: stageFinal,
    });

    return {
      final: prospectBundle.final || stageFinal,
      pipelineClassification:
        src.stageBundle.pipelineClassification || null,
      stageAnalysis: stageFinal,
      prospectAnalysis: prospectBundle.final || null,
    };
  }

  if (src.stageAnalysis && typeof src.stageAnalysis === "object") {
    const prospectBundle = buildProspectTypeBundle({
      ...src,
      ...context,
      stageAnalysis: src.stageAnalysis,
      finalAnalysis: src.stageAnalysis,
    });

    return {
      final: prospectBundle.final || src.stageAnalysis,
      pipelineClassification: src.pipelineClassification || null,
      stageAnalysis: src.stageAnalysis,
      prospectAnalysis: prospectBundle.final || null,
    };
  }

  if (
    src.pipelineClassificationBundle &&
    typeof src.pipelineClassificationBundle === "object"
  ) {
    const pipelineFinal = src.pipelineClassificationBundle.final || {};

    const stageBundle = buildSopStageBundle({
      ...src,
      ...context,
      pipelineClassificationBundle: src.pipelineClassificationBundle,
      pipelineClassification: pipelineFinal,
      finalAnalysis: pipelineFinal,
    });

    const stageFinal = stageBundle.final || pipelineFinal;

    const prospectBundle = buildProspectTypeBundle({
      ...src,
      ...context,
      pipelineClassificationBundle: src.pipelineClassificationBundle,
      pipelineClassification: pipelineFinal,
      stageBundle,
      stageAnalysis: stageFinal,
      finalAnalysis: stageFinal,
    });

    return {
      final: prospectBundle.final || stageFinal,
      pipelineClassification: pipelineFinal,
      stageAnalysis: stageFinal,
      prospectAnalysis: prospectBundle.final || null,
    };
  }

  if (src.pipelineClassification && typeof src.pipelineClassification === "object") {
    const stageBundle = buildSopStageBundle({
      ...src,
      ...context,
      pipelineClassification: src.pipelineClassification,
      finalAnalysis: src.pipelineClassification,
    });

    const stageFinal = stageBundle.final || src.pipelineClassification;

    const prospectBundle = buildProspectTypeBundle({
      ...src,
      ...context,
      pipelineClassification: src.pipelineClassification,
      stageBundle,
      stageAnalysis: stageFinal,
      finalAnalysis: stageFinal,
    });

    return {
      final: prospectBundle.final || stageFinal,
      pipelineClassification: src.pipelineClassification,
      stageAnalysis: stageFinal,
      prospectAnalysis: prospectBundle.final || null,
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

  const stageFinal = stageBundle.final || pipelineBundle.final || {};

  const prospectBundle = buildProspectTypeBundle({
    ...src,
    ...context,
    pipelineClassificationBundle: pipelineBundle,
    pipelineClassification: pipelineBundle.final,
    stageBundle,
    stageAnalysis: stageFinal,
    finalAnalysis: stageFinal,
  });

  return {
    final: prospectBundle.final || stageFinal,
    pipelineClassification: pipelineBundle.final || null,
    stageAnalysis: stageFinal,
    prospectAnalysis: prospectBundle.final || null,
  };
}

/* ---------------------------------
   Gap resolvers
---------------------------------- */

function resolveNoResponseGap({ analysis, context, signals }) {
  const stage = normalizeSopStage(analysis.sop_stage_current);
  const followupType =
    FOLLOWUP_STAGE_TO_TYPE[stage] ||
    safeString(context.last_followup_type || "") ||
    signals.followup_type;

  const gapKey = FOLLOWUP_TYPE_TO_GAP_KEY[followupType] || getDefaultNoResponseGapKey();

  return buildGapResolutionFromKey(gapKey, {
    analysis,
    signals,
    reason:
      stage.startsWith("followup_")
        ? "no_respons_stage_gap"
        : followupType
          ? "no_respons_followup_type_gap"
          : "no_respons_default_gap",
    evidence: compactStrings([
      stage,
      followupType ? `followup_type:${followupType}` : "",
      analysis.pipeline === "no_respons" ? "pipeline:no_respons" : "",
    ]),
    note:
      !followupType && !stage.startsWith("followup_")
        ? "Urutan no respons dipilih dari default SOP karena riwayat follow-up terakhir belum cukup eksplisit."
        : "",
  });
}

function resolveQualificationGap({ analysis, context, signals }) {
  void context;

  if (signals.needs_legality_detail) {
    return buildGapResolutionFromKey("qualification_legality_detail", {
      analysis,
      signals,
      reason: "qualification_legality_gap",
      evidence: compactStrings(["signal:legality_detail", analysis.intent, analysis.emotion]),
    });
  }

  if (signals.needs_sample_comparison) {
    return buildGapResolutionFromKey("qualification_sample_comparison", {
      analysis,
      signals,
      reason: "qualification_sample_comparison_gap",
      evidence: compactStrings(["signal:sample_comparison", analysis.intent, analysis.emotion]),
    });
  }

  if (signals.needs_budget_scenario) {
    return buildGapResolutionFromKey("qualification_budget_scenario", {
      analysis,
      signals,
      reason: "qualification_budget_gap",
      evidence: compactStrings(["signal:budget_scenario", analysis.intent, analysis.emotion]),
    });
  }

  if (signals.needs_analytical_breakdown) {
    return buildGapResolutionFromKey("qualification_analytical_breakdown", {
      analysis,
      signals,
      reason: "qualification_analytical_gap",
      evidence: compactStrings(["signal:analytical_breakdown", analysis.intent, analysis.emotion]),
    });
  }

  if (signals.needs_visual_proof) {
    return buildGapResolutionFromKey("qualification_visual_proof", {
      analysis,
      signals,
      reason: "qualification_visual_gap",
      evidence: compactStrings(["signal:visual_proof", analysis.intent, analysis.emotion]),
    });
  }

  if (signals.needs_package_detail) {
    return buildGapResolutionFromKey("qualification_package_detail", {
      analysis,
      signals,
      reason: "qualification_package_detail_gap",
      evidence: compactStrings(["signal:package_detail", analysis.sop_stage_current]),
    });
  }

  if (signals.needs_purchase_lock) {
    return buildGapResolutionFromKey("qualification_purchase_lock", {
      analysis,
      signals,
      reason: "qualification_purchase_lock_gap",
      evidence: compactStrings(["signal:purchase_lock", analysis.pipeline, analysis.behaviour_stage]),
    });
  }

  if (safeString(analysis.followup_gap)) {
    return {
      gap_key: "preserve_existing_gap",
      gap_category: GAP_CATEGORY.qualification,
      followup_gap: safeString(analysis.followup_gap),
      required_artifacts: resolveArtifactsFromAnalysis(analysis),
      primary_artifact: firstArrayItem(resolveArtifactsFromAnalysis(analysis)) || "",
      gap_priority_reason:
        "Gap existing dari final analysis dipertahankan karena belum ada sinyal baru yang lebih spesifik.",
      reason: "preserve_existing_gap",
      evidence: compactStrings(["existing_followup_gap", analysis.sop_stage_current]),
      note: "",
      source: "analysis",
    };
  }

  return buildGapResolutionFromKey("generic", {
    analysis,
    signals,
    reason: "qualification_generic_gap",
    evidence: compactStrings(["signal:generic", analysis.sop_stage_current, analysis.sop_stage_next]),
  });
}

function resolveSampleGap({ analysis, context, signals }) {
  void signals;

  if (!context.has_invoice_sent && !context.has_dp_paid) {
    return buildGapResolutionFromKey("sample_invoice", {
      analysis,
      reason: "sample_before_invoice_gap",
      evidence: compactStrings(["sample_path", "missing:invoice_or_dp"]),
      note: "Gap sample dipilih dari jalur final karena administrasi sample belum terlihat.",
    });
  }

  if (context.has_invoice_sent && !context.has_dp_paid) {
    return {
      gap_key: "sample_invoice_pending",
      gap_category: GAP_CATEGORY.sample,
      followup_gap:
        "Invoice sample sudah bergerak, tetapi konfirmasi pembayaran atau kelanjutannya belum terkunci.",
      required_artifacts: ["konfirmasi_invoice_sample", "bukti_pembayaran_sample"],
      primary_artifact: "konfirmasi_invoice_sample",
      gap_priority_reason:
        "Setelah invoice sample dikirim, hambatan terdekat biasanya ada pada kepastian customer untuk melanjutkan pembayaran.",
      reason: "sample_invoice_pending_gap",
      evidence: compactStrings(["sample_path", "state:invoice_sent", "missing:dp_paid"]),
      note: "",
      source: "fallback",
    };
  }

  return buildGapResolutionFromKey("sample_progress", {
    analysis,
    reason: "sample_progress_gap",
    evidence: compactStrings(["sample_path", analysis.sop_stage_current]),
    note: "",
  });
}

function resolveBrandGap({ analysis, context, signals }) {
  void signals;

  if (!context.has_form_sent && !context.has_form_filled) {
    return buildGapResolutionFromKey("brand_form", {
      analysis,
      reason: "brand_form_missing_gap",
      evidence: compactStrings(["brand_path", "missing:form"]),
      note: "Jalur brand sudah terdeteksi, tetapi status form masih belum eksplisit.",
    });
  }

  if (
    (context.has_form_sent || context.has_form_filled) &&
    !context.has_dp_paid &&
    !context.has_invoice_sent
  ) {
    return buildGapResolutionFromKey("brand_dp_invoice", {
      analysis,
      reason: "brand_dp_invoice_gap",
      evidence: compactStrings(["brand_path", "state:form_ready", "missing:dp_or_invoice"]),
      note: "",
    });
  }

  return buildGapResolutionFromKey("brand_development", {
    analysis,
    reason: "brand_development_gap",
    evidence: compactStrings(["brand_path", analysis.sop_stage_current]),
    note: "",
  });
}

function resolvePostPaymentGap({ analysis, context, signals }) {
  void signals;

  if (!context.has_dp_paid && !context.has_invoice_sent && !context.has_resi_sent) {
    return buildGapResolutionFromKey("post_payment_confirmation", {
      analysis,
      reason: "post_payment_confirmation_gap",
      evidence: compactStrings(["post_payment_path", "missing:payment_confirmation"]),
      note:
        "Fase post-payment terutama dibaca dari pola final analysis atau stage, bukan hanya bukti state pembayaran.",
    });
  }

  if (!context.has_resi_sent) {
    return buildGapResolutionFromKey("post_payment_progress", {
      analysis,
      reason: "post_payment_progress_gap",
      evidence: compactStrings(["post_payment_path", "missing:resi"]),
      note: "",
    });
  }

  return buildGapResolutionFromKey("post_payment_shipping", {
    analysis,
    reason: "post_payment_shipping_gap",
    evidence: compactStrings(["post_payment_path", "state:resi_sent"]),
    note: "",
  });
}

function resolveAtRiskGap({ analysis, context, signals }) {
  if (!context.has_product_proof_sent || signals.current_stage === "proof_before_pelunasan") {
    return buildGapResolutionFromKey("at_risk_proof", {
      analysis,
      reason: "at_risk_proof_gap",
      evidence: compactStrings(["at_risk_path", "missing:product_proof"]),
      note: "Status at-risk dipilih konservatif karena ada sinyal trust, progress, atau proof seeking.",
    });
  }

  if (!context.has_resi_sent && (context.has_dp_paid || context.has_invoice_sent)) {
    return buildGapResolutionFromKey("at_risk_progress", {
      analysis,
      reason: "at_risk_progress_gap",
      evidence: compactStrings(["at_risk_path", "missing:resi_or_progress_clarity"]),
      note: "",
    });
  }

  return buildGapResolutionFromKey("at_risk_trust", {
    analysis,
    reason: "at_risk_trust_gap",
    evidence: compactStrings(["at_risk_path", "need:trust_proof"]),
    note: "",
  });
}

/* ---------------------------------
   Final application
---------------------------------- */

function applyGapResolution({ analysis, context, gapResolution }) {
  const base = normalizeUnifiedAnalysis(analysis);

  const resolvedGap = safeString(gapResolution.followup_gap) || safeString(base.followup_gap);
  const requiredArtifacts = uniqueStrings([
    ...toStringArray(gapResolution.required_artifacts),
    ...resolveArtifactsFromAnalysis(base),
  ]);

  const primaryArtifact =
    safeString(gapResolution.primary_artifact) ||
    firstArrayItem(requiredArtifacts) ||
    "";

  const uncertaintyNote = mergeNotes(
    base.uncertainty_note,
    safeString(gapResolution.note || ""),
    buildFollowupGapUncertaintyNote({
      analysis: base,
      context,
      gapResolution,
    })
  );

  return normalizeUnifiedAnalysis({
    ...base,
    followup_gap: resolvedGap,
    uncertainty_note: uncertaintyNote,
    followup_meta: {
      ...sanitizePlainObject(base.followup_meta),
      gap_key: safeString(gapResolution.gap_key || ""),
      gap_category: safeString(gapResolution.gap_category || GAP_CATEGORY.generic),
      gap_priority_reason: safeString(gapResolution.gap_priority_reason || ""),
      required_artifacts: requiredArtifacts,
      primary_artifact: primaryArtifact,
      reason: safeString(gapResolution.reason || "followup_gap_resolution"),
      evidence: toStringArray(gapResolution.evidence),
      source: safeString(gapResolution.source || "fallback"),
      route_target: resolvePipelineRouteTarget(base.pipeline),
      current_stage: normalizeSopStage(base.sop_stage_current),
      next_stage: normalizeSopStage(base.sop_stage_next),
    },
  });
}

/* ---------------------------------
   Gap signal derivation
---------------------------------- */

function deriveGapSignals({ analysis, context }) {
  const latestText = safeString(
    context.latest_customer_text || context.customer_message || ""
  ).toLowerCase();

  const currentStage = normalizeSopStage(analysis.sop_stage_current);
  const nextStage = normalizeSopStage(analysis.sop_stage_next);
  const pipeline = normalizePipeline(analysis.pipeline);
  const intent = normalizeIntent(analysis.intent);
  const emotion = normalizeEmotion(analysis.emotion);
  const behaviourStage = normalizeBehaviourStage(analysis.behaviour_stage);
  const prospectType = normalizeProspectType(analysis.prospect_type);

  const statusFlags = sanitizeStatusFlags(analysis.status_flags);
  const bubbleMetrics = sanitizeBubbleMetrics(analysis.bubble_metrics);
  const sopSignals = sanitizeSopSignals(analysis.sop_signals);

  const followupType =
    safeString(context.last_followup_type) ||
    FOLLOWUP_STAGE_TO_TYPE[currentStage] ||
    inferFollowupTypeFromLastAction(context.last_cs_action) ||
    "";

  const needsLegalityDetail =
    intent === "trust" ||
    emotion === "trust_seeking" ||
    Boolean(sopSignals.legality_bpom) ||
    containsAny(latestText, [
      "bpom",
      "legalitas",
      "izin",
      "dokumen",
      "surat bpom",
      "menginduk",
    ]);

  const needsSampleComparison =
    prospectType === "sample" ||
    intent === "trial" ||
    emotion === "risk_aversion" ||
    Boolean(sopSignals.sample_vs_produksi) ||
    containsAny(latestText, [
      "sample",
      "sampel",
      "tester",
      "beda sample",
      "langsung produksi",
      "mau coba dulu",
    ]);

  const needsBudgetScenario =
    intent === "price" ||
    intent === "price_process" ||
    emotion === "budget_concern" ||
    Boolean(sopSignals.budget_concern) ||
    containsAny(latestText, [
      "budget",
      "modal",
      "kalkulasi",
      "low keuangan",
      "pertimbangan matang",
    ]);

  const needsAnalyticalBreakdown =
    intent === "price_process" ||
    emotion === "analytical_thinking" ||
    Boolean(sopSignals.analytical_quantity_mix) ||
    containsAny(latestText, [
      "harga per item",
      "komposisi item",
      "mix qty",
      "day cream",
      "night cream",
      "toner",
      "serum",
      "facial wash",
      "meliputi",
    ]);

  const needsVisualProof =
    emotion === "visual_validation" ||
    Boolean(sopSignals.visual_validation) ||
    containsAny(latestText, [
      "foto",
      "video",
      "tekstur",
      "warna isi",
      "packing",
      "desain",
      "lihat hasil",
    ]);

  const needsPackageDetail =
    currentStage === "harga_paket_terkirim" ||
    containsAny(latestText, [
      "1 paket",
      "5 item",
      "100 pcs",
      "100 pc",
      "isinya apa",
      "beda reguler",
      "silver",
      "gold",
    ]);

  const needsPurchaseLock =
    pipeline === "prospek" &&
    prospectType === "none" &&
    behaviourStage === "decision";

  return {
    pipeline,
    intent,
    emotion,
    behaviour_stage: behaviourStage,
    prospect_type: prospectType,
    current_stage: currentStage,
    next_stage: nextStage,
    followup_type: followupType,
    brand_channel: normalizeBrandChannel(context.brand_channel),
    status_flags: statusFlags,
    bubble_metrics: bubbleMetrics,
    sop_signals: sopSignals,
    needs_legality_detail: needsLegalityDetail,
    needs_sample_comparison: needsSampleComparison,
    needs_budget_scenario: needsBudgetScenario,
    needs_analytical_breakdown: needsAnalyticalBreakdown,
    needs_visual_proof: needsVisualProof,
    needs_package_detail: needsPackageDetail,
    needs_purchase_lock: needsPurchaseLock,
  };
}

/* ---------------------------------
   Gap definition bridge
---------------------------------- */

function buildGapResolutionFromKey(gapKey, meta = {}) {
  const definition = resolveGapDefinition(gapKey);

  return {
    gap_key: safeString(definition.key || gapKey),
    gap_category: safeString(definition.gap_category || GAP_CATEGORY.generic),
    followup_gap: safeString(definition.followup_gap || ""),
    required_artifacts: uniqueStrings(
      toStringArray(definition.required_artifacts || definition.artifacts)
    ),
    primary_artifact:
      safeString(definition.primary_artifact || "") ||
      firstArrayItem(toStringArray(definition.required_artifacts || definition.artifacts)) ||
      "",
    gap_priority_reason: safeString(definition.priority_reason || ""),
    reason: safeString(meta.reason || definition.reason || "followup_gap_resolution"),
    evidence: toStringArray(meta.evidence),
    note: safeString(meta.note || ""),
    source: safeString(definition.source || "fallback"),
  };
}

function resolveGapDefinition(key) {
  const safeKey = safeString(key);
  const fromRules = findRuleGapDefinition(safeKey);
  if (fromRules) {
    return {
      key: safeKey,
      gap_category: safeString(fromRules.gap_category || GAP_CATEGORY.generic),
      followup_gap: safeString(fromRules.followup_gap || ""),
      required_artifacts: uniqueStrings(
        toStringArray(
          fromRules.required_artifacts ||
            fromRules.artifacts ||
            fromRules.next_required_artifact
        )
      ),
      primary_artifact:
        safeString(fromRules.primary_artifact || fromRules.next_required_artifact || ""),
      priority_reason: safeString(fromRules.priority_reason || ""),
      source: "rules",
    };
  }

  const fallback = FALLBACK_GAP_DEFINITIONS[safeKey] || FALLBACK_GAP_DEFINITIONS.generic;
  return {
    ...fallback,
    source: "fallback",
  };
}

function findRuleGapDefinition(key) {
  const catalogs = [
    RULES_ANY["FOLLOWUP_GAP_DEFINITIONS"],
    RULES_ANY["GAP_DEFINITIONS"],
    RULES_ANY["SOP_GAP_DEFINITIONS"],
    RULES_ANY["GAP_RULES"],
  ].filter(Boolean);

  for (const catalog of catalogs) {
    if (Array.isArray(catalog)) {
      const found = catalog.find(
        (item) =>
          safeString(item?.key) === key ||
          safeString(item?.id) === key ||
          safeString(item?.gap_key) === key
      );
      if (found) return found;
    }

    if (catalog && typeof catalog === "object" && catalog[key]) {
      return catalog[key];
    }
  }

  if (typeof RULES_ANY["getFollowupGapDefinition"] === "function") {
    const found = RULES_ANY["getFollowupGapDefinition"](key);
    if (found) return found;
  }

  return null;
}

function resolveArtifactsFromAnalysis(analysis) {
  const artifacts = [];

  const followupMetaArtifacts = toStringArray(
    analysis.followup_meta?.required_artifacts
  );
  artifacts.push(...followupMetaArtifacts);

  if (typeof RULES_ANY["getRequiredArtifactsForGap"] === "function") {
    artifacts.push(
      ...toStringArray(
        RULES_ANY["getRequiredArtifactsForGap"](
          safeString(analysis.followup_meta?.gap_key || "")
        )
      )
    );
  }

  if (typeof RULES_ANY["getRequiredArtifactsForStage"] === "function") {
    artifacts.push(
      ...toStringArray(
        RULES_ANY["getRequiredArtifactsForStage"](normalizeSopStage(analysis.sop_stage_current))
      )
    );
  }

  if (typeof RULES_ANY["getSopStageConfig"] === "function") {
    const stageConfig = RULES_ANY["getSopStageConfig"](normalizeSopStage(analysis.sop_stage_current));
    if (stageConfig && typeof stageConfig === "object") {
      artifacts.push(
        ...toStringArray(
          stageConfig.required_artifacts ||
            stageConfig.artifacts ||
            stageConfig.requiredArtifacts
        )
      );
    }
  }

  const stageCatalogs = [
    RULES_ANY["SOP_STAGE_DEFINITIONS"],
    RULES_ANY["SOP_STAGE_RULES"],
    RULES_ANY["SOP_STAGE_MAP"],
  ].filter(Boolean);

  for (const catalog of stageCatalogs) {
    const stage = normalizeSopStage(analysis.sop_stage_current);
    const found =
      Array.isArray(catalog)
        ? catalog.find(
            (item) =>
              safeString(item?.stage) === stage ||
              safeString(item?.id) === stage ||
              safeString(item?.key) === stage
          )
        : catalog?.[stage];

    if (found) {
      artifacts.push(
        ...toStringArray(
          found.required_artifacts || found.artifacts || found.requiredArtifacts
        )
      );
    }
  }

  return uniqueStrings(artifacts);
}

/* ---------------------------------
   Helpers
---------------------------------- */

function getDefaultNoResponseGapKey() {
  const firstSeq = Array.isArray(NO_RESPONSE_FOLLOWUP_SEQUENCE)
    ? NO_RESPONSE_FOLLOWUP_SEQUENCE[0]
    : null;

  if (firstSeq?.type && FOLLOWUP_TYPE_TO_GAP_KEY[firstSeq.type]) {
    return FOLLOWUP_TYPE_TO_GAP_KEY[firstSeq.type];
  }

  if (firstSeq?.stage && FOLLOWUP_STAGE_TO_TYPE[firstSeq.stage]) {
    return FOLLOWUP_TYPE_TO_GAP_KEY[FOLLOWUP_STAGE_TO_TYPE[firstSeq.stage]];
  }

  return "no_response_contoh_produk";
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

  if (getNoResponseFollowupByType && typeof getNoResponseFollowupByType === "function") {
    const direct = getNoResponseFollowupByType(text);
    if (direct?.type) return safeString(direct.type);
  }

  return "";
}

function buildFollowupGapUncertaintyNote({ analysis, context, gapResolution }) {
  const notes = [];

  if (
    analysis.pipeline === "no_respons" &&
    !context.last_cs_action &&
    !context.last_followup_type &&
    gapResolution.gap_category === GAP_CATEGORY.no_respons
  ) {
    notes.push(
      "Gap no respons dipilih dari default SOP karena riwayat follow-up terakhir belum cukup eksplisit."
    );
  }

  if (
    analysis.prospect_type === "brand" &&
    !context.has_form_sent &&
    !context.has_form_filled &&
    safeString(gapResolution.primary_artifact) === "form_brand_development"
  ) {
    notes.push("Jalur brand sudah terdeteksi, tetapi status form masih belum eksplisit.");
  }

  if (
    analysis.prospect_type === "sample" &&
    !context.has_invoice_sent &&
    gapResolution.gap_key === "sample_invoice"
  ) {
    notes.push("Gap sample dipilih dari jalur final karena administrasi sample belum terlihat.");
  }

  if (
    analysis.prospect_type === "post_payment" &&
    !context.has_dp_paid &&
    !context.has_invoice_sent &&
    !context.has_resi_sent
  ) {
    notes.push("Fase post-payment terutama dibaca dari pola final analysis atau stage.");
  }

  if (
    analysis.prospect_type === "at_risk" &&
    !context.is_at_risk &&
    !context.has_product_proof_sent
  ) {
    notes.push("Status at-risk dipilih konservatif karena ada sinyal trust, progress, atau proof seeking.");
  }

  return notes.join(" ");
}

/* ---------------------------------
   Normalization
---------------------------------- */

function sanitizeFollowupGapContext(input = {}) {
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
  };
}

/* ---------------------------------
   Sanitizers
---------------------------------- */

function sanitizeStatusFlags(input) {
  const raw = asPlainObject(input);
  return {
    ...EMPTY_STATUS_FLAGS,
    is_sample_direction: Boolean(raw.is_sample_direction),
    is_brand_direction: Boolean(raw.is_brand_direction),
    is_post_payment: Boolean(raw.is_post_payment),
    is_at_risk: Boolean(raw.is_at_risk),
    customer_bubble_gt_5: Boolean(raw.customer_bubble_gt_5),
  };
}

function sanitizeBubbleMetrics(input) {
  const raw = asPlainObject(input);
  return {
    ...EMPTY_BUBBLE_METRICS,
    customer_bubble_count: toSafeNumber(raw.customer_bubble_count),
    agent_bubble_count: toSafeNumber(raw.agent_bubble_count),
    customer_bubble_gt_5: Boolean(
      raw.customer_bubble_gt_5 || toSafeNumber(raw.customer_bubble_count) > 5
    ),
  };
}

function sanitizeSopSignals(input) {
  const raw = asPlainObject(input);
  return {
    ...EMPTY_SOP_SIGNALS,
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

function compactStrings(values) {
  return uniqueStrings(
    (Array.isArray(values) ? values : [])
      .map((item) => safeString(item))
      .filter(Boolean)
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

function mergeNotes(...values) {
  return uniqueStrings(
    (Array.isArray(values) ? values : [])
      .map((value) => safeString(value))
      .filter(Boolean)
  ).join(" ");
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