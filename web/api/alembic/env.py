"""Alembic environment.

Reads the URL from our own settings rather than alembic.ini, so there is exactly one place
credentials live and no chance of the ini drifting from the app.

Migrations deliberately use `settings().migration_url`, not `database_url`. On Supabase the
runtime connection is the TRANSACTION pooler (port 6543), and Alembic cannot run through
it — it takes a session-level advisory lock and runs DDL in a long transaction, neither of
which survives a pooler that hands the backend back after every statement. Migrations go
through the session pooler or a direct connection.
"""

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# api/ is the package root; alembic/ sits inside it.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from api.config import settings  # noqa: E402
from api.models import Base  # noqa: E402

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", settings().migration_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings().migration_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # Without compare_type, autogenerate silently misses a column whose type
            # changed — which is exactly the change most likely to corrupt data.
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
