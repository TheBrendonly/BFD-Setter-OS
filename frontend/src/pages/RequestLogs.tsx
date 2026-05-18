import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RefreshCw, Search, Trash2, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, Clock, Zap, Globe, Database, Maximize2, ChevronDown, ChevronRight as ChevronRightIcon, Filter, X } from '@/components/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { format } from 'date-fns';
import { StatusTag } from '@/components/StatusTag';
import { toast } from 'sonner';
import { LogsTabsNav } from '@/components/logs/LogsTabsNav';

interface RequestLog {
  id: string;
  client_id: string | null;
  request_type: string;
  source: string;
  endpoint_url: string | null;
  method: string | null;
  request_body: any;
  response_body: any;
  status_code: number | null;
  status: string;
  error_message: string | null;
  duration_ms: number | null;
  tokens_used: number | null;
  cost: number | null;
  model: string | null;
  metadata: any;
  created_at: string;
}

const PAGE_SIZE = 50;
const FONT = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' };
const HEADER_FONT = { fontFamily: "'VT323', monospace", fontSize: '18px', textTransform: 'uppercase' as const };

const normalizeEscapedText = (value: string) => (
  value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
);

const safeJsonParse = (value: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
};

const repairJsonCandidate = (value: string) => {
  const trimmed = value.trim().replace(/,\s*([}\]])/g, '$1');
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of trimmed) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if ((char === '}' || char === ']') && stack[stack.length - 1] === char) stack.pop();
  }

  let repaired = trimmed;

  if (escaped) repaired += '\\';
  if (inString) repaired += '"';

  return `${repaired}${stack.reverse().join('')}`;
};

const extractBalancedJsonSegment = (value: string) => {
  const objectStart = value.indexOf('{');
  const arrayStart = value.indexOf('[');
  const starts = [objectStart, arrayStart].filter(index => index >= 0).sort((a, b) => a - b);
  const start = starts[0];

  if (start === undefined) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < value.length; i += 1) {
    const char = value[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if ((char === '}' || char === ']') && stack[stack.length - 1] === char) {
      stack.pop();
      if (stack.length === 0) return value.slice(start, i + 1);
    }
  }

  return value.slice(start);
};

const parseNdjson = (value: string) => {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const parsedLines: unknown[] = [];
  for (const line of lines) {
    const parsed = safeJsonParse(line);
    if (!parsed.ok) return null;
    parsedLines.push(parsed.value);
  }

  return parsedLines;
};

const tryParseStructuredString = (value: string): unknown | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidateSet = new Set<string>([
    trimmed,
    normalizeEscapedText(trimmed),
    normalizeEscapedText(trimmed).replace(/\\"/g, '"'),
  ]);

  const attemptParse = (candidate: string): unknown | null => {
    const direct = safeJsonParse(candidate);
    if (direct.ok) return direct.value;

    const repaired = repairJsonCandidate(candidate);
    if (repaired !== candidate) {
      const repairedResult = safeJsonParse(repaired);
      if (repairedResult.ok) return repairedResult.value;
    }

    const ndjson = parseNdjson(candidate);
    if (ndjson) return ndjson;

    return null;
  };

  for (const candidate of candidateSet) {
    const parsed = attemptParse(candidate);
    if (parsed !== null) return parsed;

    const codeBlocks = [...candidate.matchAll(/```(?:json|javascript|js)?\s*([\s\S]*?)```/gi)];
    for (const match of codeBlocks) {
      const block = match[1]?.trim();
      if (!block) continue;
      const blockParsed = attemptParse(block);
      if (blockParsed !== null) return blockParsed;
    }

    const extracted = extractBalancedJsonSegment(candidate);
    if (extracted) {
      const extractedParsed = attemptParse(extracted);
      if (extractedParsed !== null) return extractedParsed;
    }
  }

  return null;
};

const unwrapJsonLikeString = (value: string) => {
  let current = normalizeEscapedText(value).trim();

  for (let i = 0; i < 3; i += 1) {
    const parsed = safeJsonParse(current);
    if (!parsed.ok || typeof parsed.value !== 'string') break;
    current = normalizeEscapedText(parsed.value).trim();
  }

  return current.replace(/\\"/g, '"');
};

const looksLikeStructuredText = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;

  return /^[\[{]/.test(trimmed) || /"[^"\n]+"\s*:/.test(trimmed);
};

const prettyPrintJsonLikeText = (value: string) => {
  const input = unwrapJsonLikeString(value);
  if (!looksLikeStructuredText(input)) return input;

  let output = '';
  let indent = 0;
  let inString = false;
  let escaped = false;

  const writeIndent = () => {
    output += '  '.repeat(Math.max(indent, 0));
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      output += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      output += char;
      continue;
    }

    if (inString) {
      output += char;
      continue;
    }

    if (char === '{' || char === '[') {
      output += `${char}\n`;
      indent += 1;
      writeIndent();
      continue;
    }

    if (char === '}' || char === ']') {
      indent = Math.max(indent - 1, 0);
      output = output.replace(/[ \t]*$/, '');
      output += `\n${'  '.repeat(indent)}${char}`;
      continue;
    }

    if (char === ',') {
      output += `${char}\n`;
      writeIndent();
      continue;
    }

    if (char === ':') {
      output += ': ';
      continue;
    }

    output += char;
  }

  return output
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
};

const deepParseValue = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return value;

  if (typeof value === 'string') {
    const parsed = tryParseStructuredString(value);
    if (parsed !== null) return deepParseValue(parsed, depth + 1);

    const unwrapped = unwrapJsonLikeString(value);
    if (looksLikeStructuredText(unwrapped)) {
      return prettyPrintJsonLikeText(unwrapped);
    }

    return unwrapped;
  }

  if (Array.isArray(value)) return value.map(item => deepParseValue(item, depth + 1));

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, deepParseValue(nestedValue, depth + 1)])
    );
  }

  return value;
};

const resolvePayloadDisplayData = (value: unknown) => {
  const parsed = deepParseValue(value);

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    const wrappedPreview = typeof record.preview === 'string'
      ? record.preview
      : typeof record._raw === 'string'
        ? record._raw
        : null;

    if (wrappedPreview) {
      return deepParseValue(wrappedPreview);
    }
  }

  return parsed;
};

const formatPayloadForDisplay = (value: unknown) => {
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
};

// --- Schema View Component ---
interface SchemaNodeProps {
  label: string;
  value: any;
  depth?: number;
}

const SchemaNode: React.FC<SchemaNodeProps> = ({ label, value, depth = 0 }) => {
  const [expanded, setExpanded] = useState(depth < 3);
  const [textExpanded, setTextExpanded] = useState(false);

  if (value === null || value === undefined) {
    return (
      <div className="flex items-center gap-2 py-1" style={{ paddingLeft: `${depth * 16}px` }}>
        <span className="text-muted-foreground" style={FONT}>T</span>
        <span className="text-foreground font-medium" style={FONT}>{label}</span>
        <span className="text-muted-foreground" style={FONT}>null</span>
      </div>
    );
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 py-1 hover:bg-muted/30 w-full text-left transition-colors"
          style={{ paddingLeft: `${depth * 16}px` }}
        >
          {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronRightIcon className="w-3 h-3 text-muted-foreground shrink-0" />}
          <span className="text-accent-foreground" style={FONT}>⛁</span>
          <span className="text-foreground font-medium" style={FONT}>{label}</span>
        </button>
        {expanded && keys.map(key => (
          <SchemaNode key={key} label={key} value={value[key]} depth={depth + 1} />
        ))}
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 py-1 hover:bg-muted/30 w-full text-left transition-colors"
          style={{ paddingLeft: `${depth * 16}px` }}
        >
          {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronRightIcon className="w-3 h-3 text-muted-foreground shrink-0" />}
          <span className="text-accent-foreground" style={FONT}>⛁</span>
          <span className="text-foreground font-medium" style={FONT}>{label}</span>
          <span className="text-muted-foreground" style={{ ...FONT, fontSize: '11px' }}>({value.length})</span>
        </button>
        {expanded && value.map((item, i) => (
          <SchemaNode key={i} label={`[${i}]`} value={item} depth={depth + 1} />
        ))}
      </div>
    );
  }

  // Primitive - show full content for long strings with expand/collapse
  const strValue = String(value);
  const isLong = strValue.length > 200;

  if (isLong) {
    return (
      <div style={{ paddingLeft: `${depth * 16}px` }} className="py-1">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground shrink-0" style={FONT}>T</span>
          <span className="text-foreground font-medium shrink-0" style={FONT}>{label}</span>
          <span className="text-muted-foreground" style={{ ...FONT, fontSize: '11px' }}>({strValue.length.toLocaleString()} chars)</span>
          <button
            onClick={() => setTextExpanded(!textExpanded)}
            className="text-primary hover:underline shrink-0"
            style={{ ...FONT, fontSize: '11px' }}
          >
            {textExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {textExpanded ? (
          <pre
            className="text-muted-foreground mt-1 p-2 bg-muted/20 groove-border overflow-auto max-h-[400px]"
            style={{ ...FONT, fontSize: '12px', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginLeft: '16px' }}
          >
            {strValue}
          </pre>
        ) : (
          <div className="text-muted-foreground break-all mt-0.5" style={{ ...FONT, marginLeft: '16px' }}>
            {strValue.substring(0, 200)}…
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 py-1" style={{ paddingLeft: `${depth * 16}px` }}>
      <span className="text-muted-foreground shrink-0" style={FONT}>T</span>
      <span className="text-foreground font-medium shrink-0" style={FONT}>{label}</span>
      <span className="text-muted-foreground break-all" style={FONT}>{strValue}</span>
    </div>
  );
};

// --- JSON Block with Schema/JSON toggle ---
interface JsonBlockProps {
  data: any;
  label: string;
}

const JsonBlock: React.FC<JsonBlockProps> = ({ data, label }) => {
  const [viewMode, setViewMode] = useState<'schema' | 'json'>('schema');
  const [expanded, setExpanded] = useState(false);

  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return null;

  const parsedData = resolvePayloadDisplayData(data);
  const schemaDataCandidate = parsedData && typeof parsedData === 'object'
    ? parsedData
    : typeof parsedData === 'string'
      ? tryParseStructuredString(parsedData)
      : typeof data === 'string'
        ? tryParseStructuredString(data)
        : null;
  const canShowSchema = !!schemaDataCandidate && typeof schemaDataCandidate === 'object';
  const schemaData = canShowSchema ? schemaDataCandidate : null;
  const formatted = formatPayloadForDisplay(schemaData ?? parsedData);

  return (
    <>
      <div className="space-y-2">
        <h4 style={HEADER_FONT} className="text-foreground">{label}</h4>
        <div className="relative">
          <div className="p-4 groove-border bg-card overflow-auto max-h-[300px]">
            {canShowSchema ? (
              Array.isArray(schemaData) ? (
                <div>
                  {schemaData.map((item, index) => (
                    <SchemaNode key={index} label={`[${index}]`} value={item} />
                  ))}
                </div>
              ) : (
                <div>
                  {Object.entries(schemaData as Record<string, unknown>).map(([key, value]) => (
                    <SchemaNode key={key} label={key} value={value} />
                  ))}
                </div>
              )
            ) : (
              <pre
                className="text-foreground/80"
                style={{ ...FONT, fontSize: '12px', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {formatted}
              </pre>
            )}
          </div>
          <Button
            variant="default"
            size="icon"
            onClick={() => setExpanded(true)}
            className="absolute bottom-2 right-2 h-8 w-8"
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Expanded dialog - same size as detail dialog */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0" style={{ width: '90vw' }}>
          <DialogHeader className="px-6 pt-6 pb-4 flex-shrink-0" style={{ borderBottom: '3px groove hsl(var(--border-groove))' }}>
            <DialogTitle style={{ ...HEADER_FONT, fontSize: '22px' }}>{label}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
            {canShowSchema && (
              <div className="flex items-center gap-1 mb-4">
                {(['schema', 'json'] as const).map(mode => (
                  <Button
                    key={mode}
                    variant={viewMode === mode ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewMode(mode)}
                    className="h-7 text-xs px-3"
                  >
                    {mode === 'schema' ? 'Schema' : 'JSON'}
                  </Button>
                ))}
              </div>
            )}
            <div className="groove-border bg-card p-4">
              {viewMode === 'schema' && canShowSchema ? (
                Array.isArray(schemaData) ? (
                  <div>
                    {schemaData.map((item, index) => (
                      <SchemaNode key={index} label={`[${index}]`} value={item} />
                    ))}
                  </div>
                ) : (
                  <div>
                    {Object.entries(schemaData as Record<string, unknown>).map(([key, value]) => (
                      <SchemaNode key={key} label={key} value={value} />
                    ))}
                  </div>
                )
              ) : (
                <pre
                  className="text-foreground/80"
                  style={{ ...FONT, fontSize: '12px', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  {formatted}
                </pre>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

const RequestLogs = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'llm' | 'webhook' | 'database'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
  const [selectedLog, setSelectedLog] = useState<RequestLog | null>(null);
  const isFirstLoad = useRef(true);

  const fetchLogs = useCallback(async () => {
    if (!clientId) return;
    if (isFirstLoad.current) setLoading(true);
    try {
      let query = (supabase as any)
        .from('request_logs')
        .select('*', { count: 'exact' })
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

      if (activeFilter !== 'all') {
        query = query.eq('request_type', activeFilter);
      }
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      if (searchQuery.trim()) {
        query = query.or(`source.ilike.%${searchQuery}%,endpoint_url.ilike.%${searchQuery}%,model.ilike.%${searchQuery}%,error_message.ilike.%${searchQuery}%`);
      }

      const { data, error, count } = await query
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) throw error;
      setLogs((data as RequestLog[]) || []);
      setTotalCount(count || 0);
    } catch (err: any) {
      console.error('Error fetching request logs:', err);
      toast.error('Failed to fetch logs');
    } finally {
      setLoading(false);
      isFirstLoad.current = false;
    }
  }, [clientId, page, activeFilter, statusFilter, searchQuery]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const clearLogs = async () => {
    if (!clientId) return;
    try {
      const { error } = await (supabase as any)
        .from('request_logs')
        .delete()
        .eq('client_id', clientId)
        .eq('status', 'success');
      if (error) throw error;
      toast.success('Cleared successful logs');
      fetchLogs();
    } catch {
      toast.error('Failed to clear logs');
    }
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const errorCount = logs.filter(l => l.status === 'error').length;

  usePageHeader({
    title: 'Request Logs',
    leftExtra: totalCount > 0 ? (
      <div className="flex items-center gap-2 ml-3">
        <StatusTag variant="neutral">{totalCount} Total</StatusTag>
        {errorCount > 0 && <StatusTag variant="negative">{errorCount} Errors</StatusTag>}
      </div>
    ) : undefined,
    actions: [
      {
        label: 'CLEAR SUCCESS',
        icon: <Trash2 className="w-4 h-4" />,
        onClick: clearLogs,
        variant: 'outline' as const,
      },
      {
        label: loading ? 'REFRESHING...' : 'REFRESH',
        icon: <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />,
        onClick: fetchLogs,
        disabled: loading,
      },
    ],
  }, [loading, totalCount, errorCount]);

  const getSourceLabel = (source: string) => {
    const labels: Record<string, string> = {
      'generate-simulation-config': 'Simulation Config',
      'generate-simulation-personas': 'Simulation Personas',
      'generate-simulation-report': 'Smart Report',
      'run-simulation': 'Simulation Run',
      'modify-prompt-ai': 'Modify with AI',
      'analyze-metric': 'Metric Analysis',
      'format-metric-chart': 'Chart Format',
      'generate-setter-config': 'Setter Config',
      'generate-conversation-examples': 'Conv. Examples',
      'analytics-v2-process': 'Analytics Process',
      'analytics-v2-suggest-widgets': 'Widget Suggestions',
      'analyze-simulation': 'Simulation Analysis',
      'save-external-prompt': 'Save Prompt',
      'notify-webhook': 'Webhook Notify',
      'campaign-executor': 'Campaign Exec',
    };
    return labels[source] || source;
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'llm': return <Zap className="w-3.5 h-3.5" />;
      case 'webhook': return <Globe className="w-3.5 h-3.5" />;
      case 'database': return <Database className="w-3.5 h-3.5" />;
      default: return <Globe className="w-3.5 h-3.5" />;
    }
  };

  const formatDuration = (ms: number | null) => {
    if (ms === null) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatCost = (cost: number | null) => {
    if (cost === null) return '—';
    return `$${cost.toFixed(4)}`;
  };

  const formatTokens = (tokens: number | null) => {
    if (tokens === null) return '—';
    if (tokens > 1000) return `${(tokens / 1000).toFixed(1)}k`;
    return tokens.toString();
  };

  const grooveHeaderStyle = { borderRight: '3px groove hsl(var(--border-groove))' };
  const cellBorderStyle = { borderRight: '1px solid hsl(var(--border-groove) / 0.3)' };

  return (
    <div className="container mx-auto max-w-7xl">
      <div className="space-y-6">
        <LogsTabsNav />
        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search source, endpoint, model..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setPage(0); }}
              className="pl-9"
            />
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <button
                className="groove-btn flex items-center justify-center !h-8 !w-8 !p-0 relative"
                title="Filters"
              >
                <Filter className="w-4 h-4" />
                {(activeFilter !== 'all' || statusFilter !== 'all') && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary" />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-0" style={{ border: '3px groove hsl(var(--border-groove))' }}>
              <div className="p-3 space-y-3">
                <div>
                  <p className="text-muted-foreground mb-2" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>TYPE</p>
                  <div className="space-y-1">
                    {([
                      { value: 'all', label: 'ALL TYPES', icon: null },
                      { value: 'llm', label: 'LLM', icon: '⚡' },
                      { value: 'webhook', label: 'WEBHOOK', icon: '◎' },
                      { value: 'database', label: 'DATABASE', icon: '⛁' },
                    ] as const).map(f => (
                      <button
                        key={f.value}
                        onClick={() => { setActiveFilter(f.value); setPage(0); }}
                        className={`w-full text-left px-2.5 py-1.5 transition-colors rounded-sm flex items-center gap-2 ${activeFilter === f.value ? 'bg-primary/15 text-primary' : 'hover:bg-muted/50 text-foreground'}`}
                        style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', textTransform: 'uppercase' }}
                      >
                        {f.icon && <span>{f.icon}</span>}
                        <span>{f.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="border-t border-dashed border-border" />
                <div>
                  <p className="text-muted-foreground mb-2" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>STATUS</p>
                  <div className="space-y-1">
                    {([
                      { value: 'all', label: 'ANY STATUS' },
                      { value: 'success', label: '✓ SUCCESS' },
                      { value: 'error', label: '✕ ERROR' },
                    ] as const).map(f => (
                      <button
                        key={f.value}
                        onClick={() => { setStatusFilter(f.value); setPage(0); }}
                        className={`w-full text-left px-2.5 py-1.5 transition-colors rounded-sm ${statusFilter === f.value ? 'bg-primary/15 text-primary' : 'hover:bg-muted/50 text-foreground'}`}
                        style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', textTransform: 'uppercase' }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                {(activeFilter !== 'all' || statusFilter !== 'all') && (
                  <>
                    <div className="border-t border-dashed border-border" />
                    <button
                      onClick={() => { setActiveFilter('all'); setStatusFilter('all'); setPage(0); }}
                      className="w-full text-left px-2.5 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors rounded-sm flex items-center gap-2"
                      style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', textTransform: 'uppercase' }}
                    >
                      <X className="w-3 h-3" />
                      CLEAR FILTERS
                    </button>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Table */}
        {loading && isFirstLoad.current ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="border-2 border-border" style={{ borderStyle: 'groove' }}>
            <div className="flex flex-col items-center justify-center py-16">
              <CheckCircle className="w-12 h-12 text-primary mb-4" />
              <h3 className="text-lg font-medium">NO LOGS</h3>
              <p className="text-sm text-muted-foreground mt-1">No requests have been recorded yet.</p>
            </div>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead style={grooveHeaderStyle}>ID</TableHead>
                  <TableHead style={grooveHeaderStyle}>Status</TableHead>
                  <TableHead style={grooveHeaderStyle}>Type</TableHead>
                  <TableHead style={grooveHeaderStyle}>Source</TableHead>
                  <TableHead style={grooveHeaderStyle}>Model</TableHead>
                  <TableHead style={grooveHeaderStyle}>Duration</TableHead>
                  <TableHead style={grooveHeaderStyle}>Tokens</TableHead>
                  <TableHead style={grooveHeaderStyle}>Cost</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map(log => (
                  <TableRow
                    key={log.id}
                    className="cursor-pointer bg-card"
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest('[data-copy-request-id="true"]')) return;
                      setSelectedLog(log);
                    }}
                  >
                    <TableCell style={cellBorderStyle}>
                      <span
                        data-copy-request-id="true"
                        className="cursor-pointer block w-fit select-none"
                        title="Click to copy Request ID"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await navigator.clipboard.writeText(log.id);
                            toast.success('Request ID copied');
                          } catch {
                            toast.error('Failed to copy Request ID');
                          }
                        }}
                      >
                        <StatusTag variant="neutral" className="pointer-events-none">
                          <span style={{ fontFamily: "'VT323', monospace", fontSize: '14px', textTransform: 'uppercase' }}>
                            {log.id.split('-')[0]}...
                          </span>
                        </StatusTag>
                      </span>
                    </TableCell>
                    <TableCell style={cellBorderStyle}>
                      <div className="flex items-center gap-2">
                        {log.status === 'error' ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                        ) : (
                          <CheckCircle className="w-3.5 h-3.5 text-primary" />
                        )}
                        {log.status_code && (
                          <span className="text-xs text-muted-foreground">{log.status_code}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell style={cellBorderStyle}>
                      <div className="flex items-center gap-1.5">
                        {getTypeIcon(log.request_type)}
                        <span className="text-xs uppercase">{log.request_type}</span>
                      </div>
                    </TableCell>
                    <TableCell style={cellBorderStyle}>
                      <span className="font-medium">{getSourceLabel(log.source)}</span>
                      {log.error_message && (
                        <p className="text-xs text-destructive truncate max-w-[200px] mt-0.5">{log.error_message}</p>
                      )}
                    </TableCell>
                    <TableCell style={cellBorderStyle}>
                      <span className="text-xs text-muted-foreground">{log.model || '—'}</span>
                    </TableCell>
                    <TableCell style={cellBorderStyle}>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs">{formatDuration(log.duration_ms)}</span>
                      </div>
                    </TableCell>
                    <TableCell style={cellBorderStyle}>
                      <span className="text-xs">{formatTokens(log.tokens_used)}</span>
                    </TableCell>
                    <TableCell style={cellBorderStyle}>
                      <span className="text-xs">{formatCost(log.cost)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(log.created_at), 'MMM d, HH:mm:ss')}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-muted-foreground" style={FONT}>
                  Page {page + 1} of {totalPages} · {totalCount} total
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={open => { if (!open) setSelectedLog(null); }}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0" style={{ width: '90vw' }}>
          <DialogHeader className="px-6 pt-6 pb-4 flex-shrink-0" style={{ borderBottom: '3px groove hsl(var(--border-groove))' }}>
            <DialogTitle style={{ ...HEADER_FONT, fontSize: '24px' }}>
              Request Detail
            </DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-6">
              <div className="space-y-5">
                {/* Summary row */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 col-span-2">
                    <span className="text-xs text-muted-foreground" style={FONT}>Request ID</span>
                    <div className="flex items-center gap-2">
                      <span
                        className="cursor-pointer"
                        title="Click to copy Request ID"
                        onClick={() => { navigator.clipboard.writeText(selectedLog.id); toast.success('Request ID copied'); }}
                      >
                        <StatusTag variant="neutral">{selectedLog.id}</StatusTag>
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground" style={FONT}>Source</span>
                    <p className="font-medium" style={FONT}>{getSourceLabel(selectedLog.source)}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground" style={FONT}>Status</span>
                    <div className="flex items-center gap-2">
                      <StatusTag variant={selectedLog.status === 'error' ? 'negative' : 'positive'}>
                        {selectedLog.status === 'error' ? 'ERROR' : 'SUCCESS'}
                      </StatusTag>
                      {selectedLog.status_code && (
                        <span className="text-xs text-muted-foreground">{selectedLog.status_code}</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground" style={FONT}>Type</span>
                    <div className="flex items-center gap-1.5">
                      {getTypeIcon(selectedLog.request_type)}
                      <span style={FONT} className="uppercase">{selectedLog.request_type}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground" style={FONT}>Time</span>
                    <p style={FONT}>{format(new Date(selectedLog.created_at), 'MMM d yyyy, HH:mm:ss')}</p>
                  </div>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3">
                  {(() => {
                    const reqSize = selectedLog.metadata?.request_size_bytes;
                    const resSize = selectedLog.metadata?.response_size_bytes;
                    const formatBytes = (b: number | null | undefined) => {
                      if (b == null) return '—';
                      if (b < 1024) return `${b} B`;
                      if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
                      return `${(b / 1048576).toFixed(2)} MB`;
                    };
                    return [
                      { label: 'Duration', value: formatDuration(selectedLog.duration_ms) },
                      { label: 'Tokens', value: formatTokens(selectedLog.tokens_used) },
                      { label: 'Cost', value: formatCost(selectedLog.cost) },
                      { label: 'Model', value: selectedLog.model || '—' },
                      { label: 'Request Size', value: formatBytes(reqSize) },
                      { label: 'Response Size', value: formatBytes(resSize) },
                    ];
                  })().map(stat => (
                    <div key={stat.label} className="p-3 groove-border bg-card">
                      <span className="text-xs text-muted-foreground block" style={FONT}>{stat.label}</span>
                      <span className="text-sm font-medium" style={FONT}>{stat.value}</span>
                    </div>
                  ))}
                </div>

                {/* Endpoint */}
                {selectedLog.endpoint_url && (
                  <div className="space-y-2">
                    <h4 style={HEADER_FONT} className="text-foreground">Endpoint</h4>
                    <div className="p-3 groove-border bg-card">
                      <code style={{ ...FONT, fontSize: '12px' }} className="text-foreground/80 break-all">
                        {selectedLog.method} {selectedLog.endpoint_url}
                      </code>
                    </div>
                  </div>
                )}

                {/* Error */}
                {selectedLog.error_message && (
                  <div className="space-y-2">
                    <h4 style={HEADER_FONT} className="text-destructive">Error</h4>
                    <div className="p-3 bg-destructive/10 groove-border border-destructive/20">
                      <p style={{ ...FONT, fontSize: '12px' }} className="text-destructive">
                        {selectedLog.error_message}
                      </p>
                    </div>
                  </div>
                )}

                {/* Request Body */}
                <JsonBlock data={selectedLog.request_body} label="Request Input" />

                {/* Response Body */}
                <JsonBlock data={selectedLog.response_body} label="Response Output" />

                {/* Metadata */}
                <JsonBlock data={selectedLog.metadata} label="Metadata" />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RequestLogs;
