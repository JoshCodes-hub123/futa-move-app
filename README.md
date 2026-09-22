# FUTA Campus Rides

Build the initial product foundation for FUTAMOVE, a premium student-focused campus mobility application for FUTA.

IMPORTANT:

This is Phase 0/1 of development. Do NOT attempt to build the entire transportation workflow yet. Do NOT invent additional features. Establish a clean, scalable foundation and a polished mobile-first UI that we will extend in later phases.

PRODUCT POSITIONING:

FUTAMOVE helps verified FUTA students find and share keke rides with other students travelling to compatible destinations at compatible times.

The core product principle is:

"Where are you going?"

The product should feel:

fast, trustworthy, premium, simple, youthful, safe and distinctly FUTA.

BRAND:

Use the uploaded FUTAMOVE logo as the official brand reference. Do not redesign or replace the logo.

Primary colors:

- FUTA Gold: #F5C400

- Deep Black: #0A0A0A

- White: #FFFFFF

Supporting colors:

- Soft background: #F7F7F5

- Dark surface: #141414

- Muted text: #6B6B6B

- Border: #E8E8E8

Use gold as an accent rather than making every screen gold.

DESIGN DIRECTION:

Create a premium mobile-app experience, NOT a website dashboard.

The interface should be:

- mobile-first

- fully responsive

- clean

- spacious

- modern

- highly readable

- touch-friendly

- visually consistent

- professional enough for a real startup

Use:

- rounded cards

- subtle borders

- restrained shadows

- modern line icons

- bottom navigation

- bottom sheets where appropriate

- clear status indicators

- smooth but subtle transitions

- skeleton loading states

- polished empty states

- clear error states

Avoid:

- excessive gradients

- excessive glassmorphism

- neon colors

- excessive animations

- giant decorative illustrations

- crowded dashboards

- unnecessary statistics

- generic AI-generated UI

- excessive emojis

TYPOGRAPHY:

Use Inter or a similarly clean modern sans-serif.

Create a consistent typography scale for:

- large headings

- screen headings

- section headings

- body text

- metadata

APP STRUCTURE:

Student navigation:

Home

Rides

Activity

Profile

Rider navigation:

Home

Requests

Trips

Wallet

Profile

ADMIN:

Prepare the architecture for a future desktop-first admin dashboard, but do not build the full admin system yet.

INITIAL ROUTES:

Public:

/

/login

/signup

/account-type

/verification

Student:

student/home

student/rides

student/activity

student/profile

Rider:

rider/home

rider/requests

rider/trips

rider/wallet

rider/profile

For now, these screens can contain carefully designed placeholder states where functionality has not yet been implemented.

HOME SCREEN DIRECTION:

The student home screen should focus on one primary question:

"Where are you going?"

Create a clean ride-request entry area with:

- current location

- destination

- departure time

- primary "Find my ride" action

Below this, prepare a section for:

- current ride

- upcoming ride

- recent activity

Do NOT create a dashboard full of statistics.

ARCHITECTURE:

Use React + TypeScript.

Structure the project cleanly so UI components, pages, services, hooks and data access are separated.

Prepare Supabase integration architecture, but do not implement complex ride matching, payments, live tracking or wallet logic yet.

Create reusable components for:

- buttons

- inputs

- cards

- avatars

- status badges

- bottom navigation

- headers

- bottom sheets

- loading states

- empty states

- confirmation dialogs

RESPONSIVENESS:

Mobile is the primary experience.

The application must also adapt properly to:

- small phones

- large phones

- tablets

- desktop

On desktop, do not simply stretch the mobile UI across the entire screen. Use appropriate max-width containers and responsive layouts.

IMPORTANT PRODUCT RULE:

Do not make assumptions about future features.

Do not add:

- referrals

- rewards

- leaderboards

- AI assistants

- advertisements

- social feeds

- unnecessary analytics

- extra fintech features

Those may be considered later.

The goal of this phase is to establish an exceptionally clean visual foundation and scalable application structure.

Before finishing, ensure the entire existing UI is visually consistent and feels like one coherent product rather than a collection of generated pages.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://futa-move-app.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e02a6415-7c92-4451-9244-8334fb153ffe).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
