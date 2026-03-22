/**
 * Task Provider Types
 *
 * JSDoc type definitions shared across all task provider adapters.
 */

/**
 * @typedef {Object} TicketResult
 * @property {boolean} success
 * @property {string} [url] - Task URL (on success)
 * @property {string} [pageId] - Provider-specific page/ticket ID (on success)
 * @property {string} [reason] - Failure reason (on failure)
 */

/**
 * @typedef {Object} ConnectionTestResult
 * @property {boolean} success
 * @property {string} [message] - Success message (e.g. "Connected as John")
 * @property {string} [error] - Error message (on failure)
 */

/**
 * @typedef {Object} FieldDefinition
 * @property {string} field - Field name as it appears in the provider
 * @property {string} type - Field type (e.g. "title", "select", "text")
 * @property {string} purpose - Human-readable hint for how to fill this field
 */

/**
 * @typedef {Object} AnalyseResult
 * @property {boolean} success
 * @property {FieldDefinition[]} [fields] - Detected fields (on success)
 * @property {string} [error] - Error message (on failure)
 */

/**
 * @typedef {Object} CreateTicketParams
 * @property {string} title - Ticket title
 * @property {string} body - Ticket description/body
 * @property {string} databaseUrl - Target database/project URL
 * @property {FieldDefinition[]} [fieldMappings] - Field mapping hints
 */

/**
 * @typedef {Object} UpdateTicketParams
 * @property {string} pageId - Provider-specific ticket/page identifier
 * @property {string} [appendText] - Text to append to the ticket body
 * @property {Object} [properties] - Provider-specific property values to update (e.g. status)
 */

/**
 * @typedef {Object} TicketSummary
 * @property {string} pageId - Provider-specific ticket/page identifier
 * @property {string} title - Ticket title
 * @property {string} url - Ticket URL
 * @property {string} [status] - Current status value (if available)
 * @property {string} lastEditedAt - ISO 8601 timestamp of last edit
 */

/**
 * @typedef {Object} FetchTicketResult
 * @property {boolean} success
 * @property {string} [pageId] - Page identifier
 * @property {string} [title] - Ticket title
 * @property {string} [url] - Ticket URL
 * @property {string} [status] - Current status value (if available)
 * @property {string} [body] - Plain text content of the page blocks
 * @property {string} [lastEditedAt] - ISO 8601 timestamp of last edit
 * @property {string} [error] - Error message (on failure)
 */

/**
 * @typedef {Object} ListTicketsParams
 * @property {string} databaseUrl - Target database/project URL
 * @property {number} [limit] - Max number of results to return (default: 20)
 * @property {string} [cursor] - Pagination cursor for next page
 */

/**
 * @typedef {Object} ListTicketsResult
 * @property {boolean} success
 * @property {TicketSummary[]} [tickets] - List of ticket summaries (on success)
 * @property {string} [nextCursor] - Cursor for next page (undefined if no more results)
 * @property {string} [error] - Error message (on failure)
 */

/**
 * @typedef {Object} TaskProvider
 * @property {string} name - Provider identifier (e.g. "notion")
 * @property {() => Promise<ConnectionTestResult>} testConnection - Test API connectivity
 * @property {(databaseUrl: string) => Promise<AnalyseResult>} analyseDatabase - Analyse DB schema
 * @property {(params: CreateTicketParams) => Promise<TicketResult>} createTicket - Create a ticket
 * @property {(params: UpdateTicketParams) => Promise<TicketResult>} updateTicket - Append update to existing ticket
 * @property {(pageId: string) => Promise<FetchTicketResult>} fetchTicket - Fetch a ticket's content and properties
 * @property {(params: ListTicketsParams) => Promise<ListTicketsResult>} listTickets - List tickets from a database
 * @property {(statusFieldName: string, statusValue: string) => Object} buildStatusProperty - Build provider-specific status property value
 */
