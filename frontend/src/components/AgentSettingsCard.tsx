import React, { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Settings, Save, ChevronDown, ChevronUp } from '@/components/icons';
import { AgentSettings } from '@/hooks/useAgentSettings';
import { OpenRouterModelSelector } from '@/components/OpenRouterModelSelector';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type DelayUnit = 'seconds' | 'minutes' | 'hours' | 'days';

function secondsToUnit(totalSeconds: number): { value: number; unit: DelayUnit } {
  if (totalSeconds <= 0) return { value: 0, unit: 'seconds' };
  if (totalSeconds % 86400 === 0) return { value: totalSeconds / 86400, unit: 'days' };
  if (totalSeconds % 3600 === 0) return { value: totalSeconds / 3600, unit: 'hours' };
  if (totalSeconds % 60 === 0) return { value: totalSeconds / 60, unit: 'minutes' };
  return { value: totalSeconds, unit: 'seconds' };
}

function unitToSeconds(value: number, unit: DelayUnit): number {
  switch (unit) {
    case 'days': return value * 86400;
    case 'hours': return value * 3600;
    case 'minutes': return value * 60;
    default: return value;
  }
}
const LLM_OPTIONS = [
  { id: 'openai/gpt-5.2', name: 'GPT-5.2' },
  { id: 'openai/gpt-5', name: 'GPT-5' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast' },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
];

function FollowupDelayField({ totalSeconds, onChange }: { totalSeconds: number; onChange: (seconds: number) => void }) {
  const parsed = useMemo(() => secondsToUnit(totalSeconds), [totalSeconds]);
  const [unit, setUnit] = useState<DelayUnit>(parsed.unit);
  const [displayValue, setDisplayValue] = useState(parsed.value);

  React.useEffect(() => {
    const p = secondsToUnit(totalSeconds);
    setUnit(p.unit);
    setDisplayValue(p.value);
  }, [totalSeconds]);

  const handleValueChange = (val: number) => {
    setDisplayValue(val);
    onChange(unitToSeconds(val, unit));
  };

  const handleUnitChange = (newUnit: DelayUnit) => {
    setUnit(newUnit);
    onChange(unitToSeconds(displayValue, newUnit));
  };

  return (
    <div className="space-y-1.5">
      <Label className="field-text" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>Follow-up Delay</Label>
      <p className="text-muted-foreground" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400, lineHeight: '1.4' }}>
        How long to wait after sending a reply before following up if the lead doesn't respond. Set to 0 to disable follow-ups.
      </p>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          className="h-8 flex-1"
          style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400 }}
          value={displayValue}
          onChange={(e) => handleValueChange(parseInt(e.target.value) || 0)}
        />
        <Select value={unit} onValueChange={(v) => handleUnitChange(v as DelayUnit)}>
          <SelectTrigger className="h-8 w-[120px]" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400 }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="seconds">Seconds</SelectItem>
            <SelectItem value="minutes">Minutes</SelectItem>
            <SelectItem value="hours">Hours</SelectItem>
            <SelectItem value="days">Days</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

interface AgentSettingsCardProps {
  slotId: string;
  settings: AgentSettings;
  onSave: (slotId: string, updates: Partial<AgentSettings>) => Promise<void>;
  isFollowup?: boolean;
}

export const AgentSettingsCard: React.FC<AgentSettingsCardProps> = ({
  slotId,
  settings,
  onSave,
  isFollowup = false,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [localSettings, setLocalSettings] = useState({ ...settings });
  const [saving, setSaving] = useState(false);

  // Sync when settings change externally
  React.useEffect(() => {
    setLocalSettings({ ...settings });
  }, [settings]);

  const hasChanges = JSON.stringify(localSettings) !== JSON.stringify(settings);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(slotId, {
        name: localSettings.name,
        model: localSettings.model,
        response_delay_seconds: localSettings.response_delay_seconds,
        followup_instructions: localSettings.followup_instructions,
        file_processing_enabled: localSettings.file_processing_enabled,
        human_transfer_enabled: localSettings.human_transfer_enabled,
        booking_function_enabled: localSettings.booking_function_enabled,
        booking_prompt: localSettings.booking_prompt,
      });
    } catch {
      // PROMPT-LINT-1: updateSettings throws on a lint refusal (it has already
      // toasted the specifics) — without this catch the button spins forever.
    } finally {
      setSaving(false);
    }
  };

  const selectedModel = LLM_OPTIONS.find(m => m.id === localSettings.model);

  return (
    <div>
      <div className="space-y-4">
          {/* Setter Description */}
          <div className="space-y-1.5">
            <Label className="field-text" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>Setter Description</Label>
            <Input
              type="text"
              className="h-8"
              style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400 }}
              placeholder="e.g. Webinar Engagement Agent"
              value={localSettings.name || ''}
              onChange={(e) => setLocalSettings(s => ({ ...s, name: e.target.value }))}
            />
          </div>

          {/* Model Selection */}
          <div>
            <OpenRouterModelSelector
              value={localSettings.model}
              onChange={(v) => setLocalSettings(s => ({ ...s, model: v }))}
              label="Model"
            />
          </div>

          {/* Delays */}
          <div className="space-y-1.5">
            <Label className="field-text" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>Response Delay (sec)</Label>
            <Input
              type="number"
              min={0}
              className="h-8"
              style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400 }}
              value={localSettings.response_delay_seconds}
              onChange={(e) => setLocalSettings(s => ({ ...s, response_delay_seconds: parseInt(e.target.value) || 0 }))}
            />
          </div>

          {/* Follow-up Delay with unit selector */}
          <FollowupDelayField
            totalSeconds={localSettings.followup_1_delay_seconds}
            onChange={(seconds) => setLocalSettings(s => ({ ...s, followup_1_delay_seconds: seconds }))}
          />

          {/* Follow-up Instructions — only shown when delay > 0 */}
          {localSettings.followup_1_delay_seconds > 0 && (
            <div className="space-y-1.5">
              <Label className="field-text" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>Follow-up Instructions</Label>
              <p className="text-muted-foreground" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400, lineHeight: '1.4' }}>
                Tell the AI how to write follow-ups for this setter. Examples: 'Keep it under one sentence', 'Always ask a question', 'Use casual tone with emojis'
              </p>
              <Textarea
                value={localSettings.followup_instructions || ''}
                onChange={(e) => setLocalSettings(s => ({ ...s, followup_instructions: e.target.value }))}
                placeholder="e.g. Keep it short and casual, always end with a question"
                className="min-h-[80px] text-xs"
                rows={3}
                style={{ fontSize: '12px', fontFamily: "'IBM Plex Mono', monospace" }}
              />
            </div>
          )}

          {/* Toggles */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="field-text" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>File Processing</Label>
              <Switch
                checked={localSettings.file_processing_enabled}
                onCheckedChange={(v) => setLocalSettings(s => ({ ...s, file_processing_enabled: v }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="field-text" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>Human Transfer</Label>
              <Switch
                checked={localSettings.human_transfer_enabled}
                onCheckedChange={(v) => setLocalSettings(s => ({ ...s, human_transfer_enabled: v }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="field-text" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>Booking Function</Label>
              <Switch
                checked={localSettings.booking_function_enabled}
                onCheckedChange={(v) => setLocalSettings(s => ({ ...s, booking_function_enabled: v }))}
              />
            </div>
            {localSettings.booking_function_enabled && (
              <div className="space-y-1.5">
                <Label className="field-text" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>Booking Prompt</Label>
                <Textarea
                  value={localSettings.booking_prompt || ''}
                  onChange={(e) => setLocalSettings(s => ({ ...s, booking_prompt: e.target.value }))}
                  placeholder="Enter booking function prompt..."
                  className="min-h-[80px] text-xs"
                  style={{ fontSize: '12px', fontFamily: "'IBM Plex Mono', monospace" }}
                />
              </div>
            )}
          </div>

          {/* Save */}
           {hasChanges && (
            <Button size="sm" onClick={handleSave} disabled={saving} className="w-full h-8 text-xs">
              <Save className="w-3 h-3 mr-1.5" />
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
           )}
        </div>
    </div>
  );
};
