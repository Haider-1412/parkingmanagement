import os
from functools import cache

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session

load_dotenv()


class Base(DeclarativeBase):
    pass


def database_url():
    return os.environ["DATABASE_URL"]


def get_db():
    with Session(engine()) as session:
        yield session


@cache
def engine():
    return create_engine(
        database_url(), pool_pre_ping=True,
        connect_args={"connect_timeout": 4, "prepare_threshold": None},
    )
