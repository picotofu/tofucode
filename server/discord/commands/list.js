/**
 * /list Slash Command
 *
 * Lists subdirectories at a given path to help users find project folders.
 * Respects ROOT_PATH restriction if configured.
 *
 * Usage: /list path:/home/user
 *
 * Security: Only lists directories (not files), respects ROOT_PATH,
 * blocks path traversal attempts.
 */

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { SlashCommandBuilder } from 'discord.js';
import { config } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('list')
  .setDescription('List subdirectories at a path to find your project folder')
  .addStringOption((option) =>
    option
      .setName('path')
      .setDescription('Absolute path to list (e.g., /home/user/projects)')
      .setRequired(true),
  );

export async function handleList(interaction) {
  const inputPath = interaction.options.getString('path');

  // Validate path is absolute
  if (!path.isAbsolute(inputPath)) {
    await interaction.reply({
      content: `❌ Path must be absolute (e.g., /home/user/projects)\n\nYou provided: \`${inputPath}\``,
      flags: 64, // ephemeral
    });
    return;
  }

  // Resolve to canonical path (handles . and ..)
  const resolvedPath = path.resolve(inputPath);

  // SECURITY: Validate within ROOT_PATH if configured
  if (config.rootPath) {
    const resolvedRoot = path.resolve(config.rootPath);
    const relativePath = path.relative(resolvedRoot, resolvedPath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      await interaction.reply({
        content: `❌ Access denied: path is outside root restriction\n\n**Root**: \`${config.rootPath}\``,
        flags: 64, // ephemeral
      });
      return;
    }
  }

  // Read directory - only directories, no files
  let entries;
  try {
    const all = readdirSync(resolvedPath);
    entries = all.filter((name) => {
      try {
        return statSync(path.join(resolvedPath, name)).isDirectory();
      } catch {
        return false; // Skip entries we can't stat (permissions etc.)
      }
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      await interaction.reply({
        content: `❌ Path does not exist: \`${resolvedPath}\``,
        flags: 64, // ephemeral
      });
    } else if (err.code === 'EACCES') {
      await interaction.reply({
        content: `❌ Permission denied: \`${resolvedPath}\``,
        flags: 64, // ephemeral
      });
    } else {
      await interaction.reply({
        content: `❌ Could not read path: ${err.message}`,
        flags: 64, // ephemeral
      });
    }
    return;
  }

  if (entries.length === 0) {
    await interaction.reply({
      content: `📁 \`${resolvedPath}\`\n\n_No subdirectories found._`,
      flags: 64, // ephemeral
    });
    return;
  }

  // Format directory listing
  const lines = entries.map((name) => `📁 \`${name}\``);

  // Discord message limit - show up to 40 entries, truncate if more
  const MAX_SHOWN = 40;
  const shown = lines.slice(0, MAX_SHOWN);
  const overflow =
    entries.length > MAX_SHOWN
      ? `\n_...and ${entries.length - MAX_SHOWN} more_`
      : '';

  const content =
    `**📂 \`${resolvedPath}\`**\n\n` +
    shown.join('\n') +
    overflow +
    `\n\n_Use \`/setup project:${resolvedPath}/<folder>\` to configure a channel._`;

  await interaction.reply({
    content,
    flags: 64, // ephemeral - only visible to the user who ran it
  });
}
