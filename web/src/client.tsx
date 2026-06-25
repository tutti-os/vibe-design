import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { createVibeDesignFlow, type VibeDesignFlowOptions } from './launch/vibe-design-flow';

declare global {
  interface Window {
    __VIBE_DESIGN_INITIAL__?: VibeDesignFlowOptions;
  }
}

type LaunchIntent = {
  route?: unknown;
};

type TuttiLaunchWindow = Window & {
  tuttiExternal?: {
    workspace?: {
      onLaunchIntent?: (listener: (intent: LaunchIntent) => void) => unknown;
    };
  };
};

const root = document.getElementById('root');

if (root) {
  hydrateRoot(root, <>{createVibeDesignFlow(window.__VIBE_DESIGN_INITIAL__).render()}</>);
}

registerLaunchIntentNavigation();

function registerLaunchIntentNavigation(): void {
  const onLaunchIntent = (window as TuttiLaunchWindow).tuttiExternal?.workspace?.onLaunchIntent;
  if (typeof onLaunchIntent !== 'function') {
    return;
  }

  onLaunchIntent((intent) => {
    const route = intent && typeof intent === 'object' && typeof intent.route === 'string' ? intent.route : null;
    if (!route || !isSafeLaunchRoute(route) || route === window.location.pathname) {
      return;
    }

    window.location.assign(route);
  });
}

function isSafeLaunchRoute(route: string): boolean {
  return route.startsWith('/') && !route.startsWith('//') && !route.includes('\\') && !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(route);
}
