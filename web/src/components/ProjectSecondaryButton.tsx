import React from 'react';
import { Button } from '@tutti-os/ui-system/components';
import { cn } from '@tutti-os/ui-system/utils';

type ProjectSecondaryButtonProps = React.ComponentProps<typeof Button>;

export function ProjectSecondaryButton({ className, ...props }: ProjectSecondaryButtonProps) {
  return (
    <Button
      {...props}
      size="sm"
      variant="chrome"
      className={cn(
        'project-secondary-button project-secondary-ghost-button h-8 rounded-md border-0 px-3 text-[12px] font-normal',
        className,
      )}
    />
  );
}
