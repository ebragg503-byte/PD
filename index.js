const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));

// -------------------------------------------------------------
// إعدادات الديسكورد - ضع التوكين الجديد هنا بعد عمل Reset Token
// -------------------------------------------------------------
const BOT_TOKEN = 'MTUzMTAxMjQwNDM3MTI1OTUxMg.GKF9dZ.7T38swAqXXevDu5dt8WPlQ3kZ29b7NZBgB5ZH0';
const GUILD_ID = '1517858234378227834';
const CADET_ROLE_ID = '1520526818225164329';
const SOLO_CADET_ROLE_ID = '1522994966597468191';
const REPORTS_CHANNEL_ID = '1520998767325741148';

// قاعدة البيانات المؤقتة في الذاكرة
let cadetsData = [];

// إنشاء العميل مع الصلاحيات المطلوبة
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// عند تشغيل البوت: عمل سحب شامل لجميع الأعضاء الحاليين
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

// دالة التحقق من رتب العضو وتحديثه باللوحة أو نقله للأرشيف
function checkAndSyncMember(member) {
    const isCadet = member.roles.cache.has(CADET_ROLE_ID);
    const isSoloCadet = member.roles.cache.has(SOLO_CADET_ROLE_ID);

    let existing = cadetsData.find(c => c.discordId === member.id);

    if (isCadet || isSoloCadet) {
        const rankName = isSoloCadet ? 'Solo Cadet' : 'Cadet';
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

// التحديث التلقائي الفوري عند إضافة أو إزالة رتبة
client.on('guildMemberUpdate', (oldMember, newMember) => {
    checkAndSyncMember(newMember);
});

// قراءة التقارير تلقائياً من ديسكورد
client.on('messageCreate', message => {
    if (message.author.bot && message.channel.id !== REPORTS_CHANNEL_ID) return;

    const authorId = message.author.id;
    let cadet = cadetsData.find(c => c.discordId === authorId && c.status === 'active');

    if (cadet) {
        if (message.channel.id === REPORTS_CHANNEL_ID) {
            cadet.reports.push({
                id: message.id,
                title: message.content.slice(0, 50) || 'تقرير جديد من MDT',
                content: message.content || 'يحتوي على مرفقات/صور MDT',
                date: new Date().toLocaleDateString('ar-SA')
            });
        }
    }
});

// -------------------------------------------------------------
// مسارات الـ API للوحة البيانات (Express Routes)
// -------------------------------------------------------------
app.get('/api/cadets', (req, res) => {
    res.json(cadetsData);
});

// مسار التعديل اليدوي للتقارير والساعات القديمة
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
                title: reportTitle || 'تقرير سابق مضاف يدوياً',
                content: reportContent || 'بدون تفاصيل إضافية',
                date: new Date().toLocaleDateString('ar-SA')
            });
        }
        res.json({ success: true, message: 'تم تحديث البيانات بنجاح!' });
    } else {
        res.status(404).json({ success: false, message: 'العسكري غير موجود' });
    }
});

app.listen(PORT, () => {
    console.log(`🌐 لوحة البيانات تعمل على: http://localhost:${PORT}`);
});

// تسجيل دخول البوت
if (BOT_TOKEN !== 'ضع_التوكين_الجديد_هنا') {
    client.login(BOT_TOKEN);
}