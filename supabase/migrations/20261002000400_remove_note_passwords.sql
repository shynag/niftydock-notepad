-- Password protection was removed from the product. Keep note content intact,
-- but remove stored hashes and password-only rate-limit data.
drop function if exists public.consume_note_password_attempt(text, text);
drop table if exists public.note_password_attempts;

-- Realtime sends only note slug/version/timestamp metadata, so all note links
-- can receive these broadcasts now that password protection no longer exists.
create or replace function public.can_receive_note_broadcast()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.notes as note
    where note.slug = pg_catalog.substr(realtime.topic(), 6)
  );
$$;

revoke all on function public.can_receive_note_broadcast() from public, anon, authenticated;
grant execute on function public.can_receive_note_broadcast() to anon, authenticated;

drop policy if exists "Only unprotected note links can receive their broadcast"
on realtime.messages;
drop policy if exists "Note links can receive metadata broadcasts"
on realtime.messages;

create policy "Note links can receive metadata broadcasts"
on realtime.messages
for select
to anon, authenticated
using (
  extension = 'broadcast'
  and (select public.can_receive_note_broadcast())
  and (select realtime.topic()) like 'note:%'
);

alter table public.notes
  drop constraint if exists notes_password_hash_length;
alter table public.notes
  drop column if exists password_hash;
