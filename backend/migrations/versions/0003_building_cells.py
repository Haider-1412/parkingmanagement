from alembic import op
import sqlalchemy as sa

revision = "0003_building_cells"
down_revision = "0002_facility_layout"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "facilities",
        sa.Column("building_cells", sa.JSON(), nullable=False, server_default="[]"),
        schema="parking",
    )


def downgrade():
    op.drop_column("facilities", "building_cells", schema="parking")
