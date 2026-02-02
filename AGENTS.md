# AGENTS.md - Development Guidelines

## Quick Start

```bash
# Start all services
docker-compose up -d

# Frontend only
cd client && npm run dev        # Port 5173

# Backend only
cd server && npm run dev        # Port 3001
```

## Build Commands

### Client
```bash
npm run dev          # Dev server
npm run build        # Production build
npm run lint         # ESLint check
npm run preview      # Preview build
```

### Server
```bash
npm run dev          # Dev with hot reload
npm run build        # Compile TypeScript
npm run start        # Run compiled
npm run db:migrate   # Prisma migrate
npm run db:seed      # Seed data
npm run db:studio    # Prisma Studio
```

## Testing

**Test framework not configured yet. Recommended setup:**

```bash
# Client - Vitest
npm install -D vitest @testing-library/react @testing-library/jest-dom
# Add to package.json scripts:
"test": "vitest"
"test:run": "vitest run"

# Server - Jest
npm install -D jest @types/jest ts-jest supertest
# Add to package.json scripts:
"test": "jest"
"test:watch": "jest --watch"
```

**Run tests once configured:**
```bash
npm run test                      # All tests
npm run test -- Component.test.tsx   # Single file
npm run test -- --testNamePattern="test name"  # Single test
```

## Code Style

### TypeScript
- **Strict mode required** - No `any` types
- Define interfaces for all data structures
- Use `type` for unions, `interface` for objects

### Imports (Ordered)
```typescript
// 1. External
import React from 'react';
import express from 'express';

// 2. Internal absolute
import { useStore } from '@/lib/store';
import { config } from '@config/index';

// 3. Relative
import { Button } from './ui';
import { helper } from '../utils';

// 4. Styles last
import './styles.css';
```

### Naming
- **Components**: PascalCase (`CurriculumGraph`)
- **Functions/vars**: camelCase (`handleClick`)
- **Constants**: UPPER_SNAKE_CASE (`API_URL`)
- **Interfaces**: PascalCase (`UserData`)
- **Files**: PascalCase components, camelCase utils

### React Components
```typescript
interface Props {
  title: string;
}

const Component: React.FC<Props> = ({ title }) => {
  const [count, setCount] = useState<number>(0);
  
  const handleClick = useCallback(() => {
    setCount(c => c + 1);
  }, []);
  
  return <div>{title}</div>;
};
```

### API Routes (Server)
```typescript
// Consistent response format
try {
  const data = await service.getData();
  res.json({ success: true, data });
} catch (error) {
  console.error('Context:', error);
  res.status(500).json({ 
    success: false, 
    error: 'Descriptive message' 
  });
}
```

### Error Handling
- Always use try/catch for async operations
- Validate with Zod at API boundaries
- Log errors with context on backend
- Return structured error responses

### Comments
- **Minimal** - Only explain complex logic
- Explain "why" not "what"
- Use JSDoc for public APIs only

### Formatting
- 2 spaces indentation
- Single quotes
- Semicolons required
- 100 char line limit
- Trailing commas in multi-line

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

**Client (.env)**
```
VITE_API_URL=http://localhost:3001/api
```

**Server (.env)**
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/iu_study_planner
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
JWT_SECRET=your-secret-key
```

**Security**: Never commit .env files!

## Project Structure

```
client/src/
  components/     # Reusable UI
  features/       # Feature modules
  lib/           # Utils, API, store
  types/         # TypeScript defs

server/src/
  config/        # Configuration
  routes/        # API handlers
  services/      # Business logic
  
prisma/
  schema.prisma  # DB schema
  seed.ts       # Seed data
```
