import React, { useState, useEffect, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Plus, Trash2, RefreshCw, Settings, Loader2, Bot, ChevronDown, ChevronUp, BookOpen } from 'lucide-react';
import { useRetellApi, RetellAgent, RetellLlm, RetellVoice, RetellKnowledgeBase } from '@/hooks/useRetellApi';
import { useClientCredentials } from '@/hooks/useClientCredentials';

const RETELL_MODELS = [
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
  'gpt-4o', 'gpt-4o-mini',
  'claude-3.5-sonnet', 'claude-3-haiku',
  'claude-sonnet-4-20250514',
  'deepseek-chat',
];

interface RetellAgentsTabProps {
  clientId: string;
}

const RetellAgentsTab: React.FC<RetellAgentsTabProps> = ({ clientId }) => {
  const retell = useRetellApi(clientId);
  const { credentials, updateMultipleCredentials } = useClientCredentials(clientId);

  const [agents, setAgents] = useState<RetellAgent[]>([]);
  const [llms, setLlms] = useState<RetellLlm[]>([]);
  const [voices, setVoices] = useState<RetellVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [knowledgeBases, setKnowledgeBases] = useState<RetellKnowledgeBase[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [editingAgent, setEditingAgent] = useState<Record<string, unknown> | null>(null);
  const [savingAgent, setSavingAgent] = useState(false);
  // Tracks which agent's "View all N versions" history table is open. Separate
  // from `expandedAgent` (the edit form).
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);

  // Retell's /list-agents returns ONE ROW PER VERSION (publishing creates a new
  // version each time). For BFD that's 8+ rows for a single agent_id — cluttered
  // and confusing. Dedupe to one entry per agent_id, keeping the latest version
  // as canonical and all versions in `versions` for the history dropdown.
  const groupedAgents = useMemo(() => {
    const groups = new Map<string, { latest: RetellAgent; versions: RetellAgent[] }>();
    for (const a of agents) {
      if (!a?.agent_id) continue;
      const existing = groups.get(a.agent_id);
      if (!existing) {
        groups.set(a.agent_id, { latest: a, versions: [a] });
      } else {
        existing.versions.push(a);
        // Keep the row with the highest version number as the canonical "latest".
        const currentVer = typeof a.version === 'number' ? a.version : -1;
        const latestVer = typeof existing.latest.version === 'number' ? existing.latest.version : -1;
        if (currentVer > latestVer) existing.latest = a;
      }
    }
    // Sort versions per group descending by version number.
    const result = Array.from(groups.values());
    for (const g of result) {
      g.versions.sort((a, b) => {
        const av = typeof a.version === 'number' ? a.version : -1;
        const bv = typeof b.version === 'number' ? b.version : -1;
        return bv - av;
      });
    }
    return result;
  }, [agents]);

  // Format a Retell `last_modification_timestamp` (ms epoch number) as a
  // human-readable relative string. Falls back to '—' for missing/invalid values.
  const formatRelative = (ts: unknown): string => {
    if (typeof ts !== 'number' || !Number.isFinite(ts)) return '—';
    try {
      return formatDistanceToNow(new Date(ts), { addSuffix: true });
    } catch {
      return '—';
    }
  };

  // Create agent form
  const [creating, setCreating] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newVoiceId, setNewVoiceId] = useState('');
  const [newModel, setNewModel] = useState('gpt-4.1');
  const [newPrompt, setNewPrompt] = useState('You are a helpful AI voice assistant.');
  const [newBeginMessage, setNewBeginMessage] = useState('Hi there! How can I help you today?');
  const [newKbIds, setNewKbIds] = useState<string[]>([]);

  const [showCreateForm, setShowCreateForm] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [agentsData, voicesData, kbData] = await Promise.all([
        retell.listAgents(),
        retell.listVoices(),
        retell.listKnowledgeBases(),
      ]);
      setAgents(Array.isArray(agentsData) ? agentsData : []);
      setVoices(Array.isArray(voicesData) ? voicesData : []);
      setKnowledgeBases(Array.isArray(kbData) ? kbData : []);
      if (Array.isArray(voicesData) && voicesData.length > 0 && !newVoiceId) {
        setNewVoiceId(voicesData[0].voice_id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []); // eslint-disable-line

  const handleCreate = async () => {
    if (!newAgentName.trim()) { toast.error('Agent name is required'); return; }
    setCreating(true);
    try {
      // Step 1: Create an LLM
      const llm = await retell.createLlm({
        model: newModel,
        general_prompt: newPrompt,
        begin_message: newBeginMessage,
        general_tools: [{ type: 'end_call', name: 'end_call' }],
        // knowledge_base_ids removed
      });

      // Step 2: Create agent with the LLM
      const agent = await retell.createAgent({
        agent_name: newAgentName.trim(),
        voice_id: newVoiceId,
        response_engine: { type: 'retell-llm', llm_id: llm.llm_id },
        language: 'en-US',
      });

      toast.success(`Agent "${agent.agent_name}" created`);
      setShowCreateForm(false);
      setNewAgentName('');
      setNewPrompt('You are a helpful AI voice assistant.');
      setNewBeginMessage('Hi there! How can I help you today?');
      setNewKbIds([]);
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (agentId: string) => {
    setDeletingId(agentId);
    try {
      // Also try to delete the LLM if the agent has one
      const agent = agents.find(a => a.agent_id === agentId);
      await retell.deleteAgent(agentId);
      if (agent?.response_engine?.llm_id) {
        try { await retell.deleteLlm(agent.response_engine.llm_id); } catch { /* ignore */ }
      }

      // Clear from client credentials if assigned
      const updates: Record<string, string | null> = {};
      if (credentials?.retell_inbound_agent_id === agentId) updates.retell_inbound_agent_id = null;
      if (credentials?.retell_outbound_agent_id === agentId) updates.retell_outbound_agent_id = null;
      if (credentials?.retell_outbound_followup_agent_id === agentId) updates.retell_outbound_followup_agent_id = null;
      if (credentials?.retell_agent_id_4 === agentId) updates.retell_agent_id_4 = null;
      if (Object.keys(updates).length > 0) {
        await updateMultipleCredentials({ updates });
      }

      toast.success('Agent deleted');
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete agent');
    } finally {
      setDeletingId(null);
    }
  };

  const handleAssignAgent = async (agentId: string, slot: string) => {
    try {
      await updateMultipleCredentials({ updates: { [slot]: agentId } });
      toast.success('Agent assigned to slot');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign');
    }
  };

  const handleExpandAgent = async (agentId: string) => {
    if (expandedAgent === agentId) {
      setExpandedAgent(null);
      setEditingAgent(null);
      return;
    }
    setExpandedAgent(agentId);
    try {
      const agent = await retell.getAgent(agentId);
      let llmData: RetellLlm | null = null;
      if (agent.response_engine?.llm_id) {
        try { llmData = await retell.getLlm(agent.response_engine.llm_id); } catch { /* no llm */ }
      }
      setEditingAgent({
        ...agent,
        _llm: llmData,
        _voice_speed: agent.voice_speed ?? 1,
        _voice_temperature: agent.voice_temperature ?? 1,
        _volume: agent.volume ?? 1,
        _responsiveness: agent.responsiveness ?? 1,
        _interruption_sensitivity: agent.interruption_sensitivity ?? 1,
        _enable_backchannel: agent.enable_backchannel ?? true,
        _ambient_sound: agent.ambient_sound ?? null,
        _webhook_url: agent.webhook_url ?? '',
        _general_prompt: llmData?.general_prompt ?? '',
        _begin_message: llmData?.begin_message ?? '',
        _model: llmData?.model ?? 'gpt-4.1',
        _knowledge_base_ids: llmData?.knowledge_base_ids ?? [],
        _language: agent.language ?? 'en-US',
        _normalize_for_speech: agent.normalize_for_speech ?? true,
        _end_call_after_silence_ms: agent.end_call_after_silence_ms ?? 30000,
        _max_call_duration_ms: agent.max_call_duration_ms ?? 3600000,
      });
    } catch (err) {
      toast.error('Failed to load agent details');
    }
  };

  const handleSaveAgent = async () => {
    if (!editingAgent || !expandedAgent) return;
    setSavingAgent(true);
    try {
      // Update agent settings
      await retell.updateAgent(expandedAgent, {
        agent_name: editingAgent.agent_name,
        voice_id: editingAgent.voice_id,
        voice_speed: editingAgent._voice_speed,
        voice_temperature: editingAgent._voice_temperature,
        volume: editingAgent._volume,
        responsiveness: editingAgent._responsiveness,
        interruption_sensitivity: editingAgent._interruption_sensitivity,
        enable_backchannel: editingAgent._enable_backchannel,
        ambient_sound: editingAgent._ambient_sound || null,
        webhook_url: (editingAgent._webhook_url as string)?.trim() || null,
        language: editingAgent._language,
        normalize_for_speech: editingAgent._normalize_for_speech,
        end_call_after_silence_ms: editingAgent._end_call_after_silence_ms,
        max_call_duration_ms: editingAgent._max_call_duration_ms,
      });

      // Update LLM if exists
      const llm = editingAgent._llm as RetellLlm | null;
      if (llm?.llm_id) {
        await retell.updateLlm(llm.llm_id, {
          general_prompt: editingAgent._general_prompt,
          begin_message: editingAgent._begin_message,
          model: editingAgent._model,
          // knowledge_base_ids removed
        });
      }

      toast.success('Agent updated');
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update agent');
    } finally {
      setSavingAgent(false);
    }
  };

  const getSlotLabel = (agentId: string) => {
    const slots: string[] = [];
    if (credentials?.retell_inbound_agent_id === agentId) slots.push('Inbound');
    if (credentials?.retell_outbound_agent_id === agentId) slots.push('Outbound');
    if (credentials?.retell_outbound_followup_agent_id === agentId) slots.push('Followup');
    if (credentials?.retell_agent_id_4 === agentId) slots.push('Agent 4');
    return slots;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">Voice Agents</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{agents.length} agent{agents.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchAll}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreateForm(!showCreateForm)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Agent
          </Button>
        </div>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Create Voice Agent</CardTitle>
            <CardDescription className="text-xs">Creates a new Retell LLM + Agent</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Agent Name</Label>
                <Input
                  value={newAgentName}
                  onChange={e => setNewAgentName(e.target.value)}
                  placeholder="My Voice Agent"
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Voice</Label>
                <Select value={newVoiceId} onValueChange={setNewVoiceId}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select voice" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {voices.map(v => (
                      <SelectItem key={v.voice_id} value={v.voice_id}>
                        {v.voice_name} ({v.provider})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">LLM Model</Label>
              <Select value={newModel} onValueChange={setNewModel}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RETELL_MODELS.map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {false && knowledgeBases.length > 0 && (
              <div>
                <Label className="text-xs">Knowledge Base</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {knowledgeBases.map(kb => {
                    const isSelected = newKbIds.includes(kb.knowledge_base_id);
                    return (
                      <Badge
                        key={kb.knowledge_base_id}
                        variant={isSelected ? 'default' : 'outline'}
                        className="cursor-pointer text-[10px]"
                        onClick={() => setNewKbIds(prev =>
                          isSelected ? prev.filter(id => id !== kb.knowledge_base_id)
                            : [...prev, kb.knowledge_base_id]
                        )}
                      >
                        <BookOpen className="h-2.5 w-2.5 mr-1" />
                        {kb.knowledge_base_name}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
            <div>
              <Label className="text-xs">System Prompt</Label>
              <Textarea
                value={newPrompt}
                onChange={e => setNewPrompt(e.target.value)}
                className="text-sm min-h-[80px]"
                placeholder="You are..."
              />
            </div>
            <div>
              <Label className="text-xs">Begin Message</Label>
              <Input
                value={newBeginMessage}
                onChange={e => setNewBeginMessage(e.target.value)}
                className="h-8 text-sm"
                placeholder="Hi there!"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreateForm(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreate} disabled={creating}>
                {creating && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Create Agent
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agents List */}
      {agents.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <Bot className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No agents yet. Create your first one above.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {groupedAgents.map(group => {
            const agent = group.latest;
            const slots = getSlotLabel(agent.agent_id);
            const isExpanded = expandedAgent === agent.agent_id;
            const historyOpen = expandedHistory === agent.agent_id;
            const versionCount = group.versions.length;

            return (
              <Card key={agent.agent_id} className="overflow-hidden">
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => handleExpandAgent(agent.agent_id)}
                >
                  <Bot className="h-5 w-5 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">
                        {agent.agent_name || 'Unnamed Agent'}
                      </span>
                      {slots.map(s => (
                        <Badge key={s} variant="secondary" className="text-[10px] py-0 px-1.5">
                          {s}
                        </Badge>
                      ))}
                      <span className="text-[10px] text-muted-foreground font-mono">
                        v{agent.version ?? '?'} · {formatRelative((agent as any).last_modification_timestamp)}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">
                      {agent.agent_id}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant={agent.is_published ? 'default' : 'outline'} className="text-[10px]">
                      {agent.is_published ? 'Published' : 'Draft'}
                    </Badge>
                    {versionCount > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedHistory(historyOpen ? null : agent.agent_id);
                        }}
                        className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                        title="Toggle version history"
                      >
                        {versionCount} versions {historyOpen ? '▲' : '▼'}
                      </button>
                    )}
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>

                {/* Version history dropdown — visible only when expandedHistory matches.
                    Shows ALL versions of this agent_id sorted descending. */}
                {historyOpen && (
                  <div className="border-t bg-muted/5 px-4 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                      Version history ({versionCount} {versionCount === 1 ? 'version' : 'versions'})
                    </p>
                    <div className="space-y-1">
                      {group.versions.map(v => (
                        <div
                          key={`${v.agent_id}-${v.version}`}
                          className="flex items-center gap-3 text-[11px] py-1 px-2 rounded hover:bg-muted/30"
                        >
                          <span className="font-mono text-muted-foreground w-10">v{v.version ?? '?'}</span>
                          <span className="flex-1 truncate font-mono">{v.agent_name || '(no name)'}</span>
                          <span className="text-muted-foreground truncate" style={{ maxWidth: 200 }}>
                            {(v.voice_id as string)?.slice(0, 32) || '—'}
                          </span>
                          <Badge variant={v.is_published ? 'default' : 'outline'} className="text-[9px] py-0 px-1.5">
                            {v.is_published ? 'Published' : 'Draft'}
                          </Badge>
                          <span className="text-muted-foreground" style={{ minWidth: 100 }}>
                            {formatRelative((v as any).last_modification_timestamp)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expanded Edit Form (separate from version history above) */}
                {isExpanded && editingAgent && (
                  <div className="border-t px-4 py-4 space-y-4 bg-muted/10">
                    {/* Agent Settings */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Agent Name</Label>
                        <Input
                          value={(editingAgent.agent_name as string) || ''}
                          onChange={e => setEditingAgent({ ...editingAgent, agent_name: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Voice</Label>
                        <Select
                          value={(editingAgent.voice_id as string) || ''}
                          onValueChange={v => setEditingAgent({ ...editingAgent, voice_id: v })}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="max-h-[200px]">
                            {voices.map(v => (
                              <SelectItem key={v.voice_id} value={v.voice_id}>
                                {v.voice_name} ({v.provider})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <Separator />

                    {/* LLM Settings */}
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">LLM Configuration</h4>
                      <div className="space-y-3">
                        <div>
                          <Label className="text-xs">Model</Label>
                          <Select
                            value={(editingAgent._model as string) || 'gpt-4.1'}
                            onValueChange={v => setEditingAgent({ ...editingAgent, _model: v })}
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {RETELL_MODELS.map(m => (
                                <SelectItem key={m} value={m}>{m}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">System Prompt</Label>
                          <Textarea
                            value={(editingAgent._general_prompt as string) || ''}
                            onChange={e => setEditingAgent({ ...editingAgent, _general_prompt: e.target.value })}
                            className="text-sm min-h-[100px]"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Begin Message</Label>
                          <Input
                            value={(editingAgent._begin_message as string) || ''}
                            onChange={e => setEditingAgent({ ...editingAgent, _begin_message: e.target.value })}
                            className="h-8 text-sm"
                          />
                        </div>
                        {false && knowledgeBases.length > 0 && (
                          <div>
                            <Label className="text-xs">Knowledge Bases</Label>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {knowledgeBases.map(kb => {
                                const kbIds = (editingAgent._knowledge_base_ids as string[]) || [];
                                const isSelected = kbIds.includes(kb.knowledge_base_id);
                                return (
                                  <Badge
                                    key={kb.knowledge_base_id}
                                    variant={isSelected ? 'default' : 'outline'}
                                    className="cursor-pointer text-[10px]"
                                    onClick={() => setEditingAgent({
                                      ...editingAgent,
                                      _knowledge_base_ids: isSelected
                                        ? kbIds.filter(id => id !== kb.knowledge_base_id)
                                        : [...kbIds, kb.knowledge_base_id],
                                    })}
                                  >
                                    <BookOpen className="h-2.5 w-2.5 mr-1" />
                                    {kb.knowledge_base_name}
                                  </Badge>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <Separator />

                    {/* Voice Settings */}
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Voice Settings</h4>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: 'Speed', key: '_voice_speed' },
                          { label: 'Temperature', key: '_voice_temperature' },
                          { label: 'Volume', key: '_volume' },
                          { label: 'Responsiveness', key: '_responsiveness' },
                          { label: 'Interruption Sensitivity', key: '_interruption_sensitivity' },
                        ].map(({ label, key }) => (
                          <div key={key}>
                            <Label className="text-xs">{label}</Label>
                            <Input
                              type="number"
                              step="0.1"
                              min="0"
                              max="2"
                              value={(editingAgent[key] as number) ?? 1}
                              onChange={e => setEditingAgent({ ...editingAgent, [key]: parseFloat(e.target.value) || 0 })}
                              className="h-8 text-sm"
                            />
                          </div>
                        ))}
                        <div>
                          <Label className="text-xs">Ambient Sound</Label>
                          <Select
                            value={(editingAgent._ambient_sound as string) || 'none'}
                            onValueChange={v => setEditingAgent({ ...editingAgent, _ambient_sound: v === 'none' ? null : v })}
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {['none', 'coffee-shop', 'convention-hall', 'summer-outdoor', 'mountain-outdoor', 'static-noise', 'call-center'].map(s => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    <Separator />

                    {/* Call Settings */}
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Call Settings</h4>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs">Language</Label>
                          <Select
                            value={(editingAgent._language as string) || 'en-US'}
                            onValueChange={v => setEditingAgent({ ...editingAgent, _language: v })}
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {['en-US', 'en-GB', 'en-AU', 'es-ES', 'es-419', 'fr-FR', 'de-DE', 'pt-BR', 'it-IT', 'nl-NL', 'hi-IN', 'ja-JP', 'ko-KR', 'zh-CN', 'ar-SA', 'multi'].map(l => (
                                <SelectItem key={l} value={l}>{l}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Max Call Duration (ms)</Label>
                          <Input
                            type="number"
                            value={(editingAgent._max_call_duration_ms as number) ?? 3600000}
                            onChange={e => setEditingAgent({ ...editingAgent, _max_call_duration_ms: parseInt(e.target.value) || 3600000 })}
                            className="h-8 text-sm"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">End After Silence (ms)</Label>
                          <Input
                            type="number"
                            value={(editingAgent._end_call_after_silence_ms as number) ?? 30000}
                            onChange={e => setEditingAgent({ ...editingAgent, _end_call_after_silence_ms: parseInt(e.target.value) || 30000 })}
                            className="h-8 text-sm"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-3">
                        <Switch
                          checked={(editingAgent._normalize_for_speech as boolean) ?? true}
                          onCheckedChange={v => setEditingAgent({ ...editingAgent, _normalize_for_speech: v })}
                        />
                        <Label className="text-xs">Normalize for Speech</Label>
                      </div>
                    </div>

                    <Separator />
                    <div>
                      <Label className="text-xs">Webhook URL</Label>
                      <Input
                        value={`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/retell-call-analysis-webhook`}
                        readOnly
                        disabled
                        className="h-8 text-sm bg-muted text-muted-foreground cursor-not-allowed"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Auto-configured — call data syncs automatically</p>
                    </div>

                    {/* Assign to Slot */}
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Assign to Slot</h4>
                      <div className="flex gap-2 flex-wrap">
                        {[
                          { key: 'retell_inbound_agent_id', label: 'Inbound' },
                          { key: 'retell_outbound_agent_id', label: 'Outbound' },
                          { key: 'retell_outbound_followup_agent_id', label: 'Followup' },
                          { key: 'retell_agent_id_4', label: 'Agent 4' },
                          { key: 'retell_agent_id_5', label: 'Agent 5' },
                          { key: 'retell_agent_id_6', label: 'Agent 6' },
                          { key: 'retell_agent_id_7', label: 'Agent 7' },
                          { key: 'retell_agent_id_8', label: 'Agent 8' },
                          { key: 'retell_agent_id_9', label: 'Agent 9' },
                          { key: 'retell_agent_id_10', label: 'Agent 10' },
                        ].map(({ key, label }) => {
                          const isAssigned = credentials?.[key as keyof typeof credentials] === agent.agent_id;
                          return (
                            <Button
                              key={key}
                              size="sm"
                              variant={isAssigned ? 'default' : 'outline'}
                              className="text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAssignAgent(agent.agent_id, key);
                              }}
                            >
                              {label} {isAssigned && '✓'}
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-between pt-2">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm" disabled={deletingId === agent.agent_id}>
                            {deletingId === agent.agent_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Agent</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete "{agent.agent_name}" and its LLM from Retell. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(agent.agent_id)}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>

                      <Button size="sm" onClick={handleSaveAgent} disabled={savingAgent}>
                        {savingAgent && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                        Save Changes
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RetellAgentsTab;
