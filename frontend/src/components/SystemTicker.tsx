import React from 'react';
import { useTickerStats } from '@/hooks/useTickerStats';

const fmt = (n: number | null) => (n === null ? '...' : n.toLocaleString());

interface SystemTickerProps {
  clientId?: string;
  isAgency?: boolean;
}

/**
 * Retro system ticker bar — live data from CRM, OpenRouter, and Retell.
 */
export function SystemTicker({ clientId, isAgency = false }: SystemTickerProps) {
  const stats = useTickerStats(clientId, isAgency);

  const green = 'hsl(153 35% 38%)';
  const blue = 'hsl(217 91% 60%)';
  const orange = 'hsl(33 80% 45%)';

  const sep = <span className="text-muted-foreground mx-4">/</span>;

  const tickerContent = (
    <>
      <span style={{ color: green }}>TOTAL_LEADS: {fmt(stats.totalLeads)}</span>
      {sep}
      <span style={{ color: blue }}>UNREAD_CHATS: {fmt(stats.unreadChats)}</span>
      {sep}
      <span style={{ color: orange }}>TEXT_SETTERS: {fmt(stats.textSetters)}</span>
      {sep}
      <span style={{ color: green }}>VOICE_SETTERS: {fmt(stats.voiceSetters)}</span>
      {sep}
      <span style={{ color: blue }}>ACTIVE_CAMPAIGNS: {fmt(stats.activeCampaigns)}</span>
      {sep}
      {isAgency && (
        <>
          <span style={{ color: orange }}>
            OPENROUTER_BALANCE: {stats.openrouterBalance === null ? '...' : `$${stats.openrouterBalance.toLocaleString()}`}
          </span>
          {sep}
        </>
      )}
      <span style={{ color: green }}>OUTBOUND_CALLS: {fmt(stats.outboundCalls)}</span>
      {sep}
    </>
  );

  return (
    <div
      className="fixed bottom-0 left-0 right-0 bg-[hsl(224,30%,10%)] overflow-hidden scanline-bright"
      style={{ height: '24px', fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', borderTop: '3px groove hsl(var(--border-groove))', zIndex: 99999 }}
    >
      <div
        className="flex items-center whitespace-nowrap h-full"
        style={{ animation: 'ticker-scroll 30s linear infinite' }}
      >
        {tickerContent}
        {tickerContent}
      </div>
    </div>
  );
}
