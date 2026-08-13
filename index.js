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

// الرومات الأساسية
const REPORTS_CHANNEL_ID = '1536506668039274556'; 
const HOURS_CHANNEL_ID = '1530564311217471639';
const POINTS_CHANNEL_ID = '1523610705742266378';
const WINGS_CHANNEL_ID = '1520527213597032558';

const ADMIN_IDS = ['771747917040058388'];
const MASTER_PASSCODE = process.env.MASTER_PASSCODE || "SAW123456";

// إعدادات التخزين السحابي JSONBin
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const USERS_BIN_ID = process.env.USERS_BIN_ID;
const LOGS_BIN_ID = process.env.LOGS_BIN_ID;
const CADETS_BIN_ID = process.env.CADETS_BIN_ID;

let users = [];
let logs = [];
let cadetsData = [];

// دالة تأخير لتجنب حظر طلبات Discord (Rate Limit)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

// دالة جلب البيانات من Cloud
async function loadCloudData() {
    if (!JSONBIN_API_KEY) {
        console.log("⚠️ JSONBin Key missing. Running with local memory.");
        return;
    }
    try {
        if (USERS_BIN_ID) {
            const resUsers = await axios.get(`https://api.jsonbin.io/v3/b/${USERS_BIN_ID}/latest`, {
                headers: { 'X-Master-Key': JSONBIN_API_KEY }
            });
            users = Array.isArray(resUsers.data.record) ? resUsers.data.record : [];
        }

        if (LOGS_BIN_ID) {
            const resLogs = await axios.get(`https://api.jsonbin.io/v3/b/${LOGS_BIN_ID}/latest`, {
                headers: { 'X-Master-Key': JSONBIN_API_KEY }
            });
            logs = Array.isArray(resLogs.data.record) ? resLogs.data.record : [];
        }

        if (CADETS_BIN_ID) {
            const resCadets = await axios.get(`https://api.jsonbin.io/v3/b/${CADETS_BIN_ID}/latest`, {
                headers: { 'X-Master-Key': JSONBIN_API_KEY }
            });
            cadetsData = Array.isArray(resCadets.data.record) ? resCadets.data.record : [];
        }

        console.log(`✅ Loaded Cloud Data successfully.`);
    } catch (e) {
        console.error("Error loading Cloud Data:", e.message);
    }
}

async function saveCadets() {
    if (!JSONBIN_API_KEY || !CADETS_BIN_ID) return;
    try {
        await axios.put(`https://api.jsonbin.io/v3/b/${CADETS_BIN_ID}`, cadetsData, {
            headers: { 
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_API_KEY 
            }
        });
    } catch (e) {
        console.error("Error saving cadets to cloud:", e.message);
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
    let callsign = null;
    let charName = null;
    let totalHours = 0;

    const fullText = getMessageFullText(message);

    // 1. استخراج الـ Discord ID
    const idMatches = [...fullText.matchAll(/<@!?(\d+)>|(\d{17,19})/g)];
    if (idMatches.length > 0) {
        const discordFieldMatch = fullText.match(/Discord\s*[:|-]?\s*<@!?(\d+)>|Discord\s*[:|-]?\s*(\d{17,19})/i);
        if (discordFieldMatch) {
            discordId = discordFieldMatch[1] || discordFieldMatch[2];
        } else {
            discordId = idMatches[0][1] || idMatches[0][2];
        }
    }

    // 2. استخراج الكولساين / Server ID
    const callsignMatch = fullText.match(/Server ID\s*:\s*(\d+)/i) || fullText.match(/Callsign\s*:\s*(\d+)/i);
    if (callsignMatch) {
        callsign = callsignMatch[1];
    }

    // 3. استخراج اسم الشخصية
    const nameMatch = fullText.match(/Character Name\s*:\s*([^\n\r]+)/i);
    if (nameMatch) {
        charName = nameMatch[1].trim();
    }

    // 4. استخراج إجمالي الساعات/الدقائق
    const totalMinsMatch = fullText.match(/Total Minutes\s*[:|-]?\s*(\d+)/i);
    if (totalMinsMatch) {
        totalHours = parseFloat((parseInt(totalMinsMatch[1]) / 60).toFixed(2));
    } else {
        const dutyTimeMatch = fullText.match(/Total Duty Time\s*[:|-]?\s*(\d+)h\s*(\d+)m/i) || fullText.match(/Time In Server\s*[:|-]?\s*(\d+)h\s*(\d+)m/i);
        if (dutyTimeMatch) {
            const hrs = parseInt(dutyTimeMatch[1]);
            const mins = parseInt(dutyTimeMatch[2]);
            totalHours = parseFloat((hrs + (mins / 60)).toFixed(2));
        }
    }

    return { discordId, callsign, charName, totalHours };
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
                processedHoursMsgIds: [],
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
        const channel = await client.channels.fetch(HOURS_CHANNEL_ID).catch(() => null);
        if (!channel) {
            console.error(`❌ لم يتم العثور على روم الساعات ID: ${HOURS_CHANNEL_ID}`);
            return;
        }

        cadetsData.forEach(c => {
            c.hours = 0;
            c.processedHoursMsgIds = [];
        });

        let lastId;
        let fetchedCount = 0;

        while (fetchedCount < 3000) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options).catch(err => {
                console.error("Hours Fetch Error:", err.message);
                return null;
            });

            if (!messages || messages.size === 0) break;

            messages.forEach(msg => {
                const { discordId, callsign, charName, totalHours } = parseDutyMessage(msg);

                if (totalHours > 0) {
                    let cadet = cadetsData.find(c => {
                        if (discordId && c.discordId === discordId) return true;
                        
                        if (callsign) {
                            const cNum = (c.name.match(/\d+/) || [])[0];
                            if (cNum && cNum === callsign) return true;
                        }

                        if (charName && c.name.toLowerCase().includes(charName.toLowerCase())) return true;

                        return false;
                    });

                    if (cadet) {
                        if (totalHours > cadet.hours) {
                            cadet.hours = totalHours;
                        }
                    }
                }
            });

            lastId = messages.last().id;
            fetchedCount += messages.size;
            await delay(200);
        }

        console.log("✅ تم إحصاء الساعات بنجاح وتحديث الجدول.");
        saveCadets();
        sortCadets();
        io.emit("cadetsUpdate", cadetsData);
    } catch (e) {
        console.error("Fatal Error fetching old hours:", e);
    }
}

function processReportMessage(msg, emitUpdate = true) {
    const fullText = getMessageFullText(msg);
    if (!fullText.trim()) return;

    if (!msg.author || msg.author.bot) return;

    const targetCadet = cadetsData.find(c => c.discordId === msg.author.id && c.status === 'active');
    
    if (!targetCadet) return;

    const caseNameMatch = fullText.match(/Case Name\s*:\s*([^\n\r]+)/i) || fullText.match(/Title\s*:\s*([^\n\r]+)/i);
    const reportTitle = caseNameMatch ? caseNameMatch[1].trim() : 'تقرير MDT';

    if (!targetCadet.reports) targetCadet.reports = [];

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
        saveCadets();
        sortCadets();
        io.emit("cadetsUpdate", cadetsData);
        io.emit("logsUpdate", logs);
    }
}

async function fetchOldReportsMessages() {
    try {
        const channel = await client.channels.fetch(REPORTS_CHANNEL_ID).catch(() => null);
        if (!channel) {
            console.error(`❌ لم يتم العثور على روم التقارير ID: ${REPORTS_CHANNEL_ID}`);
            return;
        }

        cadetsData.forEach(c => {
            c.reports = [];
        });

        let lastId;
        let fetchedCount = 0;

        while (fetchedCount < 3000) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options).catch(err => {
                console.error("Reports Fetch Error:", err.message);
                return null;
            });

            if (!messages || messages.size === 0) break;

            messages.forEach(msg => {
                processReportMessage(msg, false);
            });

            lastId = messages.last().id;
            fetchedCount += messages.size;
            await delay(250);
        }

        console.log("✅ تم استخراج وحساب تقارير MDT بنجاح.");
        saveCadets();
        sortCadets();
        io.emit("cadetsUpdate", cadetsData);
    } catch (e) {
        console.error("Fatal Error fetching old reports:", e);
    }
}

async function fetchOldPointsMessages() {
    try {
        const channel = await client.channels.fetch(POINTS_CHANNEL_ID).catch(() => null);
        if (!channel) return;

        let lastId;
        let fetchedCount = 0;

        while (fetchedCount < 2000) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options).catch(() => null);
            if (!messages || messages.size === 0) break;

            messages.forEach(msg => {
                processPointsMessage(msg, false);
            });

            lastId = messages.last().id;
            fetchedCount += messages.size;
            await delay(200);
        }

        saveCadets();
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
        saveCadets();
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
        
        members.forEach(m => syncMember(m));

        sortCadets();
        io.emit("cadetsUpdate", cadetsData);
        io.emit("usersUpdate", users);

        await fetchOldHoursMessages();
        await fetchOldPointsMessages();
        await fetchOldReportsMessages();

    } catch (e) {
        console.error("Sync error:", e);
    }
});

client.on('guildMemberUpdate', (oldM, newM) => {
    syncMember(newM);
    saveCadets();
    sortCadets();
    io.emit("cadetsUpdate", cadetsData);
});

client.on('messageCreate', msg => {
    if (msg.channel.id === HOURS_CHANNEL_ID) {
        const { discordId, callsign, charName, totalHours } = parseDutyMessage(msg);

        if (totalHours > 0) {
            let cadet = cadetsData.find(c => {
                if (discordId && c.discordId === discordId) return true;
                if (callsign) {
                    const cNum = (c.name.match(/\d+/) || [])[0];
                    if (cNum && cNum === callsign) return true;
                }
                if (charName && c.name.toLowerCase().includes(charName.toLowerCase())) return true;
                return false;
            });

            if (cadet && totalHours > cadet.hours) {
                cadet.hours = totalHours;
                
                logs.unshift({
                    id: Date.now(),
                    by: 'Duty System',
                    action: `Updated hours to (${cadet.hours} hrs)`,
                    target: cadet.name,
                    time: new Date().toLocaleString('en-US')
                });
                saveLogs();
                saveCadets();
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
                saveCadets();
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

// مسار تعديل بيانات العسكري المحدث
app.post('/api/update-cadet', (req, res) => {
    const { discordId, hours, points, reportTitle, reportContent, wings, editedBy, requesterId } = req.body;
    
    let cadet = cadetsData.find(c => c.discordId === discordId);
    if (!cadet) {
        return res.status(404).json({ success: false, message: 'العسكري غير موجود' });
    }

    if (!Array.isArray(users)) users = [];
    const cleanRequesterId = requesterId ? requesterId.trim() : '';
    const requester = users.find(u => u.copyId === cleanRequesterId);
    
    const isMainAdmin = ADMIN_IDS.includes(cleanRequesterId);
    const hasPermission = isMainAdmin || (requester && requester.approved && (requester.role === 'admin' || requester.role === 'editor'));

    if (!hasPermission) {
        return res.status(403).json({ success: false, message: 'ليس لديك صلاحية التعديل' });
    }

    let changes = [];

    if (hours !== undefined && hours !== '' && !isNaN(hours)) {
        const newHours = parseFloat(hours);
        changes.push(`Updated hours to (${newHours})`);
        cadet.hours = newHours;
    }

    if (points !== undefined && points !== '' && !isNaN(points)) {
        const newPoints = parseInt(points);
        changes.push(`Updated points to (${newPoints})`);
        cadet.points = newPoints;
    }

    if (wings !== undefined && Array.isArray(wings)) {
        cadet.wings = wings;
        changes.push(`Updated wings`);
    }

    if (reportTitle || reportContent) {
        if (!cadet.reports) cadet.reports = [];
        cadet.reports.push({
            id: Date.now().toString(),
            title: reportTitle || 'تقرير يدوي',
            content: reportContent || '-',
            date: new Date().toLocaleDateString('en-US')
        });
        changes.push(`Added manual report: ${reportTitle || 'تقرير يدوي'}`);
    }

    if (changes.length > 0) {
        logs.unshift({
            id: Date.now(),
            by: editedBy || (requester ? requester.username : 'Admin'),
            action: changes.join(' | '),
            target: cadet.name,
            time: new Date().toLocaleString('en-US')
        });
        
        saveLogs();
        saveCadets();
        sortCadets();

        // بث مباشر للجدول ليتحدث في جميع المتصفحات فوراً
        io.emit("cadetsUpdate", cadetsData);
        io.emit("logsUpdate", logs);
    }

    return res.json({ success: true, message: 'تم حفظ التغييرات بنجاح', cadet });
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
