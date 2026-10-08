create or replace function public.append_note_collaboration_updates(
  p_note_slug text,
  p_updates jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  if pg_catalog.jsonb_typeof(p_updates) is distinct from 'array' then
    raise exception 'p_updates must be a JSON array';
  end if;

  -- Serialize update appends with snapshot compaction. The document revision
  -- then acts as a reliable marker for updates added between snapshot reads.
  perform 1
    from public.note_collaboration_documents as document
    where document.note_slug = p_note_slug
    for update;

  if not found then
    raise exception 'collaboration document does not exist';
  end if;

  insert into public.note_collaboration_updates (note_slug, update_id, update_data)
    select
      p_note_slug,
      update_item.value ->> 'id',
      update_item.value ->> 'data'
    from pg_catalog.jsonb_array_elements(p_updates) as update_item(value)
    on conflict (note_slug, update_id) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count > 0 then
    update public.note_collaboration_documents
      set revision = revision + 1,
          updated_at = pg_catalog.now()
      where note_slug = p_note_slug;
  end if;
end;
$$;

revoke all on function public.append_note_collaboration_updates(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.append_note_collaboration_updates(text, jsonb)
  to service_role;
