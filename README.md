# Critical-H.I.T

A Firebase-backed Dungeons and Dragons combat room app, starting with an initiative tracker.

## Run locally

1. Copy `.env.local.example` to `.env.local`.
2. Fill in the Firebase web app values.
3. Enable Google Authentication in Firebase.
4. Enable Firestore and deploy `firestore.rules`.
5. Install and run:

```bash
npm install
npm run dev
```

The first tab is the room-based initiative tracker. Creators can invite users by Google account email, control initiative order, rounds, visibility, and all combatants. Invitees can create player combatants and edit HP, AC, and conditions on their own rows.
