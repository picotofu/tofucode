import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const DEBUG = process.env.DEBUG === 'true';
const LOG_FILE = join(process.cwd(), 'cc-web.log');

/**
 * Format timestamp for log entries
 */
function timestamp() {
  return new Date().toISOString();
}

/**
 * Write to debug log file with timestamp
 */
function writeToFile(level, ...args) {
  if (!DEBUG) return;

  try {
    const message = args
      .map((arg) =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg),
      )
      .join(' ');
    const logLine = `[${timestamp()}] [${level}] ${message}\n`;
    appendFileSync(LOG_FILE, logLine, 'utf8');
  } catch (error) {
    // Fail silently to avoid breaking the app if logging fails
    console.error('Failed to write to log file:', error);
  }
}

/**
 * Logger wrapper with optional file output
 */
export const logger = {
  log(...args) {
    console.log(...args);
    writeToFile('LOG', ...args);
  },

  info(...args) {
    console.info(...args);
    writeToFile('INFO', ...args);
  },

  warn(...args) {
    console.warn(...args);
    writeToFile('WARN', ...args);
  },

  error(...args) {
    console.error(...args);
    writeToFile('ERROR', ...args);
  },

  debug(...args) {
    if (DEBUG) {
      console.debug(...args);
      writeToFile('DEBUG', ...args);
    }
  },
};
