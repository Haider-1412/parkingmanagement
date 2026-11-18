import React, { useEffect, useState } from "react";
import { localDateTime, visitTime, Receipt } from "./VisitDetails.jsx";
import "./driver.css";

const operatorPath = "/api/operator";
const statuses = {
  confirmed: "Confirmed", checked_in: "Checked in", completed: "Completed", cancelled: "Cancelled", no_show: "No-show",
};

export default function OperatorWorkspace({ facilities, request }) {
  const [bookings, setBookings] = useState([]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState("");
  const [now, setNow] = useState(Date.now);
  const path = operatorPath + "/bookings";

  async function load(query = filters) {
    const data = await request(path + (query ? "?" + query : ""));
    setBookings(data.bookings);
  }

  async function run(action) {
    setBusy(true);
    setError("");
    setNotice("");
    try { await action(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  useEffect(() => { run(() => load("")); }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  function search(event) {
    event.preventDefault();
    const query = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (value.trim()) query.set(key, value.trim());
    }
    setFilters(query.toString());
    setEditing(null);
    run(() => load(query.toString()));
  }

  function changeStatus(booking, action) {
    run(async () => {
      await request(path + "/" + booking.id + "/" + action, "POST");
      setEditing(null);
      setNotice("Booking " + booking.reference + " updated.");
      await load();
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
      setNotice("Booking rescheduled.");
      await load();
    });
  }

  return <section className="directory driver-workspace">
    <h1>Reservations</h1>
    <form className="driver-controls" onSubmit={search}>
      <label>Facility<select name="facility_id"><option value="">All facilities</option>
        {facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
      </select></label>
      <label>Booking date (PKT)<input type="date" name="day" /></label>
      <label>Status<select name="status"><option value="">All statuses</option>
        {Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>Booking reference<input name="reference" maxLength={12} /></label>
      <button className="primary" disabled={busy}>Search</button>
    </form>
    {notice && <p className="driver-feedback" role="status">{notice}</p>}
    {error && <p className="driver-feedback error" role="alert">{error}</p>}
    {busy && !bookings.length && <p role="status">Loading reservations…</p>}
    {!busy && !bookings.length && <p>{facilities.length
      ? "No matching reservations." : "No facilities assigned. Ask your facility manager to add you."}</p>}
    <ul className="directory-list operator-bookings">{bookings.map((booking) => {
      const started = Date.parse(booking.starts_at);
      const ended = Date.parse(booking.ends_at);
      return <li key={booking.id}>
        <h2>{booking.reference} · {booking.facility}</h2>
        <p>{booking.spot} · {booking.plate} · {statuses[booking.status]}</p>
        <p>{visitTime(booking.starts_at)} to {visitTime(booking.ends_at)} PKT</p>
        {booking.checked_in_at && <p>Checked in {visitTime(booking.checked_in_at)} PKT</p>}
        <Receipt booking={booking} />
        <div className="operator-actions">
          {booking.status === "confirmed" && <>
            <button disabled={busy || now < started || now >= ended} onClick={() => changeStatus(booking, "check-in")}>Check in</button>
            <button disabled={busy || now < Math.min(started + 900000, ended)} onClick={() => changeStatus(booking, "no-show")}>Mark no-show</button>
            <button disabled={busy} onClick={() => edit(booking)}>Reschedule</button>
            <button disabled={busy} onClick={() => changeStatus(booking, "cancel")}>Cancel booking</button>
          </>}
          {booking.status === "checked_in" && <button disabled={busy} onClick={() => changeStatus(booking, "check-out")}>Check out</button>}
          {booking.payment === "pending" && <button disabled={busy} onClick={() => changeStatus(booking, "record-payment")}>Mark payment complete</button>}
        </div>
        {editing?.booking.id === booking.id && <form className="driver-controls operator-edit" onSubmit={save}>
          <label>Space<select name="spot" defaultValue={booking.slot_id} required>
            {editing.spots.map((spot) => <option key={spot.id} value={spot.id}>{spot.label}</option>)}
          </select></label>
          <label>Arrival (PKT)<input name="arrival" type="datetime-local" defaultValue={localDateTime(booking.starts_at)} required /></label>
          <label>Departure (PKT)<input name="departure" type="datetime-local" defaultValue={localDateTime(booking.ends_at)} required /></label>
          <button className="primary" disabled={busy}>Save changes</button>
          <button type="button" onClick={() => setEditing(null)}>Close</button>
        </form>}
      </li>;
    })}</ul>
  </section>;
}
