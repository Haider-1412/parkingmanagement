# Parking Management

Step 1 provides sign-in, driver and facility-manager registration, role-specific landing pages, and the initial database schema. Facility onboarding and the layout editor start in Step 2.

## Local setup

Use Python 3.11 or newer, Node.js 22 or newer, and a development Supabase project with email/password sign-in enabled. Set the Supabase Auth Site URL to `http://localhost:5173` for local email confirmation.

From the repository root in PowerShell, prepare the API.

```powershell
Set-Location backend
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Fill in `backend/.env` with the project's URL, publishable key, and direct or session-pooler PostgreSQL connection string. Use the `postgresql+psycopg://` scheme and URL-encode any special characters in the password. Keep the `parking` schema off Supabase's exposed API schemas. The browser uses FastAPI for application data.

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

In a second terminal from the repository root, prepare the web app.

```powershell
Set-Location frontend
Copy-Item .env.example .env
npm.cmd ci
```

Set the same Supabase URL and publishable key in `frontend/.env`, then run `npm.cmd run dev` and open `http://localhost:5173`. Use only the publishable key in frontend configuration.

## Vercel Services

Import the repository root as one Vercel project and select **Services** as its framework. The public site serves the Vite app at `/`. Requests to `/api/*` go to a frontend function, which forwards them to the internal FastAPI service using the `BACKEND_URL` binding. Vercel injects this variable.

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the frontend build. Configure `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and, for operator provisioning, `SUPABASE_SECRET_KEY` in the project environment. Set the deployed site URL and allowed confirmation redirects in Supabase Auth. Apply `alembic upgrade head` from `backend` against the intended deployment database before testing sign-in.

Run `vercel dev` from the repository root to test the Vercel routing locally. Use `vercel dev --local` to run without linking a cloud project. Open `/`, check that `/api/health` returns `{"status":"ok"}`, and verify that `/api/workspace` returns 401 without a session.

## Operator accounts

In Supabase, open Project Settings → API Keys and put a project secret key in `backend/.env` as `SUPABASE_SECRET_KEY`. Restart FastAPI after changing the file. Keep the key out of frontend configuration.

Sign in as a Facility Manager, open a facility, and expand **Operators**. Enter an email and password for a new operator account. The operator signs in on the normal sign-in page. To assign an operator you already created to another facility you manage, enter their email and leave the password blank. **Remove access** removes only that facility assignment.

## Optional demo seed

In the development project's Supabase Authentication dashboard, create three distinct confirmed users and set their passwords. Run the seed command from `backend` before their first app sign-in. Use the real demo emails in place of the examples.

```powershell
.\.venv\Scripts\python.exe seed.py --driver driver@example.com --manager manager@example.com --operator operator@example.com
```

The seed links these accounts to their roles, adds two sample facilities with three spots each, and assigns the demo operator to both facilities. Repeat runs preserve existing sample data.
