-- Cursor selections are temporary Realtime Presence data, never stored with notes.
drop policy if exists "Note links can receive collaboration cursor presence" on realtime.messages;
create policy "Note links can receive collaboration cursor presence"
on realtime.messages
for select
to anon, authenticated
using (
  extension = 'presence'
  and (select public.can_receive_note_broadcast())
  and (select realtime.topic()) like 'note:%'
);

drop policy if exists "Note links can publish collaboration cursor presence" on realtime.messages;
create policy "Note links can publish collaboration cursor presence"
on realtime.messages
for insert
to anon, authenticated
with check (
  extension = 'presence'
  and (select public.can_receive_note_broadcast())
  and (select realtime.topic()) like 'note:%'
);
