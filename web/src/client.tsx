import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { createVibeDesignFlow, type VibeDesignFlowOptions } from './launch/vibe-design-flow';

declare global {
  interface Window {
    __VIBE_DESIGN_INITIAL__?: VibeDesignFlowOptions;
  }
}

const root = document.getElementById('root');

if (root) {
  hydrateRoot(root, <>{createVibeDesignFlow(window.__VIBE_DESIGN_INITIAL__).render()}</>);
}

