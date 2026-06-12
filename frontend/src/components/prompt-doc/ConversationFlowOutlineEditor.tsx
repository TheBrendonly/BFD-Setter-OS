import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { RefreshCw } from 'lucide-react';
import type { FlowOutline, FlowOutlineNode } from '@/lib/conversationFlowOutline';

// List-based editor for a conversation-flow outline (no graph canvas; the Retell
// dashboard remains the place for graph surgery). Only global prompt, node
// instruction text and edge condition prompts are editable; everything else is
// shown read-only and round-trips untouched via each node's raw JSON.

interface ConversationFlowOutlineEditorProps {
  outline: FlowOutline;
  onChange: (next: FlowOutline) => void;
  onRefreshFromRetell?: () => void;
  refreshing?: boolean;
  disabled?: boolean;
}

const MONO_STYLE: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: '13px',
  lineHeight: '1.6',
};

export const ConversationFlowOutlineEditor: React.FC<ConversationFlowOutlineEditorProps> = ({
  outline,
  onChange,
  onRefreshFromRetell,
  refreshing,
  disabled,
}) => {
  const nodes = outline.nodes || [];
  const nodeNameById = new Map(nodes.map((n) => [n.id, n.name || n.id]));

  const updateNode = (nodeId: string, patch: Partial<FlowOutlineNode>) => {
    onChange({
      ...outline,
      nodes: nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-muted-foreground" style={{ ...MONO_STYLE, fontSize: '12px' }}>
          Rigid conversation flow: only the global prompt + the active node go to the
          LLM each turn. Node structure (splits, functions, transfers) is edited in
          the Retell dashboard and absorbed here on refresh.
        </p>
        {onRefreshFromRetell && (
          <Button size="sm" variant="outline" onClick={onRefreshFromRetell} disabled={refreshing || disabled}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh from Retell
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-medium">Global prompt (persona, applies to every node)</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <Textarea
            value={outline.global_prompt || ''}
            onChange={(e) => onChange({ ...outline, global_prompt: e.target.value })}
            spellCheck={false}
            disabled={disabled}
            className="min-h-[20vh]"
            style={MONO_STYLE}
          />
        </CardContent>
      </Card>

      {nodes.map((node) => {
        const isStart = node.id === outline.start_node_id;
        const isConversation = !node.type || node.type === 'conversation';
        return (
          <Card key={node.id}>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-sm font-medium">{node.name || node.id}</CardTitle>
                <Badge variant="outline" className="uppercase">{node.type || 'conversation'}</Badge>
                {isStart && <Badge variant="secondary">START</Badge>}
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {isConversation ? (
                <Textarea
                  value={node.instruction?.text || ''}
                  onChange={(e) => updateNode(node.id, {
                    instruction: { type: node.instruction?.type || 'prompt', text: e.target.value },
                  })}
                  spellCheck={false}
                  disabled={disabled}
                  placeholder="Node instruction (what the agent does in this stage)…"
                  className="min-h-[10vh]"
                  style={MONO_STYLE}
                />
              ) : (
                <p className="text-muted-foreground" style={{ ...MONO_STYLE, fontSize: '12px' }}>
                  {node.type === 'end'
                    ? 'Call ends here.'
                    : 'This node type is configured in the Retell dashboard; it round-trips untouched.'}
                </p>
              )}
              {(node.edges || []).map((edge, idx) => (
                <div key={edge.id || idx} className="flex items-start gap-2">
                  <span className="shrink-0 pt-2 text-muted-foreground" style={{ ...MONO_STYLE, fontSize: '12px' }}>
                    → {nodeNameById.get(edge.destination_node_id || '') || edge.destination_node_id || '?'}
                  </span>
                  <Textarea
                    value={edge.condition || ''}
                    onChange={(e) => updateNode(node.id, {
                      edges: (node.edges || []).map((other, otherIdx) =>
                        (edge.id ? other.id === edge.id : otherIdx === idx)
                          ? { ...other, condition: e.target.value }
                          : other,
                      ),
                    })}
                    spellCheck={false}
                    disabled={disabled}
                    placeholder="Transition condition…"
                    rows={1}
                    className="min-h-[38px]"
                    style={{ ...MONO_STYLE, fontSize: '12px' }}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
