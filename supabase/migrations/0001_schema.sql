-- Cartpool schema, per Product Spec v3 + Technical Addendum (with v3 fixes:
-- items.group_id NOT NULL — the solo list is a real one-member group).

create extension if not exists pgcrypto;

create type item_status as enum ('open', 'purchased', 'removed');
create type invite_channel as enum ('phone', 'email', 'link');
create type store_type as enum ('app_store', 'play_store');

create table users (
  id              uuid primary key default gen_random_uuid(), -- RevenueCat app_user_id
  phone_number    text unique,          -- account identity; null only for email-invited users pre-attachment
  display_name    text not null,
  email           text,
  large_text_mode boolean not null default false,
  global_mute     boolean not null default false,
  created_at      timestamptz not null default now()
);

create table groups (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz -- set when last member leaves; retained for purchase history
);

create table memberships (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references groups (id),
  user_id       uuid not null references users (id),
  joined_at     timestamptz not null default now(),
  left_at       timestamptz,        -- null = active
  mute_override boolean             -- null = follow global setting
);

-- One active membership per (group, user).
create unique index memberships_active_uniq
  on memberships (group_id, user_id) where left_at is null;
create index memberships_active_by_user
  on memberships (user_id) where left_at is null;

-- NOTE: the 4-active-member cap is NOT a declarative constraint — it is
-- race-prone under concurrent joins and is enforced by a trigger taking a
-- per-group advisory lock (0002_triggers.sql).

create table items (
  id                   uuid primary key default gen_random_uuid(),
  group_id             uuid not null references groups (id), -- v3: never null; solo lists are real groups
  added_by             uuid not null references users (id),  -- only this user may edit text or remove
  text                 text not null,
  status               item_status not null default 'open',
  purchased_by         uuid references users (id),
  purchased_at         timestamptz,
  is_bulk              boolean not null default false,
  bulk_note            text,
  bulk_needs_reconfirm boolean not null default false,
  source_left_at       timestamptz, -- adder left the group; drives the 2-day grace purge
  removed_at           timestamptz, -- purge target for the 2-week retention rule
  created_at           timestamptz not null default now(),
  constraint purchased_has_buyer check (status <> 'purchased' or purchased_by is not null)
);

create index items_by_group on items (group_id) where status <> 'removed';

create table bulk_opt_ins (
  id                        uuid primary key default gen_random_uuid(),
  item_id                   uuid not null references items (id) on delete cascade,
  user_id                   uuid not null references users (id),
  committed_before_purchase boolean not null, -- true = pre-commit, false = assigned retroactively
  needs_reconfirmation      boolean not null default false,
  created_at                timestamptz not null default now(),
  unique (item_id, user_id)
);

create table invites (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups (id), -- tied to the group, not the inviter
  code       text not null unique,
  channel    invite_channel not null,
  target     text, -- phone or email, if directed
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz
);

create table waitlist_entries (
  id           uuid primary key default gen_random_uuid(),
  seq          bigint generated always as identity, -- insertion order, breaks requested_at ties
  group_id     uuid not null references groups (id),
  user_id      uuid not null references users (id),
  requested_at timestamptz not null default now(), -- FCFS ordering key
  promoted_at  timestamptz,
  unique (group_id, user_id)
);

create table blocks (
  id         uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references users (id), -- "A"
  blocked_id uuid not null references users (id), -- "B"
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);
-- v3: co-placement is barred in BOTH directions; lookups check either column.
create index blocks_by_blocked on blocks (blocked_id);

create table subscriptions (
  user_id            uuid primary key references users (id), -- = RevenueCat app_user_id
  entitlement_active boolean not null default false,          -- cartpool_unlimited
  store              store_type,
  in_grace_period    boolean not null default false,
  frozen_read_only   boolean not null default false, -- v3: read-only EVERYWHERE until 3 groups chosen
  kept_group_ids     uuid[],                          -- after choosing: excess groups stay read-only
  updated_at         timestamptz not null default now()
);
