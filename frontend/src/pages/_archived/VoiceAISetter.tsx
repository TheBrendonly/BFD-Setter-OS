import React, { useState, useEffect, useCallback, useRef } from 'react';
import RetroLoader from '@/components/RetroLoader';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { StatusTag } from '@/components/StatusTag';
import { ConfigStatusBar } from '@/components/ConfigStatusBar';
import { toast } from 'sonner';
import { Phone, Brain, BookOpen, Rocket, Trash2, RefreshCw, Key, Loader2, ExternalLink, Play, Square, Wrench } from '@/components/icons';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { AgentToolsCard } from '@/components/AgentToolsCard';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';

interface VoiceOption {
  voice_id: string;
  name: string;
  preview_url: string | null;
  category: string;
  labels: Record<string, string>;
}

interface LlmOption {
  model_id: string;
  display_name: string;
  provider: string;
  is_deprecated: boolean;
  latency: number | null;
  cost_per_minute: number | null;
}

const DEFAULT_SYSTEM_PROMPT = `You are an AI voice assistant for Building Flow. You are professional, friendly, and helpful. Your job is to handle inbound calls, answer questions, and assist callers with their needs.

Key guidelines:
- Be conversational and natural — avoid sounding robotic
- Listen carefully before responding
- Keep responses concise (2-3 sentences max per turn)
- If you don't know something, say so honestly
- Always be polite and professional
- Confirm important details by repeating them back`;

const DEFAULT_FIRST_MESSAGE = "Hi there! Thank you for calling. How can I help you today?";

const VoiceAISetter = () => {
  const { clientId } = useParams();

  usePageHeader({ title: 'Voice Setter' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [importingPhone, setImportingPhone] = useState(false);
  const [savingKb, setSavingKb] = useState(false);

  const [hasApiKey, setHasApiKey] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [phoneNumberId, setPhoneNumberId] = useState<string | null>(null);
  const [kbDocId, setKbDocId] = useState<string | null>(null);
  const [toolIds, setToolIds] = useState<string[]>([]);

  const [apiKey, setApiKey] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [firstMessage, setFirstMessage] = useState(DEFAULT_FIRST_MESSAGE);
  const [voiceId, setVoiceId] = useState('');
  const [llmModel, setLlmModel] = useState('');

  const [phoneNumber, setPhoneNumber] = useState('');
  const [twilioSid, setTwilioSid] = useState('');
  const [twilioToken, setTwilioToken] = useState('');
  const [knowledgeText, setKnowledgeText] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const savedConfigRef = useRef<string>('');

  // Track unsaved changes
  useEffect(() => {
    if (loading) return;
    const currentConfig = JSON.stringify({ systemPrompt, firstMessage, voiceId, llmModel, knowledgeText });
    setHasUnsavedChanges(currentConfig !== savedConfigRef.current);
  }, [systemPrompt, firstMessage, voiceId, llmModel, knowledgeText, loading]);

  // Browser beforeunload warning
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const [llmOptions, setLlmOptions] = useState<LlmOption[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [loadingLlms, setLoadingLlms] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  const callEdgeFunction = useCallback(async (action: string, extraParams: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke('elevenlabs-manage-agent', {
      body: { action, clientId, ...extraParams },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  }, [clientId]);

  const fetchVoicesAndLlms = useCallback(async () => {
    setLoadingVoices(true);
    setLoadingLlms(true);
    try {
      const [voicesData, llmsData] = await Promise.all([
        callEdgeFunction('list-voices'),
        callEdgeFunction('list-llms'),
      ]);
      if (voicesData?.voices) {
        setVoiceOptions(voicesData.voices);
        if (!voiceId && voicesData.voices.length > 0) {
          setVoiceId(voicesData.voices[0].voice_id);
        }
      }
      if (llmsData?.llms) {
        const nonDeprecated = llmsData.llms.filter((l: LlmOption) => !l.is_deprecated);
        setLlmOptions(nonDeprecated);
        if (!llmModel && nonDeprecated.length > 0) {
          setLlmModel(nonDeprecated[0].model_id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch voices/llms:', err);
    } finally {
      setLoadingVoices(false);
      setLoadingLlms(false);
    }
  }, [callEdgeFunction, voiceId, llmModel]);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await callEdgeFunction('get-status');
      setHasApiKey(data.hasApiKey);
      setAgentId(data.agentId);
      setPhoneNumberId(data.phoneNumberId);
      setKbDocId(data.kbDocId);
      if (data.agentConfig && Object.keys(data.agentConfig).length > 0) {
        if (data.agentConfig.systemPrompt) setSystemPrompt(data.agentConfig.systemPrompt);
        if (data.agentConfig.firstMessage) setFirstMessage(data.agentConfig.firstMessage);
        if (data.agentConfig.voiceId) setVoiceId(data.agentConfig.voiceId);
        if (data.agentConfig.llmModel) setLlmModel(data.agentConfig.llmModel);
        if (data.agentConfig.knowledgeText) setKnowledgeText(data.agentConfig.knowledgeText);
        if (data.agentConfig.tool_ids) setToolIds(data.agentConfig.tool_ids);
      }
      if (data.toolIds) setToolIds(data.toolIds);
    } catch (err) {
      console.error('Failed to fetch status:', err);
    } finally {
      setLoading(false);
      // Snapshot after load
      setTimeout(() => {
        savedConfigRef.current = JSON.stringify({ systemPrompt, firstMessage, voiceId, llmModel, knowledgeText });
      }, 0);
    }
  }, [callEdgeFunction]);

  useEffect(() => { if (clientId) fetchStatus(); }, [clientId, fetchStatus]);
  useEffect(() => { if (hasApiKey) fetchVoicesAndLlms(); }, [hasApiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlayPreview = (voice: VoiceOption) => {
    if (playingVoiceId === voice.voice_id) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      setPlayingVoiceId(null);
      return;
    }
    if (!voice.preview_url) { toast.error('No preview available for this voice'); return; }
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(voice.preview_url);
    audio.onended = () => { setPlayingVoiceId(null); audioRef.current = null; };
    audio.onerror = () => { setPlayingVoiceId(null); audioRef.current = null; toast.error('Failed to play voice preview'); };
    audio.play();
    audioRef.current = audio;
    setPlayingVoiceId(voice.voice_id);
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) { toast.error('Please enter your ElevenLabs API key'); return; }
    setSaving(true);
    try {
      await callEdgeFunction('save-api-key', { apiKey: apiKey.trim() });
      setHasApiKey(true);
      toast.success('API key saved successfully');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to save API key'); }
    finally { setSaving(false); }
  };

  const getAgentConfig = () => ({ systemPrompt, firstMessage, voiceId, llmModel, language: 'en', knowledgeText });

  const handleDeploy = async () => {
    setDeploying(true);
    try {
      const data = await callEdgeFunction('deploy-agent', { agentConfig: getAgentConfig() });
      setAgentId(data.agentId);
      if (data.toolIds) setToolIds(data.toolIds);
      toast.success(`Agent deployed with ${data.toolIds?.length || 0} tools auto-configured!`);
      savedConfigRef.current = JSON.stringify(getAgentConfig());
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to deploy agent'); }
    finally { setDeploying(false); }
  };

  const handleUpdate = async () => {
    setSaving(true);
    try {
      await callEdgeFunction('update-agent', { agentConfig: getAgentConfig() });
      toast.success('Agent updated successfully');
      savedConfigRef.current = JSON.stringify(getAgentConfig());
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to update agent'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await callEdgeFunction('delete-agent');
      setAgentId(null); setPhoneNumberId(null); setKbDocId(null); setToolIds([]);
      setSystemPrompt(DEFAULT_SYSTEM_PROMPT); setFirstMessage(DEFAULT_FIRST_MESSAGE);
      setVoiceId(voiceOptions.length > 0 ? voiceOptions[0].voice_id : '');
      setLlmModel(llmOptions.length > 0 ? llmOptions[0].model_id : '');
      setKnowledgeText('');
      toast.success('Agent, tools, phone number, and knowledge base deleted');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to delete'); }
    finally { setDeleting(false); }
  };

  const handleImportPhone = async () => {
    if (!phoneNumber.trim() || !twilioSid.trim() || !twilioToken.trim()) { toast.error('Please fill in all Twilio fields'); return; }
    setImportingPhone(true);
    try {
      const data = await callEdgeFunction('import-phone', { phoneNumber: phoneNumber.trim(), twilioSid: twilioSid.trim(), twilioToken: twilioToken.trim() });
      setPhoneNumberId(data.phoneNumberId);
      toast.success('Phone number imported and assigned to agent');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to import phone number'); }
    finally { setImportingPhone(false); }
  };

  const handleSaveKnowledgeBase = async () => {
    if (!knowledgeText.trim()) { toast.error('Please enter knowledge base text'); return; }
    setSavingKb(true);
    try {
      const data = await callEdgeFunction('save-knowledge-base', { knowledgeText: knowledgeText.trim() });
      setKbDocId(data.kbDocId);
      toast.success('Knowledge base saved and attached to agent');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to save knowledge base'); }
    finally { setSavingKb(false); }
  };

  const groupedLlms = llmOptions.reduce<Record<string, LlmOption[]>>((acc, llm) => {
    const provider = llm.provider || 'Other';
    if (!acc[provider]) acc[provider] = [];
    acc[provider].push(llm);
    return acc;
  }, {});

  const selectedVoice = voiceOptions.find(v => v.voice_id === voiceId);

  if (loading) {
    return <RetroLoader />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-7xl">
        <div className="space-y-6">


          {/* Step 1: Agent Configuration */}
          {hasApiKey && (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1.5">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Brain className="h-5 w-5" />
                      Step 1: Agent Configuration
                    </CardTitle>
                    <CardDescription>
                      Configure your voice AI agent's behavior and personality
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {agentId ? (
                      <>
                        <StatusTag variant="positive">Agent Live</StatusTag>
                        <span className="cursor-pointer" title="Click to copy" onClick={() => { navigator.clipboard.writeText(agentId); toast.success('Agent ID copied'); }}><StatusTag variant="neutral">{agentId}</StatusTag></span>
                      </>
                    ) : (
                      <StatusTag variant="negative">Not Deployed</StatusTag>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Voice Selection */}
                <div className="space-y-2">
                  <Label>Voice</Label>
                  <div className="flex items-center gap-2">
                    {loadingVoices ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading voices...
                      </div>
                    ) : (
                      <>
                        <Select value={voiceId} onValueChange={setVoiceId}>
                          <SelectTrigger className="flex-1 h-8">
                            <SelectValue placeholder="Select a voice" />
                          </SelectTrigger>
                          <SelectContent>
                            {voiceOptions.map((v) => (
                              <SelectItem key={v.voice_id} value={v.voice_id}>
                                {v.name}
                                {v.labels?.accent ? ` (${v.labels.accent})` : ''}
                              </SelectItem>
                            ))}</SelectContent>
                        </Select>
                        {selectedVoice?.preview_url && (
                          <button
                            type="button"
                            className="h-8 w-8 shrink-0 flex items-center justify-center bg-foreground text-background"
                            onClick={() => selectedVoice && handlePlayPreview(selectedVoice)}
                            style={{ border: '2px groove hsl(var(--border-groove))' }}
                          >
                            {playingVoiceId === voiceId ? (
                              <span style={{ display: 'block', width: '10px', height: '10px', background: 'currentColor' }} />
                            ) : (
                              <span style={{ display: 'block', width: 0, height: 0, borderStyle: 'solid', borderWidth: '6px 0 6px 10px', borderColor: 'transparent transparent transparent currentColor' }} />
                            )}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* LLM Selection */}
                <div className="space-y-2">
                  <Label>LLM Model</Label>
                  {loadingLlms ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading models...
                    </div>
                  ) : (
                    <Select value={llmModel} onValueChange={setLlmModel}>
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(groupedLlms).map(([provider, models]) => (
                          <React.Fragment key={provider}>
                            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              {provider}
                            </div>
                            {models.map((m) => (
                              <SelectItem key={m.model_id} value={m.model_id}>
                                {m.display_name || m.model_id}
                              </SelectItem>
                            ))}
                          </React.Fragment>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>First Message</Label>
                  <Input
                    value={firstMessage}
                    onChange={(e) => setFirstMessage(e.target.value)}
                    placeholder="What the agent says first when the call connects"
                    className="h-8"
                  />
                </div>

                <div className="space-y-2">
                  <Label>System Prompt</Label>
                  <Textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="Instructions for the AI agent..."
                    className="min-h-[200px] font-mono text-sm"
                  />
                </div>

                <div className="flex items-center gap-3">
                  {!agentId ? (
                    <Button onClick={handleDeploy} disabled={deploying} className="gap-2 h-8">
                      {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                      Deploy Agent
                    </Button>
                  ) : (
                    <Button onClick={handleUpdate} disabled={saving} className="gap-2 h-8">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Update Agent
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Agent Tools - Auto-configured */}
          {agentId && (
            <AgentToolsCard
              callEdgeFunction={callEdgeFunction}
              agentId={agentId}
              toolIds={toolIds}
              onToolIdsChange={setToolIds}
            />
          )}

          {/* Step 3: Phone Number */}
          {agentId && (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1.5">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Phone className="h-5 w-5" />
                      Step 2: Import Your Twilio Phone Number
                    </CardTitle>
                    <CardDescription>
                      Import your Twilio number to be connected to your agent
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {phoneNumberId ? (
                      <>
                        <StatusTag variant="positive">Phone Connected</StatusTag>
                        <span className="cursor-pointer" title="Click to copy" onClick={() => { navigator.clipboard.writeText(phoneNumberId); toast.success('Phone ID copied'); }}><StatusTag variant="neutral">{phoneNumberId}</StatusTag></span>
                      </>
                    ) : (
                      <StatusTag variant="negative">Not Connected</StatusTag>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {phoneNumberId ? (
                  <div className="flex items-center gap-3">
                    <Button
                      size="sm"
                      className="h-8 gap-2 bg-destructive text-white border-border hover:bg-destructive/80"
                      onClick={async () => {
                        try {
                          await callEdgeFunction('remove-phone');
                          setPhoneNumberId(null);
                          toast.success('Phone number removed');
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Failed');
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" /> Delete Number
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Phone Number</Label>
                      <Input
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="+1234567890"
                        className="h-8"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Twilio Account SID</Label>
                        <Input
                          value={twilioSid}
                          onChange={(e) => setTwilioSid(e.target.value)}
                          placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Twilio Auth Token</Label>
                        <Input
                          type="password"
                          value={twilioToken}
                          onChange={(e) => setTwilioToken(e.target.value)}
                          placeholder="Your Twilio Auth Token"
                          className="h-8"
                        />
                      </div>
                    </div>
                    <Button onClick={handleImportPhone} disabled={importingPhone} className="gap-2 h-8">
                      {importingPhone ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                      Import Phone Number
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step 4: Knowledge Base */}
          {agentId && (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1.5">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <BookOpen className="h-5 w-5" />
                      Step 3: Knowledge Base
                    </CardTitle>
                    <CardDescription>
                      Input information into your knowledge base that the agent will use
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {kbDocId ? (
                      <>
                        <StatusTag variant="positive">KB Active</StatusTag>
                        <span className="cursor-pointer" title="Click to copy" onClick={() => { navigator.clipboard.writeText(kbDocId); toast.success('KB Doc ID copied'); }}><StatusTag variant="neutral">{kbDocId}</StatusTag></span>
                      </>
                    ) : (
                      <StatusTag variant="negative">Not Configured</StatusTag>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Knowledge Base Text</Label>
                  <Textarea
                    value={knowledgeText}
                    onChange={(e) => setKnowledgeText(e.target.value)}
                    placeholder="Enter all the knowledge your agent should know about your business, products, services, FAQs, etc."
                    className="min-h-[200px] font-mono text-sm"
                  />
                </div>
                <Button onClick={handleSaveKnowledgeBase} disabled={savingKb} className="gap-2 h-8">
                  {savingKb ? <Loader2 className="h-4 w-4 animate-spin" /> : kbDocId ? <RefreshCw className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
                  {kbDocId ? 'Update Knowledge Base' : 'Save Knowledge Base'}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Delete Setter - full width at bottom */}
          {agentId && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  className="w-full gap-2 h-8 bg-destructive text-white border-border hover:bg-destructive/80"
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete Setter
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Agent & All Resources?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the agent, phone number, and knowledge base
                    from your ElevenLabs account. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Delete Setter
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

        </div>
      </div>
    </div>
  );
};

export default VoiceAISetter;
