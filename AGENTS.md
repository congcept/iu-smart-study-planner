# AGENTS.md - Development Guidelines

## Quick Start

```bash
npm run install:all          # Install all workspace deps
npx prisma generate          # From server/ — must run after schema changes
docker-compose up -d         # Start Postgres

cd client && npm run dev     # Frontend on port 5173
cd server && npm run dev     # Backend on port 3001
```

## Commands

### Root (workspace)

```bash
npm run dev              # Start all workspaces
npm run build            # Build client + server
npm run lint             # Lint all packages
npm run typecheck        # tsc --noEmit on all packages
npm run test             # Run all tests (server + client)
npm run format           # Prettier write
npm run format:check     # Prettier check
```

### Client (`client/`)

```bash
npm run dev              # Vite dev server
npm run build            # Production build
npm run lint             # ESLint (zero warnings allowed)
npm run typecheck        # tsc --noEmit
npm run test             # Vitest watch mode
npm run test:run         # Vitest single run
npm run preview          # Preview production build
```

### Server (`server/`)

```bash
npm run dev              # Nodemon hot reload
npm run build            # tsc compile
npm run start            # Run dist/index.js
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run test             # Jest run
npm run test:watch       # Jest watch mode
npm run db:migrate       # Prisma migrate dev
npm run db:generate      # Prisma generate
npm run db:seed          # Run seed script
npm run db:studio        # Prisma Studio UI
```

## Running a Single Test

```bash
# Client — single file
cd client && npm run test -- Button.test.tsx

# Client — single test by name
cd client && npm run test -- --testNamePattern="renders with icon"

# Client — run once (no watch)
cd client && npx vitest run Button.test.tsx

# Server — single file
cd server && npx jest health.test.ts

# Server — single test by name
cd server && npx jest -t "returns 200"

# Server — watch a single file
cd server && npx jest --watch health.test.ts
```

## Code Style

### TypeScript

- **Strict mode required** — no `any` types, ever
- Use `interface` for objects, `type` for unions/intersections
- All API function parameters and return values must be explicitly typed
- Prefer Prisma-generated types over manual type annotations in callbacks
- Use `unknown` for untyped input, narrow with type guards before access

### Imports (ordered, grouped with blank lines)

```typescript
// 1. External packages
import axios from 'axios';
import { z } from 'zod';

// 2. Shared workspace
import { CreateCourseSchema } from '@iu-study-planner/shared';

// 3. Absolute internal (client: @/, server: @routes, @services, @config)
import { useAppStore } from '@/lib/store';

// 4. Relative imports
import { Button } from './ui';

// 5. Styles last (client only)
import './styles.css';
```

### Naming

- **Components**: PascalCase (`CurriculumGraph`, `ErrorBoundary`)
- **Functions/variables**: camelCase (`handleClick`, `fetchProgress`)
- **Constants**: UPPER_SNAKE_CASE (`API_BASE_URL`)
- **Interfaces/types**: PascalCase (`ApiResponse`, `CourseNodeData`)
- **Files**: PascalCase for React components, camelCase for everything else
- **Prisma error helper**: `isNotFoundError(error: unknown): boolean`

### React Components

```typescript
interface Props {
  userId: string;
  onAddToPlan?: (course: Course) => void;
}

export const Recommendations: React.FC<Props> = ({ userId, onAddToPlan }) => {
  const [data, setData] = useState<Recommendation | null>(null);

  const fetchData = useCallback(async () => {
    const response = await getRecommendations(userId);
    if (response.success && response.data) {
      setData(response.data);
    }
  }, [userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ...
};
```

- Use `useCallback` for functions referenced in `useEffect` deps — never use `eslint-disable-next-line react-hooks/exhaustive-deps`
- Always check `response.success && response.data` before using API responses

### API Routes (Server)

```typescript
router.post('/', async (req: Request, res: Response) => {
  try {
    const validatedData = CreateCourseSchema.parse(req.body);
    const course = await prisma.course.create({ data: validatedData });
    return res.status(201).json({ success: true, data: course });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ success: false, error: 'Validation error', details: error.errors });
    }
    if (isNotFoundError(error)) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    console.error('Context:', error);
    return res.status(500).json({ success: false, error: 'Descriptive message' });
  }
});
```

- Always `return res.json(...)` — don't rely on fallthrough
- Validate all input with Zod schemas from `@iu-study-planner/shared`
- Use `isNotFoundError()` helper (import from `@prisma/client/runtime/library`) for Prisma P2025 errors
- Consistent response: `{ success: boolean, data?, error?, message?, details? }`

### Error Handling

- try/catch on all async operations
- Zod validation at every API boundary
- Prisma errors: use `PrismaClientKnownRequestError` from `@prisma/client/runtime/library`
- Client: check `response.success && response.data` before consuming
- Wrap top-level app in `<ErrorBoundary>` (client)

### Formatting

- 2-space indentation
- Single quotes, semicolons required
- 100 char line limit
- Trailing commas in multi-line
- Run `npm run format` before committing

### Git Commits

```
feat: add user authentication
fix: resolve course query bug
docs: update API documentation
style: fix indentation
refactor: simplify workload algorithm
test: add user service tests
chore: update dependencies
```

## Environment Variables

**Client (`.env`)**: `VITE_API_URL=http://localhost:3001/api`
**Server (`.env`)**: `DATABASE_URL`, `PORT=3001`, `NODE_ENV`, `CORS_ORIGIN`, `JWT_SECRET`, `JWT_EXPIRES_IN`

Never commit `.env` files.

## Project Structure

```
client/src/
  components/       # Reusable UI (ErrorBoundary, ui/*)
  features/         # Feature modules (curriculum, planner, progress, recommendations)
  lib/              # api.ts, store.ts, utils.ts
  types/            # TypeScript definitions

server/src/
  config/           # Environment config
  routes/           # Express route handlers
  services/         # Business logic (workloadBalancer)
  db.ts             # Prisma singleton
  index.ts          # App entry

shared/src/
  schemas/          # Zod validation schemas
  dto/              # Inferred TypeScript types + ApiResponse

prisma/
  schema.prisma     # Database schema
  seed.ts           # Seed data
  migrations/       # Committed migration SQL
```

## Key Conventions

- **Shared types first** — define Zod schemas in `shared/`, infer DTOs, consume in client + server
- **No `Record<string, unknown>`** — use typed DTOs from shared for all API mutations
- **ApiResponse<T>** — all API functions return this; `data` is optional, always check before use
- **Prisma singleton** — `server/src/db.ts` uses global to prevent multiple instances during hot reload
- **Graceful shutdown** — server handles SIGTERM/SIGINT, disconnects Prisma
