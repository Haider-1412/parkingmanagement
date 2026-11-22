import { effectiveStatus } from "./operatorQueue.js";
import { localDateTime } from "./VisitDetails.jsx";

const iso = (dateTime) => dateTime + ":00+05:00";
const timeAt = (days, time) => localDateTime(new Date(Date.now() + days * 86400000)).slice(0, 10) + "T" + time;
const overlaps = (a, b) => Date.parse(a.starts_at) < Date.parse(b.ends_at) &&
  Date.parse(a.ends_at) > Date.parse(b.starts_at);

export function createPreviewData() {
  const visit = { arrival: timeAt(1, "09:00"), departure: timeAt(1, "11:00") };
  const now = Date.now();
  const vehicles = [{ id: "v1", plate: "ICT-1234" }, { id: "v2", plate: "LEA-9087" }];
  const rows = ["S.SSSSSS", "SS....SS", "SSBB..SS", "SSBB..SS", "SS....SS", "SSSSSSSS"];
  const facilities = [
    ["Blue Area Central", "Jinnah Avenue, Blue Area, Islamabad", 180],
    ["F-6 Community Plaza", "School Road, F-6 Markaz, Islamabad", 150],
    ["I-8 Business Centre", "I-8 Markaz, Islamabad", 120],
  ].map(([name, address, hourly_rate], index) => {
    const id = "facility-" + index;
    const spots = [];
    const buildings = [];
    rows.forEach((row, grid_row) => Array.from(row).forEach((cell, grid_column) => {
      if (cell === "B") buildings.push({ grid_row, grid_column });
      if (cell === "S") {
        const number = spots.length + 1;
        spots.push({ id: id + "-" + number, label: "ABC"[index] + String(number).padStart(2, "0"), grid_row, grid_column });
      }
    }));
    return { id, name, address, hourly_rate, opens_at: index === 1 ? null : "06:00", closes_at: index === 1 ? null : "23:00",
      spots, buildings, maintenance: [0, 13, 20, 27].map((position) => ({
        id: crypto.randomUUID(), slot_id: spots[position].id, starts_at: iso(timeAt(-1, "06:00")), ends_at: iso(timeAt(2, "23:00")),
      })), operators: [{ id: "op-1", email: "operator@parking.example" }] };
  });
  const bookings = [];
  function addBooking(facility, spot, vehicle, window, status, details = {}) {
    const booking = {
      id: crypto.randomUUID(), reference: "PK-" + (2048 + bookings.length), facility: facility.name,
      facility_id: facility.id, slot_id: spot.id, spot: spot.label, plate: vehicle.plate,
      status, ...window, ...details,
    };
    bookings.unshift(booking);
    return booking;
  }
  const tomorrow = { starts_at: iso(visit.arrival), ends_at: iso(visit.departure) };
  const current = { starts_at: new Date(now - 30 * 60000).toISOString(), ends_at: iso(timeAt(2, "11:00")) };
  const yesterday = { starts_at: iso(timeAt(-1, "14:00")), ends_at: iso(timeAt(-1, "16:00")) };
  const blue = facilities[0];
  addBooking(facilities[1], facilities[1].spots[5], vehicles[0], yesterday, "completed", {
    charge: 300, visit_rate: 150, payment: "completed", checked_in_at: yesterday.starts_at, checked_out_at: yesterday.ends_at,
  });
  addBooking(facilities[2], facilities[2].spots[2], vehicles[1], yesterday, "cancelled");
  addBooking(facilities[1], facilities[1].spots[7], vehicles[0], yesterday, "no_show");
  addBooking(blue, blue.spots[10], vehicles[1], current, "checked_in", { checked_in_at: current.starts_at });
  addBooking(blue, blue.spots[4], vehicles[0], tomorrow, "confirmed");
  addBooking(blue, blue.spots[17], vehicles[1], tomorrow, "confirmed");

  const relativeWindow = (start, end) => ({
    starts_at: new Date(now + start * 60000).toISOString(),
    ends_at: new Date(now + end * 60000).toISOString(),
  });
  addBooking(blue, blue.spots[1], vehicles[0], relativeWindow(-12, 40), "confirmed");
  addBooking(blue, blue.spots[2], vehicles[1], relativeWindow(-4, 4), "confirmed");
  addBooking(blue, blue.spots[3], vehicles[0], relativeWindow(-20, 45), "confirmed");
  const today = localDateTime(now).slice(0, 10);
  const midnight = Date.parse(iso(today + "T00:00"));
  [180, 320, 240, 560, 350, 670, 420].forEach((charge, index, samples) => {
    const facility = facilities[index % facilities.length];
    const paidAt = midnight + (now - midnight) * (index + 1) / samples.length;
    addBooking(facility, facility.spots[5], vehicles[index % vehicles.length], {
      starts_at: new Date(paidAt - 7200000).toISOString(),
      ends_at: new Date(paidAt).toISOString(),
    }, "completed", {
      charge, visit_rate: facility.hourly_rate, payment: "completed",
      paid_at: new Date(paidAt).toISOString(),
      checked_in_at: new Date(paidAt - 7200000).toISOString(),
      checked_out_at: new Date(paidAt).toISOString(),
    });
  });

  function snapshot(facility) {
    return { ...facility, spots: facility.spots.map((spot) => ({
      ...spot, occupied: bookings.some((booking) => booking.slot_id === spot.id && booking.status === "checked_in"),
    })) };
  }

  function bookingResponse(booking) {
    const status = effectiveStatus(booking, Date.now());
    return { ...booking, status, can_cancel: status === "confirmed" && Date.parse(booking.starts_at) > Date.now() };
  }

  async function request(path, method = "GET", body) {
    const url = new URL(path, location.origin);
    const [, , role, collection, id, action, item, detail] = url.pathname.split("/");
    const filters = url.searchParams;
    const facility = facilities.find((record) => record.id === id);
    const booking = bookings.find((record) => record.id === id);

    if (role === "operator" && collection === "dashboard") {
      const asOf = new Date();
      const today = localDateTime(asOf).slice(0, 10);
      const records = bookings.map(bookingResponse).filter((entry) =>
        !filters.get("facility_id") || entry.facility_id === filters.get("facility_id"));
      return {
        as_of: asOf.toISOString(),
        waiting: records.filter((entry) => entry.status === "confirmed" && localDateTime(entry.starts_at).slice(0, 10) <= today).length,
        occupied: records.filter((entry) => entry.status === "checked_in").length,
        sales: records.filter((entry) => entry.paid_at && localDateTime(entry.paid_at).startsWith(today) && Date.parse(entry.paid_at) <= asOf.getTime())
          .sort((left, right) => Date.parse(right.paid_at) - Date.parse(left.paid_at))
          .map((entry) => ({ ...entry, amount: entry.charge })),
      };
    }

    if (collection === "vehicles" && method === "POST") {
      const plate = body.plate.trim().toUpperCase();
      if (!plate || vehicles.some((vehicle) => vehicle.plate === plate)) throw new Error("Enter a new registration plate.");
      const vehicle = { id: crypto.randomUUID(), plate };
      vehicles.push(vehicle);
      return vehicle;
    }
    if (collection === "bookings") {
      if (role === "driver" && method === "POST" && !id) {
        const owner = facilities.find((record) => record.spots.some((spot) => spot.id === body.slot_id));
        const spot = owner?.spots.find((record) => record.id === body.slot_id);
        const vehicle = vehicles.find((record) => record.id === body.vehicle_id);
        if (!spot || !vehicle) throw new Error("Select a space and vehicle.");
        return bookingResponse(addBooking(owner, spot, vehicle,
          { starts_at: body.starts_at, ends_at: body.ends_at }, "confirmed"));
      }
      if (method === "GET") {
        const query = (filters.get("search") || "").toUpperCase();
        return { bookings: bookings.map(bookingResponse).filter((entry) =>
          (!filters.get("facility_id") || entry.facility_id === filters.get("facility_id")) &&
          (!filters.get("status") || entry.status === filters.get("status")) &&
          (!filters.get("active") || ["confirmed", "checked_in"].includes(entry.status) || entry.payment === "pending") &&
          (!filters.get("day") || overlaps(entry, {
            starts_at: iso(filters.get("day") + "T00:00"),
            ends_at: new Date(Date.parse(iso(filters.get("day") + "T00:00")) + 86400000).toISOString(),
          })) &&
          (!query || entry.reference.includes(query) || entry.plate.includes(query)),
        ) };
      }
      if (!booking) throw new Error("Reservation not found.");
      if (effectiveStatus(booking, Date.now()) === "no_show") throw new Error("This booking is a no-show.");
      if (method === "PUT") {
        if (Date.parse(body.starts_at) >= Date.parse(body.ends_at)) throw new Error("Departure must be later than arrival.");
        const owner = facilities.find((record) => record.id === booking.facility_id);
        const spot = owner.spots.find((record) => record.id === body.slot_id);
        Object.assign(booking, body, { spot: spot.label });
      } else if (action === "check-out") {
        Object.assign(booking, { status: "completed", checked_out_at: new Date().toISOString(),
          charge: 360, visit_rate: 180, payment: "pending" });
      } else if (action === "record-payment") {
        booking.payment = "completed";
        booking.paid_at ||= new Date().toISOString();
      } else {
        booking.status = { cancel: "cancelled", "check-in": "checked_in", "no-show": "no_show" }[action];
        if (action === "check-in") booking.checked_in_at = new Date().toISOString();
      }
      return bookingResponse(booking);
    }
    if (collection !== "facilities") throw new Error("This action is unavailable in the preview.");
    if (!id && method === "POST") {
      const record = { id: crypto.randomUUID(), ...body, buildings: [], spots: [], maintenance: [], operators: [] };
      facilities.push(record);
      return snapshot(record);
    }
    if (!facility) throw new Error("Facility not found.");
    if (action === "availability") {
      return { buildings: facility.buildings, closed: false, spots: facility.spots.map((spot) => {
        const conflict = bookings.find((entry) => entry.slot_id === spot.id &&
          ["confirmed", "checked_in"].includes(effectiveStatus(entry, Date.now())) && overlaps(entry, body));
        const closed = facility.maintenance.some((closure) => closure.slot_id === spot.id && overlaps(closure, body));
        const status = closed ? "closed" : conflict?.status === "checked_in" ? "occupied" : conflict ? "reserved" : "open";
        return { ...spot, status, available: status === "open" };
      }) };
    }
    if (action === "spots" && method === "GET") return { spots: facility.spots };
    if (action === "layout") {
      facility.spots = body.spots.map((spot) => ({ ...spot, id: spot.id || crypto.randomUUID() }));
      facility.buildings = body.buildings;
    } else if (action === "spots" && detail === "maintenance") {
      if (Date.parse(body.starts_at) >= Date.parse(body.ends_at)) throw new Error("Closure end must follow its start.");
      facility.maintenance.push({ ...body, slot_id: item, id: crypto.randomUUID() });
    } else if (action === "maintenance" && method === "DELETE") {
      facility.maintenance = facility.maintenance.filter((closure) => closure.id !== item);
    } else if (action === "operators") {
      if (method === "POST") {
        if (facility.operators.some((operator) => operator.email === body.email)) throw new Error("Operator is already assigned.");
        facility.operators.push({ id: crypto.randomUUID(), email: body.email });
      }
      if (method === "DELETE") facility.operators = facility.operators.filter((operator) => operator.id !== item);
      return { operators: [...facility.operators] };
    } else if (action === "report") {
      return { reservations: 154, occupied_now: 12, occupied_hours: 388, completed_sessions: 127,
        collected_revenue: 48520, visits_by_day: [14, 19, 12, 24, 22, 27, 9].map((count, i) => ({
          date: timeAt(i - 6, "12:00").slice(0, 10), count,
        })) };
    } else if (method === "PUT") {
      Object.assign(facility, body);
    }
    return snapshot(facility);
  }

  return {
    request,
    visit,
    facilities: () => facilities.map(snapshot),
    driver: () => ({ facilities: facilities.map(snapshot), vehicles: [...vehicles], bookings: bookings.map(bookingResponse) }),
  };
}
