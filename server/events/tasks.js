/**
 * Tasks WebSocket Event Handlers
 *
 * Exposes the TaskProvider interface to the frontend:
 *   - tasks:list              → list tickets (with filters)
 *   - tasks:fetch             → fetch a single ticket with full body content
 *   - tasks:create            → create a new ticket
 *   - tasks:update            → update ticket status/properties
 *   - tasks:replace           → replace full body content (auto-save)
 *   - tasks:get_status_options → get available status options from the DB schema
 *   - tasks:get_assignees     → get workspace users for assignee dropdown
 *   - tasks:get_comments      → get comments for a ticket
 *   - tasks:add_comment       → add a comment to a ticket
 *   - tasks:add_option        → add a new select/multi_select option to the DB schema + assign to task
 *   - tasks:board_list        → list all tasks for the board view (no assignee filter)
 */

import { logger } from '../lib/logger.js';
import { resolveActiveProvider } from '../lib/task-providers/index.js';
import { send } from '../lib/ws.js';

/**
 * Resolve the active provider and shared field config.
 * Returns null and sends error if not configured.
 * @param {import('ws').WebSocket} ws
 * @param {string} errorType - Response message type to use on failure
 * @returns {{ provider, config, assigneeField, statusField, databaseUrl } | null}
 */
async function resolveContext(ws, errorType) {
  const resolved = resolveActiveProvider();
  if (!resolved) {
    send(ws, { type: errorType, success: false, error: 'not_configured' });
    return null;
  }

  const { provider, config } = resolved;
  const databaseUrl = config.ticketDatabaseUrl;

  if (!databaseUrl) {
    send(ws, {
      type: errorType,
      success: false,
      error: 'No ticket database URL configured.',
    });
    return null;
  }

  const assigneeMapping = config.fieldMappings?.find(
    (m) => m.type === 'people',
  );
  const statusMapping =
    config.fieldMappings?.find((m) => m.type === 'status') ??
    config.fieldMappings?.find((m) => m.type === 'select');
  const labelMapping =
    config.fieldMappings?.find((m) => m.type === 'multi_select') ??
    config.fieldMappings?.find(
      (m) => m.type === 'select' && m.field !== statusMapping?.field,
    );
  // Archive field: any field with purpose "archive" — excluded from board when value = "archive"
  // The Archive field in Notion is a formula type, so we match on purpose only (not type)
  const archiveMapping = config.fieldMappings?.find((m) =>
    m.purpose?.toLowerCase().includes('archive'),
  );

  return {
    provider,
    config,
    databaseUrl,
    assigneeField: assigneeMapping?.field ?? null,
    statusField: statusMapping?.field ?? null,
    statusFieldType: statusMapping?.type ?? null,
    labelField: labelMapping?.field ?? null,
    archiveField: archiveMapping?.field ?? null,
  };
}

/**
 * List tickets from the active task provider
 * @param {import('ws').WebSocket} ws
 * @param {Object} message - { limit?, cursor?, filterBySelf?, filterByAssignee?, filterByStatus?, titleSearch? }
 */
export async function handleListTasks(ws, message) {
  try {
    const ctx = await resolveContext(ws, 'tasks:list_result');
    if (!ctx) return;

    const {
      provider,
      config,
      databaseUrl,
      assigneeField,
      statusField,
      labelField,
    } = ctx;
    const limit = message.limit ?? 20;
    const cursor = message.cursor ?? undefined;
    const filterByStatus = message.filterByStatus ?? undefined;
    const titleSearch = message.titleSearch ?? undefined;

    // Resolve filter user ID:
    // filterByAssignee = direct Notion user ID from dropdown
    // filterBySelf = true → resolve from configured userEmail
    let filterByUserId = null;
    if (message.filterByAssignee && assigneeField) {
      filterByUserId = message.filterByAssignee;
    } else if (
      message.filterBySelf &&
      assigneeField &&
      config.userEmail &&
      provider.resolveUserId
    ) {
      filterByUserId = await provider.resolveUserId(config.userEmail);
    }

    const result = await provider.listTickets({
      databaseUrl,
      limit,
      cursor,
      filterByUserId: filterByUserId ?? undefined,
      assigneeField: assigneeField ?? undefined,
      statusField: statusField ?? undefined,
      labelField: labelField ?? undefined,
      filterByStatus,
      titleSearch,
    });
    send(ws, { type: 'tasks:list_result', ...result });
  } catch (err) {
    logger.error('[Tasks WS] List tasks error:', err);
    send(ws, { type: 'tasks:list_result', success: false, error: err.message });
  }
}

/**
 * Fetch a single ticket with full body content
 * @param {import('ws').WebSocket} ws
 * @param {Object} message - { pageId: string }
 */
export async function handleFetchTask(ws, message) {
  try {
    const ctx = await resolveContext(ws, 'tasks:fetch_result');
    if (!ctx) return;

    const { provider, config, databaseUrl, statusField, assigneeField } = ctx;
    const { pageId } = message;

    if (!pageId) {
      send(ws, {
        type: 'tasks:fetch_result',
        success: false,
        error: 'No pageId provided.',
      });
      return;
    }

    const result = await provider.fetchTicket(
      pageId,
      statusField ?? undefined,
      assigneeField ?? undefined,
      config.fieldMappings ?? [],
      databaseUrl,
    );
    send(ws, { type: 'tasks:fetch_result', ...result });
  } catch (err) {
    logger.error('[Tasks WS] Fetch task error:', err);
    send(ws, {
      type: 'tasks:fetch_result',
      success: false,
      error: err.message,
    });
  }
}

/**
 * Create a new ticket in the active task provider
 * @param {import('ws').WebSocket} ws
 * @param {Object} message - { title: string }
 */
export async function handleCreateTask(ws, message) {
  try {
    const ctx = await resolveContext(ws, 'tasks:create_result');
    if (!ctx) return;

    const { provider, config, databaseUrl, labelField } = ctx;
    const { title, assigneeId, labelValue } = message;

    if (!title || !title.trim()) {
      send(ws, {
        type: 'tasks:create_result',
        success: false,
        error: 'Title is required.',
      });
      return;
    }

    const result = await provider.createTicket({
      title: title.trim(),
      body: '',
      databaseUrl,
      fieldMappings: config.fieldMappings,
      assigneeId: assigneeId || null,
      assigneeField: ctx.assigneeField,
      labelValue: labelValue || null,
      labelField: labelField || null,
    });
    send(ws, { type: 'tasks:create_result', ...result });
  } catch (err) {
    logger.error('[Tasks WS] Create task error:', err);
    send(ws, {
      type: 'tasks:create_result',
      success: false,
      error: err.message,
    });
  }
}

/**
 * Update ticket properties (status, or any arbitrary field)
 * @param {import('ws').WebSocket} ws
 * @param {Object} message - { pageId: string, status?: string, field?: string, fieldType?: string, value?: * }
 */
export async function handleUpdateTask(ws, message) {
  try {
    const ctx = await resolveContext(ws, 'tasks:update_result');
    if (!ctx) return;

    const { provider, statusField } = ctx;
    const { pageId, status, field, fieldType, value } = message;

    if (!pageId) {
      send(ws, {
        type: 'tasks:update_result',
        success: false,
        error: 'No pageId provided.',
      });
      return;
    }

    const properties = {};

    // Legacy: status shorthand
    if (status !== undefined && statusField) {
      Object.assign(
        properties,
        provider.buildStatusProperty(statusField, status),
      );
    }

    // Arbitrary field update
    if (field && fieldType && provider.buildPropertyValue) {
      const propVal = provider.buildPropertyValue(field, fieldType, value);
      if (propVal) Object.assign(properties, propVal);
    }

    const result = await provider.updateTicket({ pageId, properties });
    send(ws, { type: 'tasks:update_result', ...result });
  } catch (err) {
    logger.error('[Tasks WS] Update task error:', err);
    send(ws, {
      type: 'tasks:update_result',
      success: false,
      error: err.message,
    });
  }
}

/**
 * Replace the full body content of a ticket (auto-save)
 * @param {import('ws').WebSocket} ws
 * @param {Object} message - { pageId: string, body: string }
 */
export async function handleReplaceTask(ws, message) {
  try {
    const ctx = await resolveContext(ws, 'tasks:replace_result');
    if (!ctx) return;

    const { provider } = ctx;
    const { pageId, body } = message;

    if (!pageId) {
      send(ws, {
        type: 'tasks:replace_result',
        success: false,
        error: 'No pageId provided.',
      });
      return;
    }

    const result = await provider.replaceTicketBody(pageId, body ?? '');
    send(ws, { type: 'tasks:replace_result', pageId, ...result });
  } catch (err) {
    logger.error('[Tasks WS] Replace task body error:', err);
    send(ws, {
      type: 'tasks:replace_result',
      success: false,
      error: err.message,
    });
  }
}

/**
 * Get available status options from the database schema
 * @param {import('ws').WebSocket} ws
 */
export async function handleGetTaskStatusOptions(ws) {
  try {
    const ctx = await resolveContext(ws, 'tasks:status_options_result');
    if (!ctx) return;

    const { provider, databaseUrl, statusField } = ctx;

    if (!statusField) {
      send(ws, {
        type: 'tasks:status_options_result',
        success: true,
        options: [],
      });
      return;
    }

    const result = await provider.getStatusOptions(databaseUrl, statusField);
    send(ws, { type: 'tasks:status_options_result', ...result });
  } catch (err) {
    logger.error('[Tasks WS] Get status options error:', err);
    send(ws, {
      type: 'tasks:status_options_result',
      success: false,
      error: err.message,
    });
  }
}

/**
 * Get available label/select field options from the database schema
 * @param {import('ws').WebSocket} ws
 */
export async function handleGetLabelOptions(ws) {
  try {
    const ctx = await resolveContext(ws, 'tasks:label_options_result');
    if (!ctx) return;

    const { provider, databaseUrl, labelField } = ctx;

    if (!labelField) {
      send(ws, {
        type: 'tasks:label_options_result',
        success: true,
        options: [],
      });
      return;
    }

    const result = await provider.getFieldOptions(databaseUrl, labelField);
    send(ws, { type: 'tasks:label_options_result', ...result });
  } catch (err) {
    logger.error('[Tasks WS] Get label options error:', err);
    send(ws, {
      type: 'tasks:label_options_result',
      success: false,
      error: err.message,
    });
  }
}

/**
 * Get assignees present in actual tickets for the assignee dropdown
 * @param {import('ws').WebSocket} ws
 */
export async function handleGetAssignees(ws) {
  try {
    const ctx = await resolveContext(ws, 'tasks:assignees_result');
    if (!ctx) return;

    const { provider, config, databaseUrl, assigneeField } = ctx;
    const [dbUsers, workspaceUsers, selfId] = await Promise.all([
      provider.listAssigneesFromDb(databaseUrl, assigneeField),
      provider.listWorkspaceUsers(),
      provider.getSelfId(config.userEmail),
    ]);
    // DB assignees first (already in use), then remaining workspace users
    const seen = new Set(dbUsers.map((u) => u.id));
    const users = [
      ...dbUsers,
      ...workspaceUsers.filter((u) => !seen.has(u.id)),
    ];
    send(ws, {
      type: 'tasks:assignees_result',
      success: true,
      users,
      selfId: selfId || null,
    });
  } catch (err) {
    logger.error('[Tasks WS] Get assignees error:', err);
    send(ws, {
      type: 'tasks:assignees_result',
      success: false,
      error: err.message,
    });
  }
}

/**
 * Get comments for a ticket
 * @param {import('ws').WebSocket} ws
 * @param {Object} message - { pageId: string }
 */
export async function handleGetComments(ws, message) {
  try {
    const ctx = await resolveContext(ws, 'tasks:comments_result');
    if (!ctx) return;

    const { provider } = ctx;
    const { pageId } = message;

    if (!pageId) {
      send(ws, {
        type: 'tasks:comments_result',
        success: false,
        error: 'No pageId provided.',
      });
      return;
    }

    const [comments, workspaceUsers] = await Promise.all([
      provider.getComments(pageId),
      provider.listWorkspaceUsers(),
    ]);

    // Resolve UUIDs to display names using workspace user list
    const userMap = new Map(workspaceUsers.map((u) => [u.id, u.name]));
    for (const comment of comments) {
      if (userMap.has(comment.createdBy)) {
        comment.createdBy = userMap.get(comment.createdBy);
      }
    }
    send(ws, {
      type: 'tasks:comments_result',
      success: true,
      pageId,
      comments,
    });
  } catch (err) {
    logger.error('[Tasks WS] Get comments error:', err);
    send(ws, {
      type: 'tasks:comments_result',
      success: false,
      error: err.message,
    });
  }
}

/**
 * Add a comment to a ticket
 * @param {import('ws').WebSocket} ws
 * @param {Object} message - { pageId: string, content: string }
 */
export async function handleAddComment(ws, message) {
  try {
    const ctx = await resolveContext(ws, 'tasks:add_comment_result');
    if (!ctx) return;

    const { provider } = ctx;
    const { pageId, content } = message;

    if (!pageId || !content?.trim()) {
      send(ws, {
        type: 'tasks:add_comment_result',
        success: false,
        error: 'pageId and content required.',
      });
      return;
    }

    const result = await provider.addComment(pageId, content.trim());
    send(ws, { type: 'tasks:add_comment_result', ...result, pageId });
  } catch (err) {
    logger.error('[Tasks WS] Add comment error:', err);
    send(ws, {
      type: 'tasks:add_comment_result',
      success: false,
      error: err.message,
    });
  }
}

/**
 * Add a new option to a select/multi_select field on the DB schema,
 * then immediately assign it to the task.
 * @param {import('ws').WebSocket} ws
 * @param {Object} message - { pageId: string, field: string, fieldType: string, optionName: string, currentValues?: string[] }
 */
export async function handleAddOption(ws, message) {
  try {
    const ctx = await resolveContext(ws, 'tasks:add_option_result');
    if (!ctx) return;

    const { provider, databaseUrl } = ctx;
    const { pageId, field, fieldType, optionName, currentValues } = message;

    if (!field || !fieldType || !optionName?.trim()) {
      send(ws, {
        type: 'tasks:add_option_result',
        success: false,
        error: 'field, fieldType and optionName are required.',
      });
      return;
    }

    const trimmedName = optionName.trim();

    // 1. Add the new option to the database schema
    const addResult = await provider.addSelectOption(
      databaseUrl,
      field,
      fieldType,
      trimmedName,
    );
    if (!addResult.success) {
      send(ws, { type: 'tasks:add_option_result', ...addResult });
      return;
    }

    // 2. Assign the new option to the task
    if (pageId) {
      let newValue;
      if (fieldType === 'multi_select') {
        newValue = [...(currentValues ?? []), trimmedName];
      } else {
        newValue = trimmedName;
      }
      const propVal = provider.buildPropertyValue(field, fieldType, newValue);
      if (propVal) {
        await provider.updateTicket({ pageId, properties: propVal });
      }
    }

    send(ws, {
      type: 'tasks:add_option_result',
      success: true,
      optionName: trimmedName,
    });
  } catch (err) {
    logger.error('[Tasks WS] Add option error:', err);
    send(ws, {
      type: 'tasks:add_option_result',
      success: false,
      error: err.message,
    });
  }
}

/**
 * Archive (soft-delete) a ticket
 * @param {import('ws').WebSocket} ws
 * @param {Object} message - { pageId: string }
 */
export async function handleDeleteTask(ws, message) {
  try {
    const ctx = await resolveContext(ws, 'tasks:delete_result');
    if (!ctx) return;

    const { provider } = ctx;
    const { pageId } = message;

    if (!pageId) {
      send(ws, {
        type: 'tasks:delete_result',
        success: false,
        error: 'No pageId provided.',
      });
      return;
    }

    const result = await provider.deleteTicket(pageId);
    send(ws, { type: 'tasks:delete_result', ...result, pageId });
  } catch (err) {
    logger.error('[Tasks WS] Delete task error:', err);
    send(ws, {
      type: 'tasks:delete_result',
      success: false,
      error: err.message,
    });
  }
}

/**
 * List all tasks for the board view (optional self-filter or assignee filter, higher limit).
 * Also returns the status field name and type so the board knows what to update on drag.
 * @param {import('ws').WebSocket} ws
 * @param {Object} message - { limit?: number, filterBySelf?: boolean, filterByAssignee?: string }
 */
export async function handleListBoardTasks(ws, message) {
  try {
    const ctx = await resolveContext(ws, 'tasks:board_list_result');
    if (!ctx) return;

    const {
      provider,
      config,
      databaseUrl,
      assigneeField,
      statusField,
      statusFieldType,
      labelField,
      archiveField,
    } = ctx;
    const limit = message.limit ?? 100;

    // Resolve filter user ID (same logic as handleListTasks)
    let filterByUserId = null;
    if (message.filterByAssignee && assigneeField) {
      filterByUserId = message.filterByAssignee;
    } else if (
      message.filterBySelf &&
      assigneeField &&
      config.userEmail &&
      provider.resolveUserId
    ) {
      filterByUserId = await provider.resolveUserId(config.userEmail);
    }

    const result = await provider.listTickets({
      databaseUrl,
      limit,
      filterByUserId: filterByUserId ?? undefined,
      assigneeField: assigneeField ?? undefined,
      statusField: statusField ?? undefined,
      labelField: labelField ?? undefined,
      archiveField: archiveField ?? undefined,
    });

    send(ws, {
      type: 'tasks:board_list_result',
      ...result,
      statusField: statusField ?? null,
      statusFieldType: statusFieldType ?? null,
    });
  } catch (err) {
    logger.error('[Tasks WS] Board list error:', err);
    send(ws, {
      type: 'tasks:board_list_result',
      success: false,
      error: err.message,
    });
  }
}
