/**
 * Task Provider Registry
 *
 * Central registry for task management adapters.
 * Currently supports: notion
 * Future: jira, linear, github, etc.
 */

import { createNotionProvider } from './notion.js';
import { loadNotionConfig } from './notion-config.js';

/**
 * Get a task provider by name with given config.
 * @param {'notion'} name - Provider name
 * @param {Object} config - Provider-specific config
 * @returns {import('./types.js').TaskProvider|null}
 */
export function getTaskProvider(name, config) {
  switch (name) {
    case 'notion':
      if (!config?.token) return null;
      return createNotionProvider(config.token);
    default:
      return null;
  }
}

/**
 * Resolve the currently active task provider from saved config.
 * Returns null if no provider is enabled or configured.
 * @returns {{ provider: import('./types.js').TaskProvider, config: Object } | null}
 */
export function resolveActiveProvider() {
  // Currently only Notion is supported
  const notionConfig = loadNotionConfig();

  if (notionConfig.enabled && notionConfig.token) {
    const provider = createNotionProvider(notionConfig.token);
    return { provider, config: notionConfig };
  }

  return null;
}
