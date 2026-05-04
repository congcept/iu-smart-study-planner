# AGENTS.md - Development Guidelines

## Quick Start

```bash
npm run install:all          # Install all workspace deps
npx prisma generate          # From server/ — must run after schema changes
docker-compose up -d         # Start Postgres

cd client && npm run dev     # Frontend on port 5173
cd server && npm run dev     # Backend on port 3001
```

## Essential Commands

### Root (workspace)
- `npm run dev` - Start all workspaces (client + server)
- `npm run build` - Build client + server for production
- `npm run lint` - Lint all packages (zero warnings allowed)
- `npm run typecheck` - Type-check all packages (tsc --noEmit)
- `npm run test` - Run all tests (client Vitest + server Jest)
- `npm run format` - Format all files with Prettier
- `npm run format:check` - Check if files are formatted correctly

### Client (client/)
- `npm run dev` - Vite dev server with hot reload
- `npm run build` - Production build
- `npm run test` - Vitest watch mode
- `npm run test:run` - Vitest single run (use for CI)
- `npm run preview` - Preview production build locally

### Server (server/)
- `npm run dev` - Nodemon hot reload
- `npm run build` - tsc compile to dist/
- `npm run start` - Run built server from dist/index.js
- `npm run test` - Jest test suite
- `npm run test:watch` - Jest watch mode
- `npm run db:migrate` - Run Prisma migrations
- `npm run db:generate` - Generate Prisma client (run after schema changes)
- `npm run db:seed` - Seed database with sample data
- `npm run db:studio` - Open Prisma Studio UI

## Running a Single Test

### Client (Vitest)
- Single file: `cd client && npm run test -- Component.test.tsx`
- By test name: `cd client && npm run test -- --testNamePattern="login logic"`
- Run once (no watch): `cd client && npx vitest run Component.test.tsx`
- With coverage: `cd client && npm run test -- --coverage`

### Server (Jest)
- Single file: `cd server && npx jest health.test.ts`
- By test name: `cd server && npx jest -t "authentication"`
- Watch file: `cd server && npx jest --watch health.test.ts`
- With coverage: `cd server && npm run test -- --coverage`

## Critical Architecture Notes

### Prisma Usage
- Prisma singleton in `server/src/db.ts` uses global to prevent multiple instances during hot reload
- **Always run `npx prisma generate` after schema changes** before starting dev server
- Prisma Studio (`npm run db:studio`) is essential for viewing/editing data

### Shared Types
- All Zod schemas and TypeScript DTOs live in `shared/src/`
- Changes to shared schemas require rebuilding both client and server
- Import pattern: `import { SomeSchema } from '@iu-study-planner/shared'`

### Environment Variables
**Required for local development:**
- Server `.env`: `DATABASE_URL`, `PORT=3001`, `NODE_ENV=development`, `CORS_ORIGIN=http://localhost:5173`, `JWT_SECRET`, `JWT_EXPIRES_IN=7d`
- Client `.env`: `VITE_API_URL=http://localhost:3001/api`

**Never commit `.env` files** - they are gitignored

## Code Style & Conventions

### TypeScript Strictness
- **Strict mode required** - no `any` types anywhere
- Use `interface` for object shapes, `type` for unions/intersections
- **All** API function parameters and return values must be explicitly typed
- Use `unknown` for untyped input, narrow with type guards before accessing properties

### React Patterns
- Always use `useCallback` for functions in `useEffect` dependencies
- **Never** use `eslint-disable-next-line react-hooks/exhaustive-deps`
- Always check `response.success && response.data` before using API responses
- Components use PascalCase, files use PascalCase for components, camelCase otherwise

### API Responses
- All endpoints return `{ success: boolean, data?, error?, message?, details? }`
- Always `return res.json(...)` - don't rely on fallthrough
- Validate all input with Zod from `@iu-study-planner/shared`
- Use `isNotFoundError()` helper for Prisma P2025 errors

### Import Order (critical for consistency)
1. External packages (`axios`, `zod`)
2. Shared workspace (`@iu-study-planner/shared`)
3. Absolute internal (`@/lib/store`, `@routes`, `@services`, `@config`)
4. Relative imports (`./components/Button`)
5. Styles last (client only)

## Database Operations

### Essential Sequence
1. Start PostgreSQL (via `docker-compose up -d` or local instance)
2. In server/: `npx prisma generate`
3. In server/: `npx prisma migrate dev` (or `npx prisma migrate reset` for clean slate)
4. In server/: `npx prisma db seed` (loads sample curriculum data)
5. Start dev servers

### Schema Changes
1. Edit `server/prisma/schema.prisma`
2. Run `npx prisma migrate dev --name <description>`
3. Run `npx prisma generate`
4. Restart dev servers

### Data Safety
- `npx prisma migrate reset` destroys all data - use only in development
- Seed data creates sample user with ID `IT2001001` and completed first-year courses
- Prisma Studio provides safe UI for data inspection

## Testing Gotchas

### Client Testing
- Tests use Vitest with happy-dom DOM implementation
- Mock API calls using `msw` or jest mocks in `__mocks__` directory
- Style-related tests may fail if CSS classes change - focus on behavior

### Server Testing
- Tests use Jest with ts-jest
- Database tests run against actual PostgreSQL (ensure it's running)
- Mock external services (email, etc.) when present

### Running Specific Tests
- Client curriculum graph: `cd client && npm run test -- CurriculumGraph.test.tsx`
- Server workload balancer: `cd server && npx jest workloadBalancer.test.ts`
- API endpoints: Test via supertest in `server/src/routes/__tests__/`

## Common Issues & Fixes

### CORS Errors
- Ensure server `.env` has `CORS_ORIGIN=http://localhost:5173`
- Ensure client calls backend at `http://localhost:3001/api` (via Vite proxy)

### Database Connection Issues
- Verify PostgreSQL is running: `docker ps` should show postgres container
- Check `DATABASE_URL` in server `.env` matches running instance
- Run `npx prisma migrate reset` if schema gets out of sync

### Module Resolution Errors
- After adding shared dependencies, restart dev servers
- Monorepo uses workspace paths (`@iu-study-planner/shared`)
- Ensure you're running commands from correct package directory

### Build Failures
- Run `npm run format` to fix formatting issues before committing
- Delete `node_modules` and reinstall if encountering strange errors
- Check TypeScript version compatibility with Node.js version

## Data Flow Understanding

### Curriculum Graph
1. Client fetches courses from `/api/courses`
2. Graph visualizes nodes (courses) and edges (prerequisites)
3. Status colors: green (completed), blue (in-progress), yellow (available), gray (locked)
4. Clicking nodes selects them for workload analysis

### Recommendation Engine
1. Client sends user ID to `/api/recommendations/user/:userId`
2. Server gets user's completed/in-progress courses
3. Filters available courses (prerequisites met)
4. Applies workload balancing algorithm considering:
   - Course difficulty (1-5 scale)
   - Credit load
   - Course category (REQUIRED > CORE > ELECTIVE)
   - Historical performance
5. Returns optimized course set for next semester

### Workload Analysis
1. Client sends selected course IDs to `/api/recommendations/analyze-workload`
2. Server calculates:
   - Total credits
   - Average difficulty
   - Workload score = (credits × 0.4) + (avg difficulty × credits × 0.6)
   - Risk level: LOW (≤20), MEDIUM (≤35), HIGH (≤50), CRITICAL (>50)
3. Returns recommendations for credit/difficulty balance

## Project-Specific Conventions

### Git Commit Messages
Use conventional commits:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation
- `style:` for formatting changes
- `refactor:` for code restructuring
- `test:` for adding/modifying tests
- `chore:` for build/tooling changes

### File Organization
- Client: `src/features/` contains domain-specific modules (curriculum, planner, etc.)
- Server: `src/routes/` contains API controllers, `src/services/` contains business logic
- Shared: Contains only schemas and DTOs - zero runtime dependencies

### Performance Considerations
- Graph visualization uses React Flow with virtualization for large datasets
- API responses paginated where appropriate (courses, users, etc.)
- Client memoizes expensive computations with `useMemo`/`useCallback`
- Server uses Prisma's efficient relation loading strategies

## Verification Steps Before Committing

1. Run `npm run format` to fix formatting
2. Run `npm run lint` and fix all errors/warnings
3. Run `npm run typecheck` to ensure no TypeScript errors
4. Run `npm run test` to ensure all tests pass
5. Verify functionality manually in dev environment
6. Check that new code follows established patterns in the codebase

## Recent Development Summary

- Implemented elective group detection fix in the course scraper (`scripts/scrapeCourses.js`)
- Created credit validation script (`scripts/validateCredits.js`) to verify course data meets 130 credit requirement
- Added ElectiveSelector component (`client/src/features/planner/components/ElectiveSelector.tsx`) for handling elective course selection
- Updated course data integration tasks to reflect completed work

## Course Data Integration Tasks

These are the specific tasks completed/identified for integrating real HCMIU Computer Science course data:

- [x] Created web scraper for HCMIU Computer Science program page (`scripts/scrapeCourses.js`)
- [x] Parsed course data from HTML tables using cheerio
- [x] Extracted course details: ID, name, credits, lecture/lab hours
- [x] Organized courses by year and semester (1Y1S through 4Y3S)
- [x] Handle elective group selections (implemented selection logic in planner)
- [x] Map courses to existing schema categories (REQUIRED, CORE, ELECTIVE) - based on course codes and descriptions
- [x] Create data validation script to ensure credit totals match program requirements (130 credits)
- [x] Generate Prisma-compatible course data format
- [x] Create database seed script with real course data (to replace mocked data)
- [x] Infer prerequisite relationships from course sequencing (based on year/progression)
- [x] Test data extraction with actual website (successfully extracted 93 unique courses)

These steps prevent the most common integration issues and maintain code quality.