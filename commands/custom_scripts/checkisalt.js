// checkisalt.js - Command module for checking if a Roblox user is an alt account
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { formatDateString, hasModPermission, logAction, encodeFirebasePath } = require('../../utils/utils.js');
const { COLORS } = require('../../core/config.js');

const ALT_DETECTION_CONFIG = {
  SUSPICION_THRESHOLD: 70,     
  MIN_AGE_DAYS: 30,            
  SAFE_AGE_DAYS: 180,          
  AGE_MAX_SCORE: 30,           
  AGE_WEIGHT: 1.0,             
  
  ACCESSORIES_PER_YEAR: 5,     
  ACCESSORIES_WEIGHT: 1.0,     
  
  BADGES_PER_YEAR: 3,         
  BADGES_WEIGHT: 1.0,          
  
  INVENTORY_WEIGHT: 1.0,       
  
  FOLLOWER_WEIGHT: 1.0,        
  FOLLOWING_WEIGHT: 1.0,       
  SOCIAL_WEIGHT: 1.0,          
  
  GROUPS_WEIGHT: 1.0,          
  PREMIUM_WEIGHT: 1.0          
};

// Initialize globals that will be set when module is initialized
let client = null;
let db = null;
let config = null;

// Helper functions for Roblox API calls
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

async function fetchRobloxUserAccessories(userId) {
  try {
    // Match the Roblox implementation's limit of 10
    const response = await axios.get(`https://inventory.roblox.com/v2/users/${userId}/inventory/8?limit=10`);
    return response.data.data || [];
  } catch (error) {
    console.error(`Error fetching accessories for ${userId}:`, error.message);
    return null;
  }
}

async function fetchRobloxUserBadges(userId) {
  try {
    const response = await axios.get(`https://badges.roblox.com/v1/users/${userId}/badges`);
    return response.data.data || [];
  } catch (error) {
    console.error(`Error fetching badges for ${userId}:`, error.message);
    return null;
  }
}

async function fetchRobloxSocialInfo(userId) {
  try {
    // Fetch followers count
    const followersResponse = await axios.get(`https://friends.roblox.com/v1/users/${userId}/followers/count`);
    const followerCount = followersResponse.data.count;
    
    // Fetch following count
    const followingResponse = await axios.get(`https://friends.roblox.com/v1/users/${userId}/followings/count`);
    const followingCount = followingResponse.data.count;
    
    return {
      followerCount,
      followingCount
    };
  } catch (error) {
    console.error(`Error fetching social info for ${userId}:`, error.message);
    return null;
  }
}

async function fetchRobloxUserGroups(userId) {
  try {
    const response = await axios.get(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
    return response.data.data || [];
  } catch (error) {
    console.error(`Error fetching group info for ${userId}:`, error.message);
    return null;
  }
}

function calculateAccountAge(createdDate) {
  const created = new Date(createdDate);
  const now = new Date();
  const diffTime = Math.abs(now - created);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// Main analysis function - rewritten to exactly match Roblox implementation
async function analyzeUserForAltIndications(userId) {
  console.log(`Analyzing user ${userId} for alt account indications`);
  
  // Initialize results
  const result = {
    userId: userId,
    score: 0,
    reasons: [],
    report: "",
    isAlt: false,
    username: "Unknown"
  };
  
  const reportLines = [];
  reportLines.push(`Alt Account Analysis for User ID: ${userId}`);
  reportLines.push("-----------------------------------");
  
  try {
    // Fetch basic user info
    const userInfo = await fetchRobloxUserInfo(userId);
    
    if (!userInfo) {
      reportLines.push("Error: Could not fetch user information");
      result.report = reportLines.join("\n");
      return result;
    }
    
    result.username = userInfo.name;
    reportLines.push(`Username: ${userInfo.name}`);
    
    // Account Age Analysis
    const accountAgeDays = calculateAccountAge(userInfo.created);
    let ageScore = 0;
    
    if (accountAgeDays < ALT_DETECTION_CONFIG.MIN_AGE_DAYS) {
      ageScore = Math.floor(((ALT_DETECTION_CONFIG.MIN_AGE_DAYS - accountAgeDays) / ALT_DETECTION_CONFIG.MIN_AGE_DAYS) * ALT_DETECTION_CONFIG.AGE_MAX_SCORE);
      result.reasons.push(`Very new account (${accountAgeDays} days old)`);
    } else if (accountAgeDays < ALT_DETECTION_CONFIG.SAFE_AGE_DAYS) {
      const factor = (ALT_DETECTION_CONFIG.SAFE_AGE_DAYS - accountAgeDays) / (ALT_DETECTION_CONFIG.SAFE_AGE_DAYS - ALT_DETECTION_CONFIG.MIN_AGE_DAYS);
      ageScore = Math.floor(factor * (ALT_DETECTION_CONFIG.AGE_MAX_SCORE / 2));
      result.reasons.push(`Moderately new account (${accountAgeDays} days old)`);
    }
    
    result.score += ageScore * ALT_DETECTION_CONFIG.AGE_WEIGHT;
    reportLines.push(`Account Age: ${accountAgeDays} days (Age Score: ${ageScore})`);
    reportLines.push("-----");
    
    // Inventory Analysis
    reportLines.push("Inventory Analysis:");
    
    // Accessories Analysis
    const accessories = await fetchRobloxUserAccessories(userId);
    const accessoriesCount = accessories ? accessories.length : 0;
    let accessoriesScore = 0;
    
    const yearsActive = Math.max(accountAgeDays, 1) / 365.0;
    const expectedAccessories = Math.floor(yearsActive * ALT_DETECTION_CONFIG.ACCESSORIES_PER_YEAR);
    
    if (accessoriesCount < expectedAccessories) {
      const deficit = expectedAccessories - accessoriesCount;
      // Calculate score exactly as in Roblox implementation (integer arithmetic)
      accessoriesScore = Math.min(100, Math.floor((deficit / Math.max(expectedAccessories, 1)) * 100));
      result.reasons.push(`Sparse accessories (${accessoriesCount} vs ${expectedAccessories} expected)`);
    }
    
    result.score += accessoriesScore * ALT_DETECTION_CONFIG.ACCESSORIES_WEIGHT;
    reportLines.push(`Accessories - Count: ${accessoriesCount}; Expected: ${expectedAccessories}; Score: ${accessoriesScore}`);
    
    // Badges Analysis
    const badges = await fetchRobloxUserBadges(userId);
    const badgesCount = badges ? badges.length : 0;
    let badgesScore = 0;
    
    const expectedBadges = Math.floor(yearsActive * ALT_DETECTION_CONFIG.BADGES_PER_YEAR);
    
    if (badgesCount < expectedBadges) {
      const deficit = expectedBadges - badgesCount;
      badgesScore = Math.min(100, Math.floor((deficit / Math.max(expectedBadges, 1)) * 100));
      result.reasons.push(`Sparse badges (${badgesCount} vs ${expectedBadges} expected)`);
    }
    
    result.score += badgesScore * ALT_DETECTION_CONFIG.BADGES_WEIGHT;
    reportLines.push(`Badges - Count: ${badgesCount}; Expected: ${expectedBadges}; Score: ${badgesScore}`);
    reportLines.push("-----");
    
    // Social Analysis
    reportLines.push("Social Analysis:");
    
    // Fetch social metrics
    const socialInfo = await fetchRobloxSocialInfo(userId);
    let followerScore = 0;
    let followingScore = 0;
    
    if (socialInfo) {
      if (accountAgeDays > 90 && socialInfo.followerCount < 3) {
        followerScore = 50;
        result.reasons.push(`Very low follower count (${socialInfo.followerCount} followers)`);
      }
      
      if (socialInfo.followerCount > 50) {
        followerScore = -10; // Negative score = less likely to be alt
      }
      
      if (socialInfo.followingCount > 0 && socialInfo.followerCount === 0) {
        followingScore = 20;
        result.reasons.push(`Follows ${socialInfo.followingCount} users but has 0 followers`);
      }
      
      reportLines.push(`Followers: ${socialInfo.followerCount}; Score: ${followerScore}`);
      reportLines.push(`Following: ${socialInfo.followingCount}; Score: ${followingScore}`);
      
      result.score += followerScore * ALT_DETECTION_CONFIG.FOLLOWER_WEIGHT;
      result.score += followingScore * ALT_DETECTION_CONFIG.FOLLOWING_WEIGHT;
    } else {
      reportLines.push("Could not fetch social information");
    }
    reportLines.push("-----");
    
    // Group Analysis
    const groupInfo = await fetchRobloxUserGroups(userId);
    let groupsScore = 0;
    
    if (groupInfo) {
      let totalGroups = 0;
      let lowRankGroups = 0;
      
      for (const group of groupInfo) {
        totalGroups++;
        const role = group.role;
        const isOwner = role && role.rank === 255;
        
        if (!isOwner) {
          if (role && role.rank <= 1) {
            lowRankGroups++;
          }
        } else {
          totalGroups--; // Exclude owned groups from count (match Roblox logic)
        }
      }
      
      if (totalGroups > 0 && lowRankGroups === totalGroups) {
        groupsScore = 80;
        result.reasons.push(`Lowest rank in all ${totalGroups} groups`);
      } else if (totalGroups > 0) {
        const fraction = lowRankGroups / totalGroups;
        if (fraction > 0.5) {
          groupsScore = 40;
          result.reasons.push(`Low rank in ${Math.floor(fraction * 100)}% of groups`);
        }
      }
      
      result.score += groupsScore * ALT_DETECTION_CONFIG.GROUPS_WEIGHT;
      reportLines.push(`Groups - Total Groups: ${totalGroups}; Low Rank Groups: ${lowRankGroups}; Groups Score: ${groupsScore}`);
    } else {
      reportLines.push("Could not fetch group information");
    }
    reportLines.push("-----");
    
    // Premium Analysis
    const hasPremium = userInfo.isPremium || false;
    let premiumScore = 0;
    
    if (hasPremium) {
      premiumScore = -50; // Premium members are less likely to be alts
      result.reasons.push("Has Premium membership (likely main account)");
    }
    
    result.score += premiumScore * ALT_DETECTION_CONFIG.PREMIUM_WEIGHT;
    reportLines.push(`Premium: ${hasPremium ? "Yes" : "No"} (Score: ${premiumScore})`);
    
    // Cap score at 0-100 range and round to integer (match Roblox implementation)
    if (result.score < 0) result.score = 0;
    if (result.score > 100) result.score = 100;
    
    // Round score to integer
    result.score = Math.floor(result.score);
    
    // Determine if alt based on threshold
    result.isAlt = result.score >= ALT_DETECTION_CONFIG.SUSPICION_THRESHOLD;
    
    reportLines.push(`Total Suspicion Score: ${result.score}`);
    reportLines.push("-----");
    
    if (result.reasons.length > 0) {
      reportLines.push("Config Settings Used:");
      result.reasons.forEach(reason => {
        reportLines.push(`  - ${reason}`);
      });
    }
    
    result.report = reportLines.join("\n");
    return result;
  } catch (error) {
    console.error('Error analyzing user:', error);
    reportLines.push(`Error during analysis: ${error.message}`);
    result.report = reportLines.join("\n");
    return result;
  }
}

// Command handler
async function handleCheckIsAlt(interaction) {
  if (!hasModPermission(interaction, config)) {
    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
  }
  
  await interaction.deferReply();
  console.log("CheckIsAlt command deferred");
  
  const userId = interaction.options.getString('userid');
  
  try {
    // Ensure player exists first
    await db.ensurePlayerExists(userId);
    
    // Send initial status message
    await interaction.editReply({ content: `Analyzing user ${userId} for alt account indications. This may take a moment...` });
    
    // Analyze the user
    const analysis = await analyzeUserForAltIndications(userId);
    
    // Update the database based on the analysis
    if (analysis.isAlt) {
      // Set alt account flag
      const altData = {
        value: true,
        detectedAt: formatDateString(),
        score: analysis.score,
        details: {
          analysisMethod: "Discord Bot Analysis",
          addedBy: interaction.user.tag,
          notes: "Automatically analyzed by Discord command",
          report: analysis.report,
          reasons: analysis.reasons
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
              details: "Automatically analyzed by Discord command",
              score: analysis.score,
              reasons: analysis.reasons,
              via: "Discord"
            }
          }
        }
      };
      
      const flagPath = `Game/Players/${encodeFirebasePath(userId)}/Flags/AltAccount`;
      await db.put(flagPath, flagData);
      
      // Log action - PUSH action so use maroon
      await logAction(client, interaction, 'Alt Account Detection', `User ${userId} (${analysis.username}) detected as alt account. Score: ${analysis.score}`, COLORS.PUSH, config);
      
      // Send confirmation with warning color (fixed color issue)
      const embed = new EmbedBuilder()
        .setColor(parseInt(COLORS.WARNING.replace('#', ''), 16))
        .setTitle('Alt Account Detected')
        .setDescription(`User ID: ${userId} (${analysis.username})`)
        .addFields(
          { name: 'Analysis by', value: interaction.user.tag },
          { name: 'Suspicion Score', value: `${analysis.score}/100` },
          { name: 'Is Alt?', value: 'Yes' },
          { name: 'Timestamp', value: formatDateString() }
        );
      
      // Add reasons if there are any
      if (analysis.reasons.length > 0) {
        embed.addFields({ 
          name: 'Reasons', 
          value: analysis.reasons.join('\n') || "No specific reasons" 
        });
      }
      
      // Add report excerpt (first few lines) with option to view full details
      const reportExcerpt = analysis.report.split('\n').slice(0, 10).join('\n');
      embed.addFields({ 
        name: 'Analysis Report (First 10 lines)', 
        value: reportExcerpt + '\n\n*Use `/getevidence ' + userId + '` to view full details*' 
      });
      
      await interaction.editReply({ embeds: [embed] });
    } else {
      // User is NOT an alt account
      const altData = {
        value: false,
        analyzedAt: formatDateString(),
        score: analysis.score,
        details: {
          analysisMethod: "Discord Bot Analysis",
          addedBy: interaction.user.tag,
          notes: "Automatically analyzed by Discord command",
          report: analysis.report
        }
      };
      
      const altPath = `Game/Players/${encodeFirebasePath(userId)}/IsAlt`;
      await db.put(altPath, altData);
      console.log("User marked as NOT alt in Firebase");
      
      // Log action - INFO action so use blue
      await logAction(client, interaction, 'Alt Account Check', `User ${userId} (${analysis.username}) NOT detected as alt account. Score: ${analysis.score}`, COLORS.PULL, config);
      
      // Send confirmation with info color (fixed color issue)
      const embed = new EmbedBuilder()
        .setColor(parseInt(COLORS.PULL.replace('#', ''), 16))
        .setTitle('Alt Account Check')
        .setDescription(`User ID: ${userId} (${analysis.username})`)
        .addFields(
          { name: 'Analysis by', value: interaction.user.tag },
          { name: 'Suspicion Score', value: `${analysis.score}/100` },
          { name: 'Is Alt?', value: 'No' },
          { name: 'Timestamp', value: formatDateString() }
        );
      
      // Add report excerpt (first few lines) with option to view full details
      const reportExcerpt = analysis.report.split('\n').slice(0, 10).join('\n');
      embed.addFields({ 
        name: 'Analysis Report (First 10 lines)', 
        value: reportExcerpt + '\n\n*Use `/getevidence ' + userId + '` to view full details*' 
      });
      
      await interaction.editReply({ embeds: [embed] });
    }
    
    console.log("CheckIsAlt command completed");
  } catch (error) {
    console.error('Error checking if user is alt account:', error);
    await interaction.editReply({ content: `Error checking if user is alt account: ${error.message}` });
  }
}

// Export command definition
const checkisalt = {
  data: new SlashCommandBuilder()
    .setName('checkisalt')
    .setDescription('Check if a Roblox user is likely an alt account')
    .addStringOption(option => 
      option.setName('userid')
        .setDescription('Roblox User ID')
        .setRequired(true)),
  execute: handleCheckIsAlt
};

// Initialize function to set up globals
function init(clientInstance, dbInstance, configInstance) {
  client = clientInstance;
  db = dbInstance;
  config = configInstance;
  console.log("CheckIsAlt command initialized");
}

module.exports = {
  checkisalt,
  init
};