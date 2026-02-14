# Progressive Web App (PWA)

**Status:** ✅ Completed
**Date:** 2025-02-13

## Overview

tofucode is now a Progressive Web App (PWA), allowing users to install it as a standalone application on desktop and mobile devices. This provides an app-like experience with quick launch, standalone window, and offline UI capabilities.

## Implementation

### Core Components

1. **vite-plugin-pwa** - Build-time PWA generation
2. **Service Worker** - Asset caching and offline support
3. **Web Manifest** - App metadata and installation config
4. **App Icons** - Terminal window design with Claude orange accent
5. **PWA Prompt Component** - Install and update notifications

### Icon Design

**Concept:** Symbolic terminal window with Claude's orange accent color

**Design Elements:**
- Dark terminal window with realistic header
- macOS-style traffic light buttons (red, yellow, green)
- Terminal prompt with cursor in Claude orange (#F96F3D)
- Code line placeholders
- Orange accent border at bottom

**Sizes Generated:**
- 192x192 (standard + maskable)
- 512x512 (standard + maskable)
- SVG source file

### Configuration

**vite.config.js:**
```javascript
VitePWA({
  registerType: 'prompt',
  includeAssets: ['favicon.svg', 'icons/*.png'],
  manifest: {
    name: 'tofucode',
    short_name: 'tofucode',
    description: 'Web UI for Claude Code with full system access',
    theme_color: '#1a1a1a',
    background_color: '#1a1a1a',
    display: 'standalone',
    // ... icons config
  },
  workbox: {
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/api/, /^\/ws/, /^\/docs/],
    // Google Fonts caching
  }
})
```

### Service Worker Strategy

**Excluded from Caching:**
- `/api/*` - API endpoints
- `/ws` - WebSocket connections
- `/docs/*` - Documentation

**Cached Resources:**
- Static assets (JS, CSS)
- Google Fonts (CacheFirst strategy)
- App shell (HTML)

**Update Strategy:**
- `registerType: 'prompt'` - User controls when to update
- Update prompt appears when new version available
- User can dismiss or install update

### Components

**PwaPrompt.vue:**
- Install prompt (when app is installable)
- Update prompt (when new version available)
- Dismissible with session storage
- Styled to match app design

### Files Created/Modified

**Created:**
- `public/icons/icon.svg` - Source icon design
- `public/icons/icon-192.png` - Standard 192x192
- `public/icons/icon-512.png` - Standard 512x512
- `public/icons/icon-192-maskable.png` - Maskable 192x192
- `public/icons/icon-512-maskable.png` - Maskable 512x512
- `src/components/PwaPrompt.vue` - Install/update UI

**Modified:**
- `vite.config.js` - Added VitePWA plugin config
- `index.html` - Added PWA meta tags
- `src/App.vue` - Added PwaPrompt component
- `README.md` - Added PWA section and feature list
- `package.json` - Added vite-plugin-pwa dependency

**Generated (build output):**
- `dist/sw.js` - Service worker
- `dist/manifest.webmanifest` - App manifest
- `dist/workbox-*.js` - Workbox runtime
- `dist/icons/*` - All icon files

## User Experience

### Installation Flow

1. User opens tofucode in browser
2. Browser shows install prompt (or PwaPrompt component)
3. User clicks "Install"
4. App installs to desktop/home screen
5. User can launch like any native app

### Standalone Mode

When launched as installed PWA:
- No browser chrome (address bar, tabs, etc.)
- Own window in app switcher
- Dedicated app icon in dock/taskbar
- Full-screen on mobile
- Native-like experience

### Update Flow

1. New version deployed to server
2. Service worker detects update
3. PwaPrompt shows "Update Available"
4. User clicks "Update" or "Later"
5. If update, page reloads with new version
6. Service worker activates new cache

## Technical Details

### Service Worker Lifecycle

1. **Installation** - Service worker registers on first visit
2. **Activation** - Takes control of pages
3. **Fetch** - Intercepts network requests
4. **Update** - Detects new versions
5. **Activation (new)** - New version takes over

### Cache Strategy

**Precache (during build):**
- index.html
- CSS files
- JS files
- Icons
- Favicon

**Runtime Cache:**
- Google Fonts (CacheFirst, 1 year)
- Font files (CacheFirst, 1 year)

**Network-only:**
- API calls
- WebSocket connections
- Documentation

### Browser Support

**Desktop:**
- Chrome 67+
- Edge 79+
- Firefox (limited install support)
- Safari 15.4+ (basic support)

**Mobile:**
- Chrome for Android
- Safari on iOS 11.3+
- Samsung Internet
- UC Browser

## Benefits

### User Benefits

1. **Quick Access** - Launch from desktop/home screen
2. **App-like Feel** - Standalone window without browser UI
3. **Offline UI** - App shell loads instantly
4. **Better Mobile** - Full-screen, no browser chrome
5. **Professional** - Feels like native application

### Developer Benefits

1. **No Native App** - No Electron or native builds needed
2. **Single Codebase** - Same app for web and installed
3. **Easy Updates** - Deploy to web, users get updates
4. **Lower Barrier** - Easier to install than downloading
5. **Better Engagement** - Users more likely to return

## Testing

### Manual Testing Steps

1. **Installation:**
   - Open tofucode in Chrome
   - Check for install prompt
   - Click install
   - Verify app installs
   - Launch from desktop

2. **Standalone Mode:**
   - Verify no browser chrome
   - Check window title
   - Test app icon in taskbar
   - Verify routing works

3. **Updates:**
   - Deploy new version
   - Check update prompt appears
   - Click update
   - Verify page reloads
   - Check new version active

4. **Caching:**
   - Install app
   - Go offline
   - Launch app
   - Verify UI loads (no connection error)
   - Try to use chat (should show connection needed)

5. **Mobile:**
   - Open on mobile device
   - Add to home screen
   - Launch from home screen
   - Verify full-screen
   - Test all features

### Lighthouse PWA Score

Run Lighthouse audit to verify:
- ✅ Installable
- ✅ Works offline (UI only)
- ✅ Themed
- ✅ Viewport meta tag
- ✅ Has icons
- ✅ Service worker registered

## Known Limitations

1. **Offline Functionality:**
   - UI shell works offline
   - Chat/terminal requires active connection
   - No offline message queue

2. **Browser Support:**
   - Firefox desktop has limited install support
   - Safari iOS requires manual "Add to Home Screen"

3. **Update Timing:**
   - Updates require user action (prompt strategy)
   - Old service worker stays until update

## Future Enhancements

Possible improvements:

1. **Offline Queue:**
   - Queue messages when offline
   - Send when connection restored

2. **Background Sync:**
   - Sync sessions in background
   - Update notifications

3. **Share Target:**
   - Share code/files to tofucode
   - Open shared content in new session

4. **Shortcuts:**
   - App shortcuts for common actions
   - Quick access to recent sessions

5. **Badge API:**
   - Show unread message count
   - Task status indicator

## References

- [PWA Docs (MDN)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/)
- [Workbox](https://developers.google.com/web/tools/workbox)
- [Web App Manifest](https://www.w3.org/TR/appmanifest/)
