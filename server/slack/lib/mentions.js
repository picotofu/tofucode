/**
 * Mention Detection Helpers
 *
 * Checks whether a Slack message text targets the bot — either via a direct
 * user mention (<@UXXXXXXX>) or a group/subteam tag (<!subteam^SXXXXXXX>)
 * that the bot user belongs to.
 */

/** Regex to extract subteam IDs from <!subteam^SXXXXXXX> tags */
const SUBTEAM_REGEX = /<!subteam\^([A-Z0-9]+)/g;

/**
 * Check if the message directly mentions the bot user.
 * @param {string} text
 * @param {string} selfUserId
 * @returns {boolean}
 */
export function isDirectMention(text, selfUserId) {
  return text.includes(`<@${selfUserId}>`);
}

/**
 * Extract all subteam IDs referenced in the message text.
 * @param {string} text
 * @returns {string[]}
 */
function extractSubteamIds(text) {
  const ids = [];
  for (const match of text.matchAll(SUBTEAM_REGEX)) {
    ids.push(match[1]);
  }
  return ids;
}

/**
 * Check if the bot is mentioned — either directly or via a group tag.
 *
 * For group tags, calls usergroups.users.list at runtime to check membership.
 * Fails gracefully: if the API call fails (e.g. missing scope), returns false
 * for that subteam rather than throwing.
 *
 * @param {string} text - Message text
 * @param {string} selfUserId - Bot's own Slack user ID
 * @param {import('./api.js').SlackAPI} slackApi
 * @returns {Promise<boolean>}
 */
export async function isBotMentioned(text, selfUserId, slackApi) {
  if (!text) return false;

  // Fast path: direct mention
  if (isDirectMention(text, selfUserId)) return true;

  // Check group tags
  const subteamIds = extractSubteamIds(text);
  if (subteamIds.length === 0) return false;

  const memberLists = await Promise.all(
    subteamIds.map((id) => slackApi.getUsergroupMembers(id)),
  );

  return memberLists.some((members) => members.includes(selfUserId));
}
