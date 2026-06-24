import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Eye, Share2, Phone, MessageSquare, FileText } from '@/components/icons';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import EditorCanvas from '@/components/editor/EditorCanvas';
import PropertiesPanel from '@/components/editor/PropertiesPanel';
import { PageSection, CanvasState } from '@/types/editor';

export default function DemoPageEditor() {
  const { clientId, pageId } = useParams();
  const navigate = useNavigate();

  usePageHeader({
    title: 'Demo Pages',
    breadcrumbs: [
      { label: 'Demo Pages', onClick: () => navigate(`/client/${clientId}/demo-pages`) },
      { label: 'Editor' },
    ],
  });
  const { toast } = useToast();
  
  const [canvasState, setCanvasState] = useState<CanvasState>({
    pageId: pageId || '',
    pageTitle: 'Untitled Demo Page',
    slug: '',
    clientId: clientId || '',
    sections: [],
    isPublished: false,
    activeTab: 'voice-ai',
  });
  
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState(false);
  const [publishedSections, setPublishedSections] = useState<PageSection[]>([]);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasStateRef = useRef(canvasState);

  // Keep ref in sync with state for use in debounced save
  useEffect(() => {
    canvasStateRef.current = canvasState;
  }, [canvasState]);

  useEffect(() => {
    if (pageId && pageId !== 'new') {
      loadPage();
    } else {
      initializeNewPage();
    }
    
    // Cleanup on unmount - save any pending changes
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [pageId]);

  const loadPage = async () => {
    try {
      const { data, error } = await supabase
        .from('demo_pages')
        .select('*')
        .eq('id', pageId)
        .single();

      if (error) throw error;
      
      const rawSections = (data as any).sections && typeof (data as any).sections === 'string'
        ? JSON.parse((data as any).sections)
        : ((data as any).sections || []);

      const fallbackSections: PageSection[] = (rawSections && rawSections.length > 0)
        ? rawSections
        : [
            {
              id: 'voice-section-1',
              type: 'voiceAISection',
              visible: true,
              properties: {
                heading: (data as any).voice_section_title || 'Test Your Voice AI Agent',
                subheading: (data as any).voice_section_subtitle || 'Call the number below to speak with your AI representative',
                phoneNumber: (data as any).voice_phone_number || '',
                countryCode: (data as any).voice_phone_country_code || '+1',
                buttonText: 'Request a Call',
                webhookUrl: (data as any).phone_call_webhook_url || '',
                padding: { top: 60, bottom: 60, left: 40, right: 40 },
                backgroundColor: 'hsl(var(--muted))',
              },
            },
            {
              id: 'text-section-1',
              type: 'textAISection',
              visible: true,
              properties: {
                heading: (data as any).text_ai_title || 'Test Your Text AI Sales Rep',
                subheading: (data as any).text_ai_subtitle || 'Have a conversation with your AI agent through your preferred messaging platform',
                enabledPlatforms: (data as any).text_ai_enabled_platforms || ['whatsapp'],
                webhookUrl: (data as any).text_ai_webhook_url || '',
              },
            },
            {
              id: 'form-section-1',
              type: 'formAISection',
              visible: true,
              properties: {
                heading: (data as any).form_ai_title || 'See How Your Meta Ads Will Look',
                subheading: (data as any).form_ai_subtitle || 'Click on any ad to submit a test form and see how leads are captured',
                webhookUrl: (data as any).form_ai_webhook_url || '',
                successMessage: (data as any).form_success_message || 'Thank you! Your information has been submitted successfully.',
              },
            },
          ];
      
      const newCanvasState = {
        pageId: data.id,
        pageTitle: (data as any).title || 'Untitled Demo Page',
        slug: data.slug,
        clientId: data.client_id,
        sections: fallbackSections,
        isPublished: data.is_published,
        activeTab: 'voice-ai' as const,
      };
      
      setCanvasState(newCanvasState);
      
      // Load published sections to compare for unpublished changes
      const pubSections = (data as any).published_sections 
        ? (typeof (data as any).published_sections === 'string' 
            ? JSON.parse((data as any).published_sections) 
            : (data as any).published_sections)
        : [];
      setPublishedSections(pubSections);
      
      // Check if there are unpublished changes
      const hasUnpublished = data.is_published && 
        JSON.stringify(fallbackSections) !== JSON.stringify(pubSections) &&
        pubSections.length > 0;
      setHasUnpublishedChanges(hasUnpublished);
      
      // If sections were empty, save the fallback sections immediately
      if (rawSections.length === 0 && fallbackSections.length > 0) {
        // Save directly to DB without relying on state
        await supabase
          .from('demo_pages')
          .update({ sections: JSON.stringify(fallbackSections) })
          .eq('id', pageId);
      }
    } catch (error: any) {
      console.error('Error loading page:', error);
      toast({
        title: 'Error',
        description: 'Failed to load demo page',
        variant: 'destructive',
      });
    }
  };

  const initializeNewPage = async () => {
    let clientLogoUrl = '';
    let clientName = 'Your Company';
    
    if (clientId) {
      const { data: clientData } = await supabase
        .from('clients_public')
        .select('image_url, name')
        .eq('id', clientId)
        .single();
      
      clientLogoUrl = clientData?.image_url || '';
      clientName = clientData?.name || 'Your Company';
    }

    const defaultSections: PageSection[] = [
      {
        id: 'voice-section-1',
        type: 'voiceAISection',
        visible: true,
        properties: {
          heading: 'Test Your Voice AI Agent',
          subheading: 'Call the number below to speak with your AI representative',
          phoneNumber: '+1-555-0000',
          countryCode: '+1',
          buttonText: 'Give Us a Call',
          padding: { top: 60, bottom: 60, left: 40, right: 40 },
          backgroundColor: 'hsl(220 13% 91%)',
        },
      },
      {
        id: 'text-section-1',
        type: 'textAISection',
        visible: true,
        properties: {
          heading: 'Test Your Text AI Sales Rep',
          subheading: 'Chat with your AI agent on your preferred platform',
          companyName: clientName,
          platforms: { whatsapp: true, instagram: false, messenger: false, imessage: false },
          activePlatform: 'whatsapp',
          webhookUrl: '',
          padding: { top: 60, bottom: 60, left: 40, right: 40 },
        },
      },
      {
        id: 'form-section-1',
        type: 'formAISection',
        visible: true,
        properties: {
          heading: 'See How Your Meta Ads Will Look',
          subheading: 'Click any creative to test the lead form experience',
          companyPageName: clientName,
          companyPageLogo: clientLogoUrl,
          webhookUrl: '',
          creatives: [],
          padding: { top: 60, bottom: 60, left: 40, right: 40 },
        },
      },
    ];

    setCanvasState({
      ...canvasState,
      sections: defaultSections,
      activeTab: 'voice-ai',
    });
  };

  const handleAutoSave = async () => {
    if (canvasState.pageId && canvasState.pageId !== 'new') {
      await handleSave(true);
    }
  };

  const handleSave = async (isAutoSave = false, overrides?: { isPublished?: boolean }) => {
    setSaving(true);
    
    // Use the ref to get the latest state (important for debounced saves)
    const currentState = canvasStateRef.current;
    
    try {
      const newSlug = currentState.slug || generateSlug();
      // IMPORTANT: For auto-saves, preserve the current is_published status in DB
      // Only change is_published when explicitly publishing (overrides provided)
      const shouldUpdatePublishedStatus = overrides?.isPublished !== undefined;
      
      const serializedState: Record<string, any> = {
        title: currentState.pageTitle,
        intro_title: currentState.pageTitle,
        slug: newSlug,
        client_id: clientId,
        sections: JSON.stringify(currentState.sections),
        header_logo_url: getPropertyFromSection('header', 'logoUrl'),
        intro_subtitle: getPropertyFromSection('intro', 'subheading'),
        voice_section_title: getPropertyFromSection('voiceAISection', 'heading'),
        voice_section_subtitle: getPropertyFromSection('voiceAISection', 'subheading'),
        voice_phone_number: getPropertyFromSection('voiceAISection', 'phoneNumber'),
        voice_phone_country_code: getPropertyFromSection('voiceAISection', 'countryCode'),
        voice_call_enabled: !!getPropertyFromSection('voiceAISection', 'phoneNumber'),
        phone_call_webhook_url: getPropertyFromSection('voiceAISection', 'webhookUrl'),
        text_ai_title: getPropertyFromSection('textAISection', 'heading'),
        text_ai_subtitle: getPropertyFromSection('textAISection', 'subheading'),
        text_ai_webhook_url: getPropertyFromSection('textAISection', 'webhookUrl'),
        form_ai_title: getPropertyFromSection('formAISection', 'heading'),
        form_ai_subtitle: getPropertyFromSection('formAISection', 'subheading'),
        form_ai_webhook_url: getPropertyFromSection('formAISection', 'webhookUrl'),
        creatives_section_title: getPropertyFromSection('creativesSection', 'heading'),
        creatives_section_subtitle: getPropertyFromSection('creativesSection', 'subheading'),
        creatives_page_name: getPropertyFromSection('creativesSection', 'companyPageName'),
        creatives_page_logo: getPropertyFromSection('creativesSection', 'companyPageLogo'),
        creatives: getPropertyFromSection('creativesSection', 'creatives') || [],
        chatbot_section_title: getPropertyFromSection('chatbotSection', 'heading'),
        chatbot_section_subtitle: getPropertyFromSection('chatbotSection', 'subheading'),
        chat_widget_code: getPropertyFromSection('chatbotSection', 'chatWidgetCode'),
        webhook_url: 'https://example.com/webhook',
      };
      
      // Only update is_published when explicitly publishing (not during auto-save)
      if (shouldUpdatePublishedStatus) {
        serializedState.is_published = overrides!.isPublished;
        // When publishing, copy sections to published_sections so public page shows latest
        if (overrides!.isPublished) {
          serializedState.published_sections = currentState.sections;
        }
      }

      if (currentState.pageId && currentState.pageId !== 'new') {
        const { data, error } = await supabase
          .from('demo_pages')
          .update(serializedState as any)
          .eq('id', currentState.pageId)
          .select()
          .single();

        if (error) throw error;
        
        // Update local state with saved values
        setCanvasState(prev => ({ 
          ...prev, 
          slug: data.slug,
          isPublished: data.is_published 
        }));
        
        return data;
      } else {
        // For new pages, always include is_published (default false or from override)
        const insertData = {
          ...serializedState,
          is_published: overrides?.isPublished ?? false,
        };
        const { data, error } = await supabase
          .from('demo_pages')
          .insert([insertData as any])
          .select()
          .single();

        if (error) throw error;
        
        setCanvasState(prev => ({ 
          ...prev, 
          pageId: data.id, 
          slug: data.slug,
          isPublished: data.is_published 
        }));
        navigate(`/client/${clientId}/demo-pages/${data.id}`, { replace: true });
        
        return data;
      }
    } catch (error: any) {
      console.error('Error saving page:', error);
      if (!isAutoSave) {
        toast({
          title: 'Error',
          description: 'Failed to save demo page',
          variant: 'destructive',
        });
      }
      return null;
    } finally {
      setSaving(false);
    }
  };

  const getPropertyFromSection = (sectionType: string, propertyKey: string) => {
    const currentState = canvasStateRef.current;
    const section = currentState.sections.find(s => s.type === sectionType);
    return section?.properties?.[propertyKey] || null;
  };

  const generateSlug = () => {
    return `demo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  const handlePreview = () => {
    if (canvasState.slug) {
      window.open(`/demo/${canvasState.slug}`, '_blank');
    } else {
      toast({
        title: 'Save Required',
        description: 'Please save your page before previewing',
        variant: 'destructive',
      });
    }
  };

  const handlePublish = async () => {
    const savedData = await handleSave(false, { isPublished: true });
    
    if (savedData) {
      // Update published sections to match current sections
      setPublishedSections(canvasStateRef.current.sections);
      setHasUnpublishedChanges(false);
      toast({
        title: 'Published!',
        description: `Your demo page is now live`,
      });
    }
  };

  const updateSection = (sectionId: string, updates: Partial<PageSection>) => {
    setCanvasState({
      ...canvasState,
      sections: canvasState.sections.map(section =>
        section.id === sectionId ? { ...section, ...updates } : section
      ),
    });
  };

  // Debounced save function - saves 2 seconds after last change
  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    setHasUnsavedChanges(true);
    
    saveTimeoutRef.current = setTimeout(async () => {
      const currentState = canvasStateRef.current;
      if (currentState.pageId && currentState.pageId !== 'new') {
        await handleSave(true);
        setHasUnsavedChanges(false);
      }
    }, 2000);
  }, []);

  const updateSectionProperty = (sectionId: string, propertyKey: string, value: any) => {
    setCanvasState(prev => {
      const updatedSections = prev.sections.map(section =>
        section.id === sectionId
          ? { ...section, properties: { ...section.properties, [propertyKey]: value } }
          : section
      );
      
      return {
        ...prev,
        sections: updatedSections,
      };
    });
    
    // Mark as having unpublished changes when editing a published page
    if (canvasState.isPublished) {
      setHasUnpublishedChanges(true);
    }
    
    // Trigger debounced save on every property change
    debouncedSave();
  };

  const handleTabChange = (tab: 'voice-ai' | 'text-ai' | 'form-ai') => {
    setCanvasState({ ...canvasState, activeTab: tab });
    
    const tabSectionMap = {
      'voice-ai': 'voiceAISection',
      'text-ai': 'textAISection',
      'form-ai': 'formAISection',
    };
    
    const section = canvasState.sections.find(s => s.type === tabSectionMap[tab]);
    if (section) {
      setSelectedElement(section.id);
    }
  };

  return (
    <div className="h-screen flex flex-col">
      {/* FIXED HEADER ROW 1 - Actions */}
      <div className="h-16 bg-background border-b flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/client/${clientId}/demo-pages`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <input
            type="text"
            value={canvasState.pageTitle}
            onChange={(e) => {
              setCanvasState({ ...canvasState, pageTitle: e.target.value });
              if (canvasState.isPublished) {
                setHasUnpublishedChanges(true);
              }
              debouncedSave();
            }}
            className="text-sm font-medium bg-transparent border-none outline-none focus:bg-muted px-2 py-1 rounded max-w-[180px] truncate"
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {saving ? 'Saving...' : hasUnsavedChanges ? 'Unsaved...' : 'Saved'}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {hasUnpublishedChanges && canvasState.isPublished && (
            <span className="text-xs text-amber-700 bg-amber-100 px-2 py-1 rounded-md whitespace-nowrap">
              Unpublished
            </span>
          )}
          <Button variant="outline" size="sm" onClick={handlePreview}>
            <Eye className="h-4 w-4" />
            <span className="hidden sm:inline ml-2">Preview</span>
          </Button>
          <Button 
            size="sm" 
            onClick={handlePublish} 
            disabled={saving}
            variant={hasUnpublishedChanges ? "default" : "outline"}
          >
            <Share2 className="h-4 w-4" />
            <span className="hidden sm:inline ml-2">
              {hasUnpublishedChanges ? 'Publish' : (canvasState.isPublished ? 'Published' : 'Publish')}
            </span>
          </Button>
        </div>
      </div>

      {/* FIXED HEADER ROW 2 - Tabs */}
      <div className="bg-background border-b flex-shrink-0">
        <Tabs value={canvasState.activeTab} onValueChange={(value) => handleTabChange(value as any)}>
          <TabsList className="h-12 w-full justify-start rounded-none bg-transparent border-0 p-0 px-6">
            <TabsTrigger value="voice-ai" className="h-12 data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">
              <Phone className="h-4 w-4 mr-2" />
              Voice AI
            </TabsTrigger>
            <TabsTrigger value="text-ai" className="h-12 data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">
              <MessageSquare className="h-4 w-4 mr-2" />
              Text AI
            </TabsTrigger>
            <TabsTrigger value="form-ai" className="h-12 data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">
              <FileText className="h-4 w-4 mr-2" />
              Form AI
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* SCROLLABLE CONTENT - ONLY THIS AREA SCROLLS */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas - scrolls independently */}
        <div className="flex-1 overflow-y-auto">
          <EditorCanvas
            canvasState={canvasState}
            selectedElement={selectedElement}
            onSelectElement={setSelectedElement}
            onUpdateSection={updateSection}
            onUpdateProperty={updateSectionProperty}
            onTabChange={handleTabChange}
          />
        </div>

      </div>
    </div>
  );
}
