const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Socket.io (تحديث مباشر للواجهة)
const { Server } = require('socket.io');
const io = new Server(server, {
    cors: { origin: "*" }
});

// إعدادات الديسكورد والرومات
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = '1517858234378227834';
const CADET_ROLE_ID = '1520526818225164329';
const SOLO_CADET_ROLE_ID = '1522994966597468191';

const REPORTS_CHANNEL_ID = '1520998767325741148';
const HOURS_CHANNEL_ID = '1530564311217471639';

// بيانات العسكريين
let cadetsData = [];

// بيانات المستخدمين (اللي يدخلون الموقع)
let users = [];

// اللوقات (من عدّل؟)
let logs = [];

// الوِنقات (Wings)
const WINGS = [
    { id: "airship", name: "Airship Wing", icon: "fa-jet-fighter", color: "#38bdf8" },
    { id: "interceptor", name: "Interceptor Wing", icon: "fa-shield-halved", color: "#6366f1" },
    { id: "motorcycle", name: "MotorCycle Wing", icon: "fa-motorcycle", color: "#10b981" },
    { id: "negotiator", name: "Negotiator Wing", icon: "fa-comments", color: "#f59e0b" },
    { id: "dispatch", name: "Dispatch Wing", icon: "fa-headset", color: "#ef4444" }
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', async () => {
    console.log(`🤖 Bot is running as: ${client.user.tag}`);
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();

        members.forEach(member => {
            checkAndSyncMember(member);
        });

        console.log(`✅ Synced all cadets successfully.`);
        io.emit("cadetsUpdate", cadetsData);
    } catch (err) {
        console.error('❌ Error while syncing members:', err);
    }
});

function checkAndSyncMember(member) {
    const isCadet = member.roles.cache.has(CADET_ROLE_ID);
    const isSoloCadet = member.roles.cache.has(SOLO_CADET_ROLE_ID);

    let existing = cadetsData.find(c => c.discordId === member.id);

    if (isCadet || isSoloCadet) {
        const rankName = isSoloCadet ? 'Solo Cadet' : 'Cadet';
        const displayName = member.displayName || member.user.username;

        if (existing) {
            existing.name = displayName;
            existing.rank = rankName;
            existing.status = 'active';
        } else {
            cadetsData.push({
                discordId: member.id,
                name: displayName,
                rank: rankName,
                hours: 0,
                reports: [],
                status: 'active',
                points: 0,
                badges: []
            });
        }
    } else if (existing) {
        existing.status = 'archived';
    }
}

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    checkAndSyncMember(newMember);
    io.emit("cadetsUpdate", cadetsData);
});

// استخراج أرقام الساعات من الرسالة
function parseHours(text) {
    if (!text) return 0;
    const match = text.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
}

client.on('messageCreate', message => {
    if (message.author.bot) return;

    const authorId = message.author.id;
    let cadet = cadetsData.find(c => c.discordId === authorId && c.status === 'active');

    if (!cadet) return;

    if (message.channel.id === HOURS_CHANNEL_ID) {
        const hoursToAdd = parseHours(message.content);
        if (hoursToAdd > 0) {
            cadet.hours += hoursToAdd;
            console.log(`⏱️ Added ${hoursToAdd} hours to: ${cadet.name}`);
            logs.push({
                id: Date.now(),
                action: `Added ${hoursToAdd} hours (channel)`,
                by: message.author.username,
                target: cadet.name,
                date: new Date().toLocaleString()
            });
            io.emit("cadetsUpdate", cadetsData);
        }
    }

    if (message.channel.id === REPORTS_CHANNEL_ID) {
        cadet.reports.push({
            id: message.id,
            title: message.content.slice(0, 50) || 'New MDT Report',
            content: message.content || 'Contains attachments or images',
            date: new Date().toLocaleDateString('en-US')
        });
        logs.push({
            id: Date.now(),
            action: `New MDT report from channel`,
            by: message.author.username,
            target: cadet.name,
            date: new Date().toLocaleString()
        });
        io.emit("cadetsUpdate", cadetsData);
    }
});

// -------------------------------------------------------------
// API العسكريين
// -------------------------------------------------------------
app.get('/api/cadets', (req, res) => {
    res.json(cadetsData);
});

app.post('/api/update-cadet-manual', (req, res) => {
    const { discordId, hours, reportTitle, reportContent, by } = req.body;
    let cadet = cadetsData.find(c => c.discordId === discordId);

    if (cadet) {
        if (hours !== undefined && hours !== '') {
            cadet.hours = parseFloat(hours);
        }
        if (reportTitle || reportContent) {
            cadet.reports.push({
                id: Date.now().toString(),
                title: reportTitle || 'Manual Report',
                content: reportContent || 'No additional details',
                date: new Date().toLocaleDateString('en-US')
            });
        }
        logs.push({
            id: Date.now(),
            action: 'Manual update (hours/reports)',
            by: by || 'Manual',
            target: cadet.name,
            date: new Date().toLocaleString()
        });
        io.emit("cadetsUpdate", cadetsData);
        res.json({ success: true, message: 'Updated successfully!' });
    } else {
        res.status(404).json({ success: false, message: 'Cadet not found' });
    }
});

// -------------------------------------------------------------
// نظام النقاط Points
// -------------------------------------------------------------
app.post('/api/update-points', (req, res) => {
    const { discordId, points, by } = req.body;

    const cadet = cadetsData.find(c => c.discordId === discordId);
    if (!cadet) return res.json({ success: false });

    cadet.points = Number(points);

    logs.push({
        id: Date.now(),
        action: `Updated points to ${points}`,
        by: by || 'Admin',
        target: cadet.name,
        date: new Date().toLocaleString()
    });

    io.emit("cadetsUpdate", cadetsData);
    res.json({ success: true });
});

// -------------------------------------------------------------
// نظام الوِنقات Wings
// -------------------------------------------------------------
app.post('/api/add-badge', (req, res) => {
    const { discordId, badgeId, by } = req.body;

    const cadet = cadetsData.find(c => c.discordId === discordId);
    if (!cadet) return res.json({ success: false });

    const badge = WINGS.find(b => b.id === badgeId);
    if (!badge) return res.json({ success: false });

    if (!cadet.badges.some(b => b.id === badgeId)) {
        cadet.badges.push(badge);
    }

    logs.push({
        id: Date.now(),
        action: `Added wing: ${badge.name}`,
        by: by || 'Admin',
        target: cadet.name,
        date: new Date().toLocaleString()
    });

    io.emit("cadetsUpdate", cadetsData);
    res.json({ success: true });
});

app.post('/api/remove-badge', (req, res) => {
    const { discordId, badgeId, by } = req.body;

    const cadet = cadetsData.find(c => c.discordId === discordId);
    if (!cadet) return res.json({ success: false });

    cadet.badges = cadet.badges.filter(b => b.id !== badgeId);

    logs.push({
        id: Date.now(),
        action: `Removed wing: ${badgeId}`,
        by: by || 'Admin',
        target: cadet.name,
        date: new Date().toLocaleString()
    });

    io.emit("cadetsUpdate", cadetsData);
    res.json({ success: true });
});

// -------------------------------------------------------------
// نظام المستخدمين + تسجيل الدخول
// -------------------------------------------------------------
app.post('/api/request-access', (req, res) => {
    const { discordId, username } = req.body;

    let existing = users.find(u => u.discordId === discordId);

    if (existing) {
        return res.json({ success: true, exists: true, approved: existing.approved });
    }

    users.push({
        discordId,
        username,
        approved: false,
        status: 'not-active',
        lastSeen: Date.now()
    });

    logs.push({
        id: Date.now(),
        action: 'Requested access',
        by: username,
        target: 'System',
        date: new Date().toLocaleString()
    });

    res.json({ success: true, exists: false });
});

app.post('/api/approve-user', (req, res) => {
    const { discordId } = req.body;

    const user = users.find(u => u.discordId === discordId);
    if (!user) return res.json({ success: false });

    user.approved = true;

    logs.push({
        id: Date.now(),
        action: 'Approved user',
        by: 'Admin',
        target: user.username,
        date: new Date().toLocaleString()
    });

    res.json({ success: true });
});

app.get('/api/users', (req, res) => {
    res.json(users);
});

app.post('/api/update-status', (req, res) => {
    const { discordId, status } = req.body;

    const user = users.find(u => u.discordId === discordId);
    if (!user) return res.json({ success: false });

    user.status = status;
    user.lastSeen = Date.now();

    res.json({ success: true });
});

// -------------------------------------------------------------
// نظام اللوقات Logs
// -------------------------------------------------------------
app.get('/api/logs', (req, res) => {
    res.json(logs);
});

// -------------------------------------------------------------
// Routes للواجهات
// -------------------------------------------------------------
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin-approval', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-approval.html'));
});

app.get('/users-status', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'users-status.html'));
});

app.get('/logs-page', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'logs.html'));
});

app.get('/points', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'points.html'));
});

app.get('/wings', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'wings.html'));
});

// مسار افتراضي يرجّع الـ Dashboard
app.get(/(.*)/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`🌐 Dashboard running on port: ${PORT}`);
});

// تسجيل الدخول للبوت
client.login(BOT_TOKEN);
