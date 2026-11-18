import React from "react";

const zone = "Asia/Karachi";
const readable = new Intl.DateTimeFormat("en-PK", {
  timeZone: zone, dateStyle: "medium", timeStyle: "short",
});
const editable = new Intl.DateTimeFormat("en-GB", {
  timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function visitTime(value) {
  return readable.format(new Date(value));
}

export function localDateTime(value) {
  const parts = Object.fromEntries(editable.formatToParts(new Date(value)).map(({ type, value }) => [type, value]));
  return parts.year + "-" + parts.month + "-" + parts.day + "T" + parts.hour + ":" + parts.minute;
}

export function Receipt({ booking }) {
  if (booking.charge == null) return null;
  return <details className="visit-receipt">
    <summary>Receipt · PKR {Number(booking.charge).toFixed(2)} · {booking.payment}</summary>
    <div>
      <p>Booking {booking.reference} · {booking.facility} · {booking.spot}</p>
      <p>Vehicle {booking.plate} · PKR {Number(booking.visit_rate).toFixed(2)}/hour</p>
      <p>{visitTime(booking.checked_in_at)} to {visitTime(booking.checked_out_at)} PKT</p>
    </div>
  </details>;
}
