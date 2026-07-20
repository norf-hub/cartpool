-- Realtime for the core loop: stream row changes on items and memberships so
-- the merged list updates close-to-real-time (spec §4 race handling relies on
-- the server; the client just refetches on change events).
--
-- Guarded like the other Supabase-specific bits: bare Postgres in CI has no
-- supabase_realtime publication, and that's fine — nothing here is load-bearing
-- for correctness, only for liveness.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'items'
    ) then
      alter publication supabase_realtime add table public.items;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'memberships'
    ) then
      alter publication supabase_realtime add table public.memberships;
    end if;
  else
    raise notice 'supabase_realtime publication not found; skipping (bare Postgres)';
  end if;
end $$;
