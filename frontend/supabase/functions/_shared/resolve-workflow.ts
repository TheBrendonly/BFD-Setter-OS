// Form-to-agent routing resolver (2026-05-30).
//
// A client may have MANY "new leads" workflows, each bound to a distinct GHL
// form-tag (engagement_workflows.new_leads_tag). Inbound ingress functions
// (ghl-tag-webhook, sync-ghl-contact, intake-lead) use this to route a lead to
// the workflow whose tag matches the inbound tags, falling back to the client's
// default workflow (clients.auto_engagement_workflow_id) when no tag matches.
//
// Split into pure decision functions (unit-tested) and a thin DB fetch.

export interface NewLeadsWorkflow {
  id: string;
  new_leads_tag: string | null;
}

export type RouteSource = "tag" | "default" | "none";

export interface RouteResult {
  workflowId: string | null;
  matchedTag: string | null;
  source: RouteSource;
}

/** Normalise a tag list: trim and drop blanks. */
function cleanTags(tags: string[]): string[] {
  return tags
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Pick the first new-leads workflow whose (trimmed) tag is among the candidate
 * tags. Workflows with a null tag are ignored. Deterministic: returns the first
 * match in the given workflow order.
 */
export function matchWorkflowByTag(
  workflows: NewLeadsWorkflow[],
  candidateTags: string[],
): NewLeadsWorkflow | null {
  const tagSet = new Set(cleanTags(candidateTags));
  if (tagSet.size === 0) return null;
  for (const wf of workflows) {
    if (wf.new_leads_tag && tagSet.has(wf.new_leads_tag.trim())) return wf;
  }
  return null;
}

/**
 * Resolve which workflow a lead should enrol into.
 *  - tag match     -> that workflow         (source: "tag")
 *  - else fallback -> the default workflow  (source: "default")
 *  - else          -> nothing               (source: "none")
 *
 * Pass fallbackWorkflowId = null for tag-only semantics (ghl-tag-webhook), or
 * clients.auto_engagement_workflow_id for the auto-enrol paths.
 */
export function resolveWorkflow(args: {
  workflows: NewLeadsWorkflow[];
  candidateTags: string[];
  fallbackWorkflowId: string | null;
}): RouteResult {
  const match = matchWorkflowByTag(args.workflows, args.candidateTags);
  if (match) {
    return { workflowId: match.id, matchedTag: match.new_leads_tag?.trim() ?? null, source: "tag" };
  }
  if (args.fallbackWorkflowId) {
    return { workflowId: args.fallbackWorkflowId, matchedTag: null, source: "default" };
  }
  return { workflowId: null, matchedTag: null, source: "none" };
}

/**
 * Thin DB fetch: active new-leads workflows for a client whose tag matches one
 * of the inbound tags. Returns [] when there are no usable tags (caller then
 * falls back to the default workflow). `supabase` is a Supabase client.
 */
export async function fetchActiveNewLeadsWorkflows(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clientId: string,
  candidateTags: string[],
): Promise<NewLeadsWorkflow[]> {
  const tags = cleanTags(candidateTags);
  if (tags.length === 0) return [];
  const { data, error } = await supabase
    .from("engagement_workflows")
    .select("id, new_leads_tag")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .eq("is_new_leads_campaign", true)
    .in("new_leads_tag", tags);
  if (error) {
    console.warn("[resolve-workflow] new-leads workflow lookup failed:", error);
    return [];
  }
  return (data ?? []) as NewLeadsWorkflow[];
}
