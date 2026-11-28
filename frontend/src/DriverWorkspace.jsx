import React, { useEffect, useRef, useState } from "react";
import Dropdown from "./Dropdown.jsx";
import DriverBookingCard from "./DriverBookingCard.jsx";
import DriverProfile from "./DriverProfile.jsx";
import { visitTime } from "./VisitDetails.jsx";
import { PageHeading, WorkspaceIcon, WorkspaceShell } from "./WorkspaceShell.jsx";
import { useLiveData } from "./useLiveData.js";
import "./driver.css";
import "./driver-theme.css";

const api = "/api/driver";
const mobileViewport = () => window.matchMedia("(max-width: 800px)").matches;
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
  const [fit, setFit] = useState(true);
  const mapScroll = useRef(null);
  const cells = [...layout.buildings, ...layout.spots];
  const columns = Math.max(1, ...cells.map((cell) => cell.grid_column + 1));
  const rows = Math.max(1, ...cells.map((cell) => cell.grid_row + 1));
  return <>
    <div className="driver-map-tools">
      <button type="button" aria-pressed={fit} onClick={() => {
        if (!fit) mapScroll.current.scrollTo(0, 0);
        setFit(!fit);
      }}>Fit to screen</button>
      <span>{fit ? "Turn off for larger spaces." : "Swipe or scroll to see more of the map."}</span>
    </div>
    <ul className="map-legend" aria-label="Space states">{states.map(([key, label]) =>
      <li className={key} key={key}>{label}</li>)}</ul>
    <div ref={mapScroll} className={"driver-map-scroll" + (fit ? " fitted" : "")}
      tabIndex={0} role="region" aria-label="Parking layout">
      <div className="driver-map" style={{ "--map-columns": columns, "--map-rows": rows }}>
        {Array.from({ length: rows * columns }, (_, index) => <span key={index}
          className="driver-lane" aria-hidden="true"
          style={{ gridRow: Math.floor(index / columns) + 1, gridColumn: index % columns + 1 }} />)}
        {layout.buildings.map((cell) => <span key={cell.grid_row + ":" + cell.grid_column}
          className="driver-building" style={position(cell)} title="Building"><strong>BLDG</strong></span>)}
        {layout.spots.map((spot) => {
          const state = spot.available ? "open" : spot.status === "closed" ? "closed"
            : spot.status === "occupied" ? "in-use" : spot.status === "reserved" ? "reserved" : "unavailable";
          const label = states.find(([key]) => key === state)[1];
          return <button key={spot.id} type="button" style={position(spot)} className={"space-cell " + state}
            aria-label={spot.label + ", " + label} title={spot.label + ", " + label} aria-pressed={selected === spot.id}
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
  const [openedBookingId, setOpenedBookingId] = useState(null);
  const [facilityId, setFacilityId] = useState(facilities[0]?.id || "");
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id || "");
  const [arrival, setArrival] = useState(initialVisit?.arrival || "");
  const [departure, setDeparture] = useState(initialVisit?.departure || "");
  const [layout, setLayout] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState(null);
  const [popup, setPopup] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  const pending = useRef(false);
  const dialog = useRef(null);
  const arrivalField = useRef(null);
  const departureField = useRef(null);
  const reservationHeading = useRef(null);
  const reservationError = useRef(null);
  const confirmationHeading = useRef(null);
  const bookingsHeading = useRef(null);
  const focusBookings = useRef(false);
  const [savedUsername, setSavedUsername] = useState(null);
  const [now, setNow] = useState(Date.now);
  const { data: latestProfile, error: profileError } = useLiveData(
    request, api + "/profile", (page !== "find" && page !== "profile") || busy, 30000,
  );
  const access = latestProfile || data.profile;
  const strikes = access?.strikes.filter((strike) => Date.parse(strike.expires_at) > now) || [];
  const nextExpiry = strikes[0]?.expires_at;
  const resumesAt = strikes[strikes.length - access?.strike_limit]?.expires_at;
  const visit = { starts_at: arrival + ":00+05:00", ends_at: departure + ":00+05:00" };
  const facility = facilities.find((item) => item.id === facilityId);
  const selectedSpot = layout?.spots.find((spot) => spot.id === selected);
  const duration = (Date.parse(visit.ends_at) - Date.parse(visit.starts_at)) / 3600000;
  const estimate = facility && price.format(duration * Number(facility.hourly_rate));

  useEffect(() => {
    if (popup) {
      if (!dialog.current.open) dialog.current.showModal();
      return;
    }
    if (busy) return;
    if (confirmed) confirmationHeading.current?.focus();
    if (page === "bookings" && focusBookings.current) {
      bookingsHeading.current?.focus();
      focusBookings.current = false;
    }
    if (failure?.target === "arrival") arrivalField.current?.focus();
    if (failure?.target === "departure") departureField.current?.focus();
    if (failure?.target === "reservation") reservationError.current?.focus();
  }, [busy, confirmed, failure, page, popup]);

  useEffect(() => {
    if (!nextExpiry) return;
    const delay = Math.max(0, Date.parse(nextExpiry) - Date.now());
    const timer = setTimeout(() => setNow(Date.now()), delay + 1);
    return () => clearTimeout(timer);
  }, [nextExpiry]);

  function resetMap() {
    setLayout(null);
    setSelected(null);
    setFailure(null);
    setConfirmed(null);
  }

  function navigate(next) {
    if (busy || next === page) return;
    resetMap();
    setMessage("");
    setOpenedBookingId(null);
    setPage(next);
  }

  function showFailure(text, target) {
    const mobile = mobileViewport();
    setFailure({ text, target, mobile });
    if (mobile) setPopup({ text });
  }

  async function perform(action, target) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    setFailure(null);
    try {
      await action();
    } catch (error) {
      showFailure(error.message, target);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function search() {
    const result = await request(api + "/facilities/" + facilityId + "/availability", "POST", visit);
    setLayout(result);
    setSelected(null);
  }

  function submitSearch(event) {
    event.preventDefault();
    if (!(duration > 0)) return showFailure("Departure must be later than arrival.", "departure");
    if (Date.parse(visit.starts_at) <= Date.now()) return showFailure("Choose an arrival time in the future.", "arrival");
    perform(search, "search");
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

  function deleteVehicle(vehicle) {
    perform(async () => {
      await request(api + "/vehicles/" + vehicle.id, "DELETE");
      const remaining = vehicles.filter((item) => item.id !== vehicle.id);
      setVehicles(remaining);
      if (vehicleId === vehicle.id) setVehicleId(remaining[0]?.id || "");
      setMessage("Vehicle " + vehicle.plate + " deleted.");
    });
  }

  function book() {
    if (confirmed || !selectedSpot?.available || !vehicleId || resumesAt) return;
    perform(async () => {
      try {
        const booking = await request(api + "/bookings", "POST", {
          ...visit, slot_id: selected, vehicle_id: vehicleId,
        });
        setBookings((previous) => [booking, ...previous]);
        setConfirmed(booking);
        if (mobileViewport()) setPopup({ booking });
      } catch (error) {
        if (error.code === "space_taken" || error.code === "space_unavailable" || error.status === 409) {
          setSelected(null);
          const status = error.code === "space_taken" ? "reserved" : "unavailable";
          setLayout((previous) => ({ ...previous, spots: previous.spots.map((spot) =>
            spot.id === selected ? { ...spot, available: false, status } : spot) }));
          showFailure(error.message, "reservation");
          await search().catch(() => {});
          return;
        }
        throw error;
      }
    }, "reservation");
  }

  function viewBooking() {
    focusBookings.current = true;
    setOpenedBookingId(confirmed.id);
    setConfirmed(null);
    setLayout(null);
    setSelected(null);
    setPage("bookings");
  }

  function closePopup() {
    dialog.current.close();
    setPopup(null);
    if (popup.booking) viewBooking();
  }

  function cancel(booking) {
    return perform(async () => {
      const updated = await request(api + "/bookings/" + booking.id + "/cancel", "POST");
      setBookings((previous) => previous.map((item) => item.id === updated.id ? updated : item));
    }, booking.id);
  }

  function saveUsername(username) {
    perform(async () => {
      const updated = await request(api + "/profile", "PUT", { username });
      setSavedUsername(updated.username);
      setMessage("Username saved.");
    });
  }

  const showReview = page === "find" && selectedSpot?.available && !confirmed;
  return <WorkspaceShell role="Driver" items={pages} page={page} onNavigate={navigate}
    onSignOut={onSignOut} transitionKey={Boolean(layout)} floatingAction={showReview &&
      <div className="mobile-reservation-action">
        <div><strong>Space {selectedSpot.label}</strong><span>{estimate} estimated</span></div>
        <button type="button" className="primary" disabled={busy}
          onClick={() => {
            reservationHeading.current?.focus({ preventScroll: true });
            reservationHeading.current?.scrollIntoView({ block: "start" });
          }}>Review reservation</button>
      </div>}>
    <section className={"driver-workspace" + (showReview ? " has-reservation-action" : "")}>
      {popup && <dialog className={"driver-popup" + (popup.booking ? "" : " error")} ref={dialog}
        aria-labelledby="driver-popup-title" aria-describedby="driver-popup-detail"
        onCancel={(event) => { event.preventDefault(); closePopup(); }}>
        <span className="driver-popup-icon" aria-hidden="true">{popup.booking ? "✓" : "!"}</span>
        <h2 id="driver-popup-title">{popup.booking ? "Booking confirmed" : "Action needed"}</h2>
        <p id="driver-popup-detail">{popup.booking ? "Booking reference " + popup.booking.reference : popup.text}</p>
        <button type="button" className="primary" onClick={closePopup}>
          {popup.booking ? "View booking" : "OK"}
        </button>
      </dialog>}
      {message && <p className="driver-feedback" role="status">{message}</p>}
      {failure && !failure.target && !failure.mobile && <p className="driver-feedback error" role="alert">{failure.text}</p>}
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
              <AvailabilityMap layout={layout} selected={selected} onSelect={(id) => {
                setSelected(id);
                setFailure(null);
              }} busy={busy || !!confirmed} />}
          </section>
          <section className="panel reservation-panel">{confirmed ? <>
            <h2 ref={confirmationHeading} tabIndex={-1}>Booking confirmed</h2>
            <p className="booking-reference">Booking reference <strong>{confirmed.reference}</strong></p>
            <button className="primary" type="button" onClick={viewBooking}>View booking</button>
          </> : <>
            <h2 ref={reservationHeading} tabIndex={-1}>Your reservation</h2>
            <dl className="summary-box">
              <div><dt>Facility</dt><dd>{facility.name}</dd></div>
              <div><dt>Parking space</dt><dd aria-live="polite">{selectedSpot ? <span className="selected-space-token" key={selectedSpot.id}>{selectedSpot.label}</span> : "Select a space"}</dd></div>
              <div><dt>Arrival</dt><dd>{visitTime(visit.starts_at)} PKT</dd></div>
              <div><dt>Departure</dt><dd>{visitTime(visit.ends_at)} PKT</dd></div>
              <div><dt>Duration</dt><dd>{new Intl.NumberFormat("en-PK", {
                style: "unit", unit: "hour", maximumFractionDigits: 2,
              }).format(duration)}</dd></div>
            </dl>
            {vehicles.length ? <Dropdown label="Saved vehicle" value={vehicleId} onChange={setVehicleId}
              disabled={busy} options={vehicles.map((vehicle) => ({ value: vehicle.id, label: vehicle.plate }))} /> : <p>Add a vehicle in My vehicles to reserve a space.</p>}
            <div className="reservation-total"><span>Estimated total</span>
              <strong>{estimate}</strong></div>
            {failure?.target === "reservation" && <p className="driver-feedback error" ref={reservationError}
              tabIndex={-1}>{failure.text}</p>}
            <button className="primary" type="button" disabled={busy || !!resumesAt || !selectedSpot?.available || !vehicleId}
              onClick={book}>{busy ? "Confirming…" : "Confirm reservation →"}</button>
          </>}</section>
        </div>
      </> : <>
        <PageHeading title="Find your next parking space" />
        {facility ? <div className="split-rails search-rails">
          <section className="panel">
            <h2>Plan your visit</h2>
            <form className="search-form" onSubmit={submitSearch} onChange={() => setFailure(null)}>
              <Dropdown label="Parking facility" value={facilityId} onChange={setFacilityId} disabled={busy}
                options={facilities.map((item) => ({ value: item.id, label: item.name }))} />
              <div className="search-rate"><span>Hourly rate</span><output>{price.format(facility.hourly_rate)} / hour</output></div>
              <label>Arrival · PKT<input ref={arrivalField} type="datetime-local" value={arrival} required disabled={busy}
                aria-invalid={failure?.target === "arrival" || undefined}
                aria-describedby={failure?.target === "arrival" ? "arrival-error" : undefined}
                onChange={(event) => setArrival(event.target.value)} />
                {failure?.target === "arrival" && <span className="field-error" id="arrival-error">{failure.text}</span>}
              </label>
              <label>Departure · PKT<input ref={departureField} type="datetime-local" value={departure} required disabled={busy}
                aria-invalid={failure?.target === "departure" || undefined}
                aria-describedby={failure?.target === "departure" ? "departure-error" : undefined}
                onChange={(event) => setDeparture(event.target.value)} />
                {failure?.target === "departure" && <span className="field-error" id="departure-error">{failure.text}</span>}
              </label>
              {failure?.target === "search" && !failure.mobile &&
                <p className="driver-feedback error search-error" role="alert">{failure.text}</p>}
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
            <button type="button" disabled={busy} aria-label={"Delete vehicle " + vehicle.plate}
              onClick={() => deleteVehicle(vehicle)}>Delete</button>
          </li>)}</ul> : <p>No vehicles saved yet.</p>}
      </>}
      {page === "bookings" && <>
        <PageHeading title="My bookings" headingRef={bookingsHeading} />
        {bookings.length ? <ul className="driver-bookings">{bookings.map((booking) =>
          <DriverBookingCard key={booking.id} booking={booking} initiallyExpanded={openedBookingId === booking.id}
            busy={busy} cancelError={!popup && failure?.target === booking.id ? failure.text : null}
            onCancel={cancel} onDismissError={() => setFailure(null)} />)}</ul> : <div className="panel"><p>No bookings yet.</p></div>}
      </>}
      {page === "profile" && <>
        {profileError && <p className="driver-feedback error" role="alert">{profileError}</p>}
        <DriverProfile username={savedUsername ?? access?.username} access={access} strikes={strikes}
          resumesAt={resumesAt} busy={busy} onSave={saveUsername} />
      </>}
    </section>
  </WorkspaceShell>;
}
