import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from '@/components/icons';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

const WIDGET_TYPE_LABELS: Record<string, string> = {
  number_card: '🔢 Number Card',
  line: '📈 Line Chart',
  bar_vertical: '📊 Bar Chart (Vertical)',
  bar_horizontal: '📊 Bar Chart (Horizontal)',
  doughnut: '🍩 Donut Chart',
  text: '📝 Text Display',
};

const PRESET_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#14b8a6'];

interface Suggestion {
  type: string;
  title: string;
  description: string;
}

interface CreateMetricDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  onCreated: () => void;
}

export function CreateMetricDialog({ open, onOpenChange, clientId, onCreated }: CreateMetricDialogProps) {
  const [step, setStep] = useState<'input' | 'analyzing' | 'choose' | 'creating'>('input');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [prompt, setPrompt] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const { toast } = useToast();

  const reset = () => {
    setStep('input');
    setName('');
    setColor('#3b82f6');
    setPrompt('');
    setSuggestions([]);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) reset();
    onOpenChange(isOpen);
  };

  const handleAnalyze = async () => {
    if (!name.trim() || !prompt.trim()) {
      toast({ title: 'Missing fields', description: 'Please provide a name and description.', variant: 'destructive' });
      return;
    }

    setStep('analyzing');

    try {
      const { data, error } = await supabase.functions.invoke('analytics-v2-suggest-widgets', {
        body: { prompt: prompt.trim(), client_id: clientId },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      setSuggestions(data.suggestions || []);
      setStep('choose');
    } catch (e: any) {
      console.error('Suggest widgets error:', e);
      toast({ title: 'Analysis failed', description: e.message || 'Failed to analyze metric', variant: 'destructive' });
      setStep('input');
    }
  };

  const handleChooseWidget = async (widgetType: string) => {
    setStep('creating');

    try {
      // Get max sort_order for v2 widgets
      const { data: existing } = await supabase
        .from('dashboard_widgets')
        .select('sort_order')
        .eq('client_id', clientId)
        .eq('analytics_type', 'v2')
        .eq('is_active', true)
        .order('sort_order', { ascending: false })
        .limit(1);

      const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

      const { error: insertError } = await supabase.from('dashboard_widgets').insert({
        client_id: clientId,
        title: name.trim(),
        widget_type: widgetType,
        analytics_type: 'v2',
        width: widgetType === 'text' ? 'full' : 'half',
        config: {
          prompt: prompt.trim(),
          color,
          chart_data: null,
          last_processed: null,
        },
        sort_order: nextOrder,
        is_active: true,
      });

      if (insertError) throw insertError;

      toast({ title: 'Metric created', description: `"${name}" has been added. Click REFRESH to populate it.` });
      onCreated();
      handleClose(false);
    } catch (e: any) {
      console.error('Create widget error:', e);
      toast({ title: 'Creation failed', description: e.message || 'Failed to create metric', variant: 'destructive' });
      setStep('choose');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg" style={{ border: '3px groove hsl(var(--border-groove))' }}>
        <DialogHeader>
          <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '24px' }}>
            {step === 'input' && 'CREATE METRIC'}
            {step === 'analyzing' && 'ANALYZING...'}
            {step === 'choose' && 'CHOOSE VISUALIZATION'}
            {step === 'creating' && 'CREATING...'}
          </DialogTitle>
          <DialogDescription style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
            {step === 'input' && 'Define what you want to track from your conversations.'}
            {step === 'analyzing' && 'AI is analyzing your metric to suggest the best visualizations...'}
            {step === 'choose' && 'Select how you want to visualize this metric.'}
            {step === 'creating' && 'Saving your metric...'}
          </DialogDescription>
        </DialogHeader>

        {step === 'input' && (
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>Metric Name</Label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g., Bot Detection Questions"
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
              />
            </div>

            <div className="space-y-2">
              <Label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>Color</Label>
              <div className="flex gap-2 flex-wrap">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    className={`w-7 h-7 rounded-sm border-2 transition-all ${color === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>Description (Prompt)</Label>
              <Textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="e.g., Analyze all conversations and count how many people asked if they are talking to a bot or AI."
                rows={4}
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
              />
              <p className="text-muted-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px' }}>
                This prompt will be used to analyze your conversations. Be specific about what you want to measure.
              </p>
            </div>

            <Button
              onClick={handleAnalyze}
              className="w-full groove-btn"
              disabled={!name.trim() || !prompt.trim()}
              style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}
            >
              ANALYZE & SUGGEST WIDGETS
            </Button>
          </div>
        )}

        {step === 'analyzing' && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-muted-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
              AI is determining the best visualizations for your metric...
            </span>
          </div>
        )}

        {step === 'choose' && (
          <div className="space-y-3 mt-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                className="w-full text-left p-4 bg-muted/30 hover:bg-muted/60 transition-colors"
                style={{ border: '2px groove hsl(var(--border-groove))' }}
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
          </div>
        )}

        {step === 'creating' && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-muted-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
              Creating your metric widget...
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
