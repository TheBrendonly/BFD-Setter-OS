import React from 'react';
import { useParams } from 'react-router-dom';
import { PresentationAgentChatInterface } from '@/components/PresentationAgentChatInterface';
import { usePageHeader } from '@/contexts/PageHeaderContext';

const PresentationAgent = () => {
  const { clientId } = useParams<{ clientId: string }>();

  usePageHeader({
    title: 'Webinar',
    breadcrumbs: [
      { label: 'Webinar' },
      { label: 'Presentation Agent' },
    ],
  });

  return (
    <div className="h-[calc(100vh-48px)] overflow-hidden bg-background">
      <div className="container mx-auto max-w-7xl h-full">
        <PresentationAgentChatInterface />
      </div>
    </div>
  );
};

export default PresentationAgent;
