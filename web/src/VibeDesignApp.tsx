import React from 'react';
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
  if (route.kind === 'project') {
    return <ProjectEditorPage projectId={route.projectId} initialData={projectEditor} />;
  }

  return <DashboardPage openProject={openProject} recentProjects={recentProjects} />;
}
