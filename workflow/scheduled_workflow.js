import {
  normalizePipeline,
  normalizeProspectType,
} from "../dataset_engine/rules.js";

import { formatNote } from "../formatters/note_formatter.js";

import { safeText } from "../utils/text.js";
import { logKommoDebug } from "../utils/env.js";
import { tryParseJsonLoose } from "../utils/ai_output.js";

import { dispatchAnalysisOutputs } from "../output/analysis_dispatcher.js";

import {
  PROCESS_MODES,
  normalizeProcessMode,
  getRouteTargetFromAnalysis,
  analyzeLeadOneCall,
} from "./analysis_orchestrator.js";

import {
  buildRuntimeContext,
  saveRuntimeCrmState,
  getMessageTtlSeconds,
  hasMeaningfulCrmPatch,
  normalizeCrmStateInput,
  extractEntityIdFromConvKey,
  toSafeNumber,
  asPlainObject,
  getAnalysisDispatcherDeps,
} from "./incoming_customer_response.js";

export function getSchedulerToken(env) {
  return safeText(env.SCHEDULER_TOKEN || env.WEBHOOK_TOKEN || "", 120);
}

export async function handleCronScheduledWorkflow(event, env) {
  const rawItems = safeText(env.SCHEDULED_WORKFLOW_ITEMS_JSON || "", 400000);
  if (!rawItems) {
    return;
  }

  let parsed = null;
  try {
    parsed = tryParseJsonLoose(rawItems);
  } catch (err) {
    console.error("handleCronScheduledWorkflow parse error:", err?.stack || String(err));
    return;
  }

  if (!parsed) {
    return;
  }

  try {
    await handleSchedulerPayload(parsed, env, {
      source: "cron",
      scheduledTime: Number(event?.scheduledTime || Date.now()),
      defaultMode: normalizeProcessMode(
        env.SCHEDULED_WORKFLOW_MODE || PROCESS_MODES.scheduled_no_response_followup
      ),
    });
  } catch (err) {
    console.error("handleCronScheduledWorkflow error:", err?.stack || String(err));
  }
}

export async function handleSchedulerRequest(rawBody, contentType, env, { url }) {
  const bodyText = typeof rawBody === "string" ? rawBody : "";
  const ct = safeText(contentType || "", 120).toLowerCase();

  let parsed = null;

  if (bodyText.trim()) {
    try {
      parsed = tryParseJsonLoose(bodyText);
    } catch (err) {
      console.error("handleSchedulerRequest parse error:", err?.stack || String(err));
    }
  }

  if (!parsed) {
    parsed = {};
  }

  if (
    !Array.isArray(parsed) &&
    typeof parsed === "object" &&
    parsed !== null &&
    url.searchParams.get("mode")
  ) {
    parsed.mode = url.searchParams.get("mode");
  }

  logKommoDebug(env, "SCHEDULER_REQUEST_RECEIVED", {
    content_type: ct,
    mode_query: safeText(url.searchParams.get("mode") || "", 80),
    raw_preview: safeText(bodyText, 500),
  });

  return handleSchedulerPayload(parsed, env, {
    source: "http",
    defaultMode: normalizeProcessMode(
      url.searchParams.get("mode") || PROCESS_MODES.scheduled_no_response_followup
    ),
  });
}

export async function handleSchedulerPayload(payload, env, meta = {}) {
  const source = safeText(meta.source || "scheduler", 40);
  const defaultMode = normalizeProcessMode(
    payload?.mode ||
      payload?.process_mode ||
      meta.defaultMode ||
      PROCESS_MODES.scheduled_no_response_followup
  );

  const rawItems = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.leads)
        ? payload.leads
        : Array.isArray(payload?.data)
          ? payload.data
          : payload && typeof payload === "object" && Object.keys(payload).length > 0
            ? [payload]
            : [];

  const items = rawItems
    .map((item, index) => normalizeSchedulerItem(item, defaultMode, index))
    .filter(Boolean);

  const results = [];

  for (const item of items) {
    try {
      const result = await processScheduledWorkflow(env, item, { source });
      results.push(result);
    } catch (err) {
      console.error("processScheduledWorkflow error:", err?.stack || String(err));
      results.push({
        mode: item.mode,
        entity_id: item.entityId,
        conv_key: item.convKey,
        dispatched: false,
        skipped_reason: "unexpected_error",
        error_message: safeText(err?.message || String(err), 240),
      });
    }
  }

  return {
    ok: true,
    source,
    default_mode: defaultMode,
    received_items: rawItems.length,
    normalized_items: items.length,
    processed_items: results.length,
    dispatched_count: results.filter((x) => x?.dispatched).length,
    skipped_count: results.filter((x) => !x?.dispatched).length,
    results,
  };
}

export function normalizeSchedulerItem(item, defaultMode, index = 0) {
  const src = asPlainObject(item);
  const entityId = toSafeNumber(
    src.entityId ??
      src.entity_id ??
      src.leadId ??
      src.lead_id ??
      src.id ??
      0
  );

  const convKey = safeText(
    src.convKey ||
      src.conv_key ||
      (entityId ? `lead:${entityId}` : ""),
    120
  );

  if (!convKey) return null;

  const crmState = normalizeCrmStateInput(
    src.crmState || src.crm_state || src
  );

  const normalizedEntityId = entityId || extractEntityIdFromConvKey(convKey);

  return {
    index,
    mode: normalizeProcessMode(src.mode || src.process_mode || defaultMode),
    entityId: normalizedEntityId,
    convKey,
    eventId: safeText(src.eventId || src.event_id || "", 120),
    latestCustomerText: safeText(
      src.latestCustomerText ||
        src.latest_customer_text ||
        src.customer_message ||
        "",
      2000
    ),
    crmState,
    skipDispatch: Boolean(src.skip_dispatch),
    label: safeText(src.label || src.scheduler_label || "", 120),
  };
}

export async function processScheduledWorkflow(env, item, meta = {}) {
  if (!item?.convKey || !item?.entityId) {
    return {
      mode: item?.mode || PROCESS_MODES.scheduled_no_response_followup,
      entity_id: item?.entityId || 0,
      conv_key: item?.convKey || "",
      dispatched: false,
      skipped_reason: "missing_entity_or_conv_key",
    };
  }

  if (env.MEM && hasMeaningfulCrmPatch(item.crmState)) {
    await saveRuntimeCrmState(
      env,
      item.convKey,
      item.crmState,
      getMessageTtlSeconds(env),
      "medium"
    );
  }

  const runtime = await buildRuntimeContext(env, {
    convKey: item.convKey,
    fallbackCustomerText: item.latestCustomerText,
    mode: item.mode,
    runtimeOverrides: {
      crmState: item.crmState,
    },
  });

  const analysis = await analyzeLeadOneCall(env, {
    convKey: item.convKey,
    summary: runtime.summary,
    tail: runtime.tail,
    latestCustomerText: runtime.latestCustomerText,
    lastAnalysis: runtime.lastAnalysis,
    mode: item.mode,
    crmState: runtime.crmState,
  });

  const gate = shouldDispatchWorkflow(item.mode, runtime, analysis, env);
  const workflowEventId =
    item.eventId ||
    buildWorkflowEventId({
      mode: item.mode,
      entityId: item.entityId,
      convKey: item.convKey,
      runtime,
      analysis,
    });

  if (item.skipDispatch || !gate.allowed) {
    return {
      mode: item.mode,
      entity_id: item.entityId,
      conv_key: item.convKey,
      dispatched: false,
      skipped_reason: item.skipDispatch ? "skip_dispatch_flag" : gate.reason,
      route_target: getRouteTargetFromAnalysis(analysis),
      pipeline: safeText(analysis.pipeline || "", 80),
      prospect_type: safeText(analysis.prospect_type || "", 80),
      followup_plan_type: safeText(analysis.followup_plan?.plan_type || "", 80),
      hours_since_last_customer_reply: toSafeNumber(
        runtime.crmState.hours_since_last_customer_reply
      ),
      hours_since_last_cs_action: toSafeNumber(
        runtime.crmState.hours_since_last_cs_action
      ),
    };
  }

  await dispatchAnalysisOutputs(
    env,
    {
      convKey: item.convKey,
      entityId: item.entityId,
      eventId: workflowEventId,
      analysis,
      latestCustomerText: runtime.latestCustomerText,
      summary: runtime.summary,
      tail: runtime.tail,
      noteText: formatNote(analysis),
      dispatchReason: item.mode || meta.source || "scheduler",
    },
    getAnalysisDispatcherDeps()
  );

  return {
    mode: item.mode,
    entity_id: item.entityId,
    conv_key: item.convKey,
    event_id: workflowEventId,
    dispatched: true,
    route_target: getRouteTargetFromAnalysis(analysis),
    pipeline: safeText(analysis.pipeline || "", 80),
    prospect_type: safeText(analysis.prospect_type || "", 80),
    followup_plan_type: safeText(analysis.followup_plan?.plan_type || "", 80),
    execute_mode: safeText(analysis.followup_plan?.execute_mode || "", 80),
    recommended_delay_hours: toSafeNumber(
      analysis.followup_plan?.recommended_delay_hours
    ),
  };
}

export function shouldDispatchWorkflow(mode, runtime, analysis, env) {
  const safeMode = normalizeProcessMode(mode);
  const pipeline = normalizePipeline(analysis?.pipeline);
  const prospectType = normalizeProspectType(analysis?.prospect_type);

  if (safeMode === PROCESS_MODES.incoming_customer_response) {
    return { allowed: true, reason: "incoming_customer_response" };
  }

  const hasContext = Boolean(
    runtime?.hasContext ||
      runtime?.latestCustomerText ||
      runtime?.tail ||
      runtime?.summary ||
      runtime?.crmState?.last_cs_action
  );

  if (!hasContext) {
    return { allowed: false, reason: "missing_runtime_context" };
  }

  if (safeMode === PROCESS_MODES.scheduled_no_response_followup) {
    const planType = safeText(analysis?.followup_plan?.plan_type || "", 80);
    const minHours = Math.max(
      toSafeNumber(analysis?.followup_plan?.recommended_delay_hours),
      getNoResponseSchedulerMinHours(env)
    );

    if (pipeline !== "no_respons" && planType !== "no_respons_followup") {
      return { allowed: false, reason: "not_no_response_path" };
    }

    const lastCustomerTs = toSafeNumber(runtime?.crmState?.last_customer_reply_ts);
    const lastCsTs = toSafeNumber(runtime?.crmState?.last_cs_action_ts);

    if (lastCustomerTs > 0 && lastCsTs > 0 && lastCustomerTs >= lastCsTs) {
      return {
        allowed: false,
        reason: "customer_already_replied_after_last_cs_action",
      };
    }

    const hoursSinceCustomer = toSafeNumber(
      runtime?.crmState?.hours_since_last_customer_reply
    );
    const hoursSinceCs = toSafeNumber(
      runtime?.crmState?.hours_since_last_cs_action
    );

    if (hoursSinceCustomer > 0 && hoursSinceCustomer < minHours) {
      return { allowed: false, reason: "too_soon_since_last_customer_reply" };
    }

    if (hoursSinceCs > 0 && hoursSinceCs < minHours) {
      return { allowed: false, reason: "too_soon_since_last_cs_action" };
    }

    return { allowed: true, reason: "eligible_no_response_followup" };
  }

  if (safeMode === PROCESS_MODES.post_payment_progress_check) {
    const isPostPayment =
      prospectType === "post_payment" ||
      Boolean(analysis?.status_flags?.is_post_payment) ||
      Boolean(analysis?.sop_signals?.status_flags?.is_post_payment);

    if (!isPostPayment) {
      return { allowed: false, reason: "not_post_payment_path" };
    }

    const minHours = getPostPaymentSchedulerMinHours(env);
    const hoursSinceCs = toSafeNumber(
      runtime?.crmState?.hours_since_last_cs_action
    );

    if (hoursSinceCs > 0 && hoursSinceCs < minHours) {
      return { allowed: false, reason: "too_soon_since_last_cs_action" };
    }

    return { allowed: true, reason: "eligible_post_payment_progress_check" };
  }

  return { allowed: false, reason: "unknown_process_mode" };
}

export function buildWorkflowEventId({ mode, entityId, convKey, runtime, analysis }) {
  void analysis;

  const safeMode = normalizeProcessMode(mode);
  const latestCustomerEventId = safeText(runtime?.latestCustomerEventId || "", 80);
  const lastCustomerTs = toSafeNumber(runtime?.crmState?.last_customer_reply_ts);
  const lastCsTs = toSafeNumber(runtime?.crmState?.last_cs_action_ts);

  return safeText(
    [
      safeMode,
      entityId || extractEntityIdFromConvKey(convKey) || 0,
      latestCustomerEventId || lastCustomerTs || "no_customer_event",
      lastCsTs || "no_cs_ts",
    ].join(":"),
    120
  );
}

export function getNoResponseSchedulerMinHours(env) {
  const n = Number(env.NO_RESPONSE_SCHEDULER_MIN_HOURS || "24");
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 240) : 24;
}

export function getPostPaymentSchedulerMinHours(env) {
  const n = Number(env.POST_PAYMENT_PROGRESS_MIN_HOURS || "12");
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 240) : 12;
}