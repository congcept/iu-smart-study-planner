# AGENTS.md - Development Guidelines

## Quick Start

```bash
npm run install:all          # Install all workspace deps
npx prisma generate          # From server/ — must run after schema changes
docker-compose up -d         # Start Postgres

npm run dev                  # Start all workspaces (client + server)
```

## Essential Commands

### Root (workspace)
- `npm run dev` - Start all workspaces (client on 5173, server on 3001)
- `npm run build` - Build client + server for production
- `npm run lint` - Lint all packages (zero warnings allowed)
- `npm run typecheck` - Type-check all packages (tsc --noEmit)
- `npm run test` - Run all tests (client Vitest + server Jest)
- `npm run format` - Format all files with Prettier

### Server (server/)
- `npm run db:migrate` - Run Prisma migrations
- `npm run db:generate` - Generate Prisma client (run after schema changes)
- `npm run db:seed` - Seed database with sample data
- `npm run db:studio` - Open Prisma Studio UI

## Database Setup Sequence

1. Start PostgreSQL (`docker-compose up -d`)
2. In `server/`: `npx prisma generate`
3. In `server/`: `npx prisma migrate dev` (or `npx prisma migrate reset` for clean slate)
4. In `server/`: `npx prisma db seed`
5. Start dev servers

**Never commit `.env` files** — they are gitignored.

## Architecture

- **Monorepo** with workspaces: `client/`, `server/`, `shared/`
- **Single-page app**: `App.tsx` renders only `CurriculumProgressMap` — no sidebar, tabs, or planner pages
- **State**: Zustand store (`client/src/lib/store.ts`) with localStorage persistence
  - `completedIds`: `Record<string, string | null>` — maps courseId → electiveGroup name (or null for non-elective)
  - `plannedIds`: `string[]`
- **API**: Express backend with Zod validation, returns `{ success, data?, error? }`
- **Shared types**: All Zod schemas and TypeScript DTOs in `shared/src/` — changes require rebuilding both client and server
- **Prisma**: Singleton in `server/src/db.ts` uses `global` to prevent multiple instances during hot reload

## Key Conventions

### Completed Credits
- `PT001IU` (Physical Training 1) and `PT002IU` (Physical Training 2) are required but **do not count** toward completed credits
- They **do count** toward planned credits and semester planning

### Elective Groups
- Courses can appear in multiple elective groups (e.g., IT160IU in both Group 2 and Group 3)
- A completed course is **claimed** by the group where it was clicked (stored in `completedRecord[courseId]`)
- Completed courses are **hidden** from other groups where they appear as duplicates

### GPA Paths (Year 4 Semester 2)
- GPA > 70: shows only Thesis (IT058IU), hides other Y4S2 courses — target = 41 remaining courses
- GPA <= 70: shows all Y4S2 courses except Thesis — target = 43 remaining courses
- Toggle lives under the Y4S2 column header, affects only that column

### Degree Progress
- Calculated as `completedIdKeys.length / target * 100` (not from API)
- Target is 41 or 43 depending on GPA mode
- Remaining courses = target minus completed count

### Type Safety
- **Strict mode** — no `any` types
- **Never** use `eslint-disable-next-line react-hooks/exhaustive-deps`
- Always use `useCallback` for functions referenced in `useEffect` dependencies

### Import Order
1. External packages
2. Shared workspace (`@iu-study-planner/shared`)
3. Absolute internal (`@/lib/store`, `@/components`, etc.)
4. Relative imports
5. Styles last (client only)

## Testing

- Client: Vitest with happy-dom. Run single file: `cd client && npx vitest run path/to/test.tsx`
- Server: Jest with ts-jest against real PostgreSQL. Run single file: `cd server && npx jest filename.test.ts`

## Common Issues

- **Docker compose errors**: Container name conflicts — run `docker stop isp-postgres && docker rm isp-postgres` first
- **Stuck on "Loading curriculum"**: Usually means the `fetchCurriculum` useEffect was accidentally deleted or the server isn't running
- **ElectiveSelector errors**: `client/src/features/planner/components/ElectiveSelector.tsx` has pre-existing type errors — ignore for now, component is unused
- **Typecheck warnings**: `unused variable` errors in CurriculumProgressMap are acceptable (legacy imports, unused handlers)
- **Prisma P2025 errors**: Use `isNotFoundError()` helper to handle "record not found"

## Git Workflow

- Conventional commits: `feat:`, `fix:`, `style:`, `refactor:`, `test:`, `chore:`
- Do not commit/push unless explicitly instructed
- Push to `main` when asked
