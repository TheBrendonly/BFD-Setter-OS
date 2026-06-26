import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Trash2, Loader2, Save, X } from '@/components/icons';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const WIDGET_TYPE_LABELS: Record<string, string> = {
  number_card: '🔢 Number Card',
  line: '📈 Line Chart',
  bar_vertical: '📊 Bar Chart (Vertical)',
  bar_horizontal: '📊 Bar Chart (Horizontal)',
  doughnut: '🍩 Donut Chart',
  text: '📝 Text Display',
};

interface CustomMetric {
  id: string;
  name: string;
  prompt: string;
  color: string;
  is_active: boolean;
  widget_type?: string;
  widget_width?: string;
}

interface Suggestion {
  type: string;
  title: string;
  description: string;
}

interface CustomMetricDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metric?: CustomMetric | null;
  onSave: (metric: { name: string; prompt: string; color: string; widget_type?: string; widget_width?: string }) => Promise<void>;
  onDelete?: () => Promise<void> | void;
  // G3-6: presence-only — the OpenRouter key is read server-side by the edge fn.
  hasOpenrouterKey?: boolean;
  clientId?: string;
}

const presetColors = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
];
const DEFAULT_METRIC_COLOR = '#3b82f6';

export function CustomMetricDialog({ 
  open, 
  onOpenChange, 
  metric, 
  onSave,
  onDelete,
  hasOpenrouterKey,
  clientId,
}: CustomMetricDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [color, setColor] = useState(DEFAULT_METRIC_COLOR);
  const [widgetWidth, setWidgetWidth] = useState<string>('half');
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDefaultSelected, setIsDefaultSelected] = useState(false);
  const [customColors, setCustomColors] = useState<string[]>([]);

  // AI suggestion state
  const [step, setStep] = useState<'input' | 'analyzing' | 'choose'>('input');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const isEditing = !!metric;

  const allKnownColors = [...presetColors, ...customColors];
  const isCustomColor = !isDefaultSelected && !allKnownColors.includes(color);

  const selectDefaultSwatch = () => {
    setColor(DEFAULT_METRIC_COLOR);
    setIsDefaultSelected(true);
  };
  const selectColorSwatch = (c: string) => {
    setColor(c);
    setIsDefaultSelected(false);
  };

  const fetchCustomColors = useCallback(async () => {
    if (!clientId) return;
    try {
      const { data } = await (supabase as any)
        .from('clients_public')
        .select('crm_filter_config')
        .eq('id', clientId)
        .single();
      const config = data?.crm_filter_config || {};
      setCustomColors(config.custom_metric_colors || []);
    } catch { /* ignore */ }
  }, [clientId]);

  const saveCustomColors = useCallback(async (colors: string[]) => {
    if (!clientId) return;
    setCustomColors(colors);
    try {
      const { data } = await (supabase as any)
        .from('clients_public')
        .select('crm_filter_config')
        .eq('id', clientId)
        .single();
      const config = data?.crm_filter_config || {};
      await (supabase as any)
        .from('clients')
        .update({ crm_filter_config: { ...config, custom_metric_colors: colors } })
        .eq('id', clientId);
    } catch { /* ignore */ }
  }, [clientId]);

  useEffect(() => { if (open) fetchCustomColors(); }, [open, fetchCustomColors]);

  React.useEffect(() => {
    if (metric) {
      setName(metric.name);
      setPrompt(metric.prompt || '');
      setColor(metric.color);
      setWidgetWidth(metric.widget_width || 'half');
      setIsDefaultSelected(false);
    } else {
      setName('');
      setPrompt('');
      setColor(DEFAULT_METRIC_COLOR);
      setWidgetWidth('half');
      setIsDefaultSelected(false);
    }
    setStep('input');
    setSuggestions([]);
  }, [metric, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim() || !prompt.trim()) {
      toast({ title: "Validation Error", description: "Name and description are required.", variant: "destructive" });
      return;
    }

    if (prompt.trim().length < 15) {
      toast({ title: "Description Too Short", description: "Description must be at least 15 characters.", variant: "destructive" });
      return;
    }

    // Auto-save custom color if needed
    if (isCustomColor && color) {
      const updated = customColors.includes(color) ? customColors : [...customColors, color];
      if (updated.length !== customColors.length) {
        await saveCustomColors(updated);
      }
    }

    // If editing, save directly (keep existing widget_type)
    if (isEditing) {
      setSaving(true);
      try {
        await onSave({ name: name.trim(), prompt: prompt.trim(), color: isDefaultSelected ? DEFAULT_METRIC_COLOR : color, widget_width: widgetWidth });
      } finally {
        setSaving(false);
      }
      return;
    }

    // G3-6: no client-side key read. If no key is configured, save as
    // number_card; otherwise analyze with AI (the edge fn reads the key
    // server-side from client_id).
    if (!hasOpenrouterKey || !clientId) {
      setSaving(true);
      try {
        await onSave({ name: name.trim(), prompt: prompt.trim(), color, widget_type: 'number_card' });
      } finally {
        setSaving(false);
      }
      return;
    }

    // Creating with OpenRouter key → analyze with AI
    setStep('analyzing');
    try {
      const { data, error } = await supabase.functions.invoke('analytics-v2-suggest-widgets', {
        body: { prompt: prompt.trim(), client_id: clientId },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      const aiSuggestions = data?.suggestions || [];
      if (aiSuggestions.length === 0) {
        // Fallback: save as number_card
        await onSave({ name: name.trim(), prompt: prompt.trim(), color, widget_type: 'number_card' });
        return;
      }

      setSuggestions(aiSuggestions);
      setStep('choose');
    } catch (err: any) {
      console.error('AI suggestion error:', err);
      const msg = err.message || '';
      const isKeyError = msg.includes('401') || msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('revoked');
      toast({
        title: isKeyError ? 'OpenRouter API Key Issue' : 'AI Analysis Failed',
        description: isKeyError
          ? 'Your OpenRouter API key appears to be invalid or expired. Please update it on the Credentials page, then try again.'
          : (msg || 'Failed to analyze metric.'),
        variant: 'destructive',
      });
      // Reset back to input step so user can retry — don't auto-save as fallback
      setStep('input');
    }
  };

  const handleChooseWidget = async (widgetType: string) => {
    setSaving(true);
    try {
      await onSave({ name: name.trim(), prompt: prompt.trim(), color, widget_type: widgetType });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => {
        if (!isOpen) { setStep('input'); setSuggestions([]); }
        onOpenChange(isOpen);
      }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto !p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '24px' }}>
              {step === 'input' && (isEditing ? 'EDIT METRIC' : 'CREATE METRIC')}
              {step === 'analyzing' && 'ANALYZING...'}
              {step === 'choose' && 'CHOOSE VISUALIZATION'}
            </DialogTitle>
            {step === 'analyzing' && (
              <DialogDescription style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
                AI is analyzing your metric to suggest the best visualizations...
              </DialogDescription>
            )}
            {step === 'choose' && (
              <DialogDescription style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
                Select how you want to visualize "{name}" on your dashboard.
              </DialogDescription>
            )}
          </DialogHeader>

          {step === 'input' && (
            <form onSubmit={handleSubmit} className="space-y-6 p-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="field-text">Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Customer Satisfaction, Bug Reports"
                    maxLength={50}
                    required
                    className="!h-8 field-text"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="color" className="field-text">Color</Label>
                  <div className="space-y-3">
                    <div className="flex gap-2 items-center">
                      {isDefaultSelected ? (
                        <div
                          className="w-16 h-8 rounded border border-border bg-card cursor-pointer"
                          onClick={() => selectColorSwatch(DEFAULT_METRIC_COLOR)}
                          title="Pick a color"
                        />
                      ) : (
                        <Input
                          id="color"
                          type="color"
                          value={color}
                          onChange={(e) => selectColorSwatch(e.target.value)}
                          className="w-16 !h-8 cursor-pointer p-1"
                        />
                      )}
                      <Input
                        type="text"
                        value={isDefaultSelected ? '' : color}
                        onChange={(e) => selectColorSwatch(e.target.value)}
                        placeholder="Default"
                        className="flex-1 !h-8 field-text"
                      />
                      {isCustomColor ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="groove-btn field-text !h-8"
                          onClick={async () => {
                            const updated = customColors.includes(color) ? customColors : [...customColors, color];
                            if (updated.length !== customColors.length) {
                              await saveCustomColors(updated);
                            }
                            toast({ title: 'Color saved' });
                          }}
                        >
                          <Save className="h-3 w-3 mr-1" />
                          Save
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="groove-btn field-text !h-8"
                          onClick={selectDefaultSwatch}
                        >
                          <X className="h-3 w-3 mr-1" />
                          Clear
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-9 gap-2">
                      <button
                        type="button"
                        onClick={selectDefaultSwatch}
                        className="w-full h-8 rounded-md border border-border bg-card relative overflow-hidden transition-all hover:scale-105"
                        title="Default"
                      >
                        {isDefaultSelected && (
                          <div
                            className="absolute inset-0 pointer-events-none rounded-md"
                            style={{
                              border: '1px solid hsl(var(--foreground))',
                              boxShadow: 'inset 0 0 0 1px hsl(var(--foreground) / 0.2)',
                            }}
                          />
                        )}
                      </button>
                      {presetColors.map((presetColor) => (
                        <button
                          key={presetColor}
                          type="button"
                          onClick={() => selectColorSwatch(presetColor)}
                          className="w-full h-8 rounded-md border-2 transition-all hover:scale-105"
                          style={{
                            backgroundColor: presetColor,
                            borderColor: !isDefaultSelected && color === presetColor ? 'hsl(var(--foreground))' : 'transparent',
                          }}
                          title={presetColor}
                        />
                      ))}
                    </div>
                    {customColors.length > 0 && (
                      <div className="grid grid-cols-9 gap-2">
                        {customColors.map((cc, i) => (
                          <div key={`custom-${i}`} className="relative group/swatch">
                            <button
                              type="button"
                              onClick={() => selectColorSwatch(cc)}
                              className="w-full h-8 rounded-md border-2 transition-all hover:scale-105"
                              style={{
                                backgroundColor: cc,
                                borderColor: !isDefaultSelected && color === cc ? 'hsl(var(--foreground))' : 'transparent',
                              }}
                              title={cc}
                            />
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                const updated = customColors.filter((_, idx) => idx !== i);
                                await saveCustomColors(updated);
                                if (!isDefaultSelected && color === cc) selectDefaultSwatch();
                              }}
                              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover/swatch:opacity-100 transition-opacity"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Width selector - only for non-number widgets when editing */}
                {isEditing && metric?.widget_type && metric.widget_type !== 'number_card' && (
                  <div className="space-y-2">
                    <Label className="field-text">Widget Width</Label>
                    <Select value={widgetWidth} onValueChange={setWidgetWidth}>
                      <SelectTrigger className="!h-8 field-text">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="half" className="field-text">50% Width (Half)</SelectItem>
                        <SelectItem value="full" className="field-text">100% Width (Full)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div>
                  <Label htmlFor="prompt" className="field-text" style={{ display: 'block', marginBottom: '8px' }}>Description</Label>
                  <Textarea
                    id="prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe what patterns or content to look for in user messages..."
                    className="block min-h-[100px] field-text"
                    maxLength={500}
                    required
                    style={{ marginBottom: 0 }}
                  />
                </div>
                
                {/* Action Buttons — DELETE left, UPDATE right */}
                <div className="flex gap-3" style={{ marginTop: '8px' }}>
                  {isEditing && onDelete ? (
                    <Button 
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      size="sm"
                      className="flex-1 groove-btn groove-btn-destructive field-text"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      DELETE
                    </Button>
                  ) : (
                    <Button 
                      type="button"
                      variant="outline"
                      onClick={() => onOpenChange(false)}
                      size="sm"
                      className="flex-1 groove-btn field-text"
                    >
                      CANCEL
                    </Button>
                  )}
                  <Button 
                    type="submit" 
                    disabled={saving}
                    className="flex-1 groove-btn field-text"
                    size="sm"
                  >
                    {isEditing && <Save className="h-3.5 w-3.5 mr-1.5" />}
                    {saving ? 'SAVING...' : isEditing ? 'UPDATE' : (hasOpenrouterKey ? 'ANALYZE & SUGGEST' : 'CREATE')}
                  </Button>
                </div>
              </div>

              {/* Example Prompts - only when creating */}
              {!isEditing && (
                <div className="rounded-lg border border-border p-4 space-y-4">
                  <p className="font-medium text-muted-foreground field-text">Example Prompts</p>
                  {[
                    { name: "Customer Satisfaction", prompt: "Identify messages expressing satisfaction, happiness, or positive feedback. Look for 'love', 'amazing', 'perfect', 'thank you'" },
                    { name: "Billing Issues", prompt: "Detect messages about billing problems, payment failures, or subscription issues" },
                    { name: "Feature Requests", prompt: "Find messages requesting new features. Look for 'would be nice if', 'can you add', 'feature request'" },
                  ].map((example, index) => (
                    <div key={index} className="space-y-2">
                      <p className="font-medium field-text">{example.name}</p>
                      <p className="text-muted-foreground leading-relaxed field-text">{example.prompt}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full field-text"
                        onClick={() => { setName(example.name); setPrompt(example.prompt); }}
                      >
                        Use this example
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </form>
          )}

          {step === 'analyzing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 px-6">
              <div className="flex gap-2">
                {[0, 1, 2].map(i => (
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
                ANALYZING METRIC
              </p>
              <style>{`
                @keyframes saving-bounce {
                  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
                  40% { opacity: 1; transform: scale(1.2); }
                }
              `}</style>
            </div>
          )}

          {step === 'choose' && (
            <div className="space-y-3 p-6">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  disabled={saving}
                  className="w-full text-left p-4 bg-muted/30 hover:bg-muted/60 transition-colors border border-border disabled:opacity-50"
                  onClick={() => handleChooseWidget(s.type)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span style={{ fontFamily: "'VT323', monospace", fontSize: '20px' }}>
                      {WIDGET_TYPE_LABELS[s.type] || s.type}
                    </span>
                    {i === 0 && (
                      <span className="text-xs bg-primary/20 text-primary px-2 py-0.5" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px' }}>
                        RECOMMENDED
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' }}>
                    {s.description}
                  </p>
                </button>
              ))}
              {saving && (
                <div className="flex flex-col items-center justify-center py-6 gap-3">
                  <div className="flex gap-2">
                    {[0, 1, 2].map(i => (
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
                    CREATING METRIC
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Metric Widget</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{metric?.name}" from your dashboard? You can recreate it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setShowDeleteConfirm(false); onDelete?.(); }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
