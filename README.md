# OracleAntiCheat Discord Bot

A moderation bot for Discord servers to manage user blacklists and monitor player behavior.

## Overview

OracleAntiCheat is a specialized Discord bot designed to help moderate gaming communities by tracking and managing blacklisted users. The bot integrates with Firebase to store user data and provides a comprehensive set of commands for moderation tasks.

## Features

- **User Blacklisting**: Blacklist users with detailed information including evidence, reasons, and appeal options
- **Alt Account Detection**: Flag and track potential alternative accounts
- **Group Blacklisting**: Manage blacklisted groups to prevent organized abuse
- **Monitoring**: Monitor Discord channels and voice activity
- **Evidence Management**: Store and retrieve evidence against users
- **Detailed Logging**: Comprehensive logging of all moderation actions

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- Discord Bot Token ([Discord Developer Portal](https://discord.com/developers/applications))
- Firebase Realtime Database ([Firebase Console](https://console.firebase.google.com/))

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/mutablevalue/Oracle.git
   cd oracleac
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with the following content:
   ```
   DISCORD_TOKEN=your_discord_bot_token
   FIREBASE_DATABASE_URL=your_firebase_database_url
   FIREBASE_SECRET=your_firebase_secret_key
   ```

4. Configure the bot by editing `config.json`:
   ```json
   {
     "logChannel": "your_log_channel_id",
     "adminRoles": [
       "Admin",
       "Moderator"
     ],
     "prefix": "!",
     "gameId": "Game"
   }
   ```

## Running the Bot

Start the bot using:
```
node main.js
```

For production environments, consider using a process manager like [PM2](https://pm2.keymetrics.io/):
```
npm install -g pm2
pm2 start main.js --name oracle-ac
```

## Commands

The bot uses Discord's slash commands. Here are the main commands:

- `/blacklist` - Blacklist a user with evidence
- `/unblacklist` - Remove a user from the blacklist
- `/setalt` - Mark a user as an alt account
- `/getevidence` - Retrieve all information for a user
- `/getblacklist` - Get a list of blacklisted users
- `/checkisalt` - Check if a user is flagged as an alt
- `/blacklistgroup` - Blacklist a group
- `/unblacklistgroup` - Remove a group from the blacklist
- `/getblacklistedgroups` - List all blacklisted groups
- `/monitor` - Monitor Discord channels and voice activity

## Firebase Database Structure

The bot uses a Firebase Realtime Database with the following structure:

```
Game/
  ├── Players/
  │   ├── [UserId]/
  │   │   ├── Blacklisted: {value, reason, details}
  │   │   ├── IsAlt: {value, detectedAt, details}
  │   │   ├── Flags/
  │   │   │   └── [FlagType]/
  │   │   │       ├── count
  │   │   │       ├── lastFlagged
  │   │   │       └── Reports/
  │   │   │           └── [ReportId]/
  │   │   │               ├── flagTime
  │   │   │               └── reportData
  │   │   ├── LastFlagged: {value}
  │   │   ├── CreatedAt
  │   │   └── LastUpdated
  ├── BlacklistHistory/
  │   └── [HistoryKey]/
  │       ├── userId
  │       ├── playerName
  │       ├── discordId
  │       ├── reason
  │       ├── evidence
  │       └── timestamp
BlacklistedGroups/
  └── [GroupId]/
      ├── groupId
      ├── addedAt
      ├── isActive
      └── reason
BlacklistedGroupHistory/
  └── [HistoryKey]/
      ├── groupId
      ├── groupName
      ├── reason
      └── timestamp
```

## Troubleshooting

### Common Error Messages

- **DiscordAPIError[50035]**: Required options must be placed before non-required options. Reorder the command options in your command definition.
- **TypeError: initBlacklistGroup is not a function**: Ensure all required modules are properly imported and initialized.
- **ReferenceError: registerEvents is not defined**: Missing function reference in your monitor module.

### Logs

Check the error log file (`error_log.txt`) for detailed error information.

## Support

For support, please contact me through  Discord.

---
