import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Send, Loader2, MessageSquare, Edit, Trash2, Save, X } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface LeadNote {
  id: string;
  content: string;
  color: string | null;
  created_at: string;
}

interface LeadNotesPanelProps {
  open: boolean;
  onClose: () => void;
  leadId: string;
  clientId: string;
  onNotesChanged?: () => void;
}

const DEFAULT_NOTE_COLOR = '#3b82f6';
const presetColors = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
];

export const LeadNotesPanel: React.FC<LeadNotesPanelProps> = ({
  open,
  onClose,
  leadId,
  clientId,
  onNotesChanged,
}) => {
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [sending, setSending] = useState(false);
  const notesEndRef = useRef<HTMLDivElement>(null);

  // Edit dialog state
  const [editNote, setEditNote] = useState<LeadNote | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editColor, setEditColor] = useState<string>(DEFAULT_NOTE_COLOR);
  const [editSaving, setEditSaving] = useState(false);
  const [customColors, setCustomColors] = useState<string[]>([]);
  const [isDefaultSwatchSelected, setIsDefaultSwatchSelected] = useState(false);

  // Delete confirmation state
  const [deleteConfirmNote, setDeleteConfirmNote] = useState<LeadNote | null>(null);
  const [deleteFromEdit, setDeleteFromEdit] = useState(false);

  const selectDefaultSwatch = () => {
    setEditColor(DEFAULT_NOTE_COLOR);
    setIsDefaultSwatchSelected(true);
  };

  const selectColorSwatch = (color: string) => {
    setEditColor(color);
    setIsDefaultSwatchSelected(false);
  };

  const allKnownColors = [...presetColors, ...customColors];
  const isCustomColor = !isDefaultSwatchSelected && !allKnownColors.includes(editColor);

  // Fetch custom colors from Supabase crm_filter_config
  const fetchCustomColors = useCallback(async () => {
    try {
      const { data } = await (supabase as any)
        .from('clients_public')
        .select('crm_filter_config')
        .eq('id', clientId)
        .single();
      const config = data?.crm_filter_config || {};
      setCustomColors(config.custom_note_colors || []);
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
        .update({ crm_filter_config: { ...config, custom_note_colors: colors } })
        .eq('id', clientId);
    } catch { /* ignore */ }
  }, [clientId]);

  useEffect(() => { fetchCustomColors(); }, [fetchCustomColors]);

  const fetchNotes = useCallback(async () => {
    if (!leadId || !clientId) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('lead_notes')
        .select('id, content, color, created_at')
        .eq('lead_id', leadId)
        .eq('client_id', clientId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setNotes(data || []);
      onNotesChanged?.();
    } catch (err: any) {
      console.error('Error fetching notes:', err);
    } finally {
      setLoading(false);
    }
  }, [leadId, clientId, onNotesChanged]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  useEffect(() => {
    if (notesEndRef.current) {
      notesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [notes]);

  const handleSend = async () => {
    if (!newNote.trim() || sending) return;
    setSending(true);
    try {
      const { error } = await (supabase as any)
        .from('lead_notes')
        .insert({ lead_id: leadId, client_id: clientId, content: newNote.trim() });
      if (error) throw error;
      setNewNote('');
      fetchNotes();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save note');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const openEditDialog = (note: LeadNote) => {
    setEditNote(note);
    setEditContent(note.content);
    if (note.color) {
      selectColorSwatch(note.color);
    } else {
      selectDefaultSwatch();
    }
  };

  const handleEditSave = async () => {
    if (!editNote || !editContent.trim() || editSaving) return;
    setEditSaving(true);
    try {
      if (isCustomColor && editColor) {
        const updated = customColors.includes(editColor) ? customColors : [...customColors, editColor];
        if (updated.length !== customColors.length) {
          await saveCustomColors(updated);
        }
      }
      const { error } = await (supabase as any)
        .from('lead_notes')
        .update({ content: editContent.trim(), color: isDefaultSwatchSelected ? null : editColor })
        .eq('id', editNote.id);
      if (error) throw error;
      setEditNote(null);
      fetchNotes();
      toast.success('Note updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update note');
    } finally {
      setEditSaving(false);
    }
  };

  const performDelete = async (note: LeadNote) => {
    setEditSaving(true);
    try {
      const { error } = await (supabase as any)
        .from('lead_notes')
        .delete()
        .eq('id', note.id);
      if (error) throw error;
      setDeleteConfirmNote(null);
      setEditNote(null);
      fetchNotes();
      toast.success('Note deleted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete note');
    } finally {
      setEditSaving(false);
    }
  };

  const handleEditDelete = () => {
    if (!editNote) return;
    const noteToDelete = editNote;
    setEditNote(null); // close edit dialog first
    setDeleteFromEdit(true);
    setTimeout(() => setDeleteConfirmNote(noteToDelete), 150);
  };

  if (!open) return null;

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Notes list */}
        <div className={`flex-1 p-4 space-y-4 ${!loading && notes.length === 0 ? 'overflow-hidden flex items-center justify-center' : 'overflow-y-auto'}`}>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : notes.length === 0 ? (
            <div className="flex flex-col items-center text-center">
              <MessageSquare className="w-12 h-12 text-primary mb-4" />
              <h3 className="text-lg font-medium">No notes</h3>
              <p className="text-sm text-muted-foreground mt-1">Leave internal notes.</p>
            </div>
          ) : (
            <>
              {notes.map((note) => (
                <div key={note.id} className="flex flex-col items-center">
                  <p
                    className="text-[11px] text-muted-foreground mb-1.5"
                    style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                  >
                    {format(new Date(note.created_at), 'MMM d, yyyy · h:mm a')}
                  </p>
                  <div
                    className="w-full px-3 py-2 rounded relative group cursor-pointer groove-border bg-card transition-all duration-200"
                    style={{
                      backgroundColor: note.color ? `${note.color}15` : undefined,
                    }}
                    onClick={() => openEditDialog(note)}
                  >
                    {note.color && (
                      <div
                        className="absolute inset-0 pointer-events-none rounded"
                        style={{
                          border: `1px solid ${note.color}`,
                          boxShadow: `inset 0 0 0 1px ${note.color}40`,
                        }}
                      />
                    )}
                    <p
                      className="text-sm text-foreground whitespace-pre-wrap break-words transition-all duration-200 group-hover:opacity-30 group-hover:blur-[1px]"
                      style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                    >
                      {note.content}
                    </p>
                    <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                      <button
                        type="button"
                        className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50 cursor-pointer pointer-events-auto"
                        title="Edit note"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditDialog(note);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center cursor-pointer pointer-events-auto"
                        title="Delete note"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteFromEdit(false);
                          setDeleteConfirmNote(note);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={notesEndRef} />
            </>
          )}
        </div>

        {/* Input */}
        <div className="p-3 border-t border-dashed border-border flex items-end gap-2 shrink-0">
          <textarea
            placeholder="Type a note..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={(e) => { e.currentTarget.rows = 4; e.currentTarget.style.height = 'auto'; e.currentTarget.style.lineHeight = '1.5'; e.currentTarget.style.paddingTop = '8px'; e.currentTarget.style.paddingBottom = '8px'; }}
            onBlur={(e) => { if (!e.currentTarget.value.trim()) { e.currentTarget.rows = 1; e.currentTarget.style.height = '32px'; e.currentTarget.style.lineHeight = '26px'; e.currentTarget.style.paddingTop = '0px'; e.currentTarget.style.paddingBottom = '0px'; } }}
            rows={1}
            disabled={sending}
            className="flex-1 field-text w-full bg-card px-3 text-foreground placeholder:text-muted-foreground outline-none focus:outline-none focus:ring-0 focus:shadow-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 groove-border resize-none transition-all duration-200"
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', letterSpacing: '0.3px', height: '32px', lineHeight: '26px', paddingTop: '0px', paddingBottom: '0px' }}
          />
          <Button
            onClick={handleSend}
            disabled={sending || !newNote.trim()}
            size="icon"
            className="h-8 w-8 groove-btn shrink-0"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Edit Note Dialog — matches CustomMetricDialog style */}
      <Dialog open={!!editNote} onOpenChange={(isOpen) => { if (!isOpen) setEditNote(null); }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto !p-0">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '24px' }}>
              EDIT NOTE
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 p-6">
            <div className="space-y-2">
              <Label className="field-text">Content</Label>
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={4}
                className="block min-h-[100px] field-text"
                placeholder="Note content..."
              />
            </div>

            <div className="space-y-2">
              <Label className="field-text">Color</Label>
              <div className="space-y-3">
                <div className="flex gap-2 items-center">
                  {isDefaultSwatchSelected ? (
                    <div
                      className="w-16 h-8 rounded border border-border bg-card cursor-pointer"
                      onClick={() => selectColorSwatch(DEFAULT_NOTE_COLOR)}
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
                    value={isDefaultSwatchSelected ? '' : editColor}
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
                    {isDefaultSwatchSelected && (
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
                        borderColor: !isDefaultSwatchSelected && editColor === presetColor ? 'hsl(var(--foreground))' : 'transparent',
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
                            borderColor: !isDefaultSwatchSelected && editColor === cc ? 'hsl(var(--foreground))' : 'transparent',
                          }}
                          title={cc}
                        />
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const updated = customColors.filter((_, idx) => idx !== i);
                            await saveCustomColors(updated);
                            if (!isDefaultSwatchSelected && editColor === cc) selectDefaultSwatch();
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
                onClick={handleEditDelete}
                disabled={editSaving}
                size="sm"
                className="flex-1 groove-btn groove-btn-destructive field-text"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                DELETE
              </Button>
              <Button
                onClick={handleEditSave}
                disabled={editSaving || !editContent.trim()}
                size="sm"
                className="flex-1 groove-btn field-text"
              >
                <Save className="h-3.5 w-3.5 mr-1.5" />
                {editSaving ? 'SAVING...' : 'UPDATE'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmNote} onOpenChange={(isOpen) => {
        if (!isOpen) {
          const noteToReopen = deleteConfirmNote;
          const wasFromEdit = deleteFromEdit;
          setDeleteConfirmNote(null);
          setDeleteFromEdit(false);
          if (wasFromEdit && noteToReopen) {
            setTimeout(() => openEditDialog(noteToReopen), 150);
          }
        }
      }}>
        <DialogContent className="max-w-md !p-0">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '24px' }}>
              DELETE NOTE
            </DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-6">
            <p className="text-sm text-muted-foreground leading-relaxed field-text">
              Are you sure you want to delete this note? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button
                variant="default"
                className="flex-1"
                onClick={() => setDeleteConfirmNote(null)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 groove-btn groove-btn-destructive field-text"
                onClick={() => deleteConfirmNote && performDelete(deleteConfirmNote)}
                disabled={editSaving}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
