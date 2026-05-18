import React from 'react';
import { useParams } from 'react-router-dom';
import { WebinarPresentationAgentChatInterface } from '@/components/WebinarPresentationAgentChatInterface';
import { usePageHeader } from '@/contexts/PageHeaderContext';

const WebinarPresentationAgent = () => {
  const { clientId } = useParams<{ clientId: string }>();

  usePageHeader({ title: 'Webinar Presentation Agent' });

  return (
    <div className="h-[calc(100vh-48px)] overflow-hidden bg-background p-4">
      <WebinarPresentationAgentChatInterface />
    </div>
  );
};

export default WebinarPresentationAgent;
