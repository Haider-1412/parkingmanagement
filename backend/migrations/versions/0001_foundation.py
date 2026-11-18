from alembic import op
import sqlalchemy as sa

revision = "0001_foundation"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE SCHEMA parking")
    op.create_table(
        "profiles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("role", sa.String(24), nullable=False),
        sa.CheckConstraint("role in ('driver', 'facility_manager', 'operator')"),
        schema="parking",
    )
    op.create_table(
        "facilities",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("parking.profiles.id"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("address", sa.String(250), nullable=False),
        sa.Column("hourly_rate", sa.Numeric(10, 2), nullable=False),
        schema="parking",
    )
    op.create_index("ix_parking_facilities_owner_id", "facilities", ["owner_id"], schema="parking")
    op.create_table(
        "slots",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("facility_id", sa.Uuid(), sa.ForeignKey("parking.facilities.id"), nullable=False),
        sa.Column("label", sa.String(24), nullable=False),
        sa.Column("grid_row", sa.Integer(), nullable=False),
        sa.Column("grid_column", sa.Integer(), nullable=False),
        sa.UniqueConstraint("facility_id", "label"),
        sa.UniqueConstraint("facility_id", "grid_row", "grid_column"),
        schema="parking",
    )


def downgrade():
    for table in ("slots", "facilities", "profiles"):
        op.drop_table(table, schema="parking")
    op.execute("DROP SCHEMA parking")
