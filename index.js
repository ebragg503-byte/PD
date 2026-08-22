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

const LSPD_RANKS = [
    { id: '1520526818225164329', name: 'Cadet', weight: 1 },
    { id: '1522994966597468191', name: 'Solo Cadet', weight: 2 },
    { id: '1520526816832524402', name: 'Officer I', weight: 3 },
    { id: '1520526816832524402', name: 'Officer II', weight: 4 },
    { id: '1520526814835900439', name: 'Officer III', weight: 5 },
    { id: '1520526814231920680', name: 'Senior Officer', weight: 6 },
    { id: '1520526813011513557', name: 'Senior Lead Officer', weight: 7 },
    { id: '1520526810113245326', name: 'Sergeant', weight: 8 },
    { id: '1520526809106612428', name: 'First Sergeant', weight: 9 },
    { id: '1520526808154509442', name: 'Staff Sergeant', weight: 10 },
    { id: '1520526806313078976', name: 'Lieutenant', weight: 11 },
    { id: '1520526805226754109', name: 'First Lieutenant', weight: 12 }
];

const REPORTS_CHANNEL_ID = '1536506668039274556'; 
const HOURS_CHANNEL_ID = '1530564311217471639';
const POINTS_CHANNEL_ID = '1523610705742266378';
const WINGS_CHANNEL_ID = '1520527213597032558';

const ADMIN_IDS = ['771747917040058388'];
const MASTER_PASSCODE = process.env.MASTER_PASSCODE || "SAW123456";

const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const USERS_BIN_ID = process.env.USERS_BIN_ID;
const LOGS_BIN_ID = process.env.LOGS_BIN_ID;
const CADETS_BIN_ID = process.env.CADETS_BIN_ID;

let users = [];
let logs = [];
let cadetsData = [];

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function sortCadets() {
    cadetsData.sort((a, b) => {
        const rankA = LSPD_RANKS.find(r => r.name === a.rank)?.weight || 0;
        const rankB = LSPD_RANKS.find(r => r.name === b.rank)?.weight || 0;

        if (rankA !== rankB) return rankA - rankB;

        const numA = parseInt((a.name.match(/\d+/) || [0])[0]);
        const numB = parseInt((b.name.match(/\d+/) || [0])[0]);

        if (numA !== numB) return numA - numB;

        return a.name.localeCompare(b.name);
    });
}

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

    const idMatches = [...fullText.matchAll(/<@!?(\d+)>|(\d{17,19})/g)];
    if (idMatches.length > 0) {
        const discordFieldMatch = fullText.match(/Discord\s*[:|-]?\s*<@!?(\d+)>|Discord\s*[:|-]?\s*(\d{17,19})/i);
        if (discordFieldMatch) {
            discordId = discordFieldMatch[1] || discordFieldMatch[2];
        } else {
            discordId = idMatches[0][1] || idMatches[0][2];
        }
    }

    const callsignMatch = fullText.match(/Server ID\s*:\s*(\d+)/i) || fullText.match(/Callsign\s*:\s*(\d+)/i);
    if (callsignMatch) callsign = callsignMatch[1];

    const nameMatch = fullText.match(/Character Name\s*:\s*([^\n\r]+)/i);
    if (nameMatch) charName = nameMatch[1].trim();

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
    const userRanks = LSPD_RANKS.filter(r => member.roles.cache.has(r.id));
    const highestRank = userRanks.sort((a, b) => b.weight - a.weight)[0];

    const index = cadetsData.findIndex(c => c.discordId === member.id);

    if (highestRank) {
        const name = member.displayName || member.user.username;

        if (index !== -1) {
            cadetsData[index].name = name;
            cadetsData[index].rank = highestRank.name;
            cadetsData[index].status = 'active';
        } else {
            cadetsData.push({
                discordId: member.id,
                name: name,
                rank: highestRank.name,
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
        if (!channel) return;

        let lastId;
        let fetchedCount = 0;

        while (fetchedCount < 1000) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options).catch(() => null);
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

                    if (cadet && totalHours > cadet.hours) {
                        cadet.hours = totalHours;
                    }
                }
            });

            lastId = messages.last().id;
            fetchedCount += messages.size;
            await delay(100);
        }

        saveCadets();
        sortCadets();
        io.emit("cadetsUpdate", cadetsData);
    } catch (e) {
        console.error("Error fetching old hours:", e);
    }
}

function processReportMessage(msg, emitUpdate = true) {
    const fullText = getMessageFullText(msg);
    if (!fullText.trim() || !msg.author || msg.author.bot) return;

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
        if (!channel) return;

        let lastId;
        let fetchedCount = 0;

        while (fetchedCount < 1000) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options).catch(() => null);
            if (!messages || messages.size === 0) break;

            messages.forEach(msg => processReportMessage(msg, false));

            lastId = messages.last().id;
            fetchedCount += messages.size;
            await delay(100);
        }

        saveCadets();
        sortCadets();
        io.emit("cadetsUpdate", cadetsData);
    } catch (e) {
        console.error("Error fetching old reports:", e);
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

async function fetchOldPointsMessages() {
    try {
        const channel = await client.channels.fetch(POINTS_CHANNEL_ID).catch(() => null);
        if (!channel) return;

        let lastId;
        let fetchedCount = 0;

        while (fetchedCount < 1000) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options).catch(() => null);
            if (!messages || messages.size === 0) break;

            messages.forEach(msg => processPointsMessage(msg, false));

            lastId = messages.last().id;
            fetchedCount += messages.size;
            await delay(100);
        }

        saveCadets();
        sortCadets();
        io.emit("cadetsUpdate", cadetsData);
    } catch (e) {
        console.error("Error fetching old points messages:", e);
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

        (async () => {
            console.log("🔄 Syncing old messages in background...");
            await fetchOldHoursMessages();
            await fetchOldPointsMessages();
            await fetchOldReportsMessages();
            console.log("✅ Background sync completed.");
        })();

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

// APIs
app.get('/api/cadets', (req, res) => {
    sortCadets();
    res.json(cadetsData);
});

app.post('/api/update-cadet', async (req, res) => {
    try {
        const { discordId, hours, points, reportTitle, reportContent, wings, editedBy } = req.body;
        
        let cadet = cadetsData.find(c => String(c.discordId) === String(discordId));
        if (!cadet) {
            return res.status(404).json({ success: false, message: 'العسكري غير موجود' });
        }

        let changes = [];

        if (hours !== undefined && hours !== null && hours !== '') {
            const parsedHours = parseFloat(hours);
            if (!isNaN(parsedHours)) {
                cadet.hours = parsedHours;
                changes.push(`Updated hours to (${parsedHours})`);
            }
        }

        if (points !== undefined && points !== null && points !== '') {
            const parsedPoints = parseInt(points);
            if (!isNaN(parsedPoints)) {
                cadet.points = parsedPoints;
                changes.push(`Updated points to (${parsedPoints})`);
            }
        }

        if (wings !== undefined && Array.isArray(wings)) {
            cadet.wings = wings;
            changes.push(`Updated wings`);
        }

        if ((reportTitle && reportTitle.trim() !== '') || (reportContent && reportContent.trim() !== '')) {
            if (!cadet.reports) cadet.reports = [];
            cadet.reports.push({
                id: Date.now().toString(),
                title: reportTitle ? reportTitle.trim() : 'تقرير يدوي',
                content: reportContent ? reportContent.trim() : '-',
                date: new Date().toLocaleDateString('en-US')
            });
            changes.push(`Added manual report: ${reportTitle || 'تقرير يدوي'}`);
        }

        if (changes.length > 0) {
            logs.unshift({
                id: Date.now(),
                by: editedBy || 'Admin',
                action: changes.join(' | '),
                target: cadet.name,
                time: new Date().toLocaleString('en-US')
            });
            
            await saveLogs();
            await saveCadets();
            sortCadets();

            io.emit("cadetsUpdate", cadetsData);
            io.emit("logsUpdate", logs);
        }

        return res.json({ success: true, message: 'تم حفظ التغييرات بنجاح', cadet });
    } catch (err) {
        console.error("Update Cadet Error:", err);
        return res.status(500).json({ success: false, message: 'حدث خطأ أثناء الحفظ' });
    }
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

// توجيه المسار الرئيسي بشكل مباشر
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send("Error: index.html non-existant in public directory.");
    }
});

// التعامل مع جميع باقي المسارات دون التعارض مع Express (استبدال app.get('*'))
app.use((req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send("Error: Page not found.");
    }
});

server.listen(PORT, () => console.log(`Server started on port ${PORT}`));

if (BOT_TOKEN) {
    client.login(BOT_TOKEN);
} else {
    console.log("⚠️ No BOT_TOKEN provided in environment variables.");
}
