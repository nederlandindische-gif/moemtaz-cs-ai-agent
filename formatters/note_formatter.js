// formatters/note_formatter.js

import { safeText, safeMultilineText } from "../utils/text.js";
import { safePercent } from "../utils/collection.js";

const NOTE_MAX_LEN = 5000;
const SECTION_SEPARATOR = "────────────────────";

const NOTE_PUBLISH_STRATEGY = Object.freeze({
  single_canonical_note: "single_canonical_note",
  multi_note_legacy: "multi_note_legacy",
});

function firstNonEmpty(values, fallback = "") {
  const arr = Array.isArray(values) ? values : [];
  for (const value of arr) {
    const text = safeText(String(value || ""), 2000).trim();
    if (text) return text;
  }
  return fallback;
}

function normalizeToken(value, fallback = "-") {
  const raw = firstNonEmpty([value], "");
  if (!raw) return fallback;
  return raw.replace(/\s+/g, " ").trim();
}

function humanizeToken(value, fallback = "-") {
  const raw = normalizeToken(value, "");
  if (!raw) return fallback;

  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function compactMultiline(value, maxLen = 1200, fallback = "-") {
  const text = safeMultilineText(String(value || ""), maxLen)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return text || fallback;
}

function toUniqueTextArray(value, maxItemLen = 160) {
  const arr = Array.isArray(value)
    ? value.map((item) => safeText(String(item || ""), maxItemLen).trim()).filter(Boolean)
    : typeof value === "string" && value.trim()
      ? [safeText(value, maxItemLen).trim()]
      : [];

  return [...new Set(arr)];
}

function formatArtifacts(value, fallback = "-") {
  const arr = toUniqueTextArray(value, 160)
    .map((item) => humanizeToken(item, ""))
    .filter(Boolean);

  return arr.length ? [...new Set(arr)].join(", ") : fallback;
}

function pushField(lines, label, value, fallback = "-") {
  const safeLabel = safeText(String(label || ""), 120).trim();
  const safeValue = firstNonEmpty([value], fallback);
  lines.push(`${safeLabel}: ${safeValue || fallback}`);
}

function buildSection(title, lines) {
  const safeTitle = safeText(String(title || ""), 120).trim() || "Section";
  const bodyLines = Array.isArray(lines)
    ? lines.map((line) => safeMultilineText(String(line || ""), 2000).trim()).filter(Boolean)
    : [compactMultiline(lines, 2500, "-")];

  return [
    SECTION_SEPARATOR,
    safeTitle,
    SECTION_SEPARATOR,
    ...(bodyLines.length ? bodyLines : ["-"]),
  ].join("\n");
}

function buildMinimalCanonicalFallbackNote(payload) {
  const p = asPayload(payload);

  return [
    "🤖 Workflow SOP Analysis",
    "",
    `Suggested Reply: ${compactMultiline(p?.suggested_response, 1000, "-")}`,
    `Tindakan CS: ${compactMultiline(p?.cs_action, 1000, "-")}`,
    `Confidence: ${safePercent(p?.confidence_score, 20)}%`,
    `Route target: ${normalizeToken(p?.route_target, "-")}`,
    `Plan type final: ${humanizeToken(p?.plan_type_final, "-")}`,
    `Execute mode final: ${humanizeToken(p?.execute_mode_final, "-")}`,
    `Required artifacts final: ${formatArtifacts(p?.required_artifacts_final, "-")}`,
    `Next required artifact: ${formatArtifacts(
      p?.next_required_artifact ? [p.next_required_artifact] : [],
      "-"
    )}`,
  ].join("\n");
}

function buildMinimalAnalysisFallbackNote(payload) {
  const p = asPayload(payload);

  return [
    "💬 Suggested Reply Analysis",
    "",
    `Intent: ${humanizeToken(p?.intent, "Unknown")}`,
    `Emotion: ${humanizeToken(p?.emotion, "Unknown")}`,
    `Behaviour stage: ${humanizeToken(p?.behaviour_stage, "Curiosity")}`,
    `Lead level: ${humanizeToken(p?.lead_level_stage || p?.lead_level, "Cold")}`,
    `Pipeline: ${humanizeToken(p?.pipeline, "Respons")}`,
    `Prospect type: ${humanizeToken(p?.prospect_type, "None")}`,
    `Confidence: ${safePercent(p?.confidence_score, 20)}%`,
    `Route target: ${normalizeToken(p?.route_target, "-")}`,
  ].join("\n");
}

function buildMinimalContentFallbackNote(payload) {
  const p = asPayload(payload);

  return [
    "💬 Suggested Reply Content",
    "",
    `Suggested Reply: ${compactMultiline(p?.suggested_response, 1000, "-")}`,
    `Tindakan CS: ${compactMultiline(p?.cs_action, 1000, "-")}`,
    `Plan type final: ${humanizeToken(p?.plan_type_final, "-")}`,
    `Execute mode final: ${humanizeToken(p?.execute_mode_final, "-")}`,
    `Next required artifact: ${formatArtifacts(
      p?.next_required_artifact ? [p.next_required_artifact] : [],
      "-"
    )}`,
  ].join("\n");
}

function finalizeNote(text, fallbackText = "") {
  const cleaned = safeMultilineText(
    String(text || "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    NOTE_MAX_LEN
  );

  if (cleaned) return cleaned;

  const fallback = safeMultilineText(
    String(fallbackText || "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    NOTE_MAX_LEN
  );

  if (fallback) return fallback;

  return safeText("🤖 Workflow SOP Analysis\n\nNo content available.", NOTE_MAX_LEN);
}

function asPayload(result) {
  return result && typeof result === "object" ? result : {};
}

function getNotePublishStrategy(payload) {
  const raw = safeText(String(payload?.note_publish_strategy || ""), 80)
    .toLowerCase()
    .trim();

  return raw || NOTE_PUBLISH_STRATEGY.single_canonical_note;
}

/**
 * Dipakai oleh layer output/service.
 * Jika false, jangan kirim auxiliary notes lagi.
 * @param {Record<string, any> | null | undefined} payload
 * @returns {boolean}
 */
export function shouldPublishAuxiliarySuggestedReplyNotes(payload) {
  const strategy = getNotePublishStrategy(asPayload(payload));
  return strategy !== NOTE_PUBLISH_STRATEGY.single_canonical_note;
}

function formatCanonicalAnalysisSection(result) {
  const buyingStage = humanizeToken(
    result?.buying_stage ||
      result?.behaviour_stage ||
      result?.stage ||
      "",
    "Evaluation"
  );

  const intent = humanizeToken(result?.intent, "Unknown");
  const emotion = humanizeToken(result?.emotion, "Unknown");
  const behaviourStage = humanizeToken(result?.behaviour_stage, "Curiosity");
  const leadLevel = humanizeToken(
    result?.lead_level_stage || result?.lead_level,
    "Cold"
  );
  const conversionRate = safePercent(result?.conversion_rate_analyzed, 20);

  const lines = [];
  pushField(lines, "Buying stage", buyingStage);
  pushField(lines, "Intent", intent);
  pushField(lines, "Emotion", emotion);
  pushField(lines, "Behaviour stage", behaviourStage);
  pushField(lines, "Lead level", leadLevel);
  pushField(lines, "Conversion", `${conversionRate}%`);

  return lines;
}

function formatCanonicalPipelineSection(result) {
  const pipeline = humanizeToken(result?.pipeline, "Respons");
  const prospectType = humanizeToken(result?.prospect_type, "None");
  const priority = humanizeToken(
    result?.priority_level || result?.priority,
    "Medium"
  );
  const routeTarget = normalizeToken(result?.route_target, "-");

  const lines = [];
  pushField(lines, "Pipeline", pipeline);
  pushField(lines, "Prospect type", prospectType);
  pushField(lines, "Priority", priority);
  pushField(lines, "Route target", routeTarget);

  return lines;
}

function formatCanonicalSopSection(result) {
  const currentStage = humanizeToken(result?.sop_stage_current, "-");
  const nextStage = humanizeToken(result?.sop_stage_next, "-");

  const lines = [];
  pushField(lines, "SOP stage sekarang", currentStage);
  pushField(lines, "SOP stage berikutnya", nextStage);

  return lines;
}

function formatCanonicalFollowupGapSection(result) {
  const gap = compactMultiline(result?.followup_gap, 1200, "-");
  const requiredArtifacts = formatArtifacts(result?.required_artifacts_final, "-");
  const nextRequiredArtifact = formatArtifacts(
    result?.next_required_artifact ? [result.next_required_artifact] : [],
    "-"
  );

  const lines = [];
  pushField(lines, "Follow-up gap", gap);
  pushField(lines, "Required artifacts final", requiredArtifacts);
  pushField(lines, "Next required artifact", nextRequiredArtifact);

  return lines;
}

function formatCanonicalConfidenceSection(result) {
  const confidenceScore = safePercent(result?.confidence_score, 20);
  const uncertainty = compactMultiline(result?.uncertainty_note, 900, "-");

  const lines = [];
  pushField(lines, "Confidence", `${confidenceScore}%`);
  pushField(lines, "Uncertainty", uncertainty);

  return lines;
}

function formatCanonicalSuggestedReplyContentSection(result) {
  const suggestedReply = compactMultiline(result?.suggested_response, 1200, "-");
  const csAction = compactMultiline(result?.cs_action, 1200, "-");

  const lines = [];
  pushField(lines, "Suggested Reply", suggestedReply);
  pushField(lines, "Tindakan CS", csAction);

  return lines;
}

function formatCanonicalOperationalSection(result) {
  const planType = humanizeToken(result?.plan_type_final, "-");
  const executeMode = humanizeToken(result?.execute_mode_final, "-");
  const routeTarget = normalizeToken(result?.route_target, "-");
  const requiredArtifacts = formatArtifacts(result?.required_artifacts_final, "-");
  const nextRequiredArtifact = formatArtifacts(
    result?.next_required_artifact ? [result.next_required_artifact] : [],
    "-"
  );
  const noteStrategy = humanizeToken(result?.note_publish_strategy, "Single Canonical Note");

  const lines = [];
  pushField(lines, "Plan type final", planType);
  pushField(lines, "Execute mode final", executeMode);
  pushField(lines, "Route target", routeTarget);
  pushField(lines, "Required artifacts final", requiredArtifacts);
  pushField(lines, "Next required artifact", nextRequiredArtifact);
  pushField(lines, "Note publish strategy", noteStrategy);

  return lines;
}

function formatCanonicalSummarySection(result) {
  const statusCustomer = firstNonEmpty([
    [
      humanizeToken(result?.pipeline, ""),
      humanizeToken(result?.prospect_type, ""),
      humanizeToken(result?.behaviour_stage, ""),
    ].filter(Boolean).join(" | "),
    humanizeToken(result?.pipeline, ""),
    "-",
  ], "-");

  const kebutuhanUtama = firstNonEmpty([
    compactMultiline(result?.followup_gap, 500, ""),
    humanizeToken(result?.intent, ""),
    "-",
  ], "-");

  const aksiTerbaik = compactMultiline(result?.cs_action, 500, "-");

  const langkahBerikutnya = firstNonEmpty([
    humanizeToken(result?.plan_type_final, ""),
    humanizeToken(result?.execute_mode_final, ""),
    humanizeToken(result?.sop_stage_next, ""),
    "-",
  ], "-");

  const lines = [];
  pushField(lines, "Status customer", statusCustomer);
  pushField(lines, "Kebutuhan utama", kebutuhanUtama);
  pushField(lines, "Aksi terbaik", aksiTerbaik);
  pushField(lines, "Langkah berikutnya", langkahBerikutnya);

  return lines;
}

/**
 * NOTE UTAMA CANONICAL.
 * formatNote() tidak boleh kosong.
 *
 * @param {Record<string, any> | null | undefined} result
 * @returns {string}
 */
export function formatNote(result) {
  const payload = asPayload(result);
  const suggestedReply = compactMultiline(payload?.suggested_response, 1200, "-");

  const analyticsDetails = [
    buildSection("Suggested Reply Analysis", formatCanonicalAnalysisSection(payload)),
    "",
    buildSection("Pipeline", formatCanonicalPipelineSection(payload)),
    "",
    buildSection("SOP", formatCanonicalSopSection(payload)),
    "",
    buildSection("Follow-up Gap", formatCanonicalFollowupGapSection(payload)),
    "",
    buildSection("Confidence / Uncertainty", formatCanonicalConfidenceSection(payload)),
    "",
    buildSection("Suggested Reply Content", formatCanonicalSuggestedReplyContentSection(payload)),
    "",
    buildSection("Operational Follow-up", formatCanonicalOperationalSection(payload)),
    "",
    buildSection("Ringkasan Singkat", formatCanonicalSummarySection(payload)),
  ].join("\n");

  const note = [
    "💬 <b>Suggested Reply:</b>",
    `"${suggestedReply}"`,
    "",
    "<details>",
    "<summary>🔍 <b>Show Analytic</b></summary>",
    "<br/>",
    "🤖 Workflow SOP Analysis",
    "",
    analyticsDetails,
    "</details>"
  ].join("\n");

  return finalizeNote(note, buildMinimalCanonicalFallbackNote(payload));
}

/**
 * Auxiliary note boleh kosong hanya bila strategy = single_canonical_note.
 *
 * @param {Record<string, any> | null | undefined} payload
 * @returns {string}
 */
export function formatSuggestedReplyAnalysisNote(payload) {
  const data = asPayload(payload);

  if (!shouldPublishAuxiliarySuggestedReplyNotes(data)) {
    return "";
  }

  const note = [
    "💬 Suggested Reply Analysis",
    "",
    buildSection("Suggested Reply Analysis", formatCanonicalAnalysisSection(data)),
    "",
    buildSection("Pipeline", formatCanonicalPipelineSection(data)),
    "",
    buildSection("SOP", formatCanonicalSopSection(data)),
    "",
    buildSection("Follow-up Gap", formatCanonicalFollowupGapSection(data)),
    "",
    buildSection("Confidence / Uncertainty", formatCanonicalConfidenceSection(data)),
    "",
    buildSection("Ringkasan Singkat", formatCanonicalSummarySection(data)),
  ].join("\n");

  return finalizeNote(note, buildMinimalAnalysisFallbackNote(data));
}

/**
 * Auxiliary note boleh kosong hanya bila strategy = single_canonical_note.
 *
 * @param {Record<string, any> | null | undefined} payload
 * @returns {string}
 */
export function formatSuggestedReplyContentNote(payload) {
  const data = asPayload(payload);

  if (!shouldPublishAuxiliarySuggestedReplyNotes(data)) {
    return "";
  }

  const note = [
    "💬 Suggested Reply Content",
    "",
    buildSection("Suggested Reply Content", formatCanonicalSuggestedReplyContentSection(data)),
    "",
    buildSection("Operational Follow-up", formatCanonicalOperationalSection(data)),
    "",
    buildSection("Ringkasan Singkat", formatCanonicalSummarySection(data)),
  ].join("\n");

  return finalizeNote(note, buildMinimalContentFallbackNote(data));
}

/**
 * Backward compatibility.
 *
 * @param {Record<string, any> | null | undefined} payload
 * @returns {string}
 */
export function formatSuggestedReplyNote(payload) {
  return formatNote(payload);
}