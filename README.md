# 🎓 IU Smart Study Planner (ISP)

A comprehensive web application for visualizing curriculum as an interactive dependency graph and providing adaptive course recommendations for International University (IU) - VNU students.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.2-blue)
![React](https://img.shields.io/badge/React-18.2-61DAFB)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791)

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Development Setup](#development-setup)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Contributing](#contributing)
- [License](#license)

## 🎯 Overview

**Problem:** Students currently rely on static, confusing PDF flowcharts to plan their degree, leading to:
- Missing prerequisites
- Unbalanced semesters (too many heavy courses at once)
- Delayed graduation

**Solution:** IU Smart Study Planner provides:
- Interactive curriculum dependency graph visualization
- Adaptive course recommendations based on workload balancing
- Smart prerequisite logic validation
- Progress tracking and planning tools

## ✨ Features

### Core Features

#### 1. Interactive Curriculum Graph
- Visual representation of courses as nodes
- Prerequisite relationships as edges
- Color-coded by course category (Required, Core, Elective, etc.)
- Real-time status updates (Completed, In Progress, Available, Locked)
- Drag-and-drop canvas powered by React Flow

#### 2. Smart Course Recommendations
- AI-powered workload balancing algorithm
- Considers past performance and course difficulty
- Prioritizes required and core courses
- Respects maximum credit limits per semester
- Analyzes risk levels (Low, Medium, High, Critical)

#### 3. Workload Analyzer
- Calculates total credits and average difficulty
- Provides workload score and risk assessment
- Offers actionable recommendations
- Validates semester plan feasibility

#### 4. Progress Dashboard
- Visual progress indicators
- Completed courses history
- GPA calculation
- Credits earned tracking
- Available courses listing

#### 5. Study Plan Management
- Create multiple study plans
- Semester-by-semester planning
- Course scheduling with validation
- Export and share plans

## 🛠 Tech Stack

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

## 📁 Project Structure

```
iu-smart-study-planner/
├── client/                      # Frontend Application
│   ├── src/
│   │   ├── components/         # UI Components
│   │   │   └── ui.tsx          # Reusable UI components
│   │   ├── features/           # Feature-based modules
│   │   │   ├── curriculum/     # Curriculum graph
│   │   │   │   └── CurriculumGraph.tsx
│   │   │   ├── planner/        # Study planner
│   │   │   │   └── WorkloadAnalyzer.tsx
│   │   │   ├── progress/       # Progress tracking
│   │   │   │   └── ProgressDashboard.tsx
│   │   │   └── recommendations/# Smart recommendations
│   │   │       └── Recommendations.tsx
│   │   ├── lib/                # Utilities and API
│   │   │   ├── api.ts          # API client
│   │   │   ├── store.ts        # Zustand store
│   │   │   └── utils.ts        # Helper functions
│   │   ├── types/              # TypeScript definitions
│   │   │   └── index.ts
│   │   ├── App.tsx             # Main application
│   │   ├── main.tsx            # Entry point
│   │   └── index.css           # Global styles
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   ├── vite.config.ts
│   └── Dockerfile
│
├── server/                      # Backend Application
│   ├── src/
│   │   ├── config/             # Configuration
│   │   │   └── index.ts
│   │   ├── controllers/        # Route controllers
│   │   ├── routes/             # API routes
│   │   │   ├── courses.ts      # Course CRUD
│   │   │   ├── users.ts        # User management
│   │   │   ├── studyPlans.ts   # Study plans
│   │   │   └── recommendations.ts # Smart logic
│   │   ├── services/           # Business logic
│   │   │   └── workloadBalancer.ts
│   │   └── index.ts            # Server entry
│   ├── prisma/
│   │   ├── schema.prisma       # Database schema
│   │   └── seed.ts             # Sample data
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── docker-compose.yml          # Docker orchestration
└── README.md                   # This file
```

## 🚀 Quick Start

### Prerequisites

- Docker Desktop (recommended) or Docker Engine + Docker Compose
- Node.js 20+ (for local development without Docker)
- npm or yarn

### Option 1: Docker Compose (Recommended)

The fastest way to get started with all services:

```bash
# Navigate to project directory
cd iu-smart-study-planner

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Stop and remove volumes (clears database)
docker-compose down -v
```

**Services will be available at:**
- Frontend: http://localhost:5173
- Backend API: http://localhost:3001
- API Health Check: http://localhost:3001/api/health
- Database: localhost:5432

### Option 2: Manual Setup

#### Step 1: Start PostgreSQL

```bash
# Using Docker
docker run -d \
  --name isp-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=iu_study_planner \
  -p 5432:5432 \
  postgres:15-alpine
```

#### Step 2: Setup Backend

```bash
cd server

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init

# Seed database with sample data
npx prisma db seed

# Start development server
npm run dev
```

#### Step 3: Setup Frontend

```bash
cd client

# Install dependencies
npm install

# Start development server
npm run dev
```

## 🧪 Development Setup

### Environment Variables

Create `.env` files in both client and server directories:

**Server (.env):**
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/iu_study_planner
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
```

**Client (.env):**
```env
VITE_API_URL=http://localhost:3001/api
```

### Database Operations

```bash
cd server

# Open Prisma Studio (visual database management)
npx prisma studio

# Create new migration
npx prisma migrate dev --name <migration-name>

# Reset database
npx prisma migrate reset

# Seed database
npx prisma db seed

# Generate Prisma client
npx prisma generate
```

### Available Scripts

**Backend:**
```bash
npm run dev       # Start with hot-reload
npm run build     # Build for production
npm run start     # Start production server
npm run db:migrate    # Run migrations
npm run db:generate   # Generate Prisma client
npm run db:seed       # Seed database
npm run db:studio     # Open Prisma Studio
```

**Frontend:**
```bash
npm run dev       # Start development server
npm run build     # Build for production
npm run preview   # Preview production build
npm run lint      # Run ESLint
```

## 📚 API Documentation

### Base URL
```
http://localhost:3001/api
```

### Endpoints

#### Health Check
```
GET /health
```

#### Courses
```
GET    /courses                    # List all courses
GET    /courses/:id                # Get course details
POST   /courses                    # Create course
PUT    /courses/:id                # Update course
DELETE /courses/:id                # Delete course
POST   /courses/prerequisites     # Add prerequisite
DELETE /courses/prerequisites/:id  # Remove prerequisite
```

#### Users
```
GET    /users                      # List users
GET    /users/:id                  # Get user details
POST   /users                      # Create user
POST   /users/:id/records         # Add student record
GET    /users/:id/progress        # Get user progress
```

#### Study Plans
```
GET    /study-plans/user/:userId   # Get user's study plans
GET    /study-plans/:id            # Get plan details
POST   /study-plans                # Create study plan
POST   /study-plans/:id/semesters # Add semester
PUT    /study-plans/:planId/semesters/:semesterId
DELETE /study-plans/:planId/semesters/:semesterId
DELETE /study-plans/:id
```

#### Recommendations
```
GET    /recommendations/user/:userId  # Get recommendations
POST   /recommendations/analyze-workload
GET    /recommendations/prerequisite-chain/:courseId
```

## 🗄 Database Schema

### Models

#### Course
- `id`: UUID (Primary Key)
- `code`: String (Unique) - e.g., "IT101"
- `name`: String - Course name
- `credits`: Integer - Credit hours
- `difficultyLevel`: Integer (1-5) - Difficulty rating
- `description`: String (Optional)
- `category`: Enum - REQUIRED, CORE, ELECTIVE, MAJOR_ELECTIVE, GENERAL_EDUCATION, FREE_ELECTIVE
- `semesterOffered`: Array - FALL, SPRING, SUMMER
- `prerequisites`: Relation to Prerequisite
- `createdAt`, `updatedAt`: Timestamps

#### Prerequisite
- Self-relation on Course
- `courseId`: UUID
- `prerequisiteId`: UUID
- `isCorequisite`: Boolean
- `isStrict`: Boolean

#### User
- `id`: UUID (Primary Key)
- `studentId`: String (Unique)
- `name`: String
- `email`: String (Unique)
- `major`: String (Optional)
- `enrollmentYear`: Integer (Optional)
- `targetGraduationYear`: Integer (Optional)

#### StudentRecord
- Tracks user progress on courses
- `userId`, `courseId`: Foreign Keys
- `grade`: String (e.g., "A", "B+")
- `gradePoints`: Float
- `status`: Enum - PLANNED, IN_PROGRESS, COMPLETED, FAILED, DROPPED
- `semester`, `year`: When taken

#### StudyPlan
- `userId`: Foreign Key
- `name`: String
- `description`: String (Optional)
- `isActive`: Boolean
- `semesters`: PlannedSemester[]

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Code Style

- TypeScript strict mode enabled
- ESLint for code quality
- Follow existing component patterns
- Use TypeScript interfaces for all data structures

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- International University (IU) - VNU for the curriculum inspiration
- React Flow for the graph visualization library
- Prisma for the excellent ORM
- All contributors and testers

## 📞 Support

For support, email [your-email] or create an issue in the repository.

---

**Built with ❤️ for IU Students**

*This is a pre-thesis project for the Computer Science program at International University, VNU-HCM.*
