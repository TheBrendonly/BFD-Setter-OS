import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, X, Save, GripVertical } from '@/components/icons';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';

interface ContactTag {
  id: string;
  name: string;
  color: string;
  client_id: string;
  sort_order?: number;
}

interface TagManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  clientId: string;
  assignedTagIds: string[];
  onTagsChanged: () => void;
}

const DEFAULT_TAG_COLOR = '#3b82f6';
const PRESET_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
];

const FIELD_FONT: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: '13px',
};

export const TagManager: React.FC<TagManagerProps> = ({
  open,
  onOpenChange,
  contactId,
  clientId,
  assignedTagIds,
  onTagsChanged,
}) => {
  const [allTags, setAllTags] = useState<ContactTag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(DEFAULT_TAG_COLOR);
  const [isDefaultSelected, setIsDefaultSelected] = useState(true);
  const [loading, setLoading] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingColor, setEditingColor] = useState('');
  const [editingIsDefault, setEditingIsDefault] = useState(false);
  const [pendingDeleteTag, setPendingDeleteTag] = useState<{ id: string; name: string } | null>(null);
  const [customColors, setCustomColors] = useState<string[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const allKnownColors = [...PRESET_COLORS, ...customColors];
  const isCustomColor = !isDefaultSelected && !allKnownColors.includes(newTagColor);
  const editIsCustomColor = !editingIsDefault && !allKnownColors.includes(editingColor);

  const selectDefaultSwatch = () => {
    setNewTagColor(DEFAULT_TAG_COLOR);
    setIsDefaultSelected(true);
  };

  const selectColorSwatch = (c: string) => {
    setNewTagColor(c);
    setIsDefaultSelected(false);
  };

  const selectEditDefaultSwatch = () => {
    setEditingColor(DEFAULT_TAG_COLOR);
    setEditingIsDefault(true);
  };

  const selectEditColorSwatch = (c: string) => {
    setEditingColor(c);
    setEditingIsDefault(false);
  };

  const fetchCustomColors = useCallback(async () => {
    try {
      const { data } = await (supabase as any)
        .from('clients_public')
        .select('crm_filter_config')
        .eq('id', clientId)
        .single();
      const config = data?.crm_filter_config || {};
      setCustomColors(config.custom_tag_colors || []);
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
        .update({ crm_filter_config: { ...config, custom_tag_colors: colors } })
        .eq('id', clientId);
    } catch { /* ignore */ }
  }, [clientId]);

  const fetchTags = useCallback(async () => {
    const { data } = await supabase
      .from('lead_tags')
      .select('*')
      .eq('client_id', clientId)
      .order('sort_order')
      .order('name');
    setAllTags((data as ContactTag[]) || []);
  }, [clientId]);

  useEffect(() => {
    if (open) {
      fetchTags();
      fetchCustomColors();
    }
  }, [open, fetchTags, fetchCustomColors]);

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    setLoading(true);
    try {
      // Auto-save custom color
      if (isCustomColor && newTagColor) {
        const updated = customColors.includes(newTagColor) ? customColors : [...customColors, newTagColor];
        if (updated.length !== customColors.length) await saveCustomColors(updated);
      }
      const finalColor = isDefaultSelected ? DEFAULT_TAG_COLOR : newTagColor;
      const maxOrder = allTags.reduce((max, t) => Math.max(max, t.sort_order || 0), 0);
      const { error } = await supabase.from('lead_tags').insert({
        client_id: clientId,
        name: newTagName.trim(),
        color: finalColor,
        sort_order: maxOrder + 1,
      });
      if (error) throw error;
      setNewTagName('');
      setNewTagColor(DEFAULT_TAG_COLOR);
      setIsDefaultSelected(true);
      fetchTags();
      toast.success('Tag created');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create tag');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTag = async (tagId: string) => {
    const isAssigned = assignedTagIds.includes(tagId);
    try {
      if (isAssigned) {
        const { error } = await supabase
          .from('lead_tag_assignments')
          .delete()
          .eq('lead_id', contactId)
          .eq('tag_id', tagId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('lead_tag_assignments').insert({
          lead_id: contactId,
          tag_id: tagId,
        });
        if (error) throw error;
      }
      onTagsChanged();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update tag');
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    try {
      const { error } = await supabase.from('lead_tags').delete().eq('id', tagId);
      if (error) throw error;
      fetchTags();
      onTagsChanged();
      if (editingTagId === tagId) setEditingTagId(null);
      toast.success('Tag deleted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete tag');
    }
  };

  const handleStartEdit = (tag: ContactTag) => {
    setEditingTagId(tag.id);
    setEditingName(tag.name);
    setEditingColor(tag.color || DEFAULT_TAG_COLOR);
    setEditingIsDefault(false);
  };

  const handleSaveEdit = async () => {
    if (!editingTagId || !editingName.trim()) return;
    try {
      // Auto-save custom color
      if (editIsCustomColor && editingColor) {
        const updated = customColors.includes(editingColor) ? customColors : [...customColors, editingColor];
        if (updated.length !== customColors.length) await saveCustomColors(updated);
      }
      const finalColor = editingIsDefault ? DEFAULT_TAG_COLOR : editingColor;
      const { error } = await supabase
        .from('lead_tags')
        .update({ name: editingName.trim(), color: finalColor })
        .eq('id', editingTagId);
      if (error) throw error;
      setEditingTagId(null);
      fetchTags();
      onTagsChanged();
      toast.success('Tag updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update tag');
    }
  };

  const renderColorPicker = (
    color: string,
    isDefault: boolean,
    isCustom: boolean,
    onSelectDefault: () => void,
    onSelectColor: (c: string) => void,
  ) => (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        {isDefault ? (
          <div
            className="w-16 h-8 rounded border border-border bg-card cursor-pointer"
            onClick={() => onSelectColor(DEFAULT_TAG_COLOR)}
            title="Pick a color"
          />
        ) : (
          <Input
            type="color"
            value={color}
            onChange={(e) => onSelectColor(e.target.value)}
            className="w-16 !h-8 cursor-pointer p-1"
          />
        )}
        <Input
          type="text"
          value={isDefault ? '' : color}
          onChange={(e) => onSelectColor(e.target.value)}
          placeholder="Default"
          className="flex-1 !h-8 field-text"
        />
        {isCustom ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="groove-btn field-text !h-8"
            onClick={async () => {
              const updated = customColors.includes(color) ? customColors : [...customColors, color];
              if (updated.length !== customColors.length) await saveCustomColors(updated);
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
            onClick={onSelectDefault}
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>
      <div className="grid grid-cols-9 gap-2">
        <button
          type="button"
          onClick={onSelectDefault}
          className="w-full h-8 rounded-md border border-border bg-card relative overflow-hidden transition-all hover:scale-105"
          title="Default"
        >
          {isDefault && (
            <div
              className="absolute inset-0 pointer-events-none rounded-md"
              style={{
                border: '1px solid hsl(var(--foreground))',
                boxShadow: 'inset 0 0 0 1px hsl(var(--foreground) / 0.2)',
              }}
            />
          )}
        </button>
        {PRESET_COLORS.map((presetColor) => (
          <button
            key={presetColor}
            type="button"
            onClick={() => onSelectColor(presetColor)}
            className="w-full h-8 rounded-md border-2 transition-all hover:scale-105"
            style={{
              backgroundColor: presetColor,
              borderColor: !isDefault && color === presetColor ? 'hsl(var(--foreground))' : 'transparent',
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
                onClick={() => onSelectColor(cc)}
                className="w-full h-8 rounded-md border-2 transition-all hover:scale-105"
                style={{
                  backgroundColor: cc,
                  borderColor: !isDefault && color === cc ? 'hsl(var(--foreground))' : 'transparent',
                }}
                title={cc}
              />
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  const updated = customColors.filter((_, idx) => idx !== i);
                  await saveCustomColors(updated);
                  if (!isDefault && color === cc) onSelectDefault();
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
  );

  return (
    <>
    <Dialog open={open && !pendingDeleteTag} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md !p-0">
        <DialogHeader>
          <DialogTitle>Tag Settings</DialogTitle>
        </DialogHeader>

        <div className="p-6 space-y-4">
          {/* Create new tag */}
          <div className="flex items-center gap-2">
            <Input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="Tag name..."
              className="h-8 flex-1"
              style={FIELD_FONT}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleCreateTag}
              disabled={loading || !newTagName.trim()}
              className="h-8 shrink-0 gap-1"
              style={FIELD_FONT}
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </Button>
          </div>

          {/* Color picker — only show when name is entered */}
          {newTagName.trim() && (
            <div className="space-y-2">
              <Label className="field-text">Color</Label>
              {renderColorPicker(newTagColor, isDefaultSelected, isCustomColor, selectDefaultSwatch, selectColorSwatch)}
            </div>
          )}

          {/* Tags list */}
          <div className="space-y-2">
            <Label style={FIELD_FONT} className="text-muted-foreground">
              Tags ({allTags.length})
            </Label>

            <div className="space-y-1 max-h-[280px] overflow-y-auto">
              {allTags.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center" style={FIELD_FONT}>
                  No tags yet. Create one above.
                </p>
              ) : (
                allTags.map((tag, idx) => {
                  const isAssigned = assignedTagIds.includes(tag.id);
                  const isEditing = editingTagId === tag.id;

                  if (isEditing) {
                    return (
                      <div key={tag.id} className="border border-border p-3 space-y-3 bg-muted/30">
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="h-8"
                          style={FIELD_FONT}
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                          autoFocus
                        />
                        <div className="space-y-2">
                          <Label className="field-text">Color</Label>
                          {renderColorPicker(editingColor, editingIsDefault, editIsCustomColor, selectEditDefaultSwatch, selectEditColorSwatch)}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" className="h-7 flex-1" style={FIELD_FONT} onClick={() => setEditingTagId(null)}>Cancel</Button>
                          <Button size="sm" className="h-7 flex-1" style={FIELD_FONT} onClick={handleSaveEdit} disabled={!editingName.trim()}>Save</Button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={tag.id}
                      draggable
                      onDragStart={() => { setDragIndex(idx); }}
                      onDragOver={(e) => { e.preventDefault(); setDragOverIndex(idx); }}
                      onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                      onDrop={async () => {
                        if (dragIndex === null || dragIndex === idx) return;
                        const reordered = [...allTags];
                        const [moved] = reordered.splice(dragIndex, 1);
                        reordered.splice(idx, 0, moved);
                        setAllTags(reordered);
                        setDragIndex(null);
                        setDragOverIndex(null);
                        try {
                          await Promise.all(
                            reordered.map((t, i) =>
                              supabase.from('lead_tags').update({ sort_order: i } as any).eq('id', t.id)
                            )
                          );
                          onTagsChanged();
                        } catch (err) {
                          console.error('Failed to persist tag order:', err);
                        }
                      }}
                      className={`flex items-center gap-2 py-1.5 hover:bg-muted/30 transition-colors group cursor-grab active:cursor-grabbing ${
                        dragOverIndex === idx ? 'border-t-2 border-primary' : ''
                      }`}
                    >
                      {/* Drag handle */}
                      <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />

                      {/* Checkbox */}
                      <button
                        onClick={() => handleToggleTag(tag.id)}
                        className="flex items-center justify-center w-5 h-5 shrink-0 cursor-pointer groove-border"
                        style={isAssigned ? { backgroundColor: '#ffffff', borderColor: '#ffffff' } : undefined}
                      >
                        {isAssigned && <svg viewBox="0 0 16 15" fill="#000" shapeRendering="crispEdges" className="w-3 h-3"><rect x="1" y="5" width="3" height="3"/><rect x="3" y="7" width="3" height="3"/><rect x="5" y="9" width="3" height="3"/><rect x="7" y="7" width="3" height="3"/><rect x="9" y="5" width="3" height="3"/><rect x="11" y="3" width="3" height="3"/></svg>}
                      </button>

                      {/* Tag as colored label */}
                      <span
                        className="inline-flex items-center gap-1 border px-2 py-0.5 font-medium leading-none whitespace-nowrap truncate cursor-pointer [font-size:11px] [border-width:0.7px]"
                        style={{
                          backgroundColor: `${tag.color || '#6366f1'}26`,
                          borderColor: tag.color || '#6366f1',
                          color: '#FFFFFF',
                        }}
                        onClick={() => handleToggleTag(tag.id)}
                      >
                        {tag.name}
                      </span>

                      <div className="ml-auto flex items-center gap-1">
                        {/* Edit */}
                        <button
                          onClick={() => handleStartEdit(tag)}
                          className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50 cursor-pointer"
                          title="Edit tag"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>

                        {/* Delete */}
                        <button
                          onClick={() => setPendingDeleteTag({ id: tag.id, name: tag.name })}
                          className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center cursor-pointer"
                          title="Delete tag"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <DeleteConfirmDialog
      open={!!pendingDeleteTag}
      onOpenChange={(isOpen) => {
        if (!isOpen) setPendingDeleteTag(null);
      }}
      onConfirm={() => {
        if (pendingDeleteTag) handleDeleteTag(pendingDeleteTag.id);
        setPendingDeleteTag(null);
      }}
      title="Delete Tag"
      itemName={pendingDeleteTag?.name}
    />
    </>
  );
};
