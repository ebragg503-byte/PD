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

// قائمة المعرفات الرئيسية للمسؤولين
const ADMIN_IDS = ['771747917040058388'];

// كود تسجيل الدخول السريع لصاحب الموقع (يمكنك تغييره إلى أي رمز تريده)
const OWNER_PASSCODE = 'SAW2026';

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

function parseDutyMessage(message) {
    let discordId = null;
    let totalHours = null;

    const fullText = getMessageFullText(message);

    const mentionMatch = fullText.match(/<@!?(\d+)>/);
    if (mentionMatch) {
        discordId = mentionMatch[1];
    } else {
        const idMatch = fullText.match(/Discord\s*[:|-]?\s*<@!?(\d+)>|Discord\s*[:|-]?\s*(\d{17,19})/i);
        if (idMatch) discordId = idMatch[1] || idMatch[2];
    }

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

async function fetchOldHoursMessages() {
    try {
        const channel = await client.channels.fetch(HOURS_CHANNEL_ID);
        if (!channel) return;

        let lastId;
        let fetchedCount = 0;
        const maxLimit = 10000;

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

function processPointsMessage(msg, emitUpdate = true) {
    const fullText = getMessageFullText(msg);

    const pointsMatch = fullText.match(/Points\s*:\s*(\d+)/i) || fullText.match(/النقاط\s*:\s*(\d+)/i);
    if (!pointsMatch) return;

    const pointsToAdd = parseInt(pointsMatch[1]);
    if (isNaN(pointsToAdd) || pointsToAdd <= 0) return;

    let targetUsers = new Set();

    if (msg.mentions && msg.mentions.users.size > 0) {
        msg.mentions.users.forEach(u => targetUsers.add(u.id));
    }

    const allIdMatches = fullText.matchAll(/<@!?(\d+)>/g);
    for (const match of allIdMatches) {
        targetUsers.add(match[1]);
    }

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

    if (msg.channel.id === POINTS_CHANNEL_ID) {
        processPointsMessage(msg, true);
    }

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

// حماية التعديل: التعديل مسموح فقط لمن يملك صلاحية admin
app.post('/api/update-cadet', (req, res) => {
    const { discordId, hours, points, reportTitle, reportContent, wings, editedBy, userCopyId } = req.body;
    
    // التحقق من أن منفذ الطلب يمتلك صلاحية التعديل
    const editor = users.find(u => u.copyId === userCopyId);
    const isOwner = ADMIN_IDS.includes(userCopyId);
    
    if (!isOwner && (!editor || editor.role !== 'admin' || !editor.approved)) {
        return res.status(403).json({ success: false, message: 'ليس لديك صلاحية التعديل (عرض فقط)' });
    }

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
            by: editedBy || (editor ? editor.username : 'Admin'),
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

// 1. تسجيل الدخول ودعم كود Owner Passcode
app.post('/api/login-request', (req, res) => {
    const { username, copyId, passcode } = req.body;

    // هل الدخول باستخدام كود صاحب الموقع المباشر؟
    const isOwnerPasscode = (passcode && passcode === OWNER_PASSCODE);
    const isOwnerId = ADMIN_IDS.includes(copyId);
    const isOwner = isOwnerPasscode || isOwnerId;

    let user = users.find(u => u.copyId === copyId);

    if (user) {
        if (isOwner) {
            user.approved = true;
            user.role = 'admin'; // صاحب الموقع له صلاحية تعديل كاملة
        }
        user.username = username || user.username;
        user.lastActive = Date.now();
        
        return res.json({ 
            success: true, 
            approved: user.approved, 
            role: user.role || 'viewer',
            isAdmin: isOwner || user.role === 'admin',
            user 
        });
    }

    // مستخدم جديد
    const newUser = {
        username: username || (isOwnerPasscode ? 'Owner' : 'User'),
        copyId: copyId || `OWNER-${Date.now()}`,
        approved: isOwner, // صاحب الموقع يتفعل تلقائياً، وغيره ينتظر الموافقة
        role: isOwner ? 'admin' : 'viewer', // الافتراضي للمستخدم الجديد عرض فقط حتى يتم قبوله
        status: 'active',
        lastActive: Date.now()
    };
    users.push(newUser);

    logs.unshift({
        id: Date.now(),
        by: newUser.username,
        action: isOwner ? 'Owner Auto Logged In' : 'New Login Request Pending',
        target: 'System',
        time: new Date().toLocaleString('en-US')
    });

    io.emit("usersUpdate", users);
    io.emit("logsUpdate", logs);

    res.json({ 
        success: true, 
        approved: newUser.approved, 
        role: newUser.role,
        isAdmin: isOwner, 
        user: newUser 
    });
});

// 2. قبول / رفض / تعديل صلاحية المستخدم (Admin أو Viewer)
app.post('/api/approve-user', (req, res) => {
    const { copyId, approve, role, adminName } = req.body;
    let user = users.find(u => u.copyId === copyId);

    if (user) {
        user.approved = approve;
        if (role) user.role = role; // تحديد الصلاحية: 'admin' (تعديل) أو 'viewer' (مشاهدة)

        logs.unshift({
            id: Date.now(),
            by: adminName || 'Admin',
            action: approve ? `Approved user access (${user.role || 'viewer'})` : 'Revoked user access',
            target: user.username,
            time: new Date().toLocaleString('en-US')
        });
        io.emit("usersUpdate", users);
        io.emit("logsUpdate", logs);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'User not found' });
    }
});

// 3. حذف أي مستخدم من النظام وسحب صلاحيته
app.post('/api/delete-user', (req, res) => {
    const { copyId, adminName } = req.body;

    if (ADMIN_IDS.includes(copyId)) {
        return res.status(403).json({ success: false, message: 'لا يمكنك حذف صاحب الموقع الرئيسي' });
    }

    const index = users.findIndex(u => u.copyId === copyId);

    if (index !== -1) {
        const deletedUser = users[index];
        users.splice(index, 1);

        logs.unshift({
            id: Date.now(),
            by: adminName || 'Admin',
            action: `Deleted Access & Account (${deletedUser.username})`,
            target: deletedUser.username,
            time: new Date().toLocaleString('en-US')
        });

        io.emit("usersUpdate", users);
        io.emit("logsUpdate", logs);

        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'User not found' });
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
