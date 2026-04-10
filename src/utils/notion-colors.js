/**
 * Notion color name → CSS style mapping for multi_select label pills.
 * Notion's 10 colors: default, gray, brown, orange, yellow, green, blue, purple, pink, red
 */
const NOTION_COLOR_MAP = {
  default: {
    background: 'var(--bg-tertiary)',
    color: 'var(--text-secondary)',
    border: 'var(--border-color)',
  },
  gray: { background: '#e3e3e3', color: '#4a4a4a', border: '#c8c8c8' },
  brown: { background: '#ede0d9', color: '#6b3c2e', border: '#d4b8ae' },
  orange: { background: '#fdebd0', color: '#8a4a00', border: '#f7c884' },
  yellow: { background: '#fef9c3', color: '#7a6100', border: '#f4d03f' },
  green: { background: '#d5f5e3', color: '#1a6b40', border: '#82e0aa' },
  blue: { background: '#d6eaf8', color: '#1a5276', border: '#7fb3d3' },
  purple: { background: '#e8daef', color: '#5b2c6f', border: '#c39bd3' },
  pink: { background: '#fde8f0', color: '#922b52', border: '#f1a7c3' },
  red: { background: '#fdecea', color: '#922b21', border: '#f1948a' },
};

/**
 * Returns a CSS style object for a Notion color name.
 * @param {string} [color] - Notion color name
 * @returns {{ background: string, color: string, border: string }}
 */
export function notionColorStyle(color) {
  return NOTION_COLOR_MAP[color] ?? NOTION_COLOR_MAP.default;
}
