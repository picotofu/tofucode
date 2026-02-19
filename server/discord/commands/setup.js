/**
 * /setup Slash Command
 *
 * Maps a Discord channel to a tofucode project folder.
 * Usage: /setup project:/absolute/path/to/project
 *
 * If channel is already configured, shows a confirmation prompt with
 * buttons — user must explicitly confirm before the mapping is overwritten.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
} from 'discord.js';
import { config, pathToSlug } from '../../config.js';
import { getChannelMapping, saveChannelMapping } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure this channel to map to a project')
  .addStringOption((option) =>
    option
      .setName('project')
      .setDescription('Absolute project path (e.g., /home/user/projects/myapp)')
      .setRequired(true),
  );

export async function handleSetup(interaction) {
  const projectPath = interaction.options.getString('project');
  const channelId = interaction.channelId;
  const guildId = interaction.guildId;

  // Validate path is absolute
  if (!path.isAbsolute(projectPath)) {
    await interaction.reply({
      content: `❌ Project path must be absolute (e.g., /home/user/projects/myapp)\n\nYou provided: \`${projectPath}\``,
      flags: 64, // ephemeral
    });
    return;
  }

  // Validate path exists
  if (!existsSync(projectPath)) {
    await interaction.reply({
      content: `❌ Project path does not exist: \`${projectPath}\`\n\nPlease check the path and try again.`,
      flags: 64, // ephemeral
    });
    return;
  }

  // SECURITY: Validate that projectPath is within root (if --root is set)
  if (config.rootPath) {
    const resolvedProject = path.resolve(projectPath);
    const resolvedRoot = path.resolve(config.rootPath);
    const relativePath = path.relative(resolvedRoot, resolvedProject);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      await interaction.reply({
        content: `❌ Access denied: project outside root restriction\n\n**Root**: \`${config.rootPath}\`\n**Project**: \`${projectPath}\``,
        flags: 64, // ephemeral
      });
      return;
    }
  }

  const projectSlug = pathToSlug(projectPath);
  const existingMapping = getChannelMapping(channelId);

  // If already configured, always require confirmation via button
  if (existingMapping) {
    // Namespace customIds with the interaction ID to avoid collisions between
    // concurrent /setup invocations (e.g. two admins running it simultaneously)
    const confirmId = `setup_confirm_${interaction.id}`;
    const cancelId = `setup_cancel_${interaction.id}`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmId)
        .setLabel('Yes, remap channel')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      content:
        '⚠️ **This channel is already mapped to a project.**\n\n' +
        `**Current**: \`${existingMapping.projectPath}\`\n` +
        `**New**: \`${projectPath}\`\n\n` +
        'Existing threads will run Claude in the new project directory after remapping.\n\n' +
        'Are you sure you want to remap this channel?',
      components: [row],
      flags: 64, // ephemeral
    });

    // Wait for button click (30 second timeout)
    const filter = (i) =>
      [confirmId, cancelId].includes(i.customId) &&
      i.user.id === interaction.user.id;

    try {
      const button = await interaction.channel.awaitMessageComponent({
        filter,
        time: 30000,
      });

      if (button.customId === cancelId) {
        await button.update({
          content: '❌ Remap cancelled. Channel mapping unchanged.',
          components: [],
        });
        return;
      }

      // Confirmed - save and update
      saveChannelMapping(channelId, {
        projectPath,
        projectSlug,
        guildId,
        configuredBy: interaction.user.id,
        configuredAt: new Date().toISOString(),
      });

      await button.update({
        content:
          '✅ Channel remapped!\n' +
          `**Project**: \`${projectPath}\`\n` +
          `**Slug**: \`${projectSlug}\`\n\n` +
          `⚠️ _Previously mapped to \`${existingMapping.projectPath}\`. Existing threads will now run Claude in the new project directory._`,
        components: [],
      });
    } catch (err) {
      if (err.message?.includes('time')) {
        await interaction.editReply({
          content: '⏱️ Confirmation timed out. Channel mapping unchanged.',
          components: [],
        });
      } else {
        throw err;
      }
    }

    return;
  }

  // No existing mapping - save directly
  saveChannelMapping(channelId, {
    projectPath,
    projectSlug,
    guildId,
    configuredBy: interaction.user.id,
    configuredAt: new Date().toISOString(),
  });

  await interaction.reply(
    '✅ Channel configured!\n' +
      `**Project**: \`${projectPath}\`\n` +
      `**Slug**: \`${projectSlug}\`\n\n` +
      'Create threads in this channel to start sessions with Claude Code.\n' +
      'Use `/session` to list existing sessions.',
  );
}
