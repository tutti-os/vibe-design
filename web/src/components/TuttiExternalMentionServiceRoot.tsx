import { RichTextMentionServiceProvider } from '@tutti-os/ui-rich-text/editor';
import { createRichTextMentionService } from '@tutti-os/ui-rich-text/service';
import { createTuttiExternalRichTextMentionService } from '@tutti-os/workspace-external-core/rich-text';
import { useEffect, useState, type ReactNode } from 'react';

export function TuttiExternalMentionServiceRoot({ children }: { children: ReactNode }) {
  const [fallbackService] = useState(() => createRichTextMentionService({ providers: [] }));
  const [service, setService] = useState<ReturnType<typeof createTuttiExternalRichTextMentionService>>(fallbackService);

  useEffect(() => {
    const next = createTuttiExternalRichTextMentionService({
      getBridge: () =>
        (typeof window === 'undefined'
          ? undefined
          : (window as unknown as { tuttiExternal?: unknown }).tuttiExternal) as never,
      providerIds: ['workspace-app', 'agent-target'],
    });
    setService(next);
    fallbackService.dispose();
    return () => next.dispose();
  }, [fallbackService]);

  return <RichTextMentionServiceProvider service={service}>{children}</RichTextMentionServiceProvider>;
}
