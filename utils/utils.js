// Utility functions for OracleAntiCheat Bot
const { PermissionsBitField } = require('discord.js');

// Format date as string
function formatDateString() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

// Encode a path for Firebase (replace special characters)
function encodeFirebasePath(path) {
  return path.toString()
    .replace(/\./g, '_DOT_')
    .replace(/\$/g, '_DOLLAR_')
    .replace(/#/g, '_HASH_')
    .replace(/\[/g, '_LBRACKET_')
    .replace(/\]/g, '_RBRACKET_')
    .replace(/\//g, '_SLASH_');
}

// Check if a user has moderation permissions
function hasModPermission(interaction, config) {
  // If user has Admin permission, always allow
  if (interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }
  
  // If user has Moderate Members permission, allow
  if (interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
    return true;
  }
  
  // If no admin roles defined, default to requiring Admin permission
  if (!config.adminRoles || config.adminRoles.length === 0) {
    return interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
  }
  
  // Check if user has any of the specified admin roles (by ID or name)
  return interaction.member.roles.cache.some(role => 
    config.adminRoles.includes(role.name) || config.adminRoles.includes(role.id)
  );
}

// Log action to console and Discord channel
async function logAction(client, interaction, action, details, color, config) {
  const { EmbedBuilder } = require('discord.js');
  const { COLORS } = require('../core/config.js');
  const { saveConfig } = require('../core/config.js');
  
  const logEmbed = new EmbedBuilder()
    .setColor(color || COLORS.LOG)
    .setTitle(`Moderation Action: ${action}`)
    .setDescription(`Action performed by ${interaction.user.tag}`)
    .addFields(
      { name: 'Details', value: details },
      { name: 'Timestamp', value: formatDateString() }
    )
    .setFooter({ text: 'OracleAntiCheat Bot' });
  
  // Log to console
  console.log(`[${formatDateString()}] ${action} by ${interaction.user.tag}: ${details}`);
  
  // If no log channel configured, try to find a channel named "admin-logs" or similar
  let logChannelId = config.logChannel;
  if (!logChannelId) {
    try {
      const guild = interaction.guild;
      const possibleLogChannels = ["admin-logs", "mod-logs", "logs", "audit-logs", "bot-logs"];
      
      for (const channelName of possibleLogChannels) {
        const channel = guild.channels.cache.find(c => c.name.toLowerCase() === channelName);
        if (channel) {
          logChannelId = channel.id;
          // Update config
          config.logChannel = logChannelId;
          saveConfig(config);
          console.log(`Auto-detected log channel: ${channel.name}`);
          break;
        }
      }
    } catch (error) {
      console.warn("Failed to auto-detect log channel:", error.message);
    }
  }
  
  // If log channel is configured or was auto-detected, try to send the embed there
  if (logChannelId) {
    try {
      // Check if the channel exists and the bot has permissions to see it
      const channel = await client.channels.fetch(logChannelId).catch(() => null);
      
      if (channel) {
        await channel.send({ embeds: [logEmbed] });
      } else {
        console.warn(`Log channel with ID ${logChannelId} not found. Logging to console only.`);
        // Log channel not found - update the config
        config.logChannel = null;
        saveConfig(config);
        console.log("Config updated: Invalid log channel removed");
      }
    } catch (error) {
      console.warn(`Failed to send log message: ${error.message}`);
      // Don't throw error so command can continue
    }
  }
  
  // Successful log action
  console.log("Action logged");
}

module.exports = {
  formatDateString,
  encodeFirebasePath,
  hasModPermission,
  logAction
};