import { supabase } from '@/integrations/supabase/client';

export const SUPPORT_EMAIL = 'brendan@buildingflowdigital.com';

export interface SnapshotData {
  accountEmail: string | null;
  accountId: string | null;
  subAccountName: string | null;
  clientId: string | null;
  ghlLocationId: string | null;
  pathname: string;
  browser: string;
  timestamp: string;
  textSetters: Array<{ slot_id: string; name: string | null }>;
  voiceSetters: Array<{ slot_id: string; name: string | null }>;
  errorLogs: Array<{ created_at: string; source: string | null; title: string | null; message: string | null }>;
}

function parseBrowser(ua: string): string {
  let browser = 'Unknown';
  let os = 'Unknown';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  return `${browser} / ${os}`;
}

export async function fetchSnapshotData(
  clientId: string | null,
  user: { id?: string | null; email?: string | null } | null,
): Promise<SnapshotData> {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
  const browser = typeof navigator !== 'undefined' ? parseBrowser(navigator.userAgent) : 'Unknown';
  const timestamp = new Date().toISOString();

  let subAccountName: string | null = null;
  let ghlLocationId: string | null = null;
  let textSetters: SnapshotData['textSetters'] = [];
  let voiceSetters: SnapshotData['voiceSetters'] = [];
  let errorLogs: SnapshotData['errorLogs'] = [];

  if (clientId) {
    try {
      const [clientRes, promptsRes] = await Promise.all([
        supabase.from('clients_public').select('name, ghl_location_id').eq('id', clientId).maybeSingle(),
        supabase
          .from('prompts')
          .select('slot_id, name, category')
          .eq('client_id', clientId)
          .eq('is_active', true)
          .in('category', ['text_agent', 'voice_setter']),
      ]);

      subAccountName = (clientRes.data as any)?.name ?? null;
      ghlLocationId = (clientRes.data as any)?.ghl_location_id ?? null;

      const rows = (promptsRes.data || []) as Array<{ slot_id: string; name: string | null; category: string }>;
      textSetters = rows
        .filter(r => r.category === 'text_agent')
        .map(r => ({ slot_id: r.slot_id, name: r.name }))
        .sort((a, b) => a.slot_id.localeCompare(b.slot_id));
      voiceSetters = rows
        .filter(r => r.category === 'voice_setter')
        .map(r => ({ slot_id: r.slot_id, name: r.name }))
        .sort((a, b) => a.slot_id.localeCompare(b.slot_id));

      if (ghlLocationId) {
        const { data: logs } = await supabase
          .from('error_logs')
          .select('created_at, source, category, severity, title, error_message')
          .eq('client_ghl_account_id', ghlLocationId)
          .order('created_at', { ascending: false })
          .limit(50);
        errorLogs = (logs || []).map((l: any) => ({
          created_at: l.created_at,
          source: l.source || l.category || 'unknown',
          title: l.title,
          message: l.error_message,
        }));
      }
    } catch (e) {
      console.error('Snapshot fetch error:', e);
    }
  }

  return {
    accountEmail: user?.email ?? null,
    accountId: user?.id ?? null,
    subAccountName,
    clientId,
    ghlLocationId,
    pathname,
    browser,
    timestamp,
    textSetters,
    voiceSetters,
    errorLogs,
  };
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch {
    return iso;
  }
}

export function formatSnapshot(data: SnapshotData, subject: string, body: string): string {
  const lines: string[] = [];
  lines.push('=== USER REQUEST ===');
  lines.push(`Subject: ${subject || '(none)'}`);
  lines.push('');
  lines.push(body || '(no description)');
  lines.push('');
  lines.push('---');
  lines.push('=== ACCOUNT ===');
  lines.push(`Account email: ${data.accountEmail || '(unknown)'}`);
  lines.push(`Account ID: ${data.accountId || '(unknown)'}`);
  lines.push(`Sub-account: ${data.subAccountName ? `"${data.subAccountName}"` : '(unknown)'}`);
  lines.push(`Client ID: ${data.clientId || '(none)'}`);
  if (data.ghlLocationId) lines.push(`GHL Location ID: ${data.ghlLocationId}`);
  lines.push(`Current page: ${data.pathname}`);
  lines.push(`Browser: ${data.browser}`);
  lines.push(`Time: ${formatTime(data.timestamp)}`);
  lines.push('');
  lines.push('=== ACTIVE SETTERS ===');
  lines.push('Text:');
  if (data.textSetters.length === 0) lines.push('  (none active)');
  else data.textSetters.forEach(s => lines.push(`  - ${s.slot_id}: "${s.name || 'Unnamed'}"`));
  lines.push('Voice:');
  if (data.voiceSetters.length === 0) lines.push('  (none active)');
  else data.voiceSetters.forEach(s => lines.push(`  - ${s.slot_id}: "${s.name || 'Unnamed'}"`));
  lines.push('');
  lines.push('=== RECENT LOGS (last 50, all sources) ===');
  if (data.errorLogs.length === 0) {
    lines.push('(no recent logs)');
  } else {
    data.errorLogs.forEach(l => {
      const when = formatTime(l.created_at);
      const src = l.source || 'unknown';
      const titleOrMsg = l.title || l.message || '(no message)';
      lines.push(`[${when}] ${src} | ${titleOrMsg}`);
    });
  }
  return lines.join('\n');
}

export function buildMailtoUrl(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function buildGmailUrl(to: string, subject: string, body: string): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
