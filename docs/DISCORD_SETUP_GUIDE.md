# Discord Bot Setup Guide for Testing

This guide walks you through creating a Discord bot for testing the tofucode Discord integration.

---

## Part 1: Create Discord Bot Application

### Step 1: Go to Discord Developer Portal

Visit: https://discord.com/developers/applications

Click **"New Application"** button (top right)

### Step 2: Name Your Bot

- Enter a name (e.g., "tofucode Test Bot")
- Agree to terms
- Click **"Create"**

### Step 3: Configure Bot Settings

1. In the left sidebar, click **"Bot"**
2. Click **"Add Bot"** → **"Yes, do it!"**
3. Under **"Token"**, click **"Reset Token"** → **"Yes, do it!"**
4. **Copy the token** and save it somewhere secure

   ```
   Example token format:
   YOUR_BOT_TOKEN_HERE
   ```

   ⚠️ **Keep this secret!** Never commit it to git or share publicly.

### Step 4: Enable Privileged Intents

Still on the **"Bot"** page, scroll down to **"Privileged Gateway Intents"**:

1. ✅ Enable **"Message Content Intent"** (required to read message text)
2. Save changes

---

## Part 2: Generate Bot Invite URL

### Step 5: Configure OAuth2 Permissions

1. In left sidebar, click **"OAuth2"** → **"URL Generator"**
2. Under **"Scopes"**, select:
   - ✅ **bot**
   - ✅ **applications.commands** (for slash commands)

3. Under **"Bot Permissions"**, select:
   - ✅ **Send Messages**
   - ✅ **Send Messages in Threads**
   - ✅ **Create Public Threads**
   - ✅ **Read Message History**
   - ✅ **Use Slash Commands**
   - ✅ **Manage Threads** (optional, for auto-archive features)

4. Scroll down and **copy the Generated URL**

   Example URL:
   ```
   https://discord.com/oauth2/authorize?client_id=1234567890&permissions=534790688768&scope=bot%20applications.commands
   ```

---

## Part 3: Invite Bot to Your Test Server

### Step 6: Create or Use Existing Discord Server

If you don't have a test server:
1. Open Discord app/web
2. Click **"+"** icon in server list (left sidebar)
3. Click **"Create My Own"**
4. Choose **"For me and my friends"**
5. Name it (e.g., "tofucode Testing")

### Step 7: Add Bot to Server

1. Open the **Generated URL** from Step 5 in your browser
2. Select your test server from dropdown
3. Click **"Continue"**
4. Review permissions
5. Click **"Authorize"**
6. Complete captcha if prompted

Your bot should now appear **offline** in your server's member list (will go online when tofucode starts).

---

## Part 4: Get Your Guild (Server) ID

### Step 8: Enable Developer Mode in Discord

1. Open Discord **User Settings** (gear icon)
2. Go to **"Advanced"**
3. Enable **"Developer Mode"**
4. Close settings

### Step 9: Copy Guild ID

1. Right-click your test server icon (left sidebar)
2. Click **"Copy Server ID"**
3. Save this ID (you'll use it in `.env`)

   Example Guild ID:
   ```
   1234567890123456789
   ```

---

## Part 5: Configure tofucode

### Step 10: Create/Update `.env` File

In your tofucode project root (`/home/ts/projects/tofucode/`):

```bash
# Create or edit .env file
cat >> .env << 'EOF'

# Discord Bot Configuration
DISCORD_ENABLED=true
DISCORD_BOT_TOKEN=YOUR_BOT_TOKEN_HERE
DISCORD_GUILD_ID=YOUR_GUILD_ID_HERE
DISCORD_STATUS=Coding with Claude

EOF
```

Replace:
- `YOUR_BOT_TOKEN_HERE` with the token from Step 4
- `YOUR_GUILD_ID_HERE` with the Guild ID from Step 9

**Example `.env` entry:**
```bash
DISCORD_ENABLED=true
DISCORD_BOT_TOKEN=YOUR_BOT_TOKEN_HERE
DISCORD_GUILD_ID=1234567890123456789
DISCORD_STATUS=Coding with Claude
```

---

## Part 6: Test the Bot

### Step 11: Start tofucode with Discord Bot

```bash
cd /home/ts/projects/tofucode

# Start with Discord bot enabled
npm run dev

# Or explicitly:
DISCORD_ENABLED=true npm run dev
```

**Expected output in console:**
```
tofucode v1.0.5 running on http://localhost:3001
WebSocket available at ws://localhost:3001/ws
Discord bot logged in as tofucode Test Bot#1234
Registered 3 slash commands for guild 1234567890123456789
```

**In Discord:**
- Your bot should now appear **online** (green status)

### Step 12: Test Slash Commands

In your Discord test server, type `/` in any channel. You should see:
- `/setup` - Map channel to project
- `/session` - List sessions
- `/cancel` - Cancel running task

---

## Part 7: Test Channel Mapping

### Step 13: Create Test Channel

In Discord:
1. Right-click your server name → **"Create Channel"**
2. Name it (e.g., `test-backend`)
3. Click **"Create Channel"**

### Step 14: Map Channel to Project

In the `#test-backend` channel, run:
```
/setup project:/home/ts/projects/tofucode
```

**Expected bot response:**
```
✅ Channel configured!
**Project**: `/home/ts/projects/tofucode`
**Slug**: `-home-ts-projects-tofucode`

Create threads in this channel to start sessions with Claude Code.
Use `/session` to list existing sessions.
```

**Verify mapping file created:**
```bash
cat ~/.tofucode/discord-channels.json
```

Should show:
```json
{
  "CHANNEL_ID": {
    "projectPath": "/home/ts/projects/tofucode",
    "projectSlug": "-home-ts-projects-tofucode",
    "guildId": "1234567890123456789",
    "configuredBy": "YOUR_USER_ID",
    "configuredAt": "2026-02-17T..."
  }
}
```

---

## Part 8: Test Thread Session

### Step 15: Create Thread

In `#test-backend` channel:
1. Hover over any message (or the channel name)
2. Click 🧵 **"Create Thread"** button
3. Name it: `Test Session 1`
4. Click **"Create Thread"**

### Step 16: Send Message to Bot

In the thread, send a message:
```
help me list all files in this directory
```

**Expected behavior:**
1. Bot replies with `:hourglass: Thinking...`
2. Message gets edited with Claude's response (streaming)
3. Final response shows tool use (Bash/Glob commands) and result

**Verify session mapping:**
```bash
cat ~/.tofucode/discord-sessions.json
```

Should show thread → session mapping.

**Verify JSONL session file:**
```bash
ls -la ~/.claude/projects/-home-ts-projects-tofucode/
```

Should see a new `.jsonl` file (session history).

---

## Troubleshooting

### Bot stays offline
- Check `DISCORD_BOT_TOKEN` is correct
- Check bot has been invited to server
- Check console for error messages

### Slash commands don't appear
- Wait 1 minute (registration takes time)
- Check `DISCORD_GUILD_ID` matches your server ID
- Try in a different channel
- Restart Discord app

### `/setup` says "Access denied"
- Check project path exists: `ls -la /path/to/project`
- Check path is absolute (starts with `/`)
- If using `ROOT_PATH` env var, check path is within root

### Bot doesn't respond to messages
- Check Message Content Intent is enabled (Step 4)
- Check bot has permissions in channel
- Check console logs for errors

### "channelId not found" error
- Make sure you ran `/setup` in the parent channel before creating thread
- Check `~/.tofucode/discord-channels.json` exists and has correct channel ID

---

## What You Have Now

✅ Discord bot application created
✅ Bot invited to your test server
✅ Bot token and Guild ID configured in `.env`
✅ tofucode server running with Discord bot
✅ Channel mapped to project via `/setup`
✅ Thread created and ready for testing

---

## Next Steps for Development

1. **Test concurrent threads**: Create multiple threads, send messages simultaneously
2. **Test session resumption**: Send multiple messages in same thread, verify conversation history
3. **Test `/cancel`**: Start long-running task, run `/cancel` mid-execution
4. **Test parent channel behavior**: Send message in parent channel (not thread), verify redirect
5. **Test long responses**: Trigger response >2000 chars, verify chunking
6. **Test error handling**: Invalid path in `/setup`, unmapped channel, etc.

---

## Cleanup After Testing

### Remove bot from server:
1. Right-click bot name in member list
2. Click **"Kick"**

### Delete bot application:
1. Go to https://discord.com/developers/applications
2. Select your bot
3. **"Settings"** → **"General"**
4. Scroll down → **"Delete Application"**

### Remove local config:
```bash
rm ~/.tofucode/discord-channels.json
rm ~/.tofucode/discord-sessions.json
```
