select public.create_user(
  u.phone,
  coalesce(
    nullif(u.raw_user_meta_data ->> 'display_name', ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'New user'
  ),
  u.id
)
from auth.users u
where not exists (select 1 from public.users p where p.id = u.id);