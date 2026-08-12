import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusTag } from '@/components/StatusTag';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Copy, Loader2, X } from '@/components/icons';
import { cn } from '@/lib/utils';
import {
  TONE_STYLE_SUBSECTIONS, STRATEGY_SUBSECTIONS, GUARDRAILS_SUBSECTIONS,
  IDENTITY_SUBSECTIONS, COMPANY_SUBSECTIONS, COMPANY_LEAD_CONTEXT_SUBSECTIONS, COMPANY_INFO_SUBSECTIONS,
  ALL_SUBSECTIONS,
} from '@/data/setterConfigParameters';
import {
  VOICE_TONE_STYLE_SUBSECTIONS, VOICE_STRATEGY_SUBSECTIONS, VOICE_GUARDRAILS_SUBSECTIONS,
  VOICE_IDENTITY_SUBSECTIONS, VOICE_COMPANY_SUBSECTIONS, VOICE_COMPANY_LEAD_CONTEXT_SUBSECTIONS, VOICE_COMPANY_INFO_SUBSECTIONS,
  VOICE_ALL_SUBSECTIONS,
} from '@/data/voiceSetterConfigParameters';
import { CONFIG_SECTIONS } from '@/components/AgentConfigBuilder';

const FONT = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' };
const LABEL_FONT = { fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' };

interface SetterSlotInfo {
  id: string;
  label: string;
  channel: 'text' | 'voice';
}

interface CopySetterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  currentSlotId: string;
  currentChannel: 'text' | 'voice';
  onStartRequested: () => void;
  onStartFailed: () => void;
  onJobStarted: (jobId: string) => void;
}

export const CopySetterDialog: React.FC<CopySetterDialogProps> = ({
  open,
  onOpenChange,
  clientId,
  currentSlotId,
  currentChannel,
  onStartRequested,
  onStartFailed,
  onJobStarted,
}) => {
  const [step, setStep] = useState<'select' | 'confirm'>('select');
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [userGuidelines, setUserGuidelines] = useState('');
  const [availableSlots, setAvailableSlots] = useState<SetterSlotInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkingSlots, setCheckingSlots] = useState(true);

  useEffect(() => {
    if (!open || !clientId) return;
    setStep('select');
    setSelectedSlot(null);
    setUserGuidelines('');

    const checkConfigurations = async () => {
      setCheckingSlots(true);
      try {
        const { data } = await (supabase as any)
          .from('prompt_configurations')
          .select('slot_id')
          .eq('client_id', clientId);

        if (data) {
          const uniqueSlotIds = Array.from(new Set(data.map((r: any) => r.slot_id))) as string[];
          const slots: SetterSlotInfo[] = uniqueSlotIds
            .filter((id) => id !== currentSlotId)
            .map((id) => {
              const isVoice = id.startsWith('Voice-');
              return {
                id,
                label: isVoice ? id.replace('Voice-', '') : id,
                channel: isVoice ? 'voice' as const : 'text' as const,
              };
            })
            .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
          setAvailableSlots(slots);
        }
      } catch {
        // fallback
      } finally {
        setCheckingSlots(false);
      }
    };

    checkConfigurations();
  }, [open, clientId, currentSlotId]);

  const textSlots = availableSlots.filter(s => s.channel === 'text');
  const voiceSlots = availableSlots.filter(s => s.channel === 'voice');

  const selectedSlotInfo = availableSlots.find((s) => s.id === selectedSlot);
  const isCrossChannel = selectedSlotInfo && selectedSlotInfo.channel !== currentChannel;
  // Voice -> text is its own path (clone-voice-to-text). The generic copy reads only
  // prompt_configurations and never sees prompt_docs, so for a doc-model voice source it
  // re-personalises stale setup-time parameters and the live prompt never participates.
  const isVoiceToText = selectedSlotInfo?.channel === 'voice' && currentChannel === 'text';

  // Build the target parameter catalog so the AI knows what to generate
  const targetParameters = useMemo(() => {
    const targetSubs = currentChannel === 'voice'
      ? [...VOICE_IDENTITY_SUBSECTIONS, ...VOICE_COMPANY_SUBSECTIONS, ...VOICE_COMPANY_LEAD_CONTEXT_SUBSECTIONS, ...VOICE_COMPANY_INFO_SUBSECTIONS, ...VOICE_TONE_STYLE_SUBSECTIONS, ...VOICE_STRATEGY_SUBSECTIONS, ...VOICE_GUARDRAILS_SUBSECTIONS]
      : [...IDENTITY_SUBSECTIONS, ...COMPANY_SUBSECTIONS, ...COMPANY_LEAD_CONTEXT_SUBSECTIONS, ...COMPANY_INFO_SUBSECTIONS, ...TONE_STYLE_SUBSECTIONS, ...STRATEGY_SUBSECTIONS, ...GUARDRAILS_SUBSECTIONS];
    const allParams = targetSubs.flatMap(s => s.params);

    const params = allParams.map(p => {
      const options = (p.type === 'select' && p.options && p.options.length > 1)
        ? p.options.map(opt => ({
            value: opt.value,
            label: opt.label,
            defaultPrompt: opt.defaultPrompt || '',
          }))
        : undefined;

      return {
        key: p.key,
        label: p.label,
        type: p.type,
        options,
      };
    });

    // Also include agent_goal from CONFIG_SECTIONS
    const agentGoalConfig = CONFIG_SECTIONS.find(s => s.key === 'agent_goal');
    if (agentGoalConfig?.options?.length) {
      params.push({
        key: 'agent_goal',
        label: 'Agent Goal',
        type: 'multi-select' as any,
        options: agentGoalConfig.options
          .filter(opt => opt.value !== 'custom_goal')
          .map(opt => ({
            value: opt.value,
            label: opt.label,
            defaultPrompt: opt.defaultContent || '',
          })),
      });
    }

    return params;
  }, [currentChannel]);

  // Poll the conversion job, then finalise it. Mirrors the polling the other AI dialogs
  // use; the job row is the only progress signal available.
  const runVoiceToTextClone = async () => {
    const { data: started, error: startError } = await supabase.functions.invoke('clone-voice-to-text', {
      body: {
        action: 'start',
        clientId,
        sourceSlotId: selectedSlot,
        targetSlotId: currentSlotId,
        userGuidelines: userGuidelines.trim(),
      },
    });
    if (startError) throw new Error(startError.message || 'Failed to start the clone');
    if (started?.error) throw new Error(started.error);
    if (!started?.job_id) throw new Error('No job ID returned');

    onJobStarted(started.job_id);
    toast.info(
      `Converting ${started.source_chars?.toLocaleString?.() ?? ''} characters` +
      `${started.compliance_lines ? `, preserving ${started.compliance_lines} compliance lines` : ''}. This takes a minute or two.`,
    );

    // ~5 minutes at 5s. runAiJob's own cap is 5 minutes per OpenRouter call.
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const { data: job } = await (supabase as any)
        .from('ai_generation_jobs')
        .select('status, error_message')
        .eq('id', started.job_id)
        .maybeSingle();
      if (job?.status === 'failed') throw new Error(job.error_message || 'The conversion job failed');
      if (job?.status !== 'completed') continue;

      const { data: applied, error: applyError } = await supabase.functions.invoke('clone-voice-to-text', {
        body: { action: 'apply', clientId, jobId: started.job_id, targetSlotId: currentSlotId },
      });
      if (applyError) {
        // A 422 (lint or coverage gate) carries its detail in the response body, which
        // supabase-js exposes on error.context. Nothing was written in that case.
        let detail = applyError.message || 'The conversion could not be saved';
        try {
          const body = await (applyError as any)?.context?.json?.();
          if (body?.error) detail = body.error;
          if (Array.isArray(body?.lint_errors) && body.lint_errors.length > 0) {
            detail += ` (${body.lint_errors.map((e: any) => `${e.rule} line ${e.line}`).join(', ')})`;
          }
        } catch { /* fall back to the plain message */ }
        throw new Error(detail);
      }
      if (applied?.error) throw new Error(applied.error);

      const report = applied?.report;
      toast.success(
        `Cloned into ${currentSlotId}: ${report?.prompt_chars?.toLocaleString?.() ?? '?'} characters` +
        `${report?.reasserted_compliance?.length ? `, ${report.reasserted_compliance.length} compliance lines restored verbatim` : ''}.`,
      );
      if (applied?.warning === 'section_editor_stale') {
        toast.warning(applied.warning_detail, { duration: 12000 });
      }
      return;
    }
    throw new Error('The conversion timed out. Check the job in Logs before retrying.');
  };

  const handleStartCopy = async () => {
    if (!selectedSlot || !clientId) return;
    setLoading(true);
    onStartRequested();
    onOpenChange(false);

    if (isVoiceToText) {
      try {
        await runVoiceToTextClone();
      } catch (err: any) {
        onStartFailed();
        toast.error(err?.message || 'Failed to clone the voice prompt');
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('copy-setter-config', {
        body: {
          clientId,
          sourceSlotId: selectedSlot,
          targetSlotId: currentSlotId,
          sourceChannel: selectedSlotInfo?.channel || 'text',
          targetChannel: currentChannel,
          userGuidelines: userGuidelines.trim(),
          targetParameters,
        },
      });

      if (error) throw new Error(error.message || 'Failed to start copy job');
      if (data?.error) throw new Error(data.error);
      if (!data?.job_id) throw new Error('No job ID returned');

      onJobStarted(data.job_id);
    } catch (err: any) {
      onStartFailed();
      toast.error(err.message || 'Failed to start copy');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col !p-0 overflow-y-auto" style={{ width: '644px', maxWidth: '90vw', maxHeight: '80vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 shrink-0" style={{ borderBottom: '3px groove hsl(var(--border-groove))', paddingTop: '14px', paddingBottom: '14px' }}>
          <DialogTitle>COPY OTHER SETTER</DialogTitle>
          <DialogClose asChild>
            <Button size="icon" variant="ghost" className="h-8 w-8 !bg-muted !border-border hover:!bg-accent shrink-0" title="Close">
              <X className="w-4 h-4" />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </div>

        {step === 'select' && (
          <div className="px-6 py-5 space-y-4">
            <p style={FONT} className="text-muted-foreground">
              Select a configured setter to copy its entire configuration to this setter.
            </p>

            {checkingSlots ? (
              <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground" style={FONT}>
                <Loader2 className="w-4 h-4 animate-spin" />
                Checking configured setters...
              </div>
            ) : availableSlots.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground" style={FONT}>
                No other configured setters found. Generate a configuration on another setter first.
              </div>
            ) : (
              <div className="space-y-4">
                {/* Text Setters group */}
                {textSlots.length > 0 && (
                  <div className="space-y-2">
                    <div style={FONT} className="text-foreground">Text Setters</div>
                    {textSlots.map((slot) => {
                      const isSelected = selectedSlot === slot.id;
                      const crossChannel = slot.channel !== currentChannel;
                      return (
                        <button
                          key={slot.id}
                          onClick={() => setSelectedSlot(slot.id)}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 groove-border text-left transition-colors',
                            isSelected ? 'bg-primary/10' : 'bg-card hover:bg-muted/40'
                          )}
                        >
                          <Checkbox checked={isSelected} className="flex-shrink-0" tabIndex={-1} />
                          <div className="flex-1 min-w-0">
                            <div style={{ ...FONT, fontWeight: 500 }} className="text-foreground">{slot.label}</div>
                            {crossChannel && (
                              <div style={{ ...FONT, fontSize: '13px', color: 'hsl(45 100% 60%)' }} className="mt-0.5">
                                Parameters will be adapted to {currentChannel} channel
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Voice Setters group */}
                {voiceSlots.length > 0 && (
                  <div className="space-y-2">
                    <div style={FONT} className="text-foreground">Voice Setters</div>
                    {voiceSlots.map((slot) => {
                      const isSelected = selectedSlot === slot.id;
                      const crossChannel = slot.channel !== currentChannel;
                      return (
                        <button
                          key={slot.id}
                          onClick={() => setSelectedSlot(slot.id)}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 groove-border text-left transition-colors',
                            isSelected ? 'bg-primary/10' : 'bg-card hover:bg-muted/40'
                          )}
                        >
                          <Checkbox checked={isSelected} className="flex-shrink-0" tabIndex={-1} />
                          <div className="flex-1 min-w-0">
                            <div style={{ ...FONT, fontWeight: 500 }} className="text-foreground">{slot.label}</div>
                            {crossChannel && (
                              <div style={{ ...FONT, fontSize: '13px', color: 'hsl(45 100% 60%)' }} className="mt-0.5">
                                {currentChannel === 'text'
                                  ? 'Prompt document will be converted for text'
                                  : `Parameters will be adapted to ${currentChannel} channel`}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Copy instructions */}
            <div className="space-y-2 mt-2">
              <label style={FONT} className="block text-foreground">
                Copy instructions (optional)
              </label>
              <textarea
                rows={4}
                value={userGuidelines}
                onChange={(e) => setUserGuidelines(e.target.value)}
                placeholder="e.g. Copy exactly, or adapt tone to be more formal, summarize the knowledge base..."
                className="block w-full min-h-[100px] p-3 bg-card groove-border text-foreground resize-y focus:outline-none placeholder:text-muted-foreground/50"
                style={FONT}
              />
            </div>

            <div className="flex gap-2" style={{ marginTop: '8px' }}>
              <Button
                className="flex-1 groove-btn"
                style={LABEL_FONT}
                onClick={() => onOpenChange(false)}
              >
                CANCEL
              </Button>
              <Button
                className={cn('flex-1 groove-btn-positive', !selectedSlot && 'opacity-50')}
                style={LABEL_FONT}
                disabled={!selectedSlot}
                onClick={() => setStep('confirm')}
              >
                CONTINUE
              </Button>
            </div>
          </div>
        )}

        {step === 'confirm' && selectedSlotInfo && (
          <div className="px-6 py-5 space-y-4">
            <div style={FONT} className="text-foreground space-y-3">
              {isVoiceToText ? (
                <>
                  <p>
                    This clones <strong>{selectedSlotInfo.label}</strong>'s live prompt document into this text setter's prompt{userGuidelines.trim() ? ', following your instructions' : ''}. Compliance lines (AI disclosure, recording disclosure, NCCP guardrail) are preserved word for word; voice-only tooling, call flow and spoken filler are removed.
                  </p>
                  <p className="text-destructive">
                    The section editor below will still show the older parameter-built prompt. Do not re-save it there afterwards, or the clone will be overwritten.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    This will overwrite the entire configuration of this setter. AI will generate a completely new configuration based on <strong>{selectedSlotInfo.label}</strong>'s content{userGuidelines.trim() ? ' and your instructions' : ''}.
                  </p>
                  {isCrossChannel && (
                    <p className="text-destructive">
                      Cross-channel copy: {selectedSlotInfo.channel} → {currentChannel}. Parameters will be adapted to fit the {currentChannel} channel structure.
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1 groove-btn"
                style={LABEL_FONT}
                onClick={() => setStep('select')}
              >
                BACK
              </Button>
              <Button
                className="flex-1 groove-btn-destructive"
                style={LABEL_FONT}
                disabled={loading}
                onClick={handleStartCopy}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    STARTING...
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-1.5" />
                    COPY & OVERWRITE
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
