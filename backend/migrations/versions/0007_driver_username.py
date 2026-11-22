from alembic import op
import sqlalchemy as sa

revision = "0007_driver_username"
down_revision = "0006_facility_operators"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("profiles", sa.Column("username", sa.String(24)), schema="parking")
    op.create_index("uq_profiles_username_lower", "profiles", [sa.text("lower(username)")],
                    unique=True, schema="parking")


def downgrade():
    op.drop_index("uq_profiles_username_lower", table_name="profiles", schema="parking")
    op.drop_column("profiles", "username", schema="parking")
