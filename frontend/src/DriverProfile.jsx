import React from "react";
import { visitTime } from "./VisitDetails.jsx";
import { PageHeading } from "./WorkspaceShell.jsx";

export default function DriverProfile({ username, access, strikes, resumesAt, busy, onSave }) {
  return <>
    <PageHeading title="Profile" description="Manage your username and see your booking access." />
    <div className="split-rails">
      <details className="panel driver-profile-edit">
        <summary>
          <span><strong>Edit profile</strong><small>{username || "No username set"}</small></span>
          <span className="profile-chevron" aria-hidden="true" />
        </summary>
        <div className="driver-profile-editor">
          <form className="driver-controls" onSubmit={(event) => {
            event.preventDefault();
            onSave(new FormData(event.currentTarget).get("username"));
          }}>
            <label>Username
              <input key={username} name="username" autoComplete="username" defaultValue={username || ""}
                required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" disabled={busy}
                aria-describedby="username-format" />
            </label>
            <button className="primary" disabled={busy}>Save username</button>
          </form>
          <p id="username-format">Use 3 to 24 letters, numbers, or underscores. Usernames are unique.</p>
        </div>
      </details>
      <section className="panel driver-strikes">
        <h2>No-show strikes</h2>
        {access ? <>
          <p className="strike-count"><strong>{strikes.length}</strong> active · Suspension at {access.strike_limit}</p>
          <p>Each strike expires 20 days after the missed check-in deadline.</p>
          {resumesAt && <p className="driver-feedback error" role="status">
            New bookings are suspended until {visitTime(resumesAt)} PKT.
          </p>}
          {strikes.length ? <ul>
            {strikes.map((strike) => <li key={strike.reference}>
              <strong>{strike.reference}</strong>
              <span>Missed {visitTime(strike.issued_at)} PKT</span>
              <span>Expires {visitTime(strike.expires_at)} PKT</span>
            </li>)}
          </ul> : <p>No active strikes.</p>}
        </> : <p role="status">Loading booking access…</p>}
      </section>
    </div>
  </>;
}
