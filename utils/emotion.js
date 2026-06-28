// long-wildflower-7606/utils/emotion.js

import { inferEmotionsFallback } from "../generate_ai_backup/fallback_two/fallback_two.js";
import { safeText } from "./text.js";

/**
 * Normalisasi emosi lokal/fallback ke format emotion analysis final.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeLocalEmotionToAnalysis(text) {
  const local = inferEmotionsFallback(text || "");
  const first =
    Array.isArray(local) && local.length > 0
      ? safeText(String(local[0] || ""), 80).toLowerCase()
      : "";

  const mapped = normalizeFallbackEmotionValue(first);
  if (mapped && mapped !== "unknown") {
    return mapped;
  }

  return inferEmotionHeuristicallyFromText(text);
}

/**
 * Mapping emotion fallback lokal ke emotion analysis final.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeFallbackEmotionValue(value) {
  switch (String(value || "").toLowerCase()) {
    case "curiosity":
    case "discovery":
    case "interest":
    case "creative_involvement":
    case "trust_seeking":
    case "visual_validation":
    case "analytical_thinking":
    case "profit_calculation":
    case "business_planning":
    case "negotiation":
    case "excitement":
    case "business_motivation":
    case "sample_evaluation":
    case "busy_delay":
    case "future_intention":
    case "technical_curiosity":
    case "formula_compatibility":
    case "competitor_awareness":
    case "business_insight":
    case "marketing_expectation":
    case "product_complaint":
    case "product_safety_concern":
    case "unknown":
      return String(value || "").toLowerCase();

    case "penasaran":
      return "curiosity";
    case "ragu":
      return "trust_seeking";
    case "urgent":
      return "excitement";
    case "marah":
      return "product_complaint";
    case "senang":
      return "interest";
    case "bingung":
      return "curiosity";
    default:
      return "";
  }
}

/**
 * Heuristik emotion berbasis isi pesan customer.
 *
 * @param {string} text
 * @returns {string}
 */
export function inferEmotionHeuristicallyFromText(text) {
  const t = String(text || "").toLowerCase();

  if (/\b(komplain|keluhan|rusak|bocor|cacat|tidak sesuai|bermasalah)\b/.test(t)) {
    return "product_complaint";
  }

  if (/\b(iritasi|breakout|gatal|perih|bruntusan|reaksi kulit)\b/.test(t)) {
    return "product_safety_concern";
  }

  if (/\b(refund|retur|pengembalian dana|uang kembali)\b/.test(t)) {
    return "trust_seeking";
  }

  if (/\b(foto|video|lihat hasil|before after|contoh kemasan|real pict)\b/.test(t)) {
    return "visual_validation";
  }

  if (/\b(komposisi|kandungan|bahan aktif|formula|tekstur|ph|stabilitas)\b/.test(t)) {
    return "technical_curiosity";
  }

  if (/\b(cocok|kompatibel|kulit sensitif|dempul|lengket)\b/.test(t)) {
    return "formula_compatibility";
  }

  if (/\b(margin|profit|keuntungan|hpp|roi|balik modal|harga jual)\b/.test(t)) {
    return "profit_calculation";
  }

  if (/\b(target market|produk yang laku|marketing|positioning)\b/.test(t)) {
    return "marketing_expectation";
  }

  if (/\b(belum cair|pending bayar|bayar nanti|dp nanti|masih sibuk|tunda dulu|bulan depan)\b/.test(t)) {
    return "busy_delay";
  }

  if (/\b(sample|tester|uji sample|minta sample|kirim sample)\b/.test(t)) {
    return "sample_evaluation";
  }

  if (/\b(kompetitor|brand lain|merek lain|dibanding)\b/.test(t)) {
    return "competitor_awareness";
  }

  if (/\b(brand sendiri|private label|mau bikin brand|target market)\b/.test(t)) {
    return "business_planning";
  }

  if (/\b(reseller|mau jualan|usaha skincare)\b/.test(t)) {
    return "business_motivation";
  }

  if (/\b(mau lanjut|siap order|deal|siap dp|transfer dp|langsung bayar)\b/.test(t)) {
    return "excitement";
  }

  if (/\b(bpom|legalitas|izin|sertifikat|aman tidak|aman ga|aman nggak)\b/.test(t)) {
    return "trust_seeking";
  }

  if (/\b(produk apa|mau bikin|harga|sample|legalitas)\b/.test(t)) {
    return "interest";
  }

  if (t.trim()) {
    return "curiosity";
  }

  return "unknown";
}