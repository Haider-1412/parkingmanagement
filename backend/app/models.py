from datetime import datetime, time
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import JSON, CheckConstraint, Computed, DateTime, ForeignKey, Index, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base

SCHEMA = "parking"


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[UUID] = mapped_column(primary_key=True)
    role: Mapped[str] = mapped_column(String(24))
    username: Mapped[str | None] = mapped_column(String(24))

    __table_args__ = (
        CheckConstraint("role in ('driver', 'facility_manager', 'operator')"),
        Index("uq_profiles_username_lower", func.lower(username), unique=True),
        {"schema": SCHEMA},
    )


class Facility(Base):
    __tablename__ = "facilities"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("parking.profiles.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    address: Mapped[str] = mapped_column(String(250))
    hourly_rate: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    opens_at: Mapped[time | None]
    closes_at: Mapped[time | None]
    building_cells: Mapped[list[dict[str, int]]] = mapped_column(JSON, default=list, server_default="[]")


class FacilityOperator(Base):
    __tablename__ = "facility_operators"
    __table_args__ = {"schema": SCHEMA}

    facility_id: Mapped[UUID] = mapped_column(ForeignKey("parking.facilities.id", ondelete="CASCADE"), primary_key=True)
    operator_id: Mapped[UUID] = mapped_column(
        ForeignKey("parking.profiles.id", ondelete="CASCADE"), primary_key=True, index=True,
    )


class Slot(Base):
    __tablename__ = "slots"
    __table_args__ = (
        UniqueConstraint(
            "facility_id", "active_label", name="slot_facility_label", deferrable=True, initially="DEFERRED",
        ),
        UniqueConstraint(
            "facility_id", "grid_row", "grid_column",
            name="slot_facility_position", deferrable=True, initially="DEFERRED",
        ),
        CheckConstraint("(grid_row is null) = (grid_column is null)", name="slot_coordinates_pair"),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    facility_id: Mapped[UUID] = mapped_column(ForeignKey("parking.facilities.id"))
    label: Mapped[str] = mapped_column(String(24))
    grid_row: Mapped[int | None]
    grid_column: Mapped[int | None]
    active_label: Mapped[str | None] = mapped_column(
        String(24), Computed("case when grid_row is not null then label end", persisted=True),
    )


class MaintenanceWindow(Base):
    __tablename__ = "maintenance_windows"
    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="maintenance_positive_duration"),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    slot_id: Mapped[UUID] = mapped_column(ForeignKey("parking.slots.id", ondelete="CASCADE"), index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (UniqueConstraint("owner_id", "plate", name="vehicle_owner_plate"), {"schema": SCHEMA})

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("parking.profiles.id"))
    plate: Mapped[str] = mapped_column(String(24))


class Reservation(Base):
    __tablename__ = "reservations"
    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="reservation_positive_duration"),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    reference: Mapped[str] = mapped_column(String(12), unique=True, default=lambda: uuid4().hex[:12].upper())
    driver_id: Mapped[UUID] = mapped_column(ForeignKey("parking.profiles.id"), index=True)
    vehicle_id: Mapped[UUID] = mapped_column(ForeignKey("parking.vehicles.id"))
    slot_id: Mapped[UUID] = mapped_column(ForeignKey("parking.slots.id"), index=True)
    spot_label: Mapped[str] = mapped_column(String(24))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16))
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    checked_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    visit_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    charge: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
