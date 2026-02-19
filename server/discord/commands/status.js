/**
 * /status Slash Command
 *
 * Shows current bot configuration and runtime info:
 * - Channel → project mapping for the current channel (if any)
 * - Bot version and server config (root path, models)
 * - Active session count (threads with running tasks)
 * - Total mapped channels and sessions
 *
 * Ephemeral - only visible to the user who ran it.
 */

import { SlashCommandBuilder } from 'discord.js';
import { config } from '../../config.js';
import { tasks } from '../../lib/tasks.js';
import {
  discordConfig,
  findSessionsByChannel,
  getChannelMapping,
  loadChannelMappings,
  loadSessionMappings,
} from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show current bot configuration and runtime info');

export async function handleStatus(interaction) {
  const channelId = interaction.channelId;
  const channelMapping = getChannelMapping(channelId);
  const allChannelMappings = loadChannelMappings();
  const allSessionMappings = loadSessionMappings();

  const lines = [];

  // Load channel sessions once (used in both config block and active tasks block)
  const channelSessions = channelMapping
    ? findSessionsByChannel(channelId)
    : [];

  // --- Channel config ---
  lines.push('## 📡 Channel Config');
  if (channelMapping) {
    lines.push(`**Project**: \`${channelMapping.projectPath}\``);
    lines.push(`**Configured by**: <@${channelMapping.configuredBy}>`);
    lines.push(
      `**Since**: ${new Date(channelMapping.configuredAt).toLocaleDateString()}`,
    );
    lines.push(`**Threads in this channel**: ${channelSessions.length}`);
  } else {
    lines.push(
      '_Not configured — run `/setup` to link this channel to a project._',
    );
  }

  // --- Active sessions in this channel ---
  if (channelMapping) {
    const activeSessions = channelSessions.filter(
      (s) => tasks.get(s.sessionId)?.status === 'running',
    );
    if (activeSessions.length > 0) {
      lines.push('');
      lines.push('## 🟡 Active Tasks');
      for (const s of activeSessions) {
        lines.push(`<#${s.threadId}> — \`${s.sessionId.substring(0, 8)}…\``);
      }
    }
  }

  // --- Bot-wide stats ---
  lines.push('');
  lines.push('## 📊 Bot Stats');
  lines.push(`**Mapped channels**: ${Object.keys(allChannelMappings).length}`);
  lines.push(`**Mapped threads**: ${Object.keys(allSessionMappings).length}`);

  // Count running tasks across all sessions
  let runningCount = 0;
  for (const [, task] of tasks) {
    if (task.status === 'running') runningCount++;
  }
  if (runningCount > 0) {
    lines.push(`**Running tasks**: ${runningCount}`);
  }

  // --- Server config ---
  lines.push('');
  lines.push('## ⚙️ Server Config');
  lines.push(
    `**Root path**: ${config.rootPath ? `\`${config.rootPath}\`` : '_unrestricted_'}`,
  );
  lines.push(`**Permission mode**: \`${config.permissionMode}\``);
  lines.push(
    `**Models**: haiku=\`${config.models.haiku}\` · sonnet=\`${config.models.sonnet}\``,
  );
  lines.push(`**Bot status text**: _${discordConfig.status}_`);
  lines.push(
    `**Guild-locked**: ${discordConfig.guildId ? `Yes (\`${discordConfig.guildId}\`)` : 'No (global)'}`,
  );

  await interaction.reply({
    content: lines.join('\n'),
    flags: 64, // ephemeral
  });
}
