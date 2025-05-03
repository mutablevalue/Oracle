// blacklistgroup.js - Command module for blacklisting Roblox groups
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { formatDateString, hasModPermission, logAction, encodeFirebasePath } = require('../../utils/utils.js');
const { COLORS } = require('../../core/config.js');

// Initialize globals that will be set when module is initialized
let client = null;
let db = null;
let config = null;

async function fetchRobloxGroupInfo(groupId) {
  try {
    const response = await axios.get(`https://groups.roblox.com/v1/groups/${groupId}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching group info for ${groupId}:`, error.message);
    return null;
  }
}

async function handleBlacklistGroup(interaction) {
  if (!hasModPermission(interaction, config)) {
    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
  }
  
  await interaction.deferReply();
  console.log("BlacklistGroup command deferred");
  
  const groupId = interaction.options.getString('groupid');
  const reason = interaction.options.getString('reason');
  const evidence = interaction.options.getString('evidence');
  const additionalComments = interaction.options.getString('comments') || 'None';
  
  try {
    // Fetch group info from Roblox API
    const groupInfo = await fetchRobloxGroupInfo(groupId);
    
    if (!groupInfo) {
      return interaction.editReply({ content: `Error: Could not find group with ID ${groupId}.` });
    }
    
    const groupName = groupInfo.name;
    
    // Create additional details for history
    const details = {
      groupName: groupName,
      evidence: evidence,
      additionalComments: additionalComments,
      manuallyAdded: true,
      addedBy: interaction.user.tag,
      addedVia: "Discord"
    };
    
    // Add group to blacklist using our database method
    await db.addBlacklistedGroup(groupId, groupName, reason, details);
    console.log("Group blacklist data written to Firebase");
    
    // Log action with color - PUSH action so use maroon
    await logAction(client, interaction, 'Group Blacklist', `Group ${groupName} (${groupId}) blacklisted for: ${reason}`, COLORS.PUSH, config);
    
    // Send confirmation with maroon color
    const embed = new EmbedBuilder()
      .setColor(COLORS.PUSH)
      .setTitle('Group Blacklisted')
      .setDescription(`Group ID: ${groupId}`)
      .addFields(
        { name: 'Issued by', value: interaction.user.tag },
        { name: 'Group Name', value: groupName },
        { name: 'Member Count', value: groupInfo.memberCount.toString() },
        { name: 'Owner', value: groupInfo.owner ? groupInfo.owner.username : 'No owner' },
        { name: 'Form of punishment', value: 'Group Blacklist' },
        { name: 'Reason', value: reason },
        { name: 'Evidence', value: evidence },
        { name: 'Any additional comments', value: additionalComments }
      );
    
    await interaction.editReply({ embeds: [embed] });
    console.log("Command blacklistgroup completed successfully");
  } catch (error) {
    console.error('Error blacklisting group:', error);
    await interaction.editReply({ content: `Error blacklisting group: ${error.message}` });
  }
}

async function handleUnblacklistGroup(interaction) {
  if (!hasModPermission(interaction, config)) {
    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
  }
  
  await interaction.deferReply();
  console.log("UnblacklistGroup command deferred");
  
  const groupId = interaction.options.getString('groupid');
  const reason = interaction.options.getString('reason');
  
  try {
    // Fetch group info from Roblox API
    const groupInfo = await fetchRobloxGroupInfo(groupId);
    let groupName = "Unknown";
    
    if (groupInfo) {
      groupName = groupInfo.name;
    }
    
    // Check if group is blacklisted
    const [isBlacklisted, blacklistReason] = await db.isGroupBlacklisted(groupId);
    
    if (!isBlacklisted) {
      return interaction.editReply({ content: `Group ${groupId} is not blacklisted.` });
    }
    
    // Remove from blacklist
    await db.removeBlacklistedGroup(groupId);
    console.log("Group removed from blacklist in Firebase");
    
    // Add to history
    const historyEntry = {
      groupId: groupId,
      groupName: groupName,
      action: "unblacklist",
      reason: reason,
      timestamp: formatDateString(),
      removedBy: interaction.user.tag
    };
    
    const historyKey = `group_unblacklist_${groupId}_${Date.now()}`;
    // Use BlacklistedGroupHistory directly 
    const historyPath = `BlacklistedGroupHistory/${historyKey}`;
    await db.put(historyPath, historyEntry);
    
    // Log action - PUSH action so use maroon
    await logAction(client, interaction, 'Group Unblacklist', `Group ${groupName} (${groupId}) removed from blacklist. Reason: ${reason}`, COLORS.PUSH, config);
    
    // Send confirmation with maroon color
    const embed = new EmbedBuilder()
      .setColor(COLORS.PUSH)
      .setTitle('Group Removed from Blacklist')
      .setDescription(`Group ID: ${groupId}`)
      .addFields(
        { name: 'Issued by', value: interaction.user.tag },
        { name: 'Group Name', value: groupName },
        { name: 'Reason for Unblacklisting', value: reason },
        { name: 'Previous Blacklist Reason', value: blacklistReason || "Unknown" },
        { name: 'Timestamp', value: formatDateString() }
      );
    
    await interaction.editReply({ embeds: [embed] });
    console.log("UnblacklistGroup command completed");
  } catch (error) {
    console.error('Error unblacklisting group:', error);
    await interaction.editReply({ content: `Error unblacklisting group: ${error.message}` });
  }
}

// Add a command to list all blacklisted groups
async function handleGetBlacklistedGroups(interaction) {
  if (!hasModPermission(interaction, config)) {
    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
  }
  
  await interaction.deferReply();
  console.log("GetBlacklistedGroups command deferred");
  
  const limit = interaction.options.getInteger('limit') || 10;
  
  try {
    // Get blacklisted groups from DB using our new method
    const groupsArray = await db.getBlacklistedGroups(limit);
    
    if (!groupsArray || groupsArray.length === 0) {
      return interaction.editReply({ content: 'No blacklisted groups found.' });
    }
    
    // Create embed for blacklist - PULL action so use blue
    const embed = new EmbedBuilder()
      .setColor(COLORS.PULL)
      .setTitle('Blacklisted Groups')
      .setDescription(`Retrieved at ${formatDateString()}`)
      .setFooter({ text: `Showing ${groupsArray.length} of ${groupsArray.length}+ entries` });
    
    // Add blacklist information
    groupsArray.forEach((group, index) => {
      embed.addFields({
        name: `${index + 1}. Group ${group.groupId}`,
        value: `**Added At**: ${group.addedAt || "Unknown"}\n` +
               `**Reason**: ${group.reason || "No reason provided"}`
      });
    });
    
    // Log action - PULL action
    await logAction(client, interaction, 'Get Blacklisted Groups', `Retrieved ${groupsArray.length} blacklisted groups`, COLORS.PULL, config);
    
    await interaction.editReply({ embeds: [embed] });
    console.log("GetBlacklistedGroups command completed");
  } catch (error) {
    console.error('Error retrieving blacklisted groups:', error);
    await interaction.editReply({ content: `Error retrieving blacklisted groups: ${error.message}` });
  }
}

// Add a command to view blacklisted group history
async function handleGetBlacklistedGroupHistory(interaction) {
  if (!hasModPermission(interaction, config)) {
    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
  }
  
  await interaction.deferReply();
  console.log("GetBlacklistedGroupHistory command deferred");
  
  const limit = interaction.options.getInteger('limit') || 10;
  
  try {
    // Get blacklisted group history
    const history = await db.getBlacklistGroupHistory(limit);
    
    if (history.length === 0) {
      return interaction.editReply({ content: 'No blacklisted group history found.' });
    }
    
    // Create embed for history - PULL action so use blue
    const embed = new EmbedBuilder()
      .setColor(COLORS.PULL)
      .setTitle('Blacklisted Group History')
      .setDescription(`Retrieved at ${formatDateString()}`)
      .setFooter({ text: `Showing ${history.length} of ${history.length}+ entries` });
    
    // Add history information
    history.forEach((entry, index) => {
      const action = entry.action === "unblacklist" ? "REMOVED from blacklist" : "ADDED to blacklist";
      
      embed.addFields({
        name: `${index + 1}. Group ${entry.groupName || "Unknown"} (${entry.groupId})`,
        value: `**Action**: ${action}\n` +
               `**By**: ${entry.addedBy || entry.removedBy || "System"}\n` +
               `**Reason**: ${entry.reason || "No reason provided"}\n` +
               `**When**: ${entry.timestamp}\n` +
               `${entry.evidence ? `**Evidence**: ${entry.evidence}\n` : ""}` +
               `${entry.additionalComments ? `**Comments**: ${entry.additionalComments}` : ""}`
      });
    });
    
    // Log action - PULL action
    await logAction(client, interaction, 'Get Blacklisted Group History', `Retrieved ${history.length} group history entries`, COLORS.PULL, config);
    
    await interaction.editReply({ embeds: [embed] });
    console.log("GetBlacklistedGroupHistory command completed");
  } catch (error) {
    console.error('Error retrieving blacklisted group history:', error);
    await interaction.editReply({ content: `Error retrieving blacklisted group history: ${error.message}` });
  }
}

// Command definition for getblacklistedgroups
const getblacklistedgroups = {
  data: new SlashCommandBuilder()
    .setName('getblacklistedgroups')
    .setDescription('Get a list of blacklisted groups')
    .addIntegerOption(option => 
      option.setName('limit')
          .setDescription('Number of entries to return (default: 10)')
          .setRequired(false)),
    execute: handleGetBlacklistedGroups
};

// Command definition for getblacklistedgrouphistory
const getblacklistedgrouphistory = {
  data: new SlashCommandBuilder()
    .setName('getblacklistedgrouphistory')
    .setDescription('Get the history of blacklisted groups')
    .addIntegerOption(option => 
      option.setName('limit')
          .setDescription('Number of entries to return (default: 10)')
          .setRequired(false)),
    execute: handleGetBlacklistedGroupHistory
};

// Command definition
const blacklistgroup = {
  data: new SlashCommandBuilder()
    .setName('blacklistgroup')
    .setDescription('Blacklist a Roblox group')
    .addStringOption(option => 
      option.setName('groupid')
        .setDescription('Roblox Group ID')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('reason')
        .setDescription('Reason for blacklisting')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('evidence')
        .setDescription('Evidence/proof (links, descriptions)')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('comments')
        .setDescription('Any additional comments')
        .setRequired(false)),
  execute: handleBlacklistGroup
};

// Command definition for unblacklist
const unblacklistgroup = {
  data: new SlashCommandBuilder()
    .setName('unblacklistgroup')
    .setDescription('Remove a Roblox group from the blacklist')
    .addStringOption(option => 
      option.setName('groupid')
        .setDescription('Roblox Group ID')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('reason')
        .setDescription('Reason for unblacklisting')
        .setRequired(true)),
  execute: handleUnblacklistGroup
};

// Initialize function to set up globals
function init(clientInstance, dbInstance, configInstance) {
  client = clientInstance;
  db = dbInstance;
  config = configInstance;
  console.log("BlacklistGroup command initialized");
}

module.exports = {
  blacklistgroup,
  unblacklistgroup,
  getblacklistedgroups,
  getblacklistedgrouphistory,
  init
};