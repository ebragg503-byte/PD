const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = '1517858234378227834';
const CADET_ROLE_ID = '1520526818225164329';
const SOLO_CADET_ROLE_ID = '1522994966597468191';

const REPORTS_CHANNEL_ID = '1520998767325741148';
const HOURS_CHANNEL_ID = '1530564311217471639';
const POINTS_CHANNEL_ID = '1523610705742266378';
const WINGS_CHANNEL_ID = '1520527213597032558';

const ADMIN_IDS = ['771747917040058388'];

let cadetsData = [];
let users = [];
let logs = [];

const ALL_WINGS = [
    { id: "motorcycle", name: "MotorCycle Wing", icon: "fa-motorcycle" },
    { id: "airship", name: "Airship Wing", icon: "fa-plane-departure" },
    { id: "navigation", name: "Navigation Wing", icon: "fa-compass" },
    { id: "dispatch", name: "Dispatch Wing", icon: "fa-headset" },
    { id: "interceptor", name: "Interceptor Wing", icon: "fa-car-burst" }
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// دالة شاملة لاستخراج النصوص كاملة من الرسالة سواء نص عادي أو Embed
function getMessageFullText(message) {
    let text = message.content || '';
    if (message.embeds && message.embeds.length > 0) {
        message.embeds.forEach(e => {
            text += ' ' + (e.title || '') + ' ' + (e.description || '');
            if (e.fields) e.fields.forEach(f => text += ` ${f.name} ${f.value}`);
        });
    }
    return text;
}

// دالة استخراج بيانات ساعات الخدمة
function parseDutyMessage(message) {
    let discordId = null;
    let totalHours = null;

    const fullText = getMessageFullText(message);

    // 1. استخراج Discord ID
    const mentionMatch = fullText.match(/<@!?(\d+)>/);
    if (mentionMatch) {
        discordId = mentionMatch[1];
    } else {
        const idMatch = fullText.match(/Discord\s*[:|-]?\s*<@!?(\d+)>|Discord\s*[:|-]?\s*(\d{17,19})/i);
        if (idMatch) discordId = idMatch[1] || idMatch[2];
    }

    // 2. قراءة الساعات والدقائق
    const minutesMatch = fullText.match(/Total Minutes\s*[\r\n]*\s*(\d+)/i) || fullText.match(/Time In Server\s*[\r\n]*\s*(\d+)m/i);
    if (minutesMatch) {
        totalHours = parseFloat((parseInt(minutesMatch[1]) / 60).toFixed(2));
    } else {
        const dutyTimeMatch = fullText.match(/(?:Total Duty Time|Time In Server)\s*[\r\n]*\s*(\d+)h\s*(\d+)m/i);
        if (dutyTimeMatch) {
            const hrs = parseInt(dutyTimeMatch[1]);
            const mins = parseInt(dutyTimeMatch[2]);
            totalHours = parseFloat((hrs + (mins / 60)).toFixed(2));
        } else {
            const pureHoursMatch = fullText.match(/Total Duty Time\s*[\r\n]*\s*(\d+(?:\.\d+)?)h/i);
            if (pureHoursMatch) {
                totalHours = parseFloat(pureHoursMatch[1]);
            }
        }
    }

    return { discordId, totalHours };
}

function syncMember(member) {
    const isCadet = member.roles.cache.has(CADET_ROLE_ID);
    const isSolo = member.roles.cache.has(SOLO_CADET_ROLE_ID);
    const index = cadetsData.findIndex(c => c.discordId === member.id);

    if (isCadet || isSolo) {
        const rank = isSolo ? 'Solo Cadet' : 'Cadet';
        const name = member.displayName || member.user.username;

        if (index !== -1) {
            cadetsData[index].name = name;
            cadetsData[index].rank = rank;
            cadetsData[index].status = 'active';
        } else {
            cadetsData.push({
                discordId: member.id,
                name: name,
                rank: rank,
                hours: 0,
                points: 0,
                reports: [],
                wings: [],
                status: 'active'
            });
        }
    } else {
        if (index !== -1) {
            cadetsData.splice(index, 1);
        }
    }
}

// دالة جلب كافة الرسائل القديمة من روم الساعات بدون حد 500 رسالة
async function fetchOldHoursMessages() {
    try {
        const channel = await client.channels.fetch(HOURS_CHANNEL_ID);
        if (!channel) return;

        let lastId;
        let fetchedCount = 0;
        const maxLimit = 10000; // جلب حتى 10 آلاف رسالة قديمة لتشغيل كافة الساعات القديمة

        console.log("⏳ Syncing all old duty hours messages...");

        while (fetchedCount < maxLimit) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) break;

            messages.forEach(msg => {
                const { discordId, totalHours } = parseDutyMessage(msg);
                if (discordId && totalHours !== null) {
                    let cadet = cadetsData.find(c => c.discordId === discordId);
                    if (cadet) {
                        if (totalHours > cadet.hours) {
                            cadet.hours = totalHours;
                        }
                    }
                }
            });

            lastId = messages.last().id;
            fetchedCount += messages.size;
        }

        console.log(`✅ Sync completed! Fetched ${fetchedCount} hours messages.`);
        io.emit("cadetsUpdate", cadetsData);
    } catch (e) {
        console.error("Error fetching old messages:", e);
    }
}

// دالة جلب النقاط القديمة أيضاً
async function fetchOldPointsMessages() {
    try {
        const channel = await client.channels.fetch(POINTS_CHANNEL_ID);
        if (!channel) return;

        let lastId;
        let fetchedCount = 0;

        console.log("⏳ Syncing old points messages...");

        while (fetchedCount < 2000) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) break;

            messages.forEach(msg => {
                processPointsMessage(msg, false);
            });

            lastId = messages.last().id;
            fetchedCount += messages.size;
        }

        console.log("✅ Points sync completed!");
        io.emit("cadetsUpdate", cadetsData);
    } catch (e) {
        console.error("Error fetching old points messages:", e);
    }
}

// دالة معالجة إضافة النقاط
function processPointsMessage(msg, emitUpdate = true) {
    const fullText = getMessageFullText(msg);

    const pointsMatch = fullText.match(/Points\s*:\s*(\d+)/i) || fullText.match(/النقاط\s*:\s*(\d+)/i);
    if (!pointsMatch) return;

    const pointsToAdd = parseInt(pointsMatch[1]);
    if (isNaN(pointsToAdd) || pointsToAdd <= 0) return;

    // استخراج جميع الـ Mentions والـ Discord IDs المذكورة في الرسالة
    let targetUsers = new Set();

    // 1. من خلال mentions الرسمية
    if (msg.mentions && msg.mentions.users.size > 0) {
        msg.mentions.users.forEach(u => targetUsers.add(u.id));
    }

    // 2. من خلال البحث عن أرقام المعرفات داخل النص مباشرة
    const allIdMatches = fullText.matchAll(/<@!?(\d+)>/g);
    for (const match of allIdMatches) {
        targetUsers.add(match[1]);
    }

    // إضافة النقاط للضباط المحددين
    targetUsers.forEach(userId => {
        let cadet = cadetsData.find(c => c.discordId === userId && c.status === 'active');
        if (cadet) {
            cadet.points = (cadet.points || 0) + pointsToAdd;
            if (emitUpdate) {
                logs.unshift({
                    id: Date.now(),
                    by: msg.author.username || 'Points Bot',
                    action: `Added (${pointsToAdd}) points automatically`,
                    target: cadet.name,
                    time: new Date().toLocaleString('en-US')
                });
            }
        }
    });

    if (emitUpdate) {
        io.emit("cadetsUpdate", cadetsData);
        io.emit("logsUpdate", logs);
    }
}

client.once('ready', async () => {
    console.log(`🤖 Bot online as ${client.user.tag}`);
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();
        cadetsData = [];
        members.forEach(m => syncMember(m));

        // جلب الرسائل والنقاط القديمة
        await fetchOldHoursMessages();
        await fetchOldPointsMessages();

        io.emit("cadetsUpdate", cadetsData);
    } catch (e) {
        console.error("Sync error:", e);
    }
});

client.on('guildMemberUpdate', (oldM, newM) => {
    syncMember(newM);
    io.emit("cadetsUpdate", cadetsData);
});

client.on('messageCreate', msg => {
    // 1. استقبال تحديثات الساعات التلقائية
    if (msg.channel.id === HOURS_CHANNEL_ID) {
        const { discordId, totalHours } = parseDutyMessage(msg);

        if (discordId && totalHours !== null) {
            let cadet = cadetsData.find(c => c.discordId === discordId && c.status === 'active');
            if (cadet) {
                cadet.hours = totalHours;
                logs.unshift({
                    id: Date.now(),
                    by: 'Duty System',
                    action: `Updated total hours to (${totalHours} hrs)`,
                    target: cadet.name,
                    time: new Date().toLocaleString('en-US')
                });
                io.emit("cadetsUpdate", cadetsData);
                io.emit("logsUpdate", logs);
            }
        }
    }

    // 2. استقبال النقاط التلقائية
    if (msg.channel.id === POINTS_CHANNEL_ID) {
        processPointsMessage(msg, true);
    }

    // 3. استقبال تعيين الوينقات أوتوماتيكياً
    if (msg.channel.id === WINGS_CHANNEL_ID) {
        const fullText = getMessageFullText(msg);

        let targetUsers = new Set();
        if (msg.mentions && msg.mentions.users.size > 0) {
            msg.mentions.users.forEach(u => targetUsers.add(u.id));
        }
        const allIdMatches = fullText.matchAll(/<@!?(\d+)>/g);
        for (const match of allIdMatches) {
            targetUsers.add(match[1]);
        }

        if (targetUsers.size > 0) {
            const matchedWing = ALL_WINGS.find(w => 
                fullText.toLowerCase().includes(w.id.toLowerCase()) || 
                fullText.toLowerCase().includes(w.name.toLowerCase())
            );

            if (matchedWing) {
                targetUsers.forEach(userId => {
                    let cadet = cadetsData.find(c => c.discordId === userId && c.status === 'active');
                    if (cadet) {
                        if (!cadet.wings) cadet.wings = [];
                        if (!cadet.wings.includes(matchedWing.id)) {
                            cadet.wings.push(matchedWing.id);
                            logs.unshift({
                                id: Date.now(),
                                by: msg.author.username || 'Wing System',
                                action: `Assigned wing (${matchedWing.name}) automatically`,
                                target: cadet.name,
                                time: new Date().toLocaleString('en-US')
                            });
                        }
                    }
                });
                io.emit("cadetsUpdate", cadetsData);
                io.emit("logsUpdate", logs);
            }
        }
    }

    if (msg.author.bot) return;

    // 4. استقبال التقارير التلقائية
    if (msg.channel.id === REPORTS_CHANNEL_ID) {
        let cadet = cadetsData.find(c => c.discordId === msg.author.id && c.status === 'active');
        if (!cadet) return;

        cadet.reports.push({
            id: msg.id,
            title: msg.content.slice(0, 40) || 'New Report',
            content: msg.content,
            date: new Date().toLocaleDateString('en-US')
        });
        logs.unshift({
            id: Date.now(),
            by: msg.author.username,
            action: `Automatically added MDT Report`,
            target: cadet.name,
            time: new Date().toLocaleString('en-US')
        });
        io.emit("cadetsUpdate", cadetsData);
        io.emit("logsUpdate", logs);
    }
});

// API Routes
app.get('/api/cadets', (req, res) => res.json(cadetsData));

app.post('/api/update-cadet', (req, res) => {
    const { discordId, hours, points, reportTitle, reportContent, wings, editedBy } = req.body;
    let cadet = cadetsData.find(c => c.discordId === discordId);

    if (!cadet) return res.status(404).json({ success: false, message: 'Cadet not found' });

    let changes = [];

    if (hours !== undefined && hours !== '') {
        changes.push(`Updated hours to (${hours})`);
        cadet.hours = parseFloat(hours);
    }

    if (points !== undefined && points !== '') {
        changes.push(`Updated points to (${points})`);
        cadet.points = parseInt(points);
    }

    if (wings !== undefined) {
        cadet.wings = wings;
        changes.push(`Updated wings`);
    }

    if (reportTitle || reportContent) {
        cadet.reports.push({
            id: Date.now().toString(),
            title: reportTitle || 'Manual Report',
            content: reportContent || '-',
            date: new Date().toLocaleDateString('en-US')
        });
        changes.push(`Added manual report`);
    }

    if (changes.length > 0) {
        logs.unshift({
            id: Date.now(),
            by: editedBy || 'Admin',
            action: changes.join(' | '),
            target: cadet.name,
            time: new Date().toLocaleString('en-US')
        });
    }

    io.emit("cadetsUpdate", cadetsData);
    io.emit("logsUpdate", logs);
    res.json({ success: true });
});

app.get('/api/logs', (req, res) => res.json(logs));

app.post('/api/login-request', (req, res) => {
    const { username, copyId } = req.body;
    let user = users.find(u => u.copyId === copyId);

    const isAdmin = ADMIN_IDS.includes(copyId);

    if (user) {
        if (isAdmin) user.approved = true;
        user.username = username || user.username;
        user.lastActive = Date.now();
        
        return res.json({ 
            success: true, 
            approved: user.approved, 
            isAdmin: isAdmin,
            user 
        });
    }

    const newUser = {
        username,
        copyId,
        approved: isAdmin,
        status: 'active',
        lastActive: Date.now()
    };
    users.push(newUser);

    logs.unshift({
        id: Date.now(),
        by: username,
        action: isAdmin ? 'Admin Auto Logged In' : 'New Login Request',
        target: 'System',
        time: new Date().toLocaleString('en-US')
    });

    io.emit("usersUpdate", users);
    io.emit("logsUpdate", logs);

    res.json({ 
        success: true, 
        approved: newUser.approved, 
        isAdmin: isAdmin, 
        user: newUser 
    });
});

app.post('/api/approve-user', (req, res) => {
    const { copyId, approve, adminName } = req.body;
    let user = users.find(u => u.copyId === copyId);

    if (user) {
        user.approved = approve;
        logs.unshift({
            id: Date.now(),
            by: adminName || 'Admin',
            action: approve ? 'User Access Approved' : 'User Access Revoked',
            target: user.username,
            time: new Date().toLocaleString('en-US')
        });
        io.emit("usersUpdate", users);
        io.emit("logsUpdate", logs);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false });
    }
});

app.post('/api/user-heartbeat', (req, res) => {
    const { copyId, status } = req.body;
    let user = users.find(u => u.copyId === copyId);
    if (user) {
        user.status = status;
        user.lastActive = Date.now();
        io.emit("usersUpdate", users);
    }
    res.json({ success: true });
});

app.get('/api/users', (req, res) => res.json(users));
app.get('/api/wings-list', (req, res) => res.json(ALL_WINGS));

setInterval(() => {
    const now = Date.now();
    let updated = false;
    users.forEach(u => {
        if (u.status !== 'no-active' && (now - u.lastActive > 30000)) {
            u.status = 'no-active';
            updated = true;
        }
    });
    if (updated) io.emit("usersUpdate", users);
}, 15000);

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send("Error: index.html was not found in public directory.");
    }
});

server.listen(PORT, () => console.log(`Server started on port ${PORT}`));

if (BOT_TOKEN) {
    client.login(BOT_TOKEN);
} else {
    console.log("⚠️ No BOT_TOKEN provided in environment variables.");
}
