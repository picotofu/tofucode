/**
 * Discord Bot Ready Handler
 *
 * Bot ready event - logs bot tag, sets presence, and registers slash commands.
 */

import { REST, Routes } from 'discord.js';
import { logger } from '../../lib/logger.js';
// Import command definitions
import { data as cancelData } from '../commands/cancel.js';
import { data as listData } from '../commands/list.js';
import { data as resumeData } from '../commands/resume.js';
import { data as sessionData } from '../commands/session.js';
import { data as setupData } from '../commands/setup.js';
import { data as statusData } from '../commands/status.js';
import { discordConfig } from '../config.js';

const commands = [
  setupData,
  sessionData,
  cancelData,
  resumeData,
  listData,
  statusData,
];

export async function handleReady(client) {
  logger.log(`[Discord] Bot logged in as ${client.user.tag}`);

  // Set presence
  client.user.setPresence({
    status: 'online',
    activities: [{ name: discordConfig.status, type: 0 }], // 0 = Playing
  });

  // Register slash commands
  const rest = new REST().setToken(discordConfig.token);

  try {
    const commandData = commands.map((cmd) => cmd.toJSON());

    if (discordConfig.guildId) {
      // Guild-specific commands (instant registration)
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, discordConfig.guildId),
        { body: commandData },
      );
      logger.log(
        `[Discord] Registered ${commandData.length} slash commands for guild ${discordConfig.guildId}`,
      );
    } else {
      // Global commands (takes up to 1 hour to propagate)
      await rest.put(Routes.applicationCommands(client.user.id), {
        body: commandData,
      });
      logger.log(
        `[Discord] Registered ${commandData.length} global slash commands`,
      );
    }
  } catch (err) {
    logger.error('[Discord] Failed to register slash commands:', err);
  }
}
