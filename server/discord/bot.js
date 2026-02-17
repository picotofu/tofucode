/**
 * Discord Bot Client Lifecycle
 *
 * Initializes Discord.js client, registers event handlers, and manages startup/shutdown.
 * Called from server/index.js when DISCORD_ENABLED=true.
 */

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { logger } from '../lib/logger.js';
import { discordConfig } from './config.js';
import { handleInteraction } from './events/interactionCreate.js';
import { handleMessage } from './events/messageCreate.js';
import { handleReady } from './events/ready.js';

let client = null;

/**
 * Start the Discord bot.
 * Called from server/index.js when DISCORD_ENABLED=true.
 *
 * @returns {Promise<Client|null>} The Discord.js client instance or null on error
 */
export async function startDiscordBot() {
  if (!discordConfig.token) {
    logger.error(
      '[Discord] DISCORD_BOT_TOKEN is required when DISCORD_ENABLED=true',
    );
    return null;
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, // Required to read message text
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  // Register event handlers
  client.once('ready', () => handleReady(client));
  client.on('messageCreate', handleMessage);
  client.on('interactionCreate', handleInteraction);

  // Error handling
  client.on('error', (err) => {
    logger.error('[Discord] Client error:', err);
  });

  client.on('warn', (warning) => {
    logger.warn('[Discord] Warning:', warning);
  });

  try {
    await client.login(discordConfig.token);
    return client;
  } catch (err) {
    logger.error('[Discord] Failed to login:', err.message);
    return null;
  }
}

/**
 * Gracefully stop the Discord bot.
 * Called during server shutdown.
 */
export async function stopDiscordBot() {
  if (client) {
    logger.log('[Discord] Stopping bot...');
    client.destroy();
    client = null;
  }
}

/**
 * Get the Discord client instance (for status checks).
 * @returns {Client|null}
 */
export function getDiscordClient() {
  return client;
}
