# Tofu Character — Animated Pixel Art in Footer Nav Bar

## Overview

An animated pixelated tofu cube character lives in the left side of `.content-nav` (the static footer nav bar). It reflects Claude's working state: idle breathing when nothing is running, bouncing/walking when Claude is actively executing.

## Character Design

- **Style**: CSS pixel art using the `box-shadow` technique (1×1px seed div, shadows define pixels)
- **Size**: ~20px total height, 2px scale grid
- **Parts**: body (off-white square with dark pixel eyes + mouth), two stub feet below
- **No images, no canvas** — pure CSS

## States

| State | Trigger | Animation |
|-------|---------|-----------|
| Idle | `isRunning === false` | Slow breathing (`scaleY` 2.5s ease-in-out) + occasional blink |
| Running | `isRunning === true` | Body bounces `translateY(-3px)` at 0.35s; feet alternate half-phase |

Future states (out of scope):
- `permissionMode === 'plan'` → thinking pose
- `!connected` → sleeping / zzz

## Placement

Leftmost element inside `.content-nav`, before the pager — future cells slot in between:

```
.content-nav
  .tofu-character          ← left
  [ future cells ]         ← center
  .content-nav-pager       ← right (margin-left: auto)
```

## Implementation Plan

### File to modify
- `src/views/ChatView.vue` only

### Template

Add inside `.content-nav`, before `.content-nav-pager`:

```html
<div class="tofu-character" :class="{ running: isRunning }">
  <div class="tofu-body"></div>
  <div class="tofu-feet">
    <div class="tofu-foot left"></div>
    <div class="tofu-foot right"></div>
  </div>
</div>
```

### CSS Structure

```css
.tofu-character {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
}

/* Body drawn via box-shadow pixel grid from 1×1px div */
.tofu-body {
  width: 1px;
  height: 1px;
  box-shadow: /* pixel grid */;
  animation: tofu-idle-breathe 2.5s ease-in-out infinite;
}

.tofu-character.running .tofu-body {
  animation: tofu-run-bounce 0.35s ease-in-out infinite;
}

.tofu-feet { display: flex; gap: 4px; }

.tofu-foot {
  width: 3px; height: 2px;
  background: /* body color */;
  border-radius: 0 0 1px 1px;
}

.tofu-character.running .tofu-foot.left {
  animation: tofu-foot-step 0.35s ease-in-out infinite;
}
.tofu-character.running .tofu-foot.right {
  animation: tofu-foot-step 0.35s ease-in-out infinite;
  animation-delay: 0.175s;
}
```

### Keyframes

```css
@keyframes tofu-idle-breathe {
  0%, 100% { transform: scaleY(1); }
  50%       { transform: scaleY(1.06); }
}
@keyframes tofu-run-bounce {
  0%, 100% { transform: translateY(0); }
  50%       { transform: translateY(-3px); }
}
@keyframes tofu-foot-step {
  0%, 100% { transform: translateY(0); }
  50%       { transform: translateY(2px); }
}
```

### Pixel art colors
- Body: `rgba(245, 245, 245, 0.85)` — near-white, slightly warm
- Eyes: `var(--bg-primary)` — dark pixels
- Feet: same as body

## Verification

1. Open a chat session — tofu cube appears left of `.content-nav`
2. Idle: gentle breathing visible
3. Send a message → `isRunning = true` → cube bounces, feet alternate
4. Task completes → back to idle
5. Works in terminal mode too
6. `npm run check` + `npm run build` pass
