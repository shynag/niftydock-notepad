create table public.note_collaboration_documents (
  note_slug text primary key references public.notes(slug) on delete cascade,
  state text not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint note_collaboration_state_size check (char_length(state) <= 4000000)
);

create table public.note_collaboration_updates (
  note_slug text not null references public.notes(slug) on delete cascade,
  update_id text not null,
  update_data text not null,
  created_at timestamptz not null default now(),
  primary key (note_slug, update_id),
  constraint note_collaboration_update_id_length check (char_length(update_id) between 1 and 80),
  constraint note_collaboration_update_size check (char_length(update_data) <= 4000000)
);

create index note_collaboration_updates_created_idx
  on public.note_collaboration_updates (note_slug, created_at);

alter table public.note_collaboration_documents enable row level security;
alter table public.note_collaboration_updates enable row level security;
revoke all on table public.note_collaboration_documents from public, anon, authenticated;
revoke all on table public.note_collaboration_updates from public, anon, authenticated;
grant select, insert, update, delete on table public.note_collaboration_documents to service_role;
grant select, insert, delete on table public.note_collaboration_updates to service_role;

create or replace function public.compact_note_collaboration(
  p_note_slug text,
  p_expected_revision bigint,
  p_state text,
  p_update_ids text[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision bigint;
begin
  select document.revision
    into current_revision
    from public.note_collaboration_documents as document
    where document.note_slug = p_note_slug
    for update;

  if not found or current_revision <> p_expected_revision then
    return false;
  end if;

  update public.note_collaboration_documents
    set state = p_state,
        revision = revision + 1,
        updated_at = pg_catalog.now()
    where note_slug = p_note_slug;

  delete from public.note_collaboration_updates
    where note_slug = p_note_slug
      and update_id = any(p_update_ids);

  return true;
end;
$$;

revoke all on function public.compact_note_collaboration(text, bigint, text, text[]) from public, anon, authenticated;
grant execute on function public.compact_note_collaboration(text, bigint, text, text[]) to service_role;

drop policy if exists "Note links can broadcast collaboration updates" on realtime.messages;
create policy "Note links can broadcast collaboration updates"
on realtime.messages
for insert
to anon, authenticated
with check (
  extension = 'broadcast'
  and (select public.can_receive_note_broadcast())
  and (select realtime.topic()) like 'note:%'
);
