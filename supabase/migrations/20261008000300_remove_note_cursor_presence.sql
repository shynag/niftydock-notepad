-- The app no longer publishes cursor state through Realtime Presence.
drop policy if exists "Note links can receive collaboration cursor presence"
on realtime.messages;

drop policy if exists "Note links can publish collaboration cursor presence"
on realtime.messages;
