# BFD-setter — Frontend

Vite + React + TypeScript + Tailwind + shadcn/ui admin dashboard for the BFD-setter codebase (which powers BFD's **Building Flow** AI appointment-setter platform).

Repo root: `/srv/bfd/Projects/bfd-setter/` (back-compat symlink at `/srv/bfd/Projects/1prompt-os/`). Canonical project README: [`../README.md`](../README.md). Deployment topology + Railway env reference: [`../Docs/RUNBOOK.md`](../Docs/RUNBOOK.md) and [`../Docs/RAILWAY_ENV.md`](../Docs/RAILWAY_ENV.md).

## Local development

```sh
# From this directory
pnpm install
pnpm run dev    # serves http://localhost:8080 (port set in vite.config.ts)
```

For typecheck before commit:

```sh
npx tsc --noEmit
```

## Production

The frontend deploys to **Railway** service `1prompt-os-production` on every push to `main`. Build command: `vite build`. Start command: `npx serve dist -s`. There is no `Dockerfile`; Railway uses nixpacks auto-detection. Required environment variables are documented in [`../Docs/RAILWAY_ENV.md`](../Docs/RAILWAY_ENV.md).

## Stack notes

- Vite 5 with `@vitejs/plugin-react-swc`
- Path alias `@/*` → `./src/*` (configured in `vite.config.ts` + `tsconfig.app.json`)
- Supabase JS client (`@supabase/supabase-js`) for both auth and DB access
- TanStack Query for server state
- shadcn/ui for primitives (built on Radix)

## Upstream

This frontend is BFD's fork of `genokadzin/1prompt-os`. The repo was originally scaffolded with the Lovable AI builder; some legacy asset paths under `/lovable-uploads/` remain but no production runtime depends on Lovable. See the project root's [`README.md`](../README.md) for full upstream attribution.
