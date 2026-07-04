import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRetellApi, RetellKnowledgeBase } from '@/hooks/useRetellApi';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, Plus, RefreshCw, BookOpen, Trash2, GripVertical, ChevronDown, ChevronUp, Code, Globe, Wrench, Phone, Hash } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { RetellVoiceSelector } from '@/components/RetellVoiceSelector';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Search } from 'lucide-react';
import { Check, Maximize2 } from '@/components/icons';
import { ExpandableTextDialog } from '@/components/ExpandableTextDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DEFAULT_RETELL_ANALYSIS_SUCCESSFUL_PROMPT,
  DEFAULT_RETELL_ANALYSIS_SUMMARY_PROMPT,
  DEFAULT_RETELL_ANALYSIS_USER_SENTIMENT_PROMPT,
  DEFAULT_RETELL_GENERAL_TOOLS,
  DEFAULT_RETELL_POST_CALL_ANALYSIS_DATA,
  DEFAULT_RETELL_USER_DTMF_OPTIONS,
  DEFAULT_RETELL_VOICEMAIL_OPTION,
  formatJsonConfig,
} from '@/lib/retellVoiceAgentDefaults';

export interface RetellVoiceSettings {
  voice_id: string;
  voice_model: string;
  voice_temperature: number;
  voice_speed: number;
  volume: number;
  language: string;
  ambient_sound: string;
  ambient_sound_volume: number;
  responsiveness: number;
  interruption_sensitivity: number;
  end_call_after_silence_ms: number;
  max_call_duration_ms: number;
  boosted_keywords: string;
  begin_message: string;
  begin_message_delay_ms: number;
  enable_backchannel: boolean;
  backchannel_frequency: number;
  reminder_trigger_ms: number;
  reminder_max_count: number;
  normalize_for_speech: boolean;
  opt_out_sensitive_data_storage: boolean;
  pronunciation_dictionary: string;
  post_call_analysis_data: string;
  post_call_analysis_model: string;
  analysis_successful_prompt: string;
  analysis_summary_prompt: string;
  analysis_user_sentiment_prompt: string;
  webhook_url: string;
  webhook_timeout_ms: number;
  end_call_after_silence_enabled: boolean;
  data_storage_setting: string;
  model_high_priority: boolean;
  knowledge_base_ids: string;
  general_tools: string;
  voicemail_option: string;
  user_dtmf_options: string;
  vocab_specialization: string;
  start_speaker: string;
  stt_mode: string;
  custom_stt_config: string;
  pii_config: string;
}

export const DEFAULT_RETELL_VOICE_SETTINGS: RetellVoiceSettings = {
  voice_id: '11labs-Myra',
  voice_model: 'eleven_turbo_v2_5',
  voice_temperature: 1.06,
  voice_speed: 1.1,
  volume: 1.4,
  language: 'en-US',
  ambient_sound: 'call-center',
  ambient_sound_volume: 1,
  responsiveness: 0.97,
  interruption_sensitivity: 0.9,
  end_call_after_silence_ms: 179000,
  max_call_duration_ms: 601000,
  boosted_keywords: '',
  begin_message: '',
  begin_message_delay_ms: 2000,
  enable_backchannel: true,
  backchannel_frequency: 0.7,
  reminder_trigger_ms: 10000,
  reminder_max_count: 1,
  normalize_for_speech: true,
  opt_out_sensitive_data_storage: false,
  pronunciation_dictionary: '',
  post_call_analysis_data: formatJsonConfig(DEFAULT_RETELL_POST_CALL_ANALYSIS_DATA),
  post_call_analysis_model: 'gpt-4.1',
  analysis_successful_prompt: DEFAULT_RETELL_ANALYSIS_SUCCESSFUL_PROMPT,
  analysis_summary_prompt: DEFAULT_RETELL_ANALYSIS_SUMMARY_PROMPT,
  analysis_user_sentiment_prompt: DEFAULT_RETELL_ANALYSIS_USER_SENTIMENT_PROMPT,
  webhook_url: '',
  webhook_timeout_ms: 15000,
  end_call_after_silence_enabled: true,
  data_storage_setting: 'everything',
  model_high_priority: true,
  knowledge_base_ids: '',
  general_tools: formatJsonConfig(DEFAULT_RETELL_GENERAL_TOOLS),
  voicemail_option: formatJsonConfig(DEFAULT_RETELL_VOICEMAIL_OPTION),
  user_dtmf_options: formatJsonConfig(DEFAULT_RETELL_USER_DTMF_OPTIONS),
  vocab_specialization: 'general',
  start_speaker: 'agent',
  stt_mode: 'accurate',
  custom_stt_config: formatJsonConfig({ provider: 'deepgram', endpointing_ms: 1000 }),
  pii_config: formatJsonConfig({ mode: 'post_call', categories: [] }),
};

const LANGUAGES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-AU', label: 'English (Australia)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'es-419', label: 'Spanish (Latin America)' },
  { value: 'fr-FR', label: 'French' },
  { value: 'de-DE', label: 'German' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'nl-NL', label: 'Dutch' },
  { value: 'multi', label: 'Multi-language' },
];

const AMBIENT_SOUNDS = [
  { value: 'none', label: 'None' },
  { value: 'coffee-shop', label: 'Coffee Shop' },
  { value: 'convention-hall', label: 'Convention Hall' },
  { value: 'summer-outdoor', label: 'Summer Outdoor' },
  { value: 'call-center', label: 'Call Center' },
];

const START_SPEAKERS = [
  { value: 'agent', label: 'Setter' },
  { value: 'user', label: 'User' },
];

const STT_MODES = [
  { value: 'accurate', label: 'Accurate' },
  { value: 'fast', label: 'Fast' },
];

// ── Standardized typography matching text setter (SetterParameterField) ──
const titleStyle = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 500, lineHeight: '1.4' } as const;
const subtitleStyle = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 400, lineHeight: '1.4' } as const;
const monoStyle = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' } as const;

interface VoiceRetellSettingsProps {
  clientId: string;
  settings: RetellVoiceSettings;
  onChange: (updates: Partial<RetellVoiceSettings>) => void;
  disabled?: boolean;
  bookingEnabled?: boolean;
  advancedExpanded?: boolean;
  onAdvancedExpandedChange?: (expanded: boolean) => void;
  renderMode?: 'all' | 'basic' | 'advanced';
}

// ── Debounced Inputs ──
const DebouncedInput = memo(({
  value, onChange, delay = 300, ...props
}: { value: string; onChange: (v: string) => void; delay?: number } & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'>) => {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const localRef = useRef(value);
  useEffect(() => { setLocal(value); localRef.current = value; }, [value]);
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value; setLocal(v); localRef.current = v;
    clearTimeout(timerRef.current); timerRef.current = setTimeout(() => onChange(v), delay);
  }, [delay, onChange]);
  const handleBlur = useCallback(() => { clearTimeout(timerRef.current); if (localRef.current !== value) onChange(localRef.current); }, [onChange, value]);
  useEffect(() => () => { clearTimeout(timerRef.current); }, []);
  return <Input {...props} value={local} onChange={handleChange} onBlur={handleBlur} />;
});
DebouncedInput.displayName = 'DebouncedInput';

const DebouncedTextarea = memo(({
  value, onChange, delay = 300, ...props
}: { value: string; onChange: (v: string) => void; delay?: number } & Omit<React.ComponentProps<typeof Textarea>, 'value' | 'onChange'>) => {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const localRef = useRef(value);
  useEffect(() => { setLocal(value); localRef.current = value; }, [value]);
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value; setLocal(v); localRef.current = v;
    clearTimeout(timerRef.current); timerRef.current = setTimeout(() => onChange(v), delay);
  }, [delay, onChange]);
  const handleBlur = useCallback(() => { clearTimeout(timerRef.current); if (localRef.current !== value) onChange(localRef.current); }, [onChange, value]);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  return <Textarea {...props} value={local} onChange={handleChange} onBlur={handleBlur} />;
});
DebouncedTextarea.displayName = 'DebouncedTextarea';

const DebouncedNumberInput = memo(({
  value, onChange, delay = 400, transform, ...props
}: {
  value: number; onChange: (v: number) => void; delay?: number;
  transform?: { fromDisplay: (v: number) => number; toDisplay: (v: number) => number };
} & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'>) => {
  const displayValue = transform ? transform.toDisplay(value) : value;
  const [local, setLocal] = useState(String(displayValue));
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const localRef = useRef(String(displayValue));
  useEffect(() => { const d = String(transform ? transform.toDisplay(value) : value); setLocal(d); localRef.current = d; }, [transform, value]);
  const flush = useCallback((raw: string) => { const p = Number(raw); const n = Number.isFinite(p) ? p : 0; onChange(transform ? transform.fromDisplay(n) : n); }, [onChange, transform]);
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { const v = e.target.value; setLocal(v); localRef.current = v; clearTimeout(timerRef.current); timerRef.current = setTimeout(() => flush(v), delay); }, [delay, flush]);
  const handleBlur = useCallback(() => { clearTimeout(timerRef.current); const cur = String(transform ? transform.toDisplay(value) : value); if (localRef.current !== cur) flush(localRef.current); }, [flush, transform, value]);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  return <Input {...props} type="number" value={local} onChange={handleChange} onBlur={handleBlur} />;
});
DebouncedNumberInput.displayName = 'DebouncedNumberInput';

// ── Standard Select Dropdown (Popover-based, matching OpenRouterModelSelector) ──
function StandardSelect({ value, onChange, options, placeholder, disabled }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string; description?: string }[];
  placeholder?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "relative flex h-8 w-full items-center groove-border bg-card px-3 pr-10 py-1 text-left",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          style={{ ...monoStyle, textTransform: 'uppercase' }}
        >
          <span className={cn("truncate flex-1", !value ? "text-muted-foreground" : "text-foreground")}>
            {selected?.label || placeholder || 'Select...'}
          </span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5 text-foreground" fill="currentColor" style={{ imageRendering: 'pixelated' }}>
              <rect x="7" y="9" width="2" height="2" />
              <rect x="9" y="11" width="2" height="2" />
              <rect x="11" y="13" width="2" height="2" />
              <rect x="13" y="11" width="2" height="2" />
              <rect x="15" y="9" width="2" height="2" />
            </svg>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 groove-border bg-sidebar" align="start" sideOffset={4}>
        <div className="max-h-[260px] overflow-y-auto p-1">
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={cn(
                "flex items-center w-full gap-2 rounded-sm px-3 py-1.5 cursor-pointer",
                "hover:bg-accent hover:text-accent-foreground",
                value === opt.value && "bg-accent text-accent-foreground"
              )}
              style={{ ...monoStyle, textTransform: 'capitalize' }}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              <Check className={cn("h-3.5 w-3.5 shrink-0", value === opt.value ? "opacity-100" : "opacity-0")} />
              <span className="truncate flex-1 text-left">{opt.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Field Components (standardized to match text setter) ──
const FieldTitle = ({ children }: { children: React.ReactNode }) => (
  <span className="text-foreground block" style={titleStyle}>{children}</span>
);

const FieldSubtitle = ({ children }: { children: React.ReactNode }) => (
  <p className="text-muted-foreground mt-[2px]" style={subtitleStyle}>{children}</p>
);

const FieldGroup = ({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) => (
  <div className="space-y-2">
    <div>
      <FieldTitle>{title}</FieldTitle>
      {subtitle && <FieldSubtitle>{subtitle}</FieldSubtitle>}
    </div>
    {children}
  </div>
);

// Debounced slider to fix lag
const DebouncedSlider = memo(({ value, onValueCommit, min, max, step, disabled }: {
  value: number; onValueCommit: (v: number) => void; min: number; max: number; step: number; disabled: boolean;
}) => {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <Slider
      value={[local]}
      onValueChange={([v]) => setLocal(v)}
      onValueCommit={([v]) => onValueCommit(v)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
    />
  );
});
DebouncedSlider.displayName = 'DebouncedSlider';

const SliderField = memo(({ label, subtitle, value, min, max, step, disabled, onChange }: {
  label: string; subtitle: string; value: number; min: number; max: number; step: number; disabled: boolean; onChange: (v: number) => void;
}) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <div>
        <FieldTitle>{label}</FieldTitle>
        <FieldSubtitle>{subtitle}</FieldSubtitle>
      </div>
      <span className="text-muted-foreground" style={monoStyle}>{value.toFixed(2)}</span>
    </div>
    <DebouncedSlider value={value} onValueCommit={onChange} min={min} max={max} step={step} disabled={disabled} />
  </div>
));
SliderField.displayName = 'SliderField';

const ToggleField = memo(({ label, subtitle, checked, disabled, onChange }: {
  label: string; subtitle?: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void;
}) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between gap-4">
      <div>
        <FieldTitle>{label}</FieldTitle>
        {subtitle && <FieldSubtitle>{subtitle}</FieldSubtitle>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  </div>
));
ToggleField.displayName = 'ToggleField';

const msToSec = { toDisplay: (ms: number) => ms / 1000, fromDisplay: (sec: number) => Math.round(sec * 1000) };
const msToMin = { toDisplay: (ms: number) => ms / 60000, fromDisplay: (min: number) => Math.round(min * 60000) };

// ── Pixel art icons for buttons ──
const PixelPlusIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" style={{ imageRendering: 'pixelated' }}>
    <rect x="7" y="3" width="2" height="10" />
    <rect x="3" y="7" width="10" height="2" />
  </svg>
);

const PixelTrashIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" style={{ imageRendering: 'pixelated' }}>
    <rect x="3" y="3" width="10" height="2" />
    <rect x="5" y="1" width="6" height="2" />
    <rect x="4" y="5" width="8" height="2" />
    <rect x="4" y="7" width="8" height="2" />
    <rect x="4" y="9" width="8" height="2" />
    <rect x="4" y="11" width="8" height="2" />
  </svg>
);

const PixelCodeIcon = () => (
  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" style={{ imageRendering: 'pixelated' }}>
    <rect x="2" y="7" width="2" height="2" />
    <rect x="4" y="5" width="2" height="2" />
    <rect x="4" y="9" width="2" height="2" />
    <rect x="10" y="5" width="2" height="2" />
    <rect x="10" y="9" width="2" height="2" />
    <rect x="12" y="7" width="2" height="2" />
  </svg>
);

// ── Standard groove button ──
const GrooveButton = ({ children, onClick, disabled, variant = 'default', className: extraClass }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: 'default' | 'destructive'; className?: string;
}) => (
  <Button
    type="button"
    variant="default"
    size="sm"
    onClick={onClick}
    disabled={disabled}
    className={cn("h-8 gap-1.5 groove-border", variant === 'destructive' && 'text-destructive hover:text-destructive', extraClass)}
    style={monoStyle}
  >
    {children}
  </Button>
);

// ── Expand button for textareas ──
const ExpandButton = ({ onClick }: { onClick: () => void }) => (
  <Button
    type="button"
    variant="default"
    size="icon"
    onClick={onClick}
    className="absolute bottom-2 right-2 h-8 w-8"
  >
    <Maximize2 className="w-4 h-4" />
  </Button>
);

// ── Pixel copy icon matching workflow trigger URL style ──
const PixelCopyIcon = () => (
  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" style={{ imageRendering: 'pixelated' as const }}>
    <rect x="6" y="2" width="8" height="2" />
    <rect x="6" y="2" width="2" height="10" />
    <rect x="6" y="10" width="8" height="2" />
    <rect x="12" y="2" width="2" height="10" />
    <rect x="2" y="5" width="8" height="2" />
    <rect x="2" y="5" width="2" height="9" />
    <rect x="2" y="12" width="8" height="2" />
    <rect x="8" y="5" width="2" height="9" />
  </svg>
);

// ── Copyable read-only field (matches Receive Message webhook URL style) ──
const CopyableField = ({ value }: { value: string }) => {
  return (
    <div className="flex items-center gap-2">
      <Input
        className="h-8 text-muted-foreground flex-1"
        style={monoStyle}
        value={value}
        readOnly
      />
      <button
        type="button"
        className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center shrink-0"
        onClick={() => {
          navigator.clipboard.writeText(value);
          toast.success('Copied to clipboard');
        }}
        title="Copy to clipboard"
      >
        <PixelCopyIcon />
      </button>
    </div>
  );
};

// ── Post-Call Analysis Fields Editor ──
interface AnalysisField { name: string; description: string; type: 'string' | 'enum' | 'boolean'; choices?: string[]; }

const PostCallAnalysisFieldsEditor = memo(({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) => {
  const [showRawJson, setShowRawJson] = useState(false);
  const [expandDialog, setExpandDialog] = useState(false);
  const fields: AnalysisField[] = useMemo(() => { try { const p = JSON.parse(value); return Array.isArray(p) ? p : []; } catch { return []; } }, [value]);
  const updateFields = useCallback((next: AnalysisField[]) => onChange(JSON.stringify(next, null, 2)), [onChange]);
  const updateField = useCallback((i: number, patch: Partial<AnalysisField>) => updateFields(fields.map((f, j) => j === i ? { ...f, ...patch } : f)), [fields, updateFields]);
  const addField = useCallback(() => updateFields([...fields, { name: '', description: '', type: 'string' }]), [fields, updateFields]);
  const removeField = useCallback((i: number) => updateFields(fields.filter((_, j) => j !== i)), [fields, updateFields]);
  const moveField = useCallback((i: number, d: -1 | 1) => { const n = [...fields]; const t = i + d; if (t < 0 || t >= n.length) return; [n[i], n[t]] = [n[t], n[i]]; updateFields(n); }, [fields, updateFields]);
  const updateChoice = useCallback((fi: number, ci: number, val: string) => { const f = fields[fi]; const c = [...(f.choices || [])]; c[ci] = val; updateField(fi, { choices: c }); }, [fields, updateField]);
  const addChoice = useCallback((fi: number) => { const f = fields[fi]; updateField(fi, { choices: [...(f.choices || []), ''] }); }, [fields, updateField]);
  const removeChoice = useCallback((fi: number, ci: number) => { const f = fields[fi]; updateField(fi, { choices: (f.choices || []).filter((_, i) => i !== ci) }); }, [fields, updateField]);

  if (showRawJson) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <FieldTitle>Post-Call Analysis Fields</FieldTitle>
          <GrooveButton onClick={() => setShowRawJson(false)}>
            <PixelCodeIcon /> Visual Editor
          </GrooveButton>
        </div>
        <div className="relative">
          <DebouncedTextarea className="min-h-[160px]" style={monoStyle} value={value} onChange={onChange} disabled={disabled} />
          <ExpandButton onClick={() => setExpandDialog(true)} />
        </div>
        <ExpandableTextDialog open={expandDialog} onOpenChange={setExpandDialog} title="Post-Call Analysis Fields (JSON)" value={value} onChange={onChange} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <FieldTitle>Post-Call Analysis Fields</FieldTitle>
        <GrooveButton onClick={() => setShowRawJson(true)}>
          <PixelCodeIcon /> Raw JSON
        </GrooveButton>
      </div>
      {fields.length === 0 && <p className="text-muted-foreground" style={subtitleStyle}>No fields configured.</p>}
      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={index} className="groove-border bg-sidebar p-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <GripVertical className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground flex-shrink-0" style={subtitleStyle}>#{index + 1}</span>
              <div className="flex-1" />
              <button type="button" className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center cursor-pointer" onClick={() => moveField(index, -1)} disabled={disabled || index === 0} title="Move up">
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" style={{ imageRendering: 'pixelated' }}><rect x="7" y="3" width="2" height="10" /><rect x="5" y="5" width="2" height="2" /><rect x="3" y="7" width="2" height="2" /><rect x="9" y="5" width="2" height="2" /><rect x="11" y="7" width="2" height="2" /></svg>
              </button>
              <button type="button" className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center cursor-pointer" onClick={() => moveField(index, 1)} disabled={disabled || index === fields.length - 1} title="Move down">
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" style={{ imageRendering: 'pixelated' }}><rect x="7" y="3" width="2" height="10" /><rect x="5" y="9" width="2" height="2" /><rect x="3" y="7" width="2" height="2" /><rect x="9" y="9" width="2" height="2" /><rect x="11" y="7" width="2" height="2" /></svg>
              </button>
              <button type="button" className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center cursor-pointer" onClick={() => removeField(index)} disabled={disabled} title="Delete field">
                <PixelTrashIcon />
              </button>
            </div>
            <div className="space-y-2">
              <div className="space-y-1">
                <span className="text-muted-foreground" style={subtitleStyle}>Name</span>
                <Input className="h-8" style={monoStyle} placeholder="e.g. call_result" value={field.name} onChange={(e) => updateField(index, { name: e.target.value })} disabled={disabled} />
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground" style={subtitleStyle}>Type</span>
                <StandardSelect
                  value={field.type}
                  onChange={(v) => {
                    const patch: Partial<AnalysisField> = { type: v as AnalysisField['type'] };
                    if (v === 'enum' && !field.choices?.length) patch.choices = [''];
                    if (v !== 'enum') patch.choices = undefined;
                    updateField(index, patch);
                  }}
                  options={[{ value: 'string', label: 'Text' }, { value: 'enum', label: 'Multiple Choice' }, { value: 'boolean', label: 'Yes / No' }]}
                  disabled={disabled}
                />
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-muted-foreground" style={subtitleStyle}>Description</span>
              <Input className="h-8" style={monoStyle} placeholder="What should the AI extract?" value={field.description} onChange={(e) => updateField(index, { description: e.target.value })} disabled={disabled} />
            </div>
            {field.type === 'enum' && (
              <div className="space-y-1.5">
                <span className="text-muted-foreground" style={subtitleStyle}>Choices</span>
                {(field.choices || []).map((choice, ci) => (
                  <div key={ci} className="flex items-center gap-1.5">
                    <Input className="h-8 flex-1" style={monoStyle} placeholder={`Option ${ci + 1}`} value={choice} onChange={(e) => updateChoice(index, ci, e.target.value)} disabled={disabled} />
                    <button type="button" className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center cursor-pointer" onClick={() => removeChoice(index, ci)} disabled={disabled} title="Delete choice"><PixelTrashIcon /></button>
                  </div>
                ))}
                <GrooveButton onClick={() => addChoice(index)} disabled={disabled}>
                  <PixelPlusIcon /> Add Choice
                </GrooveButton>
              </div>
            )}
          </div>
        ))}
      </div>
      <Button type="button" variant="default" size="sm" className="w-full h-8 gap-1.5 groove-border" style={monoStyle} onClick={addField} disabled={disabled}>
        <PixelPlusIcon /> Add Field
      </Button>
    </div>
  );
});
PostCallAnalysisFieldsEditor.displayName = 'PostCallAnalysisFieldsEditor';

// ── STT Config Visual Editor ──
const SttConfigEditor = memo(({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) => {
  const [showRaw, setShowRaw] = useState(false);
  const [expandDialog, setExpandDialog] = useState(false);
  const parsed = useMemo(() => { try { return JSON.parse(value); } catch { return { provider: 'deepgram', endpointing_ms: 1000 }; } }, [value]);
  const update = useCallback((patch: Record<string, unknown>) => onChange(JSON.stringify({ ...parsed, ...patch }, null, 2)), [parsed, onChange]);

  if (showRaw) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <FieldTitle>Custom STT Config</FieldTitle>
          <GrooveButton onClick={() => setShowRaw(false)}>
            <PixelCodeIcon /> Visual Editor
          </GrooveButton>
        </div>
        <div className="relative">
          <DebouncedTextarea className="min-h-[160px]" style={monoStyle} value={value} onChange={onChange} disabled={disabled} />
          <ExpandButton onClick={() => setExpandDialog(true)} />
        </div>
        <ExpandableTextDialog open={expandDialog} onOpenChange={setExpandDialog} title="Custom STT Config (JSON)" value={value} onChange={onChange} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <FieldTitle>Custom STT Config</FieldTitle>
        <GrooveButton onClick={() => setShowRaw(true)}>
          <PixelCodeIcon /> Raw JSON
        </GrooveButton>
      </div>
      <div className="groove-border bg-sidebar p-3 space-y-3">
        <div className="space-y-1">
          <span className="text-muted-foreground" style={subtitleStyle}>Provider</span>
          <StandardSelect value={parsed.provider || 'deepgram'} onChange={(v) => update({ provider: v })} options={[{ value: 'deepgram', label: 'Deepgram' }, { value: 'custom', label: 'Custom' }]} disabled={disabled} />
        </div>
        <div className="space-y-1">
          <span className="text-muted-foreground" style={subtitleStyle}>Endpointing (ms)</span>
          <Input className="h-8" style={monoStyle} type="number" value={parsed.endpointing_ms ?? 1000} onChange={(e) => update({ endpointing_ms: Number(e.target.value) })} disabled={disabled} />
        </div>
      </div>
    </div>
  );
});
SttConfigEditor.displayName = 'SttConfigEditor';

// ── PII Config Visual Editor ──
const PII_MODES = [{ value: 'post_call', label: 'Post Call' }, { value: 'real_time', label: 'Real Time' }, { value: 'none', label: 'None' }];
const PII_CATEGORIES = ['credit_card', 'ssn', 'phone_number', 'email', 'date_of_birth', 'address', 'name'];

const PiiConfigEditor = memo(({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) => {
  const [showRaw, setShowRaw] = useState(false);
  const [expandDialog, setExpandDialog] = useState(false);
  const parsed = useMemo(() => { try { return JSON.parse(value); } catch { return { mode: 'post_call', categories: [] }; } }, [value]);
  const update = useCallback((patch: Record<string, unknown>) => onChange(JSON.stringify({ ...parsed, ...patch }, null, 2)), [parsed, onChange]);
  const toggleCategory = useCallback((cat: string) => { const cats: string[] = parsed.categories || []; const next = cats.includes(cat) ? cats.filter((c: string) => c !== cat) : [...cats, cat]; update({ categories: next }); }, [parsed, update]);

  if (showRaw) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <FieldTitle>PII Config</FieldTitle>
          <GrooveButton onClick={() => setShowRaw(false)}>
            <PixelCodeIcon /> Visual Editor
          </GrooveButton>
        </div>
        <div className="relative">
          <DebouncedTextarea className="min-h-[160px]" style={monoStyle} value={value} onChange={onChange} disabled={disabled} />
          <ExpandButton onClick={() => setExpandDialog(true)} />
        </div>
        <ExpandableTextDialog open={expandDialog} onOpenChange={setExpandDialog} title="PII Config (JSON)" value={value} onChange={onChange} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <FieldTitle>PII Config</FieldTitle>
        <GrooveButton onClick={() => setShowRaw(true)}>
          <PixelCodeIcon /> Raw JSON
        </GrooveButton>
      </div>
      <div className="groove-border bg-sidebar p-3 space-y-3">
        <div className="space-y-1">
          <span className="text-muted-foreground" style={subtitleStyle}>Mode</span>
          <StandardSelect value={parsed.mode || 'post_call'} onChange={(v) => update({ mode: v })} options={PII_MODES} disabled={disabled} />
        </div>
        <div className="space-y-1.5">
          <span className="text-muted-foreground" style={subtitleStyle}>Categories to Mask</span>
          <div className="flex flex-wrap gap-1.5">
            {PII_CATEGORIES.map(cat => {
              const active = (parsed.categories || []).includes(cat);
              return (
                <button key={cat} type="button" className={`px-2 py-1 text-[11px] font-mono uppercase tracking-wide transition-colors groove-border ${active ? 'bg-primary/20 text-primary' : 'bg-card text-muted-foreground hover:text-foreground'}`} onClick={() => toggleCategory(cat)} disabled={disabled}>
                  {cat.replace(/_/g, ' ')}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});
PiiConfigEditor.displayName = 'PiiConfigEditor';

// ── Voicemail Option Visual Editor ──
const VoicemailEditor = memo(({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) => {
  const [showRaw, setShowRaw] = useState(false);
  const [expandDialog, setExpandDialog] = useState(false);
  const parsed = useMemo(() => { try { return JSON.parse(value); } catch { return { action: { type: 'hangup' } }; } }, [value]);
  const actionType = parsed?.action?.type || 'hangup';
  const voicemailMessage = parsed?.action?.voicemail_message || '';
  const updateAction = useCallback((type: string, msg?: string) => { const action: Record<string, unknown> = { type }; if (type === 'leave_voicemail' && msg !== undefined) action.voicemail_message = msg; onChange(JSON.stringify({ ...parsed, action }, null, 2)); }, [parsed, onChange]);

  if (showRaw) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <FieldTitle>Voicemail Option</FieldTitle>
          <GrooveButton onClick={() => setShowRaw(false)}>
            <PixelCodeIcon /> Visual Editor
          </GrooveButton>
        </div>
        <div className="relative">
          <DebouncedTextarea className="min-h-[160px]" style={monoStyle} value={value} onChange={onChange} disabled={disabled} />
          <ExpandButton onClick={() => setExpandDialog(true)} />
        </div>
        <ExpandableTextDialog open={expandDialog} onOpenChange={setExpandDialog} title="Voicemail Option (JSON)" value={value} onChange={onChange} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <FieldTitle>Voicemail Option</FieldTitle>
          <FieldSubtitle>What happens when the call goes to voicemail.</FieldSubtitle>
        </div>
        <GrooveButton onClick={() => setShowRaw(true)}>
          <PixelCodeIcon /> Raw JSON
        </GrooveButton>
      </div>
      <div className="groove-border bg-sidebar p-3 space-y-3">
        <div className="space-y-1">
          <span className="text-muted-foreground" style={subtitleStyle}>Action</span>
          <StandardSelect value={actionType} onChange={(v) => updateAction(v, v === 'leave_voicemail' ? voicemailMessage : undefined)} options={[{ value: 'hangup', label: 'Hang Up' }, { value: 'leave_voicemail', label: 'Leave Voicemail' }, { value: 'ignore', label: 'Ignore' }]} disabled={disabled} />
        </div>
        {actionType === 'leave_voicemail' && (
          <div className="space-y-1">
            <span className="text-muted-foreground" style={subtitleStyle}>Voicemail Message</span>
            <Input className="h-8" style={monoStyle} placeholder="Message to leave..." value={voicemailMessage} onChange={(e) => updateAction('leave_voicemail', e.target.value)} disabled={disabled} />
          </div>
        )}
      </div>
    </div>
  );
});
VoicemailEditor.displayName = 'VoicemailEditor';

// ── DTMF Options Visual Editor ──
const DtmfEditor = memo(({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) => {
  const [showRaw, setShowRaw] = useState(false);
  const [expandDialog, setExpandDialog] = useState(false);
  const parsed = useMemo(() => { try { return JSON.parse(value); } catch { return {}; } }, [value]);
  const entries = Object.entries(parsed) as [string, { description?: string }][];
  const addEntry = useCallback(() => { const n = { ...parsed, '1': { description: '' } }; onChange(JSON.stringify(n, null, 2)); }, [parsed, onChange]);
  const removeEntry = useCallback((key: string) => { const n = { ...parsed }; delete n[key]; onChange(JSON.stringify(n, null, 2)); }, [parsed, onChange]);
  const updateEntry = useCallback((oldKey: string, newKey: string, desc: string) => { const n: Record<string, unknown> = {}; for (const [k, v] of Object.entries(parsed)) { if (k === oldKey) n[newKey] = { description: desc }; else n[k] = v; } onChange(JSON.stringify(n, null, 2)); }, [parsed, onChange]);

  if (showRaw) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <FieldTitle>DTMF Options</FieldTitle>
          <GrooveButton onClick={() => setShowRaw(false)}>
            <PixelCodeIcon /> Visual Editor
          </GrooveButton>
        </div>
        <div className="relative">
          <DebouncedTextarea className="min-h-[160px]" style={monoStyle} value={value} onChange={onChange} disabled={disabled} />
          <ExpandButton onClick={() => setExpandDialog(true)} />
        </div>
        <ExpandableTextDialog open={expandDialog} onOpenChange={setExpandDialog} title="DTMF Options (JSON)" value={value} onChange={onChange} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <FieldTitle>DTMF Options</FieldTitle>
          <FieldSubtitle>Configure keypad responses during the call.</FieldSubtitle>
        </div>
        <GrooveButton onClick={() => setShowRaw(true)}>
          <PixelCodeIcon /> Raw JSON
        </GrooveButton>
      </div>
      <div className="groove-border bg-sidebar p-3 space-y-2">
        {entries.length === 0 && <p className="text-muted-foreground" style={subtitleStyle}>No DTMF keys configured.</p>}
        {entries.map(([key, val]) => (
          <div key={key} className="flex items-center gap-2">
            <Input className="h-8 w-14 text-center" style={monoStyle} value={key} onChange={(e) => updateEntry(key, e.target.value, val?.description || '')} disabled={disabled} placeholder="#" />
            <Input className="h-8 flex-1" style={monoStyle} value={val?.description || ''} onChange={(e) => updateEntry(key, key, e.target.value)} disabled={disabled} placeholder="Description..." />
            <button type="button" className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center cursor-pointer" onClick={() => removeEntry(key)} disabled={disabled} title="Delete key"><PixelTrashIcon /></button>
          </div>
        ))}
        <Button type="button" variant="default" size="sm" className="w-full h-8 gap-1.5 groove-border" style={monoStyle} onClick={addEntry} disabled={disabled}>
          <PixelPlusIcon /> Add Key
        </Button>
      </div>
    </div>
  );
});
DtmfEditor.displayName = 'DtmfEditor';

// ── Tools Visual Editor ──
interface RetellTool { name: string; type: string; description?: string; url?: string; method?: string; timeout_ms?: number; speak_after_execution?: boolean; speak_during_execution?: boolean; execution_message_description?: string; parameters?: unknown; [key: string]: unknown; }

const ToolCard = memo(({ tool, index, disabled, onRemove, onUpdate }: { tool: RetellTool; index: number; disabled?: boolean; onRemove: () => void; onUpdate: (t: RetellTool) => void }) => {
  const [expanded, setExpanded] = useState(false);
  const [showRawTool, setShowRawTool] = useState(false);
  const isSystem = tool.type === 'end_call' || tool.type === 'transfer_call';

  return (
    <div className="groove-border bg-sidebar overflow-hidden">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <button type="button" className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/20 transition-colors">
            <Phone className="w-3.5 h-3.5" />
            <span className="flex-1 truncate text-foreground" style={titleStyle}>{tool.name}</span>
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-border shrink-0">{tool.type === 'end_call' ? 'SYSTEM' : tool.type === 'transfer_call' ? 'TRANSFER' : 'CUSTOM'}</Badge>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-2.5 border-t border-border/50 pt-2.5">
            {isSystem ? (
              <p className="text-muted-foreground" style={subtitleStyle}>Built-in system tool. No configuration needed.</p>
            ) : showRawTool ? (
              <>
                <div className="flex justify-end">
                  <GrooveButton onClick={() => setShowRawTool(false)}>
                    <PixelCodeIcon /> Visual
                  </GrooveButton>
                </div>
                <DebouncedTextarea className="min-h-[200px]" style={monoStyle} value={JSON.stringify(tool, null, 2)} onChange={(v) => { try { onUpdate(JSON.parse(v)); } catch {} }} disabled={disabled} />
              </>
            ) : (
              <>
                <div className="flex justify-end">
                  <GrooveButton onClick={() => setShowRawTool(true)}>
                    <PixelCodeIcon /> Raw JSON
                  </GrooveButton>
                </div>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <span className="text-muted-foreground" style={subtitleStyle}>Name</span>
                    <Input className="h-8" style={monoStyle} value={tool.name} onChange={(e) => onUpdate({ ...tool, name: e.target.value })} disabled={disabled} />
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground" style={subtitleStyle}>Method</span>
                    <StandardSelect value={tool.method || 'POST'} onChange={(v) => onUpdate({ ...tool, method: v })} options={[{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }, { value: 'PUT', label: 'PUT' }, { value: 'DELETE', label: 'DELETE' }]} disabled={disabled} />
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground" style={subtitleStyle}>Webhook URL</span>
                  <Input className="h-8" style={monoStyle} value={tool.url || ''} onChange={(e) => onUpdate({ ...tool, url: e.target.value })} disabled={disabled} placeholder="https://..." />
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground" style={subtitleStyle}>Description</span>
                  <DebouncedTextarea className="min-h-[60px]" style={monoStyle} value={tool.description || ''} onChange={(v) => onUpdate({ ...tool, description: v })} disabled={disabled} />
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground" style={subtitleStyle}>Timeout (ms)</span>
                  <Input className="h-8 w-24" style={monoStyle} type="number" value={tool.timeout_ms ?? 10000} onChange={(e) => onUpdate({ ...tool, timeout_ms: Number(e.target.value) })} disabled={disabled} />
                </div>
                <div className="flex flex-col gap-2">
                  <ToggleField label="Speak During Execution" subtitle="Agent speaks while the tool runs." checked={!!tool.speak_during_execution} disabled={!!disabled} onChange={(v) => onUpdate({ ...tool, speak_during_execution: v })} />
                  {tool.speak_during_execution && (
                    <div className="space-y-1 pl-1">
                      <span className="text-muted-foreground" style={subtitleStyle}>Execution Message</span>
                      <Input className="h-8" style={monoStyle} value={tool.execution_message_description || ''} onChange={(e) => onUpdate({ ...tool, execution_message_description: e.target.value })} disabled={disabled} placeholder="What should the agent say?" />
                    </div>
                  )}
                  <ToggleField label="Speak After Execution" subtitle="Agent speaks after the tool completes." checked={!!tool.speak_after_execution} disabled={!!disabled} onChange={(v) => onUpdate({ ...tool, speak_after_execution: v })} />
                </div>
              </>
            )}
            {!isSystem && (
              <div className="pt-1">
                <GrooveButton onClick={onRemove} disabled={disabled} variant="destructive">
                  <PixelTrashIcon /> Remove Tool
                </GrooveButton>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});
ToolCard.displayName = 'ToolCard';

export const ToolsEditor = memo(({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) => {
  const [showRaw, setShowRaw] = useState(false);
  const [expandDialog, setExpandDialog] = useState(false);
  const tools: RetellTool[] = useMemo(() => { try { const p = JSON.parse(value); return Array.isArray(p) ? p : []; } catch { return []; } }, [value]);
  const BOOKING_TOOL_NAMES = useMemo(() => new Set(['update-appointment', 'get-available-slots', 'book-appointments', 'cancel-appointments', 'get-contact-appointments']), []);
  const updateTools = useCallback((next: RetellTool[]) => onChange(JSON.stringify(next, null, 2)), [onChange]);
  const removeTool = useCallback((i: number) => updateTools(tools.filter((_, j) => j !== i)), [tools, updateTools]);
  const updateTool = useCallback((i: number, t: RetellTool) => {
    const oldTool = tools[i];
    // When a booking tool's webhook URL changes, sync it to all other booking tools
    if (BOOKING_TOOL_NAMES.has(t.name) && t.url && t.url !== oldTool?.url) {
      updateTools(tools.map((tool, j) => {
        if (j === i) return t;
        if (BOOKING_TOOL_NAMES.has(tool.name)) return { ...tool, url: t.url };
        return tool;
      }));
    } else {
      updateTools(tools.map((tool, j) => j === i ? t : tool));
    }
  }, [tools, updateTools, BOOKING_TOOL_NAMES]);
  const addCustomTool = useCallback(() => {
    updateTools([...tools, { name: 'new_tool', type: 'webhook', description: '', url: '', method: 'POST', timeout_ms: 10000, speak_during_execution: false, speak_after_execution: true }]);
  }, [tools, updateTools]);

  if (showRaw) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <FieldTitle>General Tools</FieldTitle>
          <GrooveButton onClick={() => setShowRaw(false)}>
            <PixelCodeIcon /> Visual Editor
          </GrooveButton>
        </div>
        <div className="relative">
          <DebouncedTextarea className="min-h-[200px]" style={monoStyle} value={value} onChange={onChange} disabled={disabled} />
          <ExpandButton onClick={() => setExpandDialog(true)} />
        </div>
        <ExpandableTextDialog open={expandDialog} onOpenChange={setExpandDialog} title="General Tools (JSON)" value={value} onChange={onChange} />
      </div>
    );
  }

  return (
    <FieldGroup title="General Tools" subtitle="Webhook tools the agent can call during a conversation.">
      <div className="flex items-center justify-end">
        <GrooveButton onClick={() => setShowRaw(true)}>
          <PixelCodeIcon /> Raw JSON
        </GrooveButton>
      </div>
      <div className="space-y-2">
        {tools.map((tool, i) => (
          <ToolCard key={i} tool={tool} index={i} disabled={disabled} onRemove={() => removeTool(i)} onUpdate={(t) => updateTool(i, t)} />
        ))}
      </div>
      <Button type="button" variant="default" size="sm" className="w-full h-8 gap-1.5 groove-border" style={monoStyle} onClick={addCustomTool} disabled={disabled}>
        <PixelPlusIcon /> Add Tool
      </Button>
    </FieldGroup>
  );
});
ToolsEditor.displayName = 'ToolsEditor';

// ── Knowledge Base Picker ──
const KnowledgeBasePicker = memo(({ clientId, selectedIds, onChange, disabled }: { clientId: string; selectedIds: string; onChange: (ids: string) => void; disabled?: boolean }) => {
  const { listKnowledgeBases, createKnowledgeBase } = useRetellApi(clientId);
  const [kbs, setKbs] = useState<RetellKnowledgeBase[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const selected = useMemo(() => new Set(selectedIds.split(',').map(s => s.trim()).filter(Boolean)), [selectedIds]);
  const load = useCallback(async () => { if (loaded) return; setLoading(true); try { const res = await listKnowledgeBases(); setKbs(res); setLoaded(true); } catch (e: any) { toast.error(e.message); } finally { setLoading(false); } }, [listKnowledgeBases, loaded]);
  const toggle = useCallback((id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(Array.from(next).join(', '));
  }, [selected, onChange]);
  const handleCreate = useCallback(async () => {
    try {
      setLoading(true);
      const kb = await createKnowledgeBase({ knowledge_base_name: `KB ${new Date().toISOString().slice(0, 10)}` });
      toast.success(`Created: ${kb.knowledge_base_name}`);
      setKbs(prev => [...prev, kb]);
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }, [createKnowledgeBase]);

  return (
    <FieldGroup title="Knowledge Bases" subtitle="Connect knowledge bases for the agent to reference.">
      <div className="flex gap-2 flex-wrap">
        <GrooveButton onClick={load} disabled={disabled || loading}>
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} /> {loaded ? 'Refresh' : 'Load'}
        </GrooveButton>
        <GrooveButton onClick={handleCreate} disabled={disabled || loading}>
          <PixelPlusIcon /> Create New
        </GrooveButton>
      </div>
      {loading && !loaded ? (
        <div className="flex items-center gap-2 text-muted-foreground py-2" style={monoStyle}><Loader2 className="h-3 w-3 animate-spin" /> Loading...</div>
      ) : kbs.length === 0 ? (
        <p className="text-muted-foreground py-1" style={subtitleStyle}>No knowledge bases found. Click + to create one.</p>
      ) : (
        <div className="space-y-1">
          {kbs.map(kb => (
            <button key={kb.knowledge_base_id} type="button" className="w-full flex items-center gap-2 px-2 py-1.5 groove-border bg-card hover:bg-muted/40 text-left transition-colors" onClick={() => toggle(kb.knowledge_base_id)} disabled={disabled}>
              <Checkbox checked={selected.has(kb.knowledge_base_id)} tabIndex={-1} className="flex-shrink-0" />
              <BookOpen className="h-3 w-3 text-primary flex-shrink-0" />
              <span className="text-foreground truncate flex-1" style={monoStyle}>{kb.knowledge_base_name}</span>
              <span className="text-muted-foreground" style={subtitleStyle}>{kb.status}</span>
            </button>
          ))}
        </div>
      )}
      <DebouncedInput className="h-8" style={monoStyle} placeholder="Or paste KB IDs manually (comma separated)" value={selectedIds} onChange={onChange} disabled={disabled} />
    </FieldGroup>
  );
});
KnowledgeBasePicker.displayName = 'KnowledgeBasePicker';

// ════════════════════════════════════════════════════════════════
// ══ MAIN COMPONENT ═══════════════════════════════════════════
// ════════════════════════════════════════════════════════════════

export const VoiceRetellSettings: React.FC<VoiceRetellSettingsProps> = memo(({
  clientId,
  settings,
  onChange,
  disabled = false,
  bookingEnabled = true,
  advancedExpanded = false,
  onAdvancedExpandedChange,
  renderMode = 'all',
}) => {
  const handleChange = useCallback(<K extends keyof RetellVoiceSettings>(key: K) =>
    (value: RetellVoiceSettings[K]) => onChange({ [key]: value }),
  [onChange]);
  const [expandSuccessPrompt, setExpandSuccessPrompt] = useState(false);
  const [expandSummaryPrompt, setExpandSummaryPrompt] = useState(false);
  const [expandSentimentPrompt, setExpandSentimentPrompt] = useState(false);
  const [showAdvancedConfirm, setShowAdvancedConfirm] = useState(false);

  const showBasic = renderMode === 'all' || renderMode === 'basic';
  const showAdvanced = renderMode === 'all' || renderMode === 'advanced';

  return (
    <div className="space-y-6">
      {showBasic && (
        <>
          <div className="space-y-4" data-subsection-key="settings_general">
            <FieldGroup title="Voice" subtitle="Choose a voice for your AI setter. Star-rated voices are optimized for natural phone conversations.">
              <RetellVoiceSelector
                clientId={clientId}
                value={settings.voice_id}
                onChange={handleChange('voice_id')}
                disabled={disabled}
              />
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <FieldGroup title="Volume" subtitle="Output volume of the setter's voice. 1.0 is default.">
              <DebouncedNumberInput className="h-8" style={monoStyle} step="0.01" min={0} max={2} value={settings.volume} onChange={handleChange('volume')} disabled={disabled} />
            </FieldGroup>
          </div>

          <div className="border-t border-dashed border-border" />

          <div className="space-y-4" data-subsection-key="settings_general">
            <FieldGroup title="Language" subtitle="What language should the setter speak?">
              <StandardSelect
                value={settings.language}
                onChange={handleChange('language')}
                options={LANGUAGES}
                disabled={disabled}
              />
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <FieldGroup title="Start Speaker" subtitle="Who should start speaking first — the setter or the user?">
              <StandardSelect
                value={settings.start_speaker}
                onChange={handleChange('start_speaker')}
                options={START_SPEAKERS}
                disabled={disabled}
              />
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <ToggleField
              label="Custom Begin Message"
              subtitle="Enable to set a fixed opening message. When disabled, the setter uses dynamic message behavior."
              checked={!!settings.begin_message}
              disabled={disabled}
              onChange={(val) => {
                if (!val) handleChange('begin_message')('');
                else handleChange('begin_message')('Hey, how are you doing today?');
              }}
            />
            {!!settings.begin_message && (
              <FieldGroup title="Begin Message" subtitle="The first thing the setter says when the call starts.">
                <DebouncedInput className="h-8" style={monoStyle} placeholder="Enter the custom message the setter speaks first" value={settings.begin_message} onChange={handleChange('begin_message')} disabled={disabled} />
              </FieldGroup>
            )}

            <div className="border-t border-dashed border-border" />

            <FieldGroup title="Ambient Sound" subtitle="Add background ambiance to make the call feel more natural.">
              <StandardSelect value={settings.ambient_sound || 'none'} onChange={handleChange('ambient_sound')} options={AMBIENT_SOUNDS} disabled={disabled} />
            </FieldGroup>
            {/* Ambient Volume removed */}
          </div>
        </>
      )}

      {showAdvanced && (
        <>
      {/* ═══ ADVANCED SETTINGS GATE ═══ */}
      {!advancedExpanded ? (
        <>
          <div className="border-t border-dashed border-border" />
          <div className="groove-border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5 text-foreground shrink-0" fill="currentColor" style={{ imageRendering: 'pixelated' }}>
                <rect x="3" y="3" width="2" height="2" />
                <rect x="5" y="5" width="2" height="2" />
                <rect x="7" y="3" width="2" height="2" />
                <rect x="5" y="7" width="2" height="2" />
                <rect x="3" y="7" width="2" height="2" />
                <rect x="7" y="7" width="2" height="2" />
                <rect x="15" y="3" width="2" height="2" />
                <rect x="17" y="5" width="2" height="2" />
                <rect x="19" y="3" width="2" height="2" />
                <rect x="17" y="7" width="2" height="2" />
                <rect x="15" y="7" width="2" height="2" />
                <rect x="19" y="7" width="2" height="2" />
                <rect x="9" y="15" width="2" height="2" />
                <rect x="11" y="17" width="2" height="2" />
                <rect x="13" y="15" width="2" height="2" />
                <rect x="11" y="19" width="2" height="2" />
                <rect x="9" y="19" width="2" height="2" />
                <rect x="13" y="19" width="2" height="2" />
              </svg>
              <span className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '1px' }}>
                Advanced Configuration
              </span>
            </div>

            <p className="text-muted-foreground leading-relaxed" style={subtitleStyle}>
              Access responsiveness, interruption sensitivity, call limits, STT, PII, voicemail, DTMF, tools, post-call analysis, and more. Only edit these if you know what you're doing — incorrect changes may affect how your setter currently performs.
            </p>

            <button
              type="button"
              className="groove-btn w-full !h-9 flex items-center justify-center gap-2"
              style={{ ...monoStyle, textTransform: 'uppercase' }}
              onClick={() => setShowAdvancedConfirm(true)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5 text-foreground" fill="currentColor" style={{ imageRendering: 'pixelated' }}>
                <rect x="7" y="9" width="2" height="2" />
                <rect x="9" y="11" width="2" height="2" />
                <rect x="11" y="13" width="2" height="2" />
                <rect x="13" y="11" width="2" height="2" />
                <rect x="15" y="9" width="2" height="2" />
              </svg>
              Expand Advanced Settings
            </button>
          </div>

          {/* Confirmation Dialog */}
          <Dialog open={showAdvancedConfirm} onOpenChange={setShowAdvancedConfirm}>
            <DialogContent className="max-w-md !p-0">
              <DialogHeader>
                <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '22px', letterSpacing: '1px' }}>
                  ADVANCED SETTINGS
                </DialogTitle>
              </DialogHeader>
              <div className="p-6">
                <p className="text-muted-foreground leading-relaxed mb-5" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
                  These are advanced voice agent settings. Changing them incorrectly may affect how your setter currently performs. Only edit if you know what you're doing.
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="default"
                    className="flex-1"
                    onClick={() => setShowAdvancedConfirm(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => {
                      setShowAdvancedConfirm(false);
                      onAdvancedExpandedChange?.(true);
                    }}
                  >
                    I Understand, Expand
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <>
          <div className="border-t border-dashed border-border" />

          {/* Collapse button */}
          <div className="groove-border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5 text-foreground shrink-0" fill="currentColor" style={{ imageRendering: 'pixelated' }}>
                <rect x="3" y="3" width="2" height="2" />
                <rect x="5" y="5" width="2" height="2" />
                <rect x="7" y="3" width="2" height="2" />
                <rect x="5" y="7" width="2" height="2" />
                <rect x="3" y="7" width="2" height="2" />
                <rect x="7" y="7" width="2" height="2" />
                <rect x="15" y="3" width="2" height="2" />
                <rect x="17" y="5" width="2" height="2" />
                <rect x="19" y="3" width="2" height="2" />
                <rect x="17" y="7" width="2" height="2" />
                <rect x="15" y="7" width="2" height="2" />
                <rect x="19" y="7" width="2" height="2" />
                <rect x="9" y="15" width="2" height="2" />
                <rect x="11" y="17" width="2" height="2" />
                <rect x="13" y="15" width="2" height="2" />
                <rect x="11" y="19" width="2" height="2" />
                <rect x="9" y="19" width="2" height="2" />
                <rect x="13" y="19" width="2" height="2" />
              </svg>
              <span className="text-foreground uppercase flex-1" style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '1px' }}>
                Advanced Configuration
              </span>
            </div>

            <button
              type="button"
              className="groove-btn w-full !h-9 flex items-center justify-center gap-2"
              style={{ ...monoStyle, textTransform: 'uppercase' }}
              onClick={() => onAdvancedExpandedChange?.(false)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5 text-foreground" fill="currentColor" style={{ imageRendering: 'pixelated' }}>
                <rect x="7" y="13" width="2" height="2" />
                <rect x="9" y="11" width="2" height="2" />
                <rect x="11" y="9" width="2" height="2" />
                <rect x="13" y="11" width="2" height="2" />
                <rect x="15" y="13" width="2" height="2" />
              </svg>
              Collapse Advanced Settings
            </button>
          </div>

          <div className="border-t border-dashed border-border" />

          {/* ═══ VOICE SPEED & TEMPERATURE (moved from basic) ═══ */}
          <div className="space-y-4" data-subsection-key="settings_followup">
            <FieldGroup title="Voice Speed" subtitle="How fast the setter speaks. 1.0 is normal speed.">
              <DebouncedNumberInput className="h-8" style={monoStyle} step="0.01" min={0.5} max={2} value={settings.voice_speed} onChange={handleChange('voice_speed')} disabled={disabled} />
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <FieldGroup title="Voice Temperature" subtitle="Controls the randomness and expressiveness of the voice.">
              <DebouncedNumberInput className="h-8" style={monoStyle} step="0.01" min={0} max={2} value={settings.voice_temperature} onChange={handleChange('voice_temperature')} disabled={disabled} />
            </FieldGroup>
            {/* "High Priority LLM" (model_high_priority) moved to the "Fast Tier"
                toggle next to the AI Model selector in AgentConfigBuilder. */}
          </div>

          <div className="border-t border-dashed border-border" />

          {/* ═══ SPEECH SETTINGS ═══ */}
          <div className="space-y-4" data-subsection-key="settings_followup">
            <FieldGroup title="Begin Message Delay" subtitle="How long to wait before the setter speaks the first message.">
              <div className="flex items-center gap-2">
                <DebouncedNumberInput min={0} step="0.1" className="h-8 w-24" style={monoStyle} value={settings.begin_message_delay_ms} onChange={handleChange('begin_message_delay_ms')} transform={msToSec} disabled={disabled} />
                <span className="text-muted-foreground" style={monoStyle}>seconds</span>
              </div>
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <SliderField label="Responsiveness" subtitle="How quickly the setter responds. Higher means faster." value={settings.responsiveness} min={0} max={1} step={0.01} disabled={disabled} onChange={handleChange('responsiveness')} />

            <div className="border-t border-dashed border-border" />

            <SliderField label="Interruption Sensitivity" subtitle="How easily the user can interrupt the setter mid-sentence." value={settings.interruption_sensitivity} min={0} max={1} step={0.01} disabled={disabled} onChange={handleChange('interruption_sensitivity')} />

            <div className="border-t border-dashed border-border" />

            <ToggleField label="Backchannel" subtitle='Allows listening fillers like "uh-huh" and "I see" for a natural feel.' checked={settings.enable_backchannel} disabled={disabled} onChange={handleChange('enable_backchannel')} />
            {settings.enable_backchannel && (
              <>
                <div className="border-t border-dashed border-border" />
                <SliderField label="Backchannel Frequency" subtitle="How often the setter uses listening fillers." value={settings.backchannel_frequency} min={0} max={1} step={0.01} disabled={disabled} onChange={(v) => onChange({ backchannel_frequency: v })} />
              </>
            )}

            <div className="border-t border-dashed border-border" />

            <ToggleField label="Normalize for Speech" subtitle="Formats dates, abbreviations, and numbers for more natural speech output." checked={settings.normalize_for_speech} disabled={disabled} onChange={handleChange('normalize_for_speech')} />
          </div>

          <div className="border-t border-dashed border-border" />

          {/* ═══ CALL SETTINGS ═══ */}
          <div className="space-y-4" data-subsection-key="settings_followup">
            <FieldGroup title="Max Call Duration" subtitle="Maximum length of the call before it automatically ends.">
              <div className="flex items-center gap-2">
                <DebouncedNumberInput min={1} max={120} className="h-8 w-24" style={monoStyle} value={settings.max_call_duration_ms} onChange={handleChange('max_call_duration_ms')} transform={msToMin} disabled={disabled} />
                <span className="text-muted-foreground" style={monoStyle}>minutes</span>
              </div>
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <FieldGroup title="Webhook Timeout" subtitle="How long to wait for a webhook response before timing out.">
              <div className="flex items-center gap-2">
                <DebouncedNumberInput min={1} step="0.1" className="h-8 w-24" style={monoStyle} value={settings.webhook_timeout_ms} onChange={handleChange('webhook_timeout_ms')} transform={msToSec} disabled={disabled} />
                <span className="text-muted-foreground" style={monoStyle}>seconds</span>
              </div>
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <FieldGroup title="Reminder Trigger" subtitle="How long the setter waits in silence before sending a reminder.">
              <div className="flex items-center gap-2">
                <DebouncedNumberInput min={0} step="0.1" className="h-8 w-24" style={monoStyle} value={settings.reminder_trigger_ms} onChange={handleChange('reminder_trigger_ms')} transform={msToSec} disabled={disabled} />
                <span className="text-muted-foreground" style={monoStyle}>seconds</span>
              </div>
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <FieldGroup title="Max Reminders" subtitle="Maximum number of reminders the setter can send per call.">
              <DebouncedNumberInput min={0} max={10} className="h-8 w-24" style={monoStyle} value={settings.reminder_max_count} onChange={handleChange('reminder_max_count')} disabled={disabled} />
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <FieldGroup title="Data Storage Setting" subtitle="Controls what call data is stored after the conversation.">
              <DebouncedInput className="h-8" style={monoStyle} placeholder="e.g. everything" value={settings.data_storage_setting} onChange={handleChange('data_storage_setting')} disabled={disabled} />
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <FieldGroup title="Vocab Specialization" subtitle="Domain-specific vocabulary optimization for transcription.">
              <DebouncedInput className="h-8" style={monoStyle} placeholder="e.g. general" value={settings.vocab_specialization} onChange={handleChange('vocab_specialization')} disabled={disabled} />
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <ToggleField label="End on Silence" subtitle="Automatically end the call after a period of silence." checked={settings.end_call_after_silence_enabled} disabled={disabled} onChange={handleChange('end_call_after_silence_enabled')} />
            {settings.end_call_after_silence_enabled && (
              <>
                <div className="border-t border-dashed border-border" />
                <FieldGroup title="Silence Timeout" subtitle="How long to wait in silence before ending the call.">
                  <div className="flex items-center gap-2">
                    <DebouncedNumberInput min={1} step="0.1" className="h-8 w-24" style={monoStyle} value={settings.end_call_after_silence_ms} onChange={handleChange('end_call_after_silence_ms')} transform={msToSec} disabled={disabled} />
                    <span className="text-muted-foreground" style={monoStyle}>seconds</span>
                  </div>
                </FieldGroup>
              </>
            )}

            <div className="border-t border-dashed border-border" />

            <FieldGroup title="STT Mode" subtitle="Speech-to-text accuracy mode for transcription.">
              <StandardSelect value={settings.stt_mode || 'accurate'} onChange={handleChange('stt_mode')} options={STT_MODES} disabled={disabled} />
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <SttConfigEditor value={settings.custom_stt_config} onChange={handleChange('custom_stt_config')} disabled={disabled} />

            <div className="border-t border-dashed border-border" />

            <PiiConfigEditor value={settings.pii_config} onChange={handleChange('pii_config')} disabled={disabled} />
          </div>

          <div className="border-t border-dashed border-border" />

          {/* ═══ TOOLS & KNOWLEDGE ═══ */}
          <div className="space-y-4" data-subsection-key="settings_features">
            <ToolsEditor value={settings.general_tools} onChange={handleChange('general_tools')} disabled={disabled} />

            <div className="border-t border-dashed border-border" />

            <VoicemailEditor value={settings.voicemail_option} onChange={handleChange('voicemail_option')} disabled={disabled} />

            <div className="border-t border-dashed border-border" />

            <DtmfEditor value={settings.user_dtmf_options} onChange={handleChange('user_dtmf_options')} disabled={disabled} />
          </div>

          <div className="border-t border-dashed border-border" />

          {/* ═══ POST CALL ANALYSIS ═══ */}
          <div className="space-y-4" data-subsection-key="settings_features">
            <FieldGroup title="Post-Call Analysis Model" subtitle="AI model used to analyze the call after it ends.">
              <DebouncedInput className="h-8" style={monoStyle} placeholder="e.g. gpt-4.1" value={settings.post_call_analysis_model} onChange={handleChange('post_call_analysis_model')} disabled={disabled} />
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <FieldGroup title="Successful Call Prompt" subtitle="Prompt used to determine if the call was successful.">
              <div className="relative">
                <DebouncedTextarea className="min-h-[90px]" style={monoStyle} value={settings.analysis_successful_prompt} onChange={handleChange('analysis_successful_prompt')} disabled={disabled} />
                <ExpandButton onClick={() => setExpandSuccessPrompt(true)} />
              </div>
              <ExpandableTextDialog open={expandSuccessPrompt} onOpenChange={setExpandSuccessPrompt} title="Successful Call Prompt" value={settings.analysis_successful_prompt} onChange={handleChange('analysis_successful_prompt')} />
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <FieldGroup title="Summary Prompt" subtitle="Prompt used to generate the call summary.">
              <div className="relative">
                <DebouncedTextarea className="min-h-[90px]" style={monoStyle} value={settings.analysis_summary_prompt} onChange={handleChange('analysis_summary_prompt')} disabled={disabled} />
                <ExpandButton onClick={() => setExpandSummaryPrompt(true)} />
              </div>
              <ExpandableTextDialog open={expandSummaryPrompt} onOpenChange={setExpandSummaryPrompt} title="Summary Prompt" value={settings.analysis_summary_prompt} onChange={handleChange('analysis_summary_prompt')} />
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <FieldGroup title="User Sentiment Prompt" subtitle="Prompt used to evaluate the user's mood and satisfaction.">
              <div className="relative">
                <DebouncedTextarea className="min-h-[90px]" style={monoStyle} value={settings.analysis_user_sentiment_prompt} onChange={handleChange('analysis_user_sentiment_prompt')} disabled={disabled} />
                <ExpandButton onClick={() => setExpandSentimentPrompt(true)} />
              </div>
              <ExpandableTextDialog open={expandSentimentPrompt} onOpenChange={setExpandSentimentPrompt} title="User Sentiment Prompt" value={settings.analysis_user_sentiment_prompt} onChange={handleChange('analysis_user_sentiment_prompt')} />
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <PostCallAnalysisFieldsEditor value={settings.post_call_analysis_data} onChange={handleChange('post_call_analysis_data')} disabled={disabled} />
          </div>

          <div className="border-t border-dashed border-border" />

          {/* ═══ WEBHOOK & EXTRAS ═══ */}
          <div className="space-y-4" data-subsection-key="settings_features">
            <FieldGroup title="Post-Call Webhook URL" subtitle="This webhook is automatically set on all agents to capture call data.">
              <CopyableField value={`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/retell-call-analysis-webhook`} />
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <FieldGroup title="Boosted Keywords" subtitle="Comma-separated keywords to boost in transcription accuracy.">
              <DebouncedInput className="h-8" style={monoStyle} placeholder="Comma-separated keywords" value={settings.boosted_keywords} onChange={handleChange('boosted_keywords')} disabled={disabled} />
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <FieldGroup title="Pronunciation Dictionary" subtitle="Custom pronunciations for specific words (one per line: word:pronunciation).">
              <DebouncedTextarea className="min-h-[80px]" style={monoStyle} placeholder={'word:pronunciation\nSaaS:sass'} value={settings.pronunciation_dictionary} onChange={handleChange('pronunciation_dictionary')} disabled={disabled} />
            </FieldGroup>

            <div className="border-t border-dashed border-border" />

            <ToggleField label="Opt Out Sensitive Data Storage" subtitle="Prevents storage of sensitive data from call recordings and transcripts." checked={settings.opt_out_sensitive_data_storage} disabled={disabled} onChange={handleChange('opt_out_sensitive_data_storage')} />
          </div>
        </>
      )}
      </>
      )}
    </div>
  );
});
VoiceRetellSettings.displayName = 'VoiceRetellSettings';
