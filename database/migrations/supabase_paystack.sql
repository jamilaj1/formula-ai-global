-- ============================================================
-- Paystack billing — adds columns to profiles for Paystack subscriptions
-- Run in Supabase SQL editor (idempotent)
-- ============================================================

alter table public.profiles
  add column if not exists paystack_customer_code text,
  add column if not exists paystack_subscription_code text,
  add column if not exists paystack_authorization_code text,
  add column if not exists plan_renews_at timestamptz;

create index if not exists profiles_paystack_customer_idx on public.profiles(paystack_customer_code);
create index if not exists profiles_paystack_subscription_idx on public.profiles(paystack_subscription_code);
