import React from 'react';
import { toast } from 'sonner';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Building,
  Database,
  Download,
  Copy,
} from '@/components/icons';
import { getSourceFileUrl } from '@/lib/sourceFiles';

// ──────────────────────────────────────────────────────────────────────────
// Data
// ──────────────────────────────────────────────────────────────────────────

const GHL_SNAPSHOT_URL =
  'https://affiliates.gohighlevel.com/?fp_ref=quimple-llc36&share=7UfWazhAvSbUPRuR36Jg';

// n8n workflow + Retell agent-JSON download cards removed 2026-07-10
// (branding purge): the native text engine and app-created Retell agents
// made those import artifacts obsolete.
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

        </div>
      </div>
    </div>
  );
}
