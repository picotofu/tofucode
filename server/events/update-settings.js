import { saveSettings } from '../lib/settings.js';
import { send } from '../lib/ws.js';

export async function handler(ws, message) {
  const { settings } = message;
  const result = saveSettings(settings);

  send(ws, {
    type: 'settings_updated',
    success: result.success,
    error: result.error,
    settings,
  });
}
