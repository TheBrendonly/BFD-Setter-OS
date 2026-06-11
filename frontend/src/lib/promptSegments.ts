import { LAYER_SEPARATOR, MINI_PROMPT_SEPARATOR } from '@/data/setterConfigParameters';

// Segment model for the read-only "Setter Prompt X-Ray" view.
// buildFullPromptSegments() (AgentConfigBuilder) emits these in exact assembly order;
// segmentsToText() must reproduce the legacy buildFullPrompt() output byte-for-byte.

export type SegmentTarget =
  | { kind: 'layer'; key: string }       // CoreLayerId — navigate via handleLayerClick
  | { kind: 'subsection'; key: string }  // [data-subsection-key]
  | { kind: 'anchor'; key: string }      // [data-anchor-key] (or #field-booking_function for 'booking-prompt')
  | { kind: 'readonly'; label: string }; // not navigable (e.g. appended at call time)

export interface PromptSubSegment {
  id: string;
  title: string;
  text: string;
  target: SegmentTarget;
}

export interface PromptSegment {
  id: string;
  title: string;
  // EXACT text this segment contributes to the joined prompt.
  // Invariant when subSegments is present:
  //   text === `${headerText}\n\n` + subSegments.map(s => s.text).join(`\n\n${MINI_PROMPT_SEPARATOR}\n\n`)
  text: string;
  source: 'params' | 'config-section' | 'examples' | 'custom' | 'booking' | 'push-append';
  target: SegmentTarget;
  headerText?: string;
  subSegments?: PromptSubSegment[];
}

export const SUB_SEGMENT_JOIN = `\n\n${MINI_PROMPT_SEPARATOR}\n\n`;
export const SEGMENT_JOIN = `\n\n${LAYER_SEPARATOR}\n\n`;

export function segmentsToText(segments: PromptSegment[]): string {
  return segments.map(s => s.text).join(SEGMENT_JOIN);
}
