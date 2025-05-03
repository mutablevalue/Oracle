// Commands module for OracleAntiCheat Bot
const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { formatDateString, hasModPermission, logAction, encodeFirebasePath } = require('../utils/utils');
const { COLORS } = require('../core/config');

// Import commands
const { checkisalt, init: initCheckIsAlt } = require('./custom_scripts/checkisalt');
const { blacklistgroup, unblacklistgroup, getblacklistedgroups, init: initBlacklistGroup } = require('./custom_scripts/blacklistgroup');
// Import the monitor command but handle errors gracefully
let monitor = null;
let initMonitor = null;
try {
  const monitorModule = require('./custom_scripts/monitor');
  monitor = monitorModule.monitor;
  initMonitor = monitorModule.init;
  console.log("Monitor module loaded successfully");
} catch (error) {
  console.error("Could not load monitor module:", error.message);
}

// Initialize commands module
let client = null;
let db = null;
let config = null;

// Command definitions with builders
const commands = {
  blacklist: {
    data: new SlashCommandBuilder()
      .setName('blacklist')
      .setDescription('Blacklist a user')
      .addStringOption(option => 
        option.setName('userid')
          .setDescription('Roblox User ID')
          .setRequired(true))
      .addStringOption(option => 
        option.setName('robloxusername')
          .setDescription("Offender's Roblox username")
          .setRequired(true))
      .addStringOption(option => 
        option.setName('reason')
          .setDescription('Reason for blacklisting')
          .setRequired(true))
      .addStringOption(option => 
        option.setName('evidence')
          .setDescription('Evidence/proof (links, descriptions)')
          .setRequired(true))
      // Non-required options AFTER all required options
      .addStringOption(option => 
        option.setName('discordid')
          .setDescription("Offender's Discord ID (if known)")
          .setRequired(false))
      .addStringOption(option => 
        option.setName('punishmentlength')
          .setDescription('Length of punishment (default: Permanent)')
          .setRequired(false))
      .addStringOption(option => 
        option.setName('appealable')
          .setDescription('Is this punishment appealable? (Y/N)')
          .addChoices(
            { name: 'Yes', value: 'Y' },
            { name: 'No', value: 'N' }
          )
          .setRequired(false))
      .addStringOption(option => 
        option.setName('comments')
          .setDescription('Any additional comments')
          .setRequired(false)),
    execute: handleBlacklist
  },
  
  unblacklist: {
    data: new SlashCommandBuilder()
      .setName('unblacklist')
      .setDescription('Remove a user from the blacklist')
      .addStringOption(option => 
        option.setName('userid')
          .setDescription('Roblox User ID')
          .setRequired(true))
      .addStringOption(option => 
        option.setName('reason')
          .setDescription('Reason for unblacklisting')
          .setRequired(true)),
    execute: handleUnblacklist
  },
  
  setalt: {
    data: new SlashCommandBuilder()
      .setName('setalt')
      .setDescription('Mark a user as an alt account')
      .addStringOption(option => 
        option.setName('userid')
          .setDescription('Roblox User ID')
          .setRequired(true))
      .addStringOption(option => 
        option.setName('details')
          .setDescription('Details about the alt account (optional)')
          .setRequired(false)),
    execute: handleSetAlt
  },
  
  getevidence: {
    data: new SlashCommandBuilder()
      .setName('getevidence')
      .setDescription('Retrieve all information for a user')
      .addStringOption(option => 
        option.setName('userid')
          .setDescription('Roblox User ID')
          .setRequired(true)),
    execute: handleGetEvidence
  },
  
  getblacklist: {
    data: new SlashCommandBuilder()
      .setName('getblacklist')
      .setDescription('Get a list of blacklisted users')
      .addIntegerOption(option => 
        option.setName('limit')
            .setDescription('Number of entries to return (default: 10)')
            .setRequired(false)),
      execute: handleGetBlacklist
  },
  
  // Add imported commands
  checkisalt: checkisalt,
  blacklistgroup: blacklistgroup,
  unblacklistgroup: unblacklistgroup,
  getblacklistedgroups: getblacklistedgroups
};

// Add monitor command if loaded successfully
if (monitor) {
  commands.monitor = monitor;
}
// Command Handlers
async function handleBlacklist(interaction) {
  console.log("Starting blacklist command execution");
  
  if (!hasModPermission(interaction, config)) {
    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
  }
  
  // Reply immediately to acknowledge the command
  await interaction.deferReply();
  console.log("Command deferred");
  
  const userId = interaction.options.getString('userid');
  const robloxUsername = interaction.options.getString('robloxusername');
  const reason = interaction.options.getString('reason');
  const evidence = interaction.options.getString('evidence');
  
  // Additional options 
  const discordId = interaction.options.getString('discordid') || userId;
  const punishmentLength = interaction.options.getString('punishmentlength') || 'Permanent';
  const appealable = interaction.options.getString('appealable') || 'N';
  const additionalComments = interaction.options.getString('comments') || 'None';
  
  console.log(`Blacklisting user ${userId} for reason: ${reason}`);
  
  try {
    // Ensure player exists first
    await db.ensurePlayerExists(userId);
    console.log(`Ensured player ${userId} exists in database`);
    
    // Create blacklist data structure
    const blacklistData = {
      value: true,
      updatedAt: formatDateString(),
      reason: reason,
      details: {
        playerName: robloxUsername,
        discordId: discordId,
        reason: reason,
        evidence: evidence,
        punishmentLength: punishmentLength,
        appealable: appealable,
        additionalComments: additionalComments,
        manuallyAdded: true,
        addedBy: interaction.user.tag,
        addedVia: "Discord"
      }
    };
    
    const path = `Game/Players/${encodeFirebasePath(userId)}/Blacklisted`;
    console.log("Writing to Firebase:", path);
    
    // Update Firebase using REST API
    await db.put(path, blacklistData);
    console.log("Blacklist data written to Firebase");
    
    // Also update LastFlagged timestamp
    const timestampPath = `Game/Players/${encodeFirebasePath(userId)}/LastFlagged`;
    await db.put(timestampPath, {
      value: formatDateString()
    });
    console.log("LastFlagged timestamp updated");
    
    // Add to blacklist history
    const historyEntry = {
      userId: userId,
      playerName: robloxUsername,
      discordId: discordId,
      reason: reason,
      timestamp: formatDateString(),
      addedBy: interaction.user.tag,
      evidence: evidence,
      punishmentLength: punishmentLength,
      appealable: appealable,
      additionalComments: additionalComments
    };
    
    const historyKey = `${userId}_${Date.now()}`;
    const historyPath = `Game/BlacklistHistory/${historyKey}`;
    await db.put(historyPath, historyEntry);
    console.log("Added to blacklist history");
    
    // Log action with color - PUSH action so use maroon
    await logAction(client, interaction, 'Blacklist', `User ${userId} blacklisted for: ${reason}`, COLORS.PUSH, config);
    
    // Send confirmation with maroon color
    const embed = new EmbedBuilder()
      .setColor(COLORS.PUSH)
      .setTitle('User Blacklisted')
      .setDescription(`User ID: ${userId}`)
      .addFields(
        { name: 'Issued by', value: interaction.user.tag },
        { name: "Offender's Roblox username", value: robloxUsername },
        { name: "Offender's Discord ID", value: discordId },
        { name: 'Form of punishment', value: 'Blacklist' },
        { name: 'Punishment Length', value: punishmentLength },
        { name: 'Appealable?', value: appealable },
        { name: 'Reason', value: reason },
        { name: 'Evidence', value: evidence },
        { name: 'Any additional comments', value: additionalComments }
      );
    
    await interaction.editReply({ embeds: [embed] });
    console.log("Command response sent successfully");
    console.log("Command blacklist completed successfully");
  } catch (error) {
    console.error('Error blacklisting user:', error);
    await interaction.editReply({ content: `Error blacklisting user: ${error.message}` });
  }
}

async function handleUnblacklist(interaction) {
  if (!hasModPermission(interaction, config)) {
    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
  }
  
  await interaction.deferReply();
  console.log("Unblacklist command deferred");
  
  const userId = interaction.options.getString('userid');
  const reason = interaction.options.getString('reason');
  
  try {
    // Ensure player exists first
    await db.ensurePlayerExists(userId);
    
    // Check if user is blacklisted
    const blacklistedData = await db.isUserBlacklisted(userId);
    if (!blacklistedData) {
      return interaction.editReply({ content: `User ${userId} is not blacklisted.` });
    }
    
    // Update blacklist status
    const unblacklistData = {
      value: false,
      updatedAt: formatDateString(),
      previousReason: blacklistedData.reason || "Unknown",
      unblacklistReason: reason,
      unblacklistedBy: interaction.user.tag
    };
    
    const path = `Game/Players/${encodeFirebasePath(userId)}/Blacklisted`;
    await db.put(path, unblacklistData);
    console.log("User unblacklisted in Firebase");
    
    // Get original blacklist details if available
    let robloxUsername = "Unknown";
    let discordId = userId;
    
    if (blacklistedData.details) {
      robloxUsername = blacklistedData.details.playerName || "Unknown";
      discordId = blacklistedData.details.discordId || userId;
    }
    
    // Log action - PUSH action so use maroon
    await logAction(client, interaction, 'Unblacklist', `User ${userId} removed from blacklist. Reason: ${reason}`, COLORS.PUSH, config);
    
    // Send confirmation with maroon color
    const embed = new EmbedBuilder()
      .setColor(COLORS.PUSH)
      .setTitle('User Removed from Blacklist')
      .setDescription(`User ID: ${userId}`)
      .addFields(
        { name: 'Issued by', value: interaction.user.tag },
        { name: "Offender's Roblox username", value: robloxUsername },
        { name: "Offender's Discord ID", value: discordId },
        { name: 'Form of punishment', value: 'Unblacklist' },
        { name: 'Reason for Unblacklisting', value: reason },
        { name: 'Previous Blacklist Reason', value: blacklistedData.reason || "Unknown" },
        { name: 'Timestamp', value: formatDateString() },
        { name: 'Any additional comments', value: 'None' }
      );
    
    await interaction.editReply({ embeds: [embed] });
    console.log("Unblacklist command completed");
  } catch (error) {
    console.error('Error unblacklisting user:', error);
    await interaction.editReply({ content: `Error unblacklisting user: ${error.message}` });
  }
}

async function handleSetAlt(interaction) {
  if (!hasModPermission(interaction, config)) {
    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
  }
  
  await interaction.deferReply();
  console.log("SetAlt command deferred");
  
  const userId = interaction.options.getString('userid');
  const details = interaction.options.getString('details') || 'Manually identified as alt account';
  
  try {
    // Ensure player exists first
    await db.ensurePlayerExists(userId);
    
    // Set alt account flag
    const altData = {
      value: true,
      detectedAt: formatDateString(),
      details: {
        manuallyAdded: true,
        addedBy: interaction.user.tag,
        notes: details,
        addedVia: "Discord"
      }
    };
    
    const altPath = `Game/Players/${encodeFirebasePath(userId)}/IsAlt`;
    await db.put(altPath, altData);
    console.log("Alt flag set in Firebase");
    
    // Also update LastFlagged timestamp
    const timestampPath = `Game/Players/${encodeFirebasePath(userId)}/LastFlagged`;
    await db.put(timestampPath, {
      value: formatDateString()
    });
    
    // Add a flag entry
    const flagData = {
      count: 1,
      lastFlagged: formatDateString(),
      Reports: {
        [`discord_${Date.now()}`]: {
          flagTime: formatDateString(),
          reportData: {
            reporter: interaction.user.tag,
            details: details,
            via: "Discord"
          }
        }
      }
    };
    
    const flagPath = `Game/Players/${encodeFirebasePath(userId)}/Flags/AltAccount`;
    await db.put(flagPath, flagData);
    
    // Log action - PUSH action so use maroon
    await logAction(client, interaction, 'Set Alt Account', `User ${userId} marked as alt account: ${details}`, COLORS.PUSH, config);
    
    // Send confirmation with warning color
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle('User Marked as Alt Account')
      .setDescription(`User ID: ${userId}`)
      .addFields(
        { name: 'Issued by', value: interaction.user.tag },
        { name: "Offender's Roblox username", value: "Unknown" },
        { name: "Offender's Discord ID", value: userId },
        { name: 'Form of punishment', value: 'Alt Account Flag' },
        { name: 'Details', value: details },
        { name: 'Timestamp', value: formatDateString() },
        { name: 'Any additional comments', value: 'None' }
      );
    
    await interaction.editReply({ embeds: [embed] });
    console.log("SetAlt command completed");
  } catch (error) {
    console.error('Error marking user as alt account:', error);
    await interaction.editReply({ content: `Error marking user as alt account: ${error.message}` });
  }
}

async function handleGetEvidence(interaction) {
  if (!hasModPermission(interaction, config)) {
    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
  }
  
  await interaction.deferReply();
  console.log("GetEvidence command deferred");
  
  const userId = interaction.options.getString('userid');
  
  try {
    // Get all user data
    const playerPath = `Game/Players/${encodeFirebasePath(userId)}`;
    const playerData = await db.get(playerPath);
    
    if (!playerData) {
      return interaction.editReply({ content: `No data found for user ${userId}.` });
    }
    
    // Create embed for all user information - PULL action so use blue
    const embed = new EmbedBuilder()
      .setColor(COLORS.PULL)
      .setTitle(`All Information for User ${userId}`)
      .setDescription(`Retrieved at ${formatDateString()}`);
    
    // Add blacklist status
    if (playerData.Blacklisted) {
      const blacklistStatus = playerData.Blacklisted.value === true ? 
        `✅ BLACKLISTED - Reason: ${playerData.Blacklisted.reason || "No reason provided"}` : 
        "❌ Not blacklisted";
      
      embed.addFields({ name: 'Blacklist Status', value: blacklistStatus });
      
      if (playerData.Blacklisted.details) {
        const details = typeof playerData.Blacklisted.details === 'object' ? 
          JSON.stringify(playerData.Blacklisted.details, null, 2) : 
          playerData.Blacklisted.details;
        
        embed.addFields({ name: 'Blacklist Details', value: `\`\`\`json\n${details.substring(0, 1000)}\`\`\`` });
      }
    } else {
      embed.addFields({ name: 'Blacklist Status', value: "❌ Not blacklisted" });
    }
    
    // Add alt account status
    if (playerData.IsAlt) {
      const altStatus = playerData.IsAlt.value === true ? 
        `✅ Marked as ALT ACCOUNT - Added: ${playerData.IsAlt.detectedAt || "Unknown date"}` : 
        "❌ Not marked as alt account";
      
      embed.addFields({ name: 'Alt Account Status', value: altStatus });
      
      if (playerData.IsAlt.details) {
        const details = typeof playerData.IsAlt.details === 'object' ? 
          JSON.stringify(playerData.IsAlt.details, null, 2) : 
          playerData.IsAlt.details;
        
        embed.addFields({ name: 'Alt Account Details', value: `\`\`\`json\n${details.substring(0, 1000)}\`\`\`` });
      }
    } else {
      embed.addFields({ name: 'Alt Account Status', value: "❌ Not marked as alt account" });
    }
    
    // Add flag information
    if (playerData.Flags && Object.keys(playerData.Flags).length > 0) {
      for (const [flagType, flagData] of Object.entries(playerData.Flags)) {
        const flagCount = flagData.count || 0;
        const lastFlagged = flagData.lastFlagged || "Unknown";
        
        embed.addFields({ name: `Flag: ${flagType} (${flagCount} flags)`, value: `Last flagged: ${lastFlagged}` });
        
        // Add report details
        if (flagData.Reports && Object.keys(flagData.Reports).length > 0) {
          const reportDetails = [];
          
          for (const [reportId, report] of Object.entries(flagData.Reports)) {
            const reportDataStr = report.reportData ? 
              typeof report.reportData === 'object' ? 
                JSON.stringify(report.reportData, null, 2) : report.reportData 
              : "No details";
              
            reportDetails.push(`**Report Time**: ${report.flagTime || "Unknown"}\n**Details**: ${reportDataStr.substring(0, 200)}`);
            
            // Discord embed has 1024 char limit per field
            if (reportDetails.join('\n').length > 900) {
              reportDetails.push('...(more reports available)');
              break;
            }
          }
          
          embed.addFields({ name: `${flagType} Reports`, value: reportDetails.join('\n\n') || "No detailed reports" });
        }
      }
    } else {
      embed.addFields({ name: 'Flags', value: "No flags found" });
    }
    
    // Add any other available player data
    const otherFields = [];
    
    if (playerData.CreatedAt) {
      otherFields.push(`**Created At**: ${playerData.CreatedAt}`);
    }
    
    if (playerData.LastUpdated) {
      otherFields.push(`**Last Updated**: ${playerData.LastUpdated}`);
    }
    
    if (playerData.LastFlagged && playerData.LastFlagged.value) {
      otherFields.push(`**Last Flagged**: ${playerData.LastFlagged.value}`);
    }
    
    if (playerData.UserId) {
      otherFields.push(`**User ID**: ${playerData.UserId}`);
    }
    
    if (otherFields.length > 0) {
      embed.addFields({ name: 'Account Information', value: otherFields.join('\n') });
    }
    
    // Log action - PULL action
    await logAction(client, interaction, 'Get Evidence', `All information retrieved for user ${userId}`, COLORS.PULL, config);
    
    await interaction.editReply({ embeds: [embed] });
    console.log("GetEvidence command completed");
  } catch (error) {
    console.error('Error retrieving evidence:', error);
    await interaction.editReply({ content: `Error retrieving evidence: ${error.message}` });
  }
}

async function handleGetBlacklist(interaction) {
  if (!hasModPermission(interaction, config)) {
    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
  }
  
  await interaction.deferReply();
  console.log("GetBlacklist command deferred");
  
  const limit = interaction.options.getInteger('limit') || 10;
  
  try {
    // Get blacklist history
    const history = await db.getBlacklistHistory(limit);
    
    if (history.length === 0) {
      return interaction.editReply({ content: 'No blacklisted users found.' });
    }
    
    // Create embed for blacklist - PULL action so use blue
    const embed = new EmbedBuilder()
      .setColor(COLORS.PULL)
      .setTitle('Recent Blacklisted Users')
      .setDescription(`Retrieved at ${formatDateString()}`)
      .setFooter({ text: `Showing ${history.length} of ${history.length}+ entries` });
    
    // Add blacklist information with enhanced format
    history.forEach((entry, index) => {
      embed.addFields({
        name: `${index + 1}. User ${entry.userId}`,
        value: `**Issued by**: ${entry.addedBy || "System"}\n` +
               `**Offender's Roblox username**: ${entry.playerName || "Unknown"}\n` +
               `**Offender's Discord ID**: ${entry.discordId || entry.userId}\n` +
               `**Form of punishment**: Blacklist\n` +
               `**Punishment Length**: ${entry.punishmentLength || "Permanent"}\n` +
               `**Appealable?**: ${entry.appealable || "N"}\n` +
               `**Reason**: ${entry.reason || "No reason provided"}\n` +
               `**Evidence**: ${entry.evidence || "None provided"}\n` +
               `**When**: ${entry.timestamp}\n` +
               `**Any additional comments**: ${entry.additionalComments || "None"}`
      });
    });
    
    // Log action - PULL action
    await logAction(client, interaction, 'Get Blacklist', `Retrieved ${history.length} blacklisted users`, COLORS.PULL, config);
    
    await interaction.editReply({ embeds: [embed] });
    console.log("GetBlacklist command completed");
  } catch (error) {
    console.error('Error retrieving blacklist:', error);
    await interaction.editReply({ content: `Error retrieving blacklist: ${error.message}` });
  }
}

// Initialize commands module
function initCommands(clientInstance, dbInstance, configInstance) {
  client = clientInstance;
  db = dbInstance;
  config = configInstance;
  
  // Initialize the imported commands
  initCheckIsAlt(clientInstance, dbInstance, configInstance);
  initBlacklistGroup(clientInstance, dbInstance, configInstance);
  initMonitor(clientInstance, dbInstance, configInstance); // Initialize the monitor command
  
  console.log('Commands module initialized');
  return commands;
}

module.exports = {
  commands,
  initCommands
};