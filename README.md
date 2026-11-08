# Critical HIT

**Critical HIT** is a collaborative Dungeons & Dragons DM and player tool. It is built with Next.js, Firebase Authentication, and Cloud Firestore, and is designed around shared campaigns that update live for everyone at the table.

## What It Includes

### Campaigns

- Sign in with Google.
- Create, rename, reorder, and delete campaigns.
- Invite players by their registered Google email address.
- Invitees can accept or decline invitations, and can leave campaigns later.
- Campaign cards open with one click and use drag-and-drop reordering.

### Initiative Tracker

- Shared combat order with draggable rows, sorting, rounds, Next, Back, and Reset Round controls.
- Combatants include initiative, name, conditions, current HP, temporary HP, max HP, AC, exhaustion, faction marker, and removal controls.
- Damage and healing controls apply HP changes safely: damage removes temporary HP first, healing cannot exceed max HP.
- Concentration prompts calculate the correct saving throw DC when a concentrating character takes damage.
- Conditions support custom names, multiple conditions, optional round limits, and automatic expiration on the affected creature's turn.
- Faction markers cycle between enemy, neutral, and ally, coloring names red, white, or green.
- Downed combatants remain visibly red even when they are the active turn.
- The campaign creator can choose to hide HP and/or AC from other players. Owners can always see their own character's values.

### Reusable Characters And Stat Blocks

- Invitees can save their own reusable characters with a name, HP, and AC, then add them directly to initiative.
- Creators can manage reusable stat blocks with name, HP, AC, faction, and rich text details.
- Stat blocks can be dragged to reorder, searched, edited, previewed, deleted with confirmation, and added directly to initiative.
- Matching a stat block name in initiative can fill the name, HP, max HP, and AC for the creator.
- Stat block text supports headings (`#` through `######`), dividers (`---`), bold (`**text**`), italic (`*text*` or `_text_`), and highlights (`==text==`). Repeated spaces are preserved for table-like stat layouts.

### Fantasy Calendar

- Creators can create, edit, reorder, and delete custom campaign calendars.
- A calendar supports custom month and weekday names, custom season assignments, era name, current year, and flexible calendar lengths.
- Everyone in the campaign can view the calendar, set the shared current day, use Long Rest to advance one day, and manage events.
- Events support notes, colors, yearly recurrence, editing, and deletion confirmation.

### Additional Tools

- A creator-only `Nexus Notes` tab opens [Nexus Notes](https://nexusmd.vercel.app/dashboard) in a new browser tab.
- The interface uses a black, red, and gold fantasy theme with a custom d20 favicon.

## Roles And Permissions

| Capability | Campaign Creator | Invited Player |
| --- | --- | --- |
| Create, rename, reorder, or delete campaigns | Yes | No |
| Invite or remove players | Yes | No |
| Add, edit, reorder, or delete all combatants | Yes | Own rows, with shared condition and turn controls |
| Use Next, Back, and Sort | Yes | Yes |
| Manage campaign stat blocks | Yes | No |
| Save reusable player characters | No | Yes, own characters only |
| Create and edit calendar settings | Yes | No |
| Add, edit, or delete calendar events | Yes | Yes |

## Local Setup

### Requirements

- Node.js 20 or newer
- A Firebase project with Google Authentication and Cloud Firestore enabled

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Firebase

Copy the example environment file:

```bash
Copy-Item .env.local.example .env.local
```

Then fill in `.env.local` using the Firebase web app configuration from **Firebase Console > Project settings > Your apps**:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
```

Never commit `.env.local`. It is already excluded by `.gitignore`.

### 3. Configure Firebase Authentication

1. In Firebase Console, open **Authentication**.
2. Open **Sign-in method**.
3. Enable **Google**.
4. Add your local and production domains to **Authorized domains** when Firebase asks for them.

### 4. Deploy Firestore rules

Copy the contents of [firestore.rules](./firestore.rules) into **Firestore Database > Rules** in Firebase Console, then publish them.

These rules protect campaign access, invitations, combatants, stat blocks, saved characters, calendars, and events.

### 5. Start the local app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On Windows machines where PowerShell blocks `npm.ps1`, use:

```bash
npm.cmd run dev
```

## Available Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Clears the old Next.js build output and starts the local development server. |
| `npm run typecheck` | Checks TypeScript without creating a production build. |
| `npm run build` | Verifies and creates a production build. Stop the local server first, or use `ALLOW_BUILD_WITH_SERVER=1` when appropriate. |
| `npm run start` | Runs the already-built production app. |
| `npm run clean` | Removes the local `.next` build folder. |

## Deploying To Vercel

1. Push this project to a Git provider connected to Vercel.
2. Create a new Vercel project and select the repository.
3. Leave the framework preset as **Next.js**.
4. Add every variable from `.env.local.example` under **Vercel > Project Settings > Environment Variables**.
5. Deploy.
6. In Firebase Authentication, add the Vercel production domain to **Authorized domains**.
7. Publish the Firestore rules if they are not already deployed.

Vercel hosts the Next.js app. Firebase continues to provide Google sign-in and the shared Firestore database.

## Project Structure

```text
app/
  page.tsx              Main campaign, initiative, stat block, and calendar UI
  styles.css            Global fantasy theme and responsive styling
  layout.tsx            App metadata and root layout
  icon.svg              Critical HIT favicon
lib/
  firebase.ts           Firebase client configuration
  types.ts              Shared campaign, combat, stat block, and calendar types
scripts/
  clean-next.mjs        Removes stale Next.js output before local work
  guard-next-build.mjs  Prevents accidental builds against a running local server
firestore.rules         Firestore access rules to publish in Firebase Console
.env.local.example      Firebase environment variable template
```

## Technology

- Next.js 15 with the App Router
- React 19 and TypeScript
- Firebase Authentication with Google sign-in
- Cloud Firestore for real-time shared campaign data
- dnd-kit for drag-and-drop interactions
- Lucide for interface icons
