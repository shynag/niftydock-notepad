create table if not exists public.note_password_attempts (
  slug text not null references public.notes(slug) on delete cascade,
  attempt_key text not null,
  bucket_started_at timestamptz not null,
  attempt_count integer not null,
  primary key (slug, attempt_key),
  constraint note_password_attempt_count_positive check (attempt_count > 0)
);

alter table public.note_password_attempts enable row level security;
revoke all on table public.note_password_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.note_password_attempts to service_role;

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

create or replace function public.consume_note_password_attempt(p_slug text, p_attempt_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_attempt_count integer;
begin
  delete from public.note_password_attempts
  where bucket_started_at < pg_catalog.now() - interval '1 day';

  insert into public.note_password_attempts as existing (
    slug,
    attempt_key,
    bucket_started_at,
    attempt_count
  )
  values (p_slug, p_attempt_key, pg_catalog.now(), 1)
  on conflict (slug, attempt_key) do update
  set bucket_started_at = case
        when existing.bucket_started_at <= pg_catalog.now() - interval '15 minutes' then pg_catalog.now()
        else existing.bucket_started_at
      end,
      attempt_count = case
        when existing.bucket_started_at <= pg_catalog.now() - interval '15 minutes' then 1
        else existing.attempt_count + 1
      end
  returning attempt_count into current_attempt_count;

  return current_attempt_count <= 8;
end;
$$;

revoke all on function public.consume_note_password_attempt(text, text) from public, anon, authenticated;
grant execute on function public.consume_note_password_attempt(text, text) to service_role;
