const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('public'));

const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = '1517858234378227834';
const HOURS_CHANNEL_ID = '1530564311217471639'; // روم الساعات

const POLICE_ROLE_ID = "1520526844313469080"; 
const CADET_ROLE_IDS = ["1520526818225164329", "1522994966597468191"];
const ADMIN_IDS = ["771747917040058388"];

const WINGS_MAP = {
    "1520526847597871214": "Air Support",
    "1520526845626552554": "Interceptor",
    "1520526848709230622": "Motorcycle",
    "1520526849598427217": "Negotiation",
    "1526679318456176680": "Dispatch"
};

const ROLES_ORDER = [
    "First Lieutenant", "Lieutenant", "Staff Sergeant", "First Sergeant",
    "Sergeant", "Filed Commander", "Assist Police Supervisor", "Senior Lead Officer",
    "Senior Officer", "Officer III", "Officer II", "Officer I", "Solo Cadet", "Cadet"
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const DB_FILE = path.join(__dirname, 'database.json');
let dbData = {};

if (fs.existsSync(DB_FILE)) {
    try { dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch (e) { dbData = {}; }
}

function saveData() {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2)); } catch(e) {}
}

let activeUsers = [];

function getMemberRank(member) {
    const memberRoleNames = member.roles.cache.map(r => r.name);
    for (const roleName of ROLES_ORDER) {
        if (memberRoleNames.includes(roleName)) return roleName;
    }
    return member.roles.highest.name;
}

function getMemberWings(member) {
    let wings = [];
    member.roles.cache.forEach(role => {
        if (WINGS_MAP[role.id]) wings.push(WINGS_MAP[role.id]);
    });
    return wings;
}

// دالة لجلب وحساب الساعات تلقائياً من روم الديسكورد
async function syncHoursFromChannel(guild) {
    try {
        const channel = await guild.channels.fetch(HOURS_CHANNEL_ID).catch(() => null);
        if (!channel || !channel.isTextBased()) return;

        const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        if (!messages) return;

        messages.forEach(msg => {
            const userId = msg.author.id;
            // البحث عن أول رقم (سواء صحيح أو عشري) داخل الرسالة
            const match = msg.content.match(/\d+(\.\d+)?/);
            if (match) {
                const hoursParsed = parseFloat(match[0]);
                if (!dbData[userId]) dbData[userId] = { hours: 0, points: 0, reports: [] };
                
                // تحديث الساعات إذا كانت القيمة الجديدة أعلى أو غير مخصصة
                if (dbData[userId].hours === 0 || dbData[userId].hours < hoursParsed) {
                    dbData[userId].hours = hoursParsed;
                }
            }
        });
    } catch (err) {
        console.error("خطأ أثناء جلب الساعات من الروم:", err);
    }
}

async function fetchGuildMembers() {
    try {
        if (!client.isReady()) return;
        
        const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID);
        if (!guild) return;

        await syncHoursFromChannel(guild); // مزامنة الساعات قبل التجميع

        const members = await guild.members.fetch();
        let allPoliceList = [];
        let cadetsList = [];

        members.forEach(member => {
            if (member.user.bot) return;

            if (member.roles.cache.has(POLICE_ROLE_ID)) {
                if (!dbData[member.id]) {
                    dbData[member.id] = { hours: 0, points: 0, reports: [] };
                }

                const memberWings = getMemberWings(member);
                const memberRank = getMemberRank(member);

                const cadetData = {
                    discordId: member.id,
                    name: member.displayName || member.user.username,
                    rank: memberRank,
                    hours: dbData[member.id].hours || 0,
                    points: dbData[member.id].points || 0,
                    wings: memberWings,
                    wingsCount: memberWings.length,
                    reports: dbData[member.id].reports || []
                };

                allPoliceList.push(cadetData);

                if (member.roles.cache.some(role => CADET_ROLE_IDS.includes(role.id))) {
                    cadetsList.push(cadetData);
                }
            }
        });

        const sortByRank = (a, b) => {
            let indexA = ROLES_ORDER.indexOf(a.rank);
            let indexB = ROLES_ORDER.indexOf(b.rank);
            if (indexA === -1) indexA = 99;
            if (indexB === -1) indexB = 99;
            return indexA - indexB;
        };

        allPoliceList.sort(sortByRank);
        cadetsList.sort(sortByRank);

        saveData();

        io.emit('policeDataUpdate', {
            allPolice: allPoliceList,
            cadets: cadetsList
        });

    } catch (error) {
        console.error("خطأ أثناء جلب أعضاء السيرفر:", error);
    }
}

app.post('/api/update-member', (req, res) => {
    const { discordId, hours, points, newReport } = req.body;
    if (!discordId) return res.status(400).json({ error: "Missing discordId" });

    if (!dbData[discordId]) {
        dbData[discordId] = { hours: 0, points: 0, reports: [] };
    }

    if (hours !== undefined) dbData[discordId].hours = parseFloat(hours);
    if (points !== undefined) dbData[discordId].points = parseInt(points);
    if (newReport) {
        if (!dbData[discordId].reports) dbData[discordId].reports = [];
        dbData[discordId].reports.push({
            title: newReport.title,
            details: newReport.details,
            date: new Date().toLocaleDateString('ar-SA')
        });
    }

    saveData();
    fetchGuildMembers();
    res.json({ success: true, data: dbData[discordId] });
});

app.post('/api/login-request', (req, res) => {
    const { username, copyId } = req.body;
    let user = activeUsers.find(u => u.copyId === copyId);
    const isAutoApproved = ADMIN_IDS.includes(copyId);

    if (!user) {
        user = { username, copyId, approved: isAutoApproved, status: 'active', lastSeen: Date.now() };
        activeUsers.push(user);
    } else {
        user.username = username;
        if (isAutoApproved) user.approved = true;
        user.lastSeen = Date.now();
    }
    
    io.emit('usersUpdate', activeUsers);
    res.json({ approved: user.approved });
});

app.post('/api/check-session', (req, res) => {
    const { copyId } = req.body;
    if (ADMIN_IDS.includes(copyId)) {
        return res.json({ approved: true });
    }
    const user = activeUsers.find(u => u.copyId === copyId);
    res.json({ approved: user ? user.approved : false });
});

// أحداث Socket.io للتحكم في الطلبات والاتصال
io.on('connection', (socket) => {
    socket.emit('usersUpdate', activeUsers);
    fetchGuildMembers();

    // استقبال حدث قبول المستخدم من زر الموقع
    socket.on('approve-user', (copyId) => {
        const targetUser = activeUsers.find(u => u.copyId === copyId);
        if (targetUser) {
            targetUser.approved = true;
            io.emit('usersUpdate', activeUsers);
        }
    });

    // استقبال حدث رفض/حذف المستخدم
    socket.on('reject-user', (copyId) => {
        activeUsers = activeUsers.filter(u => u.copyId !== copyId);
        io.emit('usersUpdate', activeUsers);
    });
});

client.on('ready', () => {
    console.log(`[ONLINE SUCCESS] تم تسجيل دخول البوت: ${client.user.tag}`);
    fetchGuildMembers();
    setInterval(fetchGuildMembers, 60000);
});

const PORT = process.env.PORT || 3000;
client.login(TOKEN).catch(err => console.error("فشل تسجيل دخول البوت:", err.message));
server.listen(PORT, () => console.log(`السيرفر يعمل على المنفذ ${PORT}`));
