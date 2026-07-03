import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronsUpDown, Search, Loader2 } from 'lucide-react';
import { Check } from '@/components/icons';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { StatusTag } from '@/components/StatusTag';
import { findKnownOpenRouterModelId } from '@/lib/isKnownOpenRouterModel';

const POPULAR_MODELS = [
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'Google' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google' },
  { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'Google' },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', provider: 'Google' },
  { id: 'openai/gpt-5.2', name: 'Gpt-5.2', provider: 'Openai' },
  { id: 'openai/gpt-5', name: 'Gpt-5', provider: 'Openai' },
  { id: 'openai/gpt-4o', name: 'Gpt-4o', provider: 'Openai' },
  { id: 'openai/gpt-4o-mini', name: 'Gpt-4o Mini', provider: 'Openai' },
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', provider: 'Anthropic' },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'Anthropic' },
  { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4', provider: 'Anthropic' },
  { id: 'anthropic/claude-haiku-3.5', name: 'Claude 3.5 Haiku', provider: 'Anthropic' },
  { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast', provider: 'Xai' },
  { id: 'x-ai/grok-2-1212', name: 'Grok 2', provider: 'Xai' },
  { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick', provider: 'Meta' },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70b', provider: 'Meta' },
  { id: 'deepseek/deepseek-chat-v3-0324', name: 'Deepseek V3', provider: 'Deepseek' },
  { id: 'deepseek/deepseek-r1', name: 'Deepseek R1', provider: 'Deepseek' },
  { id: 'mistralai/mistral-large-2411', name: 'Mistral Large', provider: 'Mistral' },
  { id: 'mistralai/mistral-small-3.1-24b-instruct', name: 'Mistral Small 3.1', provider: 'Mistral' },
  { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72b', provider: 'Qwen' },
  { id: 'cohere/command-r-plus', name: 'Command R+', provider: 'Cohere' },
  { id: 'perplexity/sonar-pro', name: 'Sonar Pro', provider: 'Perplexity' },
  { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70b', provider: 'Nvidia' },
];

interface RemoteModel {
  id: string;
  name: string;
  provider: string;
}

function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

interface OpenRouterModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  isSavedConfigured?: boolean;
  disabled?: boolean;
  label?: string;
}

export function OpenRouterModelSelector({ value, onChange, isSavedConfigured, disabled, label = 'Default AI Model' }: OpenRouterModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(20);
  const [remoteModels, setRemoteModels] = useState<RemoteModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [pendingCustom, setPendingCustom] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || fetched) return;
    setLoading(true);
    fetch('https://openrouter.ai/api/v1/models')
      .then(r => r.json())
      .then(data => {
        if (data?.data && Array.isArray(data.data)) {
          setRemoteModels(data.data.map((m: any) => ({
            id: m.id,
            name: m.name || m.id,
            provider: toTitleCase(m.id.split('/')[0] || ''),
          })));
        }
      })
      .catch(err => console.error('Failed to fetch OpenRouter models:', err))
      .finally(() => { setLoading(false); setFetched(true); });
  }, [open, fetched]);

  useEffect(() => {
    if (open) { setTimeout(() => searchRef.current?.focus(), 100); setVisibleCount(20); }
    else { setSearch(''); setPendingCustom(null); }
  }, [open]);

  // A pending "use anyway" warning is only meaningful for the search text it was
  // raised for — clear it when the user keeps typing.
  useEffect(() => { setPendingCustom(null); }, [search]);

  const allModels = useMemo(() => {
    if (remoteModels.length > 0) {
      const popularIds = new Set(POPULAR_MODELS.map(m => m.id));
      const rest = remoteModels
        .filter(m => !popularIds.has(m.id))
        .map(m => ({ id: m.id, name: m.name, provider: m.provider }));
      return [...POPULAR_MODELS, ...rest];
    }
    return POPULAR_MODELS;
  }, [remoteModels]);

  // MODEL-1-HARDENING: both "use as custom model" actions used to call
  // onChange(search) directly with zero check against the fetched model list,
  // so any slash-containing string (e.g. the invalid google/gemini-flash-latest
  // that once silently broke every AI engine) reached clients.llm_model
  // unchecked. Known ids are accepted immediately — as the CANONICAL list id,
  // since OpenRouter ids are case-sensitive lowercase slugs and echoing the
  // user's casing would recreate the same silent-400 class. Anything else
  // requires an explicit "use anyway" confirmation instead of a single click.
  const handleUseCustom = (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed) return;
    const canonical = findKnownOpenRouterModelId(trimmed, allModels);
    if (canonical) {
      onChange(canonical);
      setOpen(false);
      return;
    }
    setPendingCustom(trimmed);
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return allModels.slice(0, visibleCount);
    const q = search.toLowerCase();
    return allModels.filter(m =>
      m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [allModels, search, visibleCount]);

  const canLoadMore = !search.trim() && visibleCount < allModels.length;

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20 && canLoadMore) {
      setVisibleCount(prev => prev + 20);
    }
  };

  const selectedModel = allModels.find(m => m.id === value);
  const selectedName = selectedModel?.name || value || '';

  const monoStyle = { fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" } as const;
  const labelStyle = { fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 } as const;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium" style={labelStyle}>{label}</label>
        {isSavedConfigured !== undefined && (
          isSavedConfigured ? (
            <StatusTag variant="positive">Configured</StatusTag>
          ) : (
            <StatusTag variant="negative" className="animate-pulse">Not Configured</StatusTag>
          )
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            disabled={disabled}
            className={cn(
              "relative flex h-8 w-full items-center groove-border bg-card px-3 pr-10 py-1 text-left",
              disabled && "opacity-50 cursor-not-allowed"
            )}
            style={{ ...monoStyle, textTransform: 'uppercase' }}
          >
            <span className="truncate text-foreground flex-1">
              {selectedName || <span className="text-muted-foreground">Select Model...</span>}
            </span>
            <span className="absolute right-0 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5 text-foreground" fill="currentColor" style={{ imageRendering: 'pixelated' }}>
                <rect x="7" y="9" width="2" height="2" />
                <rect x="9" y="11" width="2" height="2" />
                <rect x="11" y="13" width="2" height="2" />
                <rect x="13" y="11" width="2" height="2" />
                <rect x="15" y="9" width="2" height="2" />
              </svg>
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent 
          className="w-[var(--radix-popover-trigger-width)] p-0 groove-border bg-sidebar" 
          align="start" 
          sideOffset={4}
        >
          <div className="flex items-center groove-border !border-x-0 !border-t-0 px-3 py-2 gap-2">
            <Search className="h-3.5 w-3.5 shrink-0 opacity-50" />
            <input
              ref={searchRef}
              placeholder="Search Models..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent border-0 outline-none text-foreground placeholder:text-muted-foreground"
              style={{ ...monoStyle, textTransform: 'capitalize' }}
            />
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 opacity-50" />}
          </div>
          <div className="h-[260px] overflow-y-auto" onScroll={handleScroll}>
            <div className="p-1">
              {filtered.length === 0 && !loading && (
                <div className="py-4 text-center text-muted-foreground" style={monoStyle}>
                  No models found.
                  {search.includes('/') && (
                    <button
                      className="block mx-auto mt-2 text-primary hover:underline"
                      style={{ ...monoStyle, fontSize: '12px' }}
                      onClick={() => handleUseCustom(search)}
                    >
                      Use "{search}" as custom model
                    </button>
                  )}
                </div>
              )}
              {filtered.map(model => (
                <button
                  key={model.id}
                  className={cn(
                    "flex items-center w-full gap-2 rounded-sm px-3 py-1.5 cursor-pointer",
                    "hover:bg-accent hover:text-accent-foreground",
                    value === model.id && "bg-accent text-accent-foreground"
                  )}
                  style={{ ...monoStyle, textTransform: 'capitalize' }}
                  onClick={() => { onChange(model.id); setOpen(false); }}
                >
                  <Check className={cn("h-3.5 w-3.5 shrink-0", value === model.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate flex-1 text-left">{model.name}</span>
                  <span className="text-muted-foreground shrink-0 opacity-40" style={{ fontSize: '11px' }}>
                    {model.provider}
                  </span>
                </button>
              ))}
              {search && search.includes('/') && !filtered.some(m => m.id === search) && (
                <button
                  className="flex items-center w-full gap-2 rounded-sm px-3 py-1.5 cursor-pointer hover:bg-accent hover:text-accent-foreground border-t border-border mt-1 pt-2"
                  style={{ ...monoStyle, textTransform: 'capitalize' }}
                  onClick={() => handleUseCustom(search)}
                >
                  <Check className="h-3.5 w-3.5 shrink-0 opacity-0" />
                  <span className="truncate flex-1 text-left">Use custom: {search}</span>
                </button>
              )}
              {pendingCustom && (
                <div className="border-t border-border mt-1 p-2 space-y-2">
                  <p className="text-muted-foreground" style={{ ...monoStyle, fontSize: '11px', textTransform: 'none' }}>
                    "{pendingCustom}" was not found in the OpenRouter model list — this ID may not exist. An
                    invalid model id silently breaks every AI-driven feature for this client.
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="flex-1 rounded-sm px-2 py-1 border border-destructive text-destructive hover:bg-destructive/10"
                      style={{ ...monoStyle, fontSize: '12px' }}
                      onClick={() => { onChange(pendingCustom); setOpen(false); setPendingCustom(null); }}
                    >
                      Use anyway
                    </button>
                    <button
                      className="flex-1 rounded-sm px-2 py-1 border border-border hover:bg-accent"
                      style={{ ...monoStyle, fontSize: '12px' }}
                      onClick={() => setPendingCustom(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
