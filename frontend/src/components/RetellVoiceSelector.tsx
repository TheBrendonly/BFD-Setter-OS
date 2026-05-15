import { useState, useMemo, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';
import { Check } from '@/components/icons';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

const HARDCODED_VOICES = [
  {
    voice_id: '11labs-Myra',
    voice_name: 'Myra',
    provider: 'elevenlabs',
    gender: 'female' as const,
    description: 'Warm, conversational — sounds like a real person on the phone',
  },
  {
    voice_id: '11labs-Marissa',
    voice_name: 'Marissa',
    provider: 'elevenlabs',
    gender: 'female' as const,
    description: 'Natural pacing with realistic vocal texture',
  },
  {
    voice_id: '11labs-Matt',
    voice_name: 'Matt',
    provider: 'elevenlabs',
    gender: 'male' as const,
    description: 'Casual, grounded — like a real sales rep on a phone call',
  },
  {
    voice_id: '11labs-Cimo',
    voice_name: 'Cimo',
    provider: 'elevenlabs',
    gender: 'male' as const,
    description: 'Deep, calm tone — natural and trustworthy',
  },
];

interface RetellVoiceSelectorProps {
  clientId: string;
  value: string;
  onChange: (voiceId: string) => void;
  disabled?: boolean;
}

const monoStyle = { fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" } as const;

export function RetellVoiceSelector({ value, onChange, disabled }: RetellVoiceSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 100);
    else setSearch('');
  }, [open]);

  const filtered = useMemo(() => {
    if (!search) return HARDCODED_VOICES;
    const q = search.toLowerCase();
    return HARDCODED_VOICES.filter(v =>
      v.voice_name.toLowerCase().includes(q) ||
      v.voice_id.toLowerCase().includes(q) ||
      v.gender.toLowerCase().includes(q) ||
      v.description.toLowerCase().includes(q)
    );
  }, [search]);

  const selectedVoice = HARDCODED_VOICES.find(v => v.voice_id === value);
  const selectedName = selectedVoice?.voice_name || value || '';

  // Flag a pasted ID that doesn't match any known Retell prefix so the user
  // knows to register raw ElevenLabs IDs as a Retell custom voice first.
  const isCustomPaste = !!value && !selectedVoice;
  const hasKnownPrefix = !!value && (
    value.startsWith('custom_voice_')
    || value.startsWith('11labs-')
    || value.startsWith('openai-')
    || value.startsWith('cartesia-')
    || value.startsWith('play-')
  );
  const showRawIdWarning = isCustomPaste && !hasKnownPrefix;

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            className={cn(
              "relative flex h-8 w-full items-center groove-border bg-card px-3 pr-10 py-1 text-left",
              disabled && "opacity-50 cursor-not-allowed"
            )}
            style={{ ...monoStyle, textTransform: 'uppercase' }}
          >
            <span className={cn("truncate text-foreground flex-1", !value && "text-muted-foreground")}>
              {selectedName || 'Select Voice...'}
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
              placeholder="Search or paste custom_voice_xxx / 11labs-Name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const val = (e.target as HTMLInputElement).value.trim();
                  if (val && !HARDCODED_VOICES.some(v => v.voice_name.toLowerCase() === val.toLowerCase())) {
                    onChange(val);
                    setOpen(false);
                    setSearch('');
                  }
                }
              }}
              className="flex-1 bg-transparent border-0 outline-none text-foreground placeholder:text-muted-foreground"
              style={{ ...monoStyle, textTransform: 'capitalize' }}
            />
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            <div className="p-1">
              {filtered.map(voice => (
                <button
                  key={voice.voice_id}
                  type="button"
                  className={cn(
                    "flex flex-col w-full rounded-sm px-3 py-2 cursor-pointer text-left",
                    "hover:bg-accent hover:text-accent-foreground",
                    value === voice.voice_id && "bg-accent text-accent-foreground"
                  )}
                  onClick={() => {
                    onChange(voice.voice_id);
                    setOpen(false);
                    setSearch('');
                  }}
                >
                  <div className="flex items-center gap-2 w-full">
                    <Check className={cn("h-3.5 w-3.5 shrink-0", value === voice.voice_id ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 truncate" style={{ ...monoStyle, textTransform: 'capitalize' }}>
                      {voice.voice_name}
                    </span>
                    <span className="terminal-tag terminal-tag-green shrink-0">
                      RECOMMENDED
                    </span>
                  </div>
                  <span className="text-muted-foreground mt-0.5" style={{ ...monoStyle, fontSize: '11px', paddingLeft: 'calc(0.875rem + 0.5rem)' }}>
                    {voice.description}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="py-4 text-center text-muted-foreground" style={monoStyle}>
                  No voices found.
                  {search.trim() && (
                    <button
                      className="block mx-auto mt-2 text-primary hover:underline"
                      style={{ ...monoStyle, fontSize: '12px' }}
                      onClick={() => { onChange(search.trim()); setOpen(false); setSearch(''); }}
                    >
                      Use "{search.trim()}" as custom voice ID
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {isCustomPaste && (
        <div className="text-muted-foreground" style={{ ...monoStyle, fontSize: '11px' }}>
          Custom voice ID: <span className="text-foreground">{value}</span>
        </div>
      )}
      {showRawIdWarning && (
        <div className="text-amber-500" style={{ ...monoStyle, fontSize: '11px' }}>
          This looks like a raw ID without a Retell prefix. Retell expects custom_voice_xxx (register the ElevenLabs voice in your Retell dashboard first) or 11labs-VoiceName presets. Bare ElevenLabs IDs may not resolve correctly.
        </div>
      )}
    </div>
  );
}
