// Event handlers for OracleAntiCheat Bot
const { EmbedBuilder } = require('discord.js');
const { COLORS } = require('../core/config.js');
const { formatDateString, logAction } = require('../utils/utils.js');

// Initialize globals
let client = null;
let db = null;
let config = null;
let commands = null;

// Handle interaction create events
async function handleInteraction(interaction) {
  if (!interaction.isCommand()) return;
  
  console.log(`Command received: ${interaction.commandName} from ${interaction.user.tag}`);
  
  try {
    // Set a timeout for command response
    const commandTimeout = setTimeout(() => {
      if (!interaction.replied && !interaction.deferred) {
        console.error(`Command ${interaction.commandName} timed out after 5 seconds`);
        interaction.reply({ 
          content: 'This command timed out. Please try again.', 
          ephemeral: true 
        }).catch(err => console.error('Failed to send timeout message:', err));
      }
    }, 5000);
    
    // Find the command handler
    const command = commands[interaction.commandName];
    
    if (command) {
      await command.execute(interaction);
    } else {
      await interaction.reply({ content: 'Unknown command.', ephemeral: true });
    }
    
    clearTimeout(commandTimeout);
    console.log(`Command ${interaction.commandName} completed successfully`);
  } catch (error) {
    console.error(`Error handling command ${interaction.commandName}:`, error);
    
    // Create error embed with safe color parsing
    let errorColor = 0xFF0000; // Default red
    try {
      if (COLORS && COLORS.ERROR) {
        errorColor = parseInt(COLORS.ERROR.replace(/^#/, ''), 16) || errorColor;
      }
    } catch (e) {
      console.error('Error parsing color:', e);
    }
    
    const errorEmbed = new EmbedBuilder()
      .setColor(errorColor)
      .setTitle('Command Error')
      .setDescription(`An error occurred while executing the ${interaction.commandName} command.`)
      .addFields(
        { name: 'Error Message', value: error.message || 'Unknown error' },
        { name: 'Timestamp', value: formatDateString() }
      )
      .setFooter({ text: 'Please try again or contact an administrator.' });
    
    // Always ensure a response is sent
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ 
          embeds: [errorEmbed], 
          ephemeral: true 
        });
      } else if (interaction.deferred) {
        await interaction.editReply({ 
          embeds: [errorEmbed]
        });
      }
      
      // Log error to log channel if possible
      try {
        await logAction(
          client, 
          interaction, 
          'Command Error', 
          `Error executing ${interaction.commandName}: ${error.message}`,
          COLORS.ERROR,
          config
        );
      } catch (logError) {
        console.error('Failed to log error to channel:', logError);
      }
    } catch (replyError) {
      console.error('Failed to send error response:', replyError);
    }
  }
}

// Handle when the bot is ready
async function handleReady() {
  console.log(`Logged in as ${client.user.tag}!`);
  
  // Update bot status
  client.user.setActivity('Monitoring players', { type: 'WATCHING' });
  
  // Auto-detect log channel if not configured
  if (!config.logChannel) {
    console.log("No log channel configured. Attempting to auto-detect...");
    // Try to find a suitable log channel in the first guild
    const guilds = client.guilds.cache;
    
    if (guilds.size > 0) {
      const guild = guilds.first();
      const possibleLogChannels = ["admin-logs", "mod-logs", "logs", "audit-logs", "bot-logs"];
      
      for (const channelName of possibleLogChannels) {
        const channel = guild.channels.cache.find(c => 
          c.name.toLowerCase() === channelName && 
          c.isTextBased() && 
          c.permissionsFor(guild.members.me).has('SendMessages')
        );
        
        if (channel) {
          config.logChannel = channel.id;
          require('../core/config').saveConfig(config);
          console.log(`Auto-detected log channel: #${channel.name}`);
          
          // Safe color parsing for the embed
          let successColor = 0x00FF00; // Default green
          try {
            if (COLORS && COLORS.SUCCESS) {
              successColor = parseInt(COLORS.SUCCESS.replace(/^#/, ''), 16) || successColor;
            }
          } catch (e) {
            console.error('Error parsing color:', e);
          }
          
          // Send a startup message to the log channel
          const startupEmbed = new EmbedBuilder()
            .setColor(successColor)
            .setTitle('Bot Started')
            .setDescription(`OracleAntiCheat Bot has been started.`)
            .addFields(
              { name: 'Version', value: '1.0.0' },
              { name: 'Start Time', value: formatDateString() }
            )
            .setFooter({ text: 'OracleAntiCheat Bot' });
            
          channel.send({ embeds: [startupEmbed] }).catch(err => {
            console.warn(`Failed to send startup message: ${err.message}`);
          });
          
          break;
        }
      }
    }
  }
  
  // Check for active monitors
  try {
    if (global.activeMonitors && global.activeMonitors.size > 0) {
      console.log(`Found ${global.activeMonitors.size} active monitors on startup`);
      
      // Initialize the monitor module if there are active monitors
      try {
        const monitorModule = require('../commands/custom_scripts/monitor.js');
        console.log("Monitor module loaded successfully");
      } catch (error) {
        console.error("Failed to load monitor module:", error);
      }
    }
  } catch (error) {
    console.error("Error checking active monitors:", error);
  }
}

// Handle when the bot is added to a new guild
async function handleGuildCreate(guild) {
  console.log(`Bot added to new guild: ${guild.name} (${guild.id})`);
  
  // Send a welcome message to the system channel or first available text channel
  const welcomeChannel = guild.systemChannel || 
    guild.channels.cache.find(channel => 
      channel.type === 'GUILD_TEXT' && 
      channel.permissionsFor(guild.members.me).has('SendMessages')
    );
    
  if (welcomeChannel) {
    // Safe color parsing for the embed
    let successColor = 0x00FF00; // Default green
    try {
      if (COLORS && COLORS.SUCCESS) {
        successColor = parseInt(COLORS.SUCCESS.replace(/^#/, ''), 16) || successColor;
      }
    } catch (e) {
      console.error('Error parsing color:', e);
    }
    
    const welcomeEmbed = new EmbedBuilder()
      .setColor(successColor)
      .setTitle('Oracle Anti Cheat')
      .setDescription('Thank you for adding the Oracle Anti Cheat Bot to your server!')
      .addFields(
        { name: 'Getting Started', value: 'Use `/help` to figure out what to do next' },
        { name: 'Commands', value: 'Use slash commands to manage blacklisted users and flags.' },
        { name: 'Support', value: 'If you need assistance, contact uonv' }
      )
      .setFooter({ text: 'Oracle Anti Cheat' });
      
    welcomeChannel.send({ embeds: [welcomeEmbed] }).catch(err => {
      console.warn(`Failed to send welcome message: ${err.message}`);
    });
  }
}

// Forward message events to monitor module if active
async function handleMessageCreate(message) {
  // Check if we have active monitors
  if (global.activeMonitors && global.activeMonitors.size > 0) {
    try {
      // Try to get monitor module
      const monitorModule = require('../commands/custom_scripts/monitor.js');
      if (monitorModule.handleGlobalMessage) {
        await monitorModule.handleGlobalMessage(message);
      }
    } catch (error) {
      // Silently continue if monitor module not loaded
    }
  }
}

// Forward voice state updates to monitor module if active
async function handleVoiceStateUpdate(oldState, newState) {
  // Check if we have active monitors
  if (global.activeMonitors && global.activeMonitors.size > 0) {
    try {
      // Try to get monitor module
      const monitorModule = require('../commands/custom_scripts/monitor.js');
      if (monitorModule.handleGlobalVoiceStateUpdate) {
        await monitorModule.handleGlobalVoiceStateUpdate(oldState, newState);
      }
    } catch (error) {
      // Silently continue if monitor module not loaded
    }
  }
}

// Setup all event handlers
function setupEventHandlers(clientInstance, dbInstance, configInstance, commandsInstance) {
  client = clientInstance;
  db = dbInstance;
  config = configInstance;
  commands = commandsInstance;
  
  // Register primary event handlers
  client.on('interactionCreate', handleInteraction);
  client.once('ready', handleReady);
  client.on('guildCreate', handleGuildCreate);
  
  // Register message and voice state events for monitoring
  client.on('messageCreate', handleMessageCreate);
  client.on('voiceStateUpdate', handleVoiceStateUpdate);
  
  // Register error handlers
  client.on('error', (error) => {
    console.error('Discord client error:', error);
  });
  
  client.on('warn', (message) => {
    console.warn('Discord client warning:', message);
  });
  
  console.log('Event handlers registered');
}

module.exports = {
  setupEventHandlers
};