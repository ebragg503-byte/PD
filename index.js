const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// جلب التوكن من متغيّرات بيئة Render
const TOKEN = 'MTUzMTAxMjQwNDM3MTI1OTUxMg.GSso4c.q9XViHWbU_W4qTrx5hPRhzCTReVyFuxULAK4tU';
const GUILD_ID = '1517858234378227834';

const POLICE_ROLE_ID = "1520526844313469080"; 
const CADET_ROLE_IDS = ["1520526818225164329", "1522994966597468191"];
const ADMIN_IDS = ["771747917040058388"];

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
let logsHistory = [];

async function fetchGuildMembers() {
    try {
        if (!client.isReady()) return;
        
        const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID);
        if (!guild) return console.log("لم يتم العثور على السيرفر");

        const members = await guild.members.fetch();

        let allPoliceList = [];
        let cadetsList = [];

        members.forEach(member => {
            if (member.user.bot) return;

            if (member.roles.cache.has(POLICE_ROLE_ID)) {
                const cadetData = {
                    discordId: member.id,
                    name: member.displayName || member.user.username,
                    rank: member.roles.highest.name,
                    hours: dbData[member.id]?.hours || 0,
                    points: dbData[member.id]?.points || 0,
                    wings: dbData[member.id]?.wings || [],
                    reports: dbData[member.id]?.reports || []
                };

                allPoliceList.push(cadetData);

                if (member.roles.cache.some(role => CADET_ROLE_IDS.includes(role.id))) {
                    cadetsList.push(cadetData);
                }
            }
        });

        io.emit('policeDataUpdate', {
            allPolice: allPoliceList,
            cadets: cadetsList
        });

    } catch (error) {
        console.error("خطأ أثناء جلب أعضاء السيرفر:", error.message);
    }
}

// الـ APIs لنظام تسجيل الدخول والتذكر التلقائي
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

io.on('connection', (socket) => {
    fetchGuildMembers();
});

client.on('ready', () => {
    console.log(`[ONLINE] تم تسجيل الدخول بالبوت: ${client.user.tag}`);
    fetchGuildMembers();
    setInterval(fetchGuildMembers, 30000);
});

const PORT = process.env.PORT || 3000;

if (TOKEN) {
    client.login(TOKEN).catch(err => console.error("خطأ في تسجيل دخول البوت:", err.message));
} else {
    console.error("تنبيه: BOT_TOKEN غير موجود في متغيرات البيئة!");
}

server.listen(PORT, () => console.log(`السيرفر يعمل على المنفذ ${PORT}`));
