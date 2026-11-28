from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from pydantic import AwareDatetime, BaseModel, StringConstraints, model_validator
from sqlalchemy import func, or_, select

from .models import Facility, MaintenanceWindow, Reservation, Slot, Vehicle

PKT = ZoneInfo("Asia/Karachi")


class VehicleInput(BaseModel):
    plate: Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, min_length=1, max_length=24)]


class BookingWindow(BaseModel):
    starts_at: AwareDatetime
    ends_at: AwareDatetime

    @model_validator(mode="after")
    def positive_duration(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("Departure must be after arrival")
        return self


class ReservationInput(BookingWindow):
    slot_id: UUID
    vehicle_id: UUID


def within_hours(facility, window):
    if facility.opens_at is None:
        return True
    start = window.starts_at.astimezone(PKT)
    end = window.ends_at.astimezone(PKT)
    opens = datetime.combine(start.date(), facility.opens_at, PKT)
    closes = datetime.combine(start.date(), facility.closes_at, PKT)
    if closes <= opens:
        if start < closes:
            opens -= timedelta(days=1)
        else:
            closes += timedelta(days=1)
    return opens <= start and end <= closes


CHECK_IN_GRACE = timedelta(minutes=15)
NO_SHOW_STRIKE_LIMIT = 4
NO_SHOW_STRIKE_DURATION = timedelta(days=20)


def check_in_deadline(starts_at, ends_at):
    return min(starts_at + CHECK_IN_GRACE, ends_at)


def check_in_deadline_sql():
    return func.least(Reservation.starts_at + CHECK_IN_GRACE, Reservation.ends_at)


def expired_confirmations(now):
    return (Reservation.status == "confirmed") & (check_in_deadline_sql() <= now)


def active_no_show_strikes(db, driver_id, now):
    deadline = check_in_deadline_sql()
    return db.execute(select(Reservation.reference, deadline).where(
        Reservation.driver_id == driver_id,
        Reservation.status.in_(("confirmed", "no_show")),
        deadline > now - NO_SHOW_STRIKE_DURATION,
        deadline <= now,
    ).order_by(deadline, Reservation.reference)).all()


def driver_booking_access(db, driver_id):
    now = datetime.now(timezone.utc)
    strikes = [
        {"reference": reference, "issued_at": issued_at, "expires_at": issued_at + NO_SHOW_STRIKE_DURATION}
        for reference, issued_at in active_no_show_strikes(db, driver_id, now)
    ]
    return {"strike_limit": NO_SHOW_STRIKE_LIMIT, "strikes": strikes}


def reservation_conflicts(slot_ids, window):
    return select(Reservation.slot_id).where(
        Reservation.slot_id.in_(slot_ids),
        Reservation.status == "confirmed",
        ~expired_confirmations(datetime.now(timezone.utc)),
        Reservation.starts_at < window.ends_at,
        Reservation.ends_at > window.starts_at,
    )


def active_slots(slot_ids, window):
    return select(Reservation.slot_id).where(
        Reservation.slot_id.in_(slot_ids),
        Reservation.status == "checked_in",
        Reservation.checked_in_at < window.ends_at,
        or_(Reservation.ends_at > window.starts_at, Reservation.ends_at <= datetime.now(timezone.utc)),
    )


def slot_conflicts(db, slot_ids, window, exclude_booking=None):
    reservations = reservation_conflicts(slot_ids, window)
    if exclude_booking is not None:
        reservations = reservations.where(Reservation.id != exclude_booking)
    closed = set(db.scalars(select(MaintenanceWindow.slot_id).where(
        MaintenanceWindow.slot_id.in_(slot_ids),
        MaintenanceWindow.starts_at < window.ends_at,
        MaintenanceWindow.ends_at > window.starts_at,
    )))
    return closed, set(db.scalars(active_slots(slot_ids, window))), set(db.scalars(reservations))


def unavailable_slots(db, slot_ids, window, exclude_booking=None):
    closed, occupied, reserved = slot_conflicts(db, slot_ids, window, exclude_booking)
    return closed | occupied | reserved


def booking_details(reservation, facility, vehicle):
    now = datetime.now(timezone.utc)
    status = reservation.status
    if status == "confirmed" and now >= check_in_deadline(reservation.starts_at, reservation.ends_at):
        status = "no_show"
    return {
        "id": reservation.id,
        "reference": reservation.reference,
        "facility": facility.name,
        "spot": reservation.spot_label,
        "plate": vehicle.plate,
        "status": status,
        "starts_at": reservation.starts_at,
        "ends_at": reservation.ends_at,
        "checked_in_at": reservation.checked_in_at,
        "checked_out_at": reservation.checked_out_at,
        "charge": reservation.charge,
        "visit_rate": reservation.visit_rate,
        "payment": ("completed" if reservation.paid_at else "pending") if reservation.charge is not None else None,
        "can_cancel": status == "confirmed" and reservation.starts_at > now,
    }


def booking_query():
    return select(Reservation, Facility, Vehicle).select_from(Reservation).join(
        Slot, Slot.id == Reservation.slot_id,
    ).join(Facility, Facility.id == Slot.facility_id).join(
        Vehicle, Vehicle.id == Reservation.vehicle_id,
    )


def get_driver_bookings(db, driver_id):
    rows = db.execute(booking_query().where(Reservation.driver_id == driver_id).order_by(Reservation.starts_at.desc()))
    return [booking_details(*row) for row in rows]


def reserve(db, driver_id, payload):
    vehicle = db.scalar(select(Vehicle).where(
        Vehicle.id == payload.vehicle_id, Vehicle.owner_id == driver_id, Vehicle.removed_at.is_(None),
    ).with_for_update())
    if vehicle is None:
        raise HTTPException(404, "Vehicle not found")
    slot = db.scalar(select(Slot).where(Slot.id == payload.slot_id).with_for_update())
    if slot is None or slot.grid_row is None:
        raise HTTPException(404, {"code": "space_unavailable", "message": "Parking space not found"})

    facility = db.get(Facility, slot.facility_id)
    if payload.starts_at <= datetime.now(timezone.utc):
        raise HTTPException(422, "Choose an arrival time in the future")
    if not within_hours(facility, payload):
        raise HTTPException(409, "The facility is closed during part of that time")
    closed, occupied, reserved = slot_conflicts(db, [slot.id], payload)
    if occupied or reserved:
        raise HTTPException(409, {
            "code": "space_taken",
            "message": "Booking not confirmed. This space was just taken. Choose another space.",
        })
    if closed:
        raise HTTPException(409, {"code": "space_unavailable", "message": "That space is closed for this time."})
    if len(active_no_show_strikes(db, driver_id, datetime.now(timezone.utc))) >= NO_SHOW_STRIKE_LIMIT:
        raise HTTPException(403, "Booking is suspended while you have four or more active no-show strikes")

    reservation = Reservation(
        driver_id=driver_id, slot_id=slot.id, vehicle_id=vehicle.id, spot_label=slot.label,
        starts_at=payload.starts_at, ends_at=payload.ends_at, status="confirmed",
    )
    db.add(reservation)
    db.commit()
    return booking_details(reservation, facility, vehicle)


def cancel(db, driver_id, reservation_id):
    booking = db.scalar(select(Reservation).where(
        Reservation.id == reservation_id, Reservation.driver_id == driver_id,
    ))
    if booking is None:
        raise HTTPException(404, "Booking not found")
    original_slot = booking.slot_id
    slot = db.scalar(select(Slot).where(Slot.id == original_slot).with_for_update())
    db.refresh(booking)
    if booking.slot_id != original_slot:
        raise HTTPException(409, "Booking changed. Refresh and try again.")
    if booking.status != "confirmed" or booking.starts_at <= datetime.now(timezone.utc):
        raise HTTPException(409, "Only confirmed bookings can be cancelled before arrival time")
    booking.status = "cancelled"
    db.commit()
    return booking_details(booking, db.get(Facility, slot.facility_id), db.get(Vehicle, booking.vehicle_id))
