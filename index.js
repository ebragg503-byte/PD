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
const HOURS_CHANNEL_ID = '1530564311217471639'; 
const MDT_CHANNEL_ID = '1536506668039274556'; 

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
let cachedPoliceList = [];
let cachedCadetsList = [];

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

// دالة استخراج النص الكامل للرسالة شاملاً الـ Embeds والمرفقات لضمان عرض ما كتبه العسكري
function getFullContent(msg) {
    let parts = [];
    if (msg.content && msg.content.trim() !== "") {
        parts.push(msg.content.trim());
    }
    if (msg.embeds && msg.embeds.length > 0) {
        msg.embeds.forEach(emb => {
            if (emb.title) parts.push(`[${emb.title}]`);
            if (emb.description) parts.push(emb.description);
            if (emb.fields) {
                emb.fields.forEach(f => parts.push(`${f.name}: ${f.value}`));
            }
        });
    }
    if (msg.attachments && msg.attachments.size > 0) {
        parts.push("[يحتوي على صورة/مرفق]");
    }
    return parts.length > 0 ? parts.join('\n') : "رسالة فارغة";
}

// استخراج الساعات بشكل مرن ومباشر
function extractHours(text) {
    if (!text) return null;
    
    // البحث عن أرقام بجانب كلمة ساعة أو hours
    const keywordMatch = text.match(/(\d+(\.\d+)?)\s*(ساعة|ساعات|ساعه|hours|hrs|hour)/i);
    if (keywordMatch) return parseFloat(keywordMatch[1]);

    // إذا لم يجد كلمة، يأخذ أي رقم منطقي مباشر بالرسالة
    const numbers = text.match(/\d+(\.\d+)?/g);
    if (numbers) {
        for (let numStr of numbers) {
            let val = parseFloat(numStr);
            // تجاهل أرقام الـ IDs الطويلة وركز على الساعات
            if (val > 0 && val < 1000 && numStr.length < 6) {
                return val;
            }
        }
    }
    return null;
}

// جلب الأرشيف القديم للرومات
async function fetchChannelHistory(channelId, isHours = false) {
    try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return;
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) return;

        const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        if (!messages) return;

        messages.forEach(msg => {
            if (msg.author.bot) return;

            const targetUserId = msg.mentions.users.first() ? msg.mentions.users.first().id : msg.author.id;
            if (!dbData[targetUserId]) dbData[targetUserId] = { hours: 0, points: 0, reports: [] };

            const fullText = getFullContent(msg);

            if (isHours) {
                const hrs = extractHours(fullText);
                if (hrs !== null) {
                    dbData[targetUserId].hours = Math.max(dbData[targetUserId].hours || 0, hrs);
                }
            } else {
                if (!dbData[targetUserId].reports) dbData[targetUserId].reports = [];
                const exists = dbData[targetUserId].reports.some(r => r.id === msg.id);
                if (!exists) {
                    dbData[targetUserId].reports.push({
                        id: msg.id,
                        title: `تقرير MDT`,
                        details: fullText,
                        text: fullText,
                        description: fullText,
                        content: fullText,
                        date: new Date(msg.createdTimestamp).toLocaleDateString('ar-SA')
                    });
                }
            }
        });
        saveData();
    } catch (e) {
        console.error("خطأ قراءة الأرشيف:", e);
    }
}

async function fetchGuildMembers() {
    try {
        if (!client.isReady()) return;
        
        const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID);
        if (!guild) return;

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
                    hours: dbData[member.id] ? (dbData[member.id].hours || 0) : 0,
                    points: dbData[member.id] ? (dbData[member.id].points || 0) : 0,
                    wings: memberWings,
                    wingsCount: memberWings.length,
                    reports: dbData[member.id] ? (dbData[member.id].reports || []) : []
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

        cachedPoliceList = allPoliceList;
        cachedCadetsList = cadetsList;

        saveData();

        io.emit('policeDataUpdate', {
            allPolice: cachedPoliceList,
            cadets: cachedCadetsList
        });

    } catch (error) {
        console.error("خطأ جلب الأعضاء:", error);
    }
}

// الاستجابة المباشرة للرسائل الجديدة
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // روم الـ MDT
    if (message.channel.id === MDT_CHANNEL_ID) {
        const userId = message.mentions.users.first() ? message.mentions.users.first().id : message.author.id;
        if (!dbData[userId]) dbData[userId] = { hours: 0, points: 0, reports: [] };
        if (!dbData[userId].reports) dbData[userId].reports = [];

        const fullText = getFullContent(message);

        dbData[userId].reports.push({
            id: message.id,
            title: `تقرير MDT`,
            details: fullText,
            text: fullText,
            description: fullText,
            content: fullText,
            date: new Date().toLocaleDateString('ar-SA')
        });

        saveData();
        fetchGuildMembers();
    }

    // روم الساعات
    if (message.channel.id === HOURS_CHANNEL_ID) {
        const userId = message.mentions.users.first() ? message.mentions.users.first().id : message.author.id;
        const fullText = getFullContent(message);
        const hrs = extractHours(fullText);

        if (hrs !== null) {
            if (!dbData[userId]) dbData[userId] = { hours: 0, points: 0, reports: [] };
            dbData[userId].hours = Math.max(dbData[userId].hours || 0, hrs);
            saveData();
            fetchGuildMembers();
        }
    }
});

app.post('/api/update-member', (req, res) => {
    const { discordId, hours, points, newReport } = req.body;
    if (!discordId) return res.status(400).json({ error: "Missing discordId" });

    if (!dbData[discordId]) dbData[discordId] = { hours: 0, points: 0, reports: [] };

    if (hours !== undefined) dbData[discordId].hours = parseFloat(hours);
    if (points !== undefined) dbData[discordId].points = parseInt(points);
    if (newReport) {
        if (!dbData[discordId].reports) dbData[discordId].reports = [];
        const reportContent = newReport.details || newReport.text || newReport.content || "تقرير جديد";
        dbData[discordId].reports.push({
            id: Date.now().toString(),
            title: newReport.title || "تقرير MDT",
            details: reportContent,
            text: reportContent,
            description: reportContent,
            content: reportContent,
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
    if (ADMIN_IDS.includes(copyId)) return res.json({ approved: true });
    const user = activeUsers.find(userObj => userObj.copyId === copyId);
    res.json({ approved: user ? user.approved : false });
});

io.on('connection', (socket) => {
    socket.emit('usersUpdate', activeUsers);
    
    if (cachedPoliceList.length > 0) {
        socket.emit('policeDataUpdate', {
            allPolice: cachedPoliceList,
            cadets: cachedCadetsList
        });
    } else {
        fetchGuildMembers();
    }

    socket.on('approve-user', (copyId) => {
        const targetUser = activeUsers.find(u => u.copyId === copyId);
        if (targetUser) {
            targetUser.approved = true;
            io.emit('usersUpdate', activeUsers);
        }
    });

    socket.on('reject-user', (copyId) => {
        activeUsers = activeUsers.filter(u => u.copyId !== copyId);
        io.emit('usersUpdate', activeUsers);
    });

    socket.on('delete-report', ({ discordId, reportId, reportIndex }) => {
        if (dbData[discordId] && dbData[discordId].reports) {
            if (reportId) {
                dbData[discordId].reports = dbData[discordId].reports.filter(r => r.id !== reportId);
            } else if (reportIndex !== undefined) {
                dbData[discordId].reports.splice(reportIndex, 1);
            }
            saveData();
            fetchGuildMembers();
        }
    });
});

client.on('ready', async () => {
    console.log(`[ONLINE SUCCESS] تم تسجيل دخول البوت: ${client.user.tag}`);
    await fetchChannelHistory(HOURS_CHANNEL_ID, true);
    await fetchChannelHistory(MDT_CHANNEL_ID, false);
    fetchGuildMembers();
});

const PORT = process.env.PORT || 3000;
client.login(TOKEN).catch(err => console.error("فشل تسجيل دخول البوت:", err.message));
server.listen(PORT, () => console.log(`السيرفر يعمل على المنفذ ${PORT}`));
