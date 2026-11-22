import React, { useEffect, useState } from "react";
import { localDateTime, visitTime, Receipt } from "./VisitDetails.jsx";
import { PageHeading, WorkspaceIcon, WorkspaceShell } from "./WorkspaceShell.jsx";
import ParkingLoader from "./ParkingLoader.jsx";
import { useLiveData } from "./useLiveData.js";
import "./dashboard.css";
import { checkInDeadline, effectiveStatus, queueDeadline } from "./operatorQueue.js";
import "./driver.css";

const pages = [{ id: "reservations", label: "Reservations" }];
const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" });
const duration = new Intl.RelativeTimeFormat("en", { numeric: "always" });

const operatorPath = "/api/operator";
const statuses = {
  confirmed: "Confirmed", checked_in: "Checked in", completed: "Completed", cancelled: "Cancelled", no_show: "No-show",
};

function showDialog(dialog) {
  if (dialog && !dialog.open) dialog.showModal();
}

export default function OperatorWorkspace({ facilities, request, onSignOut }) {
  const [processing, setProcessing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState("");
  const [formVersion, setFormVersion] = useState(0);
  const [now, setNow] = useState(Date.now);
  const path = operatorPath + "/bookings";

  const query = new URLSearchParams(filters);
  const selectedStatus = query.get("status");
  const active = !selectedStatus;
  if (active) query.set("active", "true");
  if (selectedStatus === "all") query.delete("status");
  const queueUrl = path + "?" + query;
  const facilityId = query.get("facility_id");
  const statsUrl = operatorPath + "/dashboard" + (facilityId ? "?facility_id=" + encodeURIComponent(facilityId) : "");
  const { data: queue, error: queueError } = useLiveData(request, queueUrl, busy);
  const { data: stats, error: statsError } = useLiveData(request, statsUrl, busy);
  const bookings = queue?.bookings;
  const visibleBookings = (bookings || []).map((booking) => ({ ...booking, status: effectiveStatus(booking, now) }))
    .filter((booking) => active ? booking.status !== "no_show"
      : selectedStatus !== "confirmed" || booking.status === "confirmed")
    .sort((left, right) => {
      const first = queueDeadline(left);
      const second = queueDeadline(right);
      return first === second ? 0 : first - second;
    });

  async function run(action) {
    setBusy(true);
    setError("");
    setNotice("");
    try { await action(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const processingVisible = visibleBookings.some((booking) => booking.id === processing);
  useEffect(() => {
    if (processing && !processingVisible) {
      setProcessing(null);
      setEditing(null);
    }
  }, [processingVisible, processing]);

  function search(event) {
    event.preventDefault();
    const query = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (value.trim()) query.set(key, value.trim());
    }
    setFilters(query.toString());
    setEditing(null);
    setProcessing(null);
    setError("");
  }

  function filterByMetric(status) {
    const next = new URLSearchParams();
    if (facilityId) next.set("facility_id", facilityId);
    if (selectedStatus !== status) {
      next.set("status", status);
      if (status === "confirmed" && stats) next.set("day", localDateTime(stats.as_of).slice(0, 10));
    }
    setFilters(next.toString());
    setFormVersion((version) => version + 1);
    setProcessing(null);
    setEditing(null);
    setError("");
  }

  function changeStatus(booking, action) {
    run(async () => {
      await request(path + "/" + booking.id + "/" + action, "POST");
      setEditing(null);
      setProcessing(null);
      setNotice("Booking " + booking.reference + " updated.");
    });
  }

  function edit(booking) {
    run(async () => {
      const { spots } = await request(operatorPath + "/facilities/" + booking.facility_id + "/spots");
      setEditing({ booking, spots });
    });
  }

  function save(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    run(async () => {
      await request(path + "/" + editing.booking.id, "PUT", {
        slot_id: fields.get("spot"),
        starts_at: fields.get("arrival") + ":00+05:00",
        ends_at: fields.get("departure") + ":00+05:00",
      });
      setEditing(null);
      setProcessing(null);
      setNotice("Booking rescheduled.");
    });
  }

  const selectedFilters = new URLSearchParams(filters);

  return <WorkspaceShell role="Parking operator" items={pages} page="reservations" onSignOut={onSignOut}>
    <section className="driver-workspace">
    <PageHeading title="Reservations" description="Find scheduled visits and process arrivals and departures." />
    <div className="dashboard-metrics operator-summary" aria-label="Live parking totals">
      <button type="button" className="panel hover-card dashboard-metric metric-filter metric-feature"
        aria-pressed={selectedStatus === "confirmed"} disabled={!stats || busy} onClick={() => filterByMetric("confirmed")}>
        <span className="metric-icon"><WorkspaceIcon name="bookings" /></span>
        <span className="metric-label">Remaining check-ins today</span>
        <strong key={stats?.waiting}>{stats?.waiting ?? "–"}</strong>
        <span className="metric-arrow" aria-hidden="true">↗</span>
      </button>
      <button type="button" className="panel hover-card dashboard-metric metric-filter"
        aria-pressed={selectedStatus === "checked_in"} disabled={!stats || busy} onClick={() => filterByMetric("checked_in")}>
        <span className="metric-icon"><WorkspaceIcon name="vehicles" /></span>
        <span className="metric-label">Occupied spaces</span>
        <strong key={stats?.occupied}>{stats?.occupied ?? "–"}</strong>
        <span className="metric-arrow" aria-hidden="true">↗</span>
      </button>
      <div className="panel hover-card dashboard-metric">
        <span className="metric-icon"><WorkspaceIcon name="report" /></span>
        <span className="metric-label">Sales today</span>
        <strong key={stats?.sales_total}>{stats?.sales_total != null ? money.format(Number(stats.sales_total)) : "–"}</strong>
      </div>
    </div>
    {statsError && <p className="driver-feedback error" role="alert">{statsError}</p>}
    <form key={formVersion} className="panel operator-filters" onSubmit={search}>
      <label>Booking ref / plate<input name="search" defaultValue={selectedFilters.get("search") || ""} maxLength={24} placeholder="Search by reference or plate" /></label>
      <label>Facility<select name="facility_id" defaultValue={selectedFilters.get("facility_id") || ""}><option value="">All facilities</option>
        {facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
      </select></label>
      <label>Booking date (PKT)<input type="date" name="day" defaultValue={selectedFilters.get("day") || ""} /></label>
      <label>Status<select name="status" defaultValue={selectedFilters.get("status") || ""}>
        <option value="">Active queue</option><option value="all">All statuses</option>
        {Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <div className="filter-actions">
        <button className="primary" disabled={busy}>Apply filters</button>
        <button type="button" disabled={busy} onClick={(event) => {
          event.currentTarget.form.reset();
          setFilters("");
          setProcessing(null);
          setEditing(null);
          setError("");
          setFormVersion((version) => version + 1);
        }}>Clear</button>
        {bookings && <span>{visibleBookings.length} matching reservations</span>}
      </div>
    </form>
    {notice && <p className="driver-feedback" role="status">{notice}</p>}
    {error && <p className="driver-feedback error" role="alert">{error}</p>}
    {queueError && <p className="driver-feedback error" role="alert">{queueError}</p>}
    {!bookings && !queueError && <div className="panel operator-results"><ParkingLoader label="Loading reservations…" /></div>}
    {bookings && !visibleBookings.length && <p>{facilities.length
      ? "No matching reservations." : "No facilities assigned. Ask your facility manager to add you."}</p>}
    {!!visibleBookings.length && <div className="panel operator-results">
    <div className="operator-row operator-columns" aria-hidden="true">
      <span>Booking</span><span>Facility / space</span><span>Vehicle</span><span>Schedule (PKT)</span><span>Status</span><span />
    </div>
    <ul className="operator-bookings">{visibleBookings.map((booking) => {
      const started = Date.parse(booking.starts_at);
      const deadline = queueDeadline(booking);
      const minutes = Math.ceil((deadline - now) / 60000);
      const urgent = Number.isFinite(deadline) && minutes <= 15;
      const deadlineLabel = booking.status === "confirmed" ? "Check-in closes" : "Departure due";
      return <li key={booking.id} className={urgent ? "urgent-booking" : undefined}>
        <div className="operator-row">
          <strong>{booking.reference}</strong>
          <span>{booking.facility}<small>Space {booking.spot}</small></span>
          <strong>{booking.plate}</strong>
          <span>{visitTime(booking.starts_at)}<small>to {visitTime(booking.ends_at)} PKT</small>
            {urgent && <small className="queue-deadline">{deadlineLabel} {minutes === 0
              ? "now" : duration.format(minutes, "minute")}</small>}</span>
          <span className={"status-badge " + booking.status}>{statuses[booking.status]}</span>
          <button type="button" aria-expanded={processing === booking.id} disabled={busy} onClick={() => {
            setEditing(null);
            setProcessing(booking.id);
          }}>Process</button>
        </div>
        {processing === booking.id && <dialog ref={showDialog} className="operator-processing"
          aria-labelledby={"process-" + booking.id} onClose={() => {
            setEditing(null);
            setProcessing(null);
          }}>
        <div className="dialog-heading">
          <h2 id={"process-" + booking.id}>Reservation {booking.reference}</h2>
          <form method="dialog"><button type="submit">Close</button></form>
        </div>
        <p>{booking.facility} / Space {booking.spot} / {booking.plate}</p>
        <p>{visitTime(booking.starts_at)} to {visitTime(booking.ends_at)} PKT</p>
        <p><span className={"status-badge " + booking.status}>{statuses[booking.status]}</span></p>
        {error && <p className="driver-feedback error" role="alert">{error}</p>}
        {booking.checked_in_at && <p>Checked in {visitTime(booking.checked_in_at)} PKT</p>}
        <Receipt booking={booking} />
        <div className="operator-actions">
          {booking.status === "confirmed" && <>
            <button disabled={busy || now < started || now >= checkInDeadline(booking)} onClick={() => changeStatus(booking, "check-in")}>Check in</button>
            <button disabled={busy} onClick={() => edit(booking)}>Reschedule</button>
            <button disabled={busy} onClick={() => changeStatus(booking, "cancel")}>Cancel booking</button>
          </>}
          {booking.status === "checked_in" && <button disabled={busy} onClick={() => changeStatus(booking, "check-out")}>Check out</button>}
          {booking.payment === "pending" && <button disabled={busy} onClick={() => changeStatus(booking, "record-payment")}>Mark payment complete</button>}
        </div>
        {booking.status === "confirmed" && (now < started || now >= checkInDeadline(booking)) &&
          <p>Check-in opens at the scheduled arrival time.</p>}
        {booking.status === "confirmed" && <p>Check-in closes at {visitTime(checkInDeadline(booking))} PKT.</p>}
        {editing?.booking.id === booking.id && <form className="driver-controls operator-edit" onSubmit={save}>
          <label>Space<select name="spot" defaultValue={booking.slot_id} required>
            {editing.spots.map((spot) => <option key={spot.id} value={spot.id}>{spot.label}</option>)}
          </select></label>
          <label>Arrival (PKT)<input name="arrival" type="datetime-local" defaultValue={localDateTime(booking.starts_at)} required /></label>
          <label>Departure (PKT)<input name="departure" type="datetime-local" defaultValue={localDateTime(booking.ends_at)} required /></label>
          <button className="primary" disabled={busy}>Save changes</button>
          <button type="button" onClick={() => setEditing(null)}>Close</button>
        </form>}
        </dialog>}
      </li>;
    })}</ul></div>}
    </section>
  </WorkspaceShell>;
}
