import { useState, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TRIGGER_DEFINITIONS, CONDITION_OPERATORS } from '@/types/workflow';
import type { WorkflowNodeData, TriggerNodeData, WebhookActionData, FindContactActionData, ConditionNodeData, DelayActionData, CreateContactActionData, UpdateContactActionData, HttpMethod, DelayMode, DelayUnit } from '@/types/workflow';
import { Trash2, Plus, X, Save, Copy, ChevronDown, Zap, Clock } from '@/components/icons';
import type { Node } from '@xyflow/react';
import VariablePicker from './VariablePicker';
import WebhookRequestsPanel from './WebhookRequestsPanel';
import { TRIGGER_FIELD_LABELS, FIND_CONTACT_FIELD_LABELS, getAvailableFields } from '@/utils/workflowFieldUtils';
import { toast } from 'sonner';
import { edgeFunctionUrl } from '@/integrations/supabase/functionsBase';

interface WorkflowNodeConfigProps {
  nodeId: string;
  nodeType: string;
  data: WorkflowNodeData;
  allNodes: Node[];
  onUpdate: (nodeId: string, newData: Partial<WorkflowNodeData>) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
  onSaveAction?: () => void | Promise<void>;
  savingAction?: boolean;
  clientId?: string;
  workflowId?: string;
  webhookMappingReference?: any;
  onSaveMappingReference?: (ref: any) => void;
}

const fieldStyle = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' } as const;


export default function WorkflowNodeConfig({ nodeId, nodeType, data, allNodes, onUpdate, onDelete, onClose, onSaveAction, savingAction = false, clientId, workflowId, webhookMappingReference, onSaveMappingReference }: WorkflowNodeConfigProps) {
  const urlRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const contactIdRef = useRef<HTMLInputElement>(null);
  const condValueRef = useRef<HTMLInputElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const insertVariableAtCursor = (field: 'url' | 'body' | 'contactId' | 'condValue') => (variable: string) => {
    const refMap: Record<string, React.RefObject<HTMLInputElement | HTMLTextAreaElement>> = {
      url: urlRef,
      body: bodyRef,
      contactId: contactIdRef,
      condValue: condValueRef,
    };
    const fieldKeyMap: Record<string, string> = {
      url: 'url',
      body: 'body',
      contactId: 'contactIdMapping',
      condValue: 'value',
    };
    const el = refMap[field]?.current;
    const dataKey = fieldKeyMap[field];
    if (el) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newVal = el.value.slice(0, start) + variable + el.value.slice(end);
      onUpdate(nodeId, { [dataKey]: newVal } as any);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + variable.length, start + variable.length);
      }, 0);
    } else {
      const currentVal = (data as any)[dataKey] || '';
      onUpdate(nodeId, { [dataKey]: currentVal + variable } as any);
    }
  };

  const availableFields = getAvailableFields(
    allNodes.map(n => ({ id: n.id, type: n.type as string, data: n.data })),
    nodeId,
    webhookMappingReference
  );

  const [triggerPickerOpen, setTriggerPickerOpen] = useState(false);

  const renderTriggerConfig = () => {
    const d = data as TriggerNodeData;
    const triggerDef = TRIGGER_DEFINITIONS.find((t) => t.type === d.triggerType);
    const webhookUrl = clientId && workflowId
      ? `${edgeFunctionUrl('workflow-inbound-webhook')}?workflow_id=${workflowId}&client_id=${clientId}`
      : '';
    const ghlWebhookUrl = workflowId
      ? `${edgeFunctionUrl('workflow-inbound-webhook')}?workflow_id=${workflowId}&GHL_Account_ID={{contact.ghl_account_id}}&Contact_ID={{contact.id}}&Name={{contact.name}}&Email={{contact.email}}&Phone={{contact.phone_raw}}`
      : '';

    return (
      <div className="space-y-3">
        {/* Trigger Type as clickable field that opens popover */}
        <div>
          <label className="text-foreground capitalize block mb-1" style={fieldStyle}>Trigger Type</label>
          <Popover open={triggerPickerOpen} onOpenChange={setTriggerPickerOpen}>
            <PopoverTrigger asChild>
              <button
                className="w-full text-left px-3 h-9 groove-border bg-card hover:bg-accent transition-colors flex items-center justify-between"
              >
                <span className="text-foreground uppercase" style={fieldStyle}>{d.label || 'Select trigger...'}</span>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0 groove-border bg-sidebar" align="start" sideOffset={8} onWheel={(e) => e.stopPropagation()}>
              <div
                className="px-3 py-2 text-foreground uppercase flex items-center gap-2"
                style={{ fontFamily: "'VT323', monospace", fontSize: '18px', borderBottom: '1px solid hsl(var(--border))' }}
              >
                <Zap className="w-4 h-4" />
                <span>Select Trigger</span>
              </div>
              <div className="max-h-80 overflow-y-auto p-2 space-y-1.5" onWheel={(e) => e.stopPropagation()}>
                {TRIGGER_DEFINITIONS.map((t) => (
                  <button
                    key={t.type}
                    className={`w-full text-left px-3 py-2.5 groove-border transition-colors ${d.triggerType === t.type ? 'bg-accent ring-1 ring-primary' : 'bg-sidebar hover:bg-accent'}`}
                    onClick={() => {
                      onUpdate(nodeId, { triggerType: t.type, label: t.label, description: t.description } as any);
                      setTriggerPickerOpen(false);
                    }}
                  >
                    <div className="workflow-node-menu-option-label text-foreground" style={fieldStyle}>{t.label}</div>
                    <div className="workflow-node-menu-option-description text-muted-foreground" style={fieldStyle}>{t.description}</div>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div>
          <label className="text-foreground capitalize block mb-1" style={fieldStyle}>Label</label>
          <Input value={d.label} onChange={(e) => onUpdate(nodeId, { label: e.target.value } as any)} />
        </div>

        {/* Inbound Webhook: URL + copy */}
        {d.triggerType === 'inbound_webhook' && clientId && workflowId && (
          <>
            <div>
              <label className="text-foreground capitalize block mb-1" style={fieldStyle}>Webhook URL</label>
              <div className="flex items-center gap-2">
                <Input
                  value={webhookUrl}
                  readOnly
                  className="field-text text-xs flex-1"
                />
                <button
                  className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(webhookUrl);
                    toast.success('Webhook URL copied');
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div>
              <label className="text-foreground capitalize block mb-1" style={fieldStyle}>GHL Webhook URL</label>
              <div className="text-muted-foreground mb-1" style={{ ...fieldStyle, fontSize: '11px' }}>
                Paste this into GHL — uses GHL variables for auto-lookup
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={ghlWebhookUrl}
                  readOnly
                  className="field-text text-xs flex-1"
                />
                <button
                  className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(ghlWebhookUrl);
                    toast.success('GHL webhook URL copied');
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Webhook Requests Panel */}
            <WebhookRequestsPanel
              workflowId={workflowId}
              clientId={clientId}
              savedReference={webhookMappingReference}
              onSaveReference={onSaveMappingReference || (() => {})}
            />
          </>
        )}

        {/* Manual trigger: show enrollment info */}
        {d.triggerType === 'manual' && (
          <div className="groove-border p-3 space-y-2">
            <p className="text-muted-foreground" style={fieldStyle}>
              Leads are enrolled into this workflow manually from the Leads CRM using the "Launch Workflow" bulk action.
            </p>
            <label className="text-muted-foreground capitalize block mb-1" style={fieldStyle}>Output Fields</label>
            <div className="groove-border p-2 space-y-0.5">
              {triggerDef?.outputFields.map((f) => (
                <div key={f} className="text-muted-foreground" style={fieldStyle}>
                  {TRIGGER_FIELD_LABELS[f] || f}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Non-webhook, non-manual triggers: show output fields */}
        {d.triggerType !== 'inbound_webhook' && d.triggerType !== 'manual' && (
          <div>
            <label className="text-muted-foreground capitalize block mb-1" style={fieldStyle}>Output Fields</label>
            <div className="groove-border p-2 mt-1 space-y-0.5">
              {triggerDef?.outputFields.map((f) => (
                <div key={f} className="text-muted-foreground" style={fieldStyle}>
                  {TRIGGER_FIELD_LABELS[f] || f}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderWebhookConfig = () => {
    const d = data as WebhookActionData;
    const headers = d.headers || {};
    const params = (d as any).params || {};
    const headerEntries = Object.entries(headers);
    const paramEntries = Object.entries(params);

    const addHeader = () => {
      const newHeaders = { ...headers, '': '' };
      onUpdate(nodeId, { headers: newHeaders } as any);
    };

    const updateHeaderKey = (oldKey: string, newKey: string) => {
      const newHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        newHeaders[k === oldKey ? newKey : k] = v;
      }
      onUpdate(nodeId, { headers: newHeaders } as any);
    };

    const updateHeaderValue = (key: string, value: string) => {
      onUpdate(nodeId, { headers: { ...headers, [key]: value } } as any);
    };

    const removeHeader = (key: string) => {
      const newHeaders = { ...headers };
      delete newHeaders[key];
      onUpdate(nodeId, { headers: newHeaders } as any);
    };

    const addParam = () => {
      onUpdate(nodeId, { params: { ...params, '': '' } } as any);
    };

    const updateParamKey = (oldKey: string, newKey: string) => {
      const newParams: Record<string, string> = {};
      for (const [k, v] of Object.entries(params)) {
        newParams[k === oldKey ? newKey : k] = v as string;
      }
      onUpdate(nodeId, { params: newParams } as any);
    };

    const updateParamValue = (key: string, value: string) => {
      onUpdate(nodeId, { params: { ...params, [key]: value } } as any);
    };

    const removeParam = (key: string) => {
      const newParams = { ...params };
      delete newParams[key];
      onUpdate(nodeId, { params: newParams } as any);
    };

    return (
      <div className="space-y-3">
        <div>
          <label className="text-foreground capitalize block mb-1" style={fieldStyle}>Label</label>
          <Input value={d.label} onChange={(e) => onUpdate(nodeId, { label: e.target.value } as any)} />
        </div>
        <div>
          <label className="text-foreground capitalize block mb-1" style={fieldStyle}>Method</label>
          <Select value={d.method} onValueChange={(v) => onUpdate(nodeId, { method: v as HttpMethod } as any)}>
            <SelectTrigger className="uppercase" style={fieldStyle}><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as HttpMethod[]).map((m) => (
                <SelectItem key={m} value={m} className="uppercase" style={fieldStyle}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-foreground capitalize" style={fieldStyle}>URL</label>
            <VariablePicker nodes={allNodes} currentNodeId={nodeId} onInsert={insertVariableAtCursor('url')} webhookMappingReference={webhookMappingReference} />
          </div>
          <Input
            ref={urlRef}
            value={d.url}
            onChange={(e) => onUpdate(nodeId, { url: e.target.value } as any)}
            placeholder="https://example.com/webhook"
          />
        </div>

        {/* Parameters */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-foreground capitalize" style={fieldStyle}>Parameters</label>
            <div className="flex items-center gap-1">
              {paramEntries.length > 0 && (
                <VariablePicker nodes={allNodes} currentNodeId={nodeId} onInsert={(variable) => {
                  const keys = Object.keys(params);
                  if (keys.length > 0) {
                    const lastKey = keys[keys.length - 1];
                    updateParamValue(lastKey, ((params as any)[lastKey] || '') + variable);
                  }
                }} webhookMappingReference={webhookMappingReference} />
              )}
              <button type="button" className="groove-btn !h-8 !w-8 !p-0 flex items-center justify-center" onClick={addParam}>
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {paramEntries.length > 0 ? (
            <div className="space-y-1.5">
              {paramEntries.map(([key, value], idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <Input
                    value={key}
                    onChange={(e) => updateParamKey(key, e.target.value)}
                    placeholder="Key"
                    className="flex-1 min-w-0"
                    style={{ fontSize: '13px' }}
                  />
                  <Input
                    value={value as string}
                    onChange={(e) => updateParamValue(key, e.target.value)}
                    placeholder="Value"
                    className="flex-1 min-w-0"
                    style={{ fontSize: '13px' }}
                  />
                  <button
                    onClick={() => removeParam(key)}
                    className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground" style={fieldStyle}>
              No query parameters
            </div>
          )}
        </div>

        {/* Headers */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-foreground capitalize" style={fieldStyle}>Headers</label>
            <div className="flex items-center gap-1">
              {headerEntries.length > 0 && (
                <VariablePicker nodes={allNodes} currentNodeId={nodeId} onInsert={(variable) => {
                  const keys = Object.keys(headers);
                  if (keys.length > 0) {
                    const lastKey = keys[keys.length - 1];
                    updateHeaderValue(lastKey, (headers[lastKey] || '') + variable);
                  }
                }} webhookMappingReference={webhookMappingReference} />
              )}
              <button type="button" className="groove-btn !h-8 !w-8 !p-0 flex items-center justify-center" onClick={addHeader}>
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {headerEntries.length > 0 ? (
            <div className="space-y-1.5">
              {headerEntries.map(([key, value], idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <Input
                    value={key}
                    onChange={(e) => updateHeaderKey(key, e.target.value)}
                    placeholder="Key"
                    className="flex-1 min-w-0"
                    style={{ fontSize: '13px' }}
                  />
                  <Input
                    value={value}
                    onChange={(e) => updateHeaderValue(key, e.target.value)}
                    placeholder="Value"
                    className="flex-1 min-w-0"
                    style={{ fontSize: '13px' }}
                  />
                  <button
                    onClick={() => removeHeader(key)}
                    className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground" style={fieldStyle}>
              No custom headers. Content-Type: application/json is sent by default.
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-foreground capitalize" style={fieldStyle}>Body (JSON)</label>
            <VariablePicker nodes={allNodes} currentNodeId={nodeId} onInsert={insertVariableAtCursor('body')} webhookMappingReference={webhookMappingReference} />
          </div>
          <Textarea
            ref={bodyRef}
            value={d.body}
            onChange={(e) => onUpdate(nodeId, { body: e.target.value } as any)}
            placeholder='{"contact_id": "{{trigger.contact_id}}"}'
            rows={5}
            style={fieldStyle}
          />
          <div className="text-muted-foreground mt-1" style={fieldStyle}>
            Use the Insert Variable button to reference data from previous nodes
          </div>
        </div>

        <div className="pt-2">
          <Button
            type="button"
            onClick={() => onSaveAction?.()}
            disabled={savingAction}
            className="w-full groove-btn gap-2"
            style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}
          >
            <Save className="w-4 h-4" />
            {savingAction ? 'SAVING...' : 'SAVE ACTION'}
          </Button>
        </div>
      </div>
    );
  };

  const renderConditionConfig = () => {
    const d = data as ConditionNodeData;
    return (
      <div className="space-y-3">
        <div>
          <label className="text-foreground capitalize block mb-1" style={fieldStyle}>Label</label>
          <Input value={d.label} onChange={(e) => onUpdate(nodeId, { label: e.target.value } as any)} />
        </div>
        <div>
          <label className="text-foreground capitalize block mb-1" style={fieldStyle}>Field</label>
          {availableFields.length > 0 ? (
            <Select value={d.field} onValueChange={(v) => onUpdate(nodeId, { field: v } as any)}>
              <SelectTrigger className="uppercase" style={fieldStyle}><SelectValue placeholder="Select a field..." /></SelectTrigger>
              <SelectContent>
                {availableFields.map((f) => (
                  <SelectItem key={f.variable} value={f.variable} style={fieldStyle}>
                    <span>{f.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input value={d.field} onChange={(e) => onUpdate(nodeId, { field: e.target.value } as any)} placeholder="Add a trigger or find node first" />
          )}
        </div>
        <div>
          <label className="text-foreground capitalize block mb-1" style={fieldStyle}>Operator</label>
          <Select value={d.operator} onValueChange={(v) => onUpdate(nodeId, { operator: v } as any)}>
            <SelectTrigger className="uppercase" style={fieldStyle}><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONDITION_OPERATORS.map((op) => (
                <SelectItem key={op.value} value={op.value} style={fieldStyle}>{op.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-foreground capitalize" style={fieldStyle}>Value</label>
            <VariablePicker nodes={allNodes} currentNodeId={nodeId} onInsert={insertVariableAtCursor('condValue')} webhookMappingReference={webhookMappingReference} />
          </div>
          <Input
            ref={condValueRef}
            value={d.value}
            onChange={(e) => onUpdate(nodeId, { value: e.target.value } as any)}
            placeholder="Expected value"
          />
        </div>

        {/* Branching outcomes */}
        <div
          className="mt-4 pt-4"
          style={{ borderTop: '2px dashed hsl(var(--border))' }}
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: 'hsl(var(--success))' }} />
              <span className="text-foreground" style={fieldStyle}>{d.trueLabel || 'True'}</span>
              <span className="text-muted-foreground ml-auto" style={{ ...fieldStyle, fontSize: '11px' }}>→ next node</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: 'hsl(var(--destructive))' }} />
              <span className="text-foreground" style={fieldStyle}>{d.falseLabel || 'False'}</span>
              <span className="text-muted-foreground ml-auto" style={{ ...fieldStyle, fontSize: '11px' }}>→ alternate path</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFindConfig = () => {
    const d = data as FindContactActionData;
    return (
      <div className="space-y-3">
        <div>
          <label className="text-foreground capitalize block mb-1" style={fieldStyle}>Label</label>
          <Input value={d.label} onChange={(e) => onUpdate(nodeId, { label: e.target.value } as any)} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-foreground capitalize" style={fieldStyle}>Contact ID Mapping</label>
            <VariablePicker nodes={allNodes} currentNodeId={nodeId} onInsert={insertVariableAtCursor('contactId')} webhookMappingReference={webhookMappingReference} />
          </div>
          <Input
            ref={contactIdRef}
            value={d.contactIdMapping}
            onChange={(e) => onUpdate(nodeId, { contactIdMapping: e.target.value } as any)}
            placeholder="Contact ID"
          />
        </div>
        <div>
          <label className="text-muted-foreground capitalize block mb-1" style={fieldStyle}>Output Fields</label>
          <div className="groove-border p-2 mt-1 space-y-0.5">
            {(['id', 'first_name', 'last_name', 'phone', 'email', 'business_name', 'custom_fields', 'contact_id', 'created_at'] as const).map((f) => (
              <div key={f} className="text-muted-foreground" style={fieldStyle}>
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const COMMON_TIMEZONES = [
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Toronto', 'America/Vancouver', 'America/Sao_Paulo', 'America/Mexico_City',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Amsterdam',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Dubai', 'Asia/Kolkata',
    'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland',
    'UTC',
  ];

  const renderDelayConfig = () => {
    const d = data as DelayActionData;
    return (
      <div className="space-y-3">
        <div>
          <label className="text-foreground capitalize block mb-1" style={fieldStyle}>Label</label>
          <Input value={d.label} onChange={(e) => onUpdate(nodeId, { label: e.target.value } as any)} />
        </div>
        <div>
          <label className="text-foreground capitalize block mb-1" style={fieldStyle}>Delay Mode</label>
          <Select value={d.delayMode || 'duration'} onValueChange={(v) => onUpdate(nodeId, { delayMode: v as DelayMode } as any)}>
            <SelectTrigger className="uppercase" style={fieldStyle}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="duration" style={fieldStyle}>Wait Duration</SelectItem>
              <SelectItem value="until" style={fieldStyle}>Wait Until Date/Time</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {(d.delayMode || 'duration') === 'duration' ? (
          <>
            <div>
              <label className="text-foreground capitalize block mb-1" style={fieldStyle}>Duration</label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  value={d.delayValue || 60}
                  onChange={(e) => onUpdate(nodeId, { delayValue: parseInt(e.target.value) || 1 } as any)}
                  className="flex-1"
                />
                <Select value={d.delayUnit || 'seconds'} onValueChange={(v) => onUpdate(nodeId, { delayUnit: v as DelayUnit } as any)}>
                  <SelectTrigger className="w-[130px] uppercase" style={fieldStyle}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="seconds" style={fieldStyle}>Seconds</SelectItem>
                    <SelectItem value="minutes" style={fieldStyle}>Minutes</SelectItem>
                    <SelectItem value="hours" style={fieldStyle}>Hours</SelectItem>
                    <SelectItem value="days" style={fieldStyle}>Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="text-foreground capitalize block mb-1" style={fieldStyle}>Wait Until (Date & Time)</label>
              <Input
                type="datetime-local"
                value={d.waitUntil || ''}
                onChange={(e) => onUpdate(nodeId, { waitUntil: e.target.value } as any)}
              />
            </div>
            <div>
              <label className="text-foreground capitalize block mb-1" style={fieldStyle}>Timezone</label>
              <Select value={d.timezone || 'America/New_York'} onValueChange={(v) => onUpdate(nodeId, { timezone: v } as any)}>
                <SelectTrigger style={fieldStyle}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map(tz => (
                    <SelectItem key={tz} value={tz} style={fieldStyle}>{tz}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        <div className="pt-2">
          <Button
            type="button"
            onClick={() => onSaveAction?.()}
            disabled={savingAction}
            className="w-full groove-btn gap-2"
            style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}
          >
            <Save className="w-4 h-4" />
            {savingAction ? 'SAVING...' : 'SAVE ACTION'}
          </Button>
        </div>
      </div>
    );
  };

  const renderContactActionConfig = (isCreate: boolean) => {
    const d = data as (CreateContactActionData | UpdateContactActionData);
    const prefix = isCreate ? 'create_contact' : 'update_contact';
    return (
      <div className="space-y-3">
        <div>
          <label className="text-foreground capitalize block mb-1" style={fieldStyle}>Label</label>
          <Input value={d.label} onChange={(e) => onUpdate(nodeId, { label: e.target.value } as any)} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-foreground capitalize" style={fieldStyle}>GHL Contact ID <span className="text-destructive">*</span></label>
            <VariablePicker nodes={allNodes} currentNodeId={nodeId} onInsert={(variable) => {
              const cur = d.ghl_contact_id || '';
              onUpdate(nodeId, { ghl_contact_id: cur + variable } as any);
            }} webhookMappingReference={webhookMappingReference} />
          </div>
          <Input
            value={d.ghl_contact_id || ''}
            onChange={(e) => onUpdate(nodeId, { ghl_contact_id: e.target.value } as any)}
            placeholder="{{trigger.query.Contact_ID}}"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-foreground capitalize" style={fieldStyle}>Full Name</label>
            <VariablePicker nodes={allNodes} currentNodeId={nodeId} onInsert={(variable) => {
              const cur = (d as any).name || '';
              onUpdate(nodeId, { name: cur + variable } as any);
            }} webhookMappingReference={webhookMappingReference} />
          </div>
          <Input
            value={(d as any).name || ''}
            onChange={(e) => onUpdate(nodeId, { name: e.target.value } as any)}
            placeholder="{{trigger.query.Name}}"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-foreground capitalize" style={fieldStyle}>Email</label>
            <VariablePicker nodes={allNodes} currentNodeId={nodeId} onInsert={(variable) => {
              const cur = (d as any).email || '';
              onUpdate(nodeId, { email: cur + variable } as any);
            }} webhookMappingReference={webhookMappingReference} />
          </div>
          <Input
            value={(d as any).email || ''}
            onChange={(e) => onUpdate(nodeId, { email: e.target.value } as any)}
            placeholder="{{trigger.query.Email}}"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-foreground capitalize" style={fieldStyle}>Phone</label>
            <VariablePicker nodes={allNodes} currentNodeId={nodeId} onInsert={(variable) => {
              const cur = (d as any).phone || '';
              onUpdate(nodeId, { phone: cur + variable } as any);
            }} webhookMappingReference={webhookMappingReference} />
          </div>
          <Input
            value={(d as any).phone || ''}
            onChange={(e) => onUpdate(nodeId, { phone: e.target.value } as any)}
            placeholder="{{trigger.query.Phone}}"
          />
        </div>
        <div className="pt-2">
          <Button
            type="button"
            onClick={() => onSaveAction?.()}
            disabled={savingAction}
            className="w-full groove-btn gap-2"
            style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}
          >
            <Save className="w-4 h-4" />
            {savingAction ? 'SAVING...' : 'SAVE ACTION'}
          </Button>
        </div>
      </div>
    );
  };

  const typeLabel = nodeType === 'trigger' ? 'Trigger' : nodeType === 'action' ? 'Webhook' : nodeType === 'condition' ? 'If / Else' : nodeType === 'delay' ? 'Delay' : nodeType === 'create_contact' ? 'Create Contact' : nodeType === 'update_contact' ? 'Update Contact' : 'Find Contact';

  return (
    <div className="w-[408px] h-full bg-card overflow-hidden flex flex-col" style={{ borderLeft: '3px groove hsl(var(--border-groove))' }}>
      <div
        className="px-4 shrink-0 flex items-center justify-between"
        style={{ height: 52, borderBottom: '1px solid hsl(var(--border))' }}
      >
        <h3 className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '22px' }}>
          {typeLabel} Config
        </h3>
        <div className="flex items-center gap-1">
          <button
            className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="p-3 flex-1 overflow-y-auto">
        {nodeType === 'trigger' && renderTriggerConfig()}
        {nodeType === 'action' && renderWebhookConfig()}
        {nodeType === 'condition' && renderConditionConfig()}
        {nodeType === 'find' && renderFindConfig()}
        {nodeType === 'delay' && renderDelayConfig()}
        {nodeType === 'create_contact' && renderContactActionConfig(true)}
        {nodeType === 'update_contact' && renderContactActionConfig(false)}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-md !p-0">
          <DialogHeader>
            <DialogTitle>DELETE NODE</DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-6">
            <p className="text-muted-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
              Are you sure you want to delete this {typeLabel.toLowerCase()} node? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 groove-btn field-text"
                onClick={() => setShowDeleteConfirm(false)}
              >
                CANCEL
              </Button>
              <Button
                variant="destructive"
                className="flex-1 groove-btn field-text"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  onDelete(nodeId);
                }}
              >
                DELETE
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
