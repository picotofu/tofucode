/**
 * /resume Slash Command
 *
 * Lists recent sessions for the channel's project and allows user to
 * resume a session by creating a new Discord thread mapped to that session.
 *
 * This is the manual sync MVP - users can migrate Web UI sessions to Discord.
 *
 * Usage: /resume
 */

import {
  ActionRowBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { logger } from '../../lib/logger.js';
import { getAllTitles } from '../../lib/session-titles.js';
import { getSessionsList } from '../../lib/sessions.js';
import { getChannelMapping } from '../config.js';
import {
  createThreadForSession,
  findThreadForSession,
  sendSessionHistoryToThread,
  sendToThread,
} from '../lib/sync.js';

export const data = new SlashCommandBuilder()
  .setName('resume')
  .setDescription('Resume an existing session in a new Discord thread');

export async function handleResume(interaction) {
  const channel = interaction.channel;

  // Must be in a channel (not a DM)
  if (!interaction.guild) {
    await interaction.reply({
      content: 'This command must be used in a server channel.',
      flags: 64, // ephemeral
    });
    return;
  }

  // If in a thread, use parent channel
  const targetChannelId = channel.isThread() ? channel.parentId : channel.id;

  // Check if channel is mapped to a project
  const mapping = getChannelMapping(targetChannelId);
  if (!mapping) {
    await interaction.reply({
      content:
        'This channel is not configured. Use `/setup` in the parent channel first.',
      flags: 64, // ephemeral
    });
    return;
  }

  const { projectSlug, projectPath } = mapping;

  // Load sessions for this project
  const sessions = await getSessionsList(projectSlug);
  const titles = getAllTitles(projectSlug);

  if (sessions.length === 0) {
    await interaction.reply({
      content: `No sessions found for project: \`${projectPath}\``,
      flags: 64, // ephemeral
    });
    return;
  }

  // Show recent 25 sessions (Discord select menu limit)
  const recent = sessions.slice(0, 25);

  // Build select menu options
  const options = recent.map((s, _i) => {
    const title = titles[s.sessionId] || s.firstPrompt || 'Untitled';
    const modified = new Date(s.modified).toLocaleDateString();
    const label = title.length > 100 ? `${title.substring(0, 97)}...` : title;
    const description = `${s.messageCount} msgs • ${modified}`;

    return {
      label,
      description,
      value: s.sessionId, // This is what we get back on selection
    };
  });

  // Namespace customId with interaction ID to avoid collisions between
  // concurrent /resume invocations
  const selectId = `resume_session_${interaction.id}`;

  // Create select menu
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(selectId)
    .setPlaceholder('Choose a session to resume')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  // Send interactive message
  await interaction.reply({
    content: `**Select a session to resume:**\n_A new thread will be created for the selected session._\n\nProject: \`${projectPath}\``,
    components: [row],
    flags: 64, // ephemeral
  });

  // Wait for user selection (60 second timeout)
  const filter = (i) =>
    i.customId === selectId && i.user.id === interaction.user.id;

  try {
    const selection = await interaction.channel.awaitMessageComponent({
      filter,
      time: 60000,
    });

    const selectedSessionId = selection.values[0];

    // Check if this session already has a live Discord thread
    // Pass guild so stale mappings (deleted threads) are cleaned up automatically
    const existingThreadId = await findThreadForSession(
      selectedSessionId,
      interaction.guild,
    );
    if (existingThreadId) {
      await selection.update({
        content: `⚠️ This session already has a Discord thread: <#${existingThreadId}>`,
        components: [],
      });
      return;
    }

    // Get session details for thread name
    const selectedSession = recent.find(
      (s) => s.sessionId === selectedSessionId,
    );
    const sessionTitle =
      titles[selectedSessionId] ||
      selectedSession.firstPrompt ||
      'Resumed Session';

    // Create thread
    await selection.update({
      content: '⏳ Creating thread...',
      components: [],
    });

    // Get the actual channel object (not thread)
    const parentChannel = channel.isThread()
      ? await interaction.guild.channels.fetch(channel.parentId)
      : channel;

    const thread = await createThreadForSession(
      parentChannel,
      selectedSessionId,
      sessionTitle,
      projectSlug,
      interaction.user.id,
    );

    // Send session header
    const lastActive = selectedSession
      ? new Date(selectedSession.modified).toLocaleString()
      : 'Unknown';
    const msgCount = selectedSession?.messageCount ?? '?';

    await sendToThread(
      thread,
      `📋 **Resumed session** — ${sessionTitle}\n` +
        `${msgCount} messages • Last active: ${lastActive}\n` +
        '─'.repeat(30),
    );

    // Send last 3 turns of conversation history
    await sendSessionHistoryToThread(thread, projectSlug, selectedSessionId, 3);

    // Send continuation prompt
    await sendToThread(
      thread,
      '_Session history loaded above. Continue the conversation below._',
    );

    // Update the selection response
    await selection.editReply({
      content: `✅ Thread created: ${thread.toString()}\n\nYou can now continue your session there.`,
      components: [],
    });

    logger.log(
      `[Discord] User ${interaction.user.id} resumed session ${selectedSessionId} in thread ${thread.id}`,
    );
  } catch (err) {
    if (err.message?.includes('time')) {
      // Timeout
      await interaction.editReply({
        content: '⏱️ Selection timed out. Run `/resume` again to try.',
        components: [],
      });
    } else {
      // Other error
      logger.error('[Discord] Error in /resume command:', err);
      await interaction.editReply({
        content: `⚠️ Failed to create thread: ${err.message}`,
        components: [],
      });
    }
  }
}
