/**
 * Map API error messages to user-friendly descriptions
 */
export function mapApiError(error) {
  const errorMsg = error.message || String(error);

  if (errorMsg.includes('API Error: 500') || errorMsg.includes('Internal server error')) {
    return 'Claude API is temporarily unavailable (500 Internal Server Error). This is usually a temporary issue - please try again in a few moments.';
  }

  if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
    return 'Rate limit exceeded. Please wait a moment before trying again.';
  }

  if (errorMsg.includes('401') || errorMsg.includes('authentication')) {
    return 'Authentication error. Please check your API key configuration.';
  }

  if (errorMsg.includes('400') || errorMsg.includes('invalid request')) {
    return 'Invalid request. Please try a different prompt or check your inputs.';
  }

  return `Failed: ${errorMsg}`;
}
