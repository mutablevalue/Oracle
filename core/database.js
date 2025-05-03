// Firebase database interactions for OracleAntiCheat Bot
const axios = require('axios');
const { formatDateString, encodeFirebasePath } = require('../utils/utils.js');

class FirebaseAPI {
  constructor(baseURL, authToken) {
    this.baseURL = baseURL;
    this.authToken = authToken;
  }
  

  buildURL(path) {
    // Make sure path doesn't start with a slash
    if (path.startsWith('/')) {
      path = path.substring(1);
    }
    return `${this.baseURL}/${path}.json?auth=${this.authToken}`;
  }
  
  // GET data from Firebase
  async get(path) {
    try {
      const response = await axios.get(this.buildURL(path));
      return response.data;
    } catch (error) {
      console.error(`Firebase GET error (${path}):`, error.message);
      throw error;
    }
  }
  
  // PUT data to Firebase (replace)
  async put(path, data) {
    try {
      const response = await axios.put(this.buildURL(path), data);
      return response.data;
    } catch (error) {
      console.error(`Firebase PUT error (${path}):`, error.message);
      throw error;
    }
  }
  
  // PATCH data to Firebase (update)
  async patch(path, data) {
    try {
      const response = await axios.patch(this.buildURL(path), data);
      return response.data;
    } catch (error) {
      console.error(`Firebase PATCH error (${path}):`, error.message);
      throw error;
    }
  }
  
  // DELETE data from Firebase
  async delete(path) {
    try {
      const response = await axios.delete(this.buildURL(path));
      return response.data;
    } catch (error) {
      console.error(`Firebase DELETE error (${path}):`, error.message);
      throw error;
    }
  }
  
  // Ensure a player exists in the database
  async ensurePlayerExists(userId) {
    const playerPath = `Game/Players/${encodeFirebasePath(userId)}`;
    
    try {
      // Check if player exists
      const playerData = await this.get(playerPath);
      
      // If player doesn't exist, create a basic structure
      if (!playerData) {
        console.log(`Creating new player entry for ${userId}`);
        const initialData = {
          UserId: userId,
          CreatedAt: formatDateString(),
          LastUpdated: formatDateString(),
        };
        
        await this.put(playerPath, initialData);
        return true;
      }
      
      return true;
    } catch (error) {
      console.error(`Error ensuring player exists: ${error.message}`);
      
      // Try to create the player anyway
      try {
        const initialData = {
          UserId: userId,
          CreatedAt: formatDateString(),
          LastUpdated: formatDateString(),
        };
        
        await this.put(playerPath, initialData);
        return true;
      } catch (e) {
        console.error(`Failed to create player: ${e.message}`);
        throw e;
      }
    }
  }
  
  // Check if a user is blacklisted
  async isUserBlacklisted(userId) {
    try {
      const path = `Game/Players/${encodeFirebasePath(userId)}/Blacklisted`;
      const data = await this.get(path);
      return data && data.value === true ? data : false;
    } catch (error) {
      console.error(`Error checking blacklist status for user ${userId}:`, error);
      throw error;
    }
  }
  
  // Get user flags
  async getUserFlags(userId) {
    try {
      const path = `Game/Players/${encodeFirebasePath(userId)}/Flags`;
      return await this.get(path) || {};
    } catch (error) {
      console.error(`Error getting flags for user ${userId}:`, error);
      throw error;
    }
  }
  
  // Get blacklist history
  async getBlacklistHistory(limit = 10) {
    try {
      const history = await this.get('Game/BlacklistHistory');
      
      if (!history) return [];
      
      // Convert to array and sort by timestamp (newest first)
      const historyArray = Object.values(history).sort((a, b) => {
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
      
      return historyArray.slice(0, limit);
    } catch (error) {
      console.error('Error getting blacklist history:', error);
      throw error;
    }
  }
  
  // === GROUP BLACKLIST FUNCTIONS ===
  
  // Check if a group is blacklisted
  async isGroupBlacklisted(groupId) {
    try {
      // Use BlacklistedGroups directly as shown in the Firebase UI
      const path = `BlacklistedGroups/${encodeFirebasePath(groupId)}`;
      const data = await this.get(path);
      
      if (data && data.isActive === true) {
        return [true, data.reason || "No reason provided"];
      }
      
      return [false, null];
    } catch (error) {
      console.error(`Error checking if group ${groupId} is blacklisted:`, error);
      return [false, null];
    }
  }
  
  // Add a blacklisted group
  async addBlacklistedGroup(groupId, groupName, reason, details = {}) {
    try {
      // Use BlacklistedGroups directly as shown in the Firebase UI
      const path = `BlacklistedGroups/${encodeFirebasePath(groupId)}`;
      
      const blacklistData = {
        groupId: groupId,
        addedAt: formatDateString(),
        isActive: true,
        reason: reason
      };
      
      await this.put(path, blacklistData);
      
      // Add additional details to history for tracking
      // Still store history in the same location
      const historyPath = `BlacklistedGroupHistory/${encodeFirebasePath(groupId)}_${Date.now()}`;
      const historyData = {
        groupId: groupId,
        groupName: groupName,
        reason: reason,
        timestamp: formatDateString(),
        ...details
      };
      
      await this.put(historyPath, historyData);
      
      return true;
    } catch (error) {
      console.error(`Error adding group ${groupId} to blacklist:`, error);
      throw error;
    }
  }
  
  // Remove a blacklisted group
  async removeBlacklistedGroup(groupId) {
    try {
      // Instead of deleting, set isActive to false
      // Use BlacklistedGroups directly as shown in the Firebase UI
      const path = `BlacklistedGroups/${encodeFirebasePath(groupId)}`;
      const data = await this.get(path);
      
      if (data) {
        data.isActive = false;
        await this.put(path, data);
      } else {
        // If somehow the entry doesn't exist
        await this.put(path, {
          groupId: groupId,
          addedAt: "Unknown",
          isActive: false
        });
      }
      
      return true;
    } catch (error) {
      console.error(`Error removing group ${groupId} from blacklist:`, error);
      throw error;
    }
  }
  
  // Get all blacklisted groups
  async getBlacklistedGroups(limit = 100) {
    try {
      // Use BlacklistedGroups directly as shown in the Firebase UI
      const path = `BlacklistedGroups`;
      const data = await this.get(path);
      
      if (!data) {
        return [];
      }
      
      // Convert object to array, filter active ones, and format
      const groups = Object.entries(data)
        .filter(([_, groupData]) => groupData.isActive === true)
        .map(([groupId, groupData]) => ({
          groupId: groupId,
          addedAt: groupData.addedAt || "Unknown",
          reason: groupData.reason || "No reason provided"
        }))
        .sort((a, b) => {
          // Sort by added date (most recent first)
          const timeA = a.addedAt ? new Date(a.addedAt).getTime() : 0;
          const timeB = b.addedAt ? new Date(b.addedAt).getTime() : 0;
          return timeB - timeA;
        })
        .slice(0, limit);
      
      return groups;
    } catch (error) {
      console.error(`Error getting blacklisted groups:`, error);
      return [];
    }
  }
  
  // Get blacklisted group history
  async getBlacklistGroupHistory(limit = 10) {
    try {
      // Use BlacklistedGroupHistory directly
      const history = await this.get('BlacklistedGroupHistory');
      
      if (!history) return [];
      
      // Convert to array and sort by timestamp (newest first)
      const historyArray = Object.values(history).sort((a, b) => {
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
      
      return historyArray.slice(0, limit);
    } catch (error) {
      console.error('Error getting blacklist group history:', error);
      throw error;
    }
  }
}

module.exports = FirebaseAPI;