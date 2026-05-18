import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { 
  Upload, FileSpreadsheet, Send, Loader2, CheckCircle, AlertCircle, 
  Users, Clock, Globe, Search, ChevronUp, ChevronDown, 
  UserCheck, Phone, Mail, Sparkles, UserX, Info
} from '@/components/icons';
import { ConfigStatusBar } from '@/components/ConfigStatusBar';
import { cn } from '@/lib/utils';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';

const WEBINAR_ANALYTICS_WEBHOOK = 'https://n8n-1prompt.99players.com/webhook/webinar-analytics-tool';

// Interfaces
interface ZoomAttendee {
  userName: string;
  email?: string;
  joinTime: string;
  leaveTime: string;
  timeInSessionMinutes: number;
  isGuest: boolean;
  country: string;
}

interface ZoomRegistrant {
  firstName: string;
  lastName: string;
  email: string;
  userName: string;
}

interface GHLContact {
  contactId: string;
  firstName: string;
  lastName: string;
  name: string;
  phone: string;
  email: string;
  created: string;
  lastActivity: string;
  tags: string;
}

interface MatchedContact {
  userName: string;
  attended: boolean;
  joinTime?: string;
  leaveTime?: string;
  timeInSessionMinutes: number;
  country: string;
  registrationEmail?: string;
  registrationFirstName?: string;
  registrationLastName?: string;
  contactId?: string;
  crmFirstName?: string;
  crmLastName?: string;
  crmEmail?: string;
  crmPhone?: string;
  crmTags?: string;
  matchConfidence: 'high' | 'medium' | 'low' | 'unmatched';
  matchMethod?: string;
}

interface WebinarInfo {
  topic: string;
  webinarId: string;
  actualStartTime: string;
  actualDurationMinutes: number;
  uniqueViewers: number;
  totalUsers: number;
}

interface MatchingStats {
  totalAttendees: number;
  totalRegistrants: number;
  totalGHLContacts: number;
  matchedHigh: number;
  matchedMedium: number;
  matchedLow: number;
  unmatched: number;
  withPhoneCount: number;
  withEmailCount: number;
}

interface FileUploadState {
  file: File | null;
  parsed: boolean;
  error: string | null;
  data: any[] | null;
}

const WebinarAnalyticsEnhanced = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();

  usePageHeader({
    title: 'Webinar',
    breadcrumbs: [
      { label: 'Webinar' },
      { label: 'Analytics' },
    ],
  });
  
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // File states
  const [attendedFile, setAttendedFile] = useState<FileUploadState>({ file: null, parsed: false, error: null, data: null });
  const [notAttendedFile, setNotAttendedFile] = useState<FileUploadState>({ file: null, parsed: false, error: null, data: null });
  const [ghlFile, setGhlFile] = useState<FileUploadState>({ file: null, parsed: false, error: null, data: null });
  
  // Data states
  const [webinarInfo, setWebinarInfo] = useState<WebinarInfo | null>(null);
  const [matchedContacts, setMatchedContacts] = useState<MatchedContact[]>([]);
  const [matchingStats, setMatchingStats] = useState<MatchingStats | null>(null);
  
  // UI states
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<keyof MatchedContact>('timeInSessionMinutes');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [activeTab, setActiveTab] = useState('upload');
  const [filterType, setFilterType] = useState<'all' | 'matched' | 'unmatched'>('all');
  
  // Credentials
  const [ghlLocationId, setGhlLocationId] = useState<string | null>(null);
  const [ghlApiKey, setGhlApiKey] = useState<string | null>(null);

  useEffect(() => {
    if (clientId) {
      fetchCredentials();
    }
  }, [clientId]);

  const fetchCredentials = async () => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('ghl_location_id, ghl_api_key')
        .eq('id', clientId)
        .single();
      
      if (error) throw error;
      
      setGhlLocationId(data?.ghl_location_id || null);
      setGhlApiKey(data?.ghl_api_key || null);
    } catch (error) {
      console.error('Error fetching credentials:', error);
    } finally {
      setLoading(false);
    }
  };

  const isConfigured = Boolean(ghlLocationId?.trim()) && Boolean(ghlApiKey?.trim());

  const configItems = [
    {
      name: 'GHL Location ID',
      isConfigured: Boolean(ghlLocationId?.trim()),
      description: 'Required for syncing webinar data with GoHighLevel',
      scrollToId: 'ghl-location-id-section'
    },
    {
      name: 'GHL API Key',
      isConfigured: Boolean(ghlApiKey?.trim()),
      description: 'Required for authenticating with GoHighLevel API',
      scrollToId: 'ghl-api-key-section'
    }
  ];

  // CSV Parsing functions
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  };

  // Parse Attended Report (Attended = Yes)
  const parseAttendedCSV = (csvText: string): { info: WebinarInfo; attendees: ZoomAttendee[] } => {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim());
    
    if (lines.length < 4 || !lines[0].includes('Attendee Report')) {
      throw new Error('Invalid Zoom Attendee Report format');
    }

    const webinarValues = parseCSVLine(lines[3]);
    const info: WebinarInfo = {
      topic: webinarValues[0] || '',
      webinarId: webinarValues[1] || '',
      actualStartTime: webinarValues[2] || '',
      actualDurationMinutes: parseInt(webinarValues[3]) || 0,
      uniqueViewers: parseInt(webinarValues[4]) || 0,
      totalUsers: parseInt(webinarValues[5]) || 0,
    };

    const attendeeDetailsIndex = lines.findIndex(line => line.includes('Attendee Details'));
    const attendees: ZoomAttendee[] = [];
    
    if (attendeeDetailsIndex !== -1) {
      for (let i = attendeeDetailsIndex + 2; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length >= 7 && values[0] === 'Yes') {
          attendees.push({
            userName: values[1] || '',
            email: values[2] || undefined,
            joinTime: values[3] || '',
            leaveTime: values[4] || '',
            timeInSessionMinutes: parseInt(values[5]) || 0,
            isGuest: values[6] === 'Yes',
            country: values[7] || '',
          });
        }
      }
    }

    return { info, attendees };
  };

  // Parse Not Attended Report (Attended = No) - This has registration info with emails
  const parseNotAttendedCSV = (csvText: string): ZoomRegistrant[] => {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim());
    
    if (lines.length < 4 || !lines[0].includes('Attendee Report')) {
      throw new Error('Invalid Zoom Report format');
    }

    const attendeeDetailsIndex = lines.findIndex(line => line.includes('Attendee Details'));
    const registrants: ZoomRegistrant[] = [];
    
    if (attendeeDetailsIndex !== -1) {
      for (let i = attendeeDetailsIndex + 2; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        // Not attended rows have "No" in first column and contain registration info
        if (values.length >= 6 && values[0] === 'No') {
          registrants.push({
            userName: values[1] || '',
            firstName: values[2] || '',
            lastName: values[3] || '',
            email: values[4] || '',
          });
        }
      }
    }

    return registrants;
  };

  const parseGHLContactsCSV = (csvText: string): GHLContact[] => {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim());
    
    if (lines.length < 2) {
      throw new Error('Invalid GHL Contacts export format');
    }

    const contacts: GHLContact[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length >= 6) {
        contacts.push({
          contactId: values[0] || '',
          firstName: values[1] || '',
          lastName: values[2] || '',
          name: values[3] || '',
          phone: values[4] || '',
          email: values[5] || '',
          created: values[6] || '',
          lastActivity: values[7] || '',
          tags: values[8] || '',
        });
      }
    }

    return contacts;
  };

  // File handlers
  const handleFileUpload = async (
    file: File, 
    type: 'attended' | 'notAttended' | 'ghl',
    setter: React.Dispatch<React.SetStateAction<FileUploadState>>
  ) => {
    if (!file.name.endsWith('.csv')) {
      toast({ title: 'Invalid File', description: 'Please upload a CSV file', variant: 'destructive' });
      return;
    }

    setter({ file, parsed: false, error: null, data: null });

    try {
      const text = await file.text();
      let data: any[] = [];

      if (type === 'attended') {
        const result = parseAttendedCSV(text);
        data = result.attendees;
        setWebinarInfo(result.info);
      } else if (type === 'notAttended') {
        data = parseNotAttendedCSV(text);
      } else {
        data = parseGHLContactsCSV(text);
      }

      setter({ file, parsed: true, error: null, data });
      toast({ title: 'File Parsed', description: `Found ${data.length} records` });
    } catch (error: any) {
      setter({ file, parsed: false, error: error.message, data: null });
      toast({ title: 'Parse Error', description: error.message, variant: 'destructive' });
    }
  };

  // Consolidate duplicate attendees
  const consolidateAttendees = (attendees: ZoomAttendee[]): ZoomAttendee[] => {
    const map = new Map<string, ZoomAttendee>();
    
    for (const a of attendees) {
      const key = a.userName.toLowerCase().trim();
      if (!key) continue;
      
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...a });
      } else {
        existing.timeInSessionMinutes += a.timeInSessionMinutes;
      }
    }
    
    return Array.from(map.values());
  };

  // Process and match data
  const handleProcessData = async () => {
    if (!attendedFile.data || !clientId) return;
    
    setProcessing(true);
    
    try {
      const consolidatedAttendees = consolidateAttendees(attendedFile.data);
      
      // Build registration lookup from not-attended file (these have emails)
      const registrantsByName = new Map<string, ZoomRegistrant>();
      if (notAttendedFile.data) {
        for (const reg of notAttendedFile.data as ZoomRegistrant[]) {
          const userName = reg.userName?.toLowerCase().trim();
          if (userName) {
            registrantsByName.set(userName, reg);
          }
          // Also map by full name
          const fullName = `${reg.firstName} ${reg.lastName}`.toLowerCase().trim();
          if (fullName && fullName !== ' ') {
            registrantsByName.set(fullName, reg);
          }
        }
      }
      
      const { data, error } = await supabase.functions.invoke('match-webinar-contacts', {
        body: {
          clientId,
          attendees: consolidatedAttendees,
          registrants: notAttendedFile.data || [],
          ghlContacts: ghlFile.data || [],
        }
      });

      if (error) throw error;
      
      setMatchedContacts(data.matchedContacts);
      setMatchingStats(data.stats);
      setActiveTab('results');
      
      toast({ 
        title: 'Matching Complete', 
        description: `Matched ${data.stats.matchedHigh + data.stats.matchedMedium} contacts with high/medium confidence` 
      });
    } catch (error: any) {
      console.error('Processing error:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  // Send to GHL
  const handleSendToGHL = async () => {
    if (!matchedContacts.length || !clientId) return;
    
    setSubmitting(true);
    
    try {
      const enrichedData = matchedContacts.map(c => ({
        userName: c.userName,
        email: c.crmEmail || c.registrationEmail || '',
        phone: c.crmPhone || '',
        firstName: c.crmFirstName || c.registrationFirstName || '',
        lastName: c.crmLastName || c.registrationLastName || '',
        timeInSession: c.timeInSessionMinutes,
        country: c.country,
        attended: 'Yes',
        matchConfidence: c.matchConfidence,
        contactId: c.contactId || '',
      }));

      const csvHeaders = [
        'User Name', 'Email', 'Phone', 'First Name', 'Last Name',
        'Time in Session (min)', 'Country', 'Attended', 'Match Confidence', 'Contact ID'
      ];
      
      const csvRows = enrichedData.map(d => [
        d.userName, d.email, d.phone, d.firstName, d.lastName,
        d.timeInSession.toString(), d.country, d.attended,
        d.matchConfidence, d.contactId
      ]);

      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      const csvBlob = new Blob([csvContent], { type: 'text/csv' });
      const csvFile = new File([csvBlob], 'enriched_attendees.csv', { type: 'text/csv' });

      const formData = new FormData();
      formData.append('file', csvFile, 'enriched_attendees.csv');
      formData.append('client_id', clientId);
      formData.append('ghl_location_id', ghlLocationId || '');
      formData.append('ghl_api_key', ghlApiKey || '');
      formData.append('webinar_topic', webinarInfo?.topic || '');
      formData.append('webinar_id', webinarInfo?.webinarId || '');
      formData.append('total_attendees', matchedContacts.length.toString());
      formData.append('matched_count', ((matchingStats?.matchedHigh || 0) + (matchingStats?.matchedMedium || 0)).toString());

      const response = await fetch(WEBINAR_ANALYTICS_WEBHOOK, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      toast({
        title: 'Success',
        description: `${matchedContacts.length} enriched records sent to GoHighLevel`
      });
    } catch (error: any) {
      console.error('Error sending data:', error);
      toast({ title: 'Error', description: 'Failed to send data', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  // Filtering and sorting
  const filteredContacts = useMemo(() => {
    let result = [...matchedContacts];
    
    if (filterType === 'matched') {
      result = result.filter(c => c.matchConfidence !== 'unmatched');
    } else if (filterType === 'unmatched') {
      result = result.filter(c => c.matchConfidence === 'unmatched');
    }
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c => 
        c.userName?.toLowerCase().includes(q) ||
        c.crmEmail?.toLowerCase().includes(q) ||
        c.crmFirstName?.toLowerCase().includes(q) ||
        c.crmLastName?.toLowerCase().includes(q) ||
        c.country?.toLowerCase().includes(q)
      );
    }
    
    result.sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return result;
  }, [matchedContacts, filterType, searchQuery, sortField, sortDirection]);

  const handleSort = (field: keyof MatchedContact) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortIcon = ({ field }: { field: keyof MatchedContact }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? 
      <ChevronUp className="h-3 w-3" /> : 
      <ChevronDown className="h-3 w-3" />;
  };

  // File Upload Component
  const FileUploadBox = ({ 
    title, 
    description, 
    hint,
    state, 
    onUpload, 
    type,
    icon: Icon,
    iconColor
  }: { 
    title: string; 
    description: string;
    hint?: string;
    state: FileUploadState; 
    onUpload: (file: File) => void; 
    type: string;
    icon: React.ElementType;
    iconColor: string;
  }) => {
    const [isDragOver, setIsDragOver] = useState(false);
    const inputId = `file-upload-${type}`;
    
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className={cn("p-2 rounded-lg", iconColor)}>
            <Icon className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm">{title}</h4>
            <p className="text-xs text-muted-foreground">{description}</p>
            {hint && (
              <p className="text-xs text-primary/80 mt-1 flex items-center gap-1">
                <Info className="h-3 w-3" />
                {hint}
              </p>
            )}
          </div>
        </div>
        
        <div
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) onUpload(file);
          }}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
          onClick={() => document.getElementById(inputId)?.click()}
          className={cn(
            "border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-200",
            isDragOver && "border-primary bg-primary/5 scale-[1.02]",
            state.parsed && !state.error && "border-green-500 bg-green-50/50 dark:bg-green-950/20",
            state.error && "border-destructive bg-destructive/10",
            !state.file && !isDragOver && "border-border hover:border-primary/50 hover:bg-muted/30"
          )}
        >
          <input
            type="file"
            id={inputId}
            accept=".csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
            }}
            className="hidden"
          />
          {state.file ? (
            <div className="space-y-2">
              {state.error ? (
                <>
                  <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
                  <p className="text-sm text-destructive font-medium">Error</p>
                  <p className="text-xs text-destructive/80">{state.error}</p>
                </>
              ) : (
                <>
                  <CheckCircle className="h-8 w-8 text-green-600 mx-auto" />
                  <p className="text-sm font-medium text-green-700 truncate">{state.file.name}</p>
                  <Badge variant="secondary" className="bg-green-100 text-green-800">
                    {state.data?.length || 0} records
                  </Badge>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">Drop CSV file here or click to browse</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const getConfidenceBadge = (confidence: string) => {
    switch (confidence) {
      case 'high':
        return <Badge className="bg-green-500 text-white">High</Badge>;
      case 'medium':
        return <Badge className="bg-yellow-500 text-white">Medium</Badge>;
      case 'low':
        return <Badge className="bg-orange-500 text-white">Low</Badge>;
      default:
        return <Badge variant="secondary">Unmatched</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b">
        <div className="container mx-auto max-w-6xl px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                Webinar Analytics
              </h1>
              <p className="text-muted-foreground mt-1 ml-14">
                Match attendees with CRM contacts and enrich data
              </p>
            </div>
          </div>
          <div className="mt-4">
            <ConfigStatusBar configs={configItems} />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto max-w-6xl px-6 py-8">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-8 h-12">
              <TabsTrigger value="upload" className="gap-2 px-6">
                <Upload className="h-4 w-4" />
                Upload Files
              </TabsTrigger>
              <TabsTrigger value="results" className="gap-2 px-6" disabled={!matchedContacts.length}>
                <UserCheck className="h-4 w-4" />
                Results ({matchedContacts.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-6">
              {!isConfigured ? (
                <Card className="border-destructive/50">
                  <CardContent className="py-16 text-center">
                    <AlertCircle className="h-16 w-16 text-destructive mx-auto mb-6" />
                    <h3 className="text-xl font-semibold">Configuration Required</h3>
                    <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                      Please configure your GHL Location ID and API Key in sub-account settings before using this feature.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Upload Instructions */}
                  <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
                    <CardContent className="py-5 px-6">
                      <div className="flex items-start gap-4">
                        <Info className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                        <div>
                          <h4 className="font-semibold text-foreground">How it works</h4>
                          <p className="text-sm text-muted-foreground mt-1">
                            Upload your Zoom reports and CRM contacts. The AI will match attendees with their registration emails 
                            and CRM data to enrich contact information for sending back to GoHighLevel.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* File Upload Cards - Single Row */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Attended Report */}
                    <Card className="overflow-hidden">
                      <CardHeader className="pb-4 bg-green-50/50 dark:bg-green-950/20 border-b">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-green-600 text-white text-sm font-bold">1</span>
                          Attended Report
                        </CardTitle>
                        <CardDescription>
                          Users who joined the webinar (Attended = Yes)
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-5">
                        <FileUploadBox
                          title="Zoom Attendee Export"
                          description="Export from Zoom with attended users"
                          hint="Contains: Name, Join Time, Duration"
                          state={attendedFile}
                          onUpload={(f) => handleFileUpload(f, 'attended', setAttendedFile)}
                          type="attended"
                          icon={Users}
                          iconColor="bg-green-600"
                        />
                      </CardContent>
                    </Card>

                    {/* Not Attended Report */}
                    <Card className="overflow-hidden">
                      <CardHeader className="pb-4 bg-orange-50/50 dark:bg-orange-950/20 border-b">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-orange-600 text-white text-sm font-bold">2</span>
                          Registration Report
                        </CardTitle>
                        <CardDescription>
                          Users who registered but didn't attend (Attended = No)
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-5">
                        <FileUploadBox
                          title="Zoom Registration Export"
                          description="Export from Zoom with non-attendees"
                          hint="Contains: Name, Email (for matching)"
                          state={notAttendedFile}
                          onUpload={(f) => handleFileUpload(f, 'notAttended', setNotAttendedFile)}
                          type="notAttended"
                          icon={UserX}
                          iconColor="bg-orange-600"
                        />
                      </CardContent>
                    </Card>

                    {/* GHL Contacts */}
                    <Card className="overflow-hidden">
                      <CardHeader className="pb-4 bg-purple-50/50 dark:bg-purple-950/20 border-b">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-purple-600 text-white text-sm font-bold">3</span>
                          CRM Contacts
                        </CardTitle>
                        <CardDescription>
                          Your GoHighLevel contact list export
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-5">
                        <FileUploadBox
                          title="GHL Contacts Export"
                          description="Export your contacts from GoHighLevel"
                          hint="Contains: Name, Email, Phone, Tags"
                          state={ghlFile}
                          onUpload={(f) => handleFileUpload(f, 'ghl', setGhlFile)}
                          type="ghl"
                          icon={Mail}
                          iconColor="bg-purple-600"
                        />
                      </CardContent>
                    </Card>
                  </div>

                  {/* Webinar Info */}
                  {webinarInfo && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          Webinar Details
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                          <div>
                            <span className="text-muted-foreground text-xs uppercase tracking-wide">Topic</span>
                            <p className="font-medium mt-1">{webinarInfo.topic}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-xs uppercase tracking-wide">Webinar ID</span>
                            <p className="font-medium mt-1 font-mono text-sm">{webinarInfo.webinarId}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-xs uppercase tracking-wide">Duration</span>
                            <p className="font-medium mt-1">{webinarInfo.actualDurationMinutes} minutes</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-xs uppercase tracking-wide">Unique Viewers</span>
                            <p className="font-medium mt-1">{webinarInfo.uniqueViewers}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Files Summary */}
                  {(attendedFile.parsed || notAttendedFile.parsed || ghlFile.parsed) && (
                    <Card className="bg-muted/30">
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between flex-wrap gap-4">
                          <div className="flex items-center gap-6 text-sm">
                            {attendedFile.parsed && (
                              <div className="flex items-center gap-2">
                                <CheckCircle className="h-4 w-4 text-green-600" />
                                <span><strong>{attendedFile.data?.length || 0}</strong> attendees</span>
                              </div>
                            )}
                            {notAttendedFile.parsed && (
                              <div className="flex items-center gap-2">
                                <CheckCircle className="h-4 w-4 text-orange-600" />
                                <span><strong>{notAttendedFile.data?.length || 0}</strong> registrations (with emails)</span>
                              </div>
                            )}
                            {ghlFile.parsed && (
                              <div className="flex items-center gap-2">
                                <CheckCircle className="h-4 w-4 text-purple-600" />
                                <span><strong>{ghlFile.data?.length || 0}</strong> CRM contacts</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Process Button */}
                  <div className="flex justify-center pt-4">
                    <Button
                      size="lg"
                      onClick={handleProcessData}
                      disabled={!attendedFile.parsed || processing}
                      className="gap-3 h-14 px-10 text-base"
                    >
                      {processing ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" />
                          Matching Contacts...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-5 w-5" />
                          Match Contacts with AI
                        </>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="results" className="space-y-6">
              {matchingStats && (
                <>
                  {/* Stats Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-200">
                      <CardContent className="p-5 text-center">
                        <Users className="h-7 w-7 text-blue-600 mx-auto mb-2" />
                        <p className="text-3xl font-bold text-blue-700">{matchingStats.totalAttendees}</p>
                        <p className="text-sm text-blue-600/80 font-medium">Attendees</p>
                      </CardContent>
                    </Card>
                    
                    <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-200">
                      <CardContent className="p-5 text-center">
                        <UserCheck className="h-7 w-7 text-green-600 mx-auto mb-2" />
                        <p className="text-3xl font-bold text-green-700">
                          {matchingStats.matchedHigh + matchingStats.matchedMedium}
                        </p>
                        <p className="text-sm text-green-600/80 font-medium">Matched</p>
                      </CardContent>
                    </Card>
                    
                    <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-200">
                      <CardContent className="p-5 text-center">
                        <Globe className="h-7 w-7 text-amber-600 mx-auto mb-2" />
                        <p className="text-3xl font-bold text-amber-700">{matchingStats.unmatched}</p>
                        <p className="text-sm text-amber-600/80 font-medium">Unmatched</p>
                      </CardContent>
                    </Card>
                    
                    <Card className="bg-gradient-to-br from-violet-500/10 to-violet-600/5 border-violet-200">
                      <CardContent className="p-5 text-center">
                        <Mail className="h-7 w-7 text-violet-600 mx-auto mb-2" />
                        <p className="text-3xl font-bold text-violet-700">{matchingStats.withEmailCount}</p>
                        <p className="text-sm text-violet-600/80 font-medium">With Email</p>
                      </CardContent>
                    </Card>
                    
                    <Card className="bg-gradient-to-br from-pink-500/10 to-pink-600/5 border-pink-200">
                      <CardContent className="p-5 text-center">
                        <Phone className="h-7 w-7 text-pink-600 mx-auto mb-2" />
                        <p className="text-3xl font-bold text-pink-700">{matchingStats.withPhoneCount}</p>
                        <p className="text-sm text-pink-600/80 font-medium">With Phone</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Match Quality */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Match Quality Breakdown</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div className="flex items-center gap-4">
                          <span className="text-sm w-24 font-medium text-green-700">High</span>
                          <Progress 
                            value={(matchingStats.matchedHigh / matchingStats.totalAttendees) * 100} 
                            className="flex-1 h-3"
                          />
                          <span className="text-sm font-bold w-12 text-right">{matchingStats.matchedHigh}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm w-24 font-medium text-yellow-700">Medium</span>
                          <Progress 
                            value={(matchingStats.matchedMedium / matchingStats.totalAttendees) * 100} 
                            className="flex-1 h-3"
                          />
                          <span className="text-sm font-bold w-12 text-right">{matchingStats.matchedMedium}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm w-24 font-medium text-orange-700">Low</span>
                          <Progress 
                            value={(matchingStats.matchedLow / matchingStats.totalAttendees) * 100} 
                            className="flex-1 h-3"
                          />
                          <span className="text-sm font-bold w-12 text-right">{matchingStats.matchedLow}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm w-24 font-medium text-muted-foreground">Unmatched</span>
                          <Progress 
                            value={(matchingStats.unmatched / matchingStats.totalAttendees) * 100} 
                            className="flex-1 h-3"
                          />
                          <span className="text-sm font-bold w-12 text-right">{matchingStats.unmatched}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Table */}
                  <Card>
                    <CardHeader className="pb-4">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                          <CardTitle className="text-lg">Matched Contacts</CardTitle>
                          <CardDescription className="mt-1">
                            {filteredContacts.length} of {matchedContacts.length} contacts
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex gap-1 p-1 bg-muted rounded-lg">
                            <Button 
                              variant={filterType === 'all' ? 'default' : 'ghost'} 
                              size="sm"
                              onClick={() => setFilterType('all')}
                              className="h-8"
                            >
                              All
                            </Button>
                            <Button 
                              variant={filterType === 'matched' ? 'default' : 'ghost'} 
                              size="sm"
                              onClick={() => setFilterType('matched')}
                              className="h-8"
                            >
                              Matched
                            </Button>
                            <Button 
                              variant={filterType === 'unmatched' ? 'default' : 'ghost'} 
                              size="sm"
                              onClick={() => setFilterType('unmatched')}
                              className="h-8"
                            >
                              Unmatched
                            </Button>
                          </div>
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              placeholder="Search contacts..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="pl-10 h-10 w-56"
                            />
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <ScrollArea className="h-[450px]">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/50">
                              <TableHead 
                                className="cursor-pointer hover:bg-muted/80 transition-colors"
                                onClick={() => handleSort('userName')}
                              >
                                <div className="flex items-center gap-1">
                                  Name <SortIcon field="userName" />
                                </div>
                              </TableHead>
                              <TableHead>Email</TableHead>
                              <TableHead>Phone</TableHead>
                              <TableHead 
                                className="cursor-pointer hover:bg-muted/80 transition-colors"
                                onClick={() => handleSort('timeInSessionMinutes')}
                              >
                                <div className="flex items-center gap-1">
                                  Duration <SortIcon field="timeInSessionMinutes" />
                                </div>
                              </TableHead>
                              <TableHead>Country</TableHead>
                              <TableHead>Match</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredContacts.map((contact, idx) => (
                              <TableRow key={idx} className="hover:bg-muted/30">
                                <TableCell>
                                  <div>
                                    <p className="font-medium">{contact.userName}</p>
                                    {(contact.crmFirstName || contact.registrationFirstName) && (
                                      <p className="text-xs text-muted-foreground">
                                        {contact.crmFirstName || contact.registrationFirstName} {contact.crmLastName || contact.registrationLastName}
                                      </p>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {contact.crmEmail || contact.registrationEmail ? (
                                    <span className="text-sm">{contact.crmEmail || contact.registrationEmail}</span>
                                  ) : (
                                    <span className="text-muted-foreground/50">—</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {contact.crmPhone ? (
                                    <span className="text-sm font-mono">{contact.crmPhone}</span>
                                  ) : (
                                    <span className="text-muted-foreground/50">—</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="font-mono">
                                    {contact.timeInSessionMinutes} min
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm">{contact.country || '—'}</TableCell>
                                <TableCell>{getConfidenceBadge(contact.matchConfidence)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </CardContent>
                  </Card>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between pt-4">
                    <Button variant="outline" onClick={() => setActiveTab('upload')} className="gap-2">
                      <Upload className="h-4 w-4" />
                      Upload New Files
                    </Button>
                    <Button 
                      onClick={handleSendToGHL} 
                      disabled={submitting || !matchedContacts.length}
                      className="gap-2"
                      size="lg"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4" />
                          Send to GoHighLevel ({matchedContacts.length})
                        </>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default WebinarAnalyticsEnhanced;
