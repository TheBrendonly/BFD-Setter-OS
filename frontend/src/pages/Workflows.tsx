import { useState, useEffect } from 'react';
import { useCreatorMode } from '@/hooks/useCreatorMode';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { getCached, setCache } from '@/lib/queryCache';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusTag } from '@/components/StatusTag';
import { toast } from 'sonner';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { Pencil, Trash2, Plus, GripVertical, Save } from '@/components/icons';
import { Switch } from '@/components/ui/switch';
import type { Workflow } from '@/types/workflow';
import RetroLoader from '@/components/RetroLoader';
import { insertDefaultCampaignWidgets } from '@/lib/campaignWidgets';
import { nanoid } from 'nanoid';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface EngagementWorkflow {
  id: string;
  name: string;
  is_active: boolean;
  nodes: any[];
  sort_order?: number;
  is_new_leads_campaign?: boolean;
  new_leads_tag?: string | null;
  client_id?: string;
}

function SortableCampaignRow({
  ew,
  clientId,
  navigate,
  onEdit,
  onDelete,
  onNewLeadsToggle,
  onNewLeadsTagChange,
}: {
  ew: EngagementWorkflow;
  clientId: string;
  navigate: (path: string) => void;
  onEdit: (ew: EngagementWorkflow) => void;
  onDelete: (id: string, name: string, e: React.MouseEvent) => void;
  onNewLeadsToggle: (ew: EngagementWorkflow, on: boolean) => void;
  onNewLeadsTagChange: (ew: EngagementWorkflow, tag: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ew.id });
  const { cb } = useCreatorMode();
  const [tagDraft, setTagDraft] = useState<string>(ew.new_leads_tag ?? '');
  useEffect(() => { setTagDraft(ew.new_leads_tag ?? ''); }, [ew.new_leads_tag]);
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 10 : undefined,
  };

  const commitTag = () => {
    const trimmed = tagDraft.trim();
    if (!trimmed) {
      toast.error('Tag name cannot be empty');
      setTagDraft(ew.new_leads_tag ?? '');
      return;
    }
    if (trimmed === (ew.new_leads_tag ?? '')) return;
    onNewLeadsTagChange(ew, trimmed);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="groove-border bg-card flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
      onClick={() => navigate(`/client/${clientId}/workflows/engagement?wf=${ew.id}`)}
    >
      <div
        className="shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground transition-colors"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-4 w-4" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-foreground font-medium field-text truncate">{ew.name}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <StatusTag variant={ew.is_active ? 'positive' : 'neutral'}>
          {ew.is_active ? 'ACTIVE' : 'INACTIVE'}
        </StatusTag>
        <StatusTag variant="warning">CAMPAIGN</StatusTag>
        <div
          className="flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-muted-foreground field-text uppercase" style={{ fontSize: 11 }}>NEW LEADS</span>
          <Switch
            checked={!!ew.is_new_leads_campaign}
            onCheckedChange={(on) => onNewLeadsToggle(ew, on)}
          />
          {ew.is_new_leads_campaign && (
            <Input
              autoFocus
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onBlur={commitTag}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.currentTarget.blur(); }
                if (e.key === 'Escape') { setTagDraft(ew.new_leads_tag ?? ''); e.currentTarget.blur(); }
              }}
              placeholder="tag name (e.g. new-lead)"
              className="field-text h-8 w-44"
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50"
          onClick={(e) => { e.stopPropagation(); onEdit(ew); }}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center"
          onClick={(e) => onDelete(ew.id, ew.name, e)}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

type WorkflowTab = 'campaigns' | 'workflows';
function CampaignsDndList({
  engagementWorkflows,
  setEngagementWorkflows,
  clientId,
  navigate,
  onEdit,
  onDelete,
  onNewLeadsToggle,
  onNewLeadsTagChange,
}: {
  engagementWorkflows: EngagementWorkflow[];
  setEngagementWorkflows: React.Dispatch<React.SetStateAction<EngagementWorkflow[]>>;
  clientId: string;
  navigate: (path: string) => void;
  onEdit: (ew: EngagementWorkflow) => void;
  onDelete: (id: string, name: string, e: React.MouseEvent) => void;
  onNewLeadsToggle: (ew: EngagementWorkflow, on: boolean) => void;
  onNewLeadsTagChange: (ew: EngagementWorkflow, tag: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = engagementWorkflows.findIndex(w => w.id === active.id);
    const newIndex = engagementWorkflows.findIndex(w => w.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...engagementWorkflows];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    setEngagementWorkflows(reordered);

    // Persist sort_order
    const updates = reordered.map((w, i) => (supabase as any)
      .from('engagement_workflows')
      .update({ sort_order: i })
      .eq('id', w.id)
    );
    await Promise.all(updates);
  };

  if (engagementWorkflows.length === 0) {
    return <div className="text-center py-12 text-muted-foreground field-text">No campaigns yet. Click NEW CAMPAIGN to create one.</div>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={engagementWorkflows.map(w => w.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-4">
          {engagementWorkflows.map(ew => (
            <SortableCampaignRow
              key={ew.id}
              ew={ew}
              clientId={clientId}
              navigate={navigate}
              onEdit={onEdit}
              onDelete={onDelete}
              onNewLeadsToggle={onNewLeadsToggle}
              onNewLeadsTagChange={onNewLeadsTagChange}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export default function Workflows() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [engagementWorkflows, setEngagementWorkflows] = useState<EngagementWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState<{ id: string; name: string; type: 'custom' | 'campaign' } | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [tab, setTab] = useState<WorkflowTab>(() => {
    const saved = localStorage.getItem(`workflows-tab-${clientId}`);
    if (saved === 'campaigns' || saved === 'workflows') return saved;
    return 'campaigns';
  });
  const handleSetTab = (t: WorkflowTab) => { localStorage.setItem(`workflows-tab-${clientId}`, t); setTab(t); };

  usePageHeader({
    title: 'Workflows',
    breadcrumbs: [{ label: 'All Campaigns & Workflows' }],
    actions: [
      {
        label: tab === 'campaigns' ? 'NEW CAMPAIGN' : 'NEW WORKFLOW',
        icon: <Plus className="w-4 h-4" />,
        onClick: tab === 'campaigns' ? handleCreateCampaign : handleCreateCustom,
        variant: 'default' as const,
      },
    ],
  }, [tab]);

  useEffect(() => {
    fetchAll();
  }, [clientId]);

  async function fetchAll() {
    if (!clientId) return;
    const cacheKey = `workflows_${clientId}`;
    const cached = getCached<{ wf: Workflow[]; ew: EngagementWorkflow[] }>(cacheKey);
    if (cached) {
      setWorkflows(cached.wf);
      setEngagementWorkflows(cached.ew);
      setLoading(false);
    }
    const [wfRes, ewRes] = await Promise.all([
      (supabase as any)
        .from('workflows')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false }),
      (supabase as any)
        .from('engagement_workflows')
        .select('id, name, is_active, nodes, sort_order, is_new_leads_campaign, new_leads_tag, client_id')
        .eq('client_id', clientId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false }),
    ]);
    const wf = (wfRes.data as Workflow[]) || [];
    const ew = (ewRes.data as EngagementWorkflow[]) || [];
    setWorkflows(wf);
    setEngagementWorkflows(ew);
    setCache(cacheKey, { wf, ew });
    setLoading(false);
  }

  async function handleCreateCustom() {
    if (!clientId) return;
    const { data, error } = await (supabase as any)
      .from('workflows')
      .insert({
        client_id: clientId,
        name: 'Untitled Workflow',
        nodes: [],
        edges: [],
      })
      .select()
      .single();
    if (error) {
      toast.error('Failed to create workflow');
      return;
    }
    navigate(`/client/${clientId}/workflows/${data.id}`);
  }

  async function handleCreateCampaign() {
    if (!clientId) return;

    // Default template nodes: delay → engage #1 → wait_for_reply → engage #2
    const templateNodes = [
      { id: nanoid(8), type: 'delay', delay_seconds: 300 },
      {
        id: nanoid(8),
        type: 'engage',
        channels: [
          { type: 'sms', enabled: true, message: '', delay_seconds: 0 },
          { type: 'whatsapp', enabled: false, message: '', delay_seconds: 0 },
          { type: 'phone_call', enabled: false, instructions: '', delay_seconds: 0 },
        ],
      },
      { id: nanoid(8), type: 'wait_for_reply', timeout_seconds: 86400 },
      {
        id: nanoid(8),
        type: 'engage',
        channels: [
          { type: 'sms', enabled: true, message: '', delay_seconds: 0 },
          { type: 'whatsapp', enabled: false, message: '', delay_seconds: 0 },
          { type: 'phone_call', enabled: false, instructions: '', delay_seconds: 0 },
        ],
      },
    ];

    const { data, error } = await (supabase as any)
      .from('engagement_workflows')
      .insert({
        client_id: clientId,
        name: 'Untitled Campaign',
        nodes: templateNodes,
        is_active: false,
      })
      .select()
      .single();
    if (error) {
      toast.error('Failed to create campaign workflow');
      return;
    }
    // Auto-create linked engagement_campaigns row
    await (supabase as any)
      .from('engagement_campaigns')
      .insert({
        client_id: clientId,
        workflow_id: data.id,
        name: 'Untitled Campaign',
      });
    // Auto-create default campaign widgets
    const { insertDefaultCampaignWidgets } = await import('@/lib/campaignWidgets');
    const { data: camp } = await (supabase as any)
      .from('engagement_campaigns')
      .select('id')
      .eq('workflow_id', data.id)
      .single();
    if (camp) await insertDefaultCampaignWidgets(clientId, camp.id);

    navigate(`/client/${clientId}/workflows/engagement?wf=${data.id}`);
  }

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; type: 'custom' | 'campaign' } | null>(null);

  function handleDeleteClick(id: string, name: string, type: 'custom' | 'campaign', e: React.MouseEvent) {
    e.stopPropagation();
    setDeleteTarget({ id, name, type });
  }

  // Phase-11c: at-most-one new-leads campaign per client.
  // Optimistic flip + server-side updates. Partial unique index enforces invariance.
  async function handleNewLeadsToggle(ew: EngagementWorkflow, on: boolean) {
    if (!clientId) return;
    const newTag = on ? (ew.new_leads_tag?.trim() || 'new-lead') : null;
    const previousState = engagementWorkflows;

    // Optimistic local state: when turning ON, also flip any other ON row in this client OFF.
    setEngagementWorkflows(prev => prev.map(w => {
      if (w.id === ew.id) return { ...w, is_new_leads_campaign: on, new_leads_tag: newTag };
      if (on && w.client_id === ew.client_id && w.is_new_leads_campaign) {
        return { ...w, is_new_leads_campaign: false, new_leads_tag: null };
      }
      return w;
    }));

    try {
      if (on) {
        const { error: clearErr } = await (supabase as any)
          .from('engagement_workflows')
          .update({ is_new_leads_campaign: false, new_leads_tag: null })
          .eq('client_id', clientId)
          .neq('id', ew.id)
          .eq('is_new_leads_campaign', true);
        if (clearErr) throw clearErr;
      }
      const { error: setErr } = await (supabase as any)
        .from('engagement_workflows')
        .update({ is_new_leads_campaign: on, new_leads_tag: newTag })
        .eq('id', ew.id);
      if (setErr) throw setErr;
      // Keep clients.auto_engagement_workflow_id in sync for the legacy intake-lead path.
      const { error: clientErr } = await (supabase as any)
        .from('clients')
        .update({ auto_engagement_workflow_id: on ? ew.id : null })
        .eq('id', clientId);
      if (clientErr) {
        console.warn('Failed to sync clients.auto_engagement_workflow_id', clientErr);
      }
      toast.success(on
        ? `'${ew.name}' is now the auto-enrol campaign for tag '${newTag}'`
        : `'${ew.name}' is no longer the auto-enrol campaign`);
    } catch (err: any) {
      console.error('handleNewLeadsToggle failed', err);
      toast.error(err?.message || 'Failed to update auto-enrol campaign');
      setEngagementWorkflows(previousState);
    }
  }

  async function handleNewLeadsTagChange(ew: EngagementWorkflow, tag: string) {
    const previousState = engagementWorkflows;
    setEngagementWorkflows(prev => prev.map(w => w.id === ew.id ? { ...w, new_leads_tag: tag } : w));
    const { error } = await (supabase as any)
      .from('engagement_workflows')
      .update({ new_leads_tag: tag })
      .eq('id', ew.id);
    if (error) {
      toast.error('Failed to update tag');
      setEngagementWorkflows(previousState);
      return;
    }
    toast.success(`Tag updated to '${tag}'`);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const table = deleteTarget.type === 'campaign' ? 'engagement_workflows' : 'workflows';
    const { error } = await (supabase as any).from(table).delete().eq('id', deleteTarget.id);
    if (error) {
      toast.error('Failed to delete workflow');
      return;
    }
    if (deleteTarget.type === 'campaign') {
      setEngagementWorkflows(prev => prev.filter(w => w.id !== deleteTarget.id));
    } else {
      setWorkflows(prev => prev.filter(w => w.id !== deleteTarget.id));
    }
    toast.success('Workflow deleted');
    setDeleteTarget(null);
  }

  async function handleSaveName() {
    if (!editingName) return;
    const table = editingName.type === 'campaign' ? 'engagement_workflows' : 'workflows';
    const { error } = await (supabase as any)
      .from(table)
      .update({ name: editingName.name, updated_at: new Date().toISOString() })
      .eq('id', editingName.id);
    if (error) {
      toast.error('Failed to update name');
      return;
    }
    if (editingName.type === 'campaign') {
      setEngagementWorkflows(prev => prev.map(w => w.id === editingName.id ? { ...w, name: editingName.name } : w));
      // Sync linked campaign name
      await (supabase as any)
        .from('engagement_campaigns')
        .update({ name: editingName.name })
        .eq('workflow_id', editingName.id);
    } else {
      setWorkflows(prev => prev.map(w => w.id === editingName.id ? { ...w, name: editingName.name } : w));
    }
    setEditingName(null);
    toast.success('Workflow name updated');
  }

  if (loading) {
    return <RetroLoader />;
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-background" style={{ scrollbarGutter: 'stable' as const }}>
      <div className="container mx-auto max-w-7xl flex min-h-full flex-col" style={{ paddingTop: '12px', paddingBottom: '24px' }}>
        {/* Tabs */}
        <div className="flex border-b border-dashed border-border shrink-0" style={{ marginBottom: '12px' }}>
          {([{ key: 'campaigns' as WorkflowTab, label: 'CAMPAIGNS' }, { key: 'workflows' as WorkflowTab, label: 'WORKFLOWS' }]).map(t => (
            <button
              key={t.key}
              onClick={() => handleSetTab(t.key)}
              className={`ibm-spacing-allow flex-1 shrink-0 px-4 pt-0 pb-2.5 text-center font-medium transition-colors uppercase ${
                tab === t.key ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
              style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 500, letterSpacing: '2px' }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'campaigns' && (
          <CampaignsDndList
            engagementWorkflows={engagementWorkflows}
            setEngagementWorkflows={setEngagementWorkflows}
            clientId={clientId!}
            navigate={navigate}
            onEdit={(ew) => setEditingName({ id: ew.id, name: ew.name, type: 'campaign' })}
            onDelete={(id, name, e) => handleDeleteClick(id, name, 'campaign', e)}
            onNewLeadsToggle={handleNewLeadsToggle}
            onNewLeadsTagChange={handleNewLeadsTagChange}
          />
        )}

        {tab === 'workflows' && (
          <div className="flex flex-col gap-4">
            {/* Built-in workflows */}
            <div
              className="groove-border bg-card flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => navigate(`/client/${clientId}/workflows/process-dms`)}
            >
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-foreground font-medium field-text truncate">Text Setter Engine</p>
                  <p className="text-muted-foreground field-text truncate">Receive → Delay → Generate Reply → Follow Up</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <StatusTag variant="positive">ACTIVE</StatusTag>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-default"><StatusTag variant="neutral">BUILT-IN</StatusTag></span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[240px] text-center">
                      <p className="field-text">This workflow runs automatically. Use it to track progress, debug, and review executions.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            <div
              className="groove-border bg-card flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => navigate(`/client/${clientId}/workflows/sync-ghl-contacts`)}
            >
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-foreground font-medium field-text truncate">New Lead from GoHighLevel</p>
                  <p className="text-muted-foreground field-text truncate">Sync incoming leads from GoHighLevel into 1Prompt</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <StatusTag variant="positive">ACTIVE</StatusTag>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-default"><StatusTag variant="neutral">BUILT-IN</StatusTag></span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[240px] text-center">
                      <p className="field-text">This workflow runs automatically. Use it to track progress, debug, and review executions.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            <div
              className="groove-border bg-card flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => navigate(`/client/${clientId}/workflows/sync-ghl-bookings`)}
            >
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-foreground font-medium field-text truncate">New Booking from GoHighLevel</p>
                  <p className="text-muted-foreground field-text truncate">Sync incoming bookings from GoHighLevel into 1Prompt</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <StatusTag variant="positive">ACTIVE</StatusTag>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-default"><StatusTag variant="neutral">BUILT-IN</StatusTag></span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[240px] text-center">
                      <p className="field-text">This workflow runs automatically. Use it to track progress, debug, and review executions.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            <div
              className="groove-border bg-card flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => navigate(`/client/${clientId}/workflows/outbound-call-processing`)}
            >
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-foreground font-medium field-text truncate">Outbound Call Processing</p>
                  <p className="text-muted-foreground field-text truncate">Pre-call data fetching → Retell AI outbound call</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <StatusTag variant="positive">ACTIVE</StatusTag>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-default"><StatusTag variant="neutral">BUILT-IN</StatusTag></span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[240px] text-center">
                      <p className="field-text">This workflow runs automatically. Use it to track progress, debug, and review executions.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            {/* Custom Workflows */}
            {workflows.map(workflow => (
              <div
                key={workflow.id}
                className="groove-border bg-card flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => navigate(`/client/${clientId}/workflows/${workflow.id}`)}
              >
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground font-medium field-text truncate">{workflow.name}</p>
                    <p className="text-muted-foreground field-text truncate">
                      {(workflow.nodes || []).length} nodes · {(workflow.edges || []).length} connections
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <StatusTag variant={workflow.is_active ? 'positive' : 'neutral'}>
                    {workflow.is_active ? 'ACTIVE' : 'DRAFT'}
                  </StatusTag>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50"
                    onClick={(e) => { e.stopPropagation(); setEditingName({ id: workflow.id, name: workflow.name, type: 'custom' }); }}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center"
                    onClick={(e) => handleDeleteClick(workflow.id, workflow.name, 'custom', e)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Workflow Type Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md !p-0">
          <DialogHeader>
            <DialogTitle>NEW WORKFLOW</DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-3">
            <p className="text-muted-foreground field-text">Choose the type of workflow to create:</p>
            <button
              className="w-full groove-border bg-card hover:bg-muted/30 transition-colors px-4 py-3 text-left"
              onClick={() => { setShowCreateDialog(false); handleCreateCampaign(); }}
            >
              <p className="text-foreground font-medium field-text">Campaign Workflow</p>
              <p className="text-muted-foreground field-text mt-0.5">Multi-step engagement sequence with reply detection and analytics dashboard</p>
            </button>
            <button
              className="w-full groove-border bg-card hover:bg-muted/30 transition-colors px-4 py-3 text-left"
              onClick={() => { setShowCreateDialog(false); handleCreateCustom(); }}
            >
              <p className="text-foreground font-medium field-text">Custom Workflow</p>
              <p className="text-muted-foreground field-text mt-0.5">Build a custom automation with triggers, conditions, and actions</p>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Workflow Name Dialog */}
      {editingName && (
        <Dialog open={!!editingName} onOpenChange={() => setEditingName(null)}>
          <DialogContent className="max-w-md !p-0">
            <DialogHeader>
              <DialogTitle>EDIT WORKFLOW NAME</DialogTitle>
            </DialogHeader>
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <Label className="field-text">Name</Label>
                <Input
                  value={editingName.name}
                  onChange={e => setEditingName(prev => prev ? { ...prev, name: e.target.value } : null)}
                  className="field-text"
                  placeholder="e.g. Lead Follow-up"
                />
              </div>
              <div>
                <Label className="field-text text-muted-foreground">Workflow ID</Label>
                <span
                  className="cursor-pointer block mt-1"
                  title="Click to copy Workflow ID"
                  onClick={() => { navigator.clipboard.writeText(editingName.id); toast.success('Workflow ID copied'); }}
                >
                  <StatusTag variant="neutral">{editingName.id}</StatusTag>
                </span>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setEditingName(null)} className="flex-1 groove-btn field-text">CANCEL</Button>
                <Button className="flex-1 groove-btn field-text" onClick={handleSaveName}><Save className="w-4 h-4 mr-1.5" />SAVE</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={confirmDelete}
        title={deleteTarget?.type === 'campaign' ? 'Delete Campaign Workflow' : 'Delete Workflow'}
        itemName={deleteTarget?.name}
        description={deleteTarget?.type === 'campaign' ? 'This will permanently delete this campaign workflow, all associated engagement executions, and the analytics dashboard for any campaigns linked to it. This action cannot be undone.' : undefined}
      />
    </div>
  );
}
