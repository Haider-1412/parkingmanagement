import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import FacilityWorkspace from "./FacilityWorkspace.jsx";
import DriverWorkspace from "./DriverWorkspace.jsx";
import OperatorWorkspace from "./OperatorWorkspace.jsx";
import "./app.css";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const auth = url && key ? createClient(url, key).auth : null;
const views = {
  driver: { title: "Driver", path: "/api/driver" },
  facility_manager: { title: "Facility manager", path: "/api/facility-manager" },
  operator: { title: "Parking operator", path: "/api/operator" },
};

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
    <section className="auth-panel">
      <h1>{registering ? "Create an account" : "Parking Management"}</h1>
      <form onSubmit={submit}>
        <p><label>Email <input type="email" name="email" autoComplete="email" required /></label></p>
        <p><label>Password <input type="password" name="password"
          autoComplete={registering ? "new-password" : "current-password"} required /></label></p>
        {registering && <p><label>Account type <select name="role">
          <option value="driver">Driver</option>
          <option value="facility_manager">Facility manager</option>
        </select></label></p>}
        <button className="primary" disabled={busy}>{registering ? "Register" : "Sign in"}</button>
        {" "}
        <button type="button" disabled={busy} onClick={() => {
          setRegistering(!registering);
          setMessage("");
        }}>{registering ? "Back to sign in" : "Register"}</button>
      </form>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function Workspace({ token }) {
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const { role } = await api("/api/me", token, controller.signal);
      const view = views[role];
      const data = await api(view.path, token, controller.signal);
      setResult({ role, title: view.title, ...data });
      setFailure("");
    }
    load().catch((error) => {
      if (!controller.signal.aborted) setFailure(error.message);
    });
    return () => controller.abort();
  }, [token, attempt]);

  return (
    <>
      <header className="app-header">
        <div className="header-content">
          <strong>Parking Management</strong>
          {result && <span className="workspace-role">{result.title}</span>}
          <button onClick={() => auth.signOut()}>Sign out</button>
        </div>
      </header>
      {failure && <div className="directory">
        <p role="alert">{failure}</p>
        <button type="button" onClick={() => {
          setFailure("");
          setAttempt((previous) => previous + 1);
        }}>Try again</button>
      </div>}
      {!failure && !result && <p className="directory" role="status">Loading your workspace…</p>}
      {!failure && result?.role === "facility_manager" && <FacilityWorkspace
        initialFacilities={result.facilities}
        request={(path, method, body) => api(path, token, undefined, method, body)} />}
      {!failure && result?.role === "driver" && <DriverWorkspace data={result}
        request={(path, method, body) => api(path, token, undefined, method, body)} />}
      {!failure && result?.role === "operator" && <OperatorWorkspace facilities={result.facilities}
        request={(path, method, body) => api(path, token, undefined, method, body)} />}
    </>
  );
}

function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    if (!auth) return;
    const { data } = auth.onAuthStateChange((event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!auth) return <main>Set the Supabase URL and publishable key in frontend/.env.</main>;
  if (session === undefined) return <main>Loading session…</main>;
  return <main>{session
    ? <Workspace key={session.user.id} token={session.access_token} />
    : <SignIn />}</main>;
}

createRoot(document.getElementById("root")).render(<App />);
