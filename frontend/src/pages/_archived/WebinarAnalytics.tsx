import React, { useState, useEffect } from 'react';
import RetroLoader from '@/components/RetroLoader';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { FileSpreadsheet, Send, Loader2, AlertCircle, Users, UserX, Database, Zap } from '@/components/icons';
import { ConfigStatusBar } from '@/components/ConfigStatusBar';
import { WebinarFileUpload } from '@/components/webinar/WebinarFileUpload';
import { MatchingResultsCard, MatchedContact } from '@/components/webinar/MatchingResultsCard';
import { useWebinarFileParser } from '@/hooks/useWebinarFileParser';

const WebinarAnalytics = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  const [matchedContacts, setMatchedContacts] = useState<MatchedContact[]>([]);
  const [matchingStats, setMatchingStats] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Credentials state
  const [ghlLocationId, setGhlLocationId] = useState<string | null>(null);
  const [ghlApiKey, setGhlApiKey] = useState<string | null>(null);

  // File parser hook
  const {
    attendedFile, attendedData, attendedStats, attendedError, attendedDragOver, setAttendedDragOver, parseAttendedReport, resetAttended,
    unattendedFile, unattendedData, unattendedStats, unattendedError, unattendedDragOver, setUnattendedDragOver, parseUnattendedReport, resetUnattended,
    crmFile, crmData, crmStats, crmError, crmDragOver, setCrmDragOver, parseCRMReport, resetCRM,
    resetAll
  } = useWebinarFileParser();

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
  const canMatch = attendedData && unattendedData.length > 0 && crmData.length > 0;

  const configItems = [
    { name: 'GHL Location ID', isConfigured: Boolean(ghlLocationId?.trim()), description: 'Required for syncing', scrollToId: 'ghl-location-id-section' },
    { name: 'GHL API Key', isConfigured: Boolean(ghlApiKey?.trim()), description: 'Required for authentication', scrollToId: 'ghl-api-key-section' }
  ];

  const handleMatch = async () => {
    if (!clientId || !attendedData || !unattendedData.length || !crmData.length) return;

    setMatching(true);
    try {
      // Prepare attendees data
      const attendees = attendedData.attendees.map(a => ({
        userName: a.userName,
        email: a.email,
        joinTime: a.joinTime,
        leaveTime: a.leaveTime,
        timeInSessionMinutes: a.timeInSessionMinutes,
        isGuest: a.isGuest === 'Yes',
        country: a.countryRegion
      }));

      // Prepare registrants (non-attendees)
      const registrants = unattendedData.map(r => ({
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        userName: r.userName
      }));

      // Prepare CRM contacts
      const ghlContacts = crmData.map(c => ({
        contactId: c.contactId,
        firstName: c.firstName,
        lastName: c.lastName,
        name: c.name,
        phone: c.phone,
        email: c.email,
        created: c.created,
        lastActivity: c.lastActivity,
        tags: c.tags
      }));

      const { data, error } = await supabase.functions.invoke('match-webinar-contacts', {
        body: { clientId, attendees, registrants, ghlContacts }
      });

      if (error) throw error;

      if (data?.matchedContacts) {
        setMatchedContacts(data.matchedContacts);
        setMatchingStats(data.stats);
        toast({ title: 'Matching Complete', description: `Matched ${data.stats.matchedHigh + data.stats.matchedMedium + data.stats.matchedLow} of ${data.stats.totalAttendees} attendees` });
      }
    } catch (error: any) {
      console.error('Matching error:', error);
      toast({ title: 'Error', description: 'Failed to match contacts', variant: 'destructive' });
    } finally {
      setMatching(false);
    }
  };

  const handleExport = () => {
    if (!matchedContacts.length) return;
    
    const csvHeaders = ['Webinar Name', 'CRM Email', 'CRM Phone', 'Time (min)', 'Confidence', 'Match Method'];
    const csvRows = matchedContacts.map(c => [
      c.userName, c.crmEmail || '', c.crmPhone || '', c.timeInSessionMinutes.toString(), c.matchConfidence, c.matchMethod || ''
    ]);
    
    const csvContent = [csvHeaders.join(','), ...csvRows.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'matched_contacts.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <RetroLoader />;
  }

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b">
        <div className="container mx-auto max-w-7xl px-4 py-4 space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Webinar Analytics</h1>
            <p className="text-muted-foreground mt-1">Upload reports to match attendees with CRM contacts</p>
          </div>
          <ConfigStatusBar configs={configItems} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto max-w-7xl px-4 py-6 space-y-6">
          {!isConfigured ? (
            <Card>
              <CardContent className="text-center py-8">
                <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
                <h3 className="font-medium">Configuration Required</h3>
                <p className="text-sm text-muted-foreground">Configure GHL credentials first</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Three File Upload Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <WebinarFileUpload
                  title="Attended Report"
                  description="Zoom attendees who joined"
                  icon={<Users className="h-5 w-5" />}
                  file={attendedFile}
                  stats={attendedStats}
                  error={attendedError}
                  isDragOver={attendedDragOver}
                  colorScheme="blue"
                  onFileSelect={parseAttendedReport}
                  onRemove={resetAttended}
                  onDragOver={(e) => { e.preventDefault(); setAttendedDragOver(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setAttendedDragOver(false); }}
                  onDrop={(e) => { e.preventDefault(); setAttendedDragOver(false); }}
                  inputId="attended-file-input"
                  showTimeStats={true}
                />

                <WebinarFileUpload
                  title="Unattended Report"
                  description="Registrants who didn't join"
                  icon={<UserX className="h-5 w-5" />}
                  file={unattendedFile}
                  stats={unattendedStats}
                  error={unattendedError}
                  isDragOver={unattendedDragOver}
                  colorScheme="orange"
                  onFileSelect={parseUnattendedReport}
                  onRemove={resetUnattended}
                  onDragOver={(e) => { e.preventDefault(); setUnattendedDragOver(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setUnattendedDragOver(false); }}
                  onDrop={(e) => { e.preventDefault(); setUnattendedDragOver(false); }}
                  inputId="unattended-file-input"
                />

                <WebinarFileUpload
                  title="CRM Report"
                  description="GHL contacts export"
                  icon={<Database className="h-5 w-5" />}
                  file={crmFile}
                  stats={crmStats}
                  error={crmError}
                  isDragOver={crmDragOver}
                  colorScheme="green"
                  onFileSelect={parseCRMReport}
                  onRemove={resetCRM}
                  onDragOver={(e) => { e.preventDefault(); setCrmDragOver(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setCrmDragOver(false); }}
                  onDrop={(e) => { e.preventDefault(); setCrmDragOver(false); }}
                  inputId="crm-file-input"
                />
              </div>

              {/* Match Button */}
              <Card>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">Match Attendees with CRM</h3>
                      <p className="text-sm text-muted-foreground">
                        {canMatch ? 'All files uploaded. Ready to match.' : 'Upload all 3 files to start matching'}
                      </p>
                    </div>
                    <Button onClick={handleMatch} disabled={!canMatch || matching} size="lg">
                      {matching ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Matching...</>
                      ) : (
                        <><Zap className="h-4 w-4 mr-2" />Match Contacts</>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Results */}
              {matchedContacts.length > 0 && matchingStats && (
                <MatchingResultsCard
                  matchedContacts={matchedContacts}
                  stats={matchingStats}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onExport={handleExport}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default WebinarAnalytics;
