// OracleAntiCheat Discord Bot - Main Entry Point
// A moderation bot to manage user blacklists and evidence

// Load environment variables first
require('dotenv').config();

// Debug logging for environment variables
console.log("Environment variables loaded");
console.log("Database URL set:", !!process.env.FIREBASE_DATABASE_URL);
console.log("Firebase Secret set:", !!process.env.FIREBASE_SECRET);
console.log("Discord Token set:", !!process.env.DISCORD_TOKEN);

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const fs = require('fs');

// Import modules
const { loadConfig } = require('./core/config.js');
const FirebaseAPI = require('./core/database.js');
const { initCommands, commands } = require('./commands/commands.js');
const { setupEventHandlers } = require('./utils/events.js');

// Initialize Discord Client with minimal required intents
// Initialize Discord Client with all required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,  // Add this intent
    GatewayIntentBits.GuildVoiceStates // Also add this for voice monitoring
  ],
  partials: [Partials.Channel]
});

// Process error handling
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
  // Log to a file if desired
  fs.appendFileSync('./error_log.txt', `\n[${new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC'}] Unhandled Promise Rejection: ${error.stack || error}`);
});

process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
  // Log to a file if desired
  fs.appendFileSync('./error_log.txt', `\n[${new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC'}] Uncaught Exception: ${error.stack || error}`);
  // Don't exit process to keep bot running
});

// Initialize components and start the bot
async function initializeBot() {
  try {
    // Load configuration
    const config = loadConfig();
    
    // Initialize database
    const firebaseAPI = new FirebaseAPI(
      process.env.FIREBASE_DATABASE_URL,
      process.env.FIREBASE_SECRET
    );
    
    console.log("Firebase API initialized");
    
    // Initialize commands
    initCommands(client, firebaseAPI, config);
    
    // Setup event handlers
    setupEventHandlers(client, firebaseAPI, config, commands);
    
    // Clean the token and login
    const token = process.env.DISCORD_TOKEN.trim().replace(/^["']|["']$/g, '');
    
    await client.login(token);
    console.log("Bot logged in successfully");
    
    // Register slash commands
    await registerCommands(token, client.user.id);
    
  } catch (error) {
    console.error("Error initializing bot:", error);
    
    if (error.code === 'DisallowedIntents') {
      console.error("You need to enable required intents in the Discord Developer Portal");
      console.error("Visit: https://discord.com/developers/applications");
      console.error("Select your bot, go to 'Bot' settings, and enable necessary intents");
    } else if (error.message.includes('invalid token')) {
      console.error("Your Discord token is invalid. Please check your .env file");
      console.error("Visit https://discord.com/developers/applications to get your correct token");
    }
    
    // Write error to log file
    fs.appendFileSync('./error_log.txt', `\n[${new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC'}] Initialization Error: ${error.stack || error}`);
    
    process.exit(1);
  }
}

// Register slash commands with Discord
async function registerCommands(token, clientId) {
  try {
    const rest = new REST({ version: '10' }).setToken(token);
    
    console.log('Started refreshing application commands.');
    
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: Object.values(commands).map(cmd => cmd.data) }
    );

    console.log('Commands being registered:', Object.values(commands).map(cmd => cmd.data.name))
    
    console.log('Successfully reloaded application commands.');
  } catch (error) {
    console.error('Error registering slash commands:', error);
    throw error;
  }
}

// Start the bot
initializeBot();