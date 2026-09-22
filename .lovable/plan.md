# FUTAMOVE Phase 0/1 Foundation

## Goal
Build a cohesive, premium, mobile-first FUTAMOVE application foundation using the supplied logo and exact black, white, gold, soft-background, muted-text, and border palette.

## What will be built
- A shared app shell with responsive phone-sized content on desktop, role-specific bottom navigation, polished headers, and consistent spacing.
- Public screens for welcome, login, signup, account type, and student verification.
- Student screens for Home, Rides, Activity, and Profile.
- Rider screens for Home, Requests, Trips, Wallet, and Profile.
- The student Home screen centered on “Where are you going?” with current location, destination, departure time, and “Find my ride,” followed by restrained current, upcoming, and recent ride states.
- Carefully written placeholder, loading, empty, and error states for workflows reserved for later phases.

## Reusable foundation
- Shared buttons, form fields, cards, avatars, status badges, bottom navigation, headers, bottom sheets, loading skeletons, empty states, and confirmation dialogs.
- Separate folders for reusable interface pieces, page-level views, services, hooks, and future data access.
- A small typed mock-data layer so later backend reads can replace placeholders without restructuring the interface.

## Brand and visual system
- Preserve the uploaded FUTAMOVE logo as the official logo and derive the favicon from it.
- Use Inter, generous touch targets, rounded cards, subtle borders and shadows, modern line icons, and restrained transitions.
- Use FUTA Gold only for emphasis and key actions; keep most surfaces white, soft gray, and deep black.
- Keep desktop layouts constrained and balanced rather than stretching the mobile interface.

## Technical scope
- Keep TanStack Start with React and TypeScript.
- Add every requested route with unique page metadata and type-safe navigation.
- Prepare the Lovable Cloud client boundary for future authentication and persisted data, without implementing ride matching, payments, live tracking, wallet transactions, or admin workflows.
- Validate the finished experience at phone and desktop sizes, including navigation and form interactions.

## Out of scope
No referrals, rewards, leaderboards, AI assistants, advertisements, social feeds, analytics dashboards, or additional fintech features.
