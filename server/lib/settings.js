import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SETTINGS_DIR = join(homedir(), '.cc-web');
const SETTINGS_FILE = join(SETTINGS_DIR, 'settings.json');

// Default settings
const DEFAULT_SETTINGS = {
  debugMode: false,
};

export function loadSettings() {
  try {
    if (!existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS };
    }
    const data = readFileSync(SETTINGS_FILE, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
  } catch (err) {
    console.error('Failed to load settings:', err);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    // Ensure directory exists
    if (!existsSync(SETTINGS_DIR)) {
      mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    console.error('Failed to save settings:', err);
    return { success: false, error: err.message };
  }
}
