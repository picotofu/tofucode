/**
 * Session titles management
 * Uses Claude Code's native sessions-index.json customTitle field
 * This keeps cc-web in sync with Claude CLI's session names
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Get the path to sessions-index.json for a project
 * @param {string} projectSlug - Project slug (e.g., -home-ts-projects-myapp)
 * @returns {string} Path to sessions-index.json
 */
function getIndexPath(projectSlug) {
  return path.join(config.projectsDir, projectSlug, 'sessions-index.json');
}

/**
 * Load sessions-index.json data
 * @param {string} projectSlug - Project slug
 * @returns {Object} Index data with entries array
 */
function loadIndex(projectSlug) {
  try {
    const indexPath = getIndexPath(projectSlug);
    if (fs.existsSync(indexPath)) {
      return JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    }
  } catch (error) {
    console.error(
      `Error loading sessions-index.json for ${projectSlug}:`,
      error.message,
    );
  }
  return { entries: [] };
}

/**
 * Save sessions-index.json data
 * @param {string} projectSlug - Project slug
 * @param {Object} data - Index data to save
 * @returns {boolean} Success
 */
function saveIndex(projectSlug, data) {
  try {
    const indexPath = getIndexPath(projectSlug);
    fs.writeFileSync(indexPath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(
      `Error saving sessions-index.json for ${projectSlug}:`,
      error.message,
    );
    return false;
  }
}

/**
 * Load all session titles for a project (from customTitle field)
 * @param {string} projectSlug - Project slug
 * @returns {Object} Map of sessionId -> title
 */
export function loadTitles(projectSlug) {
  const index = loadIndex(projectSlug);
  const titles = {};

  for (const entry of index.entries || []) {
    if (entry.customTitle) {
      titles[entry.sessionId] = entry.customTitle;
    }
  }

  return titles;
}

/**
 * Get a single session title
 * @param {string} projectSlug - Project slug
 * @param {string} sessionId - Session ID
 * @returns {string|null} Session title or null if not set
 */
export function getTitle(projectSlug, sessionId) {
  const index = loadIndex(projectSlug);
  const entry = (index.entries || []).find((e) => e.sessionId === sessionId);
  return entry?.customTitle || null;
}

/**
 * Set a session title (updates customTitle in sessions-index.json)
 * @param {string} projectSlug - Project slug
 * @param {string} sessionId - Session ID
 * @param {string} title - New title (empty string to remove)
 * @returns {boolean} Success
 */
export function setTitle(projectSlug, sessionId, title) {
  try {
    const index = loadIndex(projectSlug);
    const entries = index.entries || [];
    const entryIndex = entries.findIndex((e) => e.sessionId === sessionId);

    if (entryIndex >= 0) {
      // Update existing entry
      if (title?.trim()) {
        entries[entryIndex].customTitle = title.trim();
      } else {
        // Remove customTitle if empty
        delete entries[entryIndex].customTitle;
      }
    } else if (title?.trim()) {
      // Session not in index - this shouldn't happen normally
      // but we can add a minimal entry for it
      console.warn(
        `Session ${sessionId} not found in index, adding minimal entry`,
      );
      entries.push({
        sessionId,
        customTitle: title.trim(),
      });
    }

    index.entries = entries;
    return saveIndex(projectSlug, index);
  } catch (error) {
    console.error(
      `Error saving session title for ${projectSlug}/${sessionId}:`,
      error.message,
    );
    return false;
  }
}

/**
 * Delete a session title
 * @param {string} projectSlug - Project slug
 * @param {string} sessionId - Session ID
 * @returns {boolean} Success
 */
export function deleteTitle(projectSlug, sessionId) {
  return setTitle(projectSlug, sessionId, '');
}

/**
 * Get all titles for a project (for enriching session lists)
 * @param {string} projectSlug - Project slug
 * @returns {Object} Map of sessionId -> title
 */
export function getAllTitles(projectSlug) {
  return loadTitles(projectSlug);
}
