"""`products.retry_of` — the retake chain, and who is allowed to point at what.

Run: cd web && api/.venv/bin/python3 api/test_retry_chain.py

SQLite in memory, no server, no AI service, no pytest.

The column exists so the gate's thresholds can be argued from real traffic rather than from
the 93 scenes they were calibrated on: `ai/enhance/observe.py` records what the gate decided
and this records whether the artisan agreed. `docs/Abhay/CHANGELOG.md`, 2026-09-07 (2).

Two things are worth a test and the rest is a nullable string. A product id is the one thing
an artisan can guess about somebody else's account, so an unchecked `retry_of` would write
another artisan's id into a row they own. And the chain must be write-once: a field a PATCH
can rewrite records what somebody decided afterwards, not what happened.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from web.api.db import get_db  # noqa: E402
from web.api.main import app  # noqa: E402
from web.api.models import Artisan, Base, Product  # noqa: E402
from web.api.routers.products import ProductCreate, ProductIn  # noqa: E402
from web.api.security import current_artisan  # noqa: E402

# StaticPool, or every connection gets its own empty in-memory database and the tables
# created below are invisible to the request thread TestClient runs the route on.
engine = create_engine("sqlite://", future=True, poolclass=StaticPool,
                       connect_args={"check_same_thread": False})
Session = sessionmaker(bind=engine, autoflush=False, future=True)
Base.metadata.create_all(engine)

db = Session()
MINE = Artisan(id="a_mine", phone="+910000000001")
db.add_all([MINE, Artisan(id="a_theirs", phone="+910000000002")])
db.add(Product(id="p_mine", artisan_id="a_mine"))
db.add(Product(id="p_theirs", artisan_id="a_theirs"))
db.commit()

app.dependency_overrides[get_db] = lambda: db
app.dependency_overrides[current_artisan] = lambda: MINE
client = TestClient(app)


def _create(body):
    return client.post("/api/products", json=body)


def test_a_retake_of_my_own_refused_product_is_recorded():
    res = _create({"retry_of": "p_mine"})
    assert res.status_code == 200, res.text
    assert db.get(Product, res.json()["id"]).retry_of == "p_mine"


def test_no_retry_of_is_the_ordinary_case():
    res = _create({})
    assert res.status_code == 200, res.text
    assert db.get(Product, res.json()["id"]).retry_of is None


def test_a_chain_may_not_point_at_someone_elses_product():
    """The whole reason the ownership check exists. Same 404 as any other product that is
    not yours — a different code would confirm the id is real."""
    res = _create({"retry_of": "p_theirs"})
    assert res.status_code == 404, res.text


def test_a_chain_may_not_point_at_nothing():
    res = _create({"retry_of": "p_does_not_exist"})
    assert res.status_code == 404, res.text


def test_the_chain_cannot_be_rewritten_by_a_patch():
    """Write-once by construction: PATCH takes `ProductIn`, which has no such field, so a
    later edit cannot restate what happened at capture time."""
    assert "retry_of" in ProductCreate.model_fields
    assert "retry_of" not in ProductIn.model_fields


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print("  ok ", name)
    print("all passed")
