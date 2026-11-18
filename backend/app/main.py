import os
from datetime import date, datetime, timezone
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from .booking import (
    BookingWindow, ReservationInput, VehicleInput, active_slots, cancel, get_driver_bookings,
    reservation_conflicts, reserve, unavailable_slots, within_hours,
)
from .db import get_db
from .facility_inputs import FacilityInput, GridCell, LayoutInput, MaintenanceInput
from .models import Facility, FacilityOperator, MaintenanceWindow, Profile, Reservation, Slot, Vehicle
from .staff import (
    OperatorInput, add_facility_operator, assigned_facilities, facility_staff, require_assignment,
    require_booking_assignment,
)
from .visits import RescheduleInput, VisitAction, operator_bookings, report_for, reschedule, visit_action

app = FastAPI(title="Parking Management")
bearer = HTTPBearer(auto_error=False)
Database = Annotated[Session, Depends(get_db)]


@app.exception_handler(OperationalError)
async def database_unavailable(request, error):
    return JSONResponse(status_code=503, content={"detail": "The parking database is temporarily unreachable. Try again."})


def authenticated_profile(
    db: Database,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
):
    if credentials is None:
        raise HTTPException(401, "Sign in first", headers={"WWW-Authenticate": "Bearer"})

    url = os.environ["SUPABASE_URL"].rstrip("/")
    try:
        response = httpx.get(
            f"{url}/auth/v1/user",
            headers={
                "apikey": os.environ["SUPABASE_PUBLISHABLE_KEY"],
                "Authorization": f"Bearer {credentials.credentials}",
            },
            timeout=5,
        )
    except httpx.RequestError as exc:
        raise HTTPException(503, "Sign-in verification is unavailable") from exc

    if response.status_code in (401, 403):
        raise HTTPException(401, "Invalid session", headers={"WWW-Authenticate": "Bearer"})
    if not response.is_success:
        raise HTTPException(503, "Sign-in verification is unavailable")

    user = response.json()
    identity = UUID(user["id"])
    profile = db.get(Profile, identity)
    if profile is None:
        requested = (user.get("user_metadata") or {}).get("signup_role")
        if (user.get("app_metadata") or {}).get("parking_operator_owner"):
            role = "operator"
        else:
            role = "facility_manager" if requested == "facility_manager" else "driver"
        db.execute(insert(Profile).values(id=identity, role=role).on_conflict_do_nothing())
        db.commit()
        profile = db.get(Profile, identity)
    return profile


CurrentProfile = Annotated[Profile, Depends(authenticated_profile)]


def require_role(profile: Profile, role: str):
    if profile.role != role:
        raise HTTPException(403, "This interface requires a different role")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/me")
def me(profile: CurrentProfile):
    return {"id": profile.id, "role": profile.role}


def facilities_for(db: Session, owner_id: UUID | None = None, operator_id: UUID | None = None):
    query = select(Facility).order_by(Facility.name)
    if owner_id is not None:
        query = query.where(Facility.owner_id == owner_id)
    if operator_id is not None:
        query = query.where(Facility.id.in_(assigned_facilities(operator_id)))
    return [
        {"id": facility.id, "name": facility.name, "address": facility.address, "hourly_rate": facility.hourly_rate}
        for facility in db.scalars(query)
    ]


@app.get("/api/driver")
def driver(profile: CurrentProfile, db: Database):
    require_role(profile, "driver")
    vehicles = db.scalars(select(Vehicle).where(Vehicle.owner_id == profile.id).order_by(Vehicle.plate))
    return {
        "facilities": facilities_for(db),
        "vehicles": [{"id": vehicle.id, "plate": vehicle.plate} for vehicle in vehicles],
        "bookings": get_driver_bookings(db, profile.id),
    }


@app.post("/api/driver/vehicles", status_code=201)
def register_vehicle(payload: VehicleInput, profile: CurrentProfile, db: Database):
    require_role(profile, "driver")
    vehicle = db.scalar(insert(Vehicle).values(
        owner_id=profile.id, plate=payload.plate,
    ).on_conflict_do_nothing(constraint="vehicle_owner_plate").returning(Vehicle))
    if vehicle is None:
        raise HTTPException(409, "This vehicle is already registered")
    db.commit()
    return {"id": vehicle.id, "plate": vehicle.plate}


@app.post("/api/driver/facilities/{facility_id}/availability")
def check_availability(facility_id: UUID, payload: BookingWindow, profile: CurrentProfile, db: Database):
    require_role(profile, "driver")
    facility = db.get(Facility, facility_id)
    if facility is None:
        raise HTTPException(404, "Facility not found")
    slots = db.scalars(select(Slot).where(Slot.facility_id == facility.id, Slot.grid_row.is_not(None))).all()
    available_hours = within_hours(facility, payload)
    blocked = unavailable_slots(db, [slot.id for slot in slots], payload) if available_hours else set()
    return {
        "buildings": facility.building_cells,
        "closed": not available_hours,
        "spots": [
            {**spot_fields(slot), "available": available_hours and slot.id not in blocked}
            for slot in slots
        ],
    }


@app.post("/api/driver/bookings", status_code=201)
def make_booking(payload: ReservationInput, profile: CurrentProfile, db: Database):
    require_role(profile, "driver")
    return reserve(db, profile.id, payload)


@app.post("/api/driver/bookings/{reservation_id}/cancel")
def cancel_booking(reservation_id: UUID, profile: CurrentProfile, db: Database):
    require_role(profile, "driver")
    return cancel(db, profile.id, reservation_id)


@app.get("/api/facility-manager")
def facility_manager(profile: CurrentProfile, db: Database):
    require_role(profile, "facility_manager")
    return {"facilities": facilities_for(db, profile.id)}


@app.get("/api/operator")
def operator(profile: CurrentProfile, db: Database):
    require_role(profile, "operator")
    return {"facilities": facilities_for(db, operator_id=profile.id)}


@app.get("/api/workspace")
def workspace(profile: CurrentProfile, db: Database):
    load = {"driver": driver, "facility_manager": facility_manager, "operator": operator}[profile.role]
    return {"role": profile.role, **load(profile, db)}


@app.get("/api/operator/bookings")
def list_operator_bookings(
    profile: CurrentProfile, db: Database, facility_id: UUID | None = None,
    day: date | None = None, status: str | None = None, reference: str | None = None,
):
    require_role(profile, "operator")
    return {"bookings": operator_bookings(db, profile.id, facility_id, day, status, reference)}


@app.get("/api/operator/facilities/{facility_id}/spots")
def operator_spots(facility_id: UUID, profile: CurrentProfile, db: Database):
    require_role(profile, "operator")
    require_assignment(db, profile.id, facility_id)
    slots = db.scalars(select(Slot).where(Slot.facility_id == facility_id, Slot.grid_row.is_not(None)).order_by(Slot.label))
    return {"spots": [spot_fields(slot) for slot in slots]}


@app.put("/api/operator/bookings/{booking_id}")
def reschedule_booking(booking_id: UUID, payload: RescheduleInput, profile: CurrentProfile, db: Database):
    require_role(profile, "operator")
    require_booking_assignment(db, profile.id, booking_id)
    return reschedule(db, booking_id, payload)


@app.post("/api/operator/bookings/{booking_id}/{action}")
def manage_visit(booking_id: UUID, action: VisitAction, profile: CurrentProfile, db: Database):
    require_role(profile, "operator")
    require_booking_assignment(db, profile.id, booking_id)
    return visit_action(db, booking_id, action)


def owned_facility(db: Session, profile: Profile, facility_id: UUID, *, lock=False):
    require_role(profile, "facility_manager")
    query = select(Facility).where(Facility.id == facility_id, Facility.owner_id == profile.id)
    facility = db.scalar(query.with_for_update() if lock else query)
    if facility is None:
        raise HTTPException(404, "Facility not found")
    return facility


def spot_fields(slot: Slot):
    return {"id": slot.id, "label": slot.label, "grid_row": slot.grid_row, "grid_column": slot.grid_column}


def facility_layout(db: Session, facility: Facility):
    slots = db.scalars(select(Slot).where(Slot.facility_id == facility.id, Slot.grid_row.is_not(None)).order_by(
        Slot.grid_row, Slot.grid_column,
    )).all()
    closures = db.scalars(select(MaintenanceWindow).join(Slot).where(
        Slot.facility_id == facility.id, Slot.grid_row.is_not(None),
    ).order_by(MaintenanceWindow.starts_at)).all()
    occupied = set(db.scalars(select(Reservation.slot_id).join(Slot).where(
        Slot.facility_id == facility.id, Reservation.status == "checked_in",
    )))
    return {
        "id": facility.id,
        **FacilityInput.model_validate(facility, from_attributes=True).model_dump(mode="json"),
        "buildings": facility.building_cells,
        "spots": [{**spot_fields(slot), "occupied": slot.id in occupied} for slot in slots],
        "maintenance": [
            {"id": window.id, "slot_id": window.slot_id, "starts_at": window.starts_at, "ends_at": window.ends_at}
            for window in closures
        ],
    }


@app.post("/api/facility-manager/facilities", status_code=201)
def create_facility(payload: FacilityInput, profile: CurrentProfile, db: Database):
    require_role(profile, "facility_manager")
    facility = Facility(owner_id=profile.id, **payload.model_dump())
    db.add(facility)
    db.commit()
    return facility_layout(db, facility)


@app.get("/api/facility-manager/facilities/{facility_id}")
def get_facility(facility_id: UUID, profile: CurrentProfile, db: Database):
    return facility_layout(db, owned_facility(db, profile, facility_id))


@app.get("/api/facility-manager/facilities/{facility_id}/operators")
def list_facility_operators(facility_id: UUID, profile: CurrentProfile, db: Database):
    owned_facility(db, profile, facility_id)
    return {"operators": facility_staff(db, facility_id)}


@app.post("/api/facility-manager/facilities/{facility_id}/operators", status_code=201)
def create_facility_operator(facility_id: UUID, payload: OperatorInput, profile: CurrentProfile, db: Database):
    owned_facility(db, profile, facility_id, lock=True)
    return {"operators": add_facility_operator(db, facility_id, profile.id, payload)}


@app.delete("/api/facility-manager/facilities/{facility_id}/operators/{operator_id}", status_code=204)
def remove_facility_operator(facility_id: UUID, operator_id: UUID, profile: CurrentProfile, db: Database):
    owned_facility(db, profile, facility_id, lock=True)
    assignment = db.get(FacilityOperator, (facility_id, operator_id))
    if assignment is None:
        raise HTTPException(404, "Operator assignment not found")
    db.delete(assignment)
    db.commit()
    return Response(status_code=204)


@app.get("/api/facility-manager/facilities/{facility_id}/report")
def facility_report(facility_id: UUID, first: date, last: date, profile: CurrentProfile, db: Database):
    owned_facility(db, profile, facility_id)
    return report_for(db, facility_id, first, last)


@app.put("/api/facility-manager/facilities/{facility_id}")
def update_facility(facility_id: UUID, payload: FacilityInput, profile: CurrentProfile, db: Database):
    facility = owned_facility(db, profile, facility_id, lock=True)
    for field, value in payload.model_dump().items():
        setattr(facility, field, value)
    db.commit()
    return facility_layout(db, facility)


@app.put("/api/facility-manager/facilities/{facility_id}/layout")
def save_layout(facility_id: UUID, payload: LayoutInput, profile: CurrentProfile, db: Database):
    facility = owned_facility(db, profile, facility_id, lock=True)
    buildings = payload.buildings
    if buildings is None:
        buildings = [GridCell.model_validate(cell) for cell in facility.building_cells]
    try:
        payload.validate_buildings(buildings)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    facility.building_cells = [cell.model_dump() for cell in buildings]
    existing = {slot.id: slot for slot in db.scalars(select(Slot).where(
        Slot.facility_id == facility.id, Slot.grid_row.is_not(None),
    ).order_by(Slot.id).with_for_update())}
    submitted = {spot.id for spot in payload.spots if spot.id is not None}
    if not submitted.issubset(existing):
        raise HTTPException(409, "A saved spot has changed. Reload the layout and try again.")

    for slot_id in existing.keys() - submitted:
        history = db.execute(select(Reservation.status, Reservation.ends_at).where(Reservation.slot_id == slot_id)).all()
        if any(status == "checked_in" or (status == "confirmed" and end > datetime.now(timezone.utc))
               for status, end in history):
            raise HTTPException(409, "A space with an upcoming or current reservation cannot be removed")
        if history:
            existing[slot_id].grid_row = None
            existing[slot_id].grid_column = None
        else:
            db.delete(existing[slot_id])
    for spot in payload.spots:
        fields = spot.model_dump(exclude={"id"})
        if spot.id is None:
            db.add(Slot(facility_id=facility.id, **fields))
        else:
            for field, value in fields.items():
                setattr(existing[spot.id], field, value)
    db.commit()
    return facility_layout(db, facility)


@app.post("/api/facility-manager/facilities/{facility_id}/spots/{spot_id}/maintenance", status_code=201)
def add_maintenance(
    facility_id: UUID, spot_id: UUID, payload: MaintenanceInput, profile: CurrentProfile, db: Database,
):
    facility = owned_facility(db, profile, facility_id, lock=True)
    slot = db.scalar(select(Slot).where(
        Slot.id == spot_id, Slot.facility_id == facility.id, Slot.grid_row.is_not(None),
    ).with_for_update())
    if slot is None:
        raise HTTPException(404, "Spot not found")
    if db.scalar(reservation_conflicts([spot_id], payload).limit(1)) or db.scalar(active_slots([spot_id], payload).limit(1)):
        raise HTTPException(409, "The closure overlaps a reservation or active visit")
    db.add(MaintenanceWindow(slot_id=slot.id, **payload.model_dump()))
    db.commit()
    return facility_layout(db, facility)


@app.delete("/api/facility-manager/facilities/{facility_id}/maintenance/{window_id}", status_code=204)
def remove_maintenance(facility_id: UUID, window_id: UUID, profile: CurrentProfile, db: Database):
    facility = owned_facility(db, profile, facility_id, lock=True)
    window = db.scalar(select(MaintenanceWindow).join(Slot).where(
        MaintenanceWindow.id == window_id, Slot.facility_id == facility.id,
    ))
    if window is None:
        raise HTTPException(404, "Maintenance window not found")
    db.delete(window)
    db.commit()
    return Response(status_code=204)
