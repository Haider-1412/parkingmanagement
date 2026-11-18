from alembic import op
import sqlalchemy as sa

revision = "0004_driver_bookings"
down_revision = "0003_building_cells"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "vehicles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("parking.profiles.id"), nullable=False),
        sa.Column("plate", sa.String(24), nullable=False),
        sa.UniqueConstraint("owner_id", "plate", name="vehicle_owner_plate"),
        schema="parking",
    )
    op.create_table(
        "reservations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("reference", sa.String(12), nullable=False, unique=True),
        sa.Column("driver_id", sa.Uuid(), sa.ForeignKey("parking.profiles.id"), nullable=False),
        sa.Column("vehicle_id", sa.Uuid(), sa.ForeignKey("parking.vehicles.id"), nullable=False),
        sa.Column("slot_id", sa.Uuid(), sa.ForeignKey("parking.slots.id"), nullable=False),
        sa.Column("spot_label", sa.String(24), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.CheckConstraint("ends_at > starts_at", name="reservation_positive_duration"),
        schema="parking",
    )
    for field in ("driver_id", "slot_id"):
        op.create_index(f"ix_parking_reservations_{field}", "reservations", [field], schema="parking")
    op.drop_constraint("slot_facility_label", "slots", schema="parking", type_="unique")
    for field in ("grid_row", "grid_column"):
        op.alter_column("slots", field, nullable=True, schema="parking")
    op.add_column("slots", sa.Column(
        "active_label", sa.String(24), sa.Computed("case when grid_row is not null then label end", persisted=True),
    ), schema="parking")
    op.create_unique_constraint(
        "slot_facility_label", "slots", ["facility_id", "active_label"],
        deferrable=True, initially="DEFERRED", schema="parking",
    )
    op.create_check_constraint(
        "slot_coordinates_pair", "slots", "(grid_row is null) = (grid_column is null)", schema="parking",
    )


def downgrade():
    op.drop_table("reservations", schema="parking")
    op.drop_table("vehicles", schema="parking")
    op.execute("delete from parking.slots where grid_row is null")
    op.drop_constraint("slot_coordinates_pair", "slots", schema="parking", type_="check")
    op.drop_constraint("slot_facility_label", "slots", schema="parking", type_="unique")
    op.drop_column("slots", "active_label", schema="parking")
    for field in ("grid_row", "grid_column"):
        op.alter_column("slots", field, nullable=False, schema="parking")
    op.create_unique_constraint(
        "slot_facility_label", "slots", ["facility_id", "label"],
        deferrable=True, initially="DEFERRED", schema="parking",
    )
