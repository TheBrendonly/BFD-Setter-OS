import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowLeft, Bot, ChevronDown, ChevronUp, History, Info, Rocket, Save, Settings2, Wand2 } from 'lucide-react';
import { VoiceRetellSettings, type RetellVoiceSettings as RetellVoiceSettingsType } from '@/components/VoiceRetellSettings';
import { RetellModelSelector } from '@/components/RetellModelSelector';
import { usePromptVersions } from '@/hooks/usePromptVersions';
import { buildDynamicVarsBlock } from '@/data/retellDynamicVarsBlock';
import { CallTimeAppendBlock, type CallTimeAppend } from './CallTimeAppendBlock';
import { MetaPromptRevealDialog } from './MetaPromptRevealDialog';
import { ConversationFlowOutlineEditor } from './ConversationFlowOutlineEditor';
import { outlineToText, type FlowOutline } from '@/lib/conversationFlowOutline';

// Canonical prompt-document page (doc model, 2026-06-12). After initial setup the
// prompt lives HERE as one editable document; the section editor is setup-only.
// Push sends this text verbatim (+ booking append + retell-proxy DYNAMIC_VARS_BLOCK).
// Admin (agency-role) surface; gated at the PromptManagement entry point.

export interface PromptDocRecord {
  id: string;
  client_id: string;
  slot_id: string;
  engine_type: string;
  doc_content: string;
  flow_outline: unknown | null;
  conversation_flow_id: string | null;
  status: string;
  deployed_doc_content: string | null;
  setup_completed_at: string | null;
  promoted_from_full_prompt: boolean;
}

interface PromptDocPageProps {
  clientId: string;
  slotId: string;
  setterName: string;
  doc: PromptDocRecord | null;
  retellAgentId?: string | null;
  clientTimezone: string;
  bookingEnabled: boolean;
  bookingPrompt: string | null;
  retellVoiceSettings: RetellVoiceSettingsType;
  onRetellVoiceSettingsChange: (updates: Partial<RetellVoiceSettingsType>) => void;
  model: string;
  onModelChange: (model: string) => void;
  saving: boolean;
  onSaveDraft: (content: string) => Promise<void>;
  onPush: (content: string) => Promise<void>;
  onBack: () => void;
  onOpenModifyWithAI: (content: string, apply: (next: string) => void) => void;
  onOpenSettings: () => void;
  onRerunSetup?: () => void;
  // Conversation-flow engine handlers (engine_type === 'conversation-flow').
  onHydrateFlow?: () => Promise<FlowOutline | null>;
  onSaveFlowDraft?: (outline: FlowOutline) => Promise<void>;
  onPushFlow?: (outline: FlowOutline) => Promise<void>;
}

const MONO_STYLE: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: '13px',
  lineHeight: '1.6',
};

export const PromptDocPage: React.FC<PromptDocPageProps> = ({
  clientId,
  slotId,
  setterName,
  doc,
  retellAgentId,
  clientTimezone,
  bookingEnabled,
  bookingPrompt,
  retellVoiceSettings,
  onRetellVoiceSettingsChange,
  model,
  onModelChange,
  saving,
  onSaveDraft,
  onPush,
  onBack,
  onOpenModifyWithAI,
  onOpenSettings,
  onRerunSetup,
  onHydrateFlow,
  onSaveFlowDraft,
  onPushFlow,
}) => {
  const [docText, setDocText] = useState('');
  const isFlowEngine = doc?.engine_type === 'conversation-flow';
  const [flowOutline, setFlowOutline] = useState<FlowOutline | null>(null);
  const [flowRefreshing, setFlowRefreshing] = useState(false);
  const [showAppends, setShowAppends] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showMetaPrompt, setShowMetaPrompt] = useState(false);
  const [showRerunConfirm, setShowRerunConfirm] = useState(false);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  const { versions, saveVersion } = usePromptVersions(clientId, slotId);

  // Re-seed the editor whenever a different doc row loads (slot switch / promotion).
  useEffect(() => {
    setDocText(doc?.doc_content ?? '');
  }, [doc?.id]);

  // Conversation-flow: seed from the cached outline, then hydrate from the LIVE
  // Retell flow (live wins, so dashboard edits are absorbed instead of clobbered).
  const refreshFlow = async () => {
    if (!onHydrateFlow) return;
    setFlowRefreshing(true);
    try {
      const live = await onHydrateFlow();
      if (live) setFlowOutline(live);
    } finally {
      setFlowRefreshing(false);
    }
  };
  useEffect(() => {
    if (!doc || doc.engine_type !== 'conversation-flow') return;
    setFlowOutline((doc.flow_outline as FlowOutline | null) ?? null);
    void refreshFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);

  const isDirtyVsDeployed = doc ? docText !== (doc.deployed_doc_content ?? '') : false;
  const isDirtyVsDraft = doc ? docText !== doc.doc_content : false;

  const callTimeAppends = useMemo<CallTimeAppend[]>(() => {
    const appends: CallTimeAppend[] = [];
    // Booking instructions are a single-prompt append; in a conversation flow the
    // booking stage lives in its own node. The dynamic-vars block applies to both
    // (appended to general_prompt / global_prompt respectively).
    if (!isFlowEngine && bookingEnabled && bookingPrompt) {
      appends.push({
        id: 'push:booking',
        title: 'Booking Instructions (appended at push)',
        text: `\n## BOOKING INSTRUCTIONS\n${bookingPrompt}`,
      });
    }
    appends.push({
      id: 'push:dynamic-vars',
      title: isFlowEngine
        ? 'Dynamic Variables (auto-appended to the global prompt at push)'
        : 'Dynamic Variables (auto-injected at push)',
      text: buildDynamicVarsBlock(clientTimezone),
    });
    return appends;
  }, [isFlowEngine, bookingEnabled, bookingPrompt, clientTimezone]);

  const handleSaveDraft = async () => {
    if (!doc) return;
    if (isFlowEngine) {
      if (!flowOutline || !onSaveFlowDraft) return;
      await saveVersion(outlineToText(flowOutline), 'Flow edit');
      await onSaveFlowDraft(flowOutline);
      return;
    }
    await saveVersion(docText, 'Doc edit');
    await onSaveDraft(docText);
  };

  const handlePush = async () => {
    if (!doc) return;
    if (isFlowEngine) {
      if (!flowOutline || !onPushFlow) return;
      await saveVersion(outlineToText(flowOutline), 'Flow edit (pre-push)');
      await onPushFlow(flowOutline);
      return;
    }
    if (isDirtyVsDraft) await saveVersion(docText, 'Doc edit (pre-push)');
    await onPush(docText);
  };

  if (!doc) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground" style={MONO_STYLE}>Loading prompt document…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <h2 className="text-lg font-semibold mr-2">{setterName || slotId}</h2>
        <Badge variant="outline" className="uppercase">
          {doc.engine_type === 'conversation-flow' ? 'Conversation Flow' : 'Single Prompt'}
        </Badge>
        {retellAgentId && (
          <span className="text-muted-foreground" style={{ ...MONO_STYLE, fontSize: '11px' }}>
            agent: {retellAgentId}
          </span>
        )}
        {isFlowEngine ? (
          <Badge variant={doc.status === 'deployed' ? 'secondary' : 'destructive'}>
            {doc.status === 'deployed' ? 'Deployed' : 'Draft'}
          </Badge>
        ) : isDirtyVsDeployed ? (
          <Badge variant="destructive">Unpushed changes</Badge>
        ) : (
          <Badge variant="secondary">In sync with Retell</Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleSaveDraft} disabled={saving} size="sm" variant="outline">
          <Save className="w-4 h-4 mr-1.5" /> Save Draft
        </Button>
        <Button onClick={handlePush} disabled={saving} size="sm">
          <Rocket className="w-4 h-4 mr-1.5" /> {saving ? 'Working…' : 'Push to Retell'}
        </Button>
        {!isFlowEngine && (
          <>
            <Button
              onClick={() => onOpenModifyWithAI(docText, setDocText)}
              disabled={saving}
              size="sm"
              variant="outline"
            >
              <Wand2 className="w-4 h-4 mr-1.5" /> Modify with AI
            </Button>
            <Button
              onClick={() => setShowMetaPrompt(true)}
              size="sm"
              variant="ghost"
              title="View the system prompt Modify with AI uses"
            >
              <Info className="w-4 h-4 mr-1.5" /> AI instructions
            </Button>
            {onRerunSetup && (
              <Button onClick={() => setShowRerunConfirm(true)} disabled={saving} size="sm" variant="ghost">
                <Bot className="w-4 h-4 mr-1.5" /> Re-run Setup
              </Button>
            )}
          </>
        )}
      </div>

      {isFlowEngine ? (
        flowOutline ? (
          <ConversationFlowOutlineEditor
            outline={flowOutline}
            onChange={setFlowOutline}
            onRefreshFromRetell={onHydrateFlow ? refreshFlow : undefined}
            refreshing={flowRefreshing}
            disabled={saving}
          />
        ) : (
          <p className="text-muted-foreground" style={MONO_STYLE}>
            {flowRefreshing ? 'Loading conversation flow from Retell…' : 'No conversation flow found for this setter yet.'}
          </p>
        )
      ) : (
        <>
          <Textarea
            value={docText}
            onChange={(e) => setDocText(e.target.value)}
            spellCheck={false}
            className="min-h-[60vh] w-full"
            style={MONO_STYLE}
            placeholder="The full setter prompt lives here. Edit directly and Save Draft, then Push to Retell."
          />
          <div className="text-right text-muted-foreground" style={{ ...MONO_STYLE, fontSize: '11px' }}>
            {docText.length.toLocaleString()} chars
          </div>
        </>
      )}

      <Collapsible open={showAppends} onOpenChange={setShowAppends}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm">
            {showAppends ? <ChevronUp className="w-4 h-4 mr-1.5" /> : <ChevronDown className="w-4 h-4 mr-1.5" />}
            Added at call time (push)
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <CallTimeAppendBlock appends={callTimeAppends} />
        </CollapsibleContent>
      </Collapsible>

      <Collapsible open={showVersions} onOpenChange={setShowVersions}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm">
            <History className="w-4 h-4 mr-1.5" /> Versions ({versions.length})
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          {versions.length === 0 ? (
            <p className="text-muted-foreground" style={MONO_STYLE}>No saved versions yet.</p>
          ) : (
            [...versions].reverse().map((v) => (
              <Card key={v.id}>
                <CardHeader className="py-2 px-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-sm font-medium">
                      V{v.version_number} · {v.label}
                      <span className="text-muted-foreground font-normal ml-2" style={{ fontSize: '11px' }}>
                        {new Date(v.created_at).toLocaleString()}
                      </span>
                    </CardTitle>
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setExpandedVersionId(expandedVersionId === v.id ? null : v.id)}
                      >
                        {expandedVersionId === v.id ? 'Hide' : 'View'}
                      </Button>
                      {!isFlowEngine && (
                        <Button size="sm" variant="outline" onClick={() => setDocText(v.prompt_content)}>
                          Restore
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                {expandedVersionId === v.id && (
                  <CardContent className="pt-0 px-3 pb-3">
                    <div className="groove-border bg-card overflow-y-auto p-2" style={{ maxHeight: '40vh' }}>
                      <pre className="whitespace-pre-wrap break-words m-0" style={MONO_STYLE}>{v.prompt_content}</pre>
                    </div>
                  </CardContent>
                )}
              </Card>
            ))
          )}
        </CollapsibleContent>
      </Collapsible>

      <Collapsible open={showSettings} onOpenChange={setShowSettings}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm">
            <Settings2 className="w-4 h-4 mr-1.5" /> Agent Settings
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-4">
          <p className="text-muted-foreground" style={{ ...MONO_STYLE, fontSize: '12px' }}>
            Voice, model and call settings. Changes here are included on the next Push to Retell.
            Booking prompt and delays live in the full settings view.
          </p>
          <RetellModelSelector value={model} onChange={onModelChange} />
          <VoiceRetellSettings
            clientId={clientId}
            settings={retellVoiceSettings}
            onChange={onRetellVoiceSettingsChange}
            bookingEnabled={bookingEnabled}
          />
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            Open full settings view
          </Button>
        </CollapsibleContent>
      </Collapsible>

      <MetaPromptRevealDialog
        open={showMetaPrompt}
        onOpenChange={setShowMetaPrompt}
        clientId={clientId}
        onEditInSettings={onOpenSettings}
      />

      <AlertDialog open={showRerunConfirm} onOpenChange={setShowRerunConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-run setup for this setter?</AlertDialogTitle>
            <AlertDialogDescription>
              The section-based setup will open, and completing it REPLACES this prompt
              document with a freshly compiled one. The current document is backed up to
              Versions first, so nothing is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await saveVersion(docText, 'Pre-setup backup');
                setShowRerunConfirm(false);
                onRerunSetup?.();
              }}
            >
              Back up &amp; open setup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
