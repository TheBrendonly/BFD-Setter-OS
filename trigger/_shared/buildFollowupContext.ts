// FOLLOWUP-PROMPT-1 — pure assembly of the follow-up channel's LLM user message.
//
// Extracted from the inline array in sendFollowup.ts so the fix (adding a real
// current-time anchor and a live-calendar availability prefetch, the same
// protections the live-reply path already has) is genuinely unit-testable.
// Availability is injected as DATA, never left to a stale prompt policy —
// same anti-fabrication rationale as processSetterReply.ts's wiring.

export function buildFollowupUserMessage(args: {
  setterPrompt: string;
  availabilityBlock: string;
  timeAnchorBlock: string;
  chatHistoryText: string;
  cancellationSection: string;
  followupInstructions: string;
  sequenceIndex: number;
}): string {
  return [
    args.setterPrompt ? `## Setter Prompt\n${args.setterPrompt}` : "",
    args.availabilityBlock,
    args.timeAnchorBlock,
    `## Conversation History\n${args.chatHistoryText}`,
    args.cancellationSection,
    args.followupInstructions
      ? `## Follow-up Instructions (apply these only if you decide to follow up)\n${args.followupInstructions}`
      : "",
    args.sequenceIndex > 1
      ? `## Note\nThis is follow-up attempt #${args.sequenceIndex}. The lead has not responded to the previous follow-up(s). If you still decide to send one, be slightly more direct, but do not be pushy.`
      : "",
    "## Task\nAnalyze the conversation and return JSON as instructed in the system prompt.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
