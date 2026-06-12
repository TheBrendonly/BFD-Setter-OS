// Conversation-flow outline model (doc model Phase 4, 2026-06-12).
// The outline is the editable projection of a Retell conversation flow: each
// node keeps the FULL raw node JSON round-tripped from get-conversation-flow,
// and the UI only edits global_prompt, node instruction text and edge condition
// prompts. retell-proxy overlays those fields back onto `raw` at push time, so
// graph surgery done in the Retell dashboard is never clobbered.

export interface FlowOutlineEdge {
  id?: string;
  destination_node_id?: string;
  condition?: string;
}

export interface FlowOutlineNode {
  id: string;
  name?: string;
  type?: string;
  instruction?: { type: string; text: string };
  edges?: FlowOutlineEdge[];
  raw?: Record<string, unknown>;
}

export interface FlowOutline {
  global_prompt?: string;
  start_node_id?: string;
  start_speaker?: string;
  nodes?: FlowOutlineNode[];
}

// Project a raw Retell conversation-flow object (get-conversation-flow response)
// into the editable outline. The DYNAMIC_VARS block that retell-proxy appends to
// global_prompt at push time is stripped back off so it never duplicates.
const DYNAMIC_VARS_MARKER = '## DYNAMIC VARIABLES (auto-injected, available at runtime)';

export function hydrateOutlineFromRetellFlow(flow: Record<string, unknown>): FlowOutline {
  let globalPrompt = typeof flow.global_prompt === 'string' ? flow.global_prompt : '';
  const markerIdx = globalPrompt.indexOf(DYNAMIC_VARS_MARKER);
  if (markerIdx >= 0) {
    // Cut at the separator line preceding the marker (the block starts with it).
    const sepIdx = globalPrompt.lastIndexOf('── ──', markerIdx);
    globalPrompt = globalPrompt.slice(0, sepIdx >= 0 ? sepIdx : markerIdx).trimEnd();
  }
  const rawNodes = Array.isArray(flow.nodes) ? flow.nodes as Array<Record<string, unknown>> : [];
  const nodes: FlowOutlineNode[] = rawNodes.map((n) => {
    const instruction = (n.instruction && typeof n.instruction === 'object')
      ? n.instruction as { type?: string; text?: string }
      : null;
    const edges = Array.isArray(n.edges) ? n.edges as Array<Record<string, unknown>> : [];
    return {
      id: String(n.id ?? ''),
      name: typeof n.name === 'string' ? n.name : undefined,
      type: typeof n.type === 'string' ? n.type : undefined,
      instruction: instruction && typeof instruction.text === 'string'
        ? { type: instruction.type || 'prompt', text: instruction.text }
        : undefined,
      edges: edges.map((e) => {
        const tc = (e.transition_condition && typeof e.transition_condition === 'object')
          ? e.transition_condition as { type?: string; prompt?: string }
          : null;
        return {
          id: typeof e.id === 'string' ? e.id : undefined,
          destination_node_id: typeof e.destination_node_id === 'string' ? e.destination_node_id : undefined,
          condition: tc?.type === 'prompt' && typeof tc.prompt === 'string'
            ? tc.prompt
            : (typeof e.condition === 'string' ? e.condition : undefined),
        };
      }),
      raw: n,
    };
  });
  return {
    global_prompt: globalPrompt,
    start_node_id: typeof flow.start_node_id === 'string' ? flow.start_node_id : undefined,
    start_speaker: typeof flow.start_speaker === 'string' ? flow.start_speaker : undefined,
    nodes,
  };
}

// Plain-text rendering of an outline, used for prompt_versions history entries.
export function outlineToText(outline: FlowOutline): string {
  const parts: string[] = [];
  parts.push(`# GLOBAL PROMPT\n\n${outline.global_prompt || '(empty)'}`);
  for (const node of outline.nodes || []) {
    const lines: string[] = [`## NODE: ${node.name || node.id} [${node.type || 'conversation'}]`];
    if (node.instruction?.text) lines.push(node.instruction.text);
    for (const edge of node.edges || []) {
      if (edge.condition) lines.push(`→ ${edge.destination_node_id || '?'}: ${edge.condition}`);
    }
    parts.push(lines.join('\n\n'));
  }
  return parts.join('\n\n──────────\n\n');
}

// Fixed v1 wizard template: Welcome → Qualify → Pitch/Objections → Book → End.
// Persona/guardrails/company content goes into the global prompt; the strategy
// text seeds the qualify/pitch node instructions. Editable immediately after
// generation; the node set is a starting point, not a constraint.
export function compileWizardToFlowOutline(opts: {
  globalPrompt: string;
  strategyText?: string;
  bookingEnabled?: boolean;
}): FlowOutline {
  const strategy = opts.strategyText?.trim() || '';
  const nodes: FlowOutlineNode[] = [
    {
      id: 'node_welcome',
      name: 'Welcome',
      type: 'conversation',
      instruction: {
        type: 'prompt',
        text: 'Greet the lead by first name, introduce yourself briefly, and ask if now is a good time to talk.',
      },
      edges: [
        { id: 'edge_welcome_ok', destination_node_id: 'node_qualify', condition: 'Lead is free to talk' },
        { id: 'edge_welcome_busy', destination_node_id: 'node_end', condition: 'Lead is busy or asks to be called back' },
      ],
    },
    {
      id: 'node_qualify',
      name: 'Qualify',
      type: 'conversation',
      instruction: {
        type: 'prompt',
        text: strategy
          ? `Qualify the lead conversationally. ${strategy}`
          : 'Qualify the lead conversationally: their situation, goals, timeline and fit. One question at a time.',
      },
      edges: [
        { id: 'edge_qualify_fit', destination_node_id: 'node_pitch', condition: 'Lead is qualified and engaged' },
        { id: 'edge_qualify_nofit', destination_node_id: 'node_end', condition: 'Lead is clearly not a fit or asks to stop' },
      ],
    },
    {
      id: 'node_pitch',
      name: 'Pitch & Objections',
      type: 'conversation',
      instruction: {
        type: 'prompt',
        text: 'Present the value of booking a call with the team, tailored to what the lead shared. Handle objections naturally; do not be pushy.',
      },
      edges: [
        { id: 'edge_pitch_book', destination_node_id: opts.bookingEnabled === false ? 'node_end' : 'node_book', condition: 'Lead agrees to book a time' },
        { id: 'edge_pitch_decline', destination_node_id: 'node_end', condition: 'Lead declines after objection handling' },
      ],
    },
    ...(opts.bookingEnabled === false ? [] : [{
      id: 'node_book',
      name: 'Book Appointment',
      type: 'conversation',
      instruction: {
        type: 'prompt',
        text: 'Use get-available-slots to fetch open times, offer two or three options, confirm the choice, then call book-appointments and verbally confirm the booking.',
      },
      edges: [
        { id: 'edge_book_done', destination_node_id: 'node_end', condition: 'Booking confirmed or lead wants to finish' },
      ],
    } satisfies FlowOutlineNode]),
    {
      id: 'node_end',
      name: 'End',
      type: 'end',
      edges: [],
    },
  ];
  return {
    global_prompt: opts.globalPrompt,
    start_node_id: 'node_welcome',
    start_speaker: 'agent',
    nodes,
  };
}
