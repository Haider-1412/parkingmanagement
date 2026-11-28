from alembic import op
import sqlalchemy as sa

revision = "0008_vehicle_removal"
down_revision = "0007_driver_username"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("vehicles", sa.Column("removed_at", sa.DateTime(timezone=True)), schema="parking")


def downgrade():
    op.drop_column("vehicles", "removed_at", schema="parking")
