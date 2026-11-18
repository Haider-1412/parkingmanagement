import React, { useState } from "react";
import { Receipt } from "./VisitDetails.jsx";
import "./driver.css";

const driverApi = "/api/driver";
const timeFormat = new Intl.DateTimeFormat("en-PK", {
  timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short",
});
const position = ({ grid_row, grid_column }) => ({
  gridRow: grid_row + 1, gridColumn: grid_column + 1,
});

function AvailabilityMap({ layout, selected, onSelect, busy }) {
  const cells = [...layout.buildings, ...layout.spots];
  const columns = Math.max(1, ...cells.map((cell) => cell.grid_column + 1));
  const rows = Math.max(1, ...cells.map((cell) => cell.grid_row + 1));
  return <div className="driver-map-scroll">
    <div className="driver-map" aria-label="Parking layout" style={{
      gridTemplateColumns: "repeat(" + columns + ", var(--map-cell))",
      gridTemplateRows: "repeat(" + rows + ", var(--map-cell))",
    }}>
      {layout.buildings.map((cell) => <span key={cell.grid_row + ":" + cell.grid_column}
        className="driver-building" style={position(cell)} title="Building" />)}
      {layout.spots.map((spot) => <button key={spot.id} type="button" style={position(spot)}
        aria-label={spot.label + (spot.available ? "" : ", unavailable")}
        aria-pressed={selected === spot.id} disabled={!spot.available || busy}
        className={spot.available ? "" : "unavailable"}
        onClick={() => onSelect(spot.id)}>{spot.label}</button>)}
    </div>
  </div>;
}

export default function DriverWorkspace({ data, request }) {
  const { facilities } = data;
  const [vehicles, setVehicles] = useState(data.vehicles);
  const [bookings, setBookings] = useState(data.bookings);
  const [facilityId, setFacilityId] = useState(facilities[0]?.id || "");
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id || "");
  const [arrival, setArrival] = useState("");
  const [departure, setDeparture] = useState("");
  const [layout, setLayout] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const window = { starts_at: arrival + ":00+05:00", ends_at: departure + ":00+05:00" };
  const facility = facilities.find((item) => item.id === facilityId);

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

  function updateSearch(setter, value) {
    setter(value);
    setLayout(null);
    setSelected(null);
  }

  async function search() {
    const result = await request(driverApi + "/facilities/" + facilityId + "/availability", "POST", window);
    setLayout(result);
    setSelected(null);
  }

  function addVehicle(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const plate = new FormData(form).get("plate");
    perform(async () => {
      const vehicle = await request(driverApi + "/vehicles", "POST", { plate });
      setVehicles([...vehicles, vehicle]);
      setVehicleId(vehicle.id);
      form.reset();
      setMessage("Vehicle added.");
    });
  }

  function book() {
    perform(async () => {
      try {
        const booking = await request(driverApi + "/bookings", "POST", {
          ...window, slot_id: selected, vehicle_id: vehicleId,
        });
        setBookings((previous) => [booking, ...previous]);
        setMessage("Booking confirmed. Reference " + booking.reference + ".");
        setLayout((previous) => ({ ...previous, spots: previous.spots.map((spot) =>
          spot.id === selected ? { ...spot, available: false } : spot) }));
        setSelected(null);
      } catch (error) {
        if (error.status === 409 || error.status === 404) {
          await search().catch(() => {
            setLayout(null);
            setSelected(null);
          });
        }
        throw error;
      }
    });
  }

  function cancel(booking) {
    perform(async () => {
      const updated = await request(driverApi + "/bookings/" + booking.id + "/cancel", "POST");
      setBookings((previous) => previous.map((item) => item.id === updated.id ? updated : item));
      setLayout(null);
      setSelected(null);
      setMessage("Booking " + booking.reference + " cancelled.");
    });
  }

  return <section className="directory driver-workspace">
    <h1>Find parking</h1>
    {message && <p className="driver-feedback" role="status">{message}</p>}
    {failure && <p className="driver-feedback error" role="alert">{failure}</p>}
    {facilities.length ? <>
      <form className="driver-controls" onSubmit={(event) => {
        event.preventDefault();
        perform(search);
      }}>
        <label>Facility<select value={facilityId} disabled={busy}
          onChange={(event) => updateSearch(setFacilityId, event.target.value)}>
          {facilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>Arrival (PKT)<input type="datetime-local" value={arrival} required disabled={busy}
          onChange={(event) => updateSearch(setArrival, event.target.value)} /></label>
        <label>Departure (PKT)<input type="datetime-local" value={departure} required disabled={busy}
          onChange={(event) => updateSearch(setDeparture, event.target.value)} /></label>
        <button className="primary" disabled={busy}>Find spaces</button>
      </form>
      {facility && <p className="facility-rate">{facility.address} · PKR {facility.hourly_rate}/hour</p>}
      {layout && <>
        {layout.closed ? <p>This facility is closed during part of the selected time.</p>
          : !layout.spots.some((spot) => spot.available) && <p>No spaces are available for this time.</p>}
        {(layout.spots.length > 0 || layout.buildings.length > 0) &&
          <AvailabilityMap layout={layout} selected={selected} onSelect={setSelected} busy={busy} />}
        {selected && <div className="driver-controls booking-controls">
          {vehicles.length ? <label>Vehicle<select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} disabled={busy}>
            {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate}</option>)}
          </select></label> : <p>Add a vehicle below to reserve this space.</p>}
          <button className="primary" type="button" disabled={busy || !vehicleId} onClick={book}>Reserve space</button>
        </div>}
      </>}
    </> : <div className="directory-empty">
      <h2>No facilities available yet</h2>
      <p>Facilities will appear here after a Facility Manager adds them.</p>
    </div>}

    <section className="driver-section">
      <h2>My vehicles</h2>
      {vehicles.length > 0 && <p>{vehicles.map((vehicle) => vehicle.plate).join(" · ")}</p>}
      <form className="driver-controls" onSubmit={addVehicle}>
        <label>Registration plate<input name="plate" required maxLength={24} disabled={busy} /></label>
        <button disabled={busy}>Add vehicle</button>
      </form>
    </section>

    <section className="driver-section">
      <h2>My bookings</h2>
      {bookings.length ? <ul className="directory-list driver-bookings">{bookings.map((booking) =>
        <li key={booking.id}>
          <div>
            <strong>{booking.facility} · {booking.spot}</strong>
            <p>{timeFormat.format(new Date(booking.starts_at))} – {timeFormat.format(new Date(booking.ends_at))} PKT</p>
            <p>{booking.reference} · {booking.plate} · {booking.status}</p>
            <Receipt booking={booking} />
          </div>
          {booking.can_cancel && new Date(booking.starts_at) > new Date() &&
            <button type="button" disabled={busy} onClick={() => cancel(booking)}>Cancel booking</button>}
        </li>)}</ul> : <p>No bookings yet.</p>}
    </section>
  </section>;
}
