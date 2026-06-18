export interface LeadRow { id: string; lead_id?: string | null; phone?: string | null; [k: string]: unknown }

export async function resolveLeadByPhone(
  supabase: any, clientId: string, normalizedPhone: string,
): Promise<LeadRow | null> {
  if (!normalizedPhone) return null;
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("client_id", clientId)
    .eq("normalized_phone", normalizedPhone)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}
