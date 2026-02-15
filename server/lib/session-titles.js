/**
 * Session titles management
 * Stores custom session titles in .session-titles.json files per project
 *
 * Note: We can't use sessions-index.json's customTitle field because the SDK
 * overwrites session entries after each turn without preserving custom fields.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { isValidSessionId } from './sessions.js';

const TITLES_FILE = '.session-titles.json';

/**
 * Get the path to the session titles file for a project
 * @param {string} projectSlug - Project slug (e.g., -home-ts-projects-myapp)
 * @returns {string} Path to the titles file
 */
function getTitlesFilePath(projectSlug) {
  return path.join(config.projectsDir, projectSlug, TITLES_FILE);
}

/**
 * Load all session titles for a project
 * @param {string} projectSlug - Project slug
 * @returns {Object} Map of sessionId -> title
 */
export function loadTitles(projectSlug) {
  try {
    const filePath = getTitlesFilePath(projectSlug);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(
      `Error loading session titles for ${projectSlug}:`,
      error.message,
    );
  }
  return {};
}

/**
 * Get a single session title
 * @param {string} projectSlug - Project slug
 * @param {string} sessionId - Session ID
 * @returns {string|null} Session title or null if not set
 */
export function getTitle(projectSlug, sessionId) {
  const titles = loadTitles(projectSlug);
  return titles[sessionId] || null;
}

/**
 * Set a session title
 * @param {string} projectSlug - Project slug
 * @param {string} sessionId - Session ID
 * @param {string} title - New title (empty string to remove)
 * @returns {boolean} Success
 */
export function setTitle(projectSlug, sessionId, title) {
  // SECURITY: Validate sessionId format to prevent path traversal
  if (!isValidSessionId(sessionId)) {
    console.error(`Invalid sessionId format for setTitle: ${sessionId}`);
    return false;
  }

  try {
    const filePath = getTitlesFilePath(projectSlug);
    const titles = loadTitles(projectSlug);

    if (title?.trim()) {
      titles[sessionId] = title.trim();
    } else {
      delete titles[sessionId];
    }

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(titles, null, 2));
    return true;
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
