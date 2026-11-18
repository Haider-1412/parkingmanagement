from alembic import op
import sqlalchemy as sa

revision = "0002_facility_layout"
down_revision = "0001_foundation"
branch_labels = None
depends_on = None

slot_keys = (
    ("slots_facility_id_label_key", "slot_facility_label", ["facility_id", "label"]),
    ("slots_facility_id_grid_row_grid_column_key", "slot_facility_position",
     ["facility_id", "grid_row", "grid_column"]),
)


def upgrade():
    op.add_column("facilities", sa.Column("opens_at", sa.Time()), schema="parking")
    op.add_column("facilities", sa.Column("closes_at", sa.Time()), schema="parking")
    for previous, current, columns in slot_keys:
        op.drop_constraint(previous, "slots", schema="parking", type_="unique")
        op.create_unique_constraint(
            current, "slots", columns, schema="parking", deferrable=True, initially="DEFERRED",
        )
    op.create_table(
        "maintenance_windows",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("slot_id", sa.Uuid(), sa.ForeignKey("parking.slots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("ends_at > starts_at", name="maintenance_positive_duration"),
        schema="parking",
    )
    op.create_index(
        "ix_parking_maintenance_windows_slot_id", "maintenance_windows", ["slot_id"], schema="parking",
    )


def downgrade():
    op.drop_table("maintenance_windows", schema="parking")
    for previous, current, columns in slot_keys:
        op.drop_constraint(current, "slots", schema="parking", type_="unique")
        op.create_unique_constraint(previous, "slots", columns, schema="parking")
    op.drop_column("facilities", "closes_at", schema="parking")
    op.drop_column("facilities", "opens_at", schema="parking")
