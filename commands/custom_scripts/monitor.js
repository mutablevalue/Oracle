// monitor.js - Command module for monitoring Discord users across all servers
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const axios = require('axios');
const { formatDateString, hasModPermission, logAction, encodeFirebasePath } = require('../../utils/utils.js');
const { COLORS } = require('../../core/config.js');

// Safe color values for embeds
const EMBED_COLORS = {
  INFO: 0x9932CC,    // Purple for logs
  WARNING: 0xFFAA00, // Amber for warnings
  ERROR: 0xFF0000,   // Red for errors
  PUSH: 0x800000,    // Maroon for push
  PULL: 0x0099FF     // Blue for pull
};

// Try to use config colors if available
try {
  if (COLORS) {
    if (typeof COLORS.LOG === 'string') EMBED_COLORS.INFO = parseInt(COLORS.LOG.replace(/^#/, ''), 16) || EMBED_COLORS.INFO;
    if (typeof COLORS.WARNING === 'string') EMBED_COLORS.WARNING = parseInt(COLORS.WARNING.replace(/^#/, ''), 16) || EMBED_COLORS.WARNING;
    if (typeof COLORS.ERROR === 'string') EMBED_COLORS.ERROR = parseInt(COLORS.ERROR.replace(/^#/, ''), 16) || EMBED_COLORS.ERROR;
    if (typeof COLORS.PUSH === 'string') EMBED_COLORS.PUSH = parseInt(COLORS.PUSH.replace(/^#/, ''), 16) || EMBED_COLORS.PUSH;
    if (typeof COLORS.PULL === 'string') EMBED_COLORS.PULL = parseInt(COLORS.PULL.replace(/^#/, ''), 16) || EMBED_COLORS.PULL;
  }
} catch (error) {
  console.error('Error setting up EMBED_COLORS, using defaults:', error);
}

// Initialize globals that will be set when module is initialized
let client = null;
let db = null; // Keeping the variable but we won't use it
let config = null;

global.activeMonitors = global.activeMonitors || new Map();

async function fetchRobloxUserInfo(userId) {
  try {
    // Get user information
    const userResponse = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
    
    // Get premium status separately
    let isPremium = false;
    try {
      const premiumResponse = await axios.get(`https://premiumfeatures.roblox.com/v1/users/${userId}/validate-membership`);
      isPremium = premiumResponse.data && premiumResponse.data.isPremium;
    } catch (error) {
      console.warn(`Could not fetch premium status for ${userId}:`, error.message);
    }
    
    return {
      ...userResponse.data,
      isPremium
    };
  } catch (error) {
    console.error(`Error fetching user info for ${userId}:`, error.message);
    return null;
  }
}

// Helper for fetching Roblox user groups
async function fetchRobloxUserGroups(userId) {
  try {
    const response = await axios.get(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
    return response.data.data || [];
  } catch (error) {
    console.error(`Error fetching group info for ${userId}:`, error.message);
    return null;
  }
}

// Helper to fetch Discord user info
async function fetchDiscordUserInfo(userId, guild) {
  try {
    // Fetch member from guild
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return null;
    
    return {
      tag: member.user.tag,
      id: member.user.id,
      displayName: member.displayName,
      joinedAt: member.joinedAt,
      roles: Array.from(member.roles.cache.values()).map(role => role.name),
      isBot: member.user.bot,
      avatarURL: member.user.displayAvatarURL(),
      createdAt: member.user.createdAt
    };
  } catch (error) {
    console.error(`Error fetching Discord user info for ${userId}:`, error.message);
    return null;
  }
}

// Calculate Discord account age in days
function calculateDiscordAccountAge(createdDate) {
  const created = new Date(createdDate);
  const now = new Date();
  const diffTime = Math.abs(now - created);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// Modified to remove database checks
async function checkBlacklistedGroups(userId, userGroups) {
  if (!userGroups || userGroups.length === 0) return [];
  
  // Since we're removing database functionality, this function will always return an empty array
  return [];
}

// Simplified alt account analysis
async function analyzeRobloxAccountForAlt(robloxData) {
  try {
    // Calculate account age
    const created = new Date(robloxData.created);
    const now = new Date();
    const diffTime = Math.abs(now - created);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    let suspicionScore = 0;
    const reasons = [];
    
    // Very basic alt detection
    if (diffDays < 30) {
      suspicionScore += 30;
      reasons.push("Very new account (less than 30 days old)");
    } else if (diffDays < 180) {
      suspicionScore += 15;
      reasons.push("Moderately new account (less than 180 days old)");
    }
    
    if (!robloxData.isPremium) {
      suspicionScore += 10;
      reasons.push("No Premium membership");
    }
    
    const isAlt = suspicionScore >= 30;
    
    return {
      userId: robloxData.id,
      username: robloxData.name,
      score: suspicionScore,
      reasons: reasons,
      isAlt: isAlt,
      report: `Simplified alt account analysis for ${robloxData.name}:\n` +
              `Account age: ${diffDays} days\n` +
              `Premium: ${robloxData.isPremium ? 'Yes' : 'No'}\n` +
              `Suspicion score: ${suspicionScore}/100\n` +
              `Is alt: ${isAlt ? 'Yes' : 'No'}`
    };
  } catch (error) {
    console.error('Error in simplified alt analysis:', error);
    return null;
  }
}

// Function to set up monitoring of messages and voice activity
function setupUserMonitoring(userId, channelId, guild, duration) {
  console.log(`Setting up monitoring for user ${userId} in channel ${channelId}`);
  
  // Already being monitored
  if (global.activeMonitors.has(userId)) {
    console.log(`User ${userId} is already being monitored, updating configuration`);
    const existingMonitor = global.activeMonitors.get(userId);
    clearTimeout(existingMonitor.timeout);
    
    // Update the timeout
    const timeout = setTimeout(() => {
      stopMonitoring(userId, guild);
    }, duration);
    
    existingMonitor.timeout = timeout;
    existingMonitor.channelId = channelId;
    existingMonitor.guildId = guild.id;
    existingMonitor.endTime = new Date(Date.now() + duration);
    
    return existingMonitor;
  }
  
  // Create new monitoring setup
  const monitorData = {
    userId,
    channelId,
    guildId: guild.id,
    startTime: new Date(),
    endTime: new Date(Date.now() + duration),
    messageCount: 0,
    voiceEvents: [],
    messages: []
  };
  
  // Set up timeout to stop monitoring after duration
  const timeout = setTimeout(() => {
    stopMonitoring(userId, guild);
  }, duration);
  
  monitorData.timeout = timeout;
  global.activeMonitors.set(userId, monitorData);
  console.log(`Monitoring started for user ${userId}, will end in ${duration}ms`);
  
  return monitorData;
}

// Function to stop monitoring - modified to remove database storage
async function stopMonitoring(userId, guild) {
  if (!global.activeMonitors.has(userId)) return;
  
  const monitorData = global.activeMonitors.get(userId);
  clearTimeout(monitorData.timeout);
  
  // Find the guild where the monitoring channel is
  const monitorGuild = client.guilds.cache.get(monitorData.guildId) || guild;
  if (!monitorGuild) {
    console.error(`Guild not found for monitoring channel: ${monitorData.guildId}`);
    global.activeMonitors.delete(userId);
    return;
  }
  
  // Get the monitoring channel
  const channel = monitorGuild.channels.cache.get(monitorData.channelId);
  
  if (channel) {
    console.log(`Sending monitoring summary to channel ${channel.name}`);
    // Send summary
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.PULL)
      .setTitle(`Monitoring Ended for User ${userId}`)
      .setDescription(`Monitoring period: ${formatDateString(monitorData.startTime)} to ${formatDateString()}`)
      .addFields(
        { name: 'Total Messages', value: monitorData.messageCount.toString() },
        { name: 'Voice Events', value: monitorData.voiceEvents.length.toString() }
      );
    
    await channel.send({ embeds: [embed] }).catch(err => {
      console.error(`Error sending monitoring summary: ${err.message}`);
    });
    
    // Database storage has been removed
  }
  
  global.activeMonitors.delete(userId);
  console.log(`Stopped monitoring user ${userId}`);
}

// Global map to track recently processed messages and voice events
global.lastProcessedMessages = global.lastProcessedMessages || new Map();
global.lastProcessedVoiceEvents = global.lastProcessedVoiceEvents || new Map();

// Enhanced message handler with better deduplication
function handleGlobalMessage(message) {
  // Skip if no author or if it's a bot message
  if (!message.author || message.author.bot) return;
  
  // Only process messages from users we're monitoring
  if (!global.activeMonitors.has(message.author.id)) return;
  
  // Create a unique key for this message
  const messageKey = `${message.id}-${message.channel.id}`;
  
  // Check if we already processed this message recently
  if (global.lastProcessedMessages.has(messageKey)) {
    return; // Skip if we already processed this message
  }
  
  // Mark this message as processed
  global.lastProcessedMessages.set(messageKey, Date.now());
  
  // Clean up old entries from the Map (older than 10 seconds)
  const now = Date.now();
  for (const [key, timestamp] of global.lastProcessedMessages.entries()) {
    if (now - timestamp > 10000) {
      global.lastProcessedMessages.delete(key);
    }
  }
  
  console.log(`Detected message from monitored user ${message.author.id} in server ${message.guild?.name || 'Unknown'}`);
  console.log(`Message content: "${message.content}"`);
  
  const monitorData = global.activeMonitors.get(message.author.id);
  
  // Find the guild where the monitoring channel is
  const monitorGuild = client.guilds.cache.get(monitorData.guildId);
  if (!monitorGuild) {
    console.error(`Guild not found for monitoring channel: ${monitorData.guildId}`);
    return;
  }
  
  // Get the monitoring channel
  const monitorChannel = monitorGuild.channels.cache.get(monitorData.channelId);
  
  if (!monitorChannel) {
    console.error(`Could not find monitor channel ${monitorData.channelId}`);
    return;
  }
  
  // Update monitoring data
  monitorData.messageCount++;
  
  monitorData.messages.push({
    content: message.content || "(No text content)",
    channel: message.channel.name,
    guild: message.guild?.name || "Unknown guild",
    timestamp: formatDateString()
  });
  
  // Forward to monitor channel
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.INFO)
    .setTitle(`Message in #${message.channel.name}${message.guild ? ` (${message.guild.name})` : ''}`)
    .setDescription(message.content || "(No text content)")
    .setFooter({ text: `Message ID: ${message.id} | Server: ${message.guild?.name || 'Unknown'}` });
  
  if (message.attachments.size > 0) {
    embed.addFields({ 
      name: 'Attachments', 
      value: Array.from(message.attachments.values())
        .map(att => `[${att.name}](${att.url})`)
        .join('\n') 
    });
  }
  
  monitorChannel.send({ embeds: [embed] }).catch(err => {
    console.error(`Error forwarding message to monitor channel: ${err.message}`);
  });
}

// Enhanced voice state update handler with deduplication
function handleGlobalVoiceStateUpdate(oldState, newState) {
  // Check if this is a user we're monitoring
  if (!newState.member?.user?.id) return;
  const userId = newState.member.user.id;
  
  if (!global.activeMonitors.has(userId)) return;
  
  // Determine event type
  let eventType = null;
  let channelName = null;
  
  // Joined a voice channel
  if (!oldState.channelId && newState.channelId) {
    eventType = 'joined';
    channelName = newState.channel.name;
  }
  // Left a voice channel
  else if (oldState.channelId && !newState.channelId) {
    eventType = 'left';
    channelName = oldState.channel.name;
  }
  // Moved between voice channels
  else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    eventType = 'moved';
    channelName = `${oldState.channel.name} → ${newState.channel.name}`;
  }
  // Other changes like mute, deaf, etc.
  else {
    return; // Not tracking other changes
  }
  
  // Create a unique key for this voice event
  const voiceEventKey = `${userId}-${eventType}-${channelName}-${Date.now()}`;
  
  // Check if we've seen a very similar event in the last 2 seconds
  const now = Date.now();
  let isDuplicate = false;
  
  for (const [key, timestamp] of global.lastProcessedVoiceEvents.entries()) {
    // Only check recent events (within 2 seconds)
    if (now - timestamp > 2000) {
      global.lastProcessedVoiceEvents.delete(key);
      continue;
    }
    
    // Check if this is similar to a recent event
    // We split by first 3 parts (userId-eventType-channelName) and ignore the timestamp
    const existingKeyParts = key.split('-').slice(0, 3).join('-');
    const newKeyParts = voiceEventKey.split('-').slice(0, 3).join('-');
    
    if (existingKeyParts === newKeyParts) {
      isDuplicate = true;
      break;
    }
  }
  
  if (isDuplicate) {
    return; // Skip if this looks like a duplicate event
  }
  
  // Store this event to prevent duplicates
  global.lastProcessedVoiceEvents.set(voiceEventKey, now);
  
  console.log(`Detected voice state change for monitored user ${userId} in server ${newState.guild?.name || 'Unknown'}`);
  console.log(`Voice event type: ${eventType}, channel: ${channelName}`);
  
  const monitorData = global.activeMonitors.get(userId);
  
  // Find the guild where the monitoring channel is
  const monitorGuild = client.guilds.cache.get(monitorData.guildId);
  if (!monitorGuild) {
    console.error(`Guild not found for monitoring channel: ${monitorData.guildId}`);
    return;
  }
  
  // Get the monitoring channel
  const monitorChannel = monitorGuild.channels.cache.get(monitorData.channelId);
  
  if (!monitorChannel) {
    console.error(`Could not find monitor channel ${monitorData.channelId}`);
    return;
  }
  
  // Add to voice events
  const event = {
    type: eventType,
    channel: channelName,
    guild: newState.guild?.name || 'Unknown',
    timestamp: formatDateString()
  };
  
  monitorData.voiceEvents.push(event);
  
  // Send to monitor channel
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.WARNING)
    .setTitle(`Voice Activity - ${eventType.charAt(0).toUpperCase() + eventType.slice(1)}`)
    .setDescription(`User ${eventType} voice channel: ${channelName}`)
    .setFooter({ text: `Server: ${newState.guild?.name || 'Unknown'} | ${formatDateString()}` });
  
  monitorChannel.send({ embeds: [embed] }).catch(err => {
    console.error(`Error sending voice update to monitor channel: ${err.message}`);
  });
}

// Command handler - modified to remove database checks
async function handleMonitor(interaction) {
  // Check permissions
  if (!hasModPermission(interaction, config)) {
    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
  }
  
  await interaction.deferReply({ ephemeral: true });
  console.log("Monitor command deferred");
  
  const discordId = interaction.options.getString('discordid');
  const robloxId = interaction.options.getString('robloxid');
  const reason = interaction.options.getString('reason');
  const durationStr = interaction.options.getString('duration') || '1d';
  
  // Parse duration string
  let durationMs = 86400000; // Default 1 day in milliseconds
  const durationRegex = /^(\d+)([mhd])$/;
  const match = durationStr.match(durationRegex);
  
  if (match) {
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 'm': // minutes
        durationMs = value * 60 * 1000;
        break;
      case 'h': // hours
        durationMs = value * 60 * 60 * 1000;
        break;
      case 'd': // days
        durationMs = value * 24 * 60 * 60 * 1000;
        break;
    }
  }
  
  try {
    // Try to fetch the Discord user
    const discordUser = await fetchDiscordUserInfo(discordId, interaction.guild);
    
    if (!discordUser) {
      return interaction.editReply({ content: `Discord user with ID ${discordId} not found in this server.` });
    }
    
    // Create a private monitoring channel
    const channelName = `monitor-${discordUser.displayName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    
    const monitorChannel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        {
          id: interaction.guild.id, // @everyone role
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: interaction.user.id, // Command issuer
          allow: [PermissionFlagsBits.ViewChannel]
        }
      ]
    });
    
    // Add admin role permissions
    const adminRoleId = config.adminRoleId || config.modRoleId;
    if (adminRoleId) {
      await monitorChannel.permissionOverwrites.create(adminRoleId, {
        ViewChannel: true
      });
    }
    
    console.log(`Created monitoring channel: ${monitorChannel.name} (${monitorChannel.id})`);
    
    // Setup monitoring for Discord user
    const endDate = new Date(Date.now() + durationMs);
    const monitorData = setupUserMonitoring(discordId, monitorChannel.id, interaction.guild, durationMs);
    
    // Send initial message to monitoring channel
    const initialEmbed = new EmbedBuilder()
      .setColor(EMBED_COLORS.PUSH)
      .setTitle(`Monitoring Started for ${discordUser.displayName}`)
      .setDescription(`Monitoring initiated by ${interaction.user.tag}`)
      .addFields(
        { name: 'Discord ID', value: discordId },
        { name: 'Discord Tag', value: discordUser.tag },
        { name: 'Roblox ID', value: robloxId },
        { name: 'Reason', value: reason },
        { name: 'Started', value: formatDateString() },
        { name: 'Ends', value: formatDateString(endDate) },
        { name: 'Duration', value: durationStr }
      );
    
    if (discordUser.avatarURL) {
      initialEmbed.setThumbnail(discordUser.avatarURL);
    }
    
    await monitorChannel.send({ embeds: [initialEmbed] });
    
    // Get Discord account age
    const discordAgeEmbed = new EmbedBuilder()
      .setColor(EMBED_COLORS.INFO)
      .setTitle('Discord Account Information')
      .setDescription(`Information about ${discordUser.tag}`)
      .addFields(
        { name: 'Account Created', value: formatDateString(discordUser.createdAt) },
        { name: 'Account Age', value: `${calculateDiscordAccountAge(discordUser.createdAt)} days` },
        { name: 'Joined Server', value: formatDateString(discordUser.joinedAt) },
        { name: 'Is Bot', value: discordUser.isBot ? 'Yes' : 'No' }
      );
    
    // Add roles information
    if (discordUser.roles && discordUser.roles.length > 0) {
      discordAgeEmbed.addFields({ 
        name: 'Roles', 
        value: discordUser.roles.join(', ') 
      });
    }
    
    await monitorChannel.send({ embeds: [discordAgeEmbed] });
    
    // Check Roblox ID for information and alt status
    try {
      // Fetch Roblox user info directly using the provided Roblox ID
      const robloxData = await fetchRobloxUserInfo(robloxId);
      
      if (robloxData) {
        const robloxEmbed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO)
          .setTitle('Roblox Account Information')
          .setDescription(`Information about ${robloxData.name}`)
          .addFields(
            { name: 'Roblox Username', value: robloxData.name },
            { name: 'Roblox ID', value: robloxId },
            { name: 'Account Created', value: formatDateString(robloxData.created) },
            { name: 'Is Premium', value: robloxData.isPremium ? 'Yes' : 'No' }
          );
        
        await monitorChannel.send({ embeds: [robloxEmbed] });
        
        // Check if user is an alt account
        const altAnalysisEmbed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO)
          .setTitle('Alt Account Analysis')
          .setDescription(`Analyzing user ${robloxId} for alt account indications...`);
        
        const altMessage = await monitorChannel.send({ embeds: [altAnalysisEmbed] });
        
        // Use the simplified alt detection
        const simpleAltAnalysis = await analyzeRobloxAccountForAlt(robloxData);
        
        if (simpleAltAnalysis) {
          const simpleAltEmbed = new EmbedBuilder()
            .setColor(simpleAltAnalysis.isAlt ? EMBED_COLORS.WARNING : EMBED_COLORS.PULL)
            .setTitle('Alt Account Analysis Result (Simplified)')
            .setDescription(`User ID: ${robloxId} (${robloxData.name})`)
            .addFields(
              { name: 'Account Age', value: `${calculateDiscordAccountAge(robloxData.created)} days` },
              { name: 'Suspicion Score', value: `${simpleAltAnalysis.score}/100` },
              { name: 'Is Alt?', value: simpleAltAnalysis.isAlt ? 'Yes' : 'No' }
            );
          
          if (simpleAltAnalysis.reasons.length > 0) {
            simpleAltEmbed.addFields({ 
              name: 'Reasons', 
              value: simpleAltAnalysis.reasons.join('\n') 
            });
          }
          
          await altMessage.edit({ embeds: [simpleAltEmbed] });
        }
        
        // Check user groups but don't check against database
        const userGroups = await fetchRobloxUserGroups(robloxId);
        
        if (userGroups && userGroups.length > 0) {
          const groupEmbed = new EmbedBuilder()
            .setColor(EMBED_COLORS.INFO)
            .setTitle('Roblox Groups')
            .setDescription(`${robloxData.name} is a member of ${userGroups.length} groups`);
          
          // Add group information
          const groupFields = userGroups.map(group => {
            return {
              name: `${group.group.name} (ID: ${group.group.id})`,
              value: `Role: ${group.role.name} (Rank: ${group.role.rank})`
            };
          });
          
          // Split into chunks if too many groups
          for (let i = 0; i < Math.min(groupFields.length, 5); i++) {
            groupEmbed.addFields(groupFields[i]);
          }
          
          if (groupFields.length > 5) {
            groupEmbed.setFooter({ text: `Showing 5 of ${groupFields.length} groups` });
          }
          
          await monitorChannel.send({ embeds: [groupEmbed] });
          
          // Removed blacklisted groups check as it uses database
        }
        
        // Removed blacklist check as it uses database
      }
    } catch (error) {
      console.error('Error checking Roblox information:', error);
      const errorEmbed = new EmbedBuilder()
        .setColor(EMBED_COLORS.ERROR)
        .setTitle('Error Checking Roblox Information')
        .setDescription(`An error occurred: ${error.message}`);
      
      await monitorChannel.send({ embeds: [errorEmbed] });
    }
    
    // Final instructions to the user
    const instructionsEmbed = new EmbedBuilder()
      .setColor(EMBED_COLORS.INFO)
      .setTitle('📋 Monitoring Setup Complete')
      .setDescription(`Monitoring has been set up for Discord user ${discordUser.tag} and Roblox ID ${robloxId}.`)
      .addFields(
        { name: 'Duration', value: `Monitoring will continue for ${durationStr} (until ${formatDateString(endDate)})` },
        { name: 'Activity Tracked', value: 'All messages sent by this user in any server where the bot is present\nVoice channel join/leave/move events across all servers' },
        { name: 'Information', value: 'No information is stored in any database.\nAll tracked events will appear in this channel.' }
      );
    
    await monitorChannel.send({ embeds: [instructionsEmbed] });
    
    // Log action - PUSH action
    try {
      await logAction(
        client, 
        interaction, 
        'Monitor User', 
        `Started monitoring Discord user ${discordId} and Roblox ID ${robloxId}. Reason: ${reason}`, 
        COLORS.PUSH, // Use original color format for logAction
        config
      );
    } catch (logError) {
      console.error('Error logging action:', logError);
      // Continue even if logging fails
    }
    
    // Respond to command issuer with link to the monitoring channel
    await interaction.editReply({ 
      content: `Monitoring started for user ${discordUser.tag} (Discord ID: ${discordId}, Roblox ID: ${robloxId}). Monitor channel: ${monitorChannel}` 
    });
    
    console.log("Monitor command completed successfully");
  } catch (error) {
    console.error('Error setting up user monitoring:', error);
    await interaction.editReply({ 
      content: `Error setting up user monitoring: ${error.message}` 
    });
  }
}

// Command definition
const monitor = {
  data: new SlashCommandBuilder()
    .setName('monitor')
    .setDescription('Monitor a user (admin only)')
    .addStringOption(option => 
      option.setName('discordid')
        .setDescription('Discord User ID')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('robloxid')
        .setDescription('Roblox User ID')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('reason')
        .setDescription('Reason for monitoring')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('duration')
        .setDescription('Duration to monitor (e.g., 10m, 6h, 7d) - default: 1d')
        .setRequired(false)),
  execute: handleMonitor
};

// Register the global event handlers
function registerGlobalEventHandlers() {
  // Skip if already registered
  if (global.monitorEventHandlersRegistered) {
    console.log("Global monitor event handlers already registered");
    return;
  }
  
  console.log("Registering global monitor event handlers");
  
  // Only register if the client exists
  if (client) {
    // Set up global handlers
    client.on('messageCreate', handleGlobalMessage);
    client.on('voiceStateUpdate', handleGlobalVoiceStateUpdate);
    
    // Mark as registered to avoid duplicates
    global.monitorEventHandlersRegistered = true;
    console.log("Monitor event handlers successfully registered");
  } else {
    console.error("Cannot register event handlers - client is not initialized");
  }
}

// Initialize function to set up globals
function init(clientInstance, dbInstance, configInstance) {
  client = clientInstance;
  db = dbInstance; // We'll keep this reference but not use it for storing data
  config = configInstance;
  
  // Register global event handlers
  registerGlobalEventHandlers();
  
  // Check for any active monitors and log them
  if (global.activeMonitors && global.activeMonitors.size > 0) {
    console.log(`Found ${global.activeMonitors.size} active monitors:`);
    global.activeMonitors.forEach((data, userId) => {
      console.log(`User ${userId} being monitored until ${formatDateString(data.endTime)}`);
    });
  } else {
    console.log("No active monitors found");
  }
  
  console.log("Monitor command initialized");
  
  return {
    isInitialized: true,
    activeMonitorsCount: global.activeMonitors ? global.activeMonitors.size : 0
  };
}

module.exports = {
  monitor,
  init,
  handleGlobalMessage,    
  handleGlobalVoiceStateUpdate,  
  getActiveMonitors: () => global.activeMonitors
};