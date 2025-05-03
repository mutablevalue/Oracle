// Configuration management for OracleAntiCheat Bot
const fs = require('fs');

// Define color codes for different types of responses
const COLORS = {
  LOG: '#9932CC',      // Purple for logs
  PUSH: '#800000',     // Maroon for push responses
  PULL: '#0099FF',     // Blue for pull responses
  SUCCESS: '#00FF00',  // Green for success
  ERROR: '#FF0000',    // Red for errors
  WARNING: '#FFAA00'   // Amber for warnings/flags
};

// Load configuration from file or create default
function loadConfig() {
  try {
    const config = require('../config.json');
    console.log("Configuration loaded from config.json");
    return config;
  } catch (err) {
    console.error('Could not load config.json. Using default configuration.');
    const defaultConfig = {
      logChannel: null,
      adminRoles: ["Admin", "Moderator"],
      prefix: "!",
      gameId: "Game" // This should match GAME_ID in your Lua script
    };
    
    // Create default config file if it doesn't exist
    fs.writeFileSync('../config.json', JSON.stringify(defaultConfig, null, 2));
    console.log("Default configuration created");
    
    return defaultConfig;
  }
}

// Save configuration to file
function saveConfig(config) {
  try {
    fs.writeFileSync('../config.json', JSON.stringify(config, null, 2));
    console.log("Configuration saved to config.json");
    return true;
  } catch (error) {
    console.error("Error saving configuration:", error);
    return false;
  }
}

module.exports = {
  COLORS,
  loadConfig,
  saveConfig
};