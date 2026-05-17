# Update Log

## 2026-05-17 — Database Migration: Supabase → Railway PostgreSQL

### What was changed

**`requirements.txt`**
- Removed `supabase>=2.10.0`
- Added `psycopg2-binary>=2.9.0`

**`.env`**
- Removed `SUPABASE_URL` and `SUPABASE_KEY`
- Added `DATABASE_URL` pointing to Railway PostgreSQL public endpoint

**`schemas.sql`**
- Merged `is_active` column into `CREATE TABLE schools` — no longer a separate migration file
- Added `IF NOT EXISTS` to all table definitions so re-running is safe
- Removed Supabase-specific RLS policy block — school isolation is now enforced via JWT in the backend
- Added school seed row (`rayongwit.ac.th`) at the bottom of the file

**`main.py`**
- Removed all `supabase` imports and client initialization
- Removed `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_ENABLED` variables
- Removed `DEV_AUTH_BYPASS` logic
- Removed `_supabase_invalid_key_error()` helper
- Removed `_supabase_rows()` helper
- Added `psycopg2` connection pool (`ThreadedConnectionPool`) with `get_db()` context manager
- Rewrote `/auth/google-check` — now uses raw SQL `SELECT` for school lookup and `INSERT ON CONFLICT` for student upsert
- Rewrote `save_competency_data()` — now uses raw SQL `INSERT`
- Rewrote `/api/student/profile` — now uses SQL `SELECT` with `LEFT JOIN` on schools
- Rewrote `/api/student/data` — sociometric room/grade averages now computed in single JOIN queries instead of multiple round-trips
- Added graceful dev fallback when `DATABASE_URL` is not set

### What was NOT changed
- `App.tsx` — zero changes
- Firebase (`lib/firebase.ts`) — zero changes
- All Gemini AI logic — zero changes
- All JWT auth logic — zero changes
- Docker and deployment config — zero changes

### Database setup
- `schemas.sql` was executed against the Railway PostgreSQL instance
- All 4 tables confirmed created: `schools`, `students`, `competency_logs`, `mental_health_logs`
- School seed row for `rayongwit.ac.th` confirmed inserted and active

---

## 2026-05-16 — Gemini API Key Leaked

### Problem
Scan uploads returned `403 PERMISSION_DENIED` — Google flagged the API key as leaked.

### Fix
Replace `GEMINI_API_KEY` in `.env` with a new key generated from Google AI Studio. Old key is permanently revoked.
