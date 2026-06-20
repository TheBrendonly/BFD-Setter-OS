import { supabase } from '@/integrations/supabase/client';

export interface TwilioPhoneNumber {
  sid: string;
  phone_number: string;
  friendly_name: string;
  sms_url?: string | null;
  capabilities?: {
    sms: boolean;
    voice: boolean;
    mms: boolean;
  };
}

type FetchTwilioPhoneNumbersParams =
  | { clientId: string; accountSid?: never; authToken?: never }
  | { clientId?: never; accountSid: string; authToken: string };

function normalizeTwilioNumbers(value: unknown): TwilioPhoneNumber[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item: any) => ({
      sid: item?.sid || '',
      phone_number: item?.phone_number || item?.phoneNumber || '',
      friendly_name: item?.friendly_name || item?.friendlyName || '',
      sms_url: item?.sms_url || item?.smsUrl || null,
      capabilities: item?.capabilities
        ? {
            sms: Boolean(item.capabilities.sms),
            voice: Boolean(item.capabilities.voice),
            mms: Boolean(item.capabilities.mms),
          }
        : undefined,
    }))
    .filter((item) => Boolean(item.phone_number));
}

export async function fetchTwilioPhoneNumbers(
  params: FetchTwilioPhoneNumbersParams
): Promise<TwilioPhoneNumber[]> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('No active session');
  }

  const payload = 'clientId' in params
    ? { client_id: params.clientId }
    : { account_sid: params.accountSid, auth_token: params.authToken };

  // Use supabase.functions.invoke so the URL + auth come from the canonical
  // client (VITE_SUPABASE_URL/anon key) instead of a separate VITE_SUPABASE_
  // PROJECT_ID that silently became `https://undefined.supabase.co` when unset.
  const { data, error } = await supabase.functions.invoke('twilio-list-numbers', {
    body: payload,
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  return normalizeTwilioNumbers(data?.numbers ?? data?.phone_numbers);
}
