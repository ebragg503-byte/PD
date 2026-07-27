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

// دالة لمعالجة نصوص الـ Embeds واستخراج الساعات أو الدقائق منها
function parseDutyMessage(message) {
    let discordId = null;
    let totalHours = null;

    // استخراج Discord ID
    const mentionMatch = message.content?.match(/<@!?(\d+)>/) || JSON.stringify(message.embeds).match(/<@!?(\d+)>/);
    if (mentionMatch) {
        discordId = mentionMatch[1];
    }

    // البحث داخل الـ Embeds الخاصة بـ qb-management
    if (message.embeds && message.embeds.length > 0) {
        for (const embed of message.embeds) {
            // البحث عن Discord ID في الحقول
            if (!discordId && embed.fields) {
                const discordField = embed.fields.find(f => f.name.includes('Discord'));
                if (discordField) {
                    const idMatch = discordField.value.match(/(\d+)/);
                    if (idMatch) discordId = idMatch[1];
                }
            }

            // استخراج الساعات والدقائق (Total Duty Time أو Total Minutes)
            let textToSearch = (embed.description || '') + ' ' + (embed.fields ? embed.fields.map(f => `${f.name} ${f.value}`).join(' ') : '');
            
            // 1. تجربة قراءة Total Minutes
            const minutesMatch = textToSearch.match(/Total Minutes\s*[\r\n]*\s*(\d+)/i);
            if (minutesMatch) {
                totalHours = parseFloat((parseInt(minutesMatch[1]) / 60).toFixed(2));
            } else {
                // 2. تجربة قراءة Total Duty Time (مثال: 18h 00m)
                const dutyTimeMatch = textToSearch.match(/Total Duty Time\s*[\r\n]*\s*(\d+)h\s*(\d+)m/i);
                if (dutyTimeMatch) {
                    const hrs = parseInt(dutyTimeMatch[1]);
                    const mins = parseInt(dutyTimeMatch[2]);
                    totalHours = parseFloat((hrs + (mins / 60)).toFixed(2));
                }
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

// دالة لجلب الرسائل القديمة من روم الساعات عند تشغيل البوت
async function fetchOldHoursMessages() {
    try {
        const channel = await client.channels.fetch(HOURS_CHANNEL_ID);
        if (!channel) return;

        let lastId;
        let fetchedCount = 0;

        console.log("⏳ Syncing old duty hours messages...");

        // قراءة آخر 500 رسالة في الروم وحساب أعلى عدد ساعات وصل له العسكري
        while (fetchedCount < 500) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) break;

            messages.forEach(msg => {
                const { discordId, totalHours } = parseDutyMessage(msg);
                if (discordId && totalHours !== null) {
                    let cadet = cadetsData.find(c => c.discordId === discordId);
                    if (cadet) {
                        // تحديث الساعات إلى القيمة الأخيرة/الأعلى المسجلة في الروم
                        if (totalHours > cadet.hours) {
                            cadet.hours = totalHours;
                        }
                    }
                }
            });

            lastId = messages.last().id;
            fetchedCount += messages.size;
        }

        console.log("✅ Sync completed successfully!");
        io.emit("cadetsUpdate", cadetsData);
    } catch (e) {
        console.error("Error fetching old messages:", e);
    }
}

client.once('ready', async () => {
    console.log(`🤖 Bot online as ${client.user.tag}`);
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();
        cadetsData = [];
        members.forEach(m => syncMember(m));

        // قراءة الساعات القديمة بعد مزامنة الأعضاء
        await fetchOldHoursMessages();

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
    // استقبال تحديثات الساعات التلقائية من البوتات
    if (msg.channel.id === HOURS_CHANNEL_ID) {
        const { discordId, totalHours } = parseDutyMessage(msg);

        if (discordId && totalHours !== null) {
            let cadet = cadetsData.find(c => c.discordId === discordId && c.status === 'active');
            if (cadet) {
                cadet.hours = totalHours; // تحديث الساعات تلقائياً إلى الساعات الكلية الجديدة
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
