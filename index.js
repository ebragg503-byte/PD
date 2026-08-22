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

// إعدادات البوت والدسكورد
const TOKEN = 'MTUzMTAxMjQwNDM3MTI1OTUxMg.GoXhtX.6IzKySzsU2UWktNDMZk0RzafjOAOV3Xw1PPsEY';
const GUILD_ID = '1517858234378227834';

// معرفات الرتب
const POLICE_ROLE_ID = "1520526844313469080"; // جميع أفراد الشرطة
const CADET_ROLE_IDS = [
    "1520526818225164329", // أكاديت
    "1522994966597468191"  // سولو كاديت
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// قواعد البيانات المحلية
const DB_FILE = path.join(__dirname, 'database.json');
let dbData = {};
if (fs.existsSync(DB_FILE)) {
    try { dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch (e) { dbData = {}; }
}

function saveData() {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2));
}

let activeUsers = [];
let logsHistory = [];

// قائمة الوينقات المتاحة
const availableWings = [
    { id: 'airship', name: 'طيران (Airship)', icon: 'fa-plane' },
    { id: 'swat', name: 'تدخل سريع (SWAT)', icon: 'fa-shield-heart' },
    { id: 'field_instructor', name: 'مدرب ميداني', icon: 'fa-chalkboard-user' },
    { id: 'bureau_investigation', name: 'تحقيقات (CID)', icon: 'fa-magnifying-glass' }
];

app.get('/api/wings-list', (req, res) => res.json(availableWings));

async function fetchGuildMembers() {
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();

        let allPoliceList = [];
        let cadetsList = [];

        members.forEach(member => {
            if (member.user.bot) return;

            // التحقق من وجود رتبة الشرطة العامة
            if (member.roles.cache.has(POLICE_ROLE_ID)) {
                const cadetData = {
                    discordId: member.id,
                    name: member.displayName || member.user.username, // استخدام اسم السيرفر بدقة
                    rank: member.roles.highest.name,
                    hours: dbData[member.id]?.hours || 0,
                    points: dbData[member.id]?.points || 0,
                    wings: dbData[member.id]?.wings || [],
                    reports: dbData[member.id]?.reports || []
                };

                // إضافة القائمة العامة
                allPoliceList.push(cadetData);

                // إضافة لقائمة الكاديت إذا كان يملك إحدى رتب الكاديت/سولو كاديت
                const isCadet = member.roles.cache.some(role => CADET_ROLE_IDS.includes(role.id));
                if (isCadet) {
                    cadetsList.push(cadetData);
                }
            }
        });

        io.emit('policeDataUpdate', {
            allPolice: allPoliceList,
            cadets: cadetsList
        });

    } catch (error) {
        console.error("خطأ أثناء جلب أعضاء السيرفر:", error);
    }
}

// طلبات الدخول والـ APIs
app.post('/api/login-request', (req, res) => {
    const { username, copyId } = req.body;
    let user = activeUsers.find(u => u.copyId === copyId);
    if (!user) {
        user = { username, copyId, approved: false, status: 'active', lastSeen: Date.now() };
        activeUsers.push(user);
    } else {
        user.username = username;
        user.lastSeen = Date.now();
    }
    io.emit('usersUpdate', activeUsers);
    res.json({ approved: user.approved });
});

app.post('/api/user-heartbeat', (req, res) => {
    const { copyId } = req.body;
    const user = activeUsers.find(u => u.copyId === copyId);
    if (user) {
        user.lastSeen = Date.now();
        user.status = 'active';
        io.emit('usersUpdate', activeUsers);
    }
    res.sendStatus(200);
});

app.post('/api/approve-user', (req, res) => {
    const { copyId, approve, adminName } = req.body;
    const user = activeUsers.find(u => u.copyId === copyId);
    if (user) {
        user.approved = approve;
        logsHistory.unshift({
            by: adminName || 'المسؤول',
            action: approve ? 'قبول دخول المستخدم' : 'رفض دخول المستخدم',
            target: user.username,
            time: new Date().toLocaleTimeString('ar-EG')
        });
        io.emit('usersUpdate', activeUsers);
        io.emit('logsUpdate', logsHistory);
    }
    res.sendStatus(200);
});

app.post('/api/update-cadet', (req, res) => {
    const { discordId, hours, points, wings, reportTitle, reportContent, editedBy } = req.body;
    
    if (!dbData[discordId]) {
        dbData[discordId] = { hours: 0, points: 0, wings: [], reports: [] };
    }

    dbData[discordId].hours = parseFloat(hours) || 0;
    dbData[discordId].points = parseInt(points) || 0;
    dbData[discordId].wings = wings || [];

    if (reportTitle && reportContent) {
        dbData[discordId].reports.push({
            title: reportTitle,
            content: reportContent,
            date: new Date().toLocaleDateString('ar-EG')
        });
    }

    saveData();
    fetchGuildMembers();

    logsHistory.unshift({
        by: editedBy || 'مسؤول',
        action: 'تعديل البيانات / إضافة تقرير',
        target: `العسكري (ID: ${discordId})`,
        time: new Date().toLocaleTimeString('ar-EG')
    });
    io.emit('logsUpdate', logsHistory);

    res.sendStatus(200);
});

// فحص الخمول كل 30 ثانية
setInterval(() => {
    const now = Date.now();
    activeUsers.forEach(u => {
        if (now - u.lastSeen > 40000) {
            u.status = 'no-active';
        }
    });
    io.emit('usersUpdate', activeUsers);
}, 30000);

client.on('ready', () => {
    console.log(`تم تسجيل الدخول بالبوت: ${client.user.tag}`);
    fetchGuildMembers();
    setInterval(fetchGuildMembers, 60000);
});

client.login(TOKEN);
server.listen(3000, () => console.log('السيرفر يعمل على المنفذ 3000'));
