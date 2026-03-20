require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes } = require('discord.js');
const http = require('http');
const fs = require('fs');

const CONFIG = {
    color: 0x1E50A0,
    name: "Axis Core Retail",
    apiPort: 3000,
    apiKey: process.env.API_KEY || "cookiesarenice40",
};

const LICENSES_FILE = './licenses.json';
const PRODUCTS_FILE = './products.json';
let licenses = {};
let products = [];

function loadData() {
    if (fs.existsSync(LICENSES_FILE)) licenses = JSON.parse(fs.readFileSync(LICENSES_FILE, 'utf8'));
    if (fs.existsSync(PRODUCTS_FILE)) products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
}
function saveLicenses() { fs.writeFileSync(LICENSES_FILE, JSON.stringify(licenses, null, 2)); }
function saveProducts() { fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2)); }
loadData();

function hasLicense(robloxUsername, product) {
    for (const userId in licenses) {
        for (const lic of licenses[userId]) {
            if (lic.robloxUsername && lic.robloxUsername.toLowerCase() === robloxUsername.toLowerCase() && lic.product.toLowerCase() === product.toLowerCase()) return true;
        }
    }
    return false;
}

function getProduct(name) {
    return products.find(p => p.name.toLowerCase() === name.toLowerCase());
}

// ============================================================
// HTTP SERVER
// ============================================================
const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'GET' && req.url.startsWith('/check')) {
        const url = new URL(req.url, `http://localhost:${CONFIG.apiPort}`);
        const apiKey = url.searchParams.get('key');
        const username = url.searchParams.get('username');
        const product = url.searchParams.get('product');
        if (apiKey !== CONFIG.apiKey) { res.writeHead(401); res.end(JSON.stringify({ success: false, error: 'Invalid API key' })); return; }
        const licensed = hasLicense(username, product);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, licensed, username, product }));
        console.log(`[License Check] ${username} → ${product}: ${licensed ? '✅' : '❌'}`);
        return;
    }

    if (req.method === 'POST' && req.url === '/purchase') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (data.key !== CONFIG.apiKey) { res.writeHead(401); res.end(JSON.stringify({ success: false })); return; }
                const { robloxUsername, discordUsername, product: productName, receiptId } = data;
                console.log(`[Purchase] ${robloxUsername} bought ${productName}`);

                const guild = client.guilds.cache.get(process.env.GUILD_ID);
                let discordMember = null;
                if (guild && discordUsername) {
                    await guild.members.fetch();
                    discordMember = guild.members.cache.find(m =>
                        m.user.username.toLowerCase() === discordUsername.toLowerCase() ||
                        m.user.tag.toLowerCase() === discordUsername.toLowerCase()
                    );
                }

                const userId = discordMember ? discordMember.user.id : `roblox_${robloxUsername}`;
                if (!licenses[userId]) licenses[userId] = [];
                if (!licenses[userId].find(l => l.product.toLowerCase() === productName.toLowerCase())) {
                    licenses[userId].push({ product: productName, robloxUsername, discordUsername: discordUsername || 'Unknown', issuedAt: new Date().toLocaleString(), issuedBy: 'Roblox Purchase', receiptId });
                    saveLicenses();
                }

                // Grant role and channel access
                const productData = getProduct(productName);
                if (discordMember && productData) {
                    if (productData.roleId) {
                        const role = guild.roles.cache.get(productData.roleId);
                        if (role) await discordMember.roles.add(role).catch(() => {});
                    }
                    if (productData.channelId) {
                        const channel = guild.channels.cache.get(productData.channelId);
                        if (channel) {
                            await channel.permissionOverwrites.create(discordMember, { ViewChannel: true, SendMessages: true }).catch(() => {});
                        }
                    }
                }

                // DM user
                if (discordMember) {
                    const productChannel = productData?.channelId ? `<#${productData.channelId}>` : 'your product channel';
                    await discordMember.user.send({
                        embeds: [new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle(`✅ ${productName} - Payment Complete`)
                            .setDescription(`Your purchase of **${productName}** has been successful! You can access your files at ${productChannel}.\n\nNeed any assistance? Feel free to open a support ticket.\n\nTo view all your owned licenses, run \`/license list\`. Thank you for your purchase! ❤️`)
                            .addFields({ name: '🧾 Payment Session ID', value: receiptId || 'N/A' })
                            .setTimestamp()
                        ]
                    }).catch(() => {});
                }

                // Log
                const logChannel = guild?.channels.cache.get(process.env.LOG_CHANNEL_ID);
                if (logChannel) {
                    await logChannel.send({ embeds: [new EmbedBuilder().setColor(0x00FF00).setTitle('💰 New Purchase!').addFields({ name: 'Product', value: productName, inline: true }, { name: 'Roblox', value: robloxUsername, inline: true }, { name: 'Discord', value: discordUsername || 'Unknown', inline: true }).setTimestamp()] }).catch(() => {});
                }

                res.writeHead(200);
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                console.error('[Purchase Error]', e);
                res.writeHead(500);
                res.end(JSON.stringify({ success: false }));
            }
        });
        return;
    }

    if (req.method === 'GET' && req.url === '/') { res.writeHead(200); res.end(JSON.stringify({ status: 'ACR Bot running!' })); return; }
    res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(CONFIG.apiPort, () => console.log(`✅ API on port ${CONFIG.apiPort}`));

// ============================================================
// DISCORD CLIENT
// ============================================================
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const commands = [
    { name: 'product', description: 'Product management', options: [
        { name: 'list', type: 1, description: 'List all products' },
        { name: 'add', type: 1, description: 'Add a product (Admin)', options: [
            { name: 'name', type: 3, description: 'Product name', required: true },
            { name: 'price', type: 3, description: 'Price e.g. 500 Robux or Free', required: true },
            { name: 'description', type: 3, description: 'Description', required: true },
            { name: 'features', type: 3, description: 'Features separated by commas', required: false },
            { name: 'role_id', type: 3, description: 'Role ID to give buyers', required: false },
            { name: 'channel_id', type: 3, description: 'Channel ID to give buyers access to', required: false }
        ]},
        { name: 'remove', type: 1, description: 'Remove a product (Admin)', options: [{ name: 'name', type: 3, description: 'Product name', required: true }]},
        { name: 'info', type: 1, description: 'View a product', options: [{ name: 'name', type: 3, description: 'Product name', required: true }]}
    ]},
    { name: 'license', description: 'License management', options: [
        { name: 'check', type: 1, description: 'Check licenses', options: [{ name: 'user', type: 6, description: 'User', required: true }]},
        { name: 'grant', type: 1, description: 'Grant a license', options: [
            { name: 'user', type: 6, description: 'User', required: true },
            { name: 'product', type: 3, description: 'Product', required: true },
            { name: 'roblox', type: 3, description: 'Roblox username', required: true }
        ]},
        { name: 'revoke', type: 1, description: 'Revoke a license', options: [
            { name: 'user', type: 6, description: 'User', required: true },
            { name: 'product', type: 3, description: 'Product', required: true }
        ]},
        { name: 'list', type: 1, description: 'List licenses', options: [{ name: 'user', type: 6, description: 'User', required: true }]}
    ]},
    { name: 'blacklist', description: 'Blacklist management', options: [
        { name: 'add', type: 1, description: 'Blacklist a user (Admin)', options: [
            { name: 'user', type: 6, description: 'User to blacklist', required: true },
            { name: 'reason', type: 3, description: 'Reason', required: true }
        ]},
        { name: 'remove', type: 1, description: 'Remove from blacklist (Admin)', options: [{ name: 'user', type: 6, description: 'User', required: true }]}
    ]},
    { name: 'ticket', description: 'Create a support ticket', options: [{ name: 'reason', type: 3, description: 'Reason', required: true }]},
    { name: 'closeticket', description: 'Close ticket' },
    { name: 'setup', description: 'Setup panels (Admin)', options: [{ name: 'type', type: 3, description: 'Type', required: true, choices: [
        { name: 'Welcome Panel', value: 'welcome' },
        { name: 'Ticket Panel', value: 'ticket' },
        { name: 'Product Panel', value: 'product' }
    ]}]}
];

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    try { await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands }); console.log('✅ Commands registered!'); }
    catch (e) { console.error(e); }
}

client.once('ready', async () => {
    console.log(`✅ ${CONFIG.name} Bot online as ${client.user.tag}`);
    client.user.setActivity('Axis Core Retail', { type: 3 });
    await registerCommands();
});

client.on('guildMemberAdd', async (member) => {
    const channel = member.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);
    if (!channel) return;
    await channel.send({ embeds: [new EmbedBuilder().setColor(CONFIG.color).setTitle(`👋 Welcome to ${member.guild.name}!`).setDescription(`Hey ${member}, welcome to **Axis Core Retail**! 🎉\n\nUse \`/product list\` to see our products!`).setThumbnail(member.user.displayAvatarURL({ dynamic: true })).setTimestamp()] });
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        if (interaction.customId === 'create_ticket') { await handleCreateTicket(interaction); return; }
        if (interaction.customId === 'close_ticket')  { await handleCloseTicket(interaction); return; }
        if (interaction.customId.startsWith('buy_')) {
            const productName = interaction.customId.replace('buy_', '').replace(/_/g, ' ');
            const product = getProduct(productName);
            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor(CONFIG.color)
                    .setTitle(`🛒 Purchase: ${productName}`)
                    .setDescription(`To purchase **${productName}**, join our Roblox purchasing hub!\n\n⚠️ Make sure to enter your **Discord username** in the game before paying so your license is linked correctly.`)
                    .addFields({ name: '🎮 Purchasing Hub', value: `[Click here to purchase](https://www.roblox.com/games/${process.env.ROBLOX_GAME_ID || 'YOUR_GAME_ID'})` })
                    .setTimestamp()
                ],
                ephemeral: true
            });
            return;
        }
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    const isStaff = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);

    // /product
    if (commandName === 'product') {
        const sub = interaction.options.getSubcommand();

        if (sub === 'list') {
            if (products.length === 0) return interaction.reply({ content: '❌ No products yet!', ephemeral: true });
            const embed = new EmbedBuilder().setColor(CONFIG.color).setTitle('📦 Axis Core Retail Products').setTimestamp();
            products.forEach((p, i) => embed.addFields({ name: `${i+1}. ${p.name} — ${p.price}`, value: p.description }));
            await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('create_ticket').setLabel('🎫 Support Ticket').setStyle(ButtonStyle.Primary))] });
        }

        else if (sub === 'add') {
            if (!isAdmin) return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
            const name        = interaction.options.getString('name');
            const price       = interaction.options.getString('price');
            const description = interaction.options.getString('description');
            const featuresRaw = interaction.options.getString('features') || '';
            const roleId      = interaction.options.getString('role_id') || null;
            const channelId   = interaction.options.getString('channel_id') || null;

            if (getProduct(name)) return interaction.reply({ content: `⚠️ **${name}** already exists!`, ephemeral: true });

            products.push({ name, price, description, features: featuresRaw ? featuresRaw.split(',').map(f => '✅ ' + f.trim()) : [], roleId, channelId });
            saveProducts();

            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00FF00).setTitle('✅ Product Added!').addFields(
                { name: 'Name', value: name, inline: true },
                { name: 'Price', value: price, inline: true },
                { name: 'Role', value: roleId ? `<@&${roleId}>` : 'None', inline: true },
                { name: 'Channel', value: channelId ? `<#${channelId}>` : 'None', inline: true }
            ).setTimestamp()] });
        }

        else if (sub === 'remove') {
            if (!isAdmin) return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
            const name = interaction.options.getString('name');
            const before = products.length;
            products = products.filter(p => p.name.toLowerCase() !== name.toLowerCase());
            if (products.length === before) return interaction.reply({ content: '❌ Not found!', ephemeral: true });
            saveProducts();
            await interaction.reply({ content: `✅ **${name}** removed!` });
        }

        else if (sub === 'info') {
            const name = interaction.options.getString('name');
            const product = getProduct(name);
            if (!product) return interaction.reply({ content: '❌ Not found!', ephemeral: true });
            const embed = new EmbedBuilder().setColor(CONFIG.color).setTitle(`📦 ${product.name}`).setDescription(product.description).addFields(
                { name: '💰 Price', value: product.price, inline: true },
                { name: '✨ Features', value: product.features.length > 0 ? product.features.join('\n') : 'None listed' }
            ).setTimestamp();
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`buy_${product.name.replace(/ /g, '_')}`).setLabel(`🛒 Purchase`).setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('create_ticket').setLabel('🎫 Support').setStyle(ButtonStyle.Primary)
            );
            await interaction.reply({ embeds: [embed], components: [row] });
        }
    }

    // /license
    else if (commandName === 'license') {
        const sub = interaction.options.getSubcommand();

        if (sub === 'check') {
            const user = interaction.options.getUser('user');
            const userLicenses = licenses[user.id] || [];
            const embed = new EmbedBuilder().setColor(CONFIG.color).setTitle(`🔑 Licenses for ${user.username}`).setTimestamp();
            if (userLicenses.length === 0) embed.setDescription('❌ No licenses.');
            else userLicenses.forEach(l => embed.addFields({ name: `📦 ${l.product}`, value: `**Roblox:** ${l.robloxUsername || 'N/A'}\n**Issued:** ${l.issuedAt}\n**Status:** ✅ Active` }));
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        else if (sub === 'grant') {
            if (!isStaff) return interaction.reply({ content: '❌ No permission!', ephemeral: true });
            const user = interaction.options.getUser('user');
            const productName = interaction.options.getString('product');
            const roblox = interaction.options.getString('roblox');
            if (!licenses[user.id]) licenses[user.id] = [];
            if (licenses[user.id].find(l => l.product.toLowerCase() === productName.toLowerCase())) return interaction.reply({ content: '⚠️ Already licensed!', ephemeral: true });
            licenses[user.id].push({ product: productName, robloxUsername: roblox, issuedAt: new Date().toLocaleString(), issuedBy: interaction.user.id });
            saveLicenses();

            // Grant role and channel
            const productData = getProduct(productName);
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (member && productData) {
                if (productData.roleId) { const role = interaction.guild.roles.cache.get(productData.roleId); if (role) await member.roles.add(role).catch(() => {}); }
                if (productData.channelId) { const ch = interaction.guild.channels.cache.get(productData.channelId); if (ch) await ch.permissionOverwrites.create(member, { ViewChannel: true, SendMessages: true }).catch(() => {}); }
            }

            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00FF00).setTitle('✅ License Granted').addFields({ name: 'User', value: user.tag, inline: true }, { name: 'Roblox', value: roblox, inline: true }, { name: 'Product', value: productName, inline: true }).setTimestamp()] });
            
            const productChannel = productData?.channelId ? `<#${productData.channelId}>` : 'your product channel';
            await user.send({ embeds: [new EmbedBuilder().setColor(CONFIG.color).setTitle(`✅ ${productName} - License Granted`).setDescription(`Your license for **${productName}** has been granted!\n\nYou can access your files at ${productChannel}.\n\nNeed help? Open a support ticket. Thank you! ❤️`).setTimestamp()] }).catch(() => {});
        }

        else if (sub === 'revoke') {
            if (!isStaff) return interaction.reply({ content: '❌ No permission!', ephemeral: true });
            const user = interaction.options.getUser('user');
            const productName = interaction.options.getString('product');
            if (!licenses[user.id]) return interaction.reply({ content: '❌ No licenses!', ephemeral: true });
            const before = licenses[user.id].length;
            licenses[user.id] = licenses[user.id].filter(l => l.product.toLowerCase() !== productName.toLowerCase());
            if (licenses[user.id].length === before) return interaction.reply({ content: '❌ Not found!', ephemeral: true });
            saveLicenses();

            // Remove role and channel access
            const productData = getProduct(productName);
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (member && productData) {
                if (productData.roleId) { const role = interaction.guild.roles.cache.get(productData.roleId); if (role) await member.roles.remove(role).catch(() => {}); }
                if (productData.channelId) { const ch = interaction.guild.channels.cache.get(productData.channelId); if (ch) await ch.permissionOverwrites.delete(member).catch(() => {}); }
            }

            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setTitle('🔒 License Revoked').setDescription(`Revoked **${productName}** from ${user}`).setTimestamp()] });
        }

        else if (sub === 'list') {
            const user = interaction.options.getUser('user');
            const userLicenses = licenses[user.id] || [];
            await interaction.reply({ embeds: [new EmbedBuilder().setColor(CONFIG.color).setTitle(`📋 Licenses for ${user.username}`).setDescription(userLicenses.length === 0 ? '❌ None.' : userLicenses.map(l => `• **${l.product}** (${l.robloxUsername || 'N/A'}) — ${l.issuedAt}`).join('\n')).setTimestamp()], ephemeral: true });
        }
    }

    // /blacklist
    else if (commandName === 'blacklist') {
        if (!isAdmin) return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        const sub = interaction.options.getSubcommand();

        if (sub === 'add') {
            const user = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason');
            const blacklistRole = interaction.guild.roles.cache.get(process.env.BLACKLIST_ROLE_ID);
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (member && blacklistRole) await member.roles.add(blacklistRole).catch(() => {});

            const blacklistChannel = interaction.guild.channels.cache.get(process.env.BLACKLIST_CHANNEL_ID);
            if (blacklistChannel) {
                await blacklistChannel.send({ embeds: [new EmbedBuilder().setColor(0xFF0000).setTitle('🚫 User Blacklisted').addFields({ name: 'User', value: `${user.tag}`, inline: true }, { name: 'Reason', value: reason, inline: true }, { name: 'By', value: interaction.user.tag, inline: true }).setTimestamp()] });
            }
            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setTitle('🚫 Blacklisted').setDescription(`${user} has been blacklisted.\n**Reason:** ${reason}`).setTimestamp()] });
        }

        else if (sub === 'remove') {
            const user = interaction.options.getUser('user');
            const blacklistRole = interaction.guild.roles.cache.get(process.env.BLACKLIST_ROLE_ID);
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (member && blacklistRole) await member.roles.remove(blacklistRole).catch(() => {});
            await interaction.reply({ content: `✅ ${user} removed from blacklist!` });
        }
    }

    else if (commandName === 'ticket') { await handleCreateTicket(interaction, interaction.options.getString('reason')); }
    else if (commandName === 'closeticket') { await handleCloseTicket(interaction); }

    else if (commandName === 'setup') {
        if (!isAdmin) return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        const type = interaction.options.getString('type');

        if (type === 'welcome') {
            await interaction.channel.send({ embeds: [new EmbedBuilder().setColor(CONFIG.color).setTitle(`👋 Welcome to ${interaction.guild.name}!`).setDescription('Welcome to **Axis Core Retail**!\n\nUse `/product list` to see our products and `/ticket` to get support.').setTimestamp()] });
            await interaction.reply({ content: '✅ Done!', ephemeral: true });
        }

        else if (type === 'ticket') {
            await interaction.channel.send({
                embeds: [new EmbedBuilder().setColor(CONFIG.color).setTitle('🎫 Support Tickets').setDescription('Click below to open a support ticket!').setTimestamp()],
                components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('create_ticket').setLabel('🎫 Open a Ticket').setStyle(ButtonStyle.Primary))]
            });
            await interaction.reply({ content: '✅ Done!', ephemeral: true });
        }

        else if (type === 'product') {
            if (products.length === 0) return interaction.reply({ content: '❌ No products yet! Use `/product add` first.', ephemeral: true });
            for (const product of products) {
                const embed = new EmbedBuilder().setColor(CONFIG.color).setTitle(`📦 ${product.name}`).setDescription(product.description).addFields(
                    { name: '💰 Price', value: product.price, inline: true },
                    { name: '✨ Features', value: product.features.length > 0 ? product.features.join('\n') : 'None listed' }
                ).setFooter({ text: 'Click Purchase to buy' }).setTimestamp();
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`buy_${product.name.replace(/ /g, '_')}`).setLabel('🛒 Purchase').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('create_ticket').setLabel('🎫 Support').setStyle(ButtonStyle.Primary)
                );
                await interaction.channel.send({ embeds: [embed], components: [row] });
            }
            await interaction.reply({ content: '✅ Product panel sent!', ephemeral: true });
        }
    }
});

async function handleCreateTicket(interaction, reason = 'No reason provided') {
    const guild = interaction.guild;
    const user = interaction.user;
    const channelName = `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const existing = guild.channels.cache.find(c => c.name === channelName);
    if (existing) return interaction.reply({ content: `❌ Already have a ticket! ${existing}`, ephemeral: true });
    const ticketChannel = await guild.channels.create({
        name: channelName, type: ChannelType.GuildText, parent: process.env.TICKET_CATEGORY_ID || null,
        permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            { id: process.env.STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
    });
    await ticketChannel.send({
        content: `${user} <@&${process.env.STAFF_ROLE_ID}>`,
        embeds: [new EmbedBuilder().setColor(CONFIG.color).setTitle('🎫 Support Ticket').setDescription(`Hello ${user}! Staff will be with you shortly.\n\n**Reason:** ${reason}`).setTimestamp()],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger))]
    });
    await interaction.reply({ content: `✅ Ticket created! ${ticketChannel}`, ephemeral: true });
}

async function handleCloseTicket(interaction) {
    const channel = interaction.channel;
    if (!channel.name.startsWith('ticket-')) return interaction.reply({ content: '❌ Not a ticket!', ephemeral: true });
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setTitle('🔒 Ticket Closed').setDescription(`Closed by ${interaction.user}. Deleting in 5 seconds.`).setTimestamp()] });
    setTimeout(() => channel.delete().catch(() => {}), 5000);
}

client.login(process.env.BOT_TOKEN);