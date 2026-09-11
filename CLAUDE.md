# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Vad kostar nollan?** — a Swedish crowdsourced map for finding alcohol-free (NA) beer prices at bars and restaurants. Users submit prices, report missing NA beer, and flag incorrect entries. Admins moderate via a protected panel.

## Commands

```bash
npm run dev      # Start dev server (localhost:3000)
npm run build    # Production build
npm run lint     # ESLint
```

No test suite is configured.

## Architecture

**Stack**: Next.js 15 App Router · React 19 · TypeScript · Tailwind CSS 4 · MapLibre GL · Supabase (PostgreSQL)

### Key files

| Path | Role |
|------|------|
| `app/page.tsx` | Main map page — MapLibre rendering, price markers, submission UI |
| `app/admin/page.tsx` | Admin moderation panel (protected by HTTP Basic Auth) |
| `app/layout.tsx` | Root layout |
| `middleware.ts` | HTTP Basic Auth guard for `/admin/*` and `/api/admin/*` |
| `lib/tableNames.ts` | Switches between demo and production Supabase tables |
| `api/price/route.ts` | POST — submit new price (validates 10–150 kr, hashes IP) |
| `api/report-wrong-price/route.ts` | POST — soft-delete latest price for a bar |
| `api/no-na/route.ts` | POST — flag bar as having no NA beer |
| `api/admin/*` | Protected CRUD + audit routes |

### Data model (Supabase)

- **bars / bars_demo** — location records (id, name, lat, lng, source, source_id, no_na_beer)
- **prices / prices_demo** — price records with soft deletes (deleted_at nullable). Each row has a `category` (`na_beer` | `soda` | `na_wine` | `other`, default `na_beer`) and an optional `beverage_name`.
- **audit_events** — every user action logged with hashed IP + user agent

### Demo vs production

`lib/tableNames.ts` returns either real or `_demo`-suffixed table names. The admin panel has a toggle; API routes read an `isDemoMode` flag.

### Price color coding

≤35 kr → green · 36–45 kr → yellow · >45 kr → red

## Planned features

- Future: statistics view showing where specific named beverages are cheapest across all locations.

## Implemented features

- **Multiple beverages per location** — Users can submit multiple non-alcoholic beverage entries per bar/restaurant. Each entry has a price (required, 10–150 kr), a category (Öl / Läsk / Vin / Övrigt, default Öl), and an optional free-text name (e.g. "Carlsberg 0,0%", "Mikkeller Drink'in the Sun", "Red Bull").
  - Names are optional; shown as the category label if blank.
  - When a name has been submitted 2+ times within a given category it appears as an autocomplete suggestion (HTML5 `<datalist>`), scoped by category.
  - Map markers show the **lowest** active NA-beer price per bar. Bars whose only entries are soda/NA wine/other render as an unpriced dot — their entries are still visible in the detail panel, grouped by category.
  - Each beverage row has a ✎ button to edit and a × button to report/remove a wrong entry.
  - DB migrations: `supabase/migrations/add_beverage_name.sql` + `supabase/migrations/add_beverage_category.sql`.
  - API route: `GET /api/beverage-names?category=<category>` — returns names used 2+ times within that category.

## Environment variables

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_MAPTILER_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_USER=
ADMIN_PASSWORD=
ADMIN_REALM=
IP_HASH_SALT=

# Sentry — optional. Errors only go to Sentry when the DSN is set.
NEXT_PUBLIC_SENTRY_DSN=
# Build-time only, for source-map upload (skip if you're fine with minified stacks):
SENTRY_ORG=
SENTRY_PROJECT=
SENTRY_AUTH_TOKEN=
```
