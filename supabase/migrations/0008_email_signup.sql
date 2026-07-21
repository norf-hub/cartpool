-- Carry the email through on signup.
--
-- 0006's trigger passed only auth.users.phone to create_user, which is correct
-- for the spec's phone-first identity (§8) but leaves users.email null when a
-- signup arrives with an email and no phone. That happens in two real cases:
-- the email-invited member who hasn't attached a phone yet (spec §3), and
-- email OTP sign-in used during development while SMS is unavailable.
--
-- users.phone_number stays nullable and is still the production identity; this
-- only stops the email from being discarded. create_user's signature is
-- unchanged so the existing tests and callers are unaffected.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_display_name text;
begin
  -- Fall back to the local part of the email before the generic placeholder,
  -- so an email signup shows something recognizable to groupmates.
  v_display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'New user'
  );

  perform create_user(new.phone, v_display_name, new.id);

  if new.email is not null then
    update users set email = new.email where id = new.id;
  end if;

  return new;
end;
$$;
