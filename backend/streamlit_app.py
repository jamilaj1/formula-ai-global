"""
streamlit_app.py — alternative Python UI for Formula AI Global.

This is a SECONDARY UI for users who prefer Python/Streamlit over the
canonical static HTML site. Run with:

    streamlit run streamlit_app.py

Talks to the FastAPI backend at $API_URL (default: http://localhost:8000).
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional, Tuple

import requests
import streamlit as st


# ──────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────
API_BASE = os.getenv("API_URL") or st.secrets.get("API_URL", "http://localhost:8000") if hasattr(st, "secrets") else os.getenv("API_URL", "http://localhost:8000")


def _init_state() -> None:
    if "token" not in st.session_state:
        st.session_state.token = None
    if "user" not in st.session_state:
        st.session_state.user = None


# ──────────────────────────────────────────────────────────────────
# API client
# ──────────────────────────────────────────────────────────────────
def api_call(
    method: str, endpoint: str, data: Optional[Dict] = None, auth: bool = True
) -> Tuple[Dict[str, Any], int]:
    url = f"{API_BASE}{endpoint}"
    headers = {"Content-Type": "application/json"}
    if auth and st.session_state.token:
        headers["Authorization"] = f"Bearer {st.session_state.token}"

    try:
        if method == "GET":
            response = requests.get(url, headers=headers, timeout=30)
        elif method == "POST":
            response = requests.post(url, json=data or {}, headers=headers, timeout=60)
        else:
            response = requests.request(method, url, json=data or {}, headers=headers, timeout=30)

        if response.status_code == 401 and auth:
            st.session_state.token = None
            st.session_state.user = None
            st.error("Session expired. Please sign in again.")
            st.rerun()

        try:
            return response.json(), response.status_code
        except ValueError:
            return {"error": "Invalid JSON response", "raw": response.text}, response.status_code
    except requests.RequestException as exc:
        return {"error": str(exc)}, 500


# ──────────────────────────────────────────────────────────────────
# Auth pages
# ──────────────────────────────────────────────────────────────────
def login_page() -> None:
    st.title("🔬 Formula AI Global")
    st.markdown("### Intelligent Chemical Formulation")

    tab_login, tab_register = st.tabs(["Sign in", "Create account"])

    with tab_login:
        with st.form("login_form"):
            email = st.text_input("Email")
            password = st.text_input("Password", type="password")
            submit = st.form_submit_button("Sign in", use_container_width=True)
            if submit:
                with st.spinner("Authenticating…"):
                    result, status = api_call(
                        "POST", "/auth/login", {"email": email, "password": password}, auth=False
                    )
                if status == 200:
                    st.session_state.token = result["access_token"]
                    st.session_state.user = result["user"]
                    st.success(f"Welcome back, {result['user'].get('full_name') or result['user']['email']}!")
                    st.rerun()
                else:
                    st.error(result.get("detail", "Sign-in failed"))

    with tab_register:
        with st.form("register_form"):
            r_email = st.text_input("Email", key="r_email")
            r_password = st.text_input("Password", type="password", key="r_pass")
            r_name = st.text_input("Full name (optional)", key="r_name")
            r_submit = st.form_submit_button("Create account", use_container_width=True)
            if r_submit:
                with st.spinner("Creating account…"):
                    result, status = api_call(
                        "POST", "/auth/register",
                        {"email": r_email, "password": r_password, "full_name": r_name or None},
                        auth=False,
                    )
                if status == 200:
                    st.session_state.token = result["access_token"]
                    st.session_state.user = result["user"]
                    st.success("Account created!")
                    st.rerun()
                else:
                    st.error(result.get("detail", "Registration failed"))


# ──────────────────────────────────────────────────────────────────
# Dashboard
# ──────────────────────────────────────────────────────────────────
def dashboard() -> None:
    user = st.session_state.user

    with st.sidebar:
        st.markdown(f"### {user.get('full_name') or user['email']}")
        st.caption(user["email"])

        tier = user.get("subscription_tier", "starter")
        tier_emoji = {"starter": "🆓", "professional": "⭐", "business": "💼", "enterprise": "🏢"}
        st.markdown(f"{tier_emoji.get(tier, '⚪')} **{tier.upper()}** plan")

        st.divider()

        page = st.radio(
            "Navigation",
            ["🧪 Formulate", "📊 My formulas", "🔬 Lab simulation", "🛡️ Safety check", "💳 Billing", "⚙️ Settings"],
            label_visibility="collapsed",
        )

        st.divider()
        if st.button("Sign out", use_container_width=True):
            st.session_state.token = None
            st.session_state.user = None
            st.rerun()

    if "Formulate" in page:
        formulate_page()
    elif "My formulas" in page:
        my_formulas_page()
    elif "Lab" in page:
        lab_page()
    elif "Safety" in page:
        safety_page()
    elif "Billing" in page:
        billing_page()
    else:
        settings_page()


def formulate_page() -> None:
    st.title("🧪 Formulate")

    col1, col2 = st.columns([2, 1])
    with col1:
        product = st.selectbox(
            "Product type",
            ["Liquid hand soap", "Shampoo", "Body wash", "Dishwashing liquid",
             "Laundry detergent", "Surface cleaner", "Cosmetic cream", "Hair conditioner"],
        )
        col_a, col_b = st.columns(2)
        with col_a:
            skin_type = st.selectbox("Target skin", ["Normal", "Sensitive", "Dry", "Oily", "Baby"])
            budget = st.selectbox("Budget tier", ["Economy", "Industrial", "Premium", "Laboratory"])
        with col_b:
            region = st.selectbox(
                "Target market",
                ["Africa West", "Africa East", "Middle East", "South Asia",
                 "Southeast Asia", "Europe", "North America", "South America"],
            )
            volume = st.number_input("Batch size (kg)", min_value=1, value=100)

        with st.expander("Advanced requirements"):
            high_foam = st.checkbox("High foaming")
            natural = st.checkbox("Natural positioning")
            sulfate_free = st.checkbox("Sulfate free")
            paraben_free = st.checkbox("Paraben free")
            fragrance_free = st.checkbox("Fragrance free")

        if st.button("🚀 Generate formula", type="primary", use_container_width=True):
            with st.spinner("AI is formulating…"):
                payload = {
                    "goal": product.lower().replace(" ", "_"),
                    "constraints": {
                        "budget": budget.lower(),
                        "skin_type": skin_type.lower(),
                        "region": region.lower().replace(" ", "_"),
                        "volume_kg": volume,
                    },
                    "preferences": {
                        "high_foam": high_foam, "natural": natural,
                        "sulfate_free": sulfate_free, "paraben_free": paraben_free,
                        "fragrance_free": fragrance_free,
                    },
                }
                result, status = api_call("POST", "/formulate", payload)
            if status == 200:
                _render_formula(result)
            else:
                st.error(result.get("detail", "Formulation failed"))

    with col2:
        st.markdown("### Quick stats")
        usage, _ = api_call("GET", "/billing/usage")
        if "formulations_used" in usage:
            st.metric("Formulas this month", f"{usage['formulations_used']} / {usage['formulations_limit']}")
            st.metric("API calls today", f"{usage['api_calls_today']} / {usage['api_calls_limit']}")


def _render_formula(result: Dict[str, Any]) -> None:
    st.success("✅ Formula generated")
    primary = result.get("primary_formula", {})
    tabs = st.tabs(["📋 Formula", "🔬 Lab", "🛡️ Safety", "💰 Variants"])

    with tabs[0]:
        rows = []
        for c in primary.get("components", []):
            rows.append({
                "Material": c.get("name_en", "—"),
                "CAS": c.get("cas_number", "—"),
                "Percentage": c.get("percentage", "0%"),
                "Function": c.get("function", "—"),
                "Cost/kg": f"${c.get('cost_per_kg', 0):.2f}",
            })
        st.dataframe(rows, use_container_width=True, hide_index=True)
        total = sum(
            float(c.get("cost_per_kg", 0)) * float(str(c.get("percentage", "0%")).replace("%", "")) / 100
            for c in primary.get("components", [])
        )
        st.metric("Estimated cost per kg", f"${total:.2f}")

    with tabs[1]:
        sim = result.get("simulation", {})
        c1, c2, c3 = st.columns(3)
        c1.metric("pH", sim.get("ph", "—"))
        c2.metric("Viscosity", f"{sim.get('viscosity_cp', 0):.0f} cP")
        c3.metric("Shelf life", f"{sim.get('shelf_life_days', 0)} days")
        score = sim.get("stability_score", 0)
        st.progress(score / 100, text=f"Stability score: {score}/100")

    with tabs[2]:
        safety = result.get("safety", {})
        risk = safety.get("risk_level", "unknown")
        st.markdown(f"### Risk level: **{risk.upper()}**")
        for r in safety.get("all_risks", []):
            st.markdown(f"• **{r['level']}** — {r.get('description_en', '')}")
            st.caption(f"Action: {r.get('action', 'N/A')} · Source: {r.get('source', 'N/A')}")

    with tabs[3]:
        variants = result.get("economic_variants", {})
        rows = []
        for level, plan in variants.items():
            rows.append({
                "Tier": level.upper(),
                "Cost savings": f"{plan.get('cost_savings_percent', 0):.1f}%",
                "Cost/kg": f"${plan.get('total_cost_per_kg', 0):.2f}",
                "Quality": plan.get("quality_impact", "—")[:60],
            })
        st.dataframe(rows, use_container_width=True, hide_index=True)


def my_formulas_page() -> None:
    st.title("📊 My formulas")
    result, status = api_call("GET", "/my-formulas")
    if status == 200 and result:
        for f in result if isinstance(result, list) else []:
            with st.expander(f"{f.get('name', 'Unnamed')} — {str(f.get('created_at', ''))[:10]}"):
                st.json(f)
    else:
        st.info("No formulas yet. Generate your first one!")


def lab_page() -> None:
    st.title("🔬 Virtual laboratory")
    n = st.number_input("Number of components", min_value=1, max_value=20, value=3)
    components = []
    for i in range(int(n)):
        cols = st.columns([3, 2, 2])
        with cols[0]:
            name = st.text_input(f"Material {i+1}", key=f"mat_{i}")
        with cols[1]:
            pct = st.number_input("%", min_value=0.0, max_value=100.0, value=33.3, key=f"pct_{i}")
        with cols[2]:
            cas = st.text_input("CAS (optional)", key=f"cas_{i}")
        if name:
            components.append({"name_en": name, "percentage": f"{pct}%", "cas_number": cas})

    if st.button("Run simulation", type="primary"):
        with st.spinner("Simulating…"):
            result, status = api_call("POST", "/simulate", {"components": components})
        if status == 200:
            st.json(result)
        else:
            st.error("Simulation failed")


def safety_page() -> None:
    st.title("🛡️ Safety analyzer")
    text = st.text_area(
        "Materials (one per line: Name - Percentage)",
        placeholder="Sodium Laureth Sulfate - 15%\nCocamidopropyl Betaine - 5%\nWater - 80%",
        height=150,
    )
    if st.button("Analyze", type="primary"):
        components = []
        for line in text.strip().splitlines():
            if "-" in line:
                parts = line.split("-", 1)
                components.append({"name_en": parts[0].strip(), "percentage": parts[1].strip()})
        result, status = api_call("POST", "/safety-check", {"components": components})
        if status == 200:
            risk = result.get("risk_level", "unknown")
            emoji = {"safe": "🟢", "caution": "🟡", "warning": "🟠", "dangerous": "🔴", "deadly": "☠️"}
            st.markdown(f"## {emoji.get(risk, '❓')} Risk level: {risk.upper()}")
            for r in result.get("all_risks", []):
                with st.container():
                    st.markdown(f"**{r['category'].upper()}** — {r['level']}")
                    st.markdown(r.get("description_ar") or r.get("description_en"))
                    st.caption(f"Source: {r.get('source', '—')}")
        else:
            st.error(result.get("detail", "Safety check failed"))


def billing_page() -> None:
    st.title("💳 Billing")
    plans, _ = api_call("GET", "/billing/plans", auth=False)
    sub, _ = api_call("GET", "/billing/subscription")

    st.subheader("Current subscription")
    if sub.get("plan"):
        st.info(f"**{sub['plan'].upper()}** · status: {sub.get('status', 'unknown')}")

    st.subheader("Available plans")
    cols = st.columns(len(plans) if isinstance(plans, dict) else 1)
    for i, (plan_id, plan) in enumerate(plans.items() if isinstance(plans, dict) else []):
        with cols[i]:
            st.markdown(f"### {plan['name']}")
            st.markdown(f"**${plan['price_monthly']}** / month")
            for k, v in plan["features"].items():
                st.caption(f"{k.replace('_', ' ')}: {v}")


def settings_page() -> None:
    st.title("⚙️ Settings")
    user = st.session_state.user
    st.text_input("Email", value=user["email"], disabled=True)
    st.text_input("Full name", value=user.get("full_name") or "")
    st.selectbox("Default region", ["Africa West", "Africa East", "Middle East", "Europe"])
    st.selectbox("Default language", ["English", "العربية", "Français"])


# ──────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────
def main() -> None:
    st.set_page_config(
        page_title="Formula AI Global",
        page_icon="🔬",
        layout="wide",
        initial_sidebar_state="expanded",
    )
    _init_state()

    st.markdown(
        """
        <style>
        .stButton > button { border-radius: 8px; font-weight: 600; }
        .stMetric { background: #f0f2f6; padding: 14px; border-radius: 10px; }
        </style>
        """,
        unsafe_allow_html=True,
    )

    if not st.session_state.token:
        login_page()
    else:
        dashboard()


if __name__ == "__main__":
    main()
