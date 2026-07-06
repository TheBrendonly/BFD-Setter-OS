import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BarChart3, Eye } from '@/components/icons';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useClientReportConfig, type ReportConfig, type ReportSections } from '@/hooks/useClientReportConfig';

// F15 — agency editor for a sub-account's ROI report visibility + "what we
// improved" block, plus a live preview of the latest generated weekly report.
// Agency-only (rendered behind isAgency on ClientSettings). Writes the dedicated
// client_report_config table (agency-role-gated RLS).

const SECTION_LABELS: Record<keyof ReportSections, string> = {
  funnel: 'Appointments / show-rate funnel',
  calls: 'Calls made / answered',
  sms: 'Text conversations',
  usage: 'Usage (minutes / texts)',
  objections: 'What leads asked about',
  improvements: 'What we improved',
};

export function ReportSettingsCard({ clientId }: { clientId: string }) {
  const { config, loading, saving, saveConfig } = useClientReportConfig(clientId);
  const [draft, setDraft] = useState<ReportConfig | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Sync the draft from the loaded config once (and after save).
  const c = draft ?? config;
  const set = (patch: Partial<ReportConfig>) => setDraft({ ...c, ...patch });
  const setSection = (key: keyof ReportSections, on: boolean) =>
    setDraft({ ...c, sections: { ...c.sections, [key]: on } });

  const onSave = async () => {
    const ok = await saveConfig(c);
    toast[ok ? 'success' : 'error'](ok ? 'Report settings saved' : 'Save failed');
    if (ok) setDraft(null);
  };

  const openPreview = async () => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewHtml(null);
    try {
      const { data, error } = await supabase.functions.invoke('get-weekly-report', {
        body: { client_id: clientId },
      });
      if (error) throw error;
      const html = (data as { report?: { html?: string } | null })?.report?.html ?? null;
      setPreviewHtml(html);
    } catch (err) {
      console.error('get-weekly-report failed:', err);
      setPreviewHtml(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  if (loading) return null;

  return (
    <Card className="material-surface">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Client ROI reporting
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="show-funnel">Show the show-rate funnel to the client</Label>
          <Switch
            id="show-funnel"
            checked={c.show_funnel_to_client}
            onCheckedChange={(v) => set({ show_funnel_to_client: v })}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="show-report">Show the weekly report to the client</Label>
          <Switch
            id="show-report"
            checked={c.show_report_to_client}
            onCheckedChange={(v) => set({ show_report_to_client: v })}
          />
        </div>

        <div className="pt-2 border-t">
          <div className="text-sm font-medium mb-2">Report sections</div>
          <div className="space-y-2">
            {(Object.keys(SECTION_LABELS) as (keyof ReportSections)[]).map((key) => (
              <div key={key} className="flex items-center justify-between">
                <Label htmlFor={`sec-${key}`} className="text-sm font-normal text-muted-foreground">
                  {SECTION_LABELS[key]}
                </Label>
                <Switch id={`sec-${key}`} checked={c.sections[key]} onCheckedChange={(v) => setSection(key, v)} />
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t">
          <Label htmlFor="wwi" className="text-sm font-medium">What we improved this week (one per line)</Label>
          <Textarea
            id="wwi"
            className="mt-1"
            rows={3}
            placeholder="Tightened the booking script&#10;Faster first-touch on new leads"
            value={c.what_we_improved.join('\n')}
            onChange={(e) => set({ what_we_improved: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
          />
        </div>

        <div className="pt-2 border-t">
          <Label htmlFor="recip" className="text-sm font-medium">Report recipient email (optional)</Label>
          <Input
            id="recip"
            type="email"
            className="mt-1"
            placeholder="client@example.com"
            value={c.recipient_email}
            onChange={(e) => set({ recipient_email: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Email send is gated on Resend SMTP; until then reports are generated and viewable via preview.
          </p>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button onClick={onSave} disabled={saving || draft === null}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button variant="outline" onClick={openPreview}>
            <Eye className="w-4 h-4 mr-1.5" />
            Preview latest report
          </Button>
        </div>
      </CardContent>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Latest weekly report</DialogTitle>
          </DialogHeader>
          {previewLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>
          ) : previewHtml ? (
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          ) : (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No report generated yet. The weekly cron produces one each Monday; it will appear here.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
