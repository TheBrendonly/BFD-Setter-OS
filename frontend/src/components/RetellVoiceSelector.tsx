import { useState, useMemo, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Check } from '@/components/icons';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useRetellApi, type RetellVoice } from '@/hooks/useRetellApi';

// Module-level cache so the 300+ voice catalog is fetched once per client per
// session (not on every popover open). Keyed by clientId.
const voicesCache = new Map<string, RetellVoice[]>();
const voicesInflight = new Map<string, Promise<RetellVoice[]>>();

// Voice-id prefixes Retell uses. A pasted value matching one of these is treated
// as a real voice id (so users can still paste an id we didn't fetch); anything
// else typed in the box is treated as a search term only.
const KNOWN_VOICE_PREFIXES = ['custom_voice_', '11labs-', 'openai-', 'cartesia-', 'play-', 'minimax-', 'fish-', 'qwen'];
const looksLikeVoiceId = (s: string) => KNOWN_VOICE_PREFIXES.some(p => s.startsWith(p));
const isCustomVoice = (v: RetellVoice) => v.voice_id.startsWith('custom_voice_') || v.voice_type === 'custom';

interface RetellVoiceSelectorProps {
  clientId: string;
  value: string;
  onChange: (voiceId: string) => void;
  disabled?: boolean;
}

const monoStyle = { fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" } as const;

export function RetellVoiceSelector({ clientId, value, onChange, disabled }: RetellVoiceSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const { listVoices } = useRetellApi(clientId);

  const [voices, setVoices] = useState<RetellVoice[]>(() => voicesCache.get(clientId) ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  // Single shared audio element for previews.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const stopPreview = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setPlayingId(null);
  }, []);
  const playPreview = useCallback((v: RetellVoice) => {
    if (!v.preview_audio_url) return;
    if (playingId === v.voice_id) { stopPreview(); return; }
    stopPreview();
    const a = new Audio(v.preview_audio_url);
    audioRef.current = a;
    setPlayingId(v.voice_id);
    a.onended = () => setPlayingId(null);
    a.play().catch(() => setPlayingId(null));
  }, [playingId, stopPreview]);
  useEffect(() => () => stopPreview(), [stopPreview]); // stop on unmount

  // Lazy-fetch the catalog the first time the picker opens.
  useEffect(() => {
    if (!open || fetchedRef.current || !clientId) return;
    const cached = voicesCache.get(clientId);
    if (cached) { setVoices(cached); fetchedRef.current = true; return; }
    fetchedRef.current = true;
    setLoading(true);
    setError(null);
    let promise = voicesInflight.get(clientId);
    if (!promise) {
      promise = listVoices()
        .then((v) => { const arr = Array.isArray(v) ? v : []; voicesCache.set(clientId, arr); voicesInflight.delete(clientId); return arr; })
        .catch((e) => { voicesInflight.delete(clientId); throw e; });
      voicesInflight.set(clientId, promise);
    }
    promise
      .then((arr) => setVoices(arr))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load voices'))
      .finally(() => setLoading(false));
  }, [open, clientId, listVoices]);

  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 100);
      return;
    }
    // Commit a pending paste that looks like a real voice id when the popover
    // closes (so it isn't silently dropped). Plain search text is NOT committed.
    const trimmed = search.trim();
    if (trimmed && trimmed !== value && looksLikeVoiceId(trimmed)) onChange(trimmed);
    setSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const q = search.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return voices;
    return voices.filter(v =>
      v.voice_name?.toLowerCase().includes(q) ||
      v.voice_id?.toLowerCase().includes(q) ||
      v.provider?.toLowerCase().includes(q) ||
      v.accent?.toLowerCase().includes(q) ||
      v.gender?.toLowerCase().includes(q)
    );
  }, [voices, q]);

  // Grouped default view (custom first, then recommended); flat list when searching.
  const custom = useMemo(() => matches.filter(isCustomVoice), [matches]);
  const recommended = useMemo(() => matches.filter(v => v.recommended && !isCustomVoice(v)), [matches]);
  const rest = useMemo(() => matches.filter(v => !v.recommended && !isCustomVoice(v)), [matches]);

  const selectedVoice = voices.find(v => v.voice_id === value);
  const selectedName = selectedVoice?.voice_name || value || '';
  const isCustomPaste = !!value && !selectedVoice;
  const showRawIdWarning = isCustomPaste && !looksLikeVoiceId(value);

  const commitPaste = (raw: string) => {
    const val = raw.trim();
    if (val && val !== value && looksLikeVoiceId(val)) { onChange(val); return true; }
    return false;
  };

  const renderRow = (v: RetellVoice) => {
    const selected = value === v.voice_id;
    const meta = [v.provider, v.gender, v.accent, v.age].filter(Boolean).join(' · ');
    return (
      <div
        key={v.voice_id}
        className={cn(
          'flex items-center gap-2 rounded-sm px-3 py-2',
          'hover:bg-accent hover:text-accent-foreground',
          selected && 'bg-accent text-accent-foreground'
        )}
      >
        <button
          type="button"
          className="flex flex-1 items-start gap-2 text-left min-w-0"
          onClick={() => { onChange(v.voice_id); setOpen(false); setSearch(''); }}
        >
          <Check className={cn('h-3.5 w-3.5 shrink-0 mt-0.5', selected ? 'opacity-100' : 'opacity-0')} />
          <span className="flex flex-col min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate" style={{ ...monoStyle, textTransform: 'capitalize' }}>{v.voice_name}</span>
              {isCustomVoice(v) && <span className="terminal-tag terminal-tag-green shrink-0">CUSTOM</span>}
              {v.recommended && !isCustomVoice(v) && <span className="terminal-tag terminal-tag-neutral shrink-0">RECOMMENDED</span>}
            </span>
            {meta && (
              <span className="text-muted-foreground truncate" style={{ ...monoStyle, fontSize: '11px' }}>{meta}</span>
            )}
          </span>
        </button>
        {v.preview_audio_url && (
          <button
            type="button"
            title="Preview voice"
            className="shrink-0 h-6 w-6 flex items-center justify-center groove-border bg-card"
            onClick={(e) => { e.stopPropagation(); playPreview(v); }}
          >
            <span style={{ fontSize: '11px' }}>{playingId === v.voice_id ? '■' : '▶'}</span>
          </button>
        )}
      </div>
    );
  };

  const SectionHeader = ({ children }: { children: ReactNode }) => (
    <div className="px-3 pt-2 pb-1 text-muted-foreground" style={{ ...monoStyle, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</div>
  );

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            className={cn(
              'relative flex h-8 w-full items-center groove-border bg-card px-3 pr-10 py-1 text-left',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
            style={{ ...monoStyle, textTransform: 'uppercase' }}
          >
            <span className={cn('truncate text-foreground flex-1', !value && 'text-muted-foreground')}>
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
              placeholder="Search voices or paste custom_voice_xxx / 11labs-Name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onBlur={() => commitPaste(search)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  if (commitPaste((e.target as HTMLInputElement).value)) { setOpen(false); setSearch(''); }
                }
              }}
              className="flex-1 bg-transparent border-0 outline-none text-foreground placeholder:text-muted-foreground"
              style={{ ...monoStyle, textTransform: 'capitalize' }}
            />
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            <div className="p-1">
              {loading && (
                <div className="py-4 text-center text-muted-foreground" style={monoStyle}>Loading voices…</div>
              )}
              {error && !loading && (
                <div className="py-3 px-3 text-amber-500" style={{ ...monoStyle, fontSize: '11px' }}>
                  Couldn't load voices: {error}. You can still paste a voice id above.
                </div>
              )}
              {!loading && !error && voices.length === 0 && (
                <div className="py-4 text-center text-muted-foreground" style={monoStyle}>No voices in this Retell account.</div>
              )}

              {!loading && !error && voices.length > 0 && (
                q ? (
                  matches.length > 0 ? (
                    matches.slice(0, 120).map(renderRow)
                  ) : (
                    <div className="py-4 text-center text-muted-foreground" style={monoStyle}>
                      No voices found.
                      {looksLikeVoiceId(search.trim()) && (
                        <button
                          className="block mx-auto mt-2 text-primary hover:underline"
                          style={{ ...monoStyle, fontSize: '12px' }}
                          onClick={() => { onChange(search.trim()); setOpen(false); setSearch(''); }}
                        >
                          Use "{search.trim()}" as voice id
                        </button>
                      )}
                    </div>
                  )
                ) : (
                  <>
                    {custom.length > 0 && <SectionHeader>Your custom voices ({custom.length})</SectionHeader>}
                    {custom.map(renderRow)}
                    {recommended.length > 0 && <SectionHeader>Recommended</SectionHeader>}
                    {recommended.map(renderRow)}
                    {rest.length > 0 && <SectionHeader>All voices ({rest.length})</SectionHeader>}
                    {rest.slice(0, 60).map(renderRow)}
                    {rest.length > 60 && (
                      <div className="px-3 py-2 text-muted-foreground" style={{ ...monoStyle, fontSize: '11px' }}>
                        +{rest.length - 60} more — type to search all {voices.length}.
                      </div>
                    )}
                  </>
                )
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {isCustomPaste && (
        <div className="text-muted-foreground" style={{ ...monoStyle, fontSize: '11px' }}>
          Voice id: <span className="text-foreground">{value}</span>
        </div>
      )}
      {showRawIdWarning && (
        <div className="text-amber-500" style={{ ...monoStyle, fontSize: '11px' }}>
          This doesn't match a Retell voice id prefix. Retell expects custom_voice_xxx (register the ElevenLabs voice in your Retell account first) or a catalog id like 11labs-Name.
        </div>
      )}
    </div>
  );
}
