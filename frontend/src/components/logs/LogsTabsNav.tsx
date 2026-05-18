import React from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Shared tabs nav rendered at the top of Logs.tsx, ErrorLogs.tsx, and
 * RequestLogs.tsx so the three pages feel like a single unified Logs surface
 * with tabs — without the risk of refactoring 4,000+ LOC across 3 pages
 * into a single wrapper component.
 *
 * The "active" tab is derived from the current URL path. Clicking a tab
 * navigates to the corresponding route. Each underlying page keeps its own
 * usePageHeader so the page title + breadcrumbs update naturally.
 *
 * Sidebar's "Logs" item points at /logs only — from there the user reaches
 * the other two via this tab nav.
 */
export const LogsTabsNav: React.FC = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const currentTab = location.pathname.endsWith('/error-logs')
    ? 'errors'
    : location.pathname.endsWith('/request-logs')
      ? 'requests'
      : 'activity';

  const handleTabChange = (next: string) => {
    if (!clientId) return;
    const target = next === 'errors'
      ? `/client/${clientId}/error-logs`
      : next === 'requests'
        ? `/client/${clientId}/request-logs`
        : `/client/${clientId}/logs`;
    navigate(target);
  };

  return (
    <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
      <TabsList className="grid grid-cols-3 w-full max-w-2xl">
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="errors">Errors</TabsTrigger>
        <TabsTrigger value="requests">Requests</TabsTrigger>
      </TabsList>
    </Tabs>
  );
};
