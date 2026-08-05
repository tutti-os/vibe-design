# Vibe Design Tutti Local Debug App

This directory is a thin Tutti local-debug wrapper for the source repository
at `../..`. It owns only the local manifest, icon, and development bootstrap.

- Load this directory, not the repository root, with Tutti's local app loader.
- Keep the production `tutti.app.json` and `bootstrap.sh` unchanged.
- Use the host-managed Node runtime and Corepack supplied by Tutti.
- Source changes under `server/` and `web/` must rebuild automatically.
- Changes inside this wrapper require Tutti's Retry/Reload action.
