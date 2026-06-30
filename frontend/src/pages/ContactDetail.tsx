import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, type NavigateOptions } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { normalizePhone } from '@/lib/normalizePhone';
import { autoSplitContactName } from '@/utils/contactNameSplitter';
import { useLeadErrorAlert } from '@/hooks/useLeadErrorAlert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { toast } from 'sonner';
import { CrmSettingsDialog } from '@/components/contacts/CrmSettingsDialog';
import { TagManager } from '@/components/contacts/TagManager';
import { StatusTag } from '@/components/StatusTag';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import { ContactConversationHistory } from '@/components/contacts/ContactConversationHistory';
import { LeadNotesPanel } from '@/components/contacts/LeadNotesPanel';
import { useClientCredentials } from '@/hooks/useClientCredentials';
import { useCreatorMode } from '@/hooks/useCreatorMode';
import SavingOverlay from '@/components/SavingOverlay';
import RetroLoader from '@/components/RetroLoader';
import {
  buildCustomFieldsFromData,
  buildEditableContactData,
  buildExternalContactSyncPayload,
  createCanonicalLeadId,
  getCanonicalLeadId,
  ContactTag as ContactTagType,
} from '@/utils/contactId';
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  Sparkles,
  Wand2,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronUp,
  Settings,
  Filter,
  Save,
  Copy,
  FileText,
  BookOpen,
  X,
  Plus,
  AlertTriangle,
  Square,
  Play,
  Calendar,
} from '@/components/icons';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LaunchWorkflowDialog } from '@/components/LaunchWorkflowDialog';
import { Zap } from '@/components/icons';
import { format } from 'date-fns';
import { useNavigationGuard } from '@/contexts/NavigationGuardContext';

const PixelTagIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    shapeRendering="crispEdges"
    aria-hidden="true"
    {...props}
  >
    <rect x="7" y="3" width="2" height="18" />
    <rect x="15" y="3" width="2" height="18" />
    <rect x="3" y="7" width="18" height="2" />
    <rect x="3" y="15" width="18" height="2" />
  </svg>
);

const PixelFilterIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    shapeRendering="crispEdges"
    aria-hidden="true"
    {...props}
  >
    <path d="M4 6h16v2H4V6zm2 5h12v2H6v-2zm3 5h6v2H9v-2z" />
  </svg>
);

interface Contact {
  id: string;
  client_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  business_name: string | null;
  custom_fields: Record<string, any> | null;
  tags: ContactTagType[] | null;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
  phone_valid?: boolean;
}


interface ContactTag {
  id: string;
  name: string;
  color: string;
}

const ContactDetail = () => {
  const { clientId, contactId } = useParams();
  const navigate = useNavigate();
  const { credentials, isLoading: credentialsLoading } = useClientCredentials(clientId);
  const { cb } = useCreatorMode();
  const { registerGuard, unregisterGuard } = useNavigationGuard();

  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatLoaded, setChatLoaded] = useState(false);
  // Error alert handled by hook below

  const [contactIds, setContactIds] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [clientFieldKeys, setClientFieldKeys] = useState<string[]>([]);

  const [editData, setEditData] = useState<Record<string, string>>({});
  const editDataRef = useRef<Record<string, string>>({});
  const [originalEditData, setOriginalEditData] = useState<Record<string, string>>({});
  const [hideEmpty, setHideEmpty] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>({
    contact: true,
    additional: true,
    system: true,
    ai: true,
    bookings: true,
  });
  const [sectionsLoaded, setSectionsLoaded] = useState(false);

  const [showCrmSettings, setShowCrmSettings] = useState(false);
  const [showTagSettings, setShowTagSettings] = useState(false);
  const [assignedTags, setAssignedTags] = useState<ContactTag[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stoppingBot, setStoppingBot] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [setterStopped, setSetterStopped] = useState(false);

  // Sync setter_stopped from contact data
  useEffect(() => {
    if (contact) {
      setSetterStopped(!!(contact as any).setter_stopped);
    }
  }, [contact]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesStateLoaded, setNotesStateLoaded] = useState(false);
  const [showWorkflowDialog, setShowWorkflowDialog] = useState(false);

  // Bookings state
  interface Booking {
    id: string;
    title: string | null;
    start_time: string | null;
    end_time: string | null;
    status: string;
    location: string | null;
    notes: string | null;
    setter_name: string | null;
    setter_type: string | null;
    cancellation_link: string | null;
    reschedule_link: string | null;
    ghl_booking_id: string | null;
    ghl_contact_id: string | null;
    calendar_id: string | null;
    campaign_id: string | null;
    created_at: string;
  }
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  const fetchBookings = useCallback(async () => {
    if (!contactId) return;
    const { data } = await supabase
      .from('bookings')
      .select('id, title, start_time, end_time, status, location, notes, setter_name, setter_type, cancellation_link, reschedule_link, ghl_booking_id, ghl_contact_id, calendar_id, campaign_id, created_at')
      .eq('lead_id', contactId)
      .order('start_time', { ascending: false });
    setBookings((data as Booking[]) || []);
  }, [contactId]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  // Track dirty state
  const handleEditDataChange = useCallback((key: string, value: string) => {
    setEditData(prev => {
      const next = { ...prev, [key]: value };
      editDataRef.current = next;
      return next;
    });
    setIsDirty(true);
  }, []);

  // Block navigation when dirty - manual approach since we use BrowserRouter
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const pendingNavigationRef = useRef<(() => void) | null>(null);

  const requestNavigation = useCallback((action: () => void) => {
    if (isDirty) {
      pendingNavigationRef.current = action;
      setShowUnsavedDialog(true);
      return;
    }

    action();
  }, [isDirty]);

  const safeNavigate = useCallback((path: string, options?: NavigateOptions) => {
    requestNavigation(() => navigate(path, options));
  }, [navigate, requestNavigation]);

  // Warn on browser close/refresh
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) {
      unregisterGuard();
      return;
    }

    registerGuard((proceed) => {
      pendingNavigationRef.current = proceed;
      setShowUnsavedDialog(true);
      return true;
    });

    return () => unregisterGuard();
  }, [isDirty, registerGuard, unregisterGuard]);

  // Per-lead error alert
  const leadGhlId = contact?.lead_id || contactId || null;
  const [ghlLocationId, setGhlLocationId] = useState<string | null>(null);
  useEffect(() => {
    if (!clientId) return;
    supabase.from('clients_public').select('ghl_location_id').eq('id', clientId).single().then(({ data }) => {
      setGhlLocationId(data?.ghl_location_id || null);
    });
  }, [clientId]);
  const { activeError, dismissError } = useLeadErrorAlert(clientId, leadGhlId, ghlLocationId);

  // Retry failed execution state
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);
  const [retryExecutionId, setRetryExecutionId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [erroredExecutionId, setErroredExecutionId] = useState<string | null>(null);

  useEffect(() => {
    if (!leadGhlId) {
      setErroredExecutionId(null);
      return;
    }
    const fetchErroredExec = async () => {
      const { data } = await supabase
        .from('dm_executions')
        .select('id, status')
        .eq('lead_id', leadGhlId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setErroredExecutionId(data?.status === 'failed' ? data.id : null);
    };
    fetchErroredExec();
  }, [leadGhlId, activeError]);

  const handleRetryExecution = useCallback(async () => {
    if (!retryExecutionId) return;
    setRetryDialogOpen(false);
    setRetrying(true);
    try {
      const { data, error } = await supabase.functions.invoke('retry-dm-execution', {
        body: { execution_id: retryExecutionId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Retrying — new execution created');
      setErroredExecutionId(null);
      dismissError();
    } catch (err: any) {
      console.error('Retry failed:', err);
      toast.error(err.message || 'Failed to retry execution');
    } finally {
      setRetrying(false);
    }
  }, [retryExecutionId, dismissError]);

  usePageHeader({
    containerClassName: notesOpen ? 'max-w-[1600px]' : 'max-w-7xl',
    title: 'LEADS',
    breadcrumbs: [
      { label: 'LEADS', onClick: () => safeNavigate(`/client/${clientId}/leads`) },
      { label: 'Lead Details' },
    ],
    leftExtra: (
      <div className="flex items-center ml-3" style={{ gap: '12px' }}>
        <button
          className={`groove-btn flex items-center justify-center !h-8 !w-8 !p-0 shrink-0 ${hideEmpty ? '!bg-accent' : ''}`}
          onClick={() => setHideEmpty(prev => !prev)}
          title="Filter empty fields"
        >
          <Filter className="w-4 h-4" />
        </button>
        <button
          className="groove-btn flex items-center justify-center !h-8 !w-8 !p-0 shrink-0"
          onClick={() => setShowCrmSettings(true)}
          title="CRM Settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 groove-btn"
            disabled={currentIndex <= 0}
            onClick={() => navigateToContact('prev')}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 groove-btn"
            disabled={currentIndex >= contactIds.length - 1}
            onClick={() => navigateToContact('next')}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    ),
    actions: [
      ...(erroredExecutionId && activeError ? [{
        label: 'RETRY',
        icon: <RefreshCw className="w-4 h-4" />,
        onClick: () => { setRetryExecutionId(erroredExecutionId); setRetryDialogOpen(true); },
        variant: 'destructive' as const,
        className: 'groove-btn groove-btn-destructive',
      }] : []),
      {
        label: stoppingBot ? (setterStopped ? 'ACTIVATING...' : 'STOPPING...') : (setterStopped ? 'ACTIVATE SETTER' : 'STOP SETTER'),
        icon: stoppingBot ? <Loader2 className="w-4 h-4 animate-spin" /> : (setterStopped ? <Play className="w-4 h-4" /> : <Square className="w-4 h-4" />),
        onClick: () => setShowStopConfirm(true),
        className: setterStopped ? 'groove-btn-pulse' : 'groove-btn',
        disabled: stoppingBot,
      },
      {
        label: 'LAUNCH CAMPAIGN',
        icon: <Zap className="w-4 h-4" />,
        onClick: () => setShowWorkflowDialog(true),
        className: 'groove-btn',
      },
      {
        label: notesOpen ? 'CLOSE NOTES' : 'OPEN NOTES',
        icon: notesOpen ? <X className="w-4 h-4" /> : <FileText className="w-4 h-4" />,
        onClick: () => {
          const next = !notesOpen;
          setNotesOpen(next);
          if (clientId) {
            supabase
              .from('clients_public')
              .select('crm_filter_config')
              .eq('id', clientId)
              .single()
              .then(({ data }) => {
                const existing = (data?.crm_filter_config || {}) as Record<string, any>;
                supabase
                  .from('clients')
                  .update({ crm_filter_config: { ...existing, notes_panel_open: next } })
                  .eq('id', clientId)
                  .then(() => {});
              });
          }
        },
        className: 'groove-btn',
      },
      {
        label: 'SAVE',
        icon: <Save className="w-4 h-4" />,
        onClick: () => handleSaveContact(),
        className: isDirty ? 'groove-btn-positive' : 'groove-btn opacity-50 pointer-events-none',
        disabled: !isDirty || saving,
      },
      {
        label: '',
        icon: <Trash2 className="w-4 h-4" />,
        onClick: () => setShowDeleteConfirm(true),
        variant: 'outline' as const,
        className: '!w-8 !h-8 !p-0 groove-btn-destructive',
      },
    ],
  }, [currentIndex, totalCount, contactIds.length, hideEmpty, isDirty, saving, notesOpen, erroredExecutionId, activeError]);

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', contactId)
        .single();
      if (error) throw error;
      const cf = (data.custom_fields || {}) as Record<string, any>;
      const tagsArr = (Array.isArray(data.tags) ? data.tags : []) as unknown as ContactTagType[];

      const normalizedContact = {
        ...(data as any),
        custom_fields: cf,
        tags: tagsArr,
      } as Contact;
      const mergedEditData = buildEditableContactData(normalizedContact);

      setContact(normalizedContact);
      setEditData(mergedEditData);
      editDataRef.current = mergedEditData;
      setOriginalEditData({ ...mergedEditData });
      setIsDirty(false);
    } catch (err) {
      console.error('Error fetching contact:', err);
      setContact(null);
      toast.error('Failed to load contact');
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  const fetchContactIds = useCallback(async () => {
    if (!clientId) return;
    const { data, count } = await supabase
      .from('leads')
      .select('id', { count: 'exact' })
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    if (data) {
      const ids = data.map((d) => d.id);
      setContactIds(ids);
      setTotalCount(count || ids.length);
      const idx = ids.findIndex((id) => id === contactId);
      if (idx >= 0) setCurrentIndex(idx);
    }
  }, [clientId, contactId]);

  const fetchClientFieldKeys = useCallback(async () => {
    if (!clientId) return;
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
      // Fetch custom field definitions with sort order
      const { data: customDefs } = await (supabase as any)
        .from('client_custom_fields')
        .select('field_name, sort_order')
        .eq('client_id', clientId)
        .order('sort_order');
      const orderedFieldNames: string[] = [];
      if (customDefs) {
        customDefs.forEach((def: { field_name: string }) => {
          orderedFieldNames.push(def.field_name);
          keys.add(def.field_name);
        });
      }
      // Build ordered list: defined fields first (by sort_order), then remaining alphabetical
      const definedSet = new Set(orderedFieldNames);
      const remaining = Array.from(keys).filter(k => !definedSet.has(k)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      setClientFieldKeys([...orderedFieldNames, ...remaining]);
    } catch (err) {
      console.error('Error fetching client field keys:', err);
    }
  }, [clientId]);


  const fetchAssignedTags = useCallback(async () => {
    if (!contactId) return;
    const { data } = await supabase
      .from('lead_tag_assignments')
      .select('tag_id, lead_tags(id, name, color, sort_order)')
      .eq('lead_id', contactId);
    if (data) {
      const tags = data
        .map((d: any) => d.lead_tags)
        .filter(Boolean) as ContactTag[];
      // Sort tags by their sort_order from the contact_tags table
      tags.sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      setAssignedTags(tags);
    }
  }, [contactId]);

  // Load persisted section collapse states from client settings
  useEffect(() => {
    if (!clientId) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('clients_public')
          .select('crm_filter_config')
          .eq('id', clientId)
          .single();
        const config = (data?.crm_filter_config || {}) as Record<string, any>;
        if (config.contact_sections_open) {
          setSectionsOpen(prev => ({ ...prev, ...config.contact_sections_open }));
        }
        if (typeof config.notes_panel_open === 'boolean') {
          setNotesOpen(config.notes_panel_open);
        }
        setNotesStateLoaded(true);
      } catch (err) {
        console.error('Error loading section states:', err);
      } finally {
        setSectionsLoaded(true);
      }
    })();
  }, [clientId]);

  

  useEffect(() => {
    setLoading(true);
    setContact(null);
    setChatLoaded(false);
    fetchContact();
    fetchContactIds();
    fetchClientFieldKeys();
    fetchAssignedTags();
  }, [fetchContact, fetchContactIds, fetchClientFieldKeys, fetchAssignedTags]);


  const navigateToContact = (direction: 'prev' | 'next') => {
    const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex >= 0 && newIndex < contactIds.length) {
      safeNavigate(`/client/${clientId}/leads/${contactIds[newIndex]}`);
    }
  };

  const handleSaveContact = async () => {
    if (!contact || !isDirty) return;
    setSaving(true);
    try {
      const canonicalContactId = getCanonicalLeadId(contact) || createCanonicalLeadId();
      const currentData = { ...editDataRef.current };
      const customFields = buildCustomFieldsFromData(currentData);

      // Build tags as jsonb array of objects
      const tagsPayload = assignedTags.map((tag) => ({
        name: tag.name,
        color: tag.color || '#646E82',
      }));

      const updatePayload = {
        lead_id: canonicalContactId,
        first_name: currentData['first_name'] || null,
        last_name: currentData['last_name'] || null,
        email: currentData['email'] || null,
        phone: currentData['phone'] || null,
        // PHONE-CLEAR-1: recompute normalized_phone whenever phone is saved so clearing
        // or changing the number also clears/updates the by-phone (inbound/STOP) match
        // key. A cleared phone -> null (was: the stale +61… value lingered).
        normalized_phone: normalizePhone(currentData['phone'] || null),
        business_name: currentData['business_name'] || null,
        custom_fields: customFields,
        tags: tagsPayload,
      };

      // 1. Save to internal Supabase
      const { error } = await (supabase
        .from('leads') as any)
        .update(updatePayload)
        .eq('id', contact.id);
      if (error) throw error;

      // 2. Push to external Supabase (push-contact-to-external reads creds server-side)
      if (credentials?.has_supabase_service_key) {
        try {
          await supabase.functions.invoke('push-contact-to-external', {
            body: {
              clientId,
              externalId: canonicalContactId,
              contactData: buildExternalContactSyncPayload(currentData, {
                customFields,
                tags: tagsPayload,
              }),
            },
          });
        } catch (extErr) {
          console.error('External push failed (non-blocking):', extErr);
        }
      }

      // 3. Push to GHL (canonical contact source). Echo-loop prevention is
      // handled inside push-contact-to-ghl by bumping leads.updated_at; if a
      // GHL contact-update webhook fires within ~30s of our push, sync-ghl-
      // contact can debounce it.
      if (canonicalContactId && /^[a-zA-Z0-9_-]{10,}$/.test(canonicalContactId)) {
        try {
          await supabase.functions.invoke('push-contact-to-ghl', {
            body: {
              clientId,
              contactId: canonicalContactId,
              contact: {
                first_name: updatePayload.first_name,
                last_name: updatePayload.last_name,
                email: updatePayload.email,
                phone: updatePayload.phone,
                business_name: updatePayload.business_name,
                custom_fields: customFields,
                tags: tagsPayload?.map(t => t.name).filter(Boolean),
              },
            },
          });
        } catch (ghlErr) {
          console.error('GHL push failed (non-blocking):', ghlErr);
        }
      }

      setContact(prev => prev ? { ...prev, ...updatePayload } : prev);
      setOriginalEditData({ ...currentData });
      editDataRef.current = currentData;
      setIsDirty(false);
      toast.success('Lead saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save contact');
    } finally {
      setSaving(false);
    }
  };


  const handleDeleteContact = async () => {
    if (!contact) return;
    try {
      const { error } = await supabase.from('leads').delete().eq('id', contact.id);
      if (error) throw error;
      toast.success('Lead deleted');
      navigate(`/client/${clientId}/contacts`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete contact');
    }
  };

  const toggleSection = async (section: string) => {
    const newState = { ...sectionsOpen, [section]: !sectionsOpen[section] };
    setSectionsOpen(newState);
    if (!clientId) return;
    try {
      const { data } = await supabase
        .from('clients_public')
        .select('crm_filter_config')
        .eq('id', clientId)
        .single();
      const existing = (data?.crm_filter_config || {}) as Record<string, any>;
      await supabase
        .from('clients')
        .update({ crm_filter_config: { ...existing, contact_sections_open: newState } })
        .eq('id', clientId);
    } catch (err) {
      console.error('Error saving section state:', err);
    }
  };

  const getName = () => {
    const first = contact?.first_name || editData['first_name'] || '';
    const last = contact?.last_name || editData['last_name'] || '';
    if (first || last) return `${first} ${last}`.trim();
    return 'Unknown Contact';
  };

  const clean = (val: string | undefined) => (!val || val === 'null') ? '' : val;

  const getEmail = () => {
    return clean(contact?.email) || '';
  };

  const getPhone = () => {
    return clean(contact?.phone) || '';
  };

  const systemFieldKeys = new Set([
    'created_at', 'Created', 'created', 'createdAt',
    'contact_id', 'Contact Id', 'contactId', 'id', 'Id', 'ID', 'session_id', 'Session Id', 'sessionId',
    'contact_id', 'Contact Id', 'contactId', 'id', 'Id', 'ID', 'session_id', 'Session Id', 'sessionId',
    'updated_at', 'Updated', 'updated', 'updatedAt', 'custom_fields', 'Custom Fields', '_synced_from_external', 'Synced From External',
    'tags', 'Tags',
  ]);

  const normalizeKey = (value: string) => value.toLowerCase().replace(/[\s_]/g, '');

  const resolveFieldKey = (aliases: string[], fallbackKey: string) => {
    const existingKey = Object.keys(editData).find((key) =>
      aliases.some((alias) => normalizeKey(alias) === normalizeKey(key))
    );
    return existingKey || fallbackKey;
  };

  const baseFieldAliases = {
    contactName: ['contact_name', 'Contact Name', 'contactName', 'full_name', 'fullName', 'name', 'Name'],
    firstName: ['First Name', 'first_name', 'firstName'],
    lastName: ['Last Name', 'last_name', 'lastName'],
    email: ['Email', 'email', 'Email Address', 'email_address'],
    phone: ['Phone', 'phone', 'Phone Number', 'phone_number'],
    businessName: ['Business Name', 'business_name', 'Company', 'company', 'Company Name', 'company_name', 'Organization'],
  };

  const baseFields = [
    { label: 'First Name', key: resolveFieldKey(baseFieldAliases.firstName, 'first_name') },
    { label: 'Last Name', key: resolveFieldKey(baseFieldAliases.lastName, 'last_name') },
    { label: 'Email', key: resolveFieldKey(baseFieldAliases.email, 'email') },
    { label: 'Phone', key: resolveFieldKey(baseFieldAliases.phone, 'phone') },
  ];

  const businessNameField = { label: 'Business Name', key: resolveFieldKey(baseFieldAliases.businessName, 'business_name') };

  const baseFieldSet = new Set(Object.values(baseFieldAliases).flat().map((alias) => normalizeKey(alias)));

  const candidateExtraKeys = Array.from(new Set([...clientFieldKeys, ...Object.keys(editData)]));

  const extraFields = candidateExtraKeys
    .filter((key) => !systemFieldKeys.has(key) && !baseFieldSet.has(normalizeKey(key)))
    .sort((a, b) => {
      // Respect clientFieldKeys order (which is already sorted by sort_order from DB)
      const ia = clientFieldKeys.indexOf(a);
      const ib = clientFieldKeys.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    })
    .map((key) => ({ label: key, key }));

  // Business name at top, then all extra fields
  const additionalFields = [businessNameField, ...extraFields];

  const visibleBaseFields = hideEmpty
    ? baseFields.filter((field) => (editData[field.key] || '').toString().trim().length > 0)
    : baseFields;

  const visibleAdditionalFields = hideEmpty
    ? additionalFields.filter((field) => (editData[field.key] || '').toString().trim().length > 0)
    : additionalFields;

  const getExternalContactId = () => {
    return getCanonicalLeadId(contact) || '';
  };

  const systemFields = [
    {
      key: 'created_at',
      label: 'Created',
      rawValue: contact?.created_at || '',
      displayValue: contact?.created_at
        ? new Date(contact.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit',
          }).toUpperCase()
        : '',
    },
    {
      key: 'lead_id',
      label: 'Lead ID',
      rawValue: getExternalContactId() || contact?.id || '',
      displayValue: getExternalContactId() || contact?.id || '',
    },
  ];

  const visibleSystemFields = hideEmpty
    ? systemFields.filter((field) => field.rawValue.toString().trim().length > 0)
    : systemFields;


  const isPageBootstrapping = loading || credentialsLoading || (!!contactId && contact?.id !== contactId);

  if (isPageBootstrapping) {
    return <RetroLoader />;
  }

  if (!contact) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 gap-4">
        <p style={{ fontSize: '13px' }} className="text-muted-foreground">Contact not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate(`/client/${clientId}/contacts`)}>
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to Contacts
        </Button>
      </div>
    );
  }

  const SECTION_TITLE_STYLE: React.CSSProperties = { fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500, letterSpacing: '2px', textTransform: 'uppercase' as const };

  return (
    <>
      {!chatLoaded && <RetroLoader />}
      <div className="h-full overflow-hidden bg-background flex flex-col relative">
      <div className={`container mx-auto flex flex-col h-full pt-6 ${notesOpen ? 'max-w-[1600px]' : 'max-w-7xl'}`} style={{ paddingBottom: '24px' }}>
        <div className="flex gap-6 flex-1 min-h-0">

          {/* Left Column - Contact Info (single groove-border block) */}
          <div className="w-80 shrink-0 groove-border bg-card flex flex-col overflow-hidden">

            {/* Header: Name only (actions live in sticky page header) */}
            <div className="p-3 border-b border-dashed border-border shrink-0">
              <div className="flex items-center gap-2">
                <p className={`flex-1 min-w-0 truncate text-foreground font-medium field-text ${cb}`}>
                  {getName()}
                </p>
              </div>
              {/* Tags below name */}
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                {assignedTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center border px-2 py-0.5 font-medium leading-none whitespace-nowrap [font-size:11px] [border-width:0.7px]"
                    style={{
                      backgroundColor: `${tag.color || '#6366f1'}26`,
                      borderColor: tag.color || '#6366f1',
                      color: '#FFFFFF',
                    }}
                  >
                    {tag.name}
                  </span>
                ))}
                <button
                  onClick={() => setShowTagSettings(true)}
                  className="w-4 h-4 rounded-full bg-muted border border-border flex items-center justify-center hover:bg-accent transition-colors cursor-pointer"
                  title="Manage tags"
                >
                  <Plus className="w-2.5 h-2.5 text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto pb-3">

              {/* Bookings section */}
              {bookings.length > 0 && (
                <div className="px-4 pt-3">
                  <button
                    onClick={() => toggleSection('bookings')}
                    className="w-full flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer section-separator"
                    style={{ marginRight: 0 }}
                  >
                    <span className="whitespace-nowrap">Bookings</span>
                    {sectionsOpen.bookings ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                  {sectionsOpen.bookings && (
                    <div className="mt-2 space-y-1.5">
                      {bookings.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => setSelectedBooking(b)}
                          className="w-full flex items-center gap-2 py-1.5 hover:bg-accent/50 transition-colors cursor-pointer text-left"
                        >
                          <span className="flex-1 min-w-0 truncate field-text text-foreground">
                            {b.title || 'Appointment'}
                          </span>
                          <span className="field-text text-muted-foreground shrink-0">
                            {b.start_time ? new Date(b.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Contact Fields */}
              <div className="px-4 pt-3 space-y-3">
                {visibleBaseFields.map((field) => {
                  const fieldValue = editData[field.key] || '';
                  const isCopyable = fieldValue.trim().length > 0;
                  return (
                    <div key={field.key} className="space-y-1">
                      <Label className="field-text">{field.label}</Label>
                      <div className="relative">
                         <Input
                          value={fieldValue}
                          onChange={(e) => handleEditDataChange(field.key, e.target.value)}
                          placeholder={`Enter ${field.label.toLowerCase()}`}
                          className={`field-text pr-8 ${cb}`}
                          disabled={saving}
                        />
                        {isCopyable && (
                          <button
                            type="button"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-opacity"
                            title={`Copy ${field.label.toLowerCase()}`}
                            onClick={() => { navigator.clipboard.writeText(fieldValue); toast.success(`${field.label} copied`); }}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {field.label === 'Phone' && contact?.phone_valid === false && (
                        <div className="flex items-center gap-1.5 mt-1 px-0.5">
                          <svg viewBox="0 0 24 24" fill="none" stroke="hsl(40 90% 55%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
                          <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', color: 'hsl(40 90% 55%)' }}>
                            Phone number format may be invalid
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
                {visibleBaseFields.length === 0 && (
                  <p className="text-muted-foreground field-text">
                    No fields match the current filter.
                  </p>
                )}
              </div>

              {/* Additional Info section */}
              <div className="px-4" style={{ paddingTop: '12px' }}>
                <button
                  onClick={() => toggleSection('additional')}
                  className="w-full flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer section-separator"
                  style={{ marginRight: 0 }}
                >
                  <span className="whitespace-nowrap">Additional Info</span>
                  {sectionsOpen.additional ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
                </button>
                {sectionsOpen.additional && (
                  <div style={{ paddingTop: '12px' }} className="space-y-3">
                    {visibleAdditionalFields.map((field) => {
                      const fieldValue = editData[field.key] || '';
                      const isCopyable = fieldValue.trim().length > 0;
                      return (
                        <div key={field.key} className="space-y-1">
                          <Label className="field-text">{field.label}</Label>
                          <div className="relative">
                            <Input
                              value={fieldValue}
                              onChange={(e) => handleEditDataChange(field.key, e.target.value)}
                              placeholder={`Enter ${field.label.toLowerCase()}`}
                              className={`field-text pr-8 ${cb}`}
                              disabled={saving}
                            />
                            {isCopyable && (
                              <button
                                type="button"
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-opacity"
                                title={`Copy ${field.label.toLowerCase()}`}
                                onClick={() => { navigator.clipboard.writeText(fieldValue); toast.success(`${field.label} copied`); }}
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {visibleAdditionalFields.length === 0 && (
                      <p className="text-muted-foreground field-text">
                        {hideEmpty ? 'No fields match the current filter.' : 'No additional fields available yet.'}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* System Info section */}
              <div className="px-4" style={{ paddingTop: '12px' }}>
                <button
                  onClick={() => toggleSection('system')}
                  className="w-full flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer section-separator"
                  style={{ marginRight: 0 }}
                >
                  <span className="whitespace-nowrap">System Info</span>
                  {sectionsOpen.system ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
                </button>
                {sectionsOpen.system && (
                  <div style={{ paddingTop: '12px' }} className="space-y-3">
                    {visibleSystemFields.map((field) => (
                      <div key={field.key} className="space-y-1.5">
                        <Label className="field-text">{field.label}</Label>
                        <div>
                          <span
                            className="cursor-pointer"
                            title="Click to copy"
                            onClick={() => {
                              navigator.clipboard.writeText(field.rawValue);
                              toast.success('Copied to clipboard');
                            }}
                          >
                            <StatusTag variant="neutral"><span className={cb}>{field.displayValue}</span></StatusTag>
                          </span>
                        </div>
                      </div>
                    ))}
                    {visibleSystemFields.length === 0 && (
                      <p className="text-muted-foreground field-text">
                        No fields match the current filter.
                      </p>
                    )}
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* Right Column - Conversation (same layout as Simulator results) */}
          <div className="flex-1 groove-border bg-card flex flex-col overflow-hidden">
            {/* Error warning banner */}
            {activeError && (
              <div className="flex items-center justify-center gap-2 px-3 py-2 bg-destructive/15 border-b border-destructive/30 text-destructive shrink-0">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="text-xs flex-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
                  There was an error processing a message for this lead.{' '}
                  <button
                    type="button"
                    className="underline hover:text-foreground transition-colors"
                    onClick={() => safeNavigate(`/client/${clientId}/logs`, { state: { openLogId: activeError.id } })}
                  >
                    Check Error Logs
                  </button>
                </span>
                <button onClick={dismissError} className="shrink-0 hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {setterStopped && (
              <div
                className="flex items-center gap-2 px-4 py-2 text-yellow-200 shrink-0"
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', background: 'hsl(40 80% 30% / 0.6)', borderBottom: '1px solid hsl(40 80% 40% / 0.4)' }}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Setter has been stopped — the AI no longer responds to this lead's messages.</span>
              </div>
            )}
            <div className="flex-1 overflow-hidden">
              <ContactConversationHistory
                externalId={getCanonicalLeadId(contact) || null}
                contactDataId={getCanonicalLeadId(contact) || contact.id || null}
                contactName={getName()}
                supabaseUrl={credentials?.supabase_url || null}
                hasSupabaseServiceKey={credentials?.has_supabase_service_key ?? false}
                clientId={clientId}
                contactId={contactId}
                hasTwilio={!!(credentials?.twilio_account_sid && credentials?.has_twilio_auth_token && (credentials?.twilio_default_phone || (credentials as any)?.retell_phone_1))}
                phoneNumber={getPhone()}
                onLoadComplete={() => setChatLoaded(true)}
              />
            </div>
          </div>

          {/* Notes Panel — always mounted for prefetch, hidden when closed */}
          {clientId && contactId && (
            <div className={`w-80 shrink-0 groove-border bg-card flex flex-col overflow-hidden ${notesOpen ? '' : 'hidden'}`}>
              <LeadNotesPanel
                open={notesOpen}
                onClose={() => setNotesOpen(false)}
                leadId={contactId}
                clientId={clientId}
              />
            </div>
          )}
        </div>
      </div>

      {/* CRM Settings Dialog */}
      {clientId && contactId && (
        <TagManager
          open={showTagSettings}
          onOpenChange={setShowTagSettings}
          contactId={contactId}
          clientId={clientId}
          assignedTagIds={assignedTags.map((t) => t.id)}
          onTagsChanged={fetchAssignedTags}
        />
      )}

      {clientId && contactId && (
        <CrmSettingsDialog
          open={showCrmSettings}
          onOpenChange={(open) => {
            setShowCrmSettings(open);
            if (!open) {
              fetchClientFieldKeys();
            }
          }}
          clientId={clientId}
          contactId={contactId}
          assignedTagIds={assignedTags.map((t) => t.id)}
          onTagsChanged={fetchAssignedTags}
        />
      )}

      {/* Booking Detail Dialog — matches Logs page style */}
      <Dialog open={!!selectedBooking} onOpenChange={(open) => { if (!open) setSelectedBooking(null); }}>
        <DialogContent className="flex flex-col" style={{ maxWidth: '56rem', width: '90vw', height: '85vh', maxHeight: '85vh' }}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <DialogTitle className="uppercase">BOOKING DETAIL</DialogTitle>
              {selectedBooking && (() => {
                const sl = selectedBooking.status.toLowerCase();
                const v = sl === 'confirmed' || sl === 'completed' ? 'positive' as const : sl === 'cancelled' || sl === 'canceled' || sl === 'no-show' ? 'negative' as const : sl === 'pending' || sl === 'rescheduled' ? 'warning' as const : 'neutral' as const;
                return <StatusTag variant={v}>{selectedBooking.status.toUpperCase()}</StatusTag>;
              })()}
            </div>
          </DialogHeader>

          {selectedBooking && (
            <ScrollArea className="flex-1 overflow-auto">
              <div className="space-y-5 px-6 py-6">
                <div>
                  <label className="field-text text-muted-foreground block mb-1">Created</label>
                  <span className="field-text text-foreground">{format(new Date(selectedBooking.created_at), 'MMM d, yyyy h:mm:ss a')}</span>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {selectedBooking.title && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">Title</label>
                      <span className="field-text text-foreground">{selectedBooking.title}</span>
                    </div>
                  )}
                  {selectedBooking.start_time && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">Start Time</label>
                      <span className="field-text text-foreground">{format(new Date(selectedBooking.start_time), 'MMM d, yyyy h:mm a')}</span>
                    </div>
                  )}
                  {selectedBooking.end_time && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">End Time</label>
                      <span className="field-text text-foreground">{format(new Date(selectedBooking.end_time), 'MMM d, yyyy h:mm a')}</span>
                    </div>
                  )}
                  {selectedBooking.location && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">Location</label>
                      <span className="field-text text-foreground">{selectedBooking.location}</span>
                    </div>
                  )}
                  {(selectedBooking.setter_name || selectedBooking.setter_type) && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">Setter</label>
                      <span className="field-text text-foreground">{[selectedBooking.setter_name, selectedBooking.setter_type ? `(${selectedBooking.setter_type})` : ''].filter(Boolean).join(' ')}</span>
                    </div>
                  )}
                </div>

                {selectedBooking.notes && (
                  <div>
                    <label className="field-text text-muted-foreground block mb-1">Notes</label>
                    <pre className="text-foreground/80 p-3 groove-border bg-muted/20 overflow-auto max-h-[200px] whitespace-pre-wrap break-words field-text" style={{ lineHeight: '1.5' }}>
                      {selectedBooking.notes}
                    </pre>
                  </div>
                )}

                {selectedBooking.calendar_id && (
                  <div>
                    <label className="field-text text-muted-foreground block mb-1">Calendar ID</label>
                    <span className="field-text text-foreground text-[11px] break-all">{selectedBooking.calendar_id}</span>
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  {selectedBooking.ghl_booking_id && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">GHL Booking ID</label>
                      <span className="field-text text-foreground text-[11px] break-all">{selectedBooking.ghl_booking_id}</span>
                    </div>
                  )}
                  {selectedBooking.ghl_contact_id && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">GHL Contact ID</label>
                      <span className="field-text text-foreground text-[11px] break-all">{selectedBooking.ghl_contact_id}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  {selectedBooking.reschedule_link && (
                    <a href={selectedBooking.reschedule_link} target="_blank" rel="noopener noreferrer" className="groove-btn flex-1 text-center field-text">
                      Reschedule
                    </a>
                  )}
                  {selectedBooking.cancellation_link && (
                    <a href={selectedBooking.cancellation_link} target="_blank" rel="noopener noreferrer" className="groove-btn groove-btn-destructive flex-1 text-center field-text">
                      Cancel
                    </a>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        onConfirm={handleDeleteContact}
        title="Delete Lead"
        description="Are you sure you want to delete this lead? This action cannot be undone."
      />

      {/* Unsaved Changes Dialog (navigation blocker) */}
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onOpenChange={(open) => { if (!open) { setShowUnsavedDialog(false); pendingNavigationRef.current = null; } }}
        onDiscard={() => {
          const pendingNavigation = pendingNavigationRef.current;
          pendingNavigationRef.current = null;
          setIsDirty(false);
          setShowUnsavedDialog(false);
          pendingNavigation?.();
        }}
        description="You have unsaved contact changes. Do you want to discard them or continue editing?"
      />


      {/* Save overlay */}
      <SavingOverlay isVisible={saving} message="Saving contact..." variant="fixed" />
      <SavingOverlay isVisible={retrying} message="Retrying execution..." variant="fixed" />
      <SavingOverlay isVisible={stoppingBot} message={setterStopped ? "Activating setter..." : "Stopping setter..."} variant="fixed" />

      {/* Retry Confirmation Dialog */}
      <Dialog open={retryDialogOpen} onOpenChange={setRetryDialogOpen}>
        <DialogContent className="max-w-md !p-0">
          <DialogHeader>
            <DialogTitle>Retry Message Processing</DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-6">
            <div className="space-y-3">
              <p className="text-muted-foreground leading-relaxed" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" }}>
                This will re-send the last message from this lead to the AI engine and generate a new reply.
              </p>
              <p className="text-muted-foreground leading-relaxed" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" }}>
                A new execution will be created. The previous error will be cleared.
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="default"
                className="flex-1"
                onClick={() => setRetryDialogOpen(false)}
                disabled={retrying}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleRetryExecution}
                disabled={retrying}
              >
                {retrying ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Retry Now
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>

      {clientId && contact && (
        <LaunchWorkflowDialog
          open={showWorkflowDialog}
          onOpenChange={setShowWorkflowDialog}
          clientId={clientId}
          leads={[{
            lead_id: contact.lead_id || contact.id,
            first_name: contact.first_name || '',
            last_name: contact.last_name || '',
            phone: contact.phone || '',
            email: contact.email || '',
            business_name: contact.business_name || '',
            custom_fields: contact.custom_fields || {},
          }]}
          leadCount={1}
        />
      )}

      {/* Stop/Activate Setter Confirmation */}
      <Dialog open={showStopConfirm} onOpenChange={setShowStopConfirm}>
        <DialogContent className="max-w-md !p-0">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '22px', letterSpacing: '1px' }}>
              {setterStopped ? 'ACTIVATE SETTER' : 'STOP SETTER'}
            </DialogTitle>
          </DialogHeader>
          <div className="p-6">
            <p className="text-sm text-muted-foreground leading-relaxed mb-5" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
              {setterStopped
                ? 'Are you sure you want to activate the setter for this contact? The AI setter will resume replying to all leads on this phone number.'
                : 'Are you sure you want to stop the setter for this contact? Once stopped, the AI setter will no longer reply to any lead sharing this phone number.'}
            </p>
            <div className="flex gap-3">
              <Button
                variant="default"
                className="flex-1"
                onClick={() => setShowStopConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant={setterStopped ? 'default' : 'destructive'}
                className={setterStopped ? 'flex-1 groove-btn-pulse' : 'flex-1'}
                onClick={async () => {
                  setShowStopConfirm(false);
                  if (!contactId || !clientId) return;
                  const requestType = setterStopped ? 'Activate' : 'Stop';
                  setStoppingBot(true);
                  try {
                    const { data, error } = await supabase.functions.invoke('stop-bot-webhook', {
                      body: { client_id: clientId, contact_id: contactId, request_type: requestType },
                    });
                    if (error) throw error;
                    if (data?.error) throw new Error(data.error);
                    if (requestType === 'Stop') {
                      setSetterStopped(true);
                      toast.success('Setter stopped for all leads on this number');
                    } else {
                      setSetterStopped(false);
                      toast.success('Setter activated for all leads on this number');
                    }
                  } catch (err: any) {
                    toast.error(err.message || `Failed to ${requestType.toLowerCase()} setter`);
                  } finally {
                    setStoppingBot(false);
                  }
                }}
              >
                {setterStopped ? 'Activate Setter' : 'Stop Setter'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ContactDetail;
