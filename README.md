# IU Smart Study Planner (ISP)

A web application that visualizes the Computer Science curriculum at International University (IU), VNU-HCMC as an interactive semester-column graph, letting students track completion, plan courses, and manage degree progress.

Built as a pre-thesis project for the Bachelor of Computer Science program at International University, VNU-HCMC.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Stability & Run Guide](#stability--run-guide)
- [Development Setup](#development-setup)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Contributing](#contributing)
- [License](#license)

## Overview

Students planning their degrees usually rely on static PDF flowcharts to figure out course prerequisites and semester loads. This often leads to missed prerequisites, unbalanced semesters, and delayed graduation.

The IU Smart Study Planner addresses this by providing an **interactive semester-column curriculum view** where users can click to mark courses as complete, right-click to plan them, browse elective groups via a sidebar, toggle auto-recommendations, and switch between GPA-based thesis paths — all with pan/zoom navigation and synthesized audio feedback.

## Features

### Interactive Semester-Column Curriculum View

Courses are organized into columns by academic year and semester (Year 1–4, Fall/Spring/Summer). Each course is rendered as a card color-coded by status: **DONE** (green), **PLANNED** (blue), **NEXT** (amber, unlocked), or **LOCKED** (gray, prerequisites not met). The canvas supports drag-to-pan, scroll-to-zoom, and reset.

### Course Completion & Planning

- **Left-click** a course to mark it complete (with ascending arpeggio sound)
- **Right-click** a completed course to uncomplete it and add to planned list
- **Right-click** an uncompleted course to toggle planned status
- Uncompleting a course triggers a **BFS cascade**: all transitively dependent completed courses are also uncompleted — ensuring the prerequisite graph stays consistent.

### Elective Group Sidebar

Elective courses are shown as group-summary cards within their semester column. Clicking a group opens a 160px sidebar showing individual courses in that group. A completed course is **claimed** by the group where it was clicked and hidden from duplicate entries in other groups. The graph only rescales when the sidebar opens/closes (not when switching groups while already open).

### GPA-Based Thesis Path (Year 4 Semester 2)

A toggle under the Y4S2 column header switches between:
- **GPA > 70**: Shows only the Thesis course (IT058IU), hides all other Y4S2 courses — degree target: 41 courses
- **GPA ≤ 70**: Shows all Y4S2 courses except Thesis — degree target: 43 courses

### Auto-Recommendations

Toggle recommendations on to highlight the next best courses to take. An intensity slider (Low/Normal/High/Max) controls the credits-per-semester budget (9/15/18/21). Recommendations filter by unlocked prerequisites and respect GPA mode.

### Degree Progress Bar

When progress data is available, a liquid-animated progress bar shows `completed / target * 100` alongside an ETA estimate (semesters remaining based on credits and intensity mode).

### Prerequisite Highlighting

Hovering over a locked course shows a tooltip listing its unmet prerequisites and highlights those prerequisite cards across the graph.

### Sound Effects

Distinct synthesized tones (Web Audio API) for every interaction: complete (ascending arpeggio), uncomplete (descending), plan, unplan, locked-click, and toggle sounds.

### Smart Course Recommendations (API)

The backend recommendation engine scores available courses by category priority (REQUIRED > CORE > MAJOR_ELECTIVE), unlock potential, difficulty, and user history. It supports workload analysis, prerequisite chain traversal, and full multi-semester planning across 4 intensity modes.

## Tech Stack

### Frontend

- **Framework:** React 18.2 with TypeScript (Strict Mode)
- **Build Tool:** Vite 5.0
- **Styling:** Tailwind CSS 3.3
- **State Management:** Zustand 4.4 (with localStorage persistence)
- **Graph Visualization:** React Flow (@xyflow/react 12.0) + dagre auto-layout
- **Icons:** Lucide React
- **HTTP Client:** Axios 1.6
- **Routing:** react-router-dom 6.20 (available but unused — single-page app)
- **Testing:** Vitest 4.x with happy-dom / jsdom

### Backend

- **Runtime:** Node.js 20
- **Framework:** Express.js 4.18
- **Language:** TypeScript 5.2 (Strict Mode)
- **ORM:** Prisma 5.6
- **Validation:** Zod 3.22 (schemas shared via workspace)
- **Database:** PostgreSQL 15
- **Testing:** Jest 30.x with ts-jest and Supertest (against real PostgreSQL)

### Shared

- **Workspace:** `@iu-study-planner/shared` — Zod schemas + inferred TypeScript DTOs
- **Build:** TypeScript compiled to `dist/`; client and server import from compiled output

### DevOps

- **Containerization:** Docker & Docker Compose (PostgreSQL, backend, frontend)
- **Development:** Nodemon (server hot-reload), Vite HMR (client)
- **Linting:** ESLint (strict, no `any`), Prettier (auto-format)

## Project Structure

```
iu-smart-study-planner/
├── client/                         # Frontend (Vite + React)
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/                 # Reusable primitives (Button, Card, Badge, etc.)
│   │   │   └── ErrorBoundary.tsx   # React error boundary with retry
│   │   ├── features/
│   │   │   ├── curriculum/         # Main feature: semester-column view + graph
│   │   │   ├── planner/            # Workload analyzer + elective selector
│   │   │   ├── progress/           # Progress dashboard (unused in main app)
│   │   │   └── recommendations/    # Course recommendations list (unused in main app)
│   │   ├── lib/                    # API client, Zustand store, utils, sounds
│   │   └── types/                  # TypeScript type definitions
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── Dockerfile
│
├── server/                         # Backend (Express + Prisma)
│   ├── src/
│   │   ├── config/                 # Environment config
│   │   ├── routes/                 # API route handlers (courses, users, studyPlans, recommendations)
│   │   ├── services/               # Business logic (workloadBalancer, semesterPlanner)
│   │   ├── __tests__/              # Jest tests
│   │   ├── index.ts                # Server entry point
│   │   └── db.ts                   # Prisma singleton
│   ├── prisma/
│   │   ├── schema.prisma           # Database schema (6 models, 3 enums)
│   │   └── seed.ts                 # Seed script (86 courses, sample user, sample plan)
│   ├── scraped-courses.json        # Raw scraped curriculum data
│   ├── package.json
│   └── Dockerfile
│
├── shared/                         # Shared Zod schemas & TypeScript DTOs
│   └── src/
│       ├── schemas/                # 13 Zod schemas + 3 enum schemas
│       ├── dto/                    # Inferred TypeScript types
│       └── index.ts                # Barrel export
│
├── scripts/                        # Web scraping & validation utilities
│   ├── scrapeCourses.js            # Axios + Cheerio scraper for HCMIU website
│   ├── validateCredits.js          # Validates scraped data against 130-credit requirement
│   └── debug*.js                   # Incremental debugging scripts
│
├── documentation/thesis/           # LaTeX thesis source & compiled PDF
├── docker-compose.yml              # PostgreSQL + backend + frontend orchestration
├── AGENTS.md                       # Development guidelines & conventions
├── scraped-courses.json            # Source curriculum data at repo root
└── README.md                       # This file
```

## Quick Start

### Prerequisites

- Docker Desktop (recommended) or Docker Engine with Docker Compose
- Node.js 20 or later (for local development without Docker)

### Option 1: Docker Compose (Recommended)

```bash
# Start all services (PostgreSQL, backend, frontend)
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

Services will be available at:

| Service   | URL                          |
|-----------|------------------------------|
| Frontend  | http://localhost:5173         |
| Backend   | http://localhost:3001/api     |
| Health    | http://localhost:3001/api/health |
| Database  | localhost:5432                |

The Docker setup automatically runs Prisma migrations and seeds the database on first start.

### Option 2: Manual Setup

**1. Start PostgreSQL:**

```bash
docker run -d \
  --name isp-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=iu_study_planner \
  -p 5432:5432 \
  postgres:15-alpine
```

**2. Install dependencies (from repo root):**

```bash
npm run install:all
```

**3. Build shared schemas:**

```bash
cd shared && npm run build && cd ..
```

**4. Set up the database:**

```bash
cd server
npx prisma generate
npx prisma migrate dev --name init
npx prisma db seed
```

**5. Start the backend:**

```bash
cd server
npm run dev
```

**6. Start the frontend (in a separate terminal):**

```bash
cd client
npm run dev
```

## Stability & Run Guide

### Pre-flight checks

- Node.js version: `node -v` (recommended 20 or later)
- Docker daemon running (for compose): `docker info`
- Environment files exist:
  - `server/.env` with `DATABASE_URL`, `PORT`, `CORS_ORIGIN`
  - `client/.env` with `VITE_API_URL=http://localhost:3001/api`

### Local quality gates

```bash
# Install all dependencies
npm run install:all

# Shared schemas must be built first
cd shared && npm run build && cd ..

# Type-check all workspaces
npm run typecheck

# Lint all workspaces
npm run lint

# Run all tests (server Jest first, then client Vitest)
npm run test
```

All commands should exit with code 0.

### Start with Docker (preferred)

```bash
docker-compose up -d
docker-compose logs -f
```

Verify the frontend at http://localhost:5173 and backend health at http://localhost:3001/api/health.

Stop with `docker-compose down`. Reset the database with `docker-compose down -v`.

### Start locally (without compose)

1. Start PostgreSQL (Docker or local service)
2. Build shared: `cd shared && npm run build && cd ..`
3. Start backend: `cd server && npm run dev`
4. Start frontend (separate terminal): `cd client && npm run dev`

### Functional smoke checklist

- `GET /api/health` returns 200 with `{ status: "ok" }`
- Main page loads with semester-column curriculum view
- Course cards render with correct status colors
- Clicking a course toggles completion state with sound effect
- Right-clicking toggles planned state
- Hovering a locked course shows prerequisite tooltip
- Elective group sidebar opens on click
- GPA toggle switches Y4S2 view
- Recommendations toggle highlights suggested courses

### Common issues and fixes

- **Docker daemon unavailable**
  - Fix: Open Docker Desktop and wait for the engine to start, then retry.

- **Stuck on "Loading curriculum"**
  - Usually means the `fetchCurriculum` useEffect was accidentally deleted or the server isn't running.
  - Check that the backend responds at `http://localhost:3001/api/health`.

- **CORS errors in browser**
  - Make sure `server/.env` has `CORS_ORIGIN=http://localhost:5173`.

- **Database relation or migration errors**
  - Re-run `npx prisma generate`, then `npx prisma migrate dev`, then `npx prisma db seed`.
  - To reset: `npx prisma migrate reset` (clears all data).

- **"Record not found" (Prisma P2025)**
  - Use the `isNotFoundError()` helper — this is expected in toggle operations.

- **Shared types not updating**
  - After changing `shared/src/`, run `npm run build` in `shared/`. Client/server import from compiled `dist/`.

- **Container name conflicts**
  - Run `docker stop isp-postgres && docker rm isp-postgres` first.

## Development Setup

### Environment Variables

**Server `.env`** (create in `server/`):

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/iu_study_planner
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
```

**Client `.env`** (create in `client/`):

```env
VITE_API_URL=http://localhost:3001/api
```

### Database Operations

```bash
cd server

# Run migrations
npm run db:migrate

# Generate Prisma client (after schema changes)
npm run db:generate

# Seed database
npm run db:seed

# Open Prisma Studio (visual browser)
npm run db:studio

# Reset database (deletes all data)
npx prisma migrate reset
```

### Available Scripts

**Root workspace:**

```bash
npm run dev          # Start all workspaces (client + server)
npm run install:all  # Install all workspace dependencies
npm run build        # Build client + server for production
npm run lint         # Lint all packages (zero warnings)
npm run typecheck    # Type-check all packages (tsc --noEmit)
npm run test         # Run all tests (server first, then client)
npm run format       # Format all files with Prettier
```

**Server (`server/`):**

```bash
npm run dev           # Start with hot-reload (nodemon)
npm run build         # Build for production
npm run start         # Start production server
npm run test          # Run Jest tests
npm run db:migrate    # Run Prisma migrations
npm run db:generate   # Generate Prisma client
npm run db:seed       # Seed database
npm run db:studio     # Open Prisma Studio
```

**Client (`client/`):**

```bash
npm run dev           # Start Vite dev server
npm run build         # Build for production
npm run preview       # Preview production build locally
npm run lint          # Run ESLint
npm run test:run      # Run Vitest tests
```

**Shared (`shared/`):**

```bash
npm run build         # Compile Zod schemas/DTOs to dist/
npm run dev           # Watch mode (tsc --watch)
```

### Shared Schemas & Validation

All Zod validation schemas and TypeScript DTOs live in the `shared/` workspace to keep types consistent across client and server.

To create a new shared schema:
1. Export the Zod schema in `shared/src/schemas/index.ts`
2. Infer the TypeScript type and export the DTO in `shared/src/dto/index.ts`
3. Run `npm run build` in the `shared/` directory to compile changes
4. Import from `@iu-study-planner/shared` in client or server:

```ts
import { MyNewSchema, MyNewDTO } from '@iu-study-planner/shared';
```

## API Documentation

### Base URL

```
http://localhost:3001/api
```

All responses follow the envelope format:

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

### Endpoints

**Health:**

```
GET /health
```

**Courses:**

```
GET    /courses                              # List all courses (with prerequisites)
GET    /courses/curriculum                   # Get curriculum grouped by year/semester
GET    /courses/:id                          # Get course details
POST   /courses                              # Create course
PUT    /courses/:id                          # Update course
DELETE /courses/:id                          # Delete course
POST   /courses/prerequisites                # Add prerequisite relationship
DELETE /courses/prerequisites/:id            # Remove prerequisite
```

**Users:**

```
GET    /users                                # List all users
GET    /users/:id                            # Get user details (with stats, records, GPA)
POST   /users                                # Create user
GET    /users/:id/records                    # Get student records
POST   /users/:id/records                    # Add/update student record (upsert)
POST   /users/:id/records/toggle             # Toggle course status (COMPLETED/PLANNED)
GET    /users/:id/progress                   # Get degree progress breakdown
```

**Study Plans:**

```
GET    /study-plans/user/:userId             # List user's study plans
GET    /study-plans/:id                      # Get plan details with semesters
POST   /study-plans                          # Create study plan (deactivates others)
POST   /study-plans/:id/semesters            # Add semester (auto-calculates credits)
PUT    /study-plans/:planId/semesters/:semesterId  # Update semester
DELETE /study-plans/:planId/semesters/:semesterId  # Remove semester
DELETE /study-plans/:id                      # Delete study plan
```

**Recommendations:**

```
GET    /recommendations/user/:userId         # Get ranked course recommendations
POST   /recommendations/analyze-workload     # Analyze workload for a set of courses
GET    /recommendations/prerequisite-chain/:courseId  # Get prerequisite + dependent chains
POST   /recommendations/plan-semester        # Generate multi-semester plan
```

### Query Parameters

- `GET /recommendations/user/:userId?semester=SPRING&year=2025&maxCredits=15&maxDifficulty=3.5`
- `POST /recommendations/plan-semester` body: `{ intensityMode: "low"|"normal"|"high"|"max", completedCourseIds?: string[] }`

## Database Schema

### Models

**Course** (`courses`)
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| code | String | Unique (e.g., "IT064IU") |
| name | String | Course name |
| credits | Int | Credit hours |
| difficultyLevel | Int | 1–5 |
| category | Enum | REQUIRED, CORE, ELECTIVE, MAJOR_ELECTIVE, GENERAL_EDUCATION, FREE_ELECTIVE |
| semesterOffered | Enum[] | FALL, SPRING, SUMMER |
| academicYear | Int? | 1–4 |
| academicSemester | Int? | 1–3 |
| electiveGroup | String? | Group name for elective courses |
| electiveSelectCount | Int? | Number to select from group |

**Prerequisite** (`prerequisites`)
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| courseId | UUID | FK → Course |
| prerequisiteId | UUID | FK → Course |
| isCorequisite | Boolean | Can be taken concurrently |
| isStrict | Boolean | Must be completed before |

Unique constraint on `(courseId, prerequisiteId)`.

**User** (`users`)
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| studentId | String | Unique |
| name | String | |
| email | String | Unique |
| major | String? | |
| enrollmentYear | Int? | |
| targetGraduationYear | Int? | |

**StudentRecord** (`student_records`)
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| userId | UUID | FK → User |
| courseId | UUID | FK → Course |
| grade | String? | e.g., "A", "B+" |
| gradePoints | Float? | 0.0–4.0 |
| semester | String? | |
| year | Int? | |
| status | Enum | PLANNED, IN_PROGRESS, COMPLETED, FAILED, DROPPED |

Unique constraint on `(userId, courseId)`.

**StudyPlan** (`study_plans`)
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| userId | UUID | FK → User |
| name | String | |
| description | String? | |
| isActive | Boolean | Only one active plan per user |

**PlannedSemester** (`planned_semesters`)
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| studyPlanId | UUID | FK → StudyPlan |
| semester | Enum | FALL, SPRING, SUMMER |
| year | Int | |
| courses | JSON | Array of `{ courseId, position }` |
| totalCredits | Int | Auto-calculated |
| difficultyScore | Float? | Auto-calculated average |

Unique constraint on `(studyPlanId, semester, year)`.

### Enums

| Enum | Values |
|------|--------|
| CourseCategory | REQUIRED, ELECTIVE, CORE, MAJOR_ELECTIVE, GENERAL_EDUCATION, FREE_ELECTIVE |
| Semester | FALL, SPRING, SUMMER |
| CourseStatus | PLANNED, IN_PROGRESS, COMPLETED, FAILED, DROPPED |

## Data

The database is seeded with **86 courses** scraped from the official HCMIU Computer Science program page (via `scripts/scrapeCourses.js`), including **27 prerequisite relationships**. A sample user (`Nguyen Van A`) is created with 6 completed courses and a study plan spanning 8 semesters with 37 planned courses.

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes (conventional commits: `feat:`, `fix:`, `style:`, `refactor:`, `test:`, `chore:`)
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a pull request

### Code Style

- TypeScript strict mode is enabled (no `any` types)
- ESLint enforces code quality (zero warnings required)
- Never use `eslint-disable-next-line react-hooks/exhaustive-deps`
- Use `useCallback` for functions referenced in `useEffect` dependencies
- Import order: External → Shared workspace → Absolute internal → Relative → Styles (last)
- Follow existing component patterns (see `AGENTS.md` for full conventions)

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Acknowledgments

- International University (IU), VNU-HCMC for the curriculum data
- React Flow (@xyflow/react) for the graph visualization library
- Prisma for the ORM
- Zod for schema validation
- Zustand for state management

## Support

For support, create an issue in the repository.
