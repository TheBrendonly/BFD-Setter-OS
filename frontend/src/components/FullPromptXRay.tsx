import React from 'react';
import { cn } from '@/lib/utils';
import { LAYER_SEPARATOR, MINI_PROMPT_SEPARATOR } from '@/data/setterConfigParameters';
import type { PromptSegment, SegmentTarget } from '@/lib/promptSegments';

// Read-only, segmented view of the assembled setter prompt. Renders as one contiguous
// monospace document; every segment is clickable and navigates the editor to the control
// that produces it. Call-time segments (appended at push by the save path / retell-proxy)
// are shown read-only in dashed amber blocks.

interface FullPromptXRayProps {
  segments: PromptSegment[];
  callTimeSegments?: PromptSegment[];
  onNavigate: (target: SegmentTarget) => void;
  maxHeight?: string;
  emptyPlaceholder?: string;
}

const MONO_STYLE: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: '13px',
  lineHeight: '1.6',
};

const HOVER_LABEL_STYLE: React.CSSProperties = {
  fontFamily: "'VT323', monospace",
  fontSize: '13px',
  letterSpacing: '0.5px',
};

const SeparatorLine: React.FC<{ text: string }> = ({ text }) => (
  <div className="text-muted-foreground/50 select-none py-2" style={MONO_STYLE}>
    {text}
  </div>
);

const ClickableBlock: React.FC<{
  title: string;
  target: SegmentTarget;
  onNavigate: (target: SegmentTarget) => void;
  children: React.ReactNode;
}> = ({ title, target, onNavigate, children }) => (
  <div
    role="button"
    tabIndex={0}
    onClick={() => onNavigate(target)}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onNavigate(target);
      }
    }}
    className="group relative cursor-pointer whitespace-pre-wrap break-words border-l-2 border-transparent transition-colors hover:bg-muted/50 hover:border-primary focus-visible:bg-muted/50 focus-visible:border-primary outline-none"
    style={{ ...MONO_STYLE, padding: '2px 8px' }}
    aria-label={`Edit ${title}`}
  >
    <span
      className="absolute right-1 top-0 hidden group-hover:inline group-focus-visible:inline bg-card px-1.5 text-primary pointer-events-none z-10"
      style={HOVER_LABEL_STYLE}
    >
      {title.toUpperCase()}: CLICK TO EDIT
    </span>
    {children}
  </div>
);

export const FullPromptXRay: React.FC<FullPromptXRayProps> = ({
  segments,
  callTimeSegments = [],
  onNavigate,
  maxHeight,
  emptyPlaceholder = 'No prompt content yet. Configure your mini-prompts above to build the full setter prompt...',
}) => {
  const isEmpty = segments.length === 0;

  return (
    <div
      className="groove-border bg-card overflow-y-auto p-3"
      style={{ maxHeight, height: maxHeight }}
    >
      {isEmpty ? (
        <p className="text-muted-foreground" style={MONO_STYLE}>{emptyPlaceholder}</p>
      ) : (
        segments.map((seg, i) => (
          <React.Fragment key={seg.id}>
            {i > 0 && <SeparatorLine text={LAYER_SEPARATOR} />}
            {seg.subSegments && seg.headerText ? (
              <>
                <ClickableBlock title={seg.title} target={seg.target} onNavigate={onNavigate}>
                  {seg.headerText}
                </ClickableBlock>
                {seg.subSegments.map((sub, j) => (
                  <React.Fragment key={sub.id}>
                    {j > 0 && <SeparatorLine text={MINI_PROMPT_SEPARATOR} />}
                    <ClickableBlock title={sub.title} target={sub.target} onNavigate={onNavigate}>
                      {sub.text}
                    </ClickableBlock>
                  </React.Fragment>
                ))}
              </>
            ) : (
              <ClickableBlock title={seg.title} target={seg.target} onNavigate={onNavigate}>
                {seg.text}
              </ClickableBlock>
            )}
          </React.Fragment>
        ))
      )}
      {callTimeSegments.length > 0 && (
        <>
          {!isEmpty && <SeparatorLine text={LAYER_SEPARATOR} />}
          {callTimeSegments.map((seg) => (
            <div key={seg.id} className="border border-dashed border-amber-500/40 bg-amber-500/5 p-2 my-2">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span
                  className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 border border-amber-500/30"
                  style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', letterSpacing: '0.3px' }}
                >
                  ADDED AT CALL TIME (PUSH)
                </span>
                <span className="text-muted-foreground" style={{ ...MONO_STYLE, fontSize: '12px' }}>
                  {seg.title}
                </span>
              </div>
              <div className={cn('whitespace-pre-wrap break-words text-muted-foreground')} style={MONO_STYLE}>
                {seg.text}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
};
