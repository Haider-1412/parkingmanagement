import React from "react";

const zone = "Asia/Karachi";
const readable = new Intl.DateTimeFormat("en-PK", {
  timeZone: zone, dateStyle: "medium", timeStyle: "short",
});
const editable = new Intl.DateTimeFormat("en-GB", {
  timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const bookingDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: zone, weekday: "short", day: "numeric", month: "short",
});
const bookingDateWithYear = new Intl.DateTimeFormat("en-GB", {
  timeZone: zone, weekday: "short", day: "numeric", month: "short", year: "numeric",
});
const bookingTime = new Intl.DateTimeFormat("en-US", {
  timeZone: zone, hour: "numeric", minute: "2-digit",
});

export function visitTime(value) {
  return readable.format(new Date(value));
}

export function localDateTime(value) {
  const parts = Object.fromEntries(editable.formatToParts(new Date(value)).map(({ type, value }) => [type, value]));
  return parts.year + "-" + parts.month + "-" + parts.day + "T" + parts.hour + ":" + parts.minute;
}

export function bookingSchedule(startsAt, endsAt, now) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const startDay = localDateTime(start).slice(0, 10);
  const endDay = localDateTime(end).slice(0, 10);
  const year = localDateTime(now).slice(0, 4);
  const date = startDay.startsWith(year) && endDay.startsWith(year) ? bookingDate : bookingDateWithYear;
  if (startDay === endDay) {
    return { date: date.format(start), time: bookingTime.formatRange(start, end) + " PKT" };
  }
  return {
    date: date.format(start) + " · " + bookingTime.format(start),
    time: date.format(end) + " · " + bookingTime.format(end) + " PKT",
  };
}

export function Receipt({ booking }) {
  if (booking.charge == null) return null;
  return <details className="visit-receipt">
    <summary>Receipt · PKR {Number(booking.charge).toFixed(2)} · <span className={"status-badge payment-" + booking.payment}>
      {booking.payment === "completed" ? "Paid" : "Payment pending"}
    </span></summary>
    <div>
      <p>Booking {booking.reference} · {booking.facility} · {booking.spot}</p>
      <p>Vehicle {booking.plate} · PKR {Number(booking.visit_rate).toFixed(2)}/hour</p>
      <p>{visitTime(booking.checked_in_at)} to {visitTime(booking.checked_out_at)} PKT</p>
    </div>
  </details>;
}
