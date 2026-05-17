# CHOW — Synthesis AI: Project Description

## Overview

**Synthesis AI** (Neural HUD v3.1) is an AI-powered student competency assessment platform built for Thai schools. Students upload photos of their handwritten work; the system analyzes the work across five academic dimensions, stores the history, and guides students via a Socratic AI tutor. Access is restricted to school-email domains (currently `@rayongwit.ac.th`).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript, Vite, Tailwind CSS v4, Framer Motion |
| Backend | Python 3.11, FastAPI, Uvicorn |
| AI | Google Gemini (gemini-3-flash) — image analysis + chat |
| Auth | Firebase Google OAuth + custom JWT (school-domain gating) |
| Realtime DB | Firebase Firestore (scans, chat history, fatigue state) |
| Relational DB | Supabase PostgreSQL (students, schools, competency_logs) |
| Image Processing | OpenCV (perspective correction → denoising → binarization) |
| Deployment | Docker on Railway (backend); Vite SPA (frontend) |

---

## Architecture

```
Browser (React SPA)
    │
    ├─ Firebase Auth (Google OAuth)
    │       └─ POST /auth/google-check  ──► FastAPI backend
    │               ├─ validates @rayongwit.ac.th domain
    │               ├─ upserts student record in Supabase
    │               └─ returns JWT (Bearer token)
    │
    ├─ POST /api/analyze (JWT required)
    │       ├─ OpenCV preprocessing
    │       ├─ Gemini Vision → 5-D scores + Thai reasons
    │       ├─ saves to Supabase competency_logs
    │       └─ generates Thai insight strings
    │
    ├─ POST /api/chat  ──► Gemini chat (Socratic Tutor)
    ├─ POST /api/fatigue  ──► cognitive overload index
    ├─ GET  /api/student/profile  ──► student + school info
    └─ GET  /api/student/data  ──► competency history + sociometric averages
```

---

## 5-D Competency Model

Each image scan is scored 0–100 on five dimensions:

| Dimension | Framework | What it measures |
|---|---|---|
| **Logic** | TIMSS | Reasoning sequence and coherence |
| **Accuracy** | Common Core | Procedural precision, careless errors |
| **Analysis** | Bloom's Taxonomy | Depth of understanding, abstraction |
| **Application** | PISA | Real-world problem decoding |
| **Connectivity** | Cross-topic | Integration across subjects |

**Career Readiness formula:**
```
Readiness % = Logic×0.40 + Analysis×0.30 + Application×0.15 + Accuracy×0.10 + Connectivity×0.05
```

---

## Frontend Tabs

| Tab | Thai label | Purpose |
|---|---|---|
| `dashboard` | ศูนย์การเติบโต | Image upload, radar chart, sociometric balance (You vs Room vs Grade) |
| `competency` | 5-D Competency | Detailed per-dimension AI feedback cards + radar, uploaded image preview |
| `roadmap` | เส้นทางอาชีพ | Career readiness % over history, college matching (KMITL Eng, Chula DS) |
| `tutor` | Socratic Tutor | Gemini chat — guides students via questions, never reveals direct answers |
| `management` | การตั้งค่า | Student profile, school info, sociometric context panel |

---

## Authentication Flow

1. User clicks **Sign in with Google** (Firebase popup).
2. Frontend POSTs email + display name to `/auth/google-check`.
3. Backend checks the email domain against `ALLOWED_SCHOOL_EMAIL_DOMAIN = "rayongwit.ac.th"`.
4. If valid, Supabase is queried:
   - Confirm the school record exists and `is_active = true`.
   - Upsert the student row (idempotent on `email`).
5. A signed JWT (`HS256`, 30 min TTL) is returned and stored in `localStorage` as `rw_token`.
6. All `/api/*` endpoints require this JWT via `Authorization: Bearer <token>`.
7. If `SUPABASE_URL`/`SUPABASE_KEY` are absent (local dev), `DEV_AUTH_BYPASS` issues a dev JWT without touching Supabase.

---

## Image Analysis Pipeline

```
Upload (JPEG/PNG/WebP)
    │
    ▼
OpenCV preprocessing
    ├─ Perspective correction (4-point transform if document contour found)
    ├─ Fast NL Means denoising
    └─ Adaptive Gaussian binarization
    │
    ▼
Gemini Vision prompt
    └─ Returns strict JSON: {Logic, Accuracy, Analysis, Application, Connectivity}
       each with {score: int, reason: str (Thai)}
    │
    ▼
Save to Supabase competency_logs
Generate Thai insight strings (prerequisiteCorrelation, careerInsight)
Return to frontend → Firestore scan doc + immediate UI update
```

---

## Database Schema (Supabase)

```sql
schools            (id, name, domain UNIQUE, is_active, created_at)
students           (id, school_id→schools, email UNIQUE, name, grade, room, created_at)
competency_logs    (id, school_id, student_id, logic_score, accuracy_score,
                    analysis_score, application_score, connectivity_score, topic, created_at)
mental_health_logs (id, school_id, student_id, stress_level, fatigue_score, created_at)
```

RLS is enabled on `competency_logs`; each school sees only its own rows.

Firebase Firestore stores per-user real-time collections: `scans`, `chat`, `mental_health/current`.

---

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_KEY` | Supabase service/anon key |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `JWT_SECRET` | HS256 signing secret |
| `GEMINI_MODEL` | Override model ID (default: `gemini-3-flash`) |
| `CORS_ALLOW_ORIGINS` | Comma-separated extra allowed origins |
| `DEV_AUTH_BYPASS` | `1` to skip Supabase in local dev |
| `VITE_API_BASE` / `VITE_RAILWAY_URL` | Frontend → backend base URL |

---

## Deployment

- **Backend**: `Dockerfile` (Python 3.11-slim + OpenCV system deps) → Railway. Entrypoint: `uvicorn main:app --host 0.0.0.0 --port $PORT`.
- **Frontend**: Vite build → static hosting. API calls proxied or pointed at `VITE_API_BASE`.

---

## Notable Design Decisions

- **Dual DB**: Firestore handles real-time listeners (instant UI updates); Supabase handles structured relational data (competency history, cohort averages).
- **Optimistic UI**: scan results update the UI immediately even if Firestore/Supabase writes fail, preventing blocked UX on permission errors.
- **Session clear on refresh**: `CLEAR_UI_ON_REFRESH = true` wipes scan/chat state on every browser reload — students always start fresh.
- **Auto-tab after scan**: after a successful upload, the app navigates to the 5-D Competency tab automatically.
- **Gemini model fallback**: the backend tries the configured model, then falls back through a list of known Gemini flash models, then queries `ListModels` as a last resort.
- **Sociometric balance**: the dashboard compares the student's readiness % against their room average and grade average, computed from Supabase cohort queries.
