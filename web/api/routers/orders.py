"""Unified order inbox. Spec §9.

Without this, "virtual business manager" is false advertising: if the artisan has to log
into Seller Central to see an order, we have failed the PS.

Ingestion is two shapes, one canonical Order — webhooks where a channel pushes (ONDC
Beckn callbacks, Amazon Notifications, Flipkart's Order Management Notification service)
and scheduled polling where it does not.

⚠️ GeM has no order API at all. Orders appear on the GeM seller dashboard and nowhere
else. A cluster coordinator reconciles them in the admin console. We do NOT pretend to
have GeM order sync — stating the gap and showing the workaround reads as maturity;
faking it is a question we cannot survive.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from ..caching import conditional
from ..db import get_db
from ..models import Artisan, Order, OrderState
from ..security import current_artisan

router = APIRouter()


@router.get("/orders")
def inbox(
    request: Request,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Response:
    """The inbox: seven named columns, newest first, one page at a time.

    Unbounded before this — every order the artisan had ever received, in full, on every
    visit to /home and to /orders. That set only grows, so the app got slower for precisely
    the artisans doing best on it. Whole Order entities also carried the raw channel payload
    each row was built from, which this response has never included.
    """
    rows = (
        db.query(
            Order.id,
            Order.channel,
            Order.state,
            Order.amount,
            Order.quantity,
            Order.expected_settlement_date,
            Order.artisan_confirmed_payment,
        )
        .filter(Order.artisan_id == artisan.id)
        # The id tiebreak keeps paging stable when two orders share a timestamp.
        .order_by(Order.created_at.desc(), Order.id)
        .limit(limit)
        .offset(offset)
        .all()
    )
    payload = [
        {
            "id": o.id,
            "channel": o.channel.value,
            "state": o.state.value,
            "amount": float(o.amount),
            "quantity": o.quantity,
            "expected_settlement_date": o.expected_settlement_date,
            "artisan_confirmed_payment": o.artisan_confirmed_payment,
        }
        for o in rows
    ]
    # 15s, not 30: an order that has just arrived is money somebody is waiting on, and this
    # is the screen they refresh when they are waiting.
    return conditional(request, payload, max_age=15)


@router.post("/orders/{order_id}/state")
def set_state(
    order_id: str,
    state: OrderState,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    o = db.get(Order, order_id)
    if o is None or o.artisan_id != artisan.id:
        return {"ok": False}
    o.state = state
    db.commit()
    return {"ok": True}


@router.post("/orders/{order_id}/payment-received")
def payment_received(
    order_id: str,
    received: bool,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    """The "Paisa aaya?" tap (spec §11.3).

    We can see what a marketplace promised to send. We cannot see the artisan's bank
    account — which is why the UI says "Amazon ne bheje hain", never "aa gaye". One tap
    from thousands of artisans turns that limitation into real settlement-delay evidence
    worth handing back to the ministry.
    """
    o = db.get(Order, order_id)
    if o is None or o.artisan_id != artisan.id:
        return {"ok": False}
    o.artisan_confirmed_payment = received
    db.commit()
    return {"ok": True}
