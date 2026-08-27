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
const ADS_CHANNEL_ID = '1521415106876014612'; 

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
        parts.push("[مرفق/صورة]");
    }
    return parts.length > 0 ? parts.join('\n') : "تقرير بدون نص";
}

// دالة متطورة لاستخراج المعرف والساعات من رسائل البوت والـ Embeds
function extractHoursAndUserId(msg) {
    let targetUserId = null;
    let calculatedHours = null;

    // 1. فحص الإشارات المباشرة
    if (msg.mentions && msg.mentions.users && msg.mentions.users.size > 0) {
        targetUserId = msg.mentions.users.first().id;
    }

    let fullText = msg.content || "";

    // 2. فحص الـ Embeds واستخراج المعرف والنصوص
    if (msg.embeds && msg.embeds.length > 0) {
        msg.embeds.forEach(emb => {
            if (emb.title) fullText += " " + emb.title;
            if (emb.description) fullText += " " + emb.description;
            if (emb.fields) {
                emb.fields.forEach(f => {
                    fullText += ` ${f.name} ${f.value}`;
                    const mentionMatch = f.value.match(/<@!?(\d{17,19})>/);
                    if (mentionMatch && !targetUserId) {
                        targetUserId = mentionMatch[1];
                    }
                });
            }
        });
    }

    // إذا لم ينتهي البحث إلى معرف، يتم البحث عن تسلسل أرقام الآيدي (17-19 رقم)
    if (!targetUserId) {
        const idMatches = fullText.match(/\b\d{17,19}\b/g);
        if (idMatches && idMatches.length > 0) {
            targetUserId = idMatches[0];
        } else {
            targetUserId = msg.author.id;
        }
    }

    // 3. استخراج الدقائق أو الساعات من النص
    const minutesMatch = fullText.match(/Total\s*Minutes\s*:?\s*(\d+)/i) || fullText.match(/دقائق\s*:?\s*(\d+)/i);
    const dutyTimeMatch = fullText.match(/Total\s*Duty\s*Time\s*:?\s*(\d+)h/i);

    if (minutesMatch) {
        calculatedHours = parseFloat((parseInt(minutesMatch[1], 10) / 60).toFixed(1));
    } else if (dutyTimeMatch) {
        calculatedHours = parseFloat(dutyTimeMatch[1]);
    } else {
        const hrsMatch = fullText.match(/(\d+(\.\d+)?)\s*(ساعة|ساعات|ساعه|hours|hrs|hour)/i);
        if (hrsMatch) {
            calculatedHours = parseFloat(hrsMatch[1]);
        }
    }

    return { targetUserId, hours: calculatedHours };
}

async function syncJoinDates(guild) {
    try {
        const channel = await guild.channels.fetch(ADS_CHANNEL_ID).catch(() => null);
        if (!channel || !channel.isTextBased()) return;

        let lastId;
        while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options).catch(() => null);
            if (!messages || messages.size === 0) break;

            messages.forEach(msg => {
                msg.mentions.users.forEach(user => {
                    if (!dbData[user.id]) dbData[user.id] = { hours: 0, points: 0, reports: [] };
                    if (!dbData[user.id].joinedTimestamp || msg.createdTimestamp < dbData[user.id].joinedTimestamp) {
                        dbData[user.id].joinedTimestamp = msg.createdTimestamp;
                    }
                });
            });

            lastId = messages.last().id;
            if (messages.size < 100) break;
        }
        saveData();
    } catch (err) {
        console.error("خطأ في جلب تواريخ الدخول من روم ADS:", err);
    }
}

// دالة جلب الأرشيف الكامل لقراءة الساعات والتقارير بدون الاعتماد على 100 رسالة فقط
async function fetchChannelHistory(channelId, isHours = false) {
    try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return;
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) return;

        let lastId;
        let fetchedCount = 0;
        const maxMessages = 500; // قراءة آخر 500 رسالة لضمان استيعاب كافة التسجيلات

        while (fetchedCount < maxMessages) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options).catch(() => null);
            if (!messages || messages.size === 0) break;

            messages.forEach(msg => {
                const fullText = getFullContent(msg);

                if (isHours) {
                    const { targetUserId, hours } = extractHoursAndUserId(msg);
                    if (targetUserId && hours !== null) {
                        if (!dbData[targetUserId]) dbData[targetUserId] = { hours: 0, points: 0, reports: [] };
                        dbData[targetUserId].hours = Math.max(dbData[targetUserId].hours || 0, hours);
                    }
                } else {
                    if (msg.author.bot) return;
                    const targetUserId = msg.mentions.users.first() ? msg.mentions.users.first().id : msg.author.id;
                    if (!dbData[targetUserId]) dbData[targetUserId] = { hours: 0, points: 0, reports: [] };
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

            fetchedCount += messages.size;
            lastId = messages.last().id;
            if (messages.size < 100) break;
        }

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

        const now = Date.now();

        members.forEach(member => {
            if (member.user.bot) return;

            if (member.roles.cache.has(POLICE_ROLE_ID)) {
                if (!dbData[member.id]) {
                    dbData[member.id] = { hours: 0, points: 0, reports: [] };
                }

                const memberWings = getMemberWings(member);
                const memberRank = getMemberRank(member);
                const isCadetRole = member.roles.cache.some(role => CADET_ROLE_IDS.includes(role.id));

                let joinedTs = now;
                if (isCadetRole) {
                    joinedTs = dbData[member.id].joinedTimestamp || member.joinedTimestamp || now;
                } else {
                    joinedTs = member.joinedTimestamp || dbData[member.id].joinedTimestamp || now;
                }

                const daysInPolice = Math.floor((now - joinedTs) / (1000 * 60 * 60 * 24));
                const joinedDateStr = new Date(joinedTs).toLocaleDateString('ar-SA');

                const cadetData = {
                    discordId: member.id,
                    name: member.displayName || member.user.username,
                    rank: memberRank,
                    hours: dbData[member.id] ? (dbData[member.id].hours || 0) : 0,
                    points: dbData[member.id] ? (dbData[member.id].points || 0) : 0,
                    wings: dbData[member.id].wings || memberWings,
                    wingsCount: (dbData[member.id].wings || memberWings).length,
                    reports: dbData[member.id] ? (dbData[member.id].reports || []) : [],
                    disabled: dbData[member.id] ? (dbData[member.id].disabled || false) : false,
                    joinedDate: joinedDateStr,
                    daysInPolice: daysInPolice >= 0 ? daysInPolice : 0
                };

                allPoliceList.push(cadetData);

                if (isCadetRole) {
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

client.on('messageCreate', async (message) => {
    if (message.channel.id === MDT_CHANNEL_ID) {
        if (message.author.bot) return;
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

    if (message.channel.id === HOURS_CHANNEL_ID) {
        const { targetUserId, hours } = extractHoursAndUserId(message);
        if (targetUserId && hours !== null) {
            if (!dbData[targetUserId]) dbData[targetUserId] = { hours: 0, points: 0, reports: [] };
            dbData[targetUserId].hours = Math.max(dbData[targetUserId].hours || 0, hours);
            saveData();
            fetchGuildMembers();
        }
    }

    if (message.channel.id === ADS_CHANNEL_ID) {
        message.mentions.users.forEach(user => {
            if (!dbData[user.id]) dbData[user.id] = { hours: 0, points: 0, reports: [] };
            if (!dbData[user.id].joinedTimestamp) {
                dbData[user.id].joinedTimestamp = message.createdTimestamp;
            }
        });
        saveData();
        fetchGuildMembers();
    }
});

function handleUpdateMemberData(data) {
    const { discordId, hours, points, disabled, wings, newReport, reportTitle, reportContent } = data;
    if (!discordId) return false;

    if (!dbData[discordId]) dbData[discordId] = { hours: 0, points: 0, reports: [] };

    if (hours !== undefined) dbData[discordId].hours = parseFloat(hours);
    if (points !== undefined) dbData[discordId].points = parseInt(points);
    if (disabled !== undefined) dbData[discordId].disabled = disabled;
    if (wings !== undefined) dbData[discordId].wings = wings;

    const repTitle = reportTitle || (newReport ? newReport.title : null);
    const repContent = reportContent || (newReport ? (newReport.details || newReport.text || newReport.content) : null);

    if (repTitle || repContent) {
        if (!dbData[discordId].reports) dbData[discordId].reports = [];
        dbData[discordId].reports.push({
            id: Date.now().toString(),
            title: repTitle || "تقرير MDT",
            details: repContent || "تفاصيل التقرير",
            text: repContent || "تفاصيل التقرير",
            description: repContent || "تفاصيل التقرير",
            content: repContent || "تفاصيل التقرير",
            date: new Date().toLocaleDateString('ar-SA')
        });
    }

    saveData();
    fetchGuildMembers();
    return true;
}

app.post('/api/update-member', (req, res) => {
    const success = handleUpdateMemberData(req.body);
    if (success) {
        res.json({ success: true, data: dbData[req.body.discordId] });
    } else {
        res.status(400).json({ error: "Missing discordId" });
    }
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

    socket.on('updateOfficer', (data) => {
        handleUpdateMemberData(data);
    });

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
    const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (guild) {
        await syncJoinDates(guild);
    }
    await fetchChannelHistory(HOURS_CHANNEL_ID, true);
    await fetchChannelHistory(MDT_CHANNEL_ID, false);
    fetchGuildMembers();
});

const PORT = process.env.PORT || 3000;
client.login(TOKEN).catch(err => console.error("فشل تسجيل دخول البوت:", err.message));
server.listen(PORT, () => console.log(`السيرفر يعمل على المنفذ ${PORT}`));
