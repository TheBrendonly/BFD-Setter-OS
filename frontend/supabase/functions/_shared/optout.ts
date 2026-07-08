export async function isPhoneOptedOut(supabase: any, clientId: string, normalizedPhone: string): Promise<boolean> {
  if (!normalizedPhone) return false;
  const { data, error } = await supabase
    .from("lead_optouts").select("phone").eq("client_id", clientId).eq("phone", normalizedPhone).maybeSingle();
  // OPTOUT-FAILOPEN-1: a compliance gate must fail CLOSED. On a query error `data` is null and the old
  // code returned false ("not opted out"), sending a billable SMS to a number that texted STOP (AU Spam
  // Act breach). Treat an errored lookup as opted-out (skip the send) and warn, rather than risk sending.
  // NOTE: this edge twin is bundled into the FROZEN voice-booking-tools + 4 non-frozen edge fns; the fix
  // is STAGED until those are redeployed (the trigger/_shared twin ships live via the Trigger.dev deploy).
  if (error) {
    console.warn(
      `isPhoneOptedOut: lead_optouts lookup failed for client ${clientId}, failing closed (treating as opted-out):`,
      (error as { message?: string }).message ?? error,
    );
    return true;
  }
  return !!data;
}
