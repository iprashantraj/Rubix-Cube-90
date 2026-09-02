from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from .config import settings
from .models import Base


def _engine_kwargs(url: str) -> dict:
    """Connection settings that pgbouncer's transaction mode forces on us.

    Supabase's runtime pooler (port 6543) is pgbouncer in `transaction` mode: a backend is
    handed back to the pool at the end of every transaction. The consequence that fails in
    a way that looks random rather than obvious: psycopg3 pipelines prepared statements by
    default, and in transaction mode the next statement may land on a different backend
    that has never seen the PREPARE, so you get intermittent `prepared statement "_pg3_0"
    does not exist`. `prepare_threshold=None` disables preparation entirely.

    ⚠️ This used to also set `poolclass=NullPool`, on the theory that SQLAlchemy's pool in
    front of pgbouncer's holds server-side state pgbouncer has already recycled. The only
    such state psycopg3 keeps is the prepared statements disabled on the line below — so
    the theory cost us a full TCP+TLS handshake to Supabase on EVERY request and bought
    nothing. Measured from a dev box: 1.4-4.2s to connect against ~0.4s for the query.

    A chunked photo upload is ~10 requests (start, probe, one per 256KB, complete, then
    the product row, the image row and the enhance kick-off), so that handshake was
    landing ten times per photograph. It is the single largest cost in the upload path.

    We are a long-lived uvicorn process, not a serverless function: a small client-side
    pool is the arrangement pgbouncer expects. Keep it modest — every checked-out
    connection holds a pgbouncer client slot, and the Supabase free tier's limit is not
    generous. `pool_recycle` is under pgbouncer's own idle timeout so we never hand out a
    connection it has already dropped underneath us.

    Plain Postgres and SQLite get none of this — it would just be overhead.
    """
    if url.startswith("sqlite"):
        return {}
    kwargs: dict = {"pool_pre_ping": True, "pool_recycle": 280}
    if "pooler.supabase.com:6543" in url:
        kwargs["connect_args"] = {"prepare_threshold": None}
        kwargs["pool_size"] = 5
        kwargs["max_overflow"] = 5
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
