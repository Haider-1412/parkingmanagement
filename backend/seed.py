import argparse
from decimal import Decimal
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db import engine
from app.models import Facility, FacilityOperator, Profile, Slot


def seed(driver, manager, operator):
    accounts = {"driver": driver, "facility_manager": manager, "operator": operator}
    if len({email.lower() for email in accounts.values()}) != len(accounts):
        raise ValueError("Use a different Auth account for each role")

    with Session(engine()) as db, db.begin():
        identities = {}
        for role, email in accounts.items():
            identity = db.scalar(
                text("select id from auth.users where lower(email) = lower(:email)"),
                {"email": email},
            )
            if identity is None:
                raise ValueError(f"Create the {role} account in Supabase Auth first")
            existing = db.get(Profile, identity)
            if existing is not None and existing.role != role:
                raise ValueError(f"The {role} email belongs to a different application role")
            db.execute(insert(Profile).values(id=identity, role=role).on_conflict_do_nothing())
            identities[role] = identity

        owner = identities["facility_manager"]
        for name, address, rate in (
            ("Campus Demo Parking", "Sample Campus, Rawalpindi", Decimal("100")),
            ("City Centre Demo Parking", "Sample City Centre, Rawalpindi", Decimal("150")),
        ):
            facility_id = uuid5(NAMESPACE_URL, f"parking-demo/{owner}/{name}")
            created = db.scalar(insert(Facility).values(
                id=facility_id, name=name, address=address, owner_id=owner, hourly_rate=rate,
            ).on_conflict_do_nothing().returning(Facility.id))
            db.execute(insert(FacilityOperator).values(
                facility_id=facility_id, operator_id=identities["operator"],
            ).on_conflict_do_nothing())
            if created is None:
                continue
            for column in range(3):
                label = f"A{column + 1}"
                db.execute(insert(Slot).values(
                    id=uuid5(facility_id, label), facility_id=facility_id,
                    label=label, grid_row=0, grid_column=column,
                ))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Link demo Auth accounts and seed sample parking")
    for argument in ("driver", "manager", "operator"):
        parser.add_argument(f"--{argument}", required=True)
    args = parser.parse_args()
    try:
        seed(args.driver, args.manager, args.operator)
    except ValueError as exc:
        parser.error(str(exc))
    print("Demo profiles and sample parking are ready.")
