from alembic import op
import sqlalchemy as sa

revision = "0005_parking_visits"
down_revision = "0004_driver_bookings"
branch_labels = None
depends_on = None


def upgrade():
    for name in ("checked_in_at", "checked_out_at", "paid_at"):
        op.add_column("reservations", sa.Column(name, sa.DateTime(timezone=True)), schema="parking")
    for name in ("visit_rate", "charge"):
        op.add_column("reservations", sa.Column(name, sa.Numeric(12, 2)), schema="parking")


def downgrade():
    for name in ("paid_at", "checked_out_at", "checked_in_at", "visit_rate", "charge"):
        op.drop_column("reservations", name, schema="parking")
