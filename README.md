# MKJ App

An internal operations app for managing purchase orders, packing slips, inventory, manufacturing (build requests), and shipping tickets — replacing manual, paper-based processes with a single system for warehouse managers, project managers, engineers, and admins.

## Tech Stack

- **Frontend**: React 19, TanStack Start / TanStack Router, Vite, TypeScript
- **UI**: Tailwind CSS v4, shadcn/ui (Radix UI primitives), Lucide icons
- **Data & forms**: TanStack Query, React Hook Form, Zod
- **Backend**: [Supabase](https://supabase.com) — Postgres database, authentication, storage, Row Level Security, and Edge Functions (PDF generation for POs and shipping tickets)
- **Hosting**: Vercel
- **Package manager**: [Bun](https://bun.sh)

## Development

You'll need [Bun](https://bun.sh) installed.

```sh
git clone <this-repository-url>
cd mkj-app
bun install
bun run dev
```

Environment variables (Supabase URL and publishable key) are required — see `.env.local` for local development.

## Other scripts

```sh
bun run build      # production build
bun run lint        # lint
bun run format      # format with prettier
bun run emails       # build branded auth email templates from supabase/templates/
```
