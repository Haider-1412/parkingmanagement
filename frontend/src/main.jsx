import React, { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import Dropdown from "./Dropdown.jsx";
import ParkingLoader from "./ParkingLoader.jsx";
import DriverWorkspace from "./DriverWorkspace.jsx";
import { Brand } from "./WorkspaceShell.jsx";
import "./app.css";

const FacilityWorkspace = lazy(() => import("./FacilityWorkspace.jsx"));
const OperatorWorkspace = lazy(() => import("./OperatorWorkspace.jsx"));

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const auth = url && key ? createClient(url, key).auth : null;
async function api(path, token, signal, method = "GET", body) {
  const timeout = AbortSignal.timeout(20000);
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (timeout.aborted) throw new Error("The parking server took too long to respond. Try again.");
    if (error instanceof TypeError) throw new Error("Could not reach the parking server. Try again.");
    throw error;
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = typeof payload?.detail === "string" ? payload.detail : payload?.detail?.[0]?.msg;
    const error = new Error(detail || "Parking request failed (" + response.status + ").");
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function SignIn() {
  const [registering, setRegistering] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const credentials = { email: fields.get("email"), password: fields.get("password") };
    setBusy(true);
    setMessage("");
    try {
      const result = registering
        ? await auth.signUp({
            ...credentials,
            options: { data: { signup_role: fields.get("role") } },
          })
        : await auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      if (registering && !result.data.session) {
        setMessage("Check your email to confirm your account, then sign in.");
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <aside className="auth-brand">
        <Brand />
        <div className="auth-parking" aria-hidden="true">
          <span /><span /><span /><span /><span /><span />
        </div>
        <p>Parking for drivers, facility managers, and on-site operators.</p>
      </aside>
      <section className="auth-panel">
        <div className="auth-switch" aria-label="Account action">
          <button type="button" aria-pressed={!registering} disabled={busy} onClick={() => {
            setRegistering(false);
            setMessage("");
          }}>Sign in</button>
          <button type="button" aria-pressed={registering} disabled={busy} onClick={() => {
            setRegistering(true);
            setMessage("");
          }}>Register</button>
        </div>
        <h1>{registering ? "Create your account" : "Sign in"}</h1>
        <form onSubmit={submit}>
          <p><label>Email <input type="email" name="email" autoComplete="email" required /></label></p>
          <div className="password-field">
            <label>Password <input type={showPassword ? "text" : "password"} name="password"
              minLength={registering ? 8 : undefined}
              autoComplete={registering ? "new-password" : "current-password"} required /></label>
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide" : "Show"}</button>
          </div>
          {registering && <Dropdown label="Account type" name="role" disabled={busy} options={[
            { value: "driver", label: "Driver" }, { value: "facility_manager", label: "Facility manager" },
          ]} />}
          <button className="primary auth-submit" disabled={busy}>
            {busy ? "Please wait…" : registering ? "Create account" : "Sign in"}
          </button>
        </form>
        {message && <p role="status">{message}</p>}
      </section>
    </main>
  );
}

function Workspace({ token }) {
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const data = await api("/api/workspace", token, controller.signal);
      setResult(data);
      setFailure("");
    }
    load().catch((error) => {
      if (!controller.signal.aborted) setFailure(error.message);
    });
    return () => controller.abort();
  }, [token, attempt]);

  const onSignOut = () => auth.signOut();
  const request = useCallback((path, method, body) => api(path, token, undefined, method, body), [token]);
  if (failure) return <main className="workspace-error">
    <section className="panel">
      <Brand />
      <p role="alert">{failure}</p>
      <div>
        <button type="button" className="primary" onClick={() => {
          setFailure("");
          setAttempt((previous) => previous + 1);
        }}>Try again</button>
        <button type="button" onClick={onSignOut}>Sign out</button>
      </div>
    </section>
  </main>;
  if (!result) return <ParkingLoader fullPage />;

  if (result.role === "facility_manager") return <FacilityWorkspace
    initialFacilities={result.facilities} request={request} onSignOut={onSignOut} />;
  if (result.role === "driver") return <DriverWorkspace data={result} request={request} onSignOut={onSignOut} />;
  if (result.role === "operator") return <OperatorWorkspace
    facilities={result.facilities} request={request} onSignOut={onSignOut} />;
  return <main className="directory"><p role="alert">No parking workspace is assigned to your account.</p>
    <button type="button" onClick={onSignOut}>Sign out</button></main>;
}

function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    if (!auth) return;
    const { data } = auth.onAuthStateChange((event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!auth) return <main className="directory">
    <p role="alert">{import.meta.env.DEV
      ? "Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in frontend/.env, then restart Vite."
      : "Sign-in is unavailable because the frontend was built without its Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the deployment environment, then redeploy."}</p>
  </main>;
  if (session === undefined) return <ParkingLoader fullPage label="Checking your session…" />;
  return session
    ? <Suspense fallback={<ParkingLoader fullPage />}>
      <Workspace key={session.user.id} token={session.access_token} />
    </Suspense>
    : <SignIn />;
}

createRoot(document.getElementById("root")).render(<App />);
