export async function isPhoneOptedOut(supabase: any, clientId: string, normalizedPhone: string): Promise<boolean> {
  if (!normalizedPhone) return false;
  const { data } = await supabase
    .from("lead_optouts").select("phone").eq("client_id", clientId).eq("phone", normalizedPhone).maybeSingle();
  return !!data;
}
