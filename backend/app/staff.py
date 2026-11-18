import os
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, SecretStr, StringConstraints
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from .models import FacilityOperator, Profile, Reservation, Slot


class OperatorInput(BaseModel):
    email: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, min_length=3, max_length=254)]
    password: SecretStr | None = None


def assigned_facilities(operator_id):
    return select(FacilityOperator.facility_id).where(FacilityOperator.operator_id == operator_id)


def require_assignment(db, operator_id, facility_id, *, lock=False):
    query = select(FacilityOperator).where(
        FacilityOperator.operator_id == operator_id, FacilityOperator.facility_id == facility_id,
    )
    if db.scalar(query.with_for_update() if lock else query) is None:
        raise HTTPException(404, "Facility not found")


def require_booking_assignment(db, operator_id, booking_id):
    facility_id = db.scalar(select(Slot.facility_id).join(
        Reservation, Reservation.slot_id == Slot.id,
    ).where(Reservation.id == booking_id))
    if facility_id is None:
        raise HTTPException(404, "Booking not found")
    require_assignment(db, operator_id, facility_id, lock=True)


def facility_staff(db, facility_id):
    return [
        dict(row) for row in db.execute(text("""
            select u.id, u.email
            from parking.facility_operators a
            join auth.users u on u.id = a.operator_id
            where a.facility_id = :facility_id
            order by u.email
        """), {"facility_id": facility_id}).mappings()
    ]


def find_auth_account(db, email):
    return db.execute(text("""
        select id, raw_app_meta_data ->> 'parking_operator_owner' as operator_owner
        from auth.users where lower(email) = :email
    """), {"email": email}).first()


def create_auth_operator(email, password, manager_id):
    secret = os.environ.get("SUPABASE_SECRET_KEY")
    if not secret:
        raise HTTPException(503, "Operator account creation needs SUPABASE_SECRET_KEY in the backend settings")
    url = os.environ["SUPABASE_URL"].rstrip("/")
    try:
        response = httpx.post(
            f"{url}/auth/v1/admin/users",
            headers={"apikey": secret, "Authorization": f"Bearer {secret}"},
            json={
                "email": email,
                "password": password,
                "email_confirm": True,
                "app_metadata": {"parking_operator_owner": str(manager_id)},
            },
            timeout=8,
        )
    except httpx.RequestError as error:
        raise HTTPException(503, "Supabase account creation is unavailable. Retry with the same email.") from error
    if response.status_code in (400, 422):
        code = response.json().get("error_code")
        if code in ("email_exists", "user_already_exists"):
            raise HTTPException(409, "An account already uses this email")
        raise HTTPException(422, "Supabase rejected the email or password. Check the account details.")
    if not response.is_success:
        raise HTTPException(503, "Supabase account creation is unavailable. Check the backend secret key.")
    return UUID(response.json()["id"])


def add_facility_operator(db, facility_id, manager_id, payload):
    local, separator, domain = payload.email.partition("@")
    if not separator or not local or not domain or "@" in domain or any(ch.isspace() for ch in payload.email):
        raise HTTPException(422, "Enter a valid email address")
    account = find_auth_account(db, payload.email)
    if account is not None:
        if account.operator_owner != str(manager_id):
            raise HTTPException(409, "An account already uses this email. Use an operator account you created.")
        operator_id = account.id
    else:
        password = payload.password.get_secret_value() if payload.password else ""
        if not 8 <= len(password) <= 72:
            raise HTTPException(422, "Enter a password of 8 to 72 characters for a new account")
        operator_id = create_auth_operator(payload.email, password, manager_id)

    db.execute(insert(Profile).values(id=operator_id, role="operator").on_conflict_do_nothing())
    if db.get(Profile, operator_id).role != "operator":
        raise HTTPException(409, "This account has a different parking role")
    db.execute(insert(FacilityOperator).values(
        facility_id=facility_id, operator_id=operator_id,
    ).on_conflict_do_nothing())
    db.commit()
    return facility_staff(db, facility_id)
