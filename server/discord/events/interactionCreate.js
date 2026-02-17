/**
 * Discord Slash Command Dispatcher
 *
 * Routes slash command interactions to the appropriate handler.
 */

import { logger } from '../../lib/logger.js';
import { handleCancel } from '../commands/cancel.js';
import { handleResume } from '../commands/resume.js';
import { handleSession } from '../commands/session.js';
import { handleSetup } from '../commands/setup.js';

export async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    switch (commandName) {
      case 'setup':
        await handleSetup(interaction);
        break;
      case 'session':
        await handleSession(interaction);
        break;
      case 'cancel':
        await handleCancel(interaction);
        break;
      case 'resume':
        await handleResume(interaction);
        break;
      default:
        await interaction.reply({
          content: 'Unknown command.',
          flags: 64, // ephemeral
        });
    }
  } catch (err) {
    logger.error(`[Discord] Slash command error (${commandName}):`, err);
    const reply =
      interaction.replied || interaction.deferred
        ? interaction.followUp.bind(interaction)
        : interaction.reply.bind(interaction);
    await reply({
      content: '⚠️ Command failed. Check server logs.',
      flags: 64, // ephemeral
    }).catch(() => {});
  }
}
