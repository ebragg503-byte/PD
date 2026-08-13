const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
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
const MASTER_PASSCODE = process.env.MASTER_PASSCODE || "SAW123456";

// إعدادات التخزين السحابي JSONBin
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const USERS_BIN_ID = process.env.USERS_BIN_ID;
const LOGS_BIN_ID = process.env.LOGS_BIN_ID;

let users = [];
let logs = [];
let cadetsData = [];

// دالة فرز وترتيب العسكريين (Solo Cadet أولاً ثم حسب الأرقام)
function sortCadets() {
    cadetsData.sort((a, b) => {
        if (a.rank === 'Solo Cadet' && b.rank !== 'Solo Cadet') return -1;
        if (a.rank !== 'Solo Cadet' && b.rank === 'Solo Cadet') return 1;

        const numA = parseInt((a.name.match(/\d+/) || [0])[0]);
        const numB = parseInt((b.name.match(/\d+/) || [0])[0]);

        if (numA !== numB) {
            return numA - numB;
        }

        return a.name.localeCompare(b.name);
    });
}

// دالة جلب البيانات من JSONBin مع الحماية
async function loadCloudData() {
    if (!JSONBIN_API_KEY || !USERS_BIN_ID) {
        console.log("⚠️ JSONBin Variables missing. Running with local memory.");
        return;
    }
    try {
        const resUsers = await axios.get(`https://api.jsonbin.io/v3/b/${USERS_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_API_KEY }
        });
        
        const fetchedUsers = resUsers.data.record;
        users = Array.isArray(fetchedUsers) ? fetchedUsers : [];

        if (LOGS_BIN_ID) {
            const resLogs = await axios.get(`https://api.jsonbin.io/v3/b/${LOGS_BIN_ID}/latest`, {
                headers: { 'X-Master-Key': JSONBIN_API_KEY }
            });
            const fetchedLogs = resLogs.data.record;
            logs = Array.isArray(fetchedLogs) ? fetchedLogs : [];
        }
        console.log(`✅ Loaded ${users.length} users and ${logs.length} logs from Cloud.`);
    } catch (e) {
        console.error("Error loading Cloud Data:", e.message);
        users = [];
        logs = [];
    }
}

async function saveUsers() {
    if (!JSONBIN_API_KEY || !USERS_BIN_ID) return;
    try {
        await axios.put(`https://api.jsonbin.io/v3/b/${USERS_BIN_ID}`, users, {
            headers: { 
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_API_KEY 
            }
        });
    } catch (e) {
        console.error("Error saving users to cloud:", e.message);
    }
}

async function saveLogs() {
    if (!JSONBIN_API_KEY || !LOGS_BIN_ID) return;
    try {
        await axios.put(`https://api.jsonbin.io/v3/b/${LOGS_BIN_ID}`, logs, {
            headers: { 
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_API_KEY 
            }
        });
    } catch (e) {
        console.error("Error saving logs to cloud:", e.message);
    }
}

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

// دالة معدلة لاستخراج كافة النصوص والحقول داخل الـ Embed
function getMessageFullText(message) {
    let text = message.content || '';
    if (message.embeds && message.embeds.length > 0) {
        message.embeds.forEach(e => {
            if (e.title) text += '\n' + e.title;
            if (e.description) text += '\n' + e.description;
            if (e.author && e.author.name) text += '\n' + e.author.name;
            if (e.footer && e.footer.text) text += '\n' + e.footer.text;
            if (e.fields && e.fields.length > 0) {
                e.fields.forEach(f => {
                    text += `\n${f.name}: ${f.value}`;
                });
            }
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
            const pureHoursMatch = fullText.match(/Total Duty Time\s*[\r\n]*\s*(\d+(?:\.\d+)?)h/i) || fullText.match(/(\d+(?:\.\d+)?)\s*س/i);
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

        sortCadets();
        io.emit("cadetsUpdate", cadetsData);
    } catch (e) {
        console.error("Error fetching old hours messages:", e);
    }
}

// دالة معالجة واستخراج صاحب التقرير بدقة عالية
function processReportMessage(msg, emitUpdate = true) {
    const fullText = getMessageFullText(msg);
    if (!fullText.trim()) return;

    let targetCadet = null;

    // 1. إذا كانت الرسالة مرسلة من حساب العسكري المباشر
    if (msg.author && !msg.author.bot) {
        targetCadet = cadetsData.find(c => c.discordId === msg.author.id && c.status === 'active');
    }

    // 2. إذا كانت الرسالة من بوت أو Webhook
    if (!targetCadet) {
        // أ) مطابقة عبر Discord ID داخل المنشن
        const allMentions = [...fullText.matchAll(/<@!?(\d+)>/g)].map(m => m[1]);
        if (allMentions.length > 0) {
            for (const id of allMentions) {
                const found = cadetsData.find(c => c.discordId === id && c.status === 'active');
                if (found) {
                    targetCadet = found;
                    break;
                }
            }
        }
    }

    // ب) مطابقة عن طريق الرقم العسكري أو الاسم الصريح داخل التقرير
    if (!targetCadet) {
        targetCadet = cadetsData.find(c => {
            if (c.status !== 'active') return false;
            
            const cadetNum = (c.name.match(/\d+/) || [])[0];
            if (cadetNum && fullText.includes(cadetNum)) {
                return true;
            }

            const cleanName = c.name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
            if (cleanName.length > 2 && fullText.toLowerCase().includes(cleanName.toLowerCase())) {
                return true;
            }

            return false;
        });
    }

    if (!targetCadet) return;

    // استخراج اسم القضية / عنوان التقرير
    const caseNameMatch = fullText.match(/Case Name\s*:\s*([^\n\r]+)/i) || fullText.match(/Title\s*:\s*([^\n\r]+)/i);
    const reportTitle = caseNameMatch ? caseNameMatch[1].trim() : 'تقرير MDT';

    // منع التكرار
    if (!targetCadet.reports.some(r => r.id === msg.id)) {
        targetCadet.reports.push({
            id: msg.id,
            title: reportTitle,
            content: fullText.slice(0, 180) || 'محتوى التقرير',
            date: new Date(msg.createdTimestamp || Date.now()).toLocaleDateString('en-US')
        });

        if (emitUpdate) {
            logs.unshift({
                id: Date.now(),
                by: targetCadet.name,
                action: `Submitted MDT Report (${reportTitle})`,
                target: targetCadet.name,
                time: new Date().toLocaleString('en-US')
            });
            saveLogs();
        }
    }

    if (emitUpdate) {
        sortCadets();
        io.emit("cadetsUpdate", cadetsData);
        io.emit("logsUpdate", logs);
    }
}

async function fetchOldReportsMessages() {
    try {
        const channel = await client.channels.fetch(REPORTS_CHANNEL_ID);
        if (!channel) return;

        let lastId;
        let fetchedCount = 0;

        while (fetchedCount < 2000) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) break;

            messages.forEach(msg => {
                processReportMessage(msg, false);
            });

            lastId = messages.last().id;
            fetchedCount += messages.size;
        }

        sortCadets();
        io.emit("cadetsUpdate", cadetsData);
    } catch (e) {
        console.error("Error fetching old reports:", e);
    }
}

async function fetchOldPointsMessages() {
    try {
        const channel = await client.channels.fetch(POINTS_CHANNEL_ID);
        if (!channel) return;

        let lastId;
        let fetchedCount = 0;

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

        sortCadets();
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
                saveLogs();
            }
        }
    });

    if (emitUpdate) {
        sortCadets();
        io.emit("cadetsUpdate", cadetsData);
        io.emit("logsUpdate", logs);
    }
}

client.once('ready', async () => {
    console.log(`🤖 Bot online as ${client.user.tag}`);
    await loadCloudData();

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();
        cadetsData = [];
        members.forEach(m => syncMember(m));

        sortCadets();
        io.emit("cadetsUpdate", cadetsData);
        io.emit("usersUpdate", users);

        fetchOldHoursMessages();
        fetchOldPointsMessages();
        fetchOldReportsMessages();

    } catch (e) {
        console.error("Sync error:", e);
    }
});

client.on('guildMemberUpdate', (oldM, newM) => {
    syncMember(newM);
    sortCadets();
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
                saveLogs();
                sortCadets();
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
                            saveLogs();
                        }
                    }
                });
                sortCadets();
                io.emit("cadetsUpdate", cadetsData);
                io.emit("logsUpdate", logs);
            }
        }
    }

    if (msg.channel.id === REPORTS_CHANNEL_ID) {
        processReportMessage(msg, true);
    }
});

// API Endpoints
app.get('/api/cadets', (req, res) => {
    sortCadets();
    res.json(cadetsData);
});

app.post('/api/update-cadet', (req, res) => {
    const { discordId, hours, points, reportTitle, reportContent, wings, editedBy, requesterId } = req.body;
    
    if (!Array.isArray(users)) users = [];
    const requester = users.find(u => u.copyId === requesterId?.trim());
    if (!requester || !requester.approved || (requester.role !== 'admin' && requester.role !== 'editor')) {
        return res.status(403).json({ success: false, message: 'ليس لديك صلاحية التعديل' });
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
            by: editedBy || requester.username || 'Admin',
            action: changes.join(' | '),
            target: cadet.name,
            time: new Date().toLocaleString('en-US')
        });
        saveLogs();
    }

    sortCadets();
    io.emit("cadetsUpdate", cadetsData);
    io.emit("logsUpdate", logs);
    res.json({ success: true });
});

app.get('/api/logs', (req, res) => res.json(logs));

app.post('/api/login-request', (req, res) => {
    const { username, copyId, secretCode } = req.body;

    if (!Array.isArray(users)) users = [];

    const cleanCopyId = copyId ? copyId.trim() : '';
    const isMaster = secretCode && secretCode.trim() === MASTER_PASSCODE;
    const isOwnerId = ADMIN_IDS.includes(cleanCopyId);
    const isAdmin = isMaster || isOwnerId;

    let user = users.find(u => u.copyId === cleanCopyId);

    if (user) {
        if (isAdmin) {
            user.approved = true;
            user.role = 'admin';
        }
        if (username) user.username = username;
        user.lastActive = Date.now();
        
        saveUsers();

        return res.json({ 
            success: true, 
            approved: user.approved, 
            isAdmin: user.role === 'admin',
            role: user.role || 'viewer',
            user 
        });
    }

    const newUser = {
        username: username || (isAdmin ? 'Owner' : 'User'),
        copyId: cleanCopyId,
        approved: isAdmin,
        role: isAdmin ? 'admin' : 'viewer',
        status: 'active',
        lastActive: Date.now()
    };
    users.push(newUser);
    saveUsers();

    logs.unshift({
        id: Date.now(),
        by: newUser.username,
        action: isAdmin ? 'Owner/Admin Direct Login' : 'New Login Request (Pending Approval)',
        target: 'System',
        time: new Date().toLocaleString('en-US')
    });
    saveLogs();

    io.emit("usersUpdate", users);
    io.emit("logsUpdate", logs);

    res.json({ 
        success: true, 
        approved: newUser.approved, 
        isAdmin: newUser.role === 'admin', 
        role: newUser.role,
        user: newUser 
    });
});

app.post('/api/approve-user', (req, res) => {
    const { copyId, approve, adminName, role } = req.body;
    if (!Array.isArray(users)) users = [];
    let user = users.find(u => u.copyId === copyId?.trim());

    if (user) {
        user.approved = approve;
        if (role) user.role = role;
        
        saveUsers();

        logs.unshift({
            id: Date.now(),
            by: adminName || 'Admin',
            action: approve ? `User Approved as (${user.role})` : 'User Access Revoked',
            target: user.username,
            time: new Date().toLocaleString('en-US')
        });
        saveLogs();

        io.emit("usersUpdate", users);
        io.emit("logsUpdate", logs);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false });
    }
});

app.post('/api/delete-user', (req, res) => {
    const { copyId, adminName } = req.body;
    const cleanId = copyId ? copyId.trim() : '';
    
    if (ADMIN_IDS.includes(cleanId)) {
        return res.status(403).json({ success: false, message: 'لا يمكنك حذف المالك الرئيسي' });
    }

    if (!Array.isArray(users)) users = [];
    const index = users.findIndex(u => u.copyId === cleanId);

    if (index !== -1) {
        const deletedUser = users[index];
        users.splice(index, 1);
        saveUsers();

        logs.unshift({
            id: Date.now(),
            by: adminName || 'Admin',
            action: `Deleted Access (${deletedUser.username})`,
            target: deletedUser.username,
            time: new Date().toLocaleString('en-US')
        });
        saveLogs();

        io.emit("usersUpdate", users);
        io.emit("logsUpdate", logs);

        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }
});

app.post('/api/update-user-role', (req, res) => {
    const { copyId, newRole, adminName } = req.body;
    
    if (!Array.isArray(users)) users = [];
    let user = users.find(u => u.copyId === copyId?.trim());
    if (user) {
        user.role = newRole;
        saveUsers();

        logs.unshift({
            id: Date.now(),
            by: adminName || 'Admin',
            action: `Changed role of ${user.username} to (${newRole})`,
            target: user.username,
            time: new Date().toLocaleString('en-US')
        });
        saveLogs();

        io.emit("usersUpdate", users);
        io.emit("logsUpdate", logs);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }
});

app.post('/api/user-heartbeat', (req, res) => {
    const { copyId, status } = req.body;
    if (!Array.isArray(users)) users = [];
    let user = users.find(u => u.copyId === copyId?.trim());
    if (user) {
        user.status = status;
        user.lastActive = Date.now();
        io.emit("usersUpdate", users);
    }
    res.json({ success: true });
});

app.get('/api/users', (req, res) => res.json(Array.isArray(users) ? users : []));
app.get('/api/wings-list', (req, res) => res.json(ALL_WINGS));

setInterval(() => {
    const now = Date.now();
    let updated = false;
    if (Array.isArray(users)) {
        users.forEach(u => {
            if (u && u.status !== 'no-active' && (now - u.lastActive > 30000)) {
                u.status = 'no-active';
                updated = true;
            }
        });
    }
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
