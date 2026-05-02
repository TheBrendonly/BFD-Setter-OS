import React, { useState, useEffect, useCallback } from 'react';
import { useGenerationGuard } from '@/hooks/useGenerationGuard';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import { Button } from '@/components/ui/button';
import SavingOverlay from '@/components/SavingOverlay';
import { Textarea } from '@/components/ui/textarea';
import { PromptVersionPanel } from '@/components/prompt-editor/PromptVersionPanel';
import { PromptDiffReview } from '@/components/prompt-editor/PromptDiffReview';
import { PromptLoadingOverlay } from '@/components/prompt-editor/PromptLoadingOverlay';
import { buildSectionDiffs, resolvePromptFromDiffs, type SectionDiff } from '@/components/prompt-editor/diffUtils';
import { usePromptVersions } from '@/hooks/usePromptVersions';
import { usePromptChatHistory, type ChatMessage } from '@/hooks/usePromptChatHistory';
import { Save, Check, RotateCcw, Maximize2, Send, Sparkles } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const FONT = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' };

const LOADING_PHRASES = [
  'Analyzing prompt structure...',
  'Evaluating tone consistency...',
  'Matching behavioral patterns...',
  'Optimizing conversation flow...',
  'Refining response patterns...',
  'Finalizing modifications...',
];

const AI_POLL_INTERVAL = 3000;
const AI_POLL_TIMEOUT = 300000;

const LoadingIndicator: React.FC = () => {
  const [phraseIndex, setPhraseIndex] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setPhraseIndex(prev => (prev + 1) % LOADING_PHRASES.length), 2200);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="flex justify-start">
      <div className="px-3 py-2 groove-border bg-card" style={FONT}>
        <span className="animate-pulse" key={phraseIndex}>{LOADING_PHRASES[phraseIndex]}</span>
      </div>
    </div>
  );
};

const DialogBootstrapOverlay: React.FC = () => {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/85 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3">
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2.5 h-2.5 bg-foreground"
              style={{
                animation: 'saving-bounce 1.2s ease-in-out infinite',
                animationDelay: `${i * 0.15}s`,
              }}
            />
          ))}
        </div>
        <p
          className="text-foreground"
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: '22px',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
          }}
        >
          LOADING PROMPT
        </p>
        <style>{`
          @keyframes saving-bounce {
            0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
            40% { opacity: 1; transform: scale(1.2); }
          }
        `}</style>
      </div>
    </div>
  );
};

interface MiniPromptAIDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  promptContent: string;
  baselinePromptContent?: string;
  onApplyPrompt: (newContent: string) => void;
  clientId: string;
  slotId: string;
  configKey: string;
  disabled?: boolean;
  initialDirty?: boolean;
}

export const MiniPromptAIDialog: React.FC<MiniPromptAIDialogProps> = ({
  open,
  onOpenChange,
  title,
  promptContent,
  baselinePromptContent = '',
  onApplyPrompt,
  clientId,
  slotId,
  configKey,
  disabled = false,
  initialDirty = false,
}) => {
  const { toast } = useToast();
  // Compound key for scoping versions & chat per mini-prompt
  const scopedSlotId = `${slotId}__${configKey}`;

  const { versions: dbVersions, saveVersion, loadVersions, loading: versionsLoading } = usePromptVersions(clientId, scopedSlotId);
  const { messages: chatMessages, addMessage: addChatMessage, loading: chatLoading } = usePromptChatHistory(clientId, scopedSlotId);

  const [v1Ready, setV1Ready] = useState(false);
  const v1CreationStartedRef = React.useRef(false);
  const isDataLoading = versionsLoading || chatLoading || !v1Ready;
  const wasOpenRef = React.useRef(false);
  const lastScopedSlotIdRef = React.useRef<string | null>(null);

  const [editedPrompt, setEditedPrompt] = useState('');
  const [activeView, setActiveView] = useState<number | null>(null);
  const [sectionDiffs, setSectionDiffs] = useState<SectionDiff[] | null>(null);
  const [isAIGenerating, setIsAIGenerating] = useState(false);
  useGenerationGuard(isAIGenerating);
  const [isFirstReview, setIsFirstReview] = useState(false);
  const [hasManualEdits, setHasManualEdits] = useState(false);
  const [isSavingVersion, setIsSavingVersion] = useState(false);
  const [dialogOpenSnapshot, setDialogOpenSnapshot] = useState('');
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const chatTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const aiPollingRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const activeJobIdRef = React.useRef<string | null>(null);

  const currentVersionNumber = dbVersions.length > 0 ? Math.max(...dbVersions.map(v => v.version_number)) : null;
  const isViewingCurrentVersion = activeView !== null && activeView === currentVersionNumber;

  const clearAIPolling = useCallback(() => {
    if (aiPollingRef.current) {
      clearInterval(aiPollingRef.current);
      aiPollingRef.current = null;
    }
  }, []);

  // Only clear polling on unmount, NOT on close (job should persist)
  useEffect(() => clearAIPolling, [clearAIPolling]);

  const pollForJobResult = useCallback((jobId: string) => {
    return new Promise<any>((resolve, reject) => {
      const startTime = Date.now();
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearAIPolling();
        callback();
      };

      const poll = async () => {
        if (settled) return;

        if (Date.now() - startTime > AI_POLL_TIMEOUT) {
          finish(() => reject(new Error('AI generation timed out after 5 minutes.')));
          return;
        }

        try {
          const { data: pollRow, error: pollError } = await (supabase as any)
            .from('ai_generation_jobs')
            .select('status, result, error_message')
            .eq('id', jobId)
            .maybeSingle();

          if (pollError) {
            finish(() => reject(new Error(pollError.message || 'Failed to read AI generation result.')));
            return;
          }

          if (!pollRow) return;

          if (pollRow.status === 'completed') {
            finish(() => resolve(pollRow.result));
            return;
          }

          if (pollRow.status === 'failed' || pollRow.error_message) {
            finish(() => reject(new Error(pollRow.error_message || 'AI generation failed')));
          }
        } catch (pollErr) {
          console.error('Polling error:', pollErr);
          finish(() => reject(new Error(pollErr instanceof Error ? pollErr.message : 'Failed to read AI generation result.')));
        }
      };

      clearAIPolling();
      aiPollingRef.current = setInterval(() => {
        void poll();
      }, AI_POLL_INTERVAL);

      void poll();
    });
  }, [clearAIPolling]);

  // Initialize only when opening a fresh dialog session or switching prompts.
  useEffect(() => {
    if (!open) {
      // When closing, stop polling but keep activeJobIdRef so we can resume
      clearAIPolling();
      wasOpenRef.current = false;
      return;
    }

    const isFreshSession = !wasOpenRef.current || lastScopedSlotIdRef.current !== scopedSlotId;

    if (isFreshSession) {
      setEditedPrompt(promptContent);
      setDialogOpenSnapshot(promptContent);
      setHasManualEdits(initialDirty);
      setSectionDiffs(null);
      setIsFirstReview(false);
      setShowCloseWarning(false);
      setChatInput('');
      setIsBootstrapping(true);
      setV1Ready(false);
      v1CreationStartedRef.current = false;

      // If switching to a different scoped slot, clear the active job
      if (lastScopedSlotIdRef.current !== scopedSlotId) {
        activeJobIdRef.current = null;
        setIsAIGenerating(false);
      }
      // Don't reset isAIGenerating if we have an active job for this same slot
      // (i.e., user closed and reopened during generation)
    }

    wasOpenRef.current = true;
    lastScopedSlotIdRef.current = scopedSlotId;
  }, [open, scopedSlotId, promptContent]);

  // Resume polling for active job when dialog reopens
  useEffect(() => {
    if (!open || !clientId || !scopedSlotId) return;

    const activeJobId = activeJobIdRef.current;
    if (activeJobId && isAIGenerating) {
      // Resume polling for the active job
      pollForJobResult(activeJobId).then((jobResult) => {
        const modifiedPrompt = jobResult?.modifiedPrompt;
        if (!modifiedPrompt) {
          addChatMessage({ role: 'assistant', content: 'The AI returned an empty response. Please try again.' });
          setIsAIGenerating(false);
          activeJobIdRef.current = null;
          return;
        }
        const summary = jobResult?.summary || 'Prompt modified. Review changes below.';
        addChatMessage({ role: 'assistant', content: summary });
        setIsAIGenerating(false);
        activeJobIdRef.current = null;
        setIsFirstReview(true);
        const diffs = buildSectionDiffs(editedPrompt, modifiedPrompt);
        setSectionDiffs(diffs);
      }).catch((err) => {
        addChatMessage({ role: 'assistant', content: `❌ Error: ${err.message || 'Unknown error'}` });
        setIsAIGenerating(false);
        activeJobIdRef.current = null;
      });
      return;
    }

    // Check DB for any active mini-prompt jobs for this slot on fresh open
    if (!activeJobId && !isAIGenerating) {
      (async () => {
        try {
          const { data } = await (supabase as any)
            .from('ai_generation_jobs')
            .select('id, status, result, error_message, created_at')
            .eq('client_id', clientId)
            .eq('job_type', 'modify-prompt-ai')
            .in('status', ['pending', 'running'])
            .order('created_at', { ascending: false })
            .limit(1);

          if (data && data.length > 0) {
            const row = data[0];
            // Check if this job belongs to this slot by inspecting input_payload
            const payload = row.input_payload || {};
            if (payload.slotId === slotId || !payload.slotId) {
              const createdAt = new Date(row.created_at).getTime();
              if (Date.now() - createdAt < AI_POLL_TIMEOUT) {
                activeJobIdRef.current = row.id;
                setIsAIGenerating(true);
                pollForJobResult(row.id).then((jobResult) => {
                  const modifiedPrompt = jobResult?.modifiedPrompt;
                  if (!modifiedPrompt) {
                    addChatMessage({ role: 'assistant', content: 'The AI returned an empty response. Please try again.' });
                    setIsAIGenerating(false);
                    activeJobIdRef.current = null;
                    return;
                  }
                  const summary = jobResult?.summary || 'Prompt modified. Review changes below.';
                  addChatMessage({ role: 'assistant', content: summary });
                  setIsAIGenerating(false);
                  activeJobIdRef.current = null;
                  setIsFirstReview(true);
                  const diffs = buildSectionDiffs(editedPrompt, modifiedPrompt);
                  setSectionDiffs(diffs);
                }).catch((err) => {
                  addChatMessage({ role: 'assistant', content: `❌ Error: ${err.message || 'Unknown error'}` });
                  setIsAIGenerating(false);
                  activeJobIdRef.current = null;
                });
              }
            }
          }
        } catch {
          // ignore
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clientId, scopedSlotId]);

  useEffect(() => {
    if (!open || !isBootstrapping || isDataLoading) return;
    setIsBootstrapping(false);
  }, [open, isBootstrapping, isDataLoading]);

  // Auto-create V1 if no versions exist when dialog opens
  useEffect(() => {
    if (!open || !clientId || !scopedSlotId) return;
    
    // If prompt is empty, skip V1 creation but still mark as ready
    if (!promptContent.trim()) {
      setV1Ready(true);
      return;
    }
    
    if (dbVersions.length === 0 && !versionsLoading) {
      // Prevent double-invocation of V1 creation
      if (v1CreationStartedRef.current) return;
      v1CreationStartedRef.current = true;
      // Check DB directly to avoid race conditions / 409s
      (async () => {
        try {
          const { data: existing } = await (supabase as any)
            .from('prompt_versions')
            .select('id')
            .eq('client_id', clientId)
            .eq('slot_id', scopedSlotId)
            .eq('version_number', 1)
            .limit(1);
          if (existing && existing.length > 0) {
            await loadVersions();
            setV1Ready(true);
            return;
          }
          await (supabase as any)
            .from('prompt_versions')
            .insert({
              client_id: clientId,
              slot_id: scopedSlotId,
              version_number: 1,
              prompt_content: baselinePromptContent.trim() || promptContent.trim(),
              label: 'V1',
            });
          await loadVersions();
          setV1Ready(true);
        } catch (err) {
          console.error('Error auto-creating V1:', err);
          setV1Ready(true);
        }
      })();
    } else if (dbVersions.length > 0) {
      setV1Ready(true);
    }
  }, [open, dbVersions.length, versionsLoading, clientId, scopedSlotId, promptContent, baselinePromptContent, loadVersions]);

  // Always sync activeView to latest version when versions change
  useEffect(() => {
    if (open && dbVersions.length > 0) {
      const maxV = Math.max(...dbVersions.map(v => v.version_number));
      setActiveView(maxV);
    }
  }, [dbVersions, open]);

  const handleClose = (openState: boolean) => {
    if (!openState) {
      if (isSavingVersion) return;
      const hasPendingDiffs = sectionDiffs !== null && sectionDiffs.some(d => d.status === 'pending');
      const hasUnreviewedAI = sectionDiffs !== null;
      const hasUnsavedManual = hasManualEdits && editedPrompt !== dialogOpenSnapshot;
      if (hasPendingDiffs || hasUnreviewedAI || hasUnsavedManual || isAIGenerating) {
        setShowCloseWarning(true);
        return;
      }
      onOpenChange(false);
    }
  };

  const handleSendAI = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || isAIGenerating) return;

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    await addChatMessage(userMsg);
    setChatInput('');
    if (chatTextareaRef.current) { chatTextareaRef.current.rows = 1; chatTextareaRef.current.style.height = '32px'; chatTextareaRef.current.style.lineHeight = '26px'; chatTextareaRef.current.style.paddingTop = '0px'; chatTextareaRef.current.style.paddingBottom = '0px'; }
    setIsAIGenerating(true);
    setSectionDiffs(null);

    const recentHistory = chatMessages.slice(-10);

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { data: jobData, error } = await supabase.functions.invoke('modify-prompt-ai', {
          body: {
            fullPrompt: editedPrompt,
            userMessage: trimmed,
            conversationHistory: recentHistory,
            clientId,
            slotId,
            sectionOrder: [],
          },
        });

        if (error) {
          let errorMessage = error.message || String(error);
          const ctx = (error as { context?: Response | undefined }).context;
          if (ctx && typeof ctx.json === 'function') {
            try {
              const body: unknown = await ctx.json();
              if (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string') {
                errorMessage = (body as { error: string }).error;
              }
            } catch { /* body unreadable, keep generic message */ }
          }
          if ((errorMessage.includes('Failed to send') || errorMessage.includes('Failed to fetch')) && attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
            continue;
          }
          throw new Error(errorMessage);
        }

        if (jobData?.error) {
          await addChatMessage({ role: 'assistant', content: `AI Error: ${jobData.error}` });
          setIsAIGenerating(false);
          return;
        }

        const jobId = jobData?.job_id;
        if (!jobId) throw new Error('No job_id returned');

        activeJobIdRef.current = jobId;
        const jobResult = await pollForJobResult(jobId);

        const modifiedPrompt = jobResult?.modifiedPrompt;
        if (!modifiedPrompt) {
          await addChatMessage({ role: 'assistant', content: 'The AI returned an empty response. Please try again.' });
          setIsAIGenerating(false);
          activeJobIdRef.current = null;
          return;
        }

        const summary = jobResult?.summary || 'Prompt modified. Review changes below.';
        await addChatMessage({ role: 'assistant', content: summary });
        
        setIsAIGenerating(false);
        activeJobIdRef.current = null;
        setIsFirstReview(true);
        const diffs = buildSectionDiffs(editedPrompt, modifiedPrompt);
        setSectionDiffs(diffs);
        return;
      } catch (err: any) {
        if (attempt < MAX_RETRIES && (err.message?.includes('Network') || err.message?.includes('fetch'))) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        await addChatMessage({ role: 'assistant', content: `❌ Error: ${err.message || 'Unknown error'}` });
        setIsAIGenerating(false);
        activeJobIdRef.current = null;
        return;
      }
    }
  };

  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  if (!open) return null;

  const showBootstrapLoader = isBootstrapping;

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent
          className="flex flex-col"
          style={{ width: '95vw', maxWidth: '1600px', height: '92vh', maxHeight: '92vh' }}
        >
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '22px', letterSpacing: '1px' }}>
              {title.toUpperCase()}
            </DialogTitle>
            <DialogDescription style={FONT} className="mt-1 text-muted-foreground">
              {sectionDiffs ? 'Review each change. Approve or keep original.' : 'Modify this mini-prompt with AI or edit manually.'}
            </DialogDescription>
          </DialogHeader>

          <div className="relative flex-1 min-h-0">
            {showBootstrapLoader && <DialogBootstrapOverlay />}
            {isSavingVersion && <SavingOverlay isVisible={true} message="Saving version..." />}

            <div className={cn('flex h-full min-h-0', showBootstrapLoader && 'opacity-0 pointer-events-none')} style={{ overflow: 'hidden' }}>
              {/* Left: Version Panel */}
              <PromptVersionPanel
                dbVersions={dbVersions}
                activeView={activeView}
                hasPendingDiffs={sectionDiffs !== null && sectionDiffs.some(d => d.status === 'pending')}
                hasAnyDiffs={sectionDiffs !== null}
                isFirstReview={isFirstReview}
                  onSelectView={(view) => {
                  const version = dbVersions.find(v => v.version_number === view);
                  if (version) {
                    const maxV = Math.max(...dbVersions.map(v => v.version_number));
                    // Current/latest version: always show plain editable prompt, no diffs
                    if (view === maxV) {
                      setSectionDiffs(null);
                      setEditedPrompt(promptContent);
                    } else if (version.original_prompt_content) {
                      const diffs = buildSectionDiffs(version.original_prompt_content, version.prompt_content);
                      setSectionDiffs(diffs);
                      setEditedPrompt(version.original_prompt_content);
                    } else {
                      setSectionDiffs(null);
                      setEditedPrompt(version.prompt_content);
                    }
                    setActiveView(view);
                    setHasManualEdits(false);
                  }
              }}
              />

              {/* Center: Prompt area */}
              <div className="flex-1 min-w-0 flex flex-col" style={{ borderRight: '1px solid hsl(var(--border-groove) / 0.3)' }}>
                <div
                  className="flex items-center justify-between px-5 shrink-0 bg-background"
                  style={{ borderBottom: '3px groove hsl(var(--border-groove))', height: '40px' }}
                >
                  <span className="text-foreground font-medium tracking-wide" style={FONT}>Prompt</span>
                </div>

                <div className="flex-1 min-h-0 relative bg-card" style={{ padding: '24px' }}>
                  <PromptLoadingOverlay isVisible={isAIGenerating} />

                {activeView !== null && !isViewingCurrentVersion && !sectionDiffs ? (
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="relative flex-1 min-h-0">
                      <Textarea
                        value={editedPrompt}
                        readOnly
                        className="h-full min-h-0 w-full leading-relaxed !resize-none"
                        style={FONT}
                      />
                    </div>
                    <div className="pt-2">
                      <Button
                        type="button"
                        variant="default"
                        onClick={async () => {
                          const version = dbVersions.find(v => v.version_number === activeView);
                          if (!version) return;
                          await saveVersion(version.prompt_content, 'Reverted to V' + activeView);
                          await loadVersions();
                          setEditedPrompt(version.prompt_content);
                          const newMax = (currentVersionNumber ?? 0) + 1;
                          setActiveView(newMax);
                          setSectionDiffs(null);
                          onApplyPrompt(version.prompt_content);
                          toast({ title: 'Version reverted', description: `Reverted to V${activeView} and saved.` });
                        }}
                        className="h-8 gap-1.5 font-medium"
                        style={FONT}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Revert This Version
                      </Button>
                    </div>
                  </div>
                ) : sectionDiffs && !isViewingCurrentVersion ? (
                  /* Historical version with diffs — show diff read-only + Revert button */
                  <div className="h-full min-h-0 flex flex-col">
                    <div className="relative flex-1 min-h-0">
                      <div className="absolute inset-0 overflow-y-auto bg-card px-3 py-2 groove-border leading-relaxed" style={FONT}>
                        <PromptDiffReview
                          diffs={sectionDiffs}
                          onApproveSection={() => {}}
                          onDeclineSection={() => {}}
                        />
                      </div>
                    </div>
                    <div className="pt-2">
                      <Button
                        type="button"
                        variant="default"
                        onClick={async () => {
                          const version = dbVersions.find(v => v.version_number === activeView);
                          if (!version) return;
                          await saveVersion(version.prompt_content, 'Reverted to V' + activeView);
                          await loadVersions();
                          setEditedPrompt(version.prompt_content);
                          const newMax = (currentVersionNumber ?? 0) + 1;
                          setActiveView(newMax);
                          setSectionDiffs(null);
                          onApplyPrompt(version.prompt_content);
                          toast({ title: 'Version reverted', description: `Reverted to V${activeView} and saved.` });
                        }}
                        className="h-8 gap-1.5 font-medium"
                        style={FONT}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Revert This Version
                      </Button>
                    </div>
                  </div>
                ) : sectionDiffs ? (
                  <div className={cn('h-full min-h-0 flex flex-col', isAIGenerating && 'opacity-30 pointer-events-none')}>
                    <div className="relative flex-1 min-h-0">
                      <div className="absolute inset-0 overflow-y-auto bg-card px-3 py-2 groove-border leading-relaxed" style={FONT}>
                        <PromptDiffReview
                          diffs={sectionDiffs}
                          onApproveSection={(index) => {
                            setSectionDiffs(prev => {
                              if (!prev) return prev;
                              const updated = [...prev];
                              updated[index] = { ...updated[index], status: 'approved' };
                              return updated;
                            });
                          }}
                          onDeclineSection={(index) => {
                            setSectionDiffs(prev => {
                              if (!prev) return prev;
                              const updated = [...prev];
                              updated[index] = { ...updated[index], status: 'declined' };
                              return updated;
                            });
                          }}
                        />
                      </div>
                    </div>

                    {sectionDiffs.some(d => d.hasChanges) && sectionDiffs.some(d => d.status === 'pending') && (
                      <div className="shrink-0 pt-2 flex gap-2">
                        <Button
                          type="button"
                          onClick={() => {
                            setSectionDiffs(null);
                            setIsFirstReview(false);
                          }}
                          variant="outline"
                          className="flex-1 h-10"
                          style={{ ...FONT, textTransform: 'uppercase' }}
                        >
                          <RotateCcw className="w-4 h-4 mr-1.5" />
                          KEEP ORIGINAL
                        </Button>
                        <Button
                          type="button"
                          onClick={async () => {
                            const allApproved = sectionDiffs.map(d => d.status === 'pending' ? { ...d, status: 'approved' as const } : d);
                            const resolved = resolvePromptFromDiffs(allApproved);
                            const originalPrompt = editedPrompt;
                            const newMax = (currentVersionNumber ?? 0) + 1;
                            setActiveView(newMax);
                            onApplyPrompt(resolved);
                            setEditedPrompt(resolved);
                            setSectionDiffs(null);
                            setIsFirstReview(false);
                            setHasManualEdits(false);
                            setDialogOpenSnapshot(resolved);
                            setIsSavingVersion(true);
                            // No toast — saving overlay handles feedback
                            await saveVersion(resolved, 'Approved all AI changes', originalPrompt);
                            await loadVersions();
                            setIsSavingVersion(false);
                          }}
                          className="flex-1 h-10 groove-btn-positive"
                          style={{ ...FONT, textTransform: 'uppercase' }}
                        >
                          <Check className="w-4 h-4 mr-1.5" />
                          APPROVE ALL CHANGES
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="relative flex-1 min-h-0">
                      <Textarea
                        value={editedPrompt}
                        onChange={(e) => {
                          if (disabled) return;
                          setEditedPrompt(e.target.value);
                          if (!hasManualEdits) setHasManualEdits(true);
                        }}
                        className={cn('h-full min-h-0 w-full leading-relaxed !resize-none', isAIGenerating && 'opacity-30')}
                        style={FONT}
                        disabled={disabled || isAIGenerating}
                      />
                    </div>
                    <div className="pt-2">
                      <Button
                        type="button"
                        variant="default"
                        onClick={async () => {
                          const newMax = (currentVersionNumber ?? 0) + 1;
                          setActiveView(newMax);
                          onApplyPrompt(editedPrompt);
                          setHasManualEdits(false);
                          setDialogOpenSnapshot(editedPrompt);
                          setIsSavingVersion(true);
                          // No toast — saving overlay handles feedback
                          await saveVersion(editedPrompt, 'Manual edit');
                          await loadVersions();
                          setIsSavingVersion(false);
                        }}
                        disabled={disabled || isAIGenerating || !hasManualEdits || isSavingVersion}
                        className="w-full h-10 font-medium groove-btn-positive groove-btn-pulse"
                        style={{ ...FONT, textTransform: 'uppercase' }}
                      >
                        <Save className="w-4 h-4 mr-1.5" />
                        SAVE MINI PROMPT
                      </Button>
                    </div>
                  </div>
                )}
                </div>
              </div>

              {/* Right: AI Chat Panel */}
              <div className="shrink-0 flex flex-col" style={{ width: '380px' }}>
                <div
                  className="flex items-center px-5 shrink-0 bg-background"
                  style={{ borderBottom: '3px groove hsl(var(--border-groove))', height: '40px' }}
                >
                  <span className="text-foreground font-medium tracking-wide" style={FONT}>AI Assistant</span>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 bg-card">
                  {chatMessages.length === 0 && (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <div className="max-w-[280px] mx-auto text-center">
                        <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <h3 className="font-medium mb-4 text-foreground" style={{ fontFamily: "'VT323', monospace", fontSize: '28px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Ask Me Anything</h3>
                        <div className="flex flex-col gap-2">
                          {[
                            'Make the tone more casual',
                            'Add stronger objection handling',
                            'Simplify the language',
                          ].map((suggestion, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setChatInput(suggestion)}
                              className="w-full text-left px-3 py-2 groove-border bg-card hover:bg-accent transition-colors text-foreground"
                              style={FONT}
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`max-w-[85%] px-3 py-2 groove-border ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-card'}`}
                        style={{ ...FONT, lineHeight: '1.5' }}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}

                  {isAIGenerating && <LoadingIndicator />}

                  <div ref={messagesEndRef} />
                </div>

                <div className="shrink-0 bg-card" style={{ padding: '24px', paddingTop: '0px' }}>
                  <div className="flex gap-2 items-end pt-2">
                    <textarea
                      ref={chatTextareaRef}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendAI(); } }}
                      placeholder="Describe changes..."
                      disabled={disabled || isAIGenerating}
                      rows={1}
                      onFocus={(e) => { e.currentTarget.rows = 4; e.currentTarget.style.height = 'auto'; e.currentTarget.style.lineHeight = '1.5'; e.currentTarget.style.paddingTop = '8px'; e.currentTarget.style.paddingBottom = '8px'; }}
                      onBlur={(e) => { if (!e.currentTarget.value.trim()) { e.currentTarget.rows = 1; e.currentTarget.style.height = '32px'; e.currentTarget.style.lineHeight = '26px'; e.currentTarget.style.paddingTop = '0px'; e.currentTarget.style.paddingBottom = '0px'; } }}
                      className="flex-1 field-text w-full bg-card px-3 text-foreground placeholder:text-muted-foreground outline-none focus:outline-none focus:ring-0 focus:shadow-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 groove-border resize-none transition-all duration-200"
                      style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', letterSpacing: '0.3px', height: '32px', lineHeight: '26px', paddingTop: '0px', paddingBottom: '0px' }}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="default"
                      onClick={handleSendAI}
                      disabled={disabled || isAIGenerating || !chatInput.trim()}
                      className="h-8 w-8 shrink-0 groove-btn-white"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Close Warning */}
      <UnsavedChangesDialog
        open={showCloseWarning}
        onOpenChange={setShowCloseWarning}
        description={isAIGenerating
          ? "AI is still generating. You can safely close — the generation will continue in the background and resume when you reopen."
          : "Are you sure you want to close? You have unapproved AI modifications that will be lost if you exit now."}
        onDiscard={() => {
          setSectionDiffs(null);
          // Don't cancel AI generation — let it continue in background
          // Don't clear activeJobIdRef so we can resume on reopen
          if (!isAIGenerating) {
            activeJobIdRef.current = null;
          }
          setIsFirstReview(false);
          setHasManualEdits(false);
          onOpenChange(false);
        }}
      />
    </>
  );
};
