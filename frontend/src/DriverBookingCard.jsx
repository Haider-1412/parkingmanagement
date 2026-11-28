import React, { useEffect, useId, useRef, useState } from "react";
import { bookingSchedule, Receipt } from "./VisitDetails.jsx";

const statusLabels = {
  confirmed: "Confirmed", checked_in: "Checked in", completed: "Completed",
  cancelled: "Cancelled", no_show: "No-show",
};

export default function DriverBookingCard({ booking, initiallyExpanded, busy, cancelError, onCancel, onDismissError }) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const detailsId = useId();
  const confirmationId = useId();
  const titleId = useId();
  const detailsButton = useRef(null);
  const cancelButton = useRef(null);
  const keepButton = useRef(null);
  const errorMessage = useRef(null);
  const now = Date.now();
  const canCancel = booking.can_cancel && Date.parse(booking.starts_at) > now;
  const { date, time } = bookingSchedule(booking.starts_at, booking.ends_at, now);

  useEffect(() => {
    if (!confirming) return;
    if (canCancel) {
      if (cancelError) errorMessage.current?.focus();
      else keepButton.current?.focus();
    } else {
      setConfirming(false);
      detailsButton.current?.focus();
    }
  }, [canCancel, cancelError, confirming]);

  async function confirmCancellation() {
    setSubmitting(true);
    try {
      await onCancel(booking);
    } finally {
      setSubmitting(false);
    }
  }

  return <li className="booking-card">
    <article aria-labelledby={titleId}>
      <div className="booking-card-body">
        <header className="booking-card-header">
          <h2 id={titleId}>{booking.facility}</h2>
          <span className={"status-badge " + booking.status} role="status">
            {statusLabels[booking.status] ?? booking.status.replaceAll("_", " ")}
          </span>
        </header>
        <div className="booking-card-visit">
          <span className="booking-card-spot">Space {booking.spot}</span>
          <div className="booking-card-schedule"><strong>{date}</strong><span>{time}</span></div>
        </div>
      </div>
      <div className="booking-card-actions">
        <button type="button" ref={detailsButton} aria-expanded={expanded} aria-controls={detailsId}
          onClick={() => setExpanded(!expanded)}>{expanded ? "Hide details" : "View details"}</button>
        {canCancel && <button type="button" className="booking-card-cancel" ref={cancelButton}
          aria-expanded={confirming} aria-controls={confirming ? confirmationId : undefined} disabled={busy} onClick={() => {
            if (confirming) keepButton.current?.focus();
            else setConfirming(true);
          }}>Cancel booking</button>}
      </div>
      <div className="booking-card-details" id={detailsId} hidden={!expanded}>
        <dl>
          <div><dt>Booking reference</dt><dd>{booking.reference}</dd></div>
          <div><dt>Vehicle</dt><dd>{booking.plate}</dd></div>
        </dl>
        <Receipt booking={booking} />
      </div>
      {confirming && canCancel && <div className="booking-card-confirmation" id={confirmationId}>
        <p>Cancel this booking?</p>
        {cancelError && <p className="driver-feedback error" ref={errorMessage} tabIndex={-1}>{cancelError}</p>}
        <div className="booking-card-confirmation-actions">
          <button type="button" ref={keepButton} disabled={busy} onClick={() => {
            setConfirming(false);
            if (cancelError) onDismissError();
            cancelButton.current?.focus();
          }}>Keep booking</button>
          <button type="button" className="primary" disabled={busy} onClick={confirmCancellation}>
            {submitting ? "Cancelling…" : "Confirm cancellation"}
          </button>
        </div>
      </div>}
    </article>
  </li>;
}
