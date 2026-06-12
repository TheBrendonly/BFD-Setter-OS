import React from 'react';

// Dashed amber "ADDED AT CALL TIME (PUSH)" blocks, extracted from FullPromptXRay's
// callTimeSegments rendering so the prompt-doc page can show the TRUE final prompt
// (doc + booking append + retell-proxy DYNAMIC_VARS_BLOCK) without the x-ray.

export interface CallTimeAppend {
  id: string;
  title: string;
  text: string;
}

const MONO_STYLE: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: '13px',
  lineHeight: '1.6',
};

export const CallTimeAppendBlock: React.FC<{ appends: CallTimeAppend[] }> = ({ appends }) => {
  if (appends.length === 0) return null;
  return (
    <>
      {appends.map((seg) => (
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
          <div className="whitespace-pre-wrap break-words text-muted-foreground" style={MONO_STYLE}>
            {seg.text}
          </div>
        </div>
      ))}
    </>
  );
};
