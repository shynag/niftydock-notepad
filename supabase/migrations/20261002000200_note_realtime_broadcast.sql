-- Realtime events reveal only that a note changed, never its contents or password hash.
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
      and note.password_hash is null
  );
$$;

revoke all on function public.can_receive_note_broadcast() from public, anon, authenticated;
grant execute on function public.can_receive_note_broadcast() to anon, authenticated;

drop policy if exists "Only unprotected note links can receive their broadcast"
on realtime.messages;

create policy "Only unprotected note links can receive their broadcast"
on realtime.messages
for select
to anon, authenticated
using (
  extension = 'broadcast'
  and (select public.can_receive_note_broadcast())
  and (select realtime.topic()) like 'note:%'
);

create or replace function public.broadcast_note_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    pg_catalog.jsonb_build_object(
      'slug', new.slug,
      'version', new.version,
      'updated_at', new.updated_at
    ),
    'note_updated',
    'note:' || new.slug,
    true
  );

  return null;
end;
$$;

revoke all on function public.broadcast_note_change() from public, anon, authenticated;
grant execute on function public.broadcast_note_change() to service_role;

drop trigger if exists notes_broadcast_changes on public.notes;

create trigger notes_broadcast_changes
after insert or update on public.notes
for each row
execute function public.broadcast_note_change();
