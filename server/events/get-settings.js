import { loadSettings } from '../lib/settings.js';
import { send } from '../lib/ws.js';

export async function handler(ws) {
  const settings = loadSettings();
  send(ws, {
    type: 'settings',
    settings,
  });
}
