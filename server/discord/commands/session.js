/**
 * /session Slash Command
 *
 * Lists recent sessions for this channel's project.
 * Usage: /session
 */

import { SlashCommandBuilder } from 'discord.js';
import { getAllTitles } from '../../lib/session-titles.js';
import { getSessionsList } from '../../lib/sessions.js';
import { getChannelMapping } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('session')
  .setDescription('List or view session info for this channel');

export async function handleSession(interaction) {
  const channel = interaction.channel;
  const parentId = channel.isThread() ? channel.parentId : channel.id;

  const mapping = getChannelMapping(parentId);
  if (!mapping) {
    await interaction.reply({
      content: 'This channel is not configured. Use `/setup` first.',
      flags: 64, // ephemeral
    });
    return;
  }

  const sessions = await getSessionsList(mapping.projectSlug);
  const titles = getAllTitles(mapping.projectSlug);

  // Show recent 10 sessions
  const recent = sessions.slice(0, 10);
  const lines = recent.map((s, i) => {
    const title = titles[s.sessionId] || s.firstPrompt || 'Untitled';
    const modified = new Date(s.modified).toLocaleDateString();
    return `${i + 1}. **${title}** (${s.messageCount} msgs, ${modified})`;
  });

  await interaction.reply({
    content: `📋 **Sessions for** \`${mapping.projectPath}\`\n\n${lines.join('\n') || 'No sessions yet.'}`,
    flags: 64, // ephemeral
  });
}
