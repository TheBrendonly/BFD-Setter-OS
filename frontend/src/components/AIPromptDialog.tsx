import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Bot, Wand2, Loader2 } from '@/components/icons';
import { htmlToMarkdown, preserveMarkdownFormatting, ensureMarkdownStructure } from '@/utils/markdownConverter';
import { supabase } from '@/integrations/supabase/client';
import openaiLogo from '@/assets/openai-logo.svg';
import anthropicLogo from '@/assets/anthropic-logo.svg';
import metaLogo from '@/assets/meta-logo.svg';
import googleLogo from '@/assets/google-logo.svg';
import xaiLogo from '@/assets/xai-logo.svg';

interface Prompt {
  id: string;
  name: string;
  content: string;
  description?: string | null;
  category: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  webhook_url?: string | null;
  client_id?: string;
}

interface AIPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: 'generate' | 'modify';
  systemPrompt?: string;
  existingPrompt?: Prompt | null;
  currentPromptContent?: string; // Current content from the prompt editor
  onPromptGenerated: (prompt: { name: string; content: string }) => void;
}

const llmOptions = [
  // OpenAI - newest to oldest
  { 
    id: 'openai/gpt-5.2', 
    name: 'GPT-5.2', 
    logo: openaiLogo,
    description: 'Latest advanced model'
  },
  { 
    id: 'openai/gpt-5', 
    name: 'GPT-5', 
    logo: openaiLogo,
    description: 'Most capable flagship model'
  },
  { 
    id: 'openai/gpt-4o', 
    name: 'GPT-4o', 
    logo: openaiLogo,
    description: 'Advanced reasoning and creativity'
  },
  { 
    id: 'openai/gpt-4o-mini', 
    name: 'GPT-4o Mini', 
    logo: openaiLogo,
    description: 'Fast and cost-effective for most tasks'
  },
  // Anthropic - newest to oldest
  { 
    id: 'anthropic/claude-sonnet-4.5', 
    name: 'Claude Sonnet 4.5', 
    logo: anthropicLogo,
    description: 'Latest flagship model with superior understanding'
  },
  { 
    id: 'anthropic/claude-haiku-4.5', 
    name: 'Claude Haiku 4.5', 
    logo: anthropicLogo,
    description: 'Fast and lightweight responses'
  },
  { 
    id: 'anthropic/claude-sonnet-4', 
    name: 'Claude Sonnet 4', 
    logo: anthropicLogo,
    description: 'High-performance with exceptional reasoning'
  },
  { 
    id: 'anthropic/claude-3.5-sonnet', 
    name: 'Claude 3.5 Sonnet', 
    logo: anthropicLogo,
    description: 'Excellent for writing and analysis'
  },
  // Google - newest to oldest
  { 
    id: 'google/gemini-3-flash-preview', 
    name: 'Gemini 3 Flash', 
    logo: googleLogo,
    description: 'Latest fast multimodal model'
  },
  { 
    id: 'google/gemini-2.5-pro', 
    name: 'Gemini 2.5 Pro', 
    logo: googleLogo,
    description: 'Advanced reasoning and complex tasks'
  },
  { 
    id: 'google/gemini-2.5-flash', 
    name: 'Gemini 2.5 Flash', 
    logo: googleLogo,
    description: 'Fast and efficient multimodal model'
  },
  // xAI
  { 
    id: 'x-ai/grok-4.1-fast', 
    name: 'Grok 4.1 Fast', 
    logo: xaiLogo,
    description: 'Fast reasoning from xAI'
  },
  // Meta
  { 
    id: 'meta-llama/llama-3.3-70b-instruct', 
    name: 'Llama 3.3 70B', 
    logo: metaLogo,
    description: 'Latest open-source model from Meta'
  }
];

export const AIPromptDialog: React.FC<AIPromptDialogProps> = ({
  open,
  onOpenChange,
  action,
  systemPrompt,
  existingPrompt,
  currentPromptContent,
  onPromptGenerated,
}) => {
  const [userInput, setUserInput] = useState('');
  const [promptName, setPromptName] = useState(existingPrompt?.name || '');
  const [selectedModel, setSelectedModel] = useState(() => {
    // Load preferred model from localStorage or default to Claude Sonnet 4.5
    return localStorage.getItem('preferred-ai-model') || 'anthropic/claude-sonnet-4.5';
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [fetchedSystemPrompt, setFetchedSystemPrompt] = useState('');
  const { toast } = useToast();

  // Fetch the current system prompt from the database when the dialog opens
  useEffect(() => {
    const fetchSystemPromptFromDB = async () => {
      if (!open) return;
      
      try {
        const clientId = window.location.pathname.split('/')[2];
        // ai_meta_prompt (2026-06-12): clients.system_prompt is overwritten with the
        // full setter prompt on every save, so the meta prompt lives in its own column.
        // system_prompt fallback covers rows created before the split migration.
        const { data, error } = await (supabase as any)
          .from('clients_public')
          .select('ai_meta_prompt, system_prompt')
          .eq('id', clientId)
          .maybeSingle();

        if (error) throw error;
        if (data) {
          // ai_meta_prompt === system_prompt is the pre-split backfill artifact (the
          // setter prompt copied in), not a real meta prompt — treat as unset.
          const meta = data.ai_meta_prompt && data.ai_meta_prompt !== data.system_prompt
            ? data.ai_meta_prompt
            : '';
          setFetchedSystemPrompt(meta);
        }
      } catch (error) {
        console.error('Error fetching system prompt:', error);
      }
    };

    fetchSystemPromptFromDB();
  }, [open]);

  // Generate a snippet of the existing prompt for modify mode
  const getPromptSnippet = (content: string) => {
    if (!content) return '';
    const words = content.split(' ');
    if (words.length <= 20) return content;
    return words.slice(0, 20).join(' ') + '...';
  };

  const handleGenerate = async () => {
    if (!userInput.trim() || (action === 'generate' && !promptName.trim())) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    setIsGenerating(true);
    
    try {
      // Get client ID from URL
      const clientId = window.location.pathname.split('/')[2];
      const actualClientId = existingPrompt?.client_id || clientId;

      // System-managed AI prompt generation webhook. Set VITE_AI_PROMPT_WEBHOOK_URL
      // in the deployment env. Hardcoded upstream URL removed in N5 2026-05-19.
      const WEBHOOK_URL = import.meta.env.VITE_AI_PROMPT_WEBHOOK_URL as string | undefined;
      if (!WEBHOOK_URL) {
        throw new Error('AI prompt generation is not configured for this deployment (VITE_AI_PROMPT_WEBHOOK_URL is unset).');
      }

      // Prepare webhook payload - use fetched system prompt from database, don't send hardcoded prompt
      const webhookPayload = {
        systemPrompt: fetchedSystemPrompt || '',
        userLastUtterance: userInput,
        editorPrompt: currentPromptContent || 'No_Prompt',
        llmModel: selectedModel,
        action: action,
        promptName: promptName || existingPrompt?.name || ''
      };

      console.log('Sending to webhook:', WEBHOOK_URL, webhookPayload);

      // Send to webhook
      const webhookResponse = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(webhookPayload),
      });

      if (!webhookResponse.ok) {
        throw new Error(JSON.stringify({
          userFriendly: true,
          error: `Webhook request failed: ${webhookResponse.statusText}`
        }));
      }

      const webhookData = await webhookResponse.json();
      console.log('Webhook response:', webhookData);

      const generatedContent = webhookData?.content || webhookData?.generatedContent;
      if (!generatedContent) {
        throw new Error(JSON.stringify({
          userFriendly: true,
          error: 'No content received from AI'
        }));
      }

      // Clean up the content to ensure proper markdown formatting
      let cleanedContent = generatedContent
        .replace(/```markdown\n?/g, '')
        .replace(/```\n?/g, '')
        .replace(/^\s+|\s+$/g, '')
        .trim();

      // Convert any HTML to markdown if needed
      cleanedContent = htmlToMarkdown(cleanedContent);
      
      // Preserve and fix markdown formatting
      cleanedContent = preserveMarkdownFormatting(cleanedContent);
      
      // Ensure proper structure
      cleanedContent = ensureMarkdownStructure(cleanedContent);

      onPromptGenerated({
        name: webhookData?.name || promptName || existingPrompt?.name || 'Generated Prompt',
        content: cleanedContent
      });

      // Reset form
      setUserInput('');
      if (action === 'generate') {
        setPromptName('');
      }
      
      toast({
        title: action === 'generate' ? "Prompt Generated!" : "Prompt Modified!",
        description: `Your prompt has been ${action === 'generate' ? 'generated' : 'modified'} successfully.`,
      });

      onOpenChange(false);
    } catch (error) {
      console.error('Error generating prompt:', error);
      // Check if the error response has user-friendly messaging
      let errorMessage = 'An unexpected error occurred';
      if (error instanceof Error) {
        try {
          const errorData = JSON.parse(error.message);
          errorMessage = errorData.userFriendly ? errorData.error : error.message;
        } catch {
          errorMessage = error.message;
        }
      }
      
      toast({
        title: "Generation Failed",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClose = () => {
    setUserInput('');
    setPromptName('');
    setSelectedModel('anthropic/claude-sonnet-4.5');
    setIsGenerating(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {action === 'generate' ? 'Generate New Prompt' : 'Modify Prompt with AI'}
          </DialogTitle>
          <DialogDescription>
            {action === 'generate' 
              ? 'Use AI to generate a comprehensive prompt based on your requirements.'
              : 'Use AI to modify and improve your existing prompt.'
            }
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 p-6">
          {action === 'generate' && (
            <div className="grid gap-2">
              <Label htmlFor="prompt-name">Prompt Name</Label>
              <Input
                id="prompt-name"
                placeholder="Enter a name for your prompt"
                value={promptName}
                onChange={(e) => setPromptName(e.target.value)}
                disabled={isGenerating}
              />
            </div>
          )}

          {action === 'modify' && currentPromptContent && (
            <div className="grid gap-2">
              <Label>Current Prompt Content (from editor)</Label>
              <div className="p-3 bg-muted rounded-md text-sm text-muted-foreground border max-h-32 overflow-y-auto">
                <span className="text-xs">{getPromptSnippet(currentPromptContent)}</span>
              </div>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="ai-model">AI Model</Label>
            <Select value={selectedModel} onValueChange={(value) => {
              setSelectedModel(value);
              localStorage.setItem('preferred-ai-model', value);
            }} disabled={isGenerating}>
              <SelectTrigger>
                <SelectValue placeholder="Select an AI model" />
              </SelectTrigger>
              <SelectContent>
                {llmOptions.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    <div className="flex items-center gap-2">
                      <img src={model.logo} alt={`${model.name} logo`} className="h-4 w-4" />
                      <div className="flex flex-col">
                        <span className="font-medium">{model.name}</span>
                        <span className="text-xs text-muted-foreground">{model.description}</span>
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="user-input">
              {action === 'generate' ? 'Describe your prompt requirements' : 'Modification instructions'}
            </Label>
            <Textarea
              id="user-input"
              placeholder={
                action === 'generate'
                  ? "Describe what kind of AI assistant you want to create, its purpose, capabilities, and any specific requirements..."
                  : "Describe how you'd like to modify the existing prompt..."
              }
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              rows={6}
              disabled={isGenerating}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose} disabled={isGenerating}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {action === 'generate' ? 'Generating...' : 'Modifying...'}
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-4 w-4" />
                {action === 'generate' ? 'Generate Prompt' : 'Modify Prompt'}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AIPromptDialog;