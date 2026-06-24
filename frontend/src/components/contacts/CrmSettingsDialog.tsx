import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, Trash2, Check, Pencil, Lock, GripVertical, X, Save } from '@/components/icons';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import {
  buildCustomFieldsFromData,
  buildEditableContactData,
  buildExternalContactSyncPayload,
  createCanonicalLeadId,
  getCanonicalLeadId,
} from '@/utils/contactId';

interface ContactTag {
  id: string;
  name: string;
  color: string;
  client_id: string;
  sort_order?: number;
}

interface CrmSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  contactId?: string;
  assignedTagIds?: string[];
  onTagsChanged?: () => void;
}

const PRESET_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
];

const DEFAULT_FIELD_KEYS = new Set([
  'first_name', 'last_name', 'email', 'phone', 'business_name',
  'contact_name', 'full_name', 'name',
  'created_at', 'updated_at', 'contact_id', 'external_id', 'id', 'tags',
]);

const FIELD_FONT: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: '13px',
};

/** Format default field keys for display: contact_id → Contact Id */
function formatDefaultFieldLabel(key: string): string {
  return key
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const CrmSettingsDialog: React.FC<CrmSettingsDialogProps> = ({
  open,
  onOpenChange,
  clientId,
  contactId,
  assignedTagIds = [],
  onTagsChanged,
}) => {
  const [allTags, setAllTags] = useState<ContactTag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3b82f6');
  const [newTagIsDefault, setNewTagIsDefault] = useState(true);
  const [tagLoading, setTagLoading] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingColor, setEditingColor] = useState('');
  const [editingIsDefault, setEditingIsDefault] = useState(false);
  const [customTagColors, setCustomTagColors] = useState<string[]>([]);

  const [allFieldKeys, setAllFieldKeys] = useState<string[]>([]);
  const [customFieldDefs, setCustomFieldDefs] = useState<{ id: string; field_name: string; sort_order: number }[]>([]);
  const [newFieldName, setNewFieldName] = useState('');
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Drag state
  const [dragType, setDragType] = useState<'field' | 'tag' | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Delete confirmation state
  const [pendingDelete, setPendingDelete] = useState<{ type: 'field' | 'tag'; id: string; name: string } | null>(null);
  const allKnownTagColors = [...PRESET_COLORS, ...customTagColors];
  const newTagIsCustomColor = !newTagIsDefault && !allKnownTagColors.includes(newTagColor);
  const editTagIsCustomColor = !editingIsDefault && !allKnownTagColors.includes(editingColor);

  const fetchCustomTagColors = useCallback(async () => {
    try {
      const { data } = await (supabase as any)
        .from('clients_public')
        .select('crm_filter_config')
        .eq('id', clientId)
        .single();
      const config = data?.crm_filter_config || {};
      setCustomTagColors(config.custom_tag_colors || []);
    } catch { /* ignore */ }
  }, [clientId]);

  const saveCustomTagColors = useCallback(async (colors: string[]) => {
    setCustomTagColors(colors);
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

  const fetchFieldKeys = useCallback(async () => {
    const keys = new Set<string>();
    const pageSize = 1000;
    let from = 0;
    try {
      while (true) {
        const { data, error } = await supabase
          .from('leads')
          .select('custom_fields')
          .eq('client_id', clientId)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        data.forEach((row) => {
          const cf = (row.custom_fields || {}) as Record<string, string>;
          Object.keys(cf).forEach((key) => keys.add(key));
        });
        if (data.length < pageSize) break;
        from += pageSize;
      }
      setAllFieldKeys(Array.from(keys).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
    } catch (err) {
      console.error('Error fetching field keys:', err);
    }
  }, [clientId]);

  const fetchCustomFieldDefs = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('client_custom_fields')
      .select('id, field_name, sort_order')
      .eq('client_id', clientId)
      .order('sort_order');
    setCustomFieldDefs(data || []);
  }, [clientId]);

  useEffect(() => {
    if (open) {
      fetchTags();
      fetchFieldKeys();
      fetchCustomFieldDefs();
      fetchCustomTagColors();
    }
  }, [open, fetchTags, fetchFieldKeys, fetchCustomFieldDefs, fetchCustomTagColors]);

  // === Tag handlers ===
  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    setTagLoading(true);
    try {
      // Auto-save custom color
      if (newTagIsCustomColor && newTagColor) {
        const updated = customTagColors.includes(newTagColor) ? customTagColors : [...customTagColors, newTagColor];
        if (updated.length !== customTagColors.length) await saveCustomTagColors(updated);
      }
      const finalColor = newTagIsDefault ? '#3b82f6' : newTagColor;
      const maxOrder = allTags.reduce((max, t) => Math.max(max, t.sort_order || 0), 0);
      const { error } = await supabase.from('lead_tags').insert({
        client_id: clientId,
        name: newTagName.trim(),
        color: finalColor,
        sort_order: maxOrder + 1,
      });
      if (error) throw error;
      setNewTagName('');
      setNewTagColor('#3b82f6');
      setNewTagIsDefault(true);
      fetchTags();
      onTagsChanged?.();
      toast.success('Tag created');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create tag');
    } finally {
      setTagLoading(false);
    }
  };

  const handleToggleTag = async (tagId: string) => {
    if (!contactId) return;
    const isAssigned = assignedTagIds.includes(tagId);
    try {
      if (isAssigned) {
        await supabase.from('lead_tag_assignments').delete().eq('lead_id', contactId).eq('tag_id', tagId);
      } else {
        await supabase.from('lead_tag_assignments').insert({ lead_id: contactId, tag_id: tagId });
      }
      onTagsChanged?.();

      await syncTagsToExternal(contactId);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update tag');
    }
  };

  const syncTagsToExternal = async (cId: string) => {
    try {
      const { data: tagAssignments } = await supabase
        .from('lead_tag_assignments')
        .select('tag_id')
        .eq('lead_id', cId);

      const assignedIds = (tagAssignments || []).map((row) => row.tag_id);
      const tagNames = allTags
        .filter((tag) => assignedIds.includes(tag.id))
        .map((tag) => tag.name);

      const { data: contactRow } = await supabase
        .from('leads')
        .select('id, lead_id, client_id, first_name, last_name, phone, email, business_name, custom_fields, tags')
        .eq('id', cId)
        .single();
      if (!contactRow?.client_id) return;

      const canonicalContactId = getCanonicalLeadId(contactRow as any) || createCanonicalLeadId();
      const editableData = buildEditableContactData(contactRow as any);
      const customFields = buildCustomFieldsFromData(editableData);

      // Build tags as jsonb array of objects
      const tagsPayload = tagNames.map((name: string) => {
        const existing = allTags.find(t => t.name === name);
        return { name, color: existing?.color || '#646E82' };
      });

      await (supabase
        .from('leads') as any)
        .update({
          lead_id: canonicalContactId,
          custom_fields: customFields,
          tags: tagsPayload,
        })
        .eq('id', cId);

      await supabase.functions.invoke('push-contact-to-external', {
        body: {
          clientId: contactRow.client_id,
          externalId: canonicalContactId,
          contactData: buildExternalContactSyncPayload(editableData, {
            customFields,
            tags: tagsPayload,
          }),
        },
      });
    } catch (err) {
      console.error('Tag external sync failed (non-blocking):', err);
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    try {
      await supabase.from('lead_tags').delete().eq('id', tagId);
      fetchTags();
      onTagsChanged?.();
      if (editingTagId === tagId) setEditingTagId(null);
      toast.success('Tag deleted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete tag');
    }
  };

  const handleStartEditTag = (tag: ContactTag) => {
    setEditingTagId(tag.id);
    setEditingName(tag.name);
    setEditingColor(tag.color || '#3b82f6');
    setEditingIsDefault(false);
  };

  const handleSaveEditTag = async () => {
    if (!editingTagId || !editingName.trim()) return;
    try {
      // Auto-save custom color
      if (editTagIsCustomColor && editingColor) {
        const updated = customTagColors.includes(editingColor) ? customTagColors : [...customTagColors, editingColor];
        if (updated.length !== customTagColors.length) await saveCustomTagColors(updated);
      }
      const finalColor = editingIsDefault ? '#3b82f6' : editingColor;
      await supabase.from('lead_tags').update({ name: editingName.trim(), color: finalColor }).eq('id', editingTagId);
      setEditingTagId(null);
      fetchTags();
      onTagsChanged?.();
      toast.success('Tag updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update tag');
    }
  };

  // === Custom field handlers ===
  const isDefaultField = (key: string) => {
    const normalized = key.toLowerCase().replace(/[\s_]/g, '');
    for (const dk of DEFAULT_FIELD_KEYS) {
      if (dk.toLowerCase().replace(/[\s_]/g, '') === normalized) return true;
    }
    return false;
  };

  const handleRenameField = async () => {
    if (!renamingKey || !renameValue.trim() || renameValue.trim() === renamingKey) {
      setRenamingKey(null);
      return;
    }
    const newKey = renameValue.trim();
    try {
      const pageSize = 500;
      let from = 0;
      let updated = 0;
      while (true) {
        const { data, error } = await supabase
          .from('leads')
          .select('id, custom_fields')
          .eq('client_id', clientId)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const row of data) {
          const cf = (row.custom_fields || {}) as Record<string, string>;
          if (renamingKey in cf) {
            const newCf = { ...cf };
            newCf[newKey] = newCf[renamingKey];
            delete newCf[renamingKey];
            await (supabase.from('leads') as any).update({ custom_fields: newCf }).eq('id', row.id);
            updated++;
          }
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
      await (supabase as any)
        .from('client_custom_fields')
        .update({ field_name: newKey })
        .eq('client_id', clientId)
        .eq('field_name', renamingKey);
      toast.success(`Renamed "${renamingKey}" → "${newKey}" in ${updated} contacts`);
      setRenamingKey(null);
      fetchFieldKeys();
      fetchCustomFieldDefs();
    } catch (err: any) {
      toast.error(err.message || 'Failed to rename field');
    }
  };

  const handleDeleteField = async (key: string) => {
    try {
      const pageSize = 500;
      let from = 0;
      let updated = 0;
      while (true) {
        const { data, error } = await supabase
          .from('leads')
          .select('id, custom_fields')
          .eq('client_id', clientId)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const row of data) {
          const cf = (row.custom_fields || {}) as Record<string, string>;
          if (key in cf) {
            const newCf = { ...cf };
            delete newCf[key];
            await (supabase.from('leads') as any).update({ custom_fields: newCf }).eq('id', row.id);
            updated++;
          }
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
      await (supabase as any)
        .from('client_custom_fields')
        .delete()
        .eq('client_id', clientId)
        .eq('field_name', key);
      toast.success(`Deleted "${key}" from ${updated} contacts`);
      fetchFieldKeys();
      fetchCustomFieldDefs();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete field');
    }
  };

  const handleAddField = async () => {
    const fieldName = newFieldName.trim();
    if (!fieldName) return;
    if (customFieldDefs.some(f => f.field_name === fieldName)) {
      toast.error('Field already exists');
      return;
    }
    try {
      const maxOrder = customFieldDefs.reduce((max, f) => Math.max(max, f.sort_order || 0), 0);
      const newSortOrder = maxOrder + 1;

      // Optimistic update
      const tempId = `temp-${Date.now()}`;
      setCustomFieldDefs(prev => [...prev, { id: tempId, field_name: fieldName, sort_order: newSortOrder }]);
      setNewFieldName('');

      const { data, error } = await (supabase as any)
        .from('client_custom_fields')
        .insert({ client_id: clientId, field_name: fieldName, sort_order: newSortOrder })
        .select('id, field_name, sort_order')
        .single();
      if (error) throw error;

      // Replace temp entry with real one
      setCustomFieldDefs(prev => prev.map(f => f.id === tempId ? data : f));
      toast.success(`Field "${fieldName}" added`);
    } catch (err: any) {
      // Rollback optimistic update
      setCustomFieldDefs(prev => prev.filter(f => f.field_name !== fieldName || !f.id.startsWith('temp-')));
      setNewFieldName(fieldName);
      toast.error(err.message || 'Failed to add field');
    }
  };

  // === Drag-to-reorder ===
  const handleDragStart = (type: 'field' | 'tag', index: number) => {
    setDragType(type);
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDragEnd = () => {
    setDragType(null);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleFieldDrop = async (dropIndex: number) => {
    if (dragIndex === null || dragType !== 'field') return;
    const reordered = [...customFieldDefs];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    setCustomFieldDefs(reordered);
    handleDragEnd();

    // Persist order
    try {
      await Promise.all(
        reordered.map((f, i) =>
          (supabase as any).from('client_custom_fields').update({ sort_order: i }).eq('id', f.id)
        )
      );
    } catch (err) {
      console.error('Failed to persist field order:', err);
    }
  };

  const handleTagDrop = async (dropIndex: number) => {
    if (dragIndex === null || dragType !== 'tag') return;
    const reordered = [...allTags];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    setAllTags(reordered);
    handleDragEnd();

    // Persist order
    try {
      await Promise.all(
        reordered.map((t, i) =>
          supabase.from('lead_tags').update({ sort_order: i } as any).eq('id', t.id)
        )
      );
      onTagsChanged?.();
    } catch (err) {
      console.error('Failed to persist tag order:', err);
    }
  };

  const defaultFields = allFieldKeys.filter(isDefaultField);
  const customFieldNames = new Set(customFieldDefs.map(f => f.field_name));
  const extraCustomKeys = allFieldKeys.filter(k => !isDefaultField(k) && !customFieldNames.has(k));
  const customFields = [...customFieldDefs.map(f => f.field_name), ...extraCustomKeys];

  // Shared row style for full-bleed hover — use padding only (no negative margins)
  // so overflow-y:auto on the scroll container doesn't clip the right side
  const fullBleedRow: React.CSSProperties = {
    paddingLeft: '20px',
    paddingRight: '20px',
  };

  return (
    <>
    <Dialog open={open && !pendingDelete} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg !p-0 max-h-[80vh] flex flex-col">
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle>CRM Settings</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pb-6 space-y-6" style={{ paddingTop: '20px' }}>

          {/* ── CUSTOM FIELDS ── */}
          <div>
            <div className="section-separator mb-4 px-5" style={{ marginRight: 0 }}>
              <span>Custom Fields</span>
            </div>

            {/* Add new custom field */}
            <div className="flex items-center gap-2 mb-3 px-5">
              <Input
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                placeholder="Field name..."
                className="h-8 flex-1"
                style={FIELD_FONT}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddField();
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddField}
                disabled={!newFieldName.trim()}
                className="h-8 shrink-0 gap-1"
                style={FIELD_FONT}
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </Button>
            </div>

            {/* Custom fields list */}
            {customFields.length > 0 && (
              <div className="space-y-0">
                {customFields.map((key, idx) => {
                  const isRenaming = renamingKey === key;
                  const defIndex = customFieldDefs.findIndex(f => f.field_name === key);
                  const isDraggableDef = defIndex >= 0;

                  if (isRenaming) {
                    return (
                      <div key={key} className="border border-border p-2.5 space-y-2 bg-muted/30 mx-5">
                        <Input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          className="h-8"
                          style={FIELD_FONT}
                          onKeyDown={(e) => e.key === 'Enter' && handleRenameField()}
                          autoFocus
                        />
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" className="h-7 flex-1" style={FIELD_FONT} onClick={() => setRenamingKey(null)}>Cancel</Button>
                          <Button size="sm" className="h-7 flex-1" style={FIELD_FONT} onClick={handleRenameField} disabled={!renameValue.trim() || renameValue.trim() === key}>Save</Button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={key}
                      draggable={isDraggableDef}
                      onDragStart={() => isDraggableDef && handleDragStart('field', defIndex)}
                      onDragOver={(e) => isDraggableDef && handleDragOver(e, defIndex)}
                      onDrop={() => isDraggableDef && handleFieldDrop(defIndex)}
                      onDragEnd={handleDragEnd}
                      className={`w-full flex items-center justify-between py-2 text-foreground hover:bg-muted/30 transition-colors ${
                        dragType === 'field' && dragOverIndex === defIndex ? 'border-t-2 border-primary' : ''
                      }`}
                      style={{
                        ...fullBleedRow,
                        cursor: isDraggableDef ? 'grab' : 'default',
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {isDraggableDef && (
                          <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span style={FIELD_FONT}>{key}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { setRenamingKey(key); setRenameValue(key); }}
                          className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50 cursor-pointer"
                          title="Rename field"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setPendingDelete({ type: 'field', id: key, name: key })}
                          className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center cursor-pointer"
                          title="Delete field from all contacts"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {customFields.length === 0 && (
              <p style={FIELD_FONT} className="text-muted-foreground py-2 text-center px-5">
                No custom fields yet.
              </p>
            )}

            {/* Default fields */}
            {defaultFields.length > 0 && (
              <div className="space-y-0 mt-3">
                <div className="section-separator mb-3 px-5" style={{ marginRight: 0 }}>
                  <span>Default Fields</span>
                </div>
                {defaultFields.map(key => (
                  <div
                    key={key}
                    className="w-full flex items-center justify-between py-2 text-muted-foreground"
                    style={{ ...fullBleedRow, ...FIELD_FONT }}
                  >
                    <span>{formatDefaultFieldLabel(key)}</span>
                    <Lock className="w-4 h-4 text-muted-foreground" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── TAGS ── */}
          <div>
            <div className="section-separator mb-4 px-5" style={{ marginRight: 0 }}>
              <span>Tags</span>
            </div>

            {/* Create new tag */}
            <div className="flex items-center gap-2 px-5">
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
                disabled={tagLoading || !newTagName.trim()}
                className="h-8 shrink-0 gap-1"
                style={FIELD_FONT}
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </Button>
            </div>

            {/* Color picker — only show when name is entered */}
            {newTagName.trim() && (
              <div className="space-y-2 mt-3 px-5">
                <Label className="field-text">Color</Label>
                <div className="space-y-3">
                  <div className="flex gap-2 items-center">
                    {newTagIsDefault ? (
                      <div
                        className="w-16 h-8 rounded border border-border bg-card cursor-pointer"
                        onClick={() => { setNewTagColor('#3b82f6'); setNewTagIsDefault(false); }}
                        title="Pick a color"
                      />
                    ) : (
                      <Input
                        type="color"
                        value={newTagColor}
                        onChange={(e) => { setNewTagColor(e.target.value); setNewTagIsDefault(false); }}
                        className="w-16 !h-8 cursor-pointer p-1"
                      />
                    )}
                    <Input
                      type="text"
                      value={newTagIsDefault ? '' : newTagColor}
                      onChange={(e) => { setNewTagColor(e.target.value); setNewTagIsDefault(false); }}
                      placeholder="Default"
                      className="flex-1 !h-8 field-text"
                    />
                    {newTagIsCustomColor ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="groove-btn field-text !h-8"
                        onClick={async () => {
                          const updated = customTagColors.includes(newTagColor) ? customTagColors : [...customTagColors, newTagColor];
                          if (updated.length !== customTagColors.length) await saveCustomTagColors(updated);
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
                        onClick={() => { setNewTagColor('#3b82f6'); setNewTagIsDefault(true); }}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Clear
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-9 gap-2">
                    <button
                      type="button"
                      onClick={() => { setNewTagColor('#3b82f6'); setNewTagIsDefault(true); }}
                      className="w-full h-8 rounded-md border border-border bg-card relative overflow-hidden transition-all hover:scale-105"
                      title="Default"
                    >
                      {newTagIsDefault && (
                        <div className="absolute inset-0 pointer-events-none rounded-md" style={{ border: '1px solid hsl(var(--foreground))', boxShadow: 'inset 0 0 0 1px hsl(var(--foreground) / 0.2)' }} />
                      )}
                    </button>
                    {PRESET_COLORS.map((presetColor) => (
                      <button
                        key={presetColor}
                        type="button"
                        onClick={() => { setNewTagColor(presetColor); setNewTagIsDefault(false); }}
                        className="w-full h-8 rounded-md border-2 transition-all hover:scale-105"
                        style={{ backgroundColor: presetColor, borderColor: !newTagIsDefault && newTagColor === presetColor ? 'hsl(var(--foreground))' : 'transparent' }}
                        title={presetColor}
                      />
                    ))}
                  </div>
                  {customTagColors.length > 0 && (
                    <div className="grid grid-cols-9 gap-2">
                      {customTagColors.map((cc, i) => (
                        <div key={`custom-${i}`} className="relative group/swatch">
                          <button
                            type="button"
                            onClick={() => { setNewTagColor(cc); setNewTagIsDefault(false); }}
                            className="w-full h-8 rounded-md border-2 transition-all hover:scale-105"
                            style={{ backgroundColor: cc, borderColor: !newTagIsDefault && newTagColor === cc ? 'hsl(var(--foreground))' : 'transparent' }}
                            title={cc}
                          />
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const updated = customTagColors.filter((_, idx) => idx !== i);
                              await saveCustomTagColors(updated);
                              if (!newTagIsDefault && newTagColor === cc) { setNewTagColor('#3b82f6'); setNewTagIsDefault(true); }
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
            )}

            {/* Tags list */}
            <div className="space-y-0 mt-3">
              {allTags.length === 0 ? (
                <p style={FIELD_FONT} className="text-muted-foreground py-3 text-center px-5">
                  No tags yet. Create one above.
                </p>
              ) : (
                allTags.map((tag, idx) => {
                  const isAssigned = contactId ? assignedTagIds.includes(tag.id) : false;
                  const isEditing = editingTagId === tag.id;

                  if (isEditing) {
                    return (
                      <div key={tag.id} className="border border-border p-3 space-y-3 bg-muted/30 mx-5">
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="h-8"
                          style={FIELD_FONT}
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveEditTag()}
                          autoFocus
                        />
                        <div className="space-y-2">
                          <Label className="field-text">Color</Label>
                          <div className="space-y-3">
                            <div className="flex gap-2 items-center">
                              {editingIsDefault ? (
                                <div
                                  className="w-16 h-8 rounded border border-border bg-card cursor-pointer"
                                  onClick={() => { setEditingColor('#3b82f6'); setEditingIsDefault(false); }}
                                  title="Pick a color"
                                />
                              ) : (
                                <Input
                                  type="color"
                                  value={editingColor}
                                  onChange={(e) => { setEditingColor(e.target.value); setEditingIsDefault(false); }}
                                  className="w-16 !h-8 cursor-pointer p-1"
                                />
                              )}
                              <Input
                                type="text"
                                value={editingIsDefault ? '' : editingColor}
                                onChange={(e) => { setEditingColor(e.target.value); setEditingIsDefault(false); }}
                                placeholder="Default"
                                className="flex-1 !h-8 field-text"
                              />
                              {editTagIsCustomColor ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="groove-btn field-text !h-8"
                                  onClick={async () => {
                                    const updated = customTagColors.includes(editingColor) ? customTagColors : [...customTagColors, editingColor];
                                    if (updated.length !== customTagColors.length) await saveCustomTagColors(updated);
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
                                  onClick={() => { setEditingColor('#3b82f6'); setEditingIsDefault(true); }}
                                >
                                  <X className="h-3 w-3 mr-1" />
                                  Clear
                                </Button>
                              )}
                            </div>
                            <div className="grid grid-cols-9 gap-2">
                              <button
                                type="button"
                                onClick={() => { setEditingColor('#3b82f6'); setEditingIsDefault(true); }}
                                className="w-full h-8 rounded-md border border-border bg-card relative overflow-hidden transition-all hover:scale-105"
                                title="Default"
                              >
                                {editingIsDefault && (
                                  <div className="absolute inset-0 pointer-events-none rounded-md" style={{ border: '1px solid hsl(var(--foreground))', boxShadow: 'inset 0 0 0 1px hsl(var(--foreground) / 0.2)' }} />
                                )}
                              </button>
                              {PRESET_COLORS.map((presetColor) => (
                                <button
                                  key={presetColor}
                                  type="button"
                                  onClick={() => { setEditingColor(presetColor); setEditingIsDefault(false); }}
                                  className="w-full h-8 rounded-md border-2 transition-all hover:scale-105"
                                  style={{ backgroundColor: presetColor, borderColor: !editingIsDefault && editingColor === presetColor ? 'hsl(var(--foreground))' : 'transparent' }}
                                  title={presetColor}
                                />
                              ))}
                            </div>
                            {customTagColors.length > 0 && (
                              <div className="grid grid-cols-9 gap-2">
                                {customTagColors.map((cc, i) => (
                                  <div key={`custom-${i}`} className="relative group/swatch">
                                    <button
                                      type="button"
                                      onClick={() => { setEditingColor(cc); setEditingIsDefault(false); }}
                                      className="w-full h-8 rounded-md border-2 transition-all hover:scale-105"
                                      style={{ backgroundColor: cc, borderColor: !editingIsDefault && editingColor === cc ? 'hsl(var(--foreground))' : 'transparent' }}
                                      title={cc}
                                    />
                                    <button
                                      type="button"
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        const updated = customTagColors.filter((_, idx) => idx !== i);
                                        await saveCustomTagColors(updated);
                                        if (!editingIsDefault && editingColor === cc) { setEditingColor('#3b82f6'); setEditingIsDefault(true); }
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
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" className="h-7 flex-1" style={FIELD_FONT} onClick={() => setEditingTagId(null)}>Cancel</Button>
                          <Button size="sm" className="h-7 flex-1" style={FIELD_FONT} onClick={handleSaveEditTag} disabled={!editingName.trim()}>Save</Button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={tag.id}
                      draggable
                      onDragStart={() => handleDragStart('tag', idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDrop={() => handleTagDrop(idx)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-2 py-1.5 hover:bg-muted/30 transition-colors group ${
                        dragType === 'tag' && dragOverIndex === idx ? 'border-t-2 border-primary' : ''
                      }`}
                      style={{
                        ...fullBleedRow,
                        cursor: 'grab',
                      }}
                    >
                      <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />

                      {contactId && (
                        <button
                          onClick={() => handleToggleTag(tag.id)}
                          className="flex items-center justify-center w-5 h-5 shrink-0 cursor-pointer groove-border"
                          style={isAssigned ? { backgroundColor: '#ffffff', borderColor: '#ffffff' } : undefined}
                        >
                          {isAssigned && <svg viewBox="0 0 16 15" fill="#000" shapeRendering="crispEdges" className="w-3 h-3"><rect x="1" y="5" width="3" height="3"/><rect x="3" y="7" width="3" height="3"/><rect x="5" y="9" width="3" height="3"/><rect x="7" y="7" width="3" height="3"/><rect x="9" y="5" width="3" height="3"/><rect x="11" y="3" width="3" height="3"/></svg>}
                        </button>
                      )}

                      <span
                        className="inline-flex items-center gap-1 border px-2 py-0.5 font-medium leading-none whitespace-nowrap truncate cursor-pointer [font-size:11px] [border-width:0.7px]"
                        style={{
                          backgroundColor: `${tag.color || '#6366f1'}26`,
                          borderColor: tag.color || '#6366f1',
                          color: '#FFFFFF',
                        }}
                        onClick={() => contactId && handleToggleTag(tag.id)}
                      >
                        {tag.name}
                      </span>

                      <div className="ml-auto flex items-center gap-1">
                        <button
                          onClick={() => handleStartEditTag(tag)}
                          className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50 cursor-pointer"
                          title="Edit tag"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setPendingDelete({ type: 'tag', id: tag.id, name: tag.name })}
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
      open={!!pendingDelete}
      onOpenChange={(isOpen) => {
        if (!isOpen) setPendingDelete(null);
      }}
      onConfirm={() => {
        if (pendingDelete?.type === 'field') {
          handleDeleteField(pendingDelete.id);
        } else if (pendingDelete?.type === 'tag') {
          handleDeleteTag(pendingDelete.id);
        }
        setPendingDelete(null);
      }}
      title={pendingDelete?.type === 'field' ? 'Delete Custom Field' : 'Delete Tag'}
      itemName={pendingDelete?.name}
    />
    </>
  );
};
