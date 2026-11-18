from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from pydantic import AwareDatetime, BaseModel, StringConstraints, model_validator
from sqlalchemy import or_, select

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


def reservation_conflicts(slot_ids, window):
    return select(Reservation.slot_id).where(
        Reservation.slot_id.in_(slot_ids),
        Reservation.status == "confirmed",
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


def unavailable_slots(db, slot_ids, window, exclude_booking=None):
    reservations = reservation_conflicts(slot_ids, window)
    if exclude_booking is not None:
        reservations = reservations.where(Reservation.id != exclude_booking)
    reserved = db.scalars(reservations)
    closed = db.scalars(select(MaintenanceWindow.slot_id).where(
        MaintenanceWindow.slot_id.in_(slot_ids),
        MaintenanceWindow.starts_at < window.ends_at,
        MaintenanceWindow.ends_at > window.starts_at,
    ))
    return set(reserved) | set(closed) | set(db.scalars(active_slots(slot_ids, window)))


def booking_details(reservation, facility, vehicle):
    return {
        "id": reservation.id,
        "reference": reservation.reference,
        "facility": facility.name,
        "spot": reservation.spot_label,
        "plate": vehicle.plate,
        "status": reservation.status,
        "starts_at": reservation.starts_at,
        "ends_at": reservation.ends_at,
        "checked_in_at": reservation.checked_in_at,
        "checked_out_at": reservation.checked_out_at,
        "charge": reservation.charge,
        "visit_rate": reservation.visit_rate,
        "payment": ("completed" if reservation.paid_at else "pending") if reservation.charge is not None else None,
        "can_cancel": reservation.status == "confirmed" and reservation.starts_at > datetime.now(timezone.utc),
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
    vehicle = db.scalar(select(Vehicle).where(Vehicle.id == payload.vehicle_id, Vehicle.owner_id == driver_id))
    if vehicle is None:
        raise HTTPException(404, "Vehicle not found")
    slot = db.scalar(select(Slot).where(Slot.id == payload.slot_id).with_for_update())
    if slot is None or slot.grid_row is None:
        raise HTTPException(404, "Parking space not found")

    facility = db.get(Facility, slot.facility_id)
    if payload.starts_at <= datetime.now(timezone.utc):
        raise HTTPException(422, "Choose an arrival time in the future")
    if not within_hours(facility, payload):
        raise HTTPException(409, "The facility is closed during part of that time")
    if unavailable_slots(db, [slot.id], payload):
        raise HTTPException(409, "That space is no longer available for this time")

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
