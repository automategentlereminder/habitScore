# HabitScore

HabitScore is a habit-tracking app that turns discipline into a game. It helps users build good habits, break bad ones, protect streaks, beat personal records, and stay consistent with reminders, scores, and progress stats.

## Features

- Create habits to build or habits to break
- Track streaks, clean runs, scores, XP, and achievements
- Set local reminder notifications
- Review progress history and performance stats
- Share progress snapshots
- No ads and no subscriptions

## Tech Stack

- Expo
- React Native
- TypeScript
- Expo SQLite
- Expo Notifications

## Getting Started

Install dependencies:

```powershell
npm install
```

Start the development server:

```powershell
npm start
```

Run on Android:

```powershell
npm run android
```

Run on web:

```powershell
npm run web
```

## Android Release Build

This project supports local Android bundle generation for Google Play.

Build the signed release bundle:

```powershell
npm run android:bundle
```

Generated bundle output:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

## Signing Notes

- Release signing is configured locally through `android/keystore.properties`
- The keystore file and signing secrets are intentionally ignored by git
- Keep your local keystore and passwords backed up securely

## Play Store

Recommended first-release metadata:

- App name: `HabitScore`
- Default language: `English (India) - en-IN`
- Type: `App`
- Pricing: `Free`

## Privacy

HabitScore is designed as a local-first app. Habit data is stored on-device, and notifications are used for local reminders.
