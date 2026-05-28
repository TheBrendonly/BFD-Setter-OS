import { useState, useMemo, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';
import { Check } from '@/components/icons';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { StatusTag } from '@/components/StatusTag';

const RETELL_MODELS = [
  { id: 'gpt-5.4', name: 'Gpt-5.4', provider: 'Openai' },
  { id: 'gpt-5.2', name: 'Gpt-5.2', provider: 'Openai' },
  { id: 'gpt-5', name: 'Gpt-5', provider: 'Openai' },
  { id: 'claude-4.6-sonnet', name: 'Claude 4.6 Sonnet', provider: 'Anthropic' },
  { id: 'claude-4.5-sonnet', name: 'Claude 4.5 Sonnet', provider: 'Anthropic' },
  { id: 'gemini-3.0-flash', name: 'Gemini 3.0 Flash', provider: 'Google' },
];

interface RetellModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  isSavedConfigured?: boolean;
  disabled?: boolean;
  label?: string;
}

const monoStyle = { fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" } as const;
const labelStyle = { fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 } as const;

export function RetellModelSelector({ value, onChange, isSavedConfigured, disabled, label = 'AI Model' }: RetellModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 100);
    else setSearch('');
  }, [open]);

  const filtered = useMemo(() => {
    if (!search) return RETELL_MODELS;
    const q = search.toLowerCase();
    return RETELL_MODELS.filter(m =>
      m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)
    );
  }, [search]);

  const selectedModel = RETELL_MODELS.find(m => m.id === value);
  const selectedName = selectedModel?.name || value || '';

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
          className="w-[var(--radix-popover-trigger-width)] p-0 border border-border bg-sidebar"
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
          </div>
          <div className="h-[260px] overflow-y-auto">
            <div className="p-1">
              {filtered.length === 0 && (
                <div className="py-4 text-center text-muted-foreground" style={monoStyle}>
                  No models found.
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
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
