/**
 * /setup Slash Command
 *
 * Maps a Discord channel to a tofucode project folder.
 * Usage: /setup project:/absolute/path/to/project
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { SlashCommandBuilder } from 'discord.js';
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

  // Save mapping (overwrite if exists)
  const existingMapping = getChannelMapping(channelId);

  saveChannelMapping(channelId, {
    projectPath,
    projectSlug,
    guildId,
    configuredBy: interaction.user.id,
    configuredAt: new Date().toISOString(),
  });

  const overwriteNote = existingMapping
    ? `\n\n⚠️ _Previously mapped to \`${existingMapping.projectPath}\`. Existing threads will now run Claude in the new project directory._`
    : '';

  await interaction.reply(
    '✅ Channel configured!\n' +
      `**Project**: \`${projectPath}\`\n` +
      `**Slug**: \`${projectSlug}\`${overwriteNote}\n\n` +
      'Create threads in this channel to start sessions with Claude Code.\n' +
      'Use `/session` to list existing sessions.',
  );
}
