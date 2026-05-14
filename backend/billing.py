"""
billing.py — Stripe subscriptions for Formula AI Global.

4 plans (matching the existing pricing.html):
  • Starter ($0)        — 10 formulas/month
  • Professional ($49)  — 100 formulas/month
  • Business ($299)     — Unlimited + team
  • Enterprise ($999)   — On-premise + dedicated support

Bug fixes vs spec:
  • No circular import — receives `supabase` and `get_current_active_user` as args
  • `Optional` & all types properly imported
  • `stripe.error` replaced with new SDK style
  • All datetime objects use `timezone.utc`
  • Plan IDs match the existing 4-tier pricing in pricing.html
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from .auth import UserInDB

# ──────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────
stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")

router = APIRouter(prefix="/billing", tags=["Billing"])

# ──────────────────────────────────────────────────────────────────
# 4-tier subscription plans (aligned with pricing.html)
# ──────────────────────────────────────────────────────────────────
SUBSCRIPTION_PLANS: Dict[str, Dict[str, Any]] = {
    "starter": {
        "name": "Starter",
        "price_monthly": 0,
        "price_yearly": 0,
        "features": {
            "formulations_per_month": 10,
            "lab_simulations": 5,
            "safety_checks": 20,
            "export_formats": ["pdf"],
            "api_access": False,
            "team_members": 1,
            "support": "community",
        },
        "stripe_price_id_monthly": None,
        "stripe_price_id_yearly": None,
    },
    "professional": {
        "name": "Professional",
        "price_monthly": 49,
        "price_yearly": 470,  # 20% off
        "features": {
            "formulations_per_month": 100,
            "lab_simulations": 50,
            "safety_checks": 200,
            "export_formats": ["pdf", "excel", "json"],
            "api_access": True,
            "api_calls_per_day": 1000,
            "team_members": 3,
            "support": "priority_24h",
        },
        "stripe_price_id_monthly": os.getenv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_monthly"),
        "stripe_price_id_yearly": os.getenv("STRIPE_PRICE_PRO_YEARLY", "price_pro_yearly"),
    },
    "business": {
        "name": "Business",
        "price_monthly": 299,
        "price_yearly": 2870,
        "features": {
            "formulations_per_month": -1,  # unlimited
            "lab_simulations": -1,
            "safety_checks": -1,
            "export_formats": ["pdf", "excel", "json", "msds"],
            "api_access": True,
            "api_calls_per_day": 50000,
            "team_members": 10,
            "support": "24x7_chat",
            "book_uploads": True,
        },
        "stripe_price_id_monthly": os.getenv("STRIPE_PRICE_BIZ_MONTHLY", "price_biz_monthly"),
        "stripe_price_id_yearly": os.getenv("STRIPE_PRICE_BIZ_YEARLY", "price_biz_yearly"),
    },
    "enterprise": {
        "name": "Enterprise",
        "price_monthly": 999,
        "price_yearly": 9590,
        "features": {
            "formulations_per_month": -1,
            "lab_simulations": -1,
            "safety_checks": -1,
            "export_formats": ["pdf", "excel", "json", "msds", "xml", "sdfs"],
            "api_access": True,
            "api_calls_per_day": -1,
            "team_members": -1,
            "support": "dedicated_account_manager",
            "on_premise": True,
            "custom_models": True,
            "sla": "99.99",
        },
        "stripe_price_id_monthly": os.getenv("STRIPE_PRICE_ENT_MONTHLY", "price_ent_monthly"),
        "stripe_price_id_yearly": os.getenv("STRIPE_PRICE_ENT_YEARLY", "price_ent_yearly"),
    },
}


# ──────────────────────────────────────────────────────────────────
# Models
# ──────────────────────────────────────────────────────────────────
class CheckoutSession(BaseModel):
    plan: str = Field(..., description="starter | professional | business | enterprise")
    billing_cycle: str = Field(default="monthly", description="monthly | yearly")
    success_url: str
    cancel_url: str


class SubscriptionResponse(BaseModel):
    id: str
    plan: str
    status: str
    current_period_start: datetime
    current_period_end: datetime
    cancel_at_period_end: bool
    features: Dict[str, Any]


class UsageStats(BaseModel):
    formulations_used: int
    formulations_limit: int
    simulations_used: int
    simulations_limit: int
    safety_checks_used: int
    safety_checks_limit: int
    api_calls_today: int
    api_calls_limit: int


# ──────────────────────────────────────────────────────────────────
# Public endpoints
# ──────────────────────────────────────────────────────────────────
@router.get("/plans")
async def list_plans() -> Dict[str, Dict[str, Any]]:
    """Return the public plan catalog."""
    return {
        plan_id: {
            "id": plan_id,
            "name": plan["name"],
            "price_monthly": plan["price_monthly"],
            "price_yearly": plan["price_yearly"],
            "features": plan["features"],
            "savings_yearly_pct": (
                round((1 - plan["price_yearly"] / (plan["price_monthly"] * 12)) * 100)
                if plan["price_monthly"] > 0
                else 0
            ),
        }
        for plan_id, plan in SUBSCRIPTION_PLANS.items()
    }


# ──────────────────────────────────────────────────────────────────
# Wireup helper — call from main.py
# ──────────────────────────────────────────────────────────────────
def register_billing_routes(
    app,
    supabase_client,
    get_current_active_user: Callable,
) -> None:
    """
    Wire billing routes into the FastAPI app.

    `get_current_active_user` must be the Depends-friendly callable from auth.py.
    """

    @router.post("/checkout")
    async def create_checkout(
        data: CheckoutSession,
        current_user: UserInDB = Depends(get_current_active_user),
    ) -> Dict[str, str]:
        if data.plan not in SUBSCRIPTION_PLANS:
            raise HTTPException(status_code=400, detail="Invalid plan")
        plan = SUBSCRIPTION_PLANS[data.plan]
        if not plan["stripe_price_id_monthly"]:
            raise HTTPException(status_code=400, detail="Cannot checkout free plan")

        # Get or create the Stripe customer
        if current_user.stripe_customer_id:
            customer_id = current_user.stripe_customer_id
        else:
            customer = stripe.Customer.create(
                email=current_user.email,
                metadata={"user_id": current_user.id},
            )
            customer_id = customer.id
            supabase_client.table("users").update(
                {"stripe_customer_id": customer_id}
            ).eq("id", current_user.id).execute()

        price_id = (
            plan["stripe_price_id_yearly"]
            if data.billing_cycle == "yearly"
            else plan["stripe_price_id_monthly"]
        )

        session = stripe.checkout.Session.create(
            customer=customer_id,
            payment_method_types=["card"],
            line_items=[{"price": price_id, "quantity": 1}],
            mode="subscription",
            success_url=data.success_url,
            cancel_url=data.cancel_url,
            metadata={"user_id": current_user.id, "plan": data.plan},
        )
        return {"checkout_url": session.url, "session_id": session.id}

    @router.get("/subscription", response_model=SubscriptionResponse)
    async def get_subscription(
        current_user: UserInDB = Depends(get_current_active_user),
    ) -> SubscriptionResponse:
        if not current_user.stripe_subscription_id:
            now = datetime.now(timezone.utc)
            return SubscriptionResponse(
                id="starter",
                plan="starter",
                status="active",
                current_period_start=now,
                current_period_end=now + timedelta(days=365),
                cancel_at_period_end=False,
                features=SUBSCRIPTION_PLANS["starter"]["features"],
            )
        try:
            sub = stripe.Subscription.retrieve(current_user.stripe_subscription_id)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        plan_features = SUBSCRIPTION_PLANS.get(
            current_user.subscription_tier, SUBSCRIPTION_PLANS["starter"]
        )["features"]

        return SubscriptionResponse(
            id=sub.id,
            plan=current_user.subscription_tier,
            status=sub.status,
            current_period_start=datetime.fromtimestamp(sub.current_period_start, tz=timezone.utc),
            current_period_end=datetime.fromtimestamp(sub.current_period_end, tz=timezone.utc),
            cancel_at_period_end=sub.cancel_at_period_end,
            features=plan_features,
        )

    @router.post("/cancel")
    async def cancel_subscription(
        current_user: UserInDB = Depends(get_current_active_user),
    ) -> Dict[str, str]:
        if not current_user.stripe_subscription_id:
            raise HTTPException(status_code=400, detail="No active subscription")
        stripe.Subscription.modify(
            current_user.stripe_subscription_id, cancel_at_period_end=True
        )
        return {"status": "cancel_scheduled"}

    @router.post("/reactivate")
    async def reactivate_subscription(
        current_user: UserInDB = Depends(get_current_active_user),
    ) -> Dict[str, str]:
        if not current_user.stripe_subscription_id:
            raise HTTPException(status_code=400, detail="No subscription to reactivate")
        stripe.Subscription.modify(
            current_user.stripe_subscription_id, cancel_at_period_end=False
        )
        return {"status": "reactivated"}

    @router.get("/usage", response_model=UsageStats)
    async def get_usage(
        current_user: UserInDB = Depends(get_current_active_user),
    ) -> UsageStats:
        plan = SUBSCRIPTION_PLANS.get(
            current_user.subscription_tier, SUBSCRIPTION_PLANS["starter"]
        )
        features = plan["features"]
        start_of_month = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        def _count(table: str) -> int:
            try:
                resp = (
                    supabase_client.table(table)
                    .select("count", count="exact")
                    .gte("created_at", start_of_month.isoformat())
                    .eq("user_id", current_user.id)
                    .execute()
                )
                return resp.count or 0
            except Exception:
                return 0

        return UsageStats(
            formulations_used=_count("formulas"),
            formulations_limit=features.get("formulations_per_month", 0),
            simulations_used=_count("lab_simulations"),
            simulations_limit=features.get("lab_simulations", 0),
            safety_checks_used=_count("safety_reports"),
            safety_checks_limit=features.get("safety_checks", 0),
            api_calls_today=current_user.api_calls_today,
            api_calls_limit=features.get("api_calls_per_day", 0),
        )

    @router.get("/invoices")
    async def list_invoices(
        current_user: UserInDB = Depends(get_current_active_user),
    ) -> List[Dict[str, Any]]:
        if not current_user.stripe_customer_id:
            return []
        invoices = stripe.Invoice.list(customer=current_user.stripe_customer_id, limit=24)
        return [
            {
                "id": inv.id,
                "amount": inv.amount_due / 100,
                "currency": inv.currency,
                "status": inv.status,
                "date": datetime.fromtimestamp(inv.created, tz=timezone.utc).isoformat(),
                "pdf_url": inv.invoice_pdf,
                "hosted_url": inv.hosted_invoice_url,
            }
            for inv in invoices.data
        ]

    @router.post("/webhook")
    async def stripe_webhook(request: Request) -> Dict[str, str]:
        payload = await request.body()
        sig_header = request.headers.get("stripe-signature", "")
        try:
            event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid payload")
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid signature")

        handlers = {
            "checkout.session.completed": _handle_checkout_completed,
            "invoice.payment_succeeded": _handle_payment_succeeded,
            "invoice.payment_failed": _handle_payment_failed,
            "customer.subscription.deleted": _handle_subscription_cancelled,
            "customer.subscription.updated": _handle_subscription_updated,
        }
        handler = handlers.get(event["type"])
        if handler:
            await handler(event["data"]["object"], supabase_client)
        return {"status": "ok"}

    app.include_router(router)


# ──────────────────────────────────────────────────────────────────
# Internal webhook handlers
# ──────────────────────────────────────────────────────────────────
async def _handle_checkout_completed(session: Dict, supabase) -> None:
    customer_id = session.get("customer")
    subscription_id = session.get("subscription")
    if not subscription_id:
        return

    sub = stripe.Subscription.retrieve(subscription_id)
    price_id = sub["items"]["data"][0]["price"]["id"]
    tier = _tier_from_price_id(price_id)

    supabase.table("users").update({
        "stripe_customer_id": customer_id,
        "stripe_subscription_id": subscription_id,
        "subscription_status": "active",
        "subscription_tier": tier,
        "subscription_end": datetime.fromtimestamp(sub.current_period_end, tz=timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("stripe_customer_id", customer_id).execute()


async def _handle_payment_succeeded(invoice: Dict, supabase) -> None:
    customer_id = invoice.get("customer")
    paid_at = invoice.get("status_transitions", {}).get("paid_at")
    supabase.table("payment_history").insert({
        "stripe_invoice_id": invoice["id"],
        "customer_id": customer_id,
        "amount": invoice["amount_due"] / 100,
        "currency": invoice["currency"],
        "status": "succeeded",
        "paid_at": (
            datetime.fromtimestamp(paid_at, tz=timezone.utc).isoformat()
            if paid_at else datetime.now(timezone.utc).isoformat()
        ),
    }).execute()


async def _handle_payment_failed(invoice: Dict, supabase) -> None:
    customer_id = invoice.get("customer")
    supabase.table("users").update({
        "subscription_status": "past_due",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("stripe_customer_id", customer_id).execute()


async def _handle_subscription_cancelled(subscription: Dict, supabase) -> None:
    customer_id = subscription.get("customer")
    supabase.table("users").update({
        "subscription_status": "cancelled",
        "subscription_tier": "starter",
        "cancelled_at": datetime.now(timezone.utc).isoformat(),
    }).eq("stripe_customer_id", customer_id).execute()


async def _handle_subscription_updated(subscription: Dict, supabase) -> None:
    customer_id = subscription.get("customer")
    supabase.table("users").update({
        "subscription_status": subscription["status"],
        "subscription_end": datetime.fromtimestamp(
            subscription["current_period_end"], tz=timezone.utc
        ).isoformat(),
        "cancel_at_period_end": subscription.get("cancel_at_period_end", False),
    }).eq("stripe_customer_id", customer_id).execute()


def _tier_from_price_id(price_id: str) -> str:
    for tier, plan in SUBSCRIPTION_PLANS.items():
        if price_id in (plan.get("stripe_price_id_monthly"), plan.get("stripe_price_id_yearly")):
            return tier
    return "starter"
