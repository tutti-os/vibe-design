import { useTranslation } from '../i18n';
import { appendTuttiExternalReferenceSelections } from '@tutti-os/workspace-external-core/rich-text';
import type { TuttiExternalBridge } from '@tutti-os/workspace-external-core/contracts';
import { WorkspaceReferenceAddControl } from '@tutti-os/workspace-file-reference/ui';

export function TuttiReferenceAddControl(props: {
  className?: string;
  disabled?: boolean;
  labels?: Partial<{
    addContent: string;
    browseReferences: string;
    uploadFile: string;
  }>;
  value: string;
  onChange: (value: string) => void;
  onError?: () => void;
  onUploadFile?: () => void;
}) {
  const { t } = useTranslation();
  const selectReferences = getTuttiBridge()?.references?.select;

  if (!selectReferences && !props.onUploadFile) {
    return null;
  }

  const browseReferences = selectReferences
    ? () => {
        void selectReferences()
          .then((selections) => {
            if (selections.length === 0) return;
            props.onChange(
              appendTuttiExternalReferenceSelections(props.value, selections),
            );
          })
          .catch(() => props.onError?.());
      }
    : () => props.onUploadFile?.();

  return (
    <WorkspaceReferenceAddControl
      className={props.className}
      disabled={props.disabled}
      labels={{
        addContent: selectReferences
          ? (props.labels?.addContent ?? t('chat.composer.addContent'))
          : (props.labels?.uploadFile ?? t('chat.composer.attachFiles')),
        browseReferences:
          props.labels?.browseReferences ?? t('chat.composer.browseReferences'),
        uploadFile:
          props.labels?.uploadFile ?? t('chat.composer.attachFiles'),
      }}
      onBrowseReferences={browseReferences}
      {...(selectReferences && props.onUploadFile
        ? { onUploadFile: props.onUploadFile }
        : {})}
    />
  );
}

function getTuttiBridge(): Partial<TuttiExternalBridge> | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { tuttiExternal?: Partial<TuttiExternalBridge> })
    .tuttiExternal;
}
