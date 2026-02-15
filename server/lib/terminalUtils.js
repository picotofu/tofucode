/**
 * Terminal-related utility functions
 */

import processManager from './processManager.js';

/**
 * Calculate terminal process counts per project
 * @returns {Object} Map of projectSlug -> running process count
 */
export function getTerminalCounts() {
  const terminalCounts = {};
  for (const [projectSlug, processMap] of processManager.projects) {
    const runningCount = Array.from(processMap.values()).filter(
      (p) => p.status === 'running',
    ).length;
    if (runningCount > 0) {
      terminalCounts[projectSlug] = runningCount;
    }
  }
  return terminalCounts;
}
