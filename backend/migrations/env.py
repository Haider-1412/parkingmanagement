from alembic import context
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

from app.db import database_url
from app.models import Base, SCHEMA


def include_name(name, object_type, parent_names):
    return object_type != "schema" or name == SCHEMA

if context.is_offline_mode():
    context.configure(url=database_url(), target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with create_engine(database_url(), poolclass=NullPool).connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=Base.metadata,
            include_schemas=True,
            include_name=include_name,
        )
        with context.begin_transaction():
            context.run_migrations()
