const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ربط مجلد public لتصفح الواجهة
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// إعدادات الديسكورد والرومات
// -------------------------------------------------------------
const BOT_TOKEN = process.env.BOT_TOKEN; // ← مهم جداً
const GUILD_ID = '1517858234378227834';
const CADET_ROLE_ID = '1520526818225164329';
const SOLO_CADET_ROLE_ID = '1522994966597468191';

// الرومات الخاصة بالتقارير والساعات
const REPORTS_CHANNEL_ID = '1520998767325741148';
const HOURS_CHANNEL_ID = '1530564311217471639';

let cadetsData = [];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', async () => {
    console.log(`🤖 تم تشغيل البوت بنجاح باسم: ${client.user.tag}`);
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();

        members.forEach(member => {
            checkAndSyncMember(member);
        });

        console.log(`✅ تم سحب بيانات الأعضاء والحالات الحالية بنجاح.`);
    } catch (err) {
        console.error('❌ خطأ أثناء السحب الأول للأعضاء:', err);
    }
});

function checkAndSyncMember(member) {
    const isCadet = member.roles.cache.has(CADET_ROLE_ID);
    const isSoloCadet = member.roles.cache.has(SOLO_CADET_ROLE_ID);

    let existing = cadetsData.find(c => c.discordId === member.id);

    if (isCadet || isSoloCadet) {
        const rankName = isSoloCadet ? 'سولو كاديت (Solo Cadet)' : 'كاديت (Cadet)';
        const displayName = member.displayName || member.user.username;

        if (existing) {
            existing.name = displayName;
            existing.rank = rankName;
            existing.status = 'active';
        } else {
            cadetsData.push({
                discordId: member.id,
                name: displayName,
                rank: rankName,
                hours: 0,
                reports: [],
                status: 'active'
            });
        }
    } else if (existing) {
        existing.status = 'archived';
    }
}

client.on('guildMemberUpdate', (oldMember, newMember) => {
    checkAndSyncMember(newMember);
});

// استخراج أرقام الساعات من الرسالة
function parseHours(text) {
    if (!text) return 0;
    const match = text.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
}

client.on('messageCreate', message => {
    if (message.author.bot) return;

    const authorId = message.author.id;
    let cadet = cadetsData.find(c => c.discordId === authorId && c.status === 'active');

    if (!cadet) return;

    if (message.channel.id === HOURS_CHANNEL_ID) {
        const hoursToAdd = parseHours(message.content);
        if (hoursToAdd > 0) {
            cadet.hours += hoursToAdd;
            console.log(`⏱️ تم إضافة ${hoursToAdd} ساعة للعسكري: ${cadet.name}`);
        }
    }

    if (message.channel.id === REPORTS_CHANNEL_ID) {
        cadet.reports.push({
            id: message.id,
            title: message.content.slice(0, 50) || 'تقرير جديد من MDT',
            content: message.content || 'يحتوي على مرفقات أو صور',
            date: new Date().toLocaleDateString('ar-SA')
        });
    }
});

// -------------------------------------------------------------
// API
// -------------------------------------------------------------
app.get('/api/cadets', (req, res) => {
    res.json(cadetsData);
});

app.post('/api/update-cadet-manual', (req, res) => {
    const { discordId, hours, reportTitle, reportContent } = req.body;
    let cadet = cadetsData.find(c => c.discordId === discordId);

    if (cadet) {
        if (hours !== undefined && hours !== '') {
            cadet.hours = parseFloat(hours);
        }
        if (reportTitle || reportContent) {
            cadet.reports.push({
                id: Date.now().toString(),
                title: reportTitle || 'تقرير مضاف يدوياً',
                content: reportContent || 'بدون تفاصيل إضافية',
                date: new Date().toLocaleDateString('ar-SA')
            });
        }
        res.json({ success: true, message: 'تم تحديث البيانات بنجاح!' });
    } else {
        res.status(404).json({ success: false, message: 'العسكري غير موجود' });
    }
});

app.get(/(.*)/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🌐 لوحة البيانات تعمل على المنفذ: ${PORT}`);
});

// تسجيل الدخول
client.login(BOT_TOKEN);
