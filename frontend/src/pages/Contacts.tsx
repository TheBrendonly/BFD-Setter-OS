import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { createClient } from '@supabase/supabase-js';
import SavingOverlay from '@/components/SavingOverlay';
import { useParams, useNavigate } from 'react-router-dom';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useClientCredentials } from '@/hooks/useClientCredentials';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import PhoneInputComponent from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { validatePhone, isValidEmail } from '@/utils/phoneValidation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Upload, Wand2, Send, Search, RefreshCw, Loader2, ChevronLeft, ChevronRight, Sparkles, Rocket, Pencil, Trash2, ArrowUp, ArrowDown, RefreshCcw, Plus, Filter, Settings, AlertTriangle, FileText, Download, Copy, Tags, Check, Zap, RotateCcw } from '@/components/icons';
import RetroLoader from '@/components/RetroLoader';
import { Switch } from '@/components/ui/switch';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { parseCsvFile, CsvRow } from '@/utils/csvParser';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { CsvColumnMapper, ColumnMapping, type DuplicateHandling } from '@/components/contacts/CsvColumnMapper';
import { autoSplitContactName } from '@/utils/contactNameSplitter';
import {
  buildCustomFieldsFromData,
  buildEditableContactData,
  buildExternalContactSyncPayload,
  createCanonicalLeadId,
  getCanonicalLeadId,
  ContactTag as ContactTagData,
} from '@/utils/contactId';
import CrmFilterPanel, { CrmFilterConfig, ContactFilter } from '@/components/contacts/CrmFilterPanel';
import { CrmSettingsDialog } from '@/components/contacts/CrmSettingsDialog';
import { LaunchWorkflowDialog } from '@/components/LaunchWorkflowDialog';
import { useCreatorMode } from '@/hooks/useCreatorMode';

interface Contact {
  id: string;
  client_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  business_name: string | null;
  custom_fields: Record<string, any> | null;
  tags: ContactTagData[] | null;
  lead_id: string | null;
  created_at: string;
}


interface CrmContactTag {
  id: string;
  name: string;
  color: string | null;
}

const PAGE_SIZE_OPTIONS = [50, 100, 250, 500, 1000] as const;
const DEFAULT_PAGE_SIZE = 50;

// Fixed CRM columns
const FIXED_COLUMNS = [
  { key: 'contact_name', label: 'Lead Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'business_name', label: 'Business Name' },
  { key: 'created_at', label: 'Created' },
  { key: 'last_interaction', label: 'Last Interaction' },
  { key: 'tags', label: 'Tags' },
] as const;

const Contacts = () => {
  const { clientId } = useParams();
  const navigate = useNavigate();

  const { credentials } = useClientCredentials(clientId);
  const { cb: creatorBlur } = useCreatorMode();

  const hasExternalSupabase = !!(credentials?.supabase_url && credentials?.supabase_service_key);

  // Last interaction timestamps from external chat_history
  const [lastInteractionMap, setLastInteractionMap] = useState<Record<string, string>>({});

  const fetchLastInteractions = useCallback(async (contactsList: Contact[]) => {
    if (!credentials?.supabase_url || !credentials?.supabase_service_key || contactsList.length === 0) return;
    try {
      const extClient = createClient(credentials.supabase_url, credentials.supabase_service_key);
      const sessionIds = contactsList
        .map((c) => getCanonicalLeadId(c))
        .filter(Boolean);
      if (sessionIds.length === 0) return;

      // Batch in chunks of 200 to avoid query limits
      const chunkSize = 200;
      const map: Record<string, string> = {};
      for (let i = 0; i < sessionIds.length; i += chunkSize) {
        const chunk = sessionIds.slice(i, i + chunkSize);
        const { data } = await extClient
          .from('chat_history')
          .select('session_id, timestamp')
          .in('session_id', chunk)
          .order('timestamp', { ascending: false });

        if (data) {
          for (const row of data) {
            // Only keep the most recent per session_id
            if (!map[row.session_id]) {
              map[row.session_id] = row.timestamp;
            }
          }
        }
      }
      setLastInteractionMap(map);
    } catch (err) {
      console.error('Failed to fetch last interactions:', err);
    }
  }, [credentials?.supabase_url, credentials?.supabase_service_key]);

  // Fetch existing custom field definitions for CSV mapper
  const [customFieldDefs, setCustomFieldDefs] = useState<string[]>([]);
  useEffect(() => {
    if (!clientId) return;
    (supabase as any)
      .from('client_custom_fields')
      .select('field_name, sort_order')
      .eq('client_id', clientId)
      .order('sort_order', { ascending: true })
      .then(({ data }: any) => {
        if (data) setCustomFieldDefs(data.map((d: any) => d.field_name));
      });
  }, [clientId]);

  const fetchAllContacts = useCallback(async (): Promise<Contact[]> => {
    if (!clientId) return [];

    const pageSize = 1000;
    let from = 0;
    const rows: Contact[] = [];

    while (true) {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) throw error;

      const batch = ((data || []) as unknown as Contact[]).map((row) => ({
        ...row,
        custom_fields: (row.custom_fields || {}) as Record<string, any>,
        tags: (Array.isArray(row.tags) ? row.tags : []) as unknown as ContactTagData[],
      }));

      if (batch.length === 0) break;

      rows.push(...batch);

      if (batch.length < pageSize) break;
      from += pageSize;
    }

    return rows;
  }, [clientId]);

  const ensureCanonicalContactId = useCallback(async (contact: Contact): Promise<Contact> => {
    const canonicalContactId = getCanonicalLeadId(contact) || createCanonicalLeadId();
    const editableData = buildEditableContactData(contact);
    const customFields = buildCustomFieldsFromData(editableData);

    if (contact.lead_id === canonicalContactId) {
      return {
        ...contact,
        lead_id: canonicalContactId,
        custom_fields: customFields,
      };
    }

    const { error } = await (supabase
      .from('leads') as any)
      .update({
        lead_id: canonicalContactId,
        custom_fields: customFields,
      })
      .eq('id', contact.id);

    if (error) throw error;

    return {
      ...contact,
      lead_id: canonicalContactId,
      custom_fields: customFields,
    };
  }, []);


  // Add Contact dialog state
  const [showAddContactDialog, setShowAddContactDialog] = useState(false);
  const [addContactForm, setAddContactForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    business_name: '',
  });
  const [useCustomId, setUseCustomId] = useState(false);
  const [customId, setCustomId] = useState('');
  const [addingContact, setAddingContact] = useState(false);

  const handleAddContact = async () => {
    if (!clientId) return;
    const email = addContactForm.email.trim();
    const rawPhone = addContactForm.phone.trim();
    // PhoneInput includes dial code even when empty — strip to just digits after +
    const phoneDigits = rawPhone.replace(/[^0-9]/g, '');
    const hasPhone = phoneDigits.length >= 5; // at least 5 digits = real number entered
    const hasEmail = !!email;
    // Require at least phone or email
    if (!hasEmail && !hasPhone) {
      toast.error('Please add a valid email or phone number');
      return;
    }
    // Validate email format if provided
    if (hasEmail && !isValidEmail(email)) {
      toast.error('Please enter a valid email address');
      return;
    }
    // Validate phone format if provided
    if (hasPhone && validatePhone(rawPhone).status === 'warning') {
      toast.error('Please enter a valid international phone number');
      return;
    }
    const phone = hasPhone ? rawPhone : '';
    setAddingContact(true);
    try {
      const canonicalContactId = (useCustomId ? customId.trim() : '') || createCanonicalLeadId();

      const phoneValidation = hasPhone ? validatePhone(phone) : null;
      const insertPayload: any = {
        client_id: clientId,
        first_name: addContactForm.first_name.trim() || null,
        last_name: addContactForm.last_name.trim() || null,
        email: addContactForm.email.trim() || null,
        phone: phoneValidation ? phoneValidation.normalized : null,
        business_name: addContactForm.business_name.trim() || null,
        lead_id: canonicalContactId,
        custom_fields: {},
        tags: [],
        phone_valid: phoneValidation ? phoneValidation.status === 'valid' || phoneValidation.status === 'auto-fixed' : true,
      };

      const { data: insertedData, error } = await (supabase
        .from('leads') as any)
        .insert(insertPayload)
        .select('id, lead_id')
        .single();
      if (error) throw error;

      // Push to external Supabase in background (don't block UI)
      if (hasExternalSupabase && insertedData) {
        const linkId = getCanonicalLeadId(insertedData as { id: string; lead_id: string | null });
        supabase.functions.invoke('push-contact-to-external', {
          body: {
            clientId,
            contactData: {
              first_name: addContactForm.first_name.trim(),
              last_name: addContactForm.last_name.trim(),
              email: addContactForm.email.trim(),
              phone: addContactForm.phone.trim(),
              business_name: addContactForm.business_name.trim(),
              custom_fields: {},
            },
            externalId: linkId,
          },
        }).then(({ error: pushErr }) => {
          if (pushErr) console.error('Failed to push contact to external Supabase:', pushErr);
        });
      }

      toast.success('Contact created');
      setShowAddContactDialog(false);
      setAddContactForm({ first_name: '', last_name: '', email: '', phone: '', business_name: '' });
      setUseCustomId(false);
      setCustomId('');
      fetchContacts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create lead');
    } finally {
      setAddingContact(false);
    }
  };

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [allLeadsSelected, setAllLeadsSelected] = useState(false);
  const [excludedContacts, setExcludedContacts] = useState<Set<string>>(new Set());
  const [selectingAll, setSelectingAll] = useState(false); // overlay while selecting
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Dialogs
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  
  const [showGHLDialog, setShowGHLDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [editFormData, setEditFormData] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState(false);


  // GHL form
  const [ghlWebhookUrl, setGhlWebhookUrl] = useState('');
  const [pushingToGHL, setPushingToGHL] = useState(false);

  // CSV upload + mapping
  const [uploading] = useState(false); // kept for realtime guard
  const [showColumnMapper, setShowColumnMapper] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<CsvRow[]>([]);
  const deletingRef = useRef(false); // true while a bulk delete is running
  const [showBulkTagDialog, setShowBulkTagDialog] = useState(false);
  const [bulkTagIds, setBulkTagIds] = useState<string[]>([]);
  const [assigningBulkTags, setAssigningBulkTags] = useState(false);

  // Bug 6 — bulk reactivate
  const [showReactivateDialog, setShowReactivateDialog] = useState(false);
  const [reactivateWorkflows, setReactivateWorkflows] = useState<Array<{ id: string; name: string; status: string | null }>>([]);
  const [reactivateWorkflowId, setReactivateWorkflowId] = useState<string>('');
  const [reactivating, setReactivating] = useState(false);
  const [showLaunchWorkflowDialog, setShowLaunchWorkflowDialog] = useState(false);
  const [workflowLeads, setWorkflowLeads] = useState<any[]>([]);

  // Poll for active file processing jobs (to show indicator on file processing button)
  const [hasActiveFileJobs, setHasActiveFileJobs] = useState(false);
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    const check = async () => {
      const { data } = await (supabase.from('ai_generation_jobs') as any)
        .select('id')
        .eq('client_id', clientId)
        .in('job_type', ['lead-file-import', 'lead-file-export'])
        .in('status', ['pending', 'running'])
        .limit(1);
      if (!cancelled) setHasActiveFileJobs((data || []).length > 0);
    };
    void check();
    const interval = window.setInterval(check, 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [clientId]);

  // Sorting
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Tags
  const [contactTagMap, setContactTagMap] = useState<Record<string, CrmContactTag[]>>({});
  const [allTags, setAllTags] = useState<CrmContactTag[]>([]);

  // Filter panel
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showCrmSettings, setShowCrmSettings] = useState(false);
  const DEFAULT_FILTER_CONFIG: CrmFilterConfig = { hiddenColumns: [], filters: [], tagFilters: [] };
  const [filterConfig, setFilterConfig] = useState<CrmFilterConfig>(DEFAULT_FILTER_CONFIG);
  const hasLoadedFilterRef = useRef(false);
  const filterSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageSizeStorageKey = clientId ? `leads-page-size:${clientId}` : null;

  const bodyScrollAreaRef = useRef<HTMLDivElement>(null);

  const searchFilterExtra = (
    <div className="flex items-center ml-4" style={{ gap: '12px' }}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search leads..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="pl-10 !h-8 w-[210px]"
        />
      </div>
      <button
        className="groove-btn flex items-center justify-center !h-8 !w-8 !p-0 relative shrink-0"
        title="Filters & Columns"
        onClick={() => setShowFilterPanel(prev => !prev)}
      >
        <Filter className="w-4 h-4" />
        {(filterConfig.filters.length > 0 || filterConfig.tagFilters.length > 0 || filterConfig.hiddenColumns.length > 0) && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary" />
        )}
      </button>
      <button
        className="groove-btn flex items-center justify-center !h-8 !w-8 !p-0 shrink-0"
        title="CRM Settings"
        onClick={() => setShowCrmSettings(true)}
      >
        <Settings className="w-3.5 h-3.5" />
      </button>
      <button
        className="groove-btn flex items-center justify-center !h-8 !w-8 !p-0 shrink-0 relative"
        title="File Processing"
        onClick={() => navigate(`/client/${clientId}/leads/files`)}
      >
        <FileText className="w-3.5 h-3.5" />
        {hasActiveFileJobs && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary border border-background" />
        )}
      </button>
    </div>
  );

  usePageHeader({
    title: 'LEADS',
    leftExtra: searchFilterExtra,
    actions: [
      {
        label: 'ADD LEAD',
        icon: <Plus className="w-4 h-4" />,
        onClick: () => setShowAddContactDialog(true),
      },
      {
        label: 'IMPORT CSV',
        icon: <Upload className="w-4 h-4" />,
        onClick: () => setShowUploadDialog(true),
      },
    ],
  }, [searchQuery, totalCount, filterConfig, showFilterPanel]);

  // Re-fetch last interactions when credentials arrive after contacts already loaded
  useEffect(() => {
    if (contacts.length > 0 && credentials?.supabase_url && credentials?.supabase_service_key && Object.keys(lastInteractionMap).length === 0) {
      fetchLastInteractions(contacts);
    }
  }, [contacts, credentials?.supabase_url, credentials?.supabase_service_key, fetchLastInteractions, lastInteractionMap]);


  useEffect(() => {
    if (!clientId || hasLoadedFilterRef.current) return;
    hasLoadedFilterRef.current = true;
    (async () => {
      const localPageSize = pageSizeStorageKey ? window.localStorage.getItem(pageSizeStorageKey) : null;
      const parsedLocalPageSize = localPageSize ? Number(localPageSize) : null;

      const { data } = await supabase
        .from('clients_public')
        .select('crm_filter_config, crm_page_size')
        .eq('id', clientId)
        .single();

      if ((data as any)?.crm_filter_config && typeof (data as any).crm_filter_config === 'object') {
        const savedConfig = (data as any).crm_filter_config;
        setFilterConfig(prev => ({ ...DEFAULT_FILTER_CONFIG, ...savedConfig }));
        // Restore saved sort state
        if (savedConfig._sortColumn) setSortColumn(savedConfig._sortColumn);
        if (savedConfig._sortDirection === 'asc' || savedConfig._sortDirection === 'desc') setSortDirection(savedConfig._sortDirection);
      }

      const savedPageSize = (data as any)?.crm_page_size;
      const resolvedPageSize =
        (typeof savedPageSize === 'number' && (PAGE_SIZE_OPTIONS as readonly number[]).includes(savedPageSize) && savedPageSize) ||
        (typeof parsedLocalPageSize === 'number' && (PAGE_SIZE_OPTIONS as readonly number[]).includes(parsedLocalPageSize) && parsedLocalPageSize) ||
        DEFAULT_PAGE_SIZE;

      setPageSize(resolvedPageSize);
    })();
  }, [clientId, pageSizeStorageKey]);

  // Save filter config to DB (debounced)
  const saveFilterConfig = useCallback((config: CrmFilterConfig) => {
    if (filterSaveTimeoutRef.current) clearTimeout(filterSaveTimeoutRef.current);
    filterSaveTimeoutRef.current = setTimeout(async () => {
      if (!clientId) return;
      await (supabase as any)
        .from('clients')
        .update({ crm_filter_config: config, updated_at: new Date().toISOString() })
        .eq('id', clientId);
    }, 500);
  }, [clientId]);

  const handleFilterConfigChange = useCallback((config: CrmFilterConfig) => {
    setFilterConfig(config);
    saveFilterConfig(config);
  }, [saveFilterConfig]);

  const savePageSize = useCallback(async (nextPageSize: number) => {
    if (pageSizeStorageKey) {
      window.localStorage.setItem(pageSizeStorageKey, String(nextPageSize));
    }

    if (!clientId) return;

    const { error } = await supabase
      .from('clients')
      .update({ crm_page_size: nextPageSize, updated_at: new Date().toISOString() })
      .eq('id', clientId);

    if (error) {
      console.error('Failed to save leads page size:', error);
    }
  }, [clientId, pageSizeStorageKey]);

  // Fetch all tags for filter panel
  const fetchAllTags = useCallback(async () => {
    if (!clientId) return;
    const { data } = await supabase
      .from('lead_tags')
      .select('*')
      .eq('client_id', clientId);
    setAllTags((data || []) as CrmContactTag[]);
  }, [clientId]);

  useEffect(() => { fetchAllTags(); }, [fetchAllTags]);

  // Debounce search query and reset page
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const isFirstLoadRef = useRef(true);

  const fetchContacts = useCallback(async () => {
    if (!clientId) return;
    // Only show loading spinner on first load, not on refreshes
    if (isFirstLoadRef.current) setLoading(true);
    try {
      const searchTerm = debouncedSearch.trim();

      // Build base query helper
      const applySearch = (query: any) => {
        if (searchTerm) {
          const pattern = `%${searchTerm}%`;
          return query.or(`first_name.ilike.${pattern},last_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern},business_name.ilike.${pattern}`);
        }
        return query;
      };

      const countQuery = supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId);
      const { count } = await applySearch(countQuery);
      setTotalCount(count || 0);

      let dataQuery = supabase
        .from('leads')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      dataQuery = applySearch(dataQuery);

      const { data, error } = await dataQuery;

      if (error) throw error;
      const mapped = (data || []).map(d => ({
        ...(d as any),
        custom_fields: (d.custom_fields || {}) as Record<string, any>,
        tags: (Array.isArray(d.tags) ? d.tags : []) as unknown as ContactTagData[],
      })) as Contact[];
      setContacts(mapped);
      fetchLastInteractions(mapped);
    } catch (err) {
      console.error('Error fetching contacts:', err);
      if (isFirstLoadRef.current) toast.error('Failed to load leads');
    } finally {
      isFirstLoadRef.current = false;
      setLoading(false);
    }
  }, [clientId, page, pageSize, debouncedSearch]);

  const fetchContactTags = useCallback(async () => {
    if (!clientId || contacts.length === 0) return;
    const contactIds = contacts.map(c => c.id);
    const { data } = await supabase
      .from('lead_tag_assignments')
      .select('lead_id, tag_id, lead_tags(id, name, color)')
      .in('lead_id', contactIds);
    if (data) {
      const map: Record<string, CrmContactTag[]> = {};
      data.forEach((d: any) => {
        if (d.lead_tags) {
          if (!map[d.lead_id]) map[d.lead_id] = [];
          map[d.lead_id].push(d.lead_tags);
        }
      });
      setContactTagMap(map);
    }
  }, [clientId, contacts]);


  // Initial data load (no auto-sync — sync is user-triggered only to prevent duplicates during background imports)
  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // Realtime subscription — auto-refresh on any INSERT/UPDATE/DELETE (debounced)
  const realtimeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!clientId) return;

    const channel = supabase
      .channel(`contacts-realtime-${clientId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'leads',
          filter: `client_id=eq.${clientId}`,
        },
        () => {
          if (deletingRef.current || uploading || hasActiveFileJobs) return;
          // Debounce rapid changes
          if (realtimeTimeoutRef.current) clearTimeout(realtimeTimeoutRef.current);
          realtimeTimeoutRef.current = setTimeout(() => {
            fetchContacts();
          }, 1500);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (realtimeTimeoutRef.current) clearTimeout(realtimeTimeoutRef.current);
    };
  }, [clientId, uploading]);

  useEffect(() => { fetchContactTags(); }, [fetchContactTags]);

  // Helper to clean "null" string values
  const clean = (val: string | undefined | null) => (!val || val === 'null') ? '' : val;

  // Helper functions — read from real columns
  const getContactName = (c: Contact) => {
    const first = clean(c.first_name) || '';
    const last = clean(c.last_name) || '';
    if (first || last) return `${first} ${last}`.trim();
    return 'Unknown';
  };

  const getPhone = (c: Contact) => {
    return clean(c.phone) || '';
  };

  const getEmail = (c: Contact) => {
    return clean(c.email) || '';
  };

  const getBusinessName = (c: Contact) => {
    return clean(c.business_name) || '';
  };

  const getColumnValue = (c: Contact, colKey: string): string => {
    switch (colKey) {
      case 'contact_name': return getContactName(c);
      case 'phone': return getPhone(c);
      case 'email': return getEmail(c);
      case 'business_name': return getBusinessName(c);
      case 'created_at': return new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
      case 'last_interaction': {
        const leadId = getCanonicalLeadId(c);
        const ts = leadId ? lastInteractionMap[leadId] : null;
        if (!ts) return '—';
        return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
      }
      default: {
        // Handle custom fields with cf_ prefix
        if (colKey.startsWith('cf_')) {
          const fieldName = colKey.slice(3);
          const val = c.custom_fields?.[fieldName];
          return val != null ? String(val) : '—';
        }
        return '';
      }
    }
  };

  // CSV: step 1 — pick file and parse headers
  const handleCSVFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseCsvFile(file);
      if (rows.length === 0) { toast.error('CSV is empty'); return; }
      const headers = Object.keys(rows[0]);
      setCsvHeaders(headers);
      setCsvData(rows);
      setShowUploadDialog(false);
      setShowColumnMapper(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to parse CSV');
    }
    // Reset file input
    e.target.value = '';
  };

  // CSV: step 2 — apply mappings and import (background via edge function)
  const handleImportWithMappings = async (mappings: ColumnMapping[], duplicateHandling: DuplicateHandling = 'skip', assignTagIds: string[] = []) => {
    if (!clientId) return;
    setShowColumnMapper(false);

    // Navigate immediately so the user sees file processing right away
    const savedCsvData = [...csvData];
    const clientRequestId = crypto.randomUUID();
    setCsvHeaders([]);
    setCsvData([]);
    navigate(`/client/${clientId}/leads/files?awaitImport=${clientRequestId}`);

    // Fire the edge function in the background
    try {
      const fileName = `CSV import (${savedCsvData.length} rows)`;
      const { error } = await supabase.functions.invoke('process-lead-file', {
        body: {
          operation: 'import',
          clientId,
          fileName,
          csvData: savedCsvData,
          mappings,
          duplicateHandling,
          assignTagIds,
          clientRequestId,
        },
      });
      if (error) {
        console.error('CSV import error:', error);
        toast.error(error.message || 'Import failed — check File Processing for details');
      }
    } catch (err: any) {
      console.error('CSV import error:', err);
      toast.error(err.message || 'Failed to start import');
    }
  };


  const handlePushToGHL = async () => {
    if (!ghlWebhookUrl.trim() || selectedContacts.size === 0) return;
    setPushingToGHL(true);
    try {
      const contactsToPush = contacts.filter(c => selectedContacts.has(c.id));
      for (const contact of contactsToPush) {
        const payload: Record<string, any> = {
          first_name: contact.first_name || '',
          last_name: contact.last_name || '',
          phone: contact.phone || '',
          email: contact.email || '',
          business_name: contact.business_name || '',
          ...(contact.custom_fields || {}),
          lead_id: contact.lead_id,
        };
        await fetch(ghlWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          mode: 'no-cors',
        });
      }
      toast.success(`Pushed ${contactsToPush.length} leads to GHL`);
      setShowGHLDialog(false);
      setSelectedContacts(new Set());
    } catch (err: any) {
      toast.error(err.message || 'Failed to push to GHL');
    } finally {
      setPushingToGHL(false);
    }
  };

  const toggleSelect = (id: string) => {
    if (allLeadsSelected) {
      // Toggle exclusion
      setExcludedContacts(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        // If all are excluded, exit global mode
        if (next.size >= totalCount) {
          setAllLeadsSelected(false);
          setExcludedContacts(new Set());
          setSelectedContacts(new Set());
          return new Set();
        }
        return next;
      });
    } else {
      setSelectedContacts(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
    }
  };

  const toggleSelectAll = () => {
    const visibleIds = filteredContacts.map(c => c.id);

    if (allLeadsSelected) {
      const visibleExcluded = filteredContacts.filter(c => excludedContacts.has(c.id));
      if (visibleExcluded.length > 0) {
        setExcludedContacts(prev => {
          const next = new Set(prev);
          visibleIds.forEach(id => next.delete(id));
          return next;
        });
      } else {
        setAllLeadsSelected(false);
        setExcludedContacts(new Set());
        setSelectedContacts(new Set());
      }
    } else {
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedContacts.has(id));
      if (allVisibleSelected) {
        setSelectedContacts(prev => {
          const next = new Set(prev);
          visibleIds.forEach(id => next.delete(id));
          return next;
        });
      } else {
        setSelectedContacts(prev => {
          const next = new Set(prev);
          visibleIds.forEach(id => next.add(id));
          return next;
        });
      }
    }
  };

  const handleSelectAllLeads = () => {
    setAllLeadsSelected(true);
    setExcludedContacts(new Set());
    setSelectedContacts(new Set(filteredContacts.map(c => c.id)));
  };

  // effectiveSelectedCountFinal is computed after filteredContacts below

  const isRowSelected = (id: string) => {
    if (allLeadsSelected) return !excludedContacts.has(id);
    return selectedContacts.has(id);
  };

  const isHeaderChecked = () => {
    if (allLeadsSelected) {
      return filteredContacts.length > 0 && filteredContacts.every(c => !excludedContacts.has(c.id));
    }
    return filteredContacts.length > 0 && filteredContacts.every(c => selectedContacts.has(c.id));
  };

  const handleDeleteContacts = async () => {
    setDeleting(true);
    deletingRef.current = true;
    setShowDeleteConfirm(false);
    try {
      // Helper: fetch lead_ids for external delete by internal IDs (batched)
      const fetchLeadIdsForExternal = async (internalIds: string[]): Promise<string[]> => {
        const leadIds: string[] = [];
        for (let i = 0; i < internalIds.length; i += 1000) {
          const batch = internalIds.slice(i, i + 1000);
          const { data } = await supabase.from('leads').select('lead_id').in('id', batch);
          (data || []).forEach((d: any) => { if (d.lead_id) leadIds.push(d.lead_id); });
        }
        return leadIds;
      };

      // Helper: send external deletes in batches
      const deleteFromExternal = async (externalIds: string[]) => {
        if (!hasExternalSupabase || externalIds.length === 0) return;
        try {
          // Send in batches of 500 to avoid payload/timeout issues
          for (let i = 0; i < externalIds.length; i += 500) {
            const batch = externalIds.slice(i, i + 500);
            await supabase.functions.invoke('push-contact-to-external', {
              body: { clientId, deleteExternalIds: batch },
            });
          }
        } catch (extErr) {
          console.error('Failed to delete from external Supabase:', extErr);
        }
      };

      if (allLeadsSelected && excludedContacts.size === 0) {
        // Delete ALL leads for this client
        if (hasExternalSupabase) {
          const allContacts = await fetchAllContacts();
          const externalIds = allContacts.map(c => c.lead_id).filter(Boolean) as string[];
          await deleteFromExternal(externalIds);
        }
        const { error } = await supabase.from('leads').delete().eq('client_id', clientId!);
        if (error) throw error;
        toast.success(`Deleted all ${totalCount.toLocaleString()} leads`);
      } else if (allLeadsSelected) {
        // Delete all except excluded — fetch all IDs minus excluded
        const allIds: string[] = [];
        let from = 0;
        const batchSize = 1000;
        while (true) {
          const { data, error } = await supabase
            .from('leads')
            .select('id')
            .eq('client_id', clientId!)
            .range(from, from + batchSize - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          data.forEach((d: any) => {
            if (!excludedContacts.has(d.id)) allIds.push(d.id);
          });
          if (data.length < batchSize) break;
          from += batchSize;
        }

        // Sync external deletes BEFORE deleting internally
        if (hasExternalSupabase) {
          const externalIds = await fetchLeadIdsForExternal(allIds);
          await deleteFromExternal(externalIds);
        }

        for (let i = 0; i < allIds.length; i += 500) {
          const batch = allIds.slice(i, i + 500);
          const { error } = await supabase.from('leads').delete().in('id', batch);
          if (error) throw error;
        }
        toast.success(`Deleted ${allIds.length.toLocaleString()} leads`);
      } else {
        const ids = Array.from(selectedContacts);
        // Sync external deletes BEFORE deleting internally
        if (hasExternalSupabase) {
          const contactsToDelete = contacts.filter(c => ids.includes(c.id) && c.lead_id);
          const externalIds = contactsToDelete.map(c => c.lead_id).filter(Boolean) as string[];
          await deleteFromExternal(externalIds);
        }
        for (let i = 0; i < ids.length; i += 500) {
          const batch = ids.slice(i, i + 500);
          const { error } = await supabase.from('leads').delete().in('id', batch);
          if (error) throw error;
        }
        toast.success(`Deleted ${ids.length.toLocaleString()} leads`);
      }
      setSelectedContacts(new Set());
      setAllLeadsSelected(false);
      setExcludedContacts(new Set());
      await fetchContacts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete leads');
    } finally {
      setDeleting(false);
      deletingRef.current = false;
    }
  };

  const handleExportLeads = async () => {
    if (!clientId) return;
    try {
      // Create a background export job
      const { data: job, error } = await (supabase.from('ai_generation_jobs') as any)
        .insert({
          client_id: clientId,
          job_type: 'lead-file-export',
          status: 'pending',
          input_payload: {
            operation: 'export',
            totalRows: effectiveSelectedCountFinal,
            allLeadsSelected,
            excludedIds: allLeadsSelected ? Array.from(excludedContacts) : undefined,
            selectedIds: !allLeadsSelected ? Array.from(selectedContacts) : undefined,
          },
        })
        .select('id')
        .single();
      if (error) throw error;
      toast.success('Export started — check File Processing for progress');
      navigate(`/client/${clientId}/leads/files`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to start export');
    }
  };

  // Bug 6 — load workflows on demand when reactivate dialog opens
  React.useEffect(() => {
    if (!showReactivateDialog || !clientId) return;
    (async () => {
      const { data, error } = await (supabase
        .from('engagement_workflows')
        .select('id, name, status')
        .eq('client_id', clientId)
        .order('updated_at', { ascending: false }) as any);
      if (error) {
        toast.error('Failed to load workflows');
        return;
      }
      setReactivateWorkflows((data as Array<{ id: string; name: string; status: string | null }>) ?? []);
    })();
  }, [showReactivateDialog, clientId]);

  const handleBulkReactivate = async () => {
    if (!reactivateWorkflowId || !clientId) return;
    const targets = Array.from(selectedContacts);
    if (targets.length === 0) {
      toast.error('No leads selected');
      return;
    }
    setReactivating(true);

    // Bug 6 — batched parallel invokes. Sequential await would timeout the
    // browser tab on 100+ leads; full Promise.all could hit edge-fn
    // concurrency limits. Chunk of 5 strikes a balance: <30s for 100 leads
    // assuming ~1.2s per call.
    const CHUNK = 5;
    const failedIds: string[] = [];
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const slice = targets.slice(i, i + CHUNK);
      const results = await Promise.all(slice.map(async contactId => {
        const contact = contacts.find(c => c.id === contactId);
        if (!contact) return { id: contactId, ok: false };
        const leadIdGhl = (contact as any).lead_id || contact.id;
        try {
          const { error } = await (supabase.functions as any).invoke('reactivate-lead', {
            body: {
              client_id: clientId,
              workflow_id: reactivateWorkflowId,
              lead_id: leadIdGhl,
              kind: 'reactivation',
            },
          });
          return { id: contactId, ok: !error };
        } catch {
          return { id: contactId, ok: false };
        }
      }));
      for (const r of results) {
        if (r.ok) ok++;
        else { fail++; failedIds.push(r.id); }
      }
    }

    setReactivating(false);
    setShowReactivateDialog(false);
    setReactivateWorkflowId('');
    setSelectedContacts(new Set());
    if (fail === 0) {
      toast.success(`Reactivated ${ok} lead${ok === 1 ? '' : 's'}`);
    } else {
      // Surface failed IDs in the console + a hint in the toast so the
      // operator can identify which leads to retry.
      console.warn('[reactivate] failed lead ids:', failedIds);
      toast.error(`Reactivated ${ok}, failed ${fail}. Check console for failed lead IDs.`);
    }
  };

  const handleBulkAssignTags = async () => {
    if (!clientId || bulkTagIds.length === 0) return;
    setAssigningBulkTags(true);
    try {
      let leadIds: string[] = [];
      if (allLeadsSelected) {
        // Fetch all lead IDs minus excluded
        const { data } = await supabase.from('leads').select('id').eq('client_id', clientId);
        leadIds = (data || []).map((r: any) => r.id).filter((id: string) => !excludedContacts.has(id));
      } else {
        leadIds = Array.from(selectedContacts);
      }
      // Build assignments (skip existing)
      const { data: existing } = await supabase.from('lead_tag_assignments').select('lead_id, tag_id').in('lead_id', leadIds).in('tag_id', bulkTagIds);
      const existingSet = new Set((existing || []).map((e: any) => `${e.lead_id}:${e.tag_id}`));
      const inserts: { lead_id: string; tag_id: string }[] = [];
      for (const lid of leadIds) {
        for (const tid of bulkTagIds) {
          if (!existingSet.has(`${lid}:${tid}`)) inserts.push({ lead_id: lid, tag_id: tid });
        }
      }
      if (inserts.length > 0) {
        // Batch insert in chunks of 500
        for (let i = 0; i < inserts.length; i += 500) {
          const { error } = await supabase.from('lead_tag_assignments').insert(inserts.slice(i, i + 500));
          if (error) throw error;
        }
      }
      toast.success(`Assigned ${bulkTagIds.length} tag(s) to ${leadIds.length} leads`);
      setShowBulkTagDialog(false);
      setBulkTagIds([]);
      fetchContacts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to assign tags');
    } finally {
      setAssigningBulkTags(false);
    }
  };

  const handleEditContact = () => {
    if (selectedContacts.size !== 1) return;
    const contact = contacts.find(c => selectedContacts.has(c.id));
    if (!contact) return;
    setEditingContact(contact);
    setEditFormData(buildEditableContactData(contact));
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!editingContact) return;
    try {
      const canonicalContactId = getCanonicalLeadId(editingContact) || createCanonicalLeadId();
      const customFields = buildCustomFieldsFromData(editFormData);

      const { error } = await (supabase
        .from('leads') as any)
        .update({
          lead_id: canonicalContactId,
          first_name: editFormData.first_name || null,
          last_name: editFormData.last_name || null,
          phone: editFormData.phone || null,
          email: editFormData.email || null,
          business_name: editFormData.business_name || null,
          custom_fields: customFields,
        })
        .eq('id', editingContact.id);
      if (error) throw error;

      if (hasExternalSupabase) {
        const { data, error: pushError } = await supabase.functions.invoke('push-contact-to-external', {
          body: {
            clientId,
            externalId: canonicalContactId,
            contactData: buildExternalContactSyncPayload(editFormData, {
              customFields,
              tags: editingContact.tags || [],
            }),
          },
        });

        if (pushError) throw pushError;
        if (data?.error) throw new Error(data.error);
      }

      toast.success('Contact updated');
      setShowEditDialog(false);
      setEditingContact(null);
      fetchContacts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update lead');
    }
  };

  const handleLaunchCampaign = async () => {
    let selected: Contact[];
    if (allLeadsSelected) {
      // Fetch all contacts for campaign
      selected = await fetchAllContacts();
    } else {
      selected = contacts.filter(c => selectedContacts.has(c.id));
    }
    const leadData = selected.map(contact => {
      const editableData = buildEditableContactData(contact);
      const data: Record<string, string> = { ...editableData };
      const canonicalContactId = getCanonicalLeadId(contact);
      if (canonicalContactId) {
        data['lead_id'] = canonicalContactId;
      }
      return data;
    });
    navigate(`/client/${clientId}/campaigns/create`, {
      state: { contactLeads: leadData }
    });
  };

  const handleLaunchWorkflow = async () => {
    let selected: Contact[];
    if (allLeadsSelected) {
      selected = await fetchAllContacts();
    } else {
      selected = contacts.filter(c => selectedContacts.has(c.id));
    }
    const leadData = selected.map(contact => {
      const canonicalContactId = getCanonicalLeadId(contact);
      return {
        lead_id: canonicalContactId || contact.id,
        first_name: contact.first_name || '',
        last_name: contact.last_name || '',
        phone: contact.phone || '',
        email: contact.email || '',
        business_name: contact.business_name || '',
        custom_fields: contact.custom_fields || {},
      };
    });
    setWorkflowLeads(leadData);
    setShowLaunchWorkflowDialog(true);
  };

  // Sorting
  const didResizeRef = useRef(false);

  const handleSort = (colKey: string) => {
    if (didResizeRef.current) { didResizeRef.current = false; return; }
    if (colKey === 'tags') return;
    let newCol: string | null = colKey;
    let newDir: 'asc' | 'desc' = 'asc';
    if (sortColumn === colKey) {
      if (sortDirection === 'asc') {
        newDir = 'desc';
      } else {
        newCol = null;
        newDir = 'asc';
      }
    }
    setSortColumn(newCol);
    setSortDirection(newDir);
    // Persist sort state
    const updatedConfig = { ...filterConfig, _sortColumn: newCol, _sortDirection: newDir };
    saveFilterConfig(updatedConfig);
  };

  // Visible columns (respects filter config)
  const visibleFixedColumns = useMemo(() =>
    FIXED_COLUMNS.filter(col => !filterConfig.hiddenColumns.includes(col.key)),
    [filterConfig.hiddenColumns]
  );

  const filteredContacts = React.useMemo(() => {
    let result = [...contacts];

    // Apply field filters (client-side, on current page data)
    for (const filter of filterConfig.filters) {
      if (!filter.field) continue;
      result = result.filter(c => {
        const val = getColumnValue(c, filter.field).toLowerCase();
        const fv = filter.value.toLowerCase();
        switch (filter.operator) {
          case 'contains': return val.includes(fv);
          case 'not_contains': return !val.includes(fv);
          case 'equals': return val === fv;
          case 'not_equals': return val !== fv;
          case 'starts_with': return val.startsWith(fv);
          case 'ends_with': return val.endsWith(fv);
          case 'is_empty': return !val || val === '—';
          case 'is_not_empty': return !!val && val !== '—';
          default: return true;
        }
      });
    }

    // Apply tag filters
    if (filterConfig.tagFilters.length > 0) {
      result = result.filter(c => {
        const tags = contactTagMap[c.id] || [];
        return filterConfig.tagFilters.some(tagId => tags.some(t => t.id === tagId));
      });
    }

    // Sort
    if (sortColumn) {
      result.sort((a, b) => {
        if (sortColumn === 'last_interaction') {
          const aId = getCanonicalLeadId(a);
          const bId = getCanonicalLeadId(b);
          const aTs = (aId && lastInteractionMap[aId]) || '';
          const bTs = (bId && lastInteractionMap[bId]) || '';
          if (aTs < bTs) return sortDirection === 'asc' ? -1 : 1;
          if (aTs > bTs) return sortDirection === 'asc' ? 1 : -1;
          return 0;
        }
        const aVal = getColumnValue(a, sortColumn).toLowerCase();
        const bVal = getColumnValue(b, sortColumn).toLowerCase();
        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [contacts, sortColumn, sortDirection, filterConfig, contactTagMap, lastInteractionMap]);

  const isClientFiltered = filteredContacts.length < contacts.length;
  const filteredTotalCount = isClientFiltered ? filteredContacts.length : totalCount;
  const effectiveSelectedCountFinal = allLeadsSelected ? filteredTotalCount - excludedContacts.size : selectedContacts.size;
  const totalPages = Math.ceil((isClientFiltered ? filteredTotalCount : totalCount) / pageSize);
  const cellBorderClass = "border-r border-border";

  // All known custom field keys for AI prompt template hints
  const allFieldKeys = React.useMemo(() => {
    const keys = new Set<string>();
    contacts.forEach(c => Object.keys(c.custom_fields || {}).forEach(k => keys.add(k)));
    return Array.from(keys);
  }, [contacts]);

  const EMPTY_ROWS_MIN = 20;
  const emptyRowCount = Math.max(0, EMPTY_ROWS_MIN - filteredContacts.length);

  // Auto-compute minimum tags column width to fit 2 tags side by side
  const minTagsWidth = useMemo(() => {
    // Estimate tag pill width: ~7.5px per char at 11px font + 16px horizontal padding + 2px border
    const estimateTagWidth = (name: string) => Math.ceil(name.length * 7.5) + 18;
    let maxNeeded = 0;
    const allContactIds = Object.keys(contactTagMap);
    for (const cid of allContactIds) {
      const tags = contactTagMap[cid];
      if (!tags || tags.length === 0) continue;
      const t1 = estimateTagWidth(tags[0].name);
      const t2 = tags.length > 1 ? estimateTagWidth(tags[1].name) : 0;
      const gap = tags.length > 1 ? 8 : 0;
      const plusN = tags.length > 2 ? 32 : 0;
      const needed = t1 + gap + t2 + plusN + 40; // 40 = px-5 padding both sides
      if (needed > maxNeeded) maxNeeded = needed;
    }
    return Math.max(200, maxNeeded);
  }, [contactTagMap]);

  // Resizable column widths — persisted to Supabase
  const DEFAULT_WIDTHS: Record<string, number> = {
    checkbox: 48,
    contact_name: 180,
    phone: 150,
    email: 220,
    business_name: 170,
    created_at: 190,
    last_interaction: 160,
    tags: minTagsWidth,
  };
  const [colWidths, setColWidths] = useState<Record<string, number>>({ ...DEFAULT_WIDTHS });
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedWidthsRef = useRef(false);

  // Load saved widths from DB
  useEffect(() => {
    if (!clientId || hasLoadedWidthsRef.current) return;
    hasLoadedWidthsRef.current = true;
    (async () => {
      const { data } = await supabase
        .from('clients_public')
        .select('crm_column_widths')
        .eq('id', clientId)
        .single();
      if (data?.crm_column_widths && typeof data.crm_column_widths === 'object') {
        const saved = data.crm_column_widths as Record<string, number>;
        // Discard corrupted widths (unreasonably large values)
        const sanitized: Record<string, number> = {};
        for (const [k, v] of Object.entries(saved)) {
          if (typeof v === 'number' && v >= 30 && v <= 800) sanitized[k] = v;
        }
        setColWidths(prev => ({ ...prev, ...sanitized }));
      }
    })();
  }, [clientId]);

  // Ensure tags column respects minimum width when tag data loads
  useEffect(() => {
    setColWidths(prev => {
      if ((prev.tags || 0) < minTagsWidth) {
        return { ...prev, tags: minTagsWidth };
      }
      return prev;
    });
  }, [minTagsWidth]);

  // Debounced save to DB
  const saveWidthsToDB = useCallback((widths: Record<string, number>) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      if (!clientId) return;
      await supabase
        .from('clients')
        .update({ crm_column_widths: widths } as any)
        .eq('id', clientId);
    }, 500);
  }, [clientId]);

  const handleResizeStart = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { key, startX: e.clientX, startWidth: colWidths[key] || 120 };

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = ev.clientX - resizingRef.current.startX;
      const newWidth = Math.max(60, resizingRef.current.startWidth + diff);
      setColWidths(prev => {
        const next = { ...prev, [resizingRef.current!.key]: newWidth };
        return next;
      });
    };
    const onMouseUp = () => {
      didResizeRef.current = true;
      // Save final widths
      setColWidths(prev => {
        saveWidthsToDB(prev);
        return prev;
      });
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [colWidths, saveWidthsToDB]);

  // Total table width for horizontal scroll
  const totalTableWidth = useMemo(() => {
    let w = colWidths.checkbox;
    visibleFixedColumns.forEach(col => { w += colWidths[col.key] || 120; });
    return w;
  }, [colWidths, visibleFixedColumns]);

  const renderColGroup = () => (
    <colgroup>
      <col style={{ width: colWidths.checkbox }} />
      {visibleFixedColumns.map(col => (
        <col key={col.key} style={{ width: colWidths[col.key] || 120 }} />
      ))}
    </colgroup>
  );


  if (loading) {
    return <RetroLoader />;
  }

  return (
    <div className="container mx-auto max-w-7xl flex h-full min-h-0 flex-col overflow-hidden pt-6 pb-0">
      {/* Selection actions */}
      {(selectedContacts.size > 0 || allLeadsSelected) && (
        <div className="flex items-center gap-3 mb-6">
          {/* Show "Select All X Leads" when entire current page is checked but not all leads yet */}
          {!allLeadsSelected && filteredContacts.length > 0 && filteredContacts.every(c => selectedContacts.has(c.id)) && filteredTotalCount > filteredContacts.length && (
            <Button variant="outline" onClick={handleSelectAllLeads}>
              Select All {filteredTotalCount.toLocaleString()} Leads
            </Button>
          )}
          {allLeadsSelected && (
            <Button variant="outline" onClick={() => { setAllLeadsSelected(false); setExcludedContacts(new Set()); setSelectedContacts(new Set()); }}>
              Deselect All {filteredTotalCount.toLocaleString()} Leads
            </Button>
          )}
          <Button variant="default" onClick={handleLaunchWorkflow}>
            <Zap className="w-4 h-4 mr-1.5" />
            Launch Campaign ({effectiveSelectedCountFinal.toLocaleString()})
          </Button>
          <Button variant="outline" onClick={handleExportLeads}>
            <Download className="w-4 h-4 mr-1.5" />
            Export ({effectiveSelectedCountFinal.toLocaleString()})
          </Button>
          <Button variant="outline" onClick={() => { setBulkTagIds([]); setShowBulkTagDialog(true); }}>
            <Tags className="w-4 h-4 mr-1.5" />
            Assign Tags ({effectiveSelectedCountFinal.toLocaleString()})
          </Button>
          <Button
            variant="outline"
            onClick={() => { setReactivateWorkflowId(''); setShowReactivateDialog(true); }}
          >
            <RotateCcw className="w-4 h-4 mr-1.5" />
            Reactivate ({effectiveSelectedCountFinal.toLocaleString()})
          </Button>
          <Button
            variant="destructive"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="w-4 h-4" />
            Delete ({effectiveSelectedCountFinal.toLocaleString()})
          </Button>
        </div>
      )}


      {/* Table — unified sticky-header table */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden relative" style={{ border: '3px groove hsl(var(--border-groove))', overscrollBehavior: 'none' }}>
        <ScrollArea className="flex-1 [&>div]:overscroll-none" showHorizontalScrollbar ref={bodyScrollAreaRef}>
          <table className="caption-bottom text-base" style={{ tableLayout: 'fixed', width: totalTableWidth, minWidth: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
            {renderColGroup()}
            <thead className="bg-background">
              <tr>
                <th
                  className="sticky top-0 z-20 h-[52px] px-3 text-left align-middle text-[13px] font-medium tracking-wide text-foreground bg-background"
                  style={{ borderRight: '3px groove hsl(var(--border-groove))', borderBottom: '3px groove hsl(var(--border-groove))', borderTop: 'none' }}
                >
                  <Checkbox
                    className="mx-auto"
                    checked={isHeaderChecked()}
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
                {visibleFixedColumns.map((col, colIdx) => {
                  const isLastColumn = colIdx === visibleFixedColumns.length - 1;
                  return (
                    <th
                      key={col.key}
                      className={`sticky top-0 z-20 h-[52px] px-5 text-left align-middle text-[13px] font-medium tracking-wide text-foreground relative bg-background ${col.key !== 'tags' ? 'cursor-pointer' : ''}`}
                      style={{ borderLeft: 'none', borderRight: isLastColumn ? 'none' : '3px groove hsl(var(--border-groove))', borderBottom: '3px groove hsl(var(--border-groove))', borderTop: 'none' }}
                      onClick={() => handleSort(col.key)}
                    >
                      <div className="flex items-center gap-1 select-none overflow-hidden">
                        <span className="truncate">{col.label}</span>
                        {sortColumn === col.key && (
                          sortDirection === 'asc'
                            ? <ArrowUp className="w-3 h-3 text-foreground shrink-0" />
                            : <ArrowDown className="w-3 h-3 text-foreground shrink-0" />
                        )}
                      </div>
                      {!isLastColumn && (
                        <div className="absolute right-0 top-0 bottom-0 w-[18px] translate-x-1/2 cursor-col-resize z-20" onMouseDown={e => handleResizeStart(col.key, e)} />
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="bg-card">
              {filteredContacts.length === 0 ? (
                    <>
                      {Array.from({ length: 8 }).map((_, rowIdx) => (
                        <tr key={`empty-${rowIdx}`} className="border-b border-border">
                          <td className="px-3 py-2.5 h-[41px]" style={{ borderRight: '1px solid hsl(var(--border-groove) / 0.3)', borderBottom: '1px solid hsl(var(--border))' }}>&nbsp;</td>
                          {visibleFixedColumns.map((col, colIdx) => {
                            const isLast = colIdx === visibleFixedColumns.length - 1;
                            return <td key={col.key} className="px-3 py-2.5 h-[41px]" style={{ borderBottom: '1px solid hsl(var(--border))', ...(isLast ? {} : { borderRight: '1px solid hsl(var(--border-groove) / 0.3)' }) }}>&nbsp;</td>;
                          })}
                        </tr>
                      ))}
                    </>
                  ) : (
                    filteredContacts.map(contact => (
                      <tr
                        key={contact.id}
                        className="border-b border-border cursor-pointer bg-card hover:bg-accent transition-colors duration-100"
                        onClick={() => navigate(`/client/${clientId}/leads/${contact.id}`)}
                      >
                        <td className="px-3 py-2.5 align-middle text-[13px]" style={{ borderRight: '1px solid hsl(var(--border-groove) / 0.3)', borderBottom: '1px solid hsl(var(--border))' }} onClick={e => e.stopPropagation()}>
                          <Checkbox
                            className="mx-auto"
                            checked={isRowSelected(contact.id)}
                            onCheckedChange={() => toggleSelect(contact.id)}
                          />
                        </td>
                        {visibleFixedColumns.map((col, colIdx) => {
                          const isLastColumn = colIdx === visibleFixedColumns.length - 1;
                          const borderStyle: React.CSSProperties = { borderBottom: '1px solid hsl(var(--border))', ...(isLastColumn ? {} : { borderRight: '1px solid hsl(var(--border-groove) / 0.3)' }) };
                          if (col.key === 'tags') {
                            const tags = contactTagMap[contact.id] || [];
                            const visibleTags = tags.slice(0, 2);
                            const remaining = tags.length - 2;
                            return (
                              <td key={col.key} className="px-5 py-2.5 align-middle text-[13px] text-secondary-foreground" style={borderStyle}>
                                <div className="flex items-center gap-2 whitespace-nowrap">
                                  {visibleTags.map(tag => (
                                    <span
                                      key={tag.id}
                                      className="inline-flex items-center border px-2 py-0.5 font-medium leading-none whitespace-nowrap [font-size:11px] [border-width:0.7px]"
                                      style={{
                                        backgroundColor: `${tag.color || '#6366f1'}26`,
                                        borderColor: tag.color || '#6366f1',
                                        color: '#FFFFFF',
                                      }}
                                      title={tag.name}
                                    >
                                      {tag.name}
                                    </span>
                                  ))}
                                  {remaining > 0 && (
                                    <span className="text-muted-foreground shrink-0" style={{ fontSize: '12px' }}>
                                      +{remaining}
                                    </span>
                                  )}
                                </div>
                              </td>
                            );
                          }
                          if (col.key === 'phone') {
                            const phoneVal = getPhone(contact);
                            const isPhoneInvalid = phoneVal && (contact as any).phone_valid === false;
                            return (
                              <td key={col.key} className="px-5 py-2.5 align-middle text-[13px] text-secondary-foreground" style={borderStyle}>
                                <div className="flex items-center gap-1.5 truncate group/cell">
                                  <span className={`truncate ${creatorBlur}`}>{phoneVal || '—'}</span>
                                  {isPhoneInvalid && (
                                    <span title="Phone number format may be invalid">
                                      <AlertTriangle
                                        className="w-3.5 h-3.5 shrink-0"
                                        style={{ color: 'hsl(40 90% 55%)' }}
                                      />
                                    </span>
                                  )}
                                  {phoneVal && (
                                    <button
                                      className="opacity-0 group-hover/cell:opacity-100 transition-opacity shrink-0 p-0 hover:text-foreground text-muted-foreground"
                                      title="Copy phone"
                                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(phoneVal); toast.success('Phone copied'); }}
                                    >
                                      <Copy className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            );
                          }
                          if (col.key === 'contact_name' || col.key === 'email') {
                            const cellVal = getColumnValue(contact, col.key);
                            const hasValue = cellVal && cellVal !== '—' && cellVal !== 'Unknown';
                            return (
                              <td key={col.key} className="px-5 py-2.5 align-middle text-[13px] text-secondary-foreground" style={borderStyle}>
                                <div className="flex items-center gap-1.5 truncate group/cell">
                                  <span className={`truncate ${creatorBlur}`}>{cellVal}</span>
                                  {hasValue && (
                                    <button
                                      className="opacity-0 group-hover/cell:opacity-100 transition-opacity shrink-0 p-0 hover:text-foreground text-muted-foreground"
                                      title={`Copy ${col.key === 'contact_name' ? 'name' : 'email'}`}
                                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(cellVal); toast.success(`${col.key === 'contact_name' ? 'Name' : 'Email'} copied`); }}
                                    >
                                      <Copy className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            );
                          }
                          {(() => {
                            const shouldBlur = !['created_at', 'last_interaction', 'tags'].includes(col.key as string);
                            return (
                              <td key={col.key} className="px-5 py-2.5 align-middle text-[13px] text-secondary-foreground truncate" style={borderStyle}>
                                <span className={shouldBlur ? creatorBlur : ''}>{getColumnValue(contact, col.key)}</span>
                              </td>
                            );
                          })()}
                        })}
                      </tr>
                    ))
                  )}
                  {/* Empty placeholder rows */}
                  {Array.from({ length: emptyRowCount }).map((_, i) => (
                    <tr key={`empty-${i}`} className="border-b border-border last:border-b-0 bg-card">
                      <td className="px-3 py-2.5" style={{ borderRight: '1px solid hsl(var(--border-groove) / 0.3)', borderBottom: '1px solid hsl(var(--border))' }}>&nbsp;</td>
                      {visibleFixedColumns.map((col, colIdx) => {
                        const isLast = colIdx === visibleFixedColumns.length - 1;
                        return <td key={col.key} className="px-5 py-2.5 text-[13px]" style={{ borderBottom: '1px solid hsl(var(--border))', ...(isLast ? {} : { borderRight: '1px solid hsl(var(--border-groove) / 0.3)' }) }}>&nbsp;</td>;
                      })}
                    </tr>
                  ))}
            </tbody>
          </table>
        </ScrollArea>
        {/* Filter Panel — inside table container */}
        <CrmFilterPanel
          open={showFilterPanel}
          onClose={() => setShowFilterPanel(false)}
          columns={[
            ...FIXED_COLUMNS.map(c => ({ key: c.key, label: c.label })),
            ...customFieldDefs.map(f => ({ key: `cf_${f}`, label: f })),
          ]}
          config={filterConfig}
          onConfigChange={handleFilterConfigChange}
          tags={allTags}
          hideOuterBorder
        />
      </div>

      {/* Pagination bar */}
      <div className="flex items-center justify-center relative" style={{ marginTop: '12px', marginBottom: '12px' }}>
        {/* Per-page dropdown on the left */}
        <div className="absolute left-0">
          <Select value={String(pageSize)} onValueChange={v => { const n = Number(v); setPageSize(n); setPage(0); void savePageSize(n); }}>
            <SelectTrigger className="h-8 groove-btn w-auto min-w-[130px] pagination-page-size-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-sidebar pagination-page-size-content">
              {PAGE_SIZE_OPTIONS.map(n => (
                <SelectItem key={n} value={String(n)} className="pagination-page-size-item">{n} Per Page</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Navigation — centered */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 groove-btn"
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-muted-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
            {page + 1} / {Math.max(1, totalPages)}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 groove-btn"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Upload CSV Dialog — just file picker */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Contacts from CSV</DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-4">
            <div className="space-y-1.5" style={{ fontSize: '13px' }}>
              <p className="text-muted-foreground">Upload a CSV file. You'll be able to map each column to the correct field before importing.</p>
            </div>
            <div>
              <input
                id="csv-file-input"
                type="file"
                accept=".csv"
                onChange={handleCSVFilePick}
                className="hidden"
              />
              <Button
                variant="default"
                onClick={() => document.getElementById('csv-file-input')?.click()}
              >
                <Upload className="w-4 h-4 mr-1.5" />
                Choose File
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* CSV Column Mapper */}
      <CsvColumnMapper
        open={showColumnMapper}
        onOpenChange={setShowColumnMapper}
        csvHeaders={csvHeaders}
        csvData={csvData}
        onConfirm={handleImportWithMappings}
        importing={false}
        existingCustomFields={customFieldDefs}
        availableTags={allTags}
      />

      {/* Bulk Tag Assignment Dialog */}
      <Dialog open={showBulkTagDialog} onOpenChange={setShowBulkTagDialog}>
        <DialogContent className="!p-0 flex flex-col overflow-hidden" style={{ width: '544px', maxWidth: '90vw', height: '630px', maxHeight: '80vh' }}>
          <DialogHeader>
            <DialogTitle>ASSIGN TAGS</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-5 flex-1 min-h-0 overflow-y-auto">
            <p className="text-muted-foreground mb-4" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
              Select tags to assign to {effectiveSelectedCountFinal.toLocaleString()} selected lead{effectiveSelectedCountFinal !== 1 ? 's' : ''}.
            </p>
            <div className="space-y-0 -mx-6">
              {allTags.length === 0 ? (
                <p className="text-muted-foreground py-3 text-center" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
                  No tags available. Create tags in CRM Settings first.
                </p>
              ) : (
                allTags.map(tag => {
                  const isSelected = bulkTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      onClick={() => setBulkTagIds(prev => isSelected ? prev.filter(id => id !== tag.id) : [...prev, tag.id])}
                      className="w-full flex items-center gap-3 px-6 py-2 text-left transition-colors hover:bg-muted/30"
                    >
                      <Checkbox checked={isSelected} className="flex-shrink-0" tabIndex={-1} />
                      <span
                        className="inline-flex items-center gap-1 border px-2 py-0.5 font-medium leading-none whitespace-nowrap truncate [font-size:11px] [border-width:0.7px]"
                        style={{
                          backgroundColor: `${tag.color || '#6366f1'}26`,
                          borderColor: tag.color || '#6366f1',
                          color: '#FFFFFF',
                        }}
                      >
                        {tag.name}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <div className="px-6 pb-6 flex gap-2 shrink-0">
            <Button className="flex-1 groove-btn" style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' }} onClick={() => setShowBulkTagDialog(false)} disabled={assigningBulkTags}>
              CANCEL
            </Button>
            <Button className="flex-1 groove-btn-positive" style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' }} onClick={handleBulkAssignTags} disabled={assigningBulkTags || bulkTagIds.length === 0}>
              {assigningBulkTags ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />ASSIGNING...</> : <>ASSIGN {bulkTagIds.length} TAG{bulkTagIds.length !== 1 ? 'S' : ''}</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bug 6 — Reactivate Dialog */}
      <Dialog open={showReactivateDialog} onOpenChange={setShowReactivateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reactivate Leads</DialogTitle>
            <DialogDescription style={{ fontSize: '13px' }}>
              Enrol {selectedContacts.size} selected lead{selectedContacts.size === 1 ? '' : 's'} into an engagement workflow. Each lead gets a fresh engagement_executions row with kind='reactivation'.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <div className="space-y-1.5">
              <Label style={{ fontSize: '13px' }}>Workflow</Label>
              <Select value={reactivateWorkflowId} onValueChange={setReactivateWorkflowId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select workflow..." />
                </SelectTrigger>
                <SelectContent>
                  {reactivateWorkflows.map(w => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}{w.status ? ` (${w.status})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedContacts.size > 100 && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                ⚠ {selectedContacts.size} leads selected. Reactivating in bulk fires N HTTP calls + N Trigger.dev runs sequentially. Consider creating a campaign instead if &gt; 100 leads.
              </div>
            )}
          </div>
          <div className="px-6 pb-6 flex gap-2 shrink-0">
            <Button className="flex-1 groove-btn" style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' }} onClick={() => setShowReactivateDialog(false)} disabled={reactivating}>
              CANCEL
            </Button>
            <Button className="flex-1 groove-btn-positive" style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' }} onClick={handleBulkReactivate} disabled={reactivating || !reactivateWorkflowId}>
              {reactivating ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />REACTIVATING...</> : <>REACTIVATE {selectedContacts.size}</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>


      {/* GHL Push Dialog */}
      <Dialog open={showGHLDialog} onOpenChange={setShowGHLDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Push to GoHighLevel</DialogTitle>
            <DialogDescription style={{ fontSize: '13px' }}>Send {selectedContacts.size} selected leads to a GHL webhook.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <div className="space-y-1.5">
              <Label style={{ fontSize: '13px' }}>Webhook URL</Label>
              <Input
                value={ghlWebhookUrl}
                onChange={e => setGhlWebhookUrl(e.target.value)}
                placeholder="https://services.leadconnectorhq.com/hooks/..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGHLDialog(false)}>Cancel</Button>
            <Button onClick={handlePushToGHL} disabled={!ghlWebhookUrl.trim() || pushingToGHL}>
              {pushingToGHL ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
              Push {selectedContacts.size} Contacts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Contact Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Lead</DialogTitle>
            <DialogDescription style={{ fontSize: '13px' }}>Update the lead's information.</DialogDescription>
          </DialogHeader>
          {editingContact && (
            <div className="space-y-4 p-6">
              {Object.entries(editFormData).map(([key, value]) => (
                <div key={key} className="space-y-1.5">
                  <Label style={{ fontSize: '13px' }}>{key}</Label>
                  <Input
                    value={value || ''}
                    onChange={e => setEditFormData(prev => ({ ...prev, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        onConfirm={handleDeleteContacts}
        title="Delete Leads"
        description={`Are you sure you want to delete ${effectiveSelectedCountFinal.toLocaleString()} lead(s)? This action cannot be undone.`}
      />

      {/* Add Contact Dialog */}
      <Dialog open={showAddContactDialog} onOpenChange={setShowAddContactDialog}>
        <DialogContent className="max-w-md !p-0 max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Add Contact</DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="field-text">First Name</Label>
                <Input
                  value={addContactForm.first_name}
                  onChange={e => setAddContactForm(prev => ({ ...prev, first_name: e.target.value }))}
                  placeholder="John"
                  className="field-text"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="field-text">Last Name</Label>
                <Input
                  value={addContactForm.last_name}
                  onChange={e => setAddContactForm(prev => ({ ...prev, last_name: e.target.value }))}
                  placeholder="Doe"
                  className="field-text"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="field-text">Email</Label>
              <Input
                type="email"
                value={addContactForm.email}
                onChange={e => setAddContactForm(prev => ({ ...prev, email: e.target.value }))}
                placeholder="john@example.com"
                className="field-text"
              />
              {addContactForm.email.trim() && !isValidEmail(addContactForm.email.trim()) && (
                <p className="text-[13px] mt-0.5" style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'hsl(0 70% 60%)' }}>
                  Please enter a valid email address
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="field-text">Phone Number</Label>
              <PhoneInputComponent
                defaultCountry="US"
                value={addContactForm.phone}
                onChange={(value) => setAddContactForm(prev => ({ ...prev, phone: value || '' }))}
                className="phone-input-groove"
              />
            </div>
            {!addContactForm.email.trim() && !addContactForm.phone.replace(/[^0-9]/g, '').length && (
              <p className="text-[13px]" style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'hsl(0 70% 60%)' }}>
                A phone number or email is required
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="field-text">Business Name</Label>
              <Input
                value={addContactForm.business_name}
                onChange={e => setAddContactForm(prev => ({ ...prev, business_name: e.target.value }))}
                placeholder="Acme Inc."
                className="field-text"
              />
            </div>
            <div className="border-t border-dashed border-border pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>Custom Lead ID</Label>
                  <p className="text-muted-foreground mt-0.5" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>Use specific ID instead of auto-generated</p>
                </div>
                <Switch checked={useCustomId} onCheckedChange={setUseCustomId} />
              </div>
              {useCustomId && (
                <div className="space-y-1.5">
                  <Label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>Lead ID</Label>
                  <Input
                    value={customId}
                    onChange={e => setCustomId(e.target.value)}
                    placeholder="e.g. ext-12345 or UUID"
                    className="field-text"
                  />
                </div>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1 groove-btn field-text"
                onClick={() => setShowAddContactDialog(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 groove-btn field-text"
                onClick={handleAddContact}
                disabled={addingContact || (!addContactForm.email.trim() && !addContactForm.phone.replace(/[^0-9]/g, '').length) || (addContactForm.email.trim() && !isValidEmail(addContactForm.email.trim()))}
              >
                {addingContact ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Plus className="w-4 h-4 mr-1.5" />}
                Add Contact
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* CRM Settings Dialog */}
      {clientId && (
        <CrmSettingsDialog
          open={showCrmSettings}
          onOpenChange={setShowCrmSettings}
          clientId={clientId}
        />
      )}

      <SavingOverlay isVisible={deleting} message="Deleting leads..." variant="fixed" />

      <LaunchWorkflowDialog
        open={showLaunchWorkflowDialog}
        onOpenChange={setShowLaunchWorkflowDialog}
        clientId={clientId || ''}
        leads={workflowLeads}
        leadCount={effectiveSelectedCountFinal}
      />
    </div>
  );
};

export default Contacts;
