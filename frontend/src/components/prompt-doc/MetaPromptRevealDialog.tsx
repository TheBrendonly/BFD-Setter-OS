import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

// Admin-only reveal of the meta prompt that "Modify with AI" sends as its system
// prompt (clients.ai_meta_prompt; split out of the dual-used clients.system_prompt).

interface MetaPromptRevealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  onEditInSettings: () => void;
}

const MONO_STYLE: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: '13px',
  lineHeight: '1.6',
};

export const MetaPromptRevealDialog: React.FC<MetaPromptRevealDialogProps> = ({
  open,
  onOpenChange,
  clientId,
  onEditInSettings,
}) => {
  const { role } = useAuth();
  const [metaPrompt, setMetaPrompt] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !clientId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await (supabase as any)
          .from('clients')
          .select('ai_meta_prompt, system_prompt')
          .eq('id', clientId)
          .maybeSingle();
        if (error) throw error;
        if (!cancelled) {
          // Fallback to system_prompt for clients created before the split migration ran.
          setMetaPrompt(data?.ai_meta_prompt || data?.system_prompt || '');
        }
      } catch (err) {
        console.error('Failed to load AI meta prompt:', err);
        if (!cancelled) setMetaPrompt('');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, clientId]);

  if (role !== 'agency') return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Modify with AI: system prompt</DialogTitle>
          <DialogDescription>
            These are the instructions sent to the AI as its system prompt whenever you use
            Modify with AI on this client. Read-only here; edit it from Settings.
          </DialogDescription>
        </DialogHeader>
        <div className="groove-border bg-card overflow-y-auto p-3" style={{ maxHeight: '50vh' }}>
          {loading ? (
            <p className="text-muted-foreground" style={MONO_STYLE}>Loading…</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words m-0" style={MONO_STYLE}>
              {metaPrompt || '(no meta prompt set — the AI falls back to its built-in default)'}
            </pre>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={() => { onOpenChange(false); onEditInSettings(); }}>Edit in Settings</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
