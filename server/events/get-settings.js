import { config } from '../config.js';
import { loadSettings } from '../lib/settings.js';
import { send } from '../lib/ws.js';

export async function handler(ws) {
  const settings = loadSettings();
  send(ws, {
    type: 'settings',
    settings,
    // Server capability flags — not user-editable, inform the frontend what's available
    discordEnabled: process.env.DISCORD_ENABLED === 'true',
    maxFileSizeMb: config.maxFileSizeMb,
  });
}
