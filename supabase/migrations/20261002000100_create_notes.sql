create table public.notes (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null default 'Catatan baru',
  content text not null default '',
  password_hash text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_slug_format check (
    char_length(slug) between 1 and 80
    and slug = lower(slug)
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  constraint notes_title_length check (char_length(title) <= 200),
  constraint notes_content_size check (octet_length(content) <= 1048576),
  constraint notes_password_hash_length check (
    password_hash is null or char_length(password_hash) between 1 and 255
  ),
  constraint notes_version_positive check (version > 0)
);

create unique index notes_slug_unique_idx on public.notes (slug);

comment on column public.notes.password_hash is
  'Encoded password hash only. Never store plaintext note passwords.';
comment on column public.notes.version is
  'Incremented on each update; API uses it for optimistic concurrency checks.';

create function public.set_note_update_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger notes_set_update_metadata
before update on public.notes
for each row
execute function public.set_note_update_metadata();

alter table public.notes enable row level security;

-- Notes are accessed through a server-side API that validates the note slug.
-- Keep direct anonymous and authenticated Data API access closed until that API exists.
revoke all on table public.notes from public, anon, authenticated;
grant select, insert, update on table public.notes to service_role;
revoke all on function public.set_note_update_metadata() from public, anon, authenticated;
