from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from .config import settings
from .models import Base


def _engine_kwargs(url: str) -> dict:
    """Connection settings that pgbouncer's transaction mode forces on us.

    Supabase's runtime pooler (port 6543) is pgbouncer in `transaction` mode: a backend is
    handed back to the pool at the end of every transaction. Two consequences, and both
    fail in ways that look random rather than obvious:

      * psycopg3 pipelines prepared statements by default. In transaction mode the next
        statement may land on a different backend that has never seen the PREPARE, so you
        get intermittent `prepared statement "_pg3_0" does not exist`. `prepare_threshold
        =None` disables preparation entirely.
      * SQLAlchemy's own connection pool in front of pgbouncer's pool holds server-side
        state that pgbouncer has already recycled. NullPool defers pooling to pgbouncer,
        which is the thing actually equipped to do it.

    Plain Postgres and SQLite get none of this — it would just be overhead.
    """
    if url.startswith("sqlite"):
        return {}
    kwargs: dict = {"pool_pre_ping": True}
    if "pooler.supabase.com:6543" in url:
        kwargs["poolclass"] = NullPool
        kwargs["connect_args"] = {"prepare_threshold": None}
    return kwargs


engine = create_engine(settings().database_url, future=True, **_engine_kwargs(settings().database_url))
SessionLocal = sessionmaker(bind=engine, autoflush=False, future=True)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_all() -> None:
    """Local bootstrap only.

    Anything shared goes through Alembic. `create_all` silently ignores every column you
    altered, so on a database more than one person uses it produces a schema that looks
    right and is not.
    """
    if not settings().is_dev:
        raise RuntimeError("create_all is dev-only — use `alembic upgrade head`")
    Base.metadata.create_all(engine)
