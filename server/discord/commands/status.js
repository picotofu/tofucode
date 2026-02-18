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

  // --- Channel config ---
  lines.push('## 📡 Channel Config');
  if (channelMapping) {
    lines.push(`**Project**: \`${channelMapping.projectPath}\``);
    lines.push(`**Configured by**: <@${channelMapping.configuredBy}>`);
    lines.push(
      `**Since**: ${new Date(channelMapping.configuredAt).toLocaleDateString()}`,
    );

    // Sessions in this channel
    const channelSessions = findSessionsByChannel(channelId);
    lines.push(`**Threads in this channel**: ${channelSessions.length}`);
  } else {
    lines.push(
      '_Not configured — run `/setup` to link this channel to a project._',
    );
  }

  // --- Bot-wide stats ---
  lines.push('');
  lines.push('## 📊 Bot Stats');
  lines.push(`**Mapped channels**: ${Object.keys(allChannelMappings).length}`);
  lines.push(`**Mapped threads**: ${Object.keys(allSessionMappings).length}`);

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
