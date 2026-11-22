import React, { useEffect, useState } from "react";
import Dropdown from "./Dropdown.jsx";
import DriverProfile from "./DriverProfile.jsx";
import { Receipt, visitTime } from "./VisitDetails.jsx";
import { PageHeading, WorkspaceIcon, WorkspaceShell } from "./WorkspaceShell.jsx";
import { useLiveData } from "./useLiveData.js";
import "./driver.css";
import "./driver-theme.css";

const api = "/api/driver";
const pages = [
  { id: "find", label: "Find parking" },
  { id: "vehicles", label: "My vehicles" },
  { id: "bookings", label: "My bookings" },
  { id: "profile", label: "Profile" },
];
const price = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" });
const position = (cell) => ({ gridRow: cell.grid_row + 1, gridColumn: cell.grid_column + 1 });
const states = [
  ["open", "Open"], ["in-use", "In use"], ["closed", "Closed"],
  ["selected", "Selected"], ["building", "Building"], ["reserved", "Reserved"], ["unavailable", "Unavailable"],
];

function AvailabilityMap({ layout, selected, onSelect, busy }) {
  const cells = [...layout.buildings, ...layout.spots];
  const columns = Math.max(1, ...cells.map((cell) => cell.grid_column + 1));
  const rows = Math.max(1, ...cells.map((cell) => cell.grid_row + 1));
  return <>
    <ul className="map-legend" aria-label="Space states">{states.map(([key, label]) =>
      <li className={key} key={key}>{label}</li>)}</ul>
    <div className="driver-map-scroll" tabIndex={0} role="region" aria-label="Scrollable parking layout">
      <div className="driver-map" style={{
        gridTemplateColumns: "repeat(" + columns + ", var(--map-cell))",
        gridTemplateRows: "repeat(" + rows + ", var(--map-cell))",
      }}>
        {Array.from({ length: rows * columns }, (_, index) => <span key={index}
          className="driver-lane" aria-hidden="true"
          style={{ gridRow: Math.floor(index / columns) + 1, gridColumn: index % columns + 1 }} />)}
        {layout.buildings.map((cell) => <span key={cell.grid_row + ":" + cell.grid_column}
          className="driver-building" style={position(cell)} title="Building">BLDG</span>)}
        {layout.spots.map((spot) => {
          const state = spot.available ? "open" : spot.status === "closed" ? "closed"
            : spot.status === "occupied" ? "in-use" : spot.status === "reserved" ? "reserved" : "unavailable";
          const label = states.find(([key]) => key === state)[1];
          return <button key={spot.id} type="button" style={position(spot)} className={"space-cell " + state}
            aria-label={spot.label + ", " + label} aria-pressed={selected === spot.id}
            disabled={!spot.available || busy} onClick={() => onSelect(spot.id)}>
            <strong>{spot.label}</strong><small>{label}</small>
          </button>;
        })}
      </div>
    </div>
  </>;
}

export default function DriverWorkspace({ data, request, onSignOut, initialVisit }) {
  const { facilities } = data;
  const [page, setPage] = useState("find");
  const [vehicles, setVehicles] = useState(data.vehicles);
  const [bookings, setBookings] = useState(data.bookings);
  const [facilityId, setFacilityId] = useState(facilities[0]?.id || "");
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id || "");
  const [arrival, setArrival] = useState(initialVisit?.arrival || "");
  const [departure, setDeparture] = useState(initialVisit?.departure || "");
  const [layout, setLayout] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [savedUsername, setSavedUsername] = useState(null);
  const [now, setNow] = useState(Date.now);
  const { data: latestProfile, error: profileError } = useLiveData(
    request, api + "/profile", (page !== "find" && page !== "profile") || busy, 30000,
  );
  const access = latestProfile || data.profile;
  const strikes = access?.strikes.filter((strike) => Date.parse(strike.expires_at) > now) || [];
  const nextExpiry = strikes[0]?.expires_at;
  const resumesAt = strikes[strikes.length - access?.strike_limit]?.expires_at;
  const window = { starts_at: arrival + ":00+05:00", ends_at: departure + ":00+05:00" };
  const facility = facilities.find((item) => item.id === facilityId);
  const selectedSpot = layout?.spots.find((spot) => spot.id === selected);
  const duration = (Date.parse(window.ends_at) - Date.parse(window.starts_at)) / 3600000;

  useEffect(() => {
    if (!nextExpiry) return;
    const delay = Math.max(0, Date.parse(nextExpiry) - Date.now());
    const timer = setTimeout(() => setNow(Date.now()), delay + 1);
    return () => clearTimeout(timer);
  }, [nextExpiry]);

  function resetMap() {
    setLayout(null);
    setSelected(null);
    setFailure("");
  }

  function navigate(next) {
    if (busy || next === page) return;
    resetMap();
    setMessage("");
    setPage(next);
  }

  async function perform(action) {
    setBusy(true);
    setMessage("");
    setFailure("");
    try {
      await action();
    } catch (error) {
      setFailure(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    if (!(duration > 0)) throw new Error("Departure must be later than arrival.");
    if (Date.parse(window.starts_at) < Date.now()) throw new Error("Choose an arrival time in the future.");
    const result = await request(api + "/facilities/" + facilityId + "/availability", "POST", window);
    setLayout(result);
    setSelected(null);
  }

  function addVehicle(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const plate = new FormData(form).get("plate");
    perform(async () => {
      const vehicle = await request(api + "/vehicles", "POST", { plate });
      setVehicles((previous) => [...previous, vehicle]);
      setVehicleId(vehicle.id);
      form.reset();
      setMessage("Vehicle added.");
    });
  }

  function book() {
    perform(async () => {
      try {
        const booking = await request(api + "/bookings", "POST", {
          ...window, slot_id: selected, vehicle_id: vehicleId,
        });
        setBookings((previous) => [booking, ...previous]);
        setMessage("Booking confirmed. Reference " + booking.reference + ".");
        resetMap();
        setPage("bookings");
      } catch (error) {
        if (error.status === 409 || error.status === 404) await search().catch(resetMap);
        throw error;
      }
    });
  }

  function cancel(booking) {
    perform(async () => {
      const updated = await request(api + "/bookings/" + booking.id + "/cancel", "POST");
      setBookings((previous) => previous.map((item) => item.id === updated.id ? updated : item));
      setMessage("Booking " + booking.reference + " cancelled.");
    });
  }

  function saveUsername(username) {
    perform(async () => {
      const updated = await request(api + "/profile", "PUT", { username });
      setSavedUsername(updated.username);
      setMessage("Username saved.");
    });
  }

  return <WorkspaceShell role="Driver" items={pages} page={page} onNavigate={navigate}
    onSignOut={onSignOut} transitionKey={Boolean(layout)}>
    <section className="driver-workspace">
      {message && <p className="driver-feedback" role="status">{message}</p>}
      {failure && <p className="driver-feedback error" role="alert">{failure}</p>}
      {page === "find" && resumesAt && <div className="driver-feedback error suspension-notice" role="status">
        <p>New bookings are suspended until {visitTime(resumesAt)} PKT.</p>
        <button type="button" disabled={busy} onClick={() => navigate("profile")}>View strikes</button>
      </div>}
      {page === "find" && !!facilities.length && <ol className="booking-steps" aria-label="Booking progress">
        <li aria-current={!layout ? "step" : undefined}>
          {layout ? <button type="button" disabled={busy} onClick={resetMap}><span aria-hidden="true">✓</span> Plan visit</button>
            : <><span aria-hidden="true">1</span> Plan visit</>}
        </li>
        <li aria-current={layout ? "step" : undefined}><span aria-hidden="true">2</span> Choose space</li>
      </ol>}
      {page === "find" && (layout ? <>
        <PageHeading title="Select a parking space"
          action={<button type="button" disabled={busy} onClick={resetMap}>← Edit search</button>} />
        <div className="split-rails">
          <section className="panel map-panel">
            <div className="map-panel-heading"><div><h2>{facility.name}</h2><p>{facility.address}</p></div>
              <span className="availability-count">{layout.spots.filter((spot) => spot.available).length} open</span>
            </div>
            {layout.closed ? <p role="status">This facility is closed during part of the selected time.</p>
              : !layout.spots.some((spot) => spot.available) && <p role="status">No spaces are available for this time.</p>}
            {!!(layout.spots.length || layout.buildings.length) &&
              <AvailabilityMap layout={layout} selected={selected} onSelect={setSelected} busy={busy} />}
          </section>
          <section className="panel reservation-panel">
            <h2>Your reservation</h2>
            <dl className="summary-box">
              <div><dt>Facility</dt><dd>{facility.name}</dd></div>
              <div><dt>Parking space</dt><dd aria-live="polite">{selectedSpot ? <span className="selected-space-token" key={selectedSpot.id}>{selectedSpot.label}</span> : "Select a space"}</dd></div>
              <div><dt>Arrival</dt><dd>{visitTime(window.starts_at)} PKT</dd></div>
              <div><dt>Departure</dt><dd>{visitTime(window.ends_at)} PKT</dd></div>
              <div><dt>Duration</dt><dd>{new Intl.NumberFormat("en-PK", {
                style: "unit", unit: "hour", maximumFractionDigits: 2,
              }).format(duration)}</dd></div>
            </dl>
            {vehicles.length ? <Dropdown label="Saved vehicle" value={vehicleId} onChange={setVehicleId}
              disabled={busy} options={vehicles.map((vehicle) => ({ value: vehicle.id, label: vehicle.plate }))} /> : <p>Add a vehicle in My vehicles to reserve a space.</p>}
            <div className="reservation-total"><span>Estimated total</span>
              <strong>{price.format(duration * Number(facility.hourly_rate))}</strong></div>
            <button className="primary" type="button" disabled={busy || !!resumesAt || !selectedSpot?.available || !vehicleId}
              onClick={book}>{busy ? "Confirming…" : "Confirm reservation →"}</button>
          </section>
        </div>
      </> : <>
        <PageHeading title="Find your next parking space" />
        {facility ? <div className="split-rails search-rails">
          <section className="panel">
            <h2>Plan your visit</h2>
            <form className="search-form" onSubmit={(event) => {
              event.preventDefault();
              perform(search);
            }}>
              <Dropdown label="Parking facility" value={facilityId} onChange={setFacilityId} disabled={busy}
                options={facilities.map((item) => ({ value: item.id, label: item.name }))} />
              <div className="search-rate"><span>Hourly rate</span><output>{price.format(facility.hourly_rate)} / hour</output></div>
              <label>Arrival · PKT<input type="datetime-local" value={arrival} required disabled={busy}
                onChange={(event) => setArrival(event.target.value)} /></label>
              <label>Departure · PKT<input type="datetime-local" value={departure} required disabled={busy}
                onChange={(event) => setDeparture(event.target.value)} /></label>
              <button className="primary" disabled={busy}>{busy ? "Checking availability…" : "Search available spaces →"}</button>
            </form>
          </section>
          <section className="panel hover-card facility-feature">
            <h2>Selected facility</h2>
            <div className="facility-banner" key={facility.id}>
              <span className="facility-pin"><WorkspaceIcon name="find" /></span>
              <h3>{facility.name}</h3><p>{facility.address}</p>
            </div>
            <dl className="summary-box">
              <div><dt>Rate</dt><dd>{price.format(facility.hourly_rate)} / hour</dd></div>
              <div><dt>Operating hours</dt><dd>{facility.opens_at && facility.closes_at
                ? facility.opens_at.slice(0, 5) + " - " + facility.closes_at.slice(0, 5) + " PKT"
                : "24 hours"}</dd></div>
            </dl>
          </section>
        </div> : <div className="panel"><h2>No facilities available yet</h2>
          <p>Facilities will appear here once a manager registers them.</p></div>}
      </>)}
      {page === "vehicles" && <>
        <PageHeading title="My vehicles" />
        <section className="panel vehicle-form">
          <h2>Add a vehicle</h2>
          <form className="driver-controls" onSubmit={addVehicle}>
            <label>Registration plate<input name="plate" required maxLength={24} disabled={busy} /></label>
            <button className="primary" disabled={busy}>Add vehicle</button>
          </form>
        </section>
        {vehicles.length ? <ul className="directory-list driver-section">{vehicles.map((vehicle) =>
          <li key={vehicle.id} className="vehicle-row hover-card">
            <WorkspaceIcon name="vehicles" /><strong>{vehicle.plate}</strong>
          </li>)}</ul> : <p>No vehicles saved yet.</p>}
      </>}
      {page === "bookings" && <>
        <PageHeading title="My bookings" />
        {bookings.length ? <ul className="directory-list driver-bookings">{bookings.map((booking) =>
          <li key={booking.id} className="hover-card">
            <div>
              <strong>{booking.facility} · {booking.spot}</strong>
              <p>{visitTime(booking.starts_at)} – {visitTime(booking.ends_at)} PKT</p>
              <p>{booking.reference} · {booking.plate}</p>
              <span className={"status-badge " + booking.status}>{booking.status.replaceAll("_", " ")}</span>
              <Receipt booking={booking} />
            </div>
            {booking.can_cancel && new Date(booking.starts_at) > new Date() &&
              <button type="button" disabled={busy} onClick={() => cancel(booking)}>Cancel booking</button>}
          </li>)}</ul> : <div className="panel"><p>No bookings yet.</p></div>}
      </>}
      {page === "profile" && <>
        {profileError && <p className="driver-feedback error" role="alert">{profileError}</p>}
        <DriverProfile username={savedUsername ?? access?.username} access={access} strikes={strikes}
          resumesAt={resumesAt} busy={busy} onSave={saveUsername} />
      </>}
    </section>
  </WorkspaceShell>;
}
