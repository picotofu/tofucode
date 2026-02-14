# tofucode Icons

## Source Files

Located in `source/` directory:
- `icon-evening-1024.png` - Dark theme icon (currently active)
- `icon-morning-1024.png` - Light theme icon (for future light mode)

## Generated Files

PWA icons generated from the active theme:
- `icon-192.png` - 192x192 standard icon
- `icon-512.png` - 512x512 standard icon
- `icon-192-maskable.png` - 192x192 maskable icon (with safe zone padding)
- `icon-512-maskable.png` - 512x512 maskable icon (with safe zone padding)

## Regenerating Icons

When switching themes or updating icons:

```bash
cd public/icons

# For evening/dark theme (current):
convert source/icon-evening-1024.png -resize 192x192 icon-192.png
convert source/icon-evening-1024.png -resize 512x512 icon-512.png
convert source/icon-evening-1024.png -resize 192x192 icon-192-maskable.png
convert source/icon-evening-1024.png -resize 512x512 icon-512-maskable.png

# For morning/light theme (future):
convert source/icon-morning-1024.png -resize 192x192 icon-192.png
convert source/icon-morning-1024.png -resize 512x512 icon-512.png
convert source/icon-morning-1024.png -resize 192x192 icon-192-maskable.png
convert source/icon-morning-1024.png -resize 512x512 icon-512-maskable.png
```

Then rebuild the frontend: `npm run build`

## Theme Integration (Future)

When implementing light/dark mode:
1. Add theme detection in settings (system preference or manual toggle)
2. Dynamically update manifest theme color
3. Swap icon source in PWA manifest based on theme
4. Consider using media queries in manifest for automatic theme switching
