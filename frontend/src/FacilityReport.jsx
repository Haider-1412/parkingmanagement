import React, { useState } from "react";
import { localDateTime } from "./VisitDetails.jsx";

export default function FacilityReport({ path, request }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const current = localDateTime(new Date()).slice(0, 10);

  async function load(event) {
    event.preventDefault();
    const query = new URLSearchParams(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    setReport(null);
    try { setReport(await request(path + "/report?" + query)); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <section className="panel facility-report">
    <h2>Date range</h2>
    <form className="closure-form" onSubmit={load}>
      <label>From (PKT)<input name="first" type="date" defaultValue={current} required /></label>
      <label>To (PKT)<input name="last" type="date" defaultValue={current} required /></label>
      <button disabled={busy}>View report</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {report && <><dl className="report-totals">
      <div><dt>Reservations</dt><dd>{report.reservations}</dd></div>
      <div><dt>Occupied now</dt><dd>{report.occupied_now}</dd></div>
      <div><dt>Occupied hours</dt><dd>{report.occupied_hours}</dd></div>
      <div><dt>Completed visits</dt><dd>{report.completed_sessions}</dd></div>
      <div><dt>Revenue collected</dt><dd>PKR {report.collected_revenue}</dd></div>
    </dl>
      {report.visits_by_day.length > 0 && <ul className="report-chart" aria-label="Completed visits by day">
        {report.visits_by_day.map(({ date, count }) => <li key={date}>
          <span>{date}</span>
          <meter min="0" max={Math.max(...report.visits_by_day.map((item) => item.count))}
            value={count} aria-label={count + " completed visits on " + date} />
          <strong>{count}</strong>
        </li>)}
      </ul>}
    </>}
  </section>;
}
