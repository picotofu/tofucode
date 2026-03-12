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
 * @typedef {Object} TaskProvider
 * @property {string} name - Provider identifier (e.g. "notion")
 * @property {() => Promise<ConnectionTestResult>} testConnection - Test API connectivity
 * @property {(databaseUrl: string) => Promise<AnalyseResult>} analyseDatabase - Analyse DB schema
 * @property {(params: CreateTicketParams) => Promise<TicketResult>} createTicket - Create a ticket
 * @property {(params: UpdateTicketParams) => Promise<TicketResult>} updateTicket - Append update to existing ticket
 * @property {(statusFieldName: string, statusValue: string) => Object} buildStatusProperty - Build provider-specific status property value
 */
