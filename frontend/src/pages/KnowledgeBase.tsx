import React, { useState, useEffect, useRef } from 'react';
import RetroLoader from '@/components/RetroLoader';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Plus, Edit, Trash2, BookOpen, Tag, Save, X, FileText, Sparkles, Webhook, ExternalLink, CheckCircle, AlertCircle } from '@/components/icons';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { ConfigStatusBar } from '@/components/ConfigStatusBar';
import { RichTextEditor } from '@/components/RichTextEditor';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import { WebhookSetupDialog } from '@/components/WebhookSetupDialog';
import { ClientWebhookSettings } from '@/components/ClientWebhookSettings';
import { useClientWebhooks } from '@/hooks/useClientWebhooks';
import { preserveMarkdownFormatting } from '@/utils/markdownConverter';
import KnowledgeBaseCard from '@/components/KnowledgeBaseCard';

interface KnowledgeArticle {
  id: string;
  title: string;
  content: string;
  tags: string[] | null;
  category: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  webhook_url: string | null;
}

const KnowledgeBase = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentView, setCurrentView] = useState<'list' | 'editor'>('list');
  const [editingArticle, setEditingArticle] = useState<KnowledgeArticle | null>(null);
  const [clientName, setClientName] = useState<string>('');
  const [articleContent, setArticleContent] = useState({
    title: '',
    content: '',
    tags: ''
  });

  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    articleId: string | null;
    articleTitle: string;
  }>({
    open: false,
    articleId: null,
    articleTitle: ''
  });
  const [webhookSetupDialog, setWebhookSetupDialog] = useState(false);
  const [hasSupabaseConfig, setHasSupabaseConfig] = useState(false);
  const [hasLLMConfig, setHasLLMConfig] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const savedContentSnapshotRef = useRef<string>('');
  
  const { webhooks, loading: webhooksLoading, updateWebhooks } = useClientWebhooks(clientId);

  const hasUnsavedEditorChanges = () => {
    if (currentView !== 'editor') return false;
    const currentSnapshot = JSON.stringify(articleContent);
    return currentSnapshot !== savedContentSnapshotRef.current;
  };

  const guardedNavigation = (action: () => void) => {
    if (hasUnsavedEditorChanges()) {
      pendingActionRef.current = action;
      setShowUnsavedDialog(true);
    } else {
      action();
    }
  };

  // Browser beforeunload warning
  useEffect(() => {
    if (currentView !== 'editor') return;
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedEditorChanges()) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [currentView, articleContent]);

  useEffect(() => {
    if (clientId) {
      fetchArticles();
      fetchClientName();
    }
  }, [clientId, user]);

  const fetchClientName = async () => {
    if (!clientId) return;
    
    try {
      const { data: clientData, error } = await supabase
        .from('clients_public')
        .select('name, supabase_url, has_supabase_service_key, has_openrouter_api_key, has_openai_api_key')
        .eq('id', clientId)
        .single();

      if (error) throw error;
      setClientName(clientData.name);

      // Check if Supabase is configured (URL and service key only - no table name required)
      const hasConfig = !!(clientData.supabase_url && clientData.has_supabase_service_key);
      setHasSupabaseConfig(hasConfig);

      // Check if LLMs are configured
      const hasLLMs = !!(clientData.has_openrouter_api_key && clientData.has_openai_api_key);
      setHasLLMConfig(hasLLMs);
    } catch (error) {
      console.error('Error fetching client name:', error);
    }
  };

  const fetchArticles = async () => {
    if (!clientId) return;

    try {
      const { data, error } = await supabase
        .from('knowledge_base')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setArticles(data || []);
    } catch (error: any) {
      console.error('Error fetching articles:', error);
      toast({
        title: "Error",
        description: "Failed to fetch knowledge base articles",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const checkWebhooksAndProceed = (action: 'create' | 'edit', article?: KnowledgeArticle) => {
    const hasRequiredWebhooks = webhooks.knowledge_base_add_webhook_url && webhooks.knowledge_base_add_webhook_url.trim();
    
    if (!hasRequiredWebhooks) {
      toast({
        title: "Webhook Required",
        description: "Please configure Knowledge Base webhook in API Management before creating or editing documents.",
        variant: "destructive"
      });
      return;
    }
    
    if (action === 'edit' && article) {
      handleEdit(article);
    } else {
      openCreateEditor();
    }
  };

  const handleWebhookSetup = async (newWebhooks: { addWebhook: string; deleteWebhook?: string }) => {
    const updates = {
      knowledge_base_add_webhook_url: newWebhooks.addWebhook
    };
    
    const success = await updateWebhooks(updates);
    if (success) {
      setWebhookSetupDialog(false);
      openCreateEditor();
    }
  };

  const handleSaveArticle = async () => {
    if (!clientId || saving) return;

    setSaving(true);
    try {
      const tags = articleContent.tags
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);

      if (editingArticle) {
        // Update existing article
        const { error } = await supabase
          .from('knowledge_base')
          .update({
            title: articleContent.title,
            content: articleContent.content,
            tags: tags.length > 0 ? tags : null,
            webhook_url: webhooks.knowledge_base_add_webhook_url,
            is_published: true
          })
          .eq('id', editingArticle.id);

        if (error) throw error;

        toast({
          title: "Document updated",
          description: "Your document has been updated successfully"
        });
      } else {
        // Create new article
        const { error } = await supabase
          .from('knowledge_base')
          .insert({
            client_id: clientId,
            title: articleContent.title,
            content: articleContent.content,
            tags: tags.length > 0 ? tags : null,
            webhook_url: webhooks.knowledge_base_add_webhook_url,
            is_published: true
          });

        if (error) throw error;

        toast({
          title: "Document created",
          description: "Your document has been created successfully"
        });
      }

      // Send webhook notification
      if (webhooks.knowledge_base_add_webhook_url) {
        await sendWebhookNotification({
          title: articleContent.title,
          content: articleContent.content,
          tags: tags,
          webhookUrl: webhooks.knowledge_base_add_webhook_url,
          action: editingArticle ? 'updated' : 'created'
        });
      }

      // Reset state and go back to list
      resetEditor();
      fetchArticles();
    } catch (error: any) {
      console.error('Error saving article:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save document",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const sendWebhookNotification = async (data: {
    title: string;
    content: string;
    tags: string[];
    webhookUrl: string;
    action: 'created' | 'updated' | 'deleted';
  }) => {
    try {
      // Convert HTML to clean markdown with proper formatting and spacing
      const markdownContent = preserveMarkdownFormatting(data.content);
      
      const response = await fetch(data.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: data.title,
          content: markdownContent, // Send properly formatted markdown
          format: 'markdown', // Indicate the content format
          tag: data.tags[0] || '', // Keep the user's original tag
          tags: data.tags, // Send all tags for better webhook processing
          action: data.action, // Add action separately (created/updated/deleted)
          timestamp: new Date().toISOString(),
          clientId: clientId
        }),
      });

      if (response.ok) {
        console.log('Webhook notification sent successfully');
      } else {
        console.warn('Webhook notification failed:', response.status);
      }
    } catch (error) {
      console.error('Error sending webhook notification:', error);
      // Don't show error toast for webhook failures as the document was saved successfully
    }
  };

  const resetEditor = () => {
    setCurrentView('list');
    setEditingArticle(null);
    setArticleContent({ title: '', content: '', tags: '' });
    savedContentSnapshotRef.current = '';
  };

  const guardedResetEditor = () => {
    guardedNavigation(resetEditor);
  };

  const handleEdit = (article: KnowledgeArticle) => {
    setEditingArticle(article);
    const newContent = {
      title: article.title,
      content: article.content,
      tags: article.tags ? article.tags.join(', ') : ''
    };
    setArticleContent(newContent);
    savedContentSnapshotRef.current = JSON.stringify(newContent);
    setCurrentView('editor');
  };

  const handleDelete = (articleId: string) => {
    const article = articles.find(a => a.id === articleId);
    if (!article) return;

    setDeleteDialog({
      open: true,
      articleId,
      articleTitle: article.title
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteDialog.articleId) return;

    const article = articles.find(a => a.id === deleteDialog.articleId);
    if (!article) return;

    try {
      // Send deletion notification to initial webhook (knowledge_base_add_webhook_url) if configured
      if (webhooks.knowledge_base_add_webhook_url) {
        await sendWebhookNotification({
          title: article.title,
          content: article.content,
          tags: article.tags || [],
          webhookUrl: webhooks.knowledge_base_add_webhook_url,
          action: 'deleted'
        });
      }

      // Delete from database
      const { error } = await supabase
        .from('knowledge_base')
        .delete()
        .eq('id', deleteDialog.articleId);

      if (error) throw error;

      toast({
        title: "Document deleted",
        description: "Document has been deleted successfully",
        className: "bg-success text-success-foreground"
      });

      fetchArticles();
    } catch (error: any) {
      console.error('Error deleting article:', error);
      toast({
        title: "Error",
        description: "Failed to delete document",
        variant: "destructive"
      });
    } finally {
      setDeleteDialog({ open: false, articleId: null, articleTitle: '' });
    }
  };

  const openCreateEditor = () => {
    setEditingArticle(null);
    const emptyContent = { title: '', content: '', tags: '' };
    setArticleContent(emptyContent);
    savedContentSnapshotRef.current = JSON.stringify(emptyContent);
    setCurrentView('editor');
  };
  usePageHeader(currentView === 'editor' ? {
    title: 'Knowledgebase',
    breadcrumbs: [
      { label: 'Knowledgebase', onClick: guardedResetEditor },
      { label: editingArticle ? 'Edit Document' : 'Create Document' },
    ],
    actions: [
      ...(editingArticle ? [{
        label: 'DELETE',
        icon: <Trash2 className="w-4 h-4" />,
        onClick: () => handleDelete(editingArticle.id),
        variant: 'destructive' as const,
        disabled: saving,
      }] : []),
      {
        label: 'CANCEL',
        onClick: guardedResetEditor,
        variant: 'ghost' as const,
        disabled: saving,
      },
      {
        label: saving ? 'SAVING...' : 'SAVE',
        icon: <Save className="w-4 h-4" />,
        onClick: handleSaveArticle,
        disabled: saving || !articleContent.title.trim() || !articleContent.content.trim() || !articleContent.tags.trim(),
      },
    ],
  } : {
    title: 'Knowledgebase',
    actions: [{
      label: 'NEW DOCUMENT',
      icon: <Plus className="w-4 h-4" />,
      onClick: () => {
        if (!hasSupabaseConfig) {
          toast({ title: "Supabase Configuration Required", description: "Please configure Supabase settings before creating documents", variant: "destructive" });
          return;
        }
        if (!hasLLMConfig) {
          toast({ title: "LLM Configuration Required", description: "Please configure OpenAI and OpenRouter API keys before creating documents", variant: "destructive" });
          return;
        }
        checkWebhooksAndProceed('create');
      },
      disabled: !hasSupabaseConfig || !hasLLMConfig || !(webhooks.knowledge_base_add_webhook_url && webhooks.knowledge_base_add_webhook_url.trim()),
    }],
  });

  if (loading) {
    return <RetroLoader />;
  }


  // Rich text editor view
  if (currentView === 'editor') {
    return (
      <div className="min-h-screen bg-background pb-6">
        <div className="container mx-auto max-w-7xl">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Tags Input */}
            <div className="space-y-2 p-4 rounded-lg border-2 border-border bg-muted/30 mt-4">
              <label htmlFor="tags" className="text-sm font-medium flex items-center gap-2">
                <Tag className="w-4 h-4" />
                Tags
                <span className="text-destructive">*</span>
              </label>
              <input
                id="tags"
                type="text"
                value={articleContent.tags}
                onChange={(e) => setArticleContent(prev => ({ ...prev, tags: e.target.value }))}
                placeholder="e.g., tutorial, guide, FAQ (comma-separated)"
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary focus:border-transparent"
                required
              />
              <p className="text-xs text-muted-foreground">
                Add at least one tag to categorize your document (comma-separated).
              </p>
            </div>

            {/* Rich Text Editor */}
            <RichTextEditor
              content={articleContent.content}
              onChange={(content) => setArticleContent(prev => ({ ...prev, content }))}
              title={articleContent.title}
              onTitleChange={(title) => setArticleContent(prev => ({ ...prev, title }))}
            />
          </div>
        </div>
      </div>
    );
  }

  // Main list view
  return (
    <div className="h-full overflow-hidden bg-background flex flex-col">
      <div className="container mx-auto max-w-7xl flex flex-col h-full overflow-hidden">
        {/* Config Status Bar - static */}
        <div className="flex-shrink-0">
          <ConfigStatusBar 
            configs={[
              {
                name: "LLM Configuration",
                isConfigured: hasLLMConfig,
                description: hasLLMConfig 
                  ? "Configured" 
                  : "Not configured - OpenAI and OpenRouter API keys required for AI features",
                scrollToId: "llm-configuration"
              },
              {
                name: "Supabase Configuration",
                isConfigured: hasSupabaseConfig,
                description: hasSupabaseConfig 
                  ? "Configured" 
                  : "Not configured - Required for knowledge base management",
                scrollToId: "supabase-configuration"
              },
              {
                name: "Knowledge Base Webhook",
                isConfigured: !!(webhooks.knowledge_base_add_webhook_url && webhooks.knowledge_base_add_webhook_url.trim()),
                description: webhooksLoading 
                  ? 'Loading...' 
                  : (webhooks.knowledge_base_add_webhook_url && webhooks.knowledge_base_add_webhook_url.trim()) 
                    ? 'Configured' 
                    : 'Not configured',
                scrollToId: "knowledge-base-webhooks"
              }
            ]}
          />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-auto pb-6">
          <div className="space-y-6">

            {/* Documents Grid */}
            {articles.length > 0 ? (
              <div className="grid gap-6 md:grid-cols-2">
                {articles.map((article) => (
                  <KnowledgeBaseCard
                    key={article.id}
                    article={article}
                    onEdit={() => checkWebhooksAndProceed('edit', article)}
                    onDelete={handleDelete}
                    disabledActions={!(webhooks.knowledge_base_add_webhook_url && webhooks.knowledge_base_add_webhook_url.trim())}
                  />
                ))}
              </div>
            ) : (
              <Card className="material-surface text-center py-12">
                <CardContent className="space-y-4">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto">
                    <BookOpen className="w-6 h-6 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-lg font-medium">No documents yet</h3>
                    <p className="text-sm text-muted-foreground">
                      Create your first document to start building your knowledge base.
                    </p>
                  </div>
                  <Button 
                    onClick={() => checkWebhooksAndProceed('create')} 
                    disabled={!hasSupabaseConfig || !hasLLMConfig || !(webhooks.knowledge_base_add_webhook_url && webhooks.knowledge_base_add_webhook_url.trim())}
                    size="sm"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Create First Document
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
        
      {/* Unsaved Changes Dialog */}
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onOpenChange={setShowUnsavedDialog}
        description="You have unsaved changes to this document. Do you want to discard them or continue editing?"
        onDiscard={() => {
          if (pendingActionRef.current) {
            pendingActionRef.current();
            pendingActionRef.current = null;
          }
        }}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog(prev => ({ ...prev, open }))}
        onConfirm={handleDeleteConfirm}
        title="Delete Document"
        description="This will permanently delete the document and notify the configured webhook. This action cannot be undone."
        itemName={deleteDialog.articleTitle}
      />
    </div>
  );
};

export default KnowledgeBase;