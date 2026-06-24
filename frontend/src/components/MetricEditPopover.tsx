import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Edit, Trash2, Save, X } from '@/components/icons';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

interface MetricEditPopoverProps {
  clientId: string;
  metricName: string;
  metricId?: string;
  currentColor: string;
  isCustom?: boolean;
  onColorChange: (color: string) => void;
  onDelete: () => void;
}

const DEFAULT_METRIC_COLOR = '#3b82f6';
const presetColors = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
];

export function MetricEditPopover({ 
  clientId, 
  metricName,
  metricId,
  currentColor, 
  isCustom = false,
  onColorChange,
  onDelete
}: MetricEditPopoverProps) {
  const [color, setColor] = useState(currentColor);
  const [open, setOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDefaultSelected, setIsDefaultSelected] = useState(false);
  const [customColors, setCustomColors] = useState<string[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    setColor(currentColor);
    setIsDefaultSelected(false);
  }, [currentColor]);

  // Fetch custom metric colors from Supabase
  const fetchCustomColors = useCallback(async () => {
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

  const handleSaveColor = async () => {
    const now = new Date().toISOString();
    const finalColor = isDefaultSelected ? DEFAULT_METRIC_COLOR : color;
    try {
      // Auto-save custom color
      if (isCustomColor && color) {
        const updated = customColors.includes(color) ? customColors : [...customColors, color];
        if (updated.length !== customColors.length) {
          await saveCustomColors(updated);
        }
      }

      if (isCustom && metricId) {
        const { error } = await supabase
          .from('custom_metrics')
          .update({ color: finalColor, updated_at: now })
          .eq('id', metricId);
        if (error) throw error;
      } else {
        const { data: updated, error: updateError } = await supabase
          .from('metric_color_preferences')
          .update({ color: finalColor, updated_at: now })
          .eq('client_id', clientId)
          .eq('metric_name', metricName)
          .select('id');

        if (updateError) throw updateError;

        if (!updated || updated.length === 0) {
          const { error: insertError } = await supabase
            .from('metric_color_preferences')
            .insert({ client_id: clientId, metric_name: metricName, color: finalColor, updated_at: now });
          if (insertError) throw insertError;
        }
      }

      onColorChange(finalColor);
      setOpen(false);
      toast({ title: 'Success', description: 'Color updated successfully.' });
    } catch (error) {
      console.error('Error saving color preference:', error);
      toast({ title: 'Error', description: 'Failed to update color.', variant: 'destructive' });
    }
  };

  const handleRequestDelete = () => {
    setOpen(false); // close edit popover first
    setTimeout(() => setShowDeleteConfirm(true), 150);
  };

  const handleDelete = () => {
    setShowDeleteConfirm(false);
    onDelete();
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 h-6 w-6 p-0 hover:bg-background/80"
            onClick={(e) => e.stopPropagation()}
          >
            <Edit className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 bg-popover z-50 !p-0" align="end" side="top" sideOffset={5}>
          <div className="p-3 border-b border-dashed border-border flex items-center justify-between">
            <h4 style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              Edit Metric
            </h4>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 !bg-muted !border-border hover:!bg-accent"
              onClick={() => setOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="space-y-4 p-4">
            <div className="space-y-2">
              <Label className="field-text">Color</Label>
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

            <div className="flex gap-3" style={{ marginTop: '8px' }}>
              <Button
                onClick={() => handleRequestDelete()}
                size="sm"
                className="flex-1 groove-btn field-text !bg-destructive !text-destructive-foreground hover:!bg-[#7a2f2b] !border-[#752e2a] hover:!border-[#5a2320]"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                DELETE
              </Button>
              <Button
                onClick={handleSaveColor}
                size="sm"
                className="flex-1 groove-btn field-text"
              >
                <Save className="h-3.5 w-3.5 mr-1.5" />
                UPDATE
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialog open={showDeleteConfirm} onOpenChange={(isOpen) => {
        if (!isOpen) {
          setShowDeleteConfirm(false);
          setTimeout(() => setOpen(true), 150);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Metric Widget</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{metricName}" from your dashboard? 
              {!isCustom && " You can add it back later from the Add Metric menu."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
