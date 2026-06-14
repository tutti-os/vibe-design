import React from 'react';
import { Toaster } from '@tutti-os/ui-system/components';
import { DashboardPage, type DashboardProject } from './DashboardPage';
import { ProjectEditorPage } from './ProjectEditorPage';
import type { ProjectEditorInitialData } from './project-editor-data';
import { DEFAULT_ROUTE, type VibeDesignRoute } from './routes';

export function VibeDesignApp({
  route = DEFAULT_ROUTE,
  openProject,
  recentProjects,
  projectEditor,
}: {
  route?: VibeDesignRoute;
  openProject?: (projectId: string) => void;
  recentProjects?: DashboardProject[];
  projectEditor?: ProjectEditorInitialData;
}) {
  return (
    <>
      {route.kind === 'project' ? (
        <ProjectEditorPage projectId={route.projectId} initialData={projectEditor} />
      ) : (
        <DashboardPage openProject={openProject} recentProjects={recentProjects} />
      )}
      <Toaster />
    </>
  );
}
