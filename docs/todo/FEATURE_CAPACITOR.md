# Capacitor — Native Mobile App

## Overview

Wrap the tofucode web UI as a native mobile app using Capacitor, enabling installation on iOS and Android with access to native features.

## Why Capacitor

- Vue 3 + Vite already supported out of the box
- Reuses existing web codebase — no rewrite needed
- Access to native APIs (push notifications, haptics, biometrics, etc.)
- Single codebase for web + iOS + Android
- Lighter than React Native or Flutter for a web-first app

## Requirements

- [ ] Install and configure Capacitor in the existing Vite project
- [ ] iOS and Android project scaffolding
- [ ] WebSocket connection to remote server (not localhost)
- [ ] Handle app lifecycle (background/foreground, reconnection)
- [ ] Safe area insets for notch/island devices
- [ ] Native keyboard handling (avoid viewport resize issues)
- [ ] Splash screen and app icon

## Open Questions

- Server connection: how to configure the remote server URL? Settings screen vs env var at build time?
- Authentication: current web auth flow may need adaptation for native context
- Push notifications: notify when Claude finishes a long-running task?
- Offline behavior: what to show when server is unreachable?
- App Store distribution vs sideload/TestFlight only?

## Notes

- Revisit when the web UI is more stable and core features are complete
