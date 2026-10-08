# NiftyDock Notepad

A lightweight, shareable notepad. Write in a rich text editor, and share a note by sending its URL to another device.

## Features

- Create a new note with a random URL slug.
- Edit Markdown content in a rich text editor.
- Save notes to Supabase with automatic saving.
- Sync updates between open devices with Supabase Realtime.
- Keep a local browser copy as a fallback when browser storage is available.
- Share a note by copying its URL.

Anyone with a note URL can read and edit that note. NiftyDock Notepad currently has no sign-in or password protection, so do not use it for sensitive information.

## Tech stack

- Next.js 15 with the App Router
- React 19 and TypeScript
- Tailwind CSS with shadcn-style UI components
- Tiptap for rich text and Markdown editing
- Yjs for merging simultaneous edits without overwriting a whole note
- Supabase Postgres for notes and durable collaboration updates, Supabase Realtime Broadcast for live sync
- IndexedDB for local recovery when a device is offline

## Requirements

- Node.js and pnpm
- A Supabase project

## Setup

1. Install the dependencies:

   ```bash
   pnpm install
   ```

2. Create a local environment file from the example:

   ```bash
   cp .env.example .env.local
   ```

3. In your Supabase project, open **SQL Editor** and run the files in `supabase/migrations` in timestamp order. The migrations add Yjs collaboration storage, Realtime edit broadcasts, and temporary cursor presence for open devices.

4. In Supabase project settings, copy the project URL, publishable key, and secret key into `.env.local`:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   SUPABASE_SECRET_KEY=your-secret-key
   ```

   The secret key is used only by server-side API routes. Keep it private and never expose it in client code or commit `.env.local`.

5. Start the development server:

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Available scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the local development server |
| `pnpm build` | Build the app for production |
| `pnpm start` | Start the production server after building |
| `pnpm lint` | Run the configured Next.js lint command |

## How it works

- Opening `/` creates a local draft and redirects to its random slug URL, such as `/9yj63z`. Empty drafts are kept in browser storage and do not create database rows.
- Opening a slug URL loads a saved note from the server. If the slug has no saved note, it opens as a local draft.
- The first title or content edit creates the note in Supabase. Later content edits are saved as Yjs updates, merged across devices, and periodically compacted into a snapshot.
- Sharing an unsaved draft saves it first, then copies its URL.
- The server uses the Supabase secret key to access Postgres. The browser uses the publishable key to broadcast and receive Yjs updates; if Realtime disconnects, open editors poll for updates until it reconnects.
- Draft Yjs updates are also stored in IndexedDB. When a device reconnects, it uploads edits that are missing from Supabase and merges the server state into its local document.

## Project structure

```text
src/
  app/
    [slug]/page.tsx       Note URL route
    api/notes/             Note creation and read/update API routes
    page.tsx               Root route
  components/              Notepad editor and UI components
  utils/supabase/           Supabase browser and server clients
supabase/
  migrations/               Database schema and Realtime policies
```
