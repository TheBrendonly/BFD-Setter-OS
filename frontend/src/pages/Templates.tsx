import React from 'react';
import { toast } from 'sonner';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Building,
  Webhook,
  Phone,
  Database,
  Code2,
  Download,
  Copy,
} from '@/components/icons';
import { getSourceFileUrl } from '@/lib/sourceFiles';
import { GithubFileExplorer } from '@/components/source-files/GithubFileExplorer';

// ──────────────────────────────────────────────────────────────────────────
// Data
// ──────────────────────────────────────────────────────────────────────────

const GHL_SNAPSHOT_URL =
  'https://affiliates.gohighlevel.com/?fp_ref=quimple-llc36&share=7UfWazhAvSbUPRuR36Jg';

const N8N_FILES = [
  {
    id: 'text_engine_setter',
    label: 'Text_Engine_Setter.json',
    description:
      'Main n8n workflow that powers the AI text setter — handles inbound replies, context gathering, and reply generation.',
    storageKey: 'Text_Engine_Setter.json',
  },
  {
    id: 'appointment_booking_functions',
    label: 'Appointment_Booking_Functions.json',
    description:
      'n8n workflow used by the voice setter (Retell) to book and reschedule appointments through GoHighLevel.',
    storageKey: 'Appointment_Booking_Functions.json',
  },
];

const RETELL_FILES = [
  {
    id: 'voice_setter_1',
    label: 'Voice-Setter-1.json',
    description:
      'Reference Retell agent configuration — the same template used by the voice sales rep.',
    storageKey: 'Voice-Setter-1.json',
  },
];

const SUPABASE_FILES = [
  {
    id: 'internal_schema',
    label: 'internal-schema.sql',
    description:
      'Schema for the platform (internal) Supabase project — clients, leads, campaigns, executions, and all OS-level tables.',
    storageKey: 'internal-schema.sql',
  },
  {
    id: 'client_schema',
    label: 'client-schema.sql',
    description:
      "Schema for each sub-account's external Supabase project — leads, chat_history, and call_history.",
    storageKey: 'client-schema.sql',
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Field — title, 13px subtitle, then field + copy button (32x32 groove)
// ──────────────────────────────────────────────────────────────────────────

function LinkRow({
  id,
  label,
  description,
  href,
  copyToastLabel,
}: {
  id: string;
  label: string;
  description?: string;
  href: string;
  copyToastLabel: string;
}) {
  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {description && (
          <p
            className="text-muted-foreground mt-0.5"
            style={{ fontSize: '13px' }}
          >
            {description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          readOnly
          value={href}
          className="font-mono text-sm flex-1"
        />
        <button
          type="button"
          className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center shrink-0"
          onClick={() => {
            navigator.clipboard.writeText(href);
            toast.success(`${copyToastLabel} copied`);
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function DownloadRow({
  id,
  label,
  description,
  href,
}: {
  id: string;
  label: string;
  description?: string;
  href: string;
}) {
  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {description && (
          <p
            className="text-muted-foreground mt-0.5"
            style={{ fontSize: '13px' }}
          >
            {description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          readOnly
          value={label}
          className="font-mono text-sm flex-1"
        />
        <Button
          asChild
          variant="outline"
          size="sm"
          className="font-medium shrink-0"
        >
          <a href={href} download={label}>
            <Download className="h-4 w-4 mr-2" />
            Download
          </a>
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────

export default function Templates() {
  usePageHeader({
    title: 'Source Files',
    breadcrumbs: [{ label: 'Source Files' }],
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-7xl">
        <div className="space-y-6">
          {/* GoHighLevel Snapshot */}
          <Card id="ghl-snapshot" className="material-surface scroll-mt-6">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building className="w-5 h-5" />
                GoHighLevel Snapshot
              </CardTitle>
              <CardDescription>
                Install the prebuilt GoHighLevel snapshot to get the funnels, workflows, custom fields and pipelines required by the AI setters.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <LinkRow
                  id="ghl_snapshot_link"
                  label="GoHighLevel Snapshot Install Link"
                  description="Open this link in a new tab. Log in to your GHL agency account, then click Install."
                  href={GHL_SNAPSHOT_URL}
                  copyToastLabel="Snapshot link"
                />
              </div>
            </CardContent>
          </Card>

          {/* n8n Workflows */}
          <Card id="n8n-workflows" className="material-surface scroll-mt-6">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Webhook className="w-5 h-5" />
                n8n Workflows
              </CardTitle>
              <CardDescription>
                Import these workflows into your n8n instance. Update the credentials and webhook URLs after import.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {N8N_FILES.map((f) => (
                  <DownloadRow
                    key={f.id}
                    id={f.id}
                    label={f.label}
                    description={f.description}
                    href={getSourceFileUrl(f.storageKey)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Retell AI Files */}
          <Card id="retell-files" className="material-surface scroll-mt-6">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Phone className="w-5 h-5" />
                Retell AI Files
              </CardTitle>
              <CardDescription>
                Reference Retell agent configuration. Import into your Retell dashboard, then plug in your own LLM, voice, and webhook URLs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {RETELL_FILES.map((f) => (
                  <DownloadRow
                    key={f.id}
                    id={f.id}
                    label={f.label}
                    description={f.description}
                    href={getSourceFileUrl(f.storageKey)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Supabase Schemas */}
          <Card id="supabase-schemas" className="material-surface scroll-mt-6">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Database className="w-5 h-5" />
                Supabase Schemas
              </CardTitle>
              <CardDescription>
                Two SQL files: one for the internal platform database (shared across all sub-accounts) and one for each sub-account's external database.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {SUPABASE_FILES.map((f) => (
                  <DownloadRow
                    key={f.id}
                    id={f.id}
                    label={f.label}
                    description={f.description}
                    href={getSourceFileUrl(f.storageKey)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* GitHub Source Code */}
          <Card id="source-code" className="material-surface scroll-mt-6">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Code2 className="w-5 h-5" />
                GitHub Source Code
              </CardTitle>
              <CardDescription>
                Browse the upstream open-source repository (genokadzin/1prompt-os) that BFD-setter is forked from. Useful as a reference; BFD's own fork lives in a separate repo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GithubFileExplorer
                owner="genokadzin"
                repo="1prompt-os"
                defaultPath="README.md"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
