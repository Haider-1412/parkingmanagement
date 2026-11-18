from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select

from .booking import PKT, BookingWindow, booking_details, booking_query, unavailable_slots, within_hours
from .models import Facility, MaintenanceWindow, Reservation, Slot, Vehicle
from .staff import assigned_facilities

VisitAction = Literal["cancel", "no-show", "check-in", "check-out", "record-payment"]


class RescheduleInput(BookingWindow):
    slot_id: UUID


def operator_bookings(db, operator_id, facility_id=None, day=None, status=None, reference=None):
    query = booking_query().where(Facility.id.in_(assigned_facilities(operator_id)))
    if facility_id:
        query = query.where(Facility.id == facility_id)
    if day:
        start = datetime.combine(day, time.min, PKT)
        query = query.where(Reservation.starts_at < start + timedelta(days=1), Reservation.ends_at > start)
    if status:
        query = query.where(Reservation.status == status)
    if reference:
        query = query.where(Reservation.reference == reference.strip().upper())
    return [
        {**booking_details(booking, facility, vehicle), "facility_id": facility.id, "slot_id": booking.slot_id}
        for booking, facility, vehicle in db.execute(query.order_by(Reservation.starts_at.desc(), Reservation.id))
    ]


def lock_booking(db, booking_id, next_slot_id=None):
    booking = db.get(Reservation, booking_id)
    if booking is None:
        raise HTTPException(404, "Booking not found")
    original_slot_id = booking.slot_id
    ids = {original_slot_id}
    if next_slot_id:
        ids.add(next_slot_id)
    slots = {slot.id: slot for slot in db.scalars(
        select(Slot).where(Slot.id.in_(ids)).order_by(Slot.id).with_for_update(),
    )}
    db.refresh(booking)
    if booking.slot_id != original_slot_id:
        raise HTTPException(409, "This booking changed. Refresh and try again")
    return booking, slots


def visit_action(db, booking_id, action: VisitAction, now=None):
    booking, slots = lock_booking(db, booking_id)
    slot = slots[booking.slot_id]
    facility = db.get(Facility, slot.facility_id)
    now = now or datetime.now(timezone.utc)

    if action == "cancel" and booking.status == "confirmed":
        booking.status = "cancelled"
    elif action == "no-show" and booking.status == "confirmed":
        if now < min(booking.starts_at + timedelta(minutes=15), booking.ends_at):
            raise HTTPException(409, "It is too early to mark this booking as a no-show")
        booking.status = "no_show"
    elif action == "check-in" and booking.status == "confirmed":
        if not booking.starts_at <= now < booking.ends_at:
            raise HTTPException(409, "Check-in is available during the booked time window")
        if slot.grid_row is None or db.scalar(select(Reservation.id).where(
            Reservation.slot_id == slot.id, Reservation.status == "checked_in",
        ).limit(1)):
            raise HTTPException(409, "This space is unavailable or still occupied")
        if db.scalar(select(MaintenanceWindow.id).where(
            MaintenanceWindow.slot_id == slot.id,
            MaintenanceWindow.starts_at <= now,
            MaintenanceWindow.ends_at > now,
        ).limit(1)):
            raise HTTPException(409, "This space is closed for maintenance")
        booking.status = "checked_in"
        booking.checked_in_at = now
        booking.visit_rate = facility.hourly_rate
    elif action == "check-out" and booking.status == "checked_in":
        elapsed = Decimal(str((now - booking.checked_in_at).total_seconds()))
        if elapsed < 0:
            raise HTTPException(409, "Departure cannot precede check-in")
        booking.status = "completed"
        booking.checked_out_at = now
        booking.charge = (elapsed * booking.visit_rate / 3600).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    elif action == "record-payment" and booking.status == "completed":
        if booking.paid_at is None:
            booking.paid_at = now
    else:
        raise HTTPException(409, "That action is unavailable for this booking status")

    db.commit()
    return booking_details(booking, facility, db.get(Vehicle, booking.vehicle_id))


def reschedule(db, booking_id, payload):
    booking, slots = lock_booking(db, booking_id, payload.slot_id)
    original = slots[booking.slot_id]
    destination = slots.get(payload.slot_id)
    if destination is None or destination.facility_id != original.facility_id or destination.grid_row is None:
        raise HTTPException(404, "Choose an active space at the same facility")
    if booking.status != "confirmed":
        raise HTTPException(409, "Only unused confirmed bookings can be rescheduled")
    if payload.starts_at <= datetime.now(timezone.utc):
        raise HTTPException(422, "Choose a new arrival time in the future")
    facility = db.get(Facility, original.facility_id)
    if not within_hours(facility, payload) or unavailable_slots(db, [destination.id], payload, booking.id):
        raise HTTPException(409, "The new space or time is unavailable")
    booking.slot_id = destination.id
    booking.spot_label = destination.label
    booking.starts_at = payload.starts_at
    booking.ends_at = payload.ends_at
    db.commit()
    return booking_details(booking, facility, db.get(Vehicle, booking.vehicle_id))


def report_for(db, facility_id, first: date, last: date):
    if last < first:
        raise HTTPException(422, "End date must be on or after start date")
    start = datetime.combine(first, time.min, PKT)
    end = datetime.combine(last + timedelta(days=1), time.min, PKT)
    now = datetime.now(timezone.utc)
    records = db.scalars(select(Reservation).join(Slot).where(Slot.facility_id == facility_id))
    booked = live = completed = 0
    occupied_seconds = 0.0
    revenue = Decimal("0.00")
    visits_by_day = Counter()
    for booking in records:
        booked += int(start <= booking.starts_at < end)
        live += int(booking.status == "checked_in")
        if booking.checked_in_at:
            left = max(start, booking.checked_in_at)
            right = min(end, booking.checked_out_at or now)
            occupied_seconds += max(0, (right - left).total_seconds())
        if booking.checked_out_at and start <= booking.checked_out_at < end:
            completed += 1
            visits_by_day[booking.checked_out_at.astimezone(PKT).date()] += 1
        if booking.paid_at and start <= booking.paid_at < end:
            revenue += booking.charge
    return {
        "reservations": booked, "occupied_now": live, "completed_sessions": completed,
        "occupied_hours": round(occupied_seconds / 3600, 2), "collected_revenue": str(revenue),
        "visits_by_day": [{"date": day, "count": count} for day, count in sorted(visits_by_day.items())],
    }
