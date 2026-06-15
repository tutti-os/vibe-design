import { Badge, Button, Card, CardContent, toast } from '@tutti-os/ui-system/components';
import { FileIcon } from '@tutti-os/ui-system/icons';
import React from 'react';
import type { LiveArtifactWorkspaceEntry } from '../types';
import { useTranslation } from '../i18n';
import { downloadFileFromUrl } from '../utils/download-file';

interface LiveArtifactBadgesProps {
  artifacts: LiveArtifactWorkspaceEntry[];
  onOpenLiveArtifact: (tabId: LiveArtifactWorkspaceEntry['tabId']) => void;
}

export function LiveArtifactBadges({ artifacts, onOpenLiveArtifact }: LiveArtifactBadgesProps) {
  const { t } = useTranslation();
  if (artifacts.length === 0) return null;

  return (
    <section aria-label={t('artifacts.generatedMedia')}>
      <header>
        <h3>{t('artifacts.generatedMedia')}</h3>
        <Badge variant="secondary">{artifacts.length}</Badge>
      </header>
      <div>
        {artifacts.map((artifact) => (
          <Card key={artifact.tabId} data-testid={`design-file-row-${artifact.tabId}`}>
            <CardContent>
              <Button
                type="button"
                variant="ghost"
                aria-label={t('artifacts.openLiveArtifact', { title: artifact.title })}
                onClick={() => onOpenLiveArtifact(artifact.tabId)}
              >
                <LiveArtifactPreview artifact={artifact} />
                <span>{artifact.title}</span>
              </Button>
              <LiveArtifactStatusBadges artifact={artifact} />
              {artifact.preview.url ? (
                <a
                  href={artifact.preview.url}
                  download={artifact.title}
                  aria-label={t('artifacts.downloadAria', { title: artifact.title })}
                  onClick={(event) => {
                    event.preventDefault();
                    void downloadFileFromUrl(artifact.preview.url!, artifact.title)
                      .then((saved) => {
                        if (saved) {
                          toast.success(t('artifacts.downloadStarted', { title: artifact.title }));
                        }
                      })
                      .catch(() => toast.error(t('artifacts.downloadFailed', { title: artifact.title })));
                  }}
                >
                  {t('artifacts.download')}
                </a>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function LiveArtifactPreview({ artifact }: { artifact: LiveArtifactWorkspaceEntry }) {
  const { t } = useTranslation();
  const preview = artifact.preview;
  const url = preview.thumbnailUrl || preview.url || preview.entry || '';

  if (preview.type === 'image' && url) {
    return <img src={url} alt={artifact.title} width={96} height={72} />;
  }

  if (preview.type === 'video' && url) {
    return <video src={url} muted playsInline width={96} height={72} aria-label={t('artifacts.videoPreview', { title: artifact.title })} />;
  }

  if (preview.type === 'audio') {
    return (
      <span>
        <FileIcon size={16} aria-hidden />
        {t('artifacts.audioPreview')}
      </span>
    );
  }

  return <FileIcon size={16} aria-hidden />;
}

function LiveArtifactStatusBadges({ artifact }: { artifact: LiveArtifactWorkspaceEntry }) {
  const { t } = useTranslation();
  const badges = [
    { key: 'live', label: t('artifacts.status.live') },
    artifact.refreshStatus === 'running' ? { key: 'refreshing', label: t('artifacts.status.refreshing') } : null,
    artifact.refreshStatus === 'failed' ? { key: 'refresh-failed', label: t('artifacts.status.refreshFailed') } : null,
    artifact.status === 'archived' ? { key: 'archived', label: t('artifacts.status.archived') } : null,
  ].filter((badge): badge is { key: string; label: string } => Boolean(badge));

  return (
    <span aria-label={t('artifacts.liveArtifactStatus')}>
      {badges.map((badge) => (
        <Badge key={badge.key} variant={badge.key === 'live' ? 'default' : 'secondary'}>
          {badge.label}
        </Badge>
      ))}
    </span>
  );
}
