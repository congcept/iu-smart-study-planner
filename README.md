# IU Smart Study Planner (ISP)

A web application that visualizes the curriculum as an interactive dependency graph and provides course recommendations for students at the International University (IU), VNU.

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

The IU Smart Study Planner addresses this by providing an interactive curriculum graph, workload analysis, and smart course recommendations based on your progress and course difficulty.

## Features

### Interactive Curriculum Graph

Courses are displayed as nodes with prerequisite relationships shown as connecting edges. Each course is color-coded by category and status (Completed, In Progress, Available, or Locked). The graph canvas is powered by React Flow and supports dragging and zooming.

### Smart Course Recommendations

The recommendation engine uses a workload balancing algorithm that considers your past performance, course difficulty levels, and credit limits. It prioritizes required and core courses while keeping semester loads balanced, and assigns risk levels (Low, Medium, High, Critical) to course selections.

### Workload Analyzer

When you select courses for a semester, the analyzer calculates total credits, average difficulty, and a workload score. It then provides recommendations on whether your selection is manageable or needs adjustment.

### Progress Dashboard

Track completed courses, view your GPA, and see how many credits you have earned. The dashboard also shows which courses are available for you to take next based on your completed prerequisites.

### Study Plan Management

Create multiple study plans and organize courses semester by semester. The system validates your plans against prerequisite requirements to catch scheduling issues early.

## Tech Stack

### Frontend

- **Framework:** React 18.2 with TypeScript (Strict Mode)
- **Build Tool:** Vite 5.0
- **Styling:** Tailwind CSS 3.3
- **State Management:** Zustand
- **Graph Visualization:** React Flow (@xyflow/react)
- **Icons:** Lucide React
- **HTTP Client:** Axios

### Backend

- **Runtime:** Node.js 20
- **Framework:** Express.js 4.18
- **Language:** TypeScript 5.2 (Strict Mode)
- **ORM:** Prisma 5.6
- **Validation:** Zod
- **Database:** PostgreSQL 15

### DevOps

- **Containerization:** Docker & Docker Compose
- **Development:** Nodemon, ts-node

## Project Structure

```
iu-smart-study-planner/
├── client/                      # Frontend Application
│   ├── src/
│   │   ├── components/         # UI Components
│   │   │   ├── ui/             # Reusable UI primitives
│   │   │   └── ui.tsx          # Backward-compatible re-export
│   │   ├── features/           # Feature-based modules
│   │   │   ├── curriculum/     # Curriculum graph
│   │   │   ├── planner/        # Study planner
│   │   │   ├── progress/       # Progress tracking
│   │   │   └── recommendations/# Smart recommendations
│   │   ├── lib/                # Utilities and API
│   │   └── types/              # TypeScript definitions
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile
│
├── server/                      # Backend Application
│   ├── src/
│   │   ├── config/             # Configuration
│   │   ├── routes/             # API routes
│   │   ├── services/           # Business logic
│   │   └── index.ts            # Server entry
│   ├── prisma/
│   │   ├── schema.prisma       # Database schema
│   │   └── seed.ts             # Seed data
│   ├── package.json
│   └── Dockerfile
│
├── shared/                      # Shared schemas and DTOs
├── docker-compose.yml          # Docker orchestration
└── README.md                   # This file
```

## Quick Start

### Prerequisites

- Docker Desktop (recommended) or Docker Engine with Docker Compose
- Node.js 20 or later (for local development without Docker)

### Option 1: Docker Compose (Recommended)

```bash
cd iu-smart-study-planner

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

Services will be available at:

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001
- API Health Check: http://localhost:3001/api/health
- Database: localhost:5432

### Option 2: Manual Setup

Start PostgreSQL:

```bash
docker run -d \
  --name isp-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=iu_study_planner \
  -p 5432:5432 \
  postgres:15-alpine
```

Set up the backend:

```bash
cd server
npm install
npx prisma generate
npx prisma migrate dev --name init
npx prisma db seed
npm run dev
```

Set up the frontend:

```bash
cd client
npm install
npm run dev
```

## Stability & Run Guide

Use this checklist to verify the application is running correctly after setup.

### Pre-flight checks

- Node.js version: `node -v` (recommended 20 or later)
- npm version: `npm -v`
- Docker daemon running (for compose): `docker info`
- Environment files exist:
  - `server/.env` with `DATABASE_URL`, `PORT`, `CORS_ORIGIN`, `JWT_SECRET`
  - `client/.env` with `VITE_API_URL=http://localhost:3001/api`

### Local quality gates

Run these before starting services:

```bash
# Server type check and tests
cd server
npx tsc --noEmit
npm test -- --runInBand

# Client type check and tests
cd ../client
npx tsc --noEmit
npm run test:run
```

All commands should exit with code 0.

### Start with Docker (preferred)

```bash
cd ..
docker-compose up -d
docker-compose logs -f
```

Verify the frontend at http://localhost:5173 and backend health at http://localhost:3001/api/health.

Stop with `docker-compose down`. Reset the database with `docker-compose down -v`.

### Start locally (without compose)

1. Start PostgreSQL (Docker or local service).
2. Start backend:

```bash
cd server
npx prisma generate
npx prisma migrate dev
npx prisma db seed
npm run dev
```

3. Start frontend:

```bash
cd client
npm run dev
```

### Functional smoke checklist

- `GET /api/health` returns 200 with `{ status: "ok" }`
- Dashboard renders without errors
- Curriculum graph displays course nodes and edges
- Recommendations tab loads the course list
- Workload analyzer returns risk level and recommendations

### Common issues and fixes

- **Docker daemon unavailable**
  - Symptom: `Cannot connect to the Docker daemon ...`
  - Fix: Open Docker Desktop and wait for the engine to start, then retry `docker-compose up -d`.

- **CORS errors in browser**
  - Make sure `server/.env` has `CORS_ORIGIN=http://localhost:5173`.
  - Make sure the client calls the backend at `http://localhost:3001/api` (or `/api` with proxy).

- **Database relation or migration errors**
  - Re-run `npx prisma generate`, then `npx prisma migrate dev`, then `npx prisma db seed`.
  - If the schema is inconsistent in development, use `npx prisma migrate reset` (this clears all data).

- **Empty dashboard or recommendations**
  - Make sure seed data exists by running `npx prisma db seed`.
  - The client uses the first available user from the API for these views.

## Development Setup

### Environment Variables

Create `.env` files in both the client and server directories.

Server `.env`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/iu_study_planner
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
```

Client `.env`:

```env
VITE_API_URL=http://localhost:3001/api
```

### Database Operations

```bash
cd server

# Open Prisma Studio (visual database browser)
npx prisma studio

# Create a new migration
npx prisma migrate dev --name <migration-name>

# Reset database (deletes all data)
npx prisma migrate reset

# Seed database
npx prisma db seed

# Generate Prisma client
npx prisma generate
```

### Available Scripts

Root workspace:

```bash
npm run format       # Format all files with Prettier
npm run format:check # Check if files are formatted correctly
npm run lint         # Run ESLint across all workspaces
npm run test         # Run Vitest (client) and Jest (server) tests
```

Backend:

```bash
npm run dev       # Start with hot-reload
npm run build     # Build for production
npm run start     # Start production server
npm run db:migrate    # Run migrations
npm run db:generate   # Generate Prisma client
npm run db:seed       # Seed database
npm run db:studio     # Open Prisma Studio
```

Frontend:

```bash
npm run dev       # Start development server
npm run build     # Build for production
npm run preview   # Preview production build locally
npm run lint      # Run ESLint
npm run test      # Run Vitest tests
```

### Shared Schemas & Validation

All Zod validation schemas and TypeScript DTOs live in the `shared/` workspace to keep types consistent across the client and server.

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

### Endpoints

Health Check:

```
GET /health
```

Courses:

```
GET    /courses                    # List all courses
GET    /courses/:id                # Get course details
POST   /courses                    # Create course
PUT    /courses/:id                # Update course
DELETE /courses/:id                # Delete course
POST   /courses/prerequisites     # Add prerequisite
DELETE /courses/prerequisites/:id  # Remove prerequisite
```

Users:

```
GET    /users                      # List users
GET    /users/:id                  # Get user details
POST   /users                      # Create user
POST   /users/:id/records         # Add student record
GET    /users/:id/progress        # Get user progress
```

Study Plans:

```
GET    /study-plans/user/:userId   # Get user's study plans
GET    /study-plans/:id            # Get plan details
POST   /study-plans                # Create study plan
POST   /study-plans/:id/semesters # Add semester
PUT    /study-plans/:planId/semesters/:semesterId
DELETE /study-plans/:planId/semesters/:semesterId
DELETE /study-plans/:id
```

Recommendations:

```
GET    /recommendations/user/:userId  # Get recommendations
POST   /recommendations/analyze-workload
GET    /recommendations/prerequisite-chain/:courseId
```

## Database Schema

### Course

- `id` - UUID, primary key
- `code` - String, unique (e.g., "IT064IU")
- `name` - String, course name
- `credits` - Integer, credit hours
- `difficultyLevel` - Integer 1-5, difficulty rating
- `description` - String, optional
- `category` - Enum: REQUIRED, CORE, ELECTIVE, MAJOR_ELECTIVE, GENERAL_EDUCATION, FREE_ELECTIVE
- `semesterOffered` - Array: FALL, SPRING, SUMMER
- Relations to Prerequisite model

### Prerequisite

- Self-relation on Course
- `courseId` and `prerequisiteId` - UUID foreign keys
- `isCorequisite` - Boolean
- `isStrict` - Boolean

### User

- `id` - UUID, primary key
- `studentId` - String, unique
- `name` - String
- `email` - String, unique
- `major` - String, optional
- `enrollmentYear` - Integer, optional
- `targetGraduationYear` - Integer, optional

### StudentRecord

- Tracks user progress per course
- `userId` and `courseId` - Foreign keys
- `grade` - String (e.g., "A", "B+")
- `gradePoints` - Float
- `status` - Enum: PLANNED, IN_PROGRESS, COMPLETED, FAILED, DROPPED
- `semester` and `year` - When the course was taken

### StudyPlan

- `userId` - Foreign key
- `name` - String
- `description` - String, optional
- `isActive` - Boolean
- Has multiple PlannedSemester records

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a pull request

### Code Style

- TypeScript strict mode is enabled (no `any` types)
- ESLint enforces code quality
- Follow existing component and import patterns
- Use TypeScript interfaces for all data structures

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Acknowledgments

- International University (IU), VNU for the curriculum data
- React Flow for the graph visualization library
- Prisma for the ORM

## Support

For support, create an issue in the repository.

---

This is a pre-thesis project for the Computer Science program at International University, VNU-HCM.
