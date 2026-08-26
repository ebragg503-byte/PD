const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'data.json');

// تحميل أو إنشاء البيانات
let db = {
    police: {}, // { discordId: { name, callsign, rank, hours, points, wings, reports, hireDate, disabled } }
    users: {},
    logs: []
};

if (fs.existsSync(DATA_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
        console.error("خطأ في قراءة ملف البيانات:", e);
    }
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// **دالة تصحيح حساب الأيام بدقة**
function calculateDays(hireDateStr) {
    if (!hireDateStr) return 0;
    const parts = hireDateStr.split('/');
    if (parts.length !== 3) return 0;

    // YYYY/MM/DD
    const hireDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const today = new Date();
    
    // تصغير الوقت لحساب الأيام فقط بدون تأثير الساعات
    hireDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    const diffTime = today - hireDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays >= 0 ? diffDays : 0;
}

// **استقبال الويب هوك الخاص بساعات العمل (Duty Hours Logger)**
app.post('/api/duty-webhook', (req, res) => {
    const data = req.body;

    // التحقق من وجود embed من بوت الديسكورد
    if (data.embeds && data.embeds.length > 0) {
        const embed = data.embeds[0];
        let totalMinutes = 0;
        let discordId = null;

        // البحث عن الدقائق والـ Discord ID داخل الـ Fields
        if (embed.fields) {
            embed.fields.forEach(field => {
                if (field.name.includes("Total Minutes")) {
                    totalMinutes = parseInt(field.value.trim()) || 0;
                }
                if (field.name.includes("Discord")) {
                    const match = field.value.match(/\d+/);
                    if (match) discordId = match[0];
                }
            });
        }

        // إذا لم يجد في الحقول، يبحث في الوصف (Description)
        if (!discordId && embed.description) {
            const match = embed.description.match(/<@!?(\d+)>/);
            if (match) discordId = match[1];
        }

        // التحديث في قاعدة البيانات عند العثور على العسكري
        if (discordId && totalMinutes > 0) {
            const calculatedHours = parseFloat((totalMinutes / 60).toFixed(1));

            if (!db.police[discordId]) {
                db.police[discordId] = {
                    name: embed.title || "عسكري جديد",
                    callsign: "U-Unknown",
                    rank: "Cadet",
                    hours: calculatedHours,
                    points: 0,
                    wings: [],
                    reports: [],
                    hireDate: new Date().toLocaleDateString('zh-Hans-CN'), // YYYY/MM/DD
                    disabled: false
                };
            } else {
                db.police[discordId].hours = calculatedHours;
            }

            saveData();
            io.emit('updateData', getFormattedData());
            console.log(`[Duty Log] تم تحديث ساعات العسكري (${discordId}):${calculatedHours} ساعة.`);
        }
    }
    res.status(200).send({ status: 'success' });
});

function getFormattedData() {
    const formattedPolice = {};
    for (const id in db.police) {
        const p = db.police[id];
        formattedPolice[id] = {
            ...p,
            daysPassed: calculateDays(p.hireDate)
        };
    }
    return { ...db, police: formattedPolice };
}

// Socket.io للتزامن المباشر
io.on('connection', (socket) => {
    socket.emit('initData', getFormattedData());

    socket.on('updateOfficer', (data) => {
        const { discordId, hours, points, disabled, wings, reportTitle, reportContent, updatedBy } = data;

        if (db.police[discordId]) {
            if (hours !== undefined) db.police[discordId].hours = parseFloat(hours);
            if (points !== undefined) db.police[discordId].points = parseInt(points);
            if (disabled !== undefined) db.police[discordId].disabled = disabled;
            if (wings !== undefined) db.police[discordId].wings = wings;

            if (reportTitle && reportContent) {
                db.police[discordId].reports.push({
                    title: reportTitle,
                    content: reportContent,
                    date: new Date().toLocaleString('ar-SA')
                });
            }

            db.logs.unshift({
                admin: updatedBy || "المشرف",
                action: "تعديل بيانات العسكري",
                target: db.police[discordId].name,
                time: new Date().toLocaleString('ar-SA')
            });

            saveData();
            io.emit('updateData', getFormattedData());
        }
    });
});

server.listen(3000, () => {
    console.log('Server running on port 3000');
});
