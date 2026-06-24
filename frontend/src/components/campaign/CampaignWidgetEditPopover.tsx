import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Edit, Trash2, Save, X } from '@/components/icons';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useParams } from 'react-router-dom';


const DEFAULT_METRIC_COLOR = '#3b82f6';
const presetColors = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
];

interface CampaignWidgetEditPopoverProps {
  title: string;
  internalName?: string;
  color: string;
  onUpdate: (title: string, color: string) => void;
  onDelete: () => void;
  openExternal?: boolean;
  onCloseExternal?: () => void;
}

export function CampaignWidgetEditPopover({ title, internalName, color, onUpdate, onDelete, openExternal, onCloseExternal }: CampaignWidgetEditPopoverProps) {
  const { clientId } = useParams<{ clientId: string }>();
  const [editTitle, setEditTitle] = useState(title);
  const [editColor, setEditColor] = useState(color);
  const [open, setOpen] = useState(false);
  const isOpen = openExternal !== undefined ? openExternal : open;
  const setIsOpen = (v: boolean) => { if (onCloseExternal && !v) onCloseExternal(); setOpen(v); };
  
  const [isDefaultSelected, setIsDefaultSelected] = useState(false);
  const [customColors, setCustomColors] = useState<string[]>([]);
  

  useEffect(() => {
    if (isOpen) {
      setEditColor(color);
      setEditTitle(title);
      setIsDefaultSelected(false);
    }
  }, [isOpen, color, title]);

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

  useEffect(() => { if (isOpen) fetchCustomColors(); }, [isOpen, fetchCustomColors]);

  const allKnownColors = [...presetColors, ...customColors];
  const isCustomColor = !isDefaultSelected && !allKnownColors.includes(editColor);

  const selectDefaultSwatch = () => {
    setEditColor(DEFAULT_METRIC_COLOR);
    setIsDefaultSelected(true);
  };

  const selectColorSwatch = (c: string) => {
    setEditColor(c);
    setIsDefaultSelected(false);
  };

  const handleSave = async () => {
    const finalColor = isDefaultSelected ? DEFAULT_METRIC_COLOR : editColor;
    if (isCustomColor && editColor) {
      const updated = customColors.includes(editColor) ? customColors : [...customColors, editColor];
      if (updated.length !== customColors.length) {
        await saveCustomColors(updated);
      }
    }
    onUpdate(editTitle.trim() || title, finalColor);
    setIsOpen(false);
    toast.success('Widget updated successfully.');
  };

  const handleRequestDelete = () => {
    setIsOpen(false);
    // Small delay to let dialog close animation finish before parent shows confirm
    setTimeout(() => onDelete(), 150);
  };

  return (
    <>
      {/* Inline trigger button — only when not externally controlled */}
      {openExternal === undefined && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-2 right-2 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => { e.stopPropagation(); setIsOpen(true); }}
        >
          <Edit className="h-3.5 w-3.5" />
        </Button>
      )}

      {/* Full-screen Dialog matching dashboard's EDIT METRIC */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md !p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '24px' }}>
              EDIT METRIC
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 p-6">

            {/* Name */}
            <div className="space-y-2">
              <Label className="field-text">Name</Label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="!h-8 field-text"
              />
            </div>

            {/* Color */}
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
                      value={editColor}
                      onChange={(e) => selectColorSwatch(e.target.value)}
                      className="w-16 !h-8 cursor-pointer p-1"
                    />
                  )}
                  <Input
                    type="text"
                    value={isDefaultSelected ? '' : editColor}
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
                        const updated = customColors.includes(editColor) ? customColors : [...customColors, editColor];
                        if (updated.length !== customColors.length) {
                          await saveCustomColors(updated);
                        }
                        toast.success('Color saved');
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
                        borderColor: !isDefaultSelected && editColor === presetColor ? 'hsl(var(--foreground))' : 'transparent',
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
                            borderColor: !isDefaultSelected && editColor === cc ? 'hsl(var(--foreground))' : 'transparent',
                          }}
                          title={cc}
                        />
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const updated = customColors.filter((_, idx) => idx !== i);
                            await saveCustomColors(updated);
                            if (!isDefaultSelected && editColor === cc) selectDefaultSwatch();
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

            {/* Action buttons — DELETE left, UPDATE right */}
            <div className="flex gap-3" style={{ marginTop: '8px' }}>
              <Button
                onClick={handleRequestDelete}
                size="sm"
                className="flex-1 groove-btn field-text !bg-destructive !text-destructive-foreground hover:!bg-[#7a2f2b] !border-[#752e2a] hover:!border-[#5a2320]"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                DELETE
              </Button>
              <Button
                onClick={handleSave}
                size="sm"
                className="flex-1 groove-btn field-text"
              >
                <Save className="h-3.5 w-3.5 mr-1.5" />
                UPDATE
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
}
