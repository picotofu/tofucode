/**
 * WebSocket Event Handlers
 *
 * Each event is handled by its own module for better organization.
 * Event files are self-documenting with JSDoc comments.
 */

import { handler as browseFolder } from './browse-folder.js';
import { handler as cancelTask } from './cancel-task.js';
import { handler as deleteSession } from './delete-session.js';
import {
  handleFilesBrowse,
  handleFilesCreate,
  handleFilesDelete,
  handleFilesMove,
  handleFilesRead,
  handleFilesRename,
  handleFilesWrite,
} from './files.js';
import { handler as getProjectStatus } from './get-project-status.js';
import { handler as getProjects } from './get-projects.js';
import { handler as getRecentSessions } from './get-recent-sessions.js';
import { handler as getSessionTitle } from './get-session-title.js';
import { handler as getSessions } from './get-sessions.js';
import { handler as newSession } from './new-session.js';
import { handler as prompt } from './prompt.js';
import { handleRestart } from './restart.js';
import { handler as selectProject } from './select-project.js';
import { handler as selectSession } from './select-session.js';
import { handler as setSessionTitle } from './set-session-title.js';
import {
  clearHandler as terminalClear,
  execHandler as terminalExec,
  killHandler as terminalKill,
  listHandler as terminalList,
} from './terminal.js';

export const handlers = {
  get_projects: getProjects,
  select_project: selectProject,
  browse_folder: browseFolder,
  get_sessions: getSessions,
  get_recent_sessions: getRecentSessions,
  select_session: selectSession,
  new_session: newSession,
  delete_session: deleteSession,
  prompt: prompt,
  get_project_status: getProjectStatus,
  get_session_title: getSessionTitle,
  set_session_title: setSessionTitle,
  cancel_task: cancelTask,
  'terminal:exec': terminalExec,
  'terminal:kill': terminalKill,
  'terminal:list': terminalList,
  'terminal:clear': terminalClear,
  'files:browse': handleFilesBrowse,
  'files:read': handleFilesRead,
  'files:write': handleFilesWrite,
  'files:create': handleFilesCreate,
  'files:rename': handleFilesRename,
  'files:delete': handleFilesDelete,
  'files:move': handleFilesMove,
  restart: handleRestart,
};
