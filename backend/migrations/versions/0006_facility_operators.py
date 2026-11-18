from alembic import op
import sqlalchemy as sa

revision = "0006_facility_operators"
down_revision = "0005_parking_visits"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "facility_operators",
        sa.Column("facility_id", sa.Uuid(), sa.ForeignKey("parking.facilities.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("operator_id", sa.Uuid(), sa.ForeignKey("parking.profiles.id", ondelete="CASCADE"), primary_key=True),
        schema="parking",
    )
    op.create_index("ix_parking_facility_operators_operator_id", "facility_operators", ["operator_id"], schema="parking")


def downgrade():
    op.drop_table("facility_operators", schema="parking")
