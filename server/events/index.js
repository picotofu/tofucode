/**
 * WebSocket Event Handlers
 *
 * Each event is handled by its own module for better organization.
 * Event files are self-documenting with JSDoc comments.
 */

import { handler as answerQuestion } from './answer-question.js';
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
import { handler as getGitDiff } from './get-git-diff.js';
import { handler as getProjectStatus } from './get-project-status.js';
import { handler as getProjects } from './get-projects.js';
import { handler as getRecentSessions } from './get-recent-sessions.js';
import { handler as getSessionTitle } from './get-session-title.js';
import { handler as getSessions } from './get-sessions.js';
import { handler as getSettings } from './get-settings.js';
import { handler as getTaskStatuses } from './get-task-statuses.js';
import { handler as getUsageStats } from './get-usage-stats.js';
import { handler as gitClone } from './git-clone.js';
import { handler as loadOlderMessages } from './load-older-messages.js';
import {
  addHandler as mcpAdd,
  listHandler as mcpList,
  removeHandler as mcpRemove,
  testHandler as mcpTest,
  updateHandler as mcpUpdate,
} from './mcp.js';
import { handler as newSession } from './new-session.js';
import { handler as prompt } from './prompt.js';
import { handleRestart } from './restart.js';
import { handleFilesSearch } from './search-files.js';
import { handler as selectProject } from './select-project.js';
import { handler as selectSession } from './select-session.js';
import { handler as setSessionTitle } from './set-session-title.js';
import {
  clearHandler as terminalClear,
  execHandler as terminalExec,
  killHandler as terminalKill,
  listHandler as terminalList,
} from './terminal.js';
import {
  addHandler as terminalBookmarkAdd,
  getHandler as terminalBookmarkGet,
  removeHandler as terminalBookmarkRemove,
} from './terminal-bookmarks.js';
import { watchUpdateHandler as terminalWatchUpdate } from './terminal-watch.js';
import { handler as updateSettings } from './update-settings.js';
import { handleUpgrade } from './upgrade.js';

export const handlers = {
  answer_question: answerQuestion,
  get_projects: getProjects,
  select_project: selectProject,
  browse_folder: browseFolder,
  get_sessions: getSessions,
  get_recent_sessions: getRecentSessions,
  select_session: selectSession,
  load_older_messages: loadOlderMessages,
  new_session: newSession,
  delete_session: deleteSession,
  prompt: prompt,
  get_project_status: getProjectStatus,
  get_session_title: getSessionTitle,
  set_session_title: setSessionTitle,
  get_task_statuses: getTaskStatuses,
  cancel_task: cancelTask,
  'terminal:exec': terminalExec,
  'terminal:kill': terminalKill,
  'terminal:list': terminalList,
  'terminal:clear': terminalClear,
  'terminal:get_bookmarks': terminalBookmarkGet,
  'terminal:add_bookmark': terminalBookmarkAdd,
  'terminal:remove_bookmark': terminalBookmarkRemove,
  'terminal:watch:update': terminalWatchUpdate,
  'files:browse': handleFilesBrowse,
  'files:read': handleFilesRead,
  'files:write': handleFilesWrite,
  'files:create': handleFilesCreate,
  'files:rename': handleFilesRename,
  'files:delete': handleFilesDelete,
  'files:move': handleFilesMove,
  'files:search': handleFilesSearch,
  restart: handleRestart,
  upgrade: handleUpgrade,
  get_git_diff: getGitDiff,
  git_clone: gitClone,
  get_settings: getSettings,
  update_settings: updateSettings,
  get_usage_stats: getUsageStats,
  'mcp:list': mcpList,
  'mcp:add': mcpAdd,
  'mcp:update': mcpUpdate,
  'mcp:remove': mcpRemove,
  'mcp:test': mcpTest,
};
