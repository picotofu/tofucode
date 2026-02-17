/**
 * /cancel Slash Command
 *
 * Cancels the running task in the current thread.
 * Usage: /cancel
 */

import { SlashCommandBuilder } from 'discord.js';
import { cancelTask, getOrCreateTask } from '../../lib/tasks.js';
import { getSession } from '../lib/sessions.js';

export const data = new SlashCommandBuilder()
  .setName('cancel')
  .setDescription('Cancel the running task in this thread');

export async function handleCancel(interaction) {
  const channel = interaction.channel;

  if (!channel.isThread()) {
    await interaction.reply({
      content: 'Use this command inside a thread.',
      flags: 64, // ephemeral
    });
    return;
  }

  const sessionMapping = getSession(channel.id);
  if (!sessionMapping?.sessionId) {
    await interaction.reply({
      content: 'No session found for this thread.',
      flags: 64, // ephemeral
    });
    return;
  }

  const task = getOrCreateTask(sessionMapping.sessionId);
  if (task.status !== 'running') {
    await interaction.reply({
      content: 'No running task to cancel.',
      flags: 64, // ephemeral
    });
    return;
  }

  const success = cancelTask(sessionMapping.sessionId);
  if (success) {
    await interaction.reply('🛑 Task cancelled.');
  } else {
    await interaction.reply({
      content: 'Failed to cancel task.',
      flags: 64, // ephemeral
    });
  }
}
