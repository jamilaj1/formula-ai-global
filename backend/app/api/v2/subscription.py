"""Stripe subscriptions + webhook."""
import os

import stripe
from fastapi import APIRouter, Header, HTTPException, Request


router = APIRouter(prefix="/subscription", tags=["subscription"])

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")
WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")


@router.post("/create-checkout")
async def create_checkout(request: Request, plan_slug: str, user_id: str):
    supabase = request.app.state.supabase
    plan = (
        supabase.table("subscription_plans")
        .select("*")
        .eq("slug", plan_slug)
        .single()
        .execute()
    )
    if not plan.data:
        raise HTTPException(404, "plan not found")
    price_id = plan.data.get("stripe_price_id_monthly")
    if not price_id:
        raise HTTPException(400, "plan not configured for Stripe")

    session = stripe.checkout.Session.create(
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=os.getenv("NEXT_PUBLIC_APP_URL") + "/dashboard?paid=1",
        cancel_url=os.getenv("NEXT_PUBLIC_APP_URL") + "/pricing?cancel=1",
        client_reference_id=user_id,
    )
    return {"url": session.url, "session_id": session.id}


@router.post("/webhook")
async def stripe_webhook(request: Request, stripe_signature: str = Header(None)):
    supabase = request.app.state.supabase
    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(
            payload, stripe_signature, WEBHOOK_SECRET
        )
    except Exception:
        raise HTTPException(400, "invalid signature")

    obj = event["data"]["object"]
    et = event["type"]

    if et == "checkout.session.completed":
        user_id = obj.get("client_reference_id")
        if user_id:
            supabase.table("users").update(
                {
                    "subscription_status": "active",
                    "stripe_customer_id": obj.get("customer"),
                    "stripe_subscription_id": obj.get("subscription"),
                }
            ).eq("id", user_id).execute()

    if et == "customer.subscription.deleted":
        supabase.table("users").update({"subscription_status": "cancelled"}).eq(
            "stripe_subscription_id", obj.get("id")
        ).execute()

    return {"received": True}
