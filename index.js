'use strict';
/* ============================================================================
 *  نظام إدارة الشرطة — Police Department Management System
 *  البوت + لوحة التحكم (Express + Socket.IO + discord.js)
 * ==========================================================================*/

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { Client, GatewayIntentBits, AuditLogEvent } = require('discord.js');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' },
    maxHttpBufferSize: 1e6,
    pingTimeout: 20000
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================================
 * 1) الإعدادات
 * ==========================================================================*/

const CONFIG = {
    token: process.env.BOT_TOKEN,

    // السيرفرات: يقبل أكثر من آيدي مفصول بفاصلة. الافتراضي: سيرفر شرطة ET
    guildIds: (process.env.GUILD_ID || '1553263389403254814')
        .split(',').map(s => s.trim()).filter(Boolean),

    // مشرفين الموقع (لديهم كل الصلاحيات)
    adminIds: (process.env.ADMIN_IDS || '771747917040058388')
        .split(',').map(s => s.trim()).filter(Boolean),

    // روم التقارير (MDT / CADET / SOLO CADET)
    reportChannels: [
        '1553263395539648700', // MDT
        '1553263389814296608', // CADET
        '1553263389814296607', // SOLO CADET
        '1536506668039274556'  // MDT (قديم)
    ],

    // روم الساعات
    hoursChannels: [
        '1530564311217471639'
    ],

    // روم إعلانات الدخول
    adsChannels: [
        '1521415106876014612'
    ],

    // ============ رومات الخصم والنقاط والترقيات ============
    // روم الخصم (Strike) — خصم نقاط
    strikeChannels: [
        '1553263396047163451'
    ],
    // روم النقاط (Points) — إضافة/خصم نقاط
    pointsChannels: [
        '1553263396047163448'
    ],
    // روم الترقيات (Promotion) — ترقية / خفض رتبة
    promotionChannels: [
        '1553263396047163450'
    ],

    // بوت يجيب سجل الروم الثلاثة أول ما يشتغل (كم رسالة يقرأ منها)
    sanctionsScanLimit: 400,

    // رتبة / روم الشرطة — أي أحد عنده وحدة يدخل الجدول تلقائياً
    memberRoles: [
        '1553263391215456330', // LSPD
        '1547691256115630221'  // Police (قديم)
    ],

    // روم الكاديت
    cadetRoles: [
        '1547691252714049587',
        '1547691250277163060'
    ],

    // شهادات / أقسام (Wings & Certifications)
    certifications: {
        '1553263391060004950': { name: 'Dispatch', ar: 'ديسباتش', icon: 'fa-headset', color: '#38bdf8' },
        '1553263391060004949': { name: 'Negotiator', ar: 'التفاوض', icon: 'fa-handshake', color: '#a78bfa' },
        '1553263391060004948': { name: 'Motorcycle', ar: 'موتورسايكل', icon: 'fa-motorcycle', color: '#fb923c' },
        '1553263391060004947': { name: 'Airship', ar: 'أيرشيب', icon: 'fa-helicopter', color: '#34d399' },
        '1553263391060004946': { name: 'Interceptor Lvl.2', ar: 'إنترسبتر lvl.2', icon: 'fa-plane', color: '#f472b6' },
        '1553263391060004945': { name: 'Interceptor Lvl.1', ar: 'إنترسبتر lvl.1', icon: 'fa-plane', color: '#60a5fa' },
        // القديمة (احتياط)
        '1547691339771281408': { name: 'Air Support', ar: 'الدعم الجوي', icon: 'fa-helicopter', color: '#34d399' },
        '1547691335606345759': { name: 'Interceptor', ar: 'إنترسبتر', icon: 'fa-plane', color: '#60a5fa' },
        '1547691337845969098': { name: 'Motorcycle', ar: 'موتورسايكل', icon: 'fa-motorcycle', color: '#fb923c' },
        '1547691341515989002': { name: 'Negotiation', ar: 'التفاوض', icon: 'fa-handshake', color: '#a78bfa' },
        '1526679318456176680': { name: 'Dispatch', ar: 'ديسباتش', icon: 'fa-headset', color: '#38bdf8' }
    },

    // ألقاب الرتب المدعومة (الاسم الإنجليزي + كلمات عربية) — الترتيب من الأعلى للأدنى
    ranks: [
        { level: 0, en: 'Chief of Police', ar: 'رئيس شرطة', kw: ['chief of police', 'police chief', 'رئيس شرطة', 'رئيس الشرطه'] },
        { level: 1, en: 'Deputy Chief', ar: 'نائب رئيس شرطة', kw: ['deputy chief', 'assistant chief', 'نائب رئيس'] },
        { level: 2, en: 'Captain', ar: 'قائد', kw: ['captain', 'قائد'] },
        { level: 3, en: 'First Lieutenant', ar: 'ملازم أول', kw: ['first lieutenant', 'ملازم اول', 'ملازم أول'] },
        { level: 4, en: 'Lieutenant', ar: 'ملازم', kw: ['lieutenant', 'ملازم'] },
        { level: 5, en: 'Staff Sergeant', ar: 'رقيب أول', kw: ['staff sergeant', 'رقيب اول', 'رقيب أول'] },
        { level: 6, en: 'First Sergeant', ar: 'رقيب أول (1)', kw: ['first sergeant', 'رقيب (1)', 'first sgt'] },
        { level: 7, en: 'Sergeant', ar: 'رقيب', kw: ['sergeant', 'رقيب', 'sgt'] },
        { level: 8, en: 'Field Commander', ar: 'قائد ميداني', kw: ['field commander', 'filed commander', 'command sergeant', 'قائد ميداني'] },
        { level: 9, en: 'Assist Police Supervisor', ar: 'مساعد مشرف شرطة', kw: ['assist police supervisor', 'assistant police supervisor', 'aps', 'مساعد مشرف'] },
        { level: 10, en: 'Senior Lead Officer', ar: 'ضابط أول', kw: ['senior lead officer', 'slo', 'ضابط اول', 'ضابط أول'] },
        { level: 11, en: 'Senior Officer', ar: 'ضابط', kw: ['senior officer', 'ضابط'] },
        { level: 12, en: 'Officer III', ar: 'ضابط ٣', kw: ['officer iii', 'officer 3', 'ضابط 3', 'ضابط ٣'] },
        { level: 13, en: 'Officer II', ar: 'ضابط ٢', kw: ['officer ii', 'officer 2', 'ضابط 2', 'ضابط ٢'] },
        { level: 14, en: 'Officer I', ar: 'ضابط ١', kw: ['officer i', 'officer 1', 'ضابط 1', 'ضابط ١'] },
        { level: 15, en: 'Solo Cadet', ar: 'كاديت منفرد', kw: ['solo cadet', 'solocadet', 'كاديت منفرد', 'سولو كاديت'] },
        { level: 16, en: 'Cadet', ar: 'كاديت', kw: ['cadet', 'كاديت', 'متدرب'] }
    ],

    // مين يعدّل بالموقع؟ الافتراضي: أنت فقط (المشرفين)
    // تقدر تختار روم معيّن من الموقع — أي أحد عنده الروم يقدر يعدّل
    editorRoleIds: (process.env.EDITOR_ROLE_IDS || '')
        .split(',').map(s => s.trim()).filter(Boolean),

    // هل لازم يكون عنده رتبة LSPD عشان يسجّل؟
    requireMemberRole: process.env.REQUIRE_MEMBER_ROLE === 'true',

    // كم رسالة نقرأ من روم التقارير
    reportsScanLimit: 600,

    // نبضة الحضور
    presenceTimeout: 70000
};

/* ============================================================================
 * 2) قاعدة البيانات (ملف JSON)
 * ==========================================================================*/

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const LEGACY_DB_FILE = path.join(__dirname, 'database.json');

function normalizeOfficer(o = {}) {
    return {
        hours: o.hours ?? null,
        hoursAuto: o.hoursAuto ?? 0,
        points: Number.isFinite(+o.points) ? +o.points : 0,
        pointsLog: Array.isArray(o.pointsLog) ? o.pointsLog : [],
        promotions: Array.isArray(o.promotions) ? o.promotions : [],
        strikeCount: o.strikeCount ?? 0,
        lastStrikeAt: o.lastStrikeAt ?? null,
        reports: Array.isArray(o.reports) ? o.reports : [],
        wings: Array.isArray(o.wings) ? o.wings : [],
        disabled: !!o.disabled,
        onLeave: !!o.onLeave,
        leaveUntil: o.leaveUntil ?? null,
        notes: o.notes || '',
        customRank: o.customRank || null,
        joinedTimestamp: o.joinedTimestamp ?? null,
        roleEvents: Array.isArray(o.roleEvents) ? o.roleEvents : [],
        history: Array.isArray(o.history) ? o.history : [],
        updatedAt: o.updatedAt ?? null,
        updatedBy: o.updatedBy || null
    };
}

function emptyDb() {
    return {
        version: 3,
        officers: {},
        accounts: {},
        logs: [],
        rankConfig: [],
        roleConfig: [],
        settings: { editorRoles: [] },
        meta: { auditSweptAt: 0, reportsSweptAt: 0 }
    };
}

let db = emptyDb();

function loadDb() {
    let parsed = {};
    let sourceFile = null;
    for (const p of [DB_FILE, LEGACY_DB_FILE]) {
        if (fs.existsSync(p)) {
            try { parsed = JSON.parse(fs.readFileSync(p, 'utf-8')); sourceFile = p; } catch (e) { parsed = {}; }
            break;
        }
    }

    const fresh = emptyDb();
    if (parsed && typeof parsed === 'object') {
        Object.assign(fresh, parsed);
    }
    if (!fresh.officers || typeof fresh.officers !== 'object') fresh.officers = {};
    if (!fresh.accounts || typeof fresh.accounts !== 'object') fresh.accounts = {};
    if (!Array.isArray(fresh.logs)) fresh.logs = [];
    if (!fresh.settings || typeof fresh.settings !== 'object') fresh.settings = { editorRoles: [] };
    if (!Array.isArray(fresh.settings.editorRoles)) fresh.settings.editorRoles = [];
    if (!Array.isArray(fresh.rankConfig)) fresh.rankConfig = [];
    if (!Array.isArray(fresh.roleConfig)) {
        // ترحيل: نحوّل الرتب القديمة إلى النظام الموحّد
        fresh.roleConfig = fresh.rankConfig.map((r, i) => ({ ...r, type: 'rank', order: r.order ?? (i + 1) }));
    }
    if (!fresh.meta || typeof fresh.meta !== 'object') fresh.meta = { auditSweptAt: 0, reportsSweptAt: 0 };

    // ترحيل من النسخة القديمة (خريطة مسطحة userId -> data)
    if (sourceFile === LEGACY_DB_FILE) {
        for (const [k, v] of Object.entries(parsed)) {
            if (v && typeof v === 'object' && !Array.isArray(v) &&
                (v.hours !== undefined || v.points !== undefined || Array.isArray(v.reports))) {
                if (!fresh.officers[k]) fresh.officers[k] = normalizeOfficer(v);
            }
        }
    } else {
        // نضيف الحقول الناقصة فقط، ونحافظ على أي بيانات زيادة موجودة
        for (const [k, v] of Object.entries(fresh.officers)) {
            if (!v || typeof v !== 'object') { fresh.officers[k] = normalizeOfficer(); continue; }
            const def = normalizeOfficer();
            for (const key of Object.keys(def)) if (v[key] === undefined) v[key] = def[key];
            fresh.officers[k] = v;
        }
    }

    db = fresh;
}

let saveTimer = null;
function saveDb() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            const tmp = DB_FILE + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
            fs.renameSync(tmp, DB_FILE);
        } catch (e) {
            console.error('خطأ حفظ قاعدة البيانات:', e.message);
        }
    }, 400);
}
function saveDbNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = DB_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
        fs.renameSync(tmp, DB_FILE);
    } catch (e) { console.error('خطأ حفظ قاعدة البيانات:', e.message); }
}

loadDb();

function officerStore(id) {
    let st = db.officers[id];
    if (!st) {
        db.officers[id] = normalizeOfficer();
        return db.officers[id];
    }
    // نكمّل الحقول الناقصة فقط — بدون ما نمسح أي حقل زيادة موجود (زي leftAt و lastNicknameChange)
    const def = normalizeOfficer();
    for (const k of Object.keys(def)) {
        if (st[k] === undefined) st[k] = def[k];
    }
    if (!Array.isArray(st.reports)) st.reports = [];
    if (!Array.isArray(st.roleEvents)) st.roleEvents = [];
    if (!Array.isArray(st.history)) st.history = [];
    if (!Array.isArray(st.wings)) st.wings = [];
    return st;
}

/* ============================================================================
 * 3) أدوات مساعدة
 * ==========================================================================*/

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** أقدم آيدي في الدفعة — بديل آمن عن messages.last() */
function oldestId(messages) {
    let oldest = null;
    if (messages && typeof messages.values === 'function') {
        for (const m of messages.values()) {
            const id = m && m.id ? String(m.id) : null;
            if (id && (oldest === null || id < oldest)) oldest = id;
        }
    }
    return oldest;
}
/** ترتيب الرسائل من الأقدم للأحدث */
function byOldest(messages) {
    return [...(messages.values ? messages.values() : [])]
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function stripDiacritics(s) {
    return String(s || '')
        .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
        .replace(/[\u200E\u200F\u202A-\u202E]/g, '');
}
function normKey(s) {
    return stripDiacritics(s)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '');
}
function cleanText(s) {
    return String(s || '').replace(/<@!?(\d{17,19})>/g, '@$1').replace(/[*_`~>#|]/g, '').trim();
}
function newId(prefix = '') {
    return prefix + crypto.randomBytes(12).toString('hex');
}
function newToken() {
    return crypto.randomBytes(24).toString('hex');
}
function clientIp(req) {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
    return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function prettyUa(ua = '') {
    const os = /Windows/i.test(ua) ? 'Windows'
        : /Android/i.test(ua) ? 'Android'
        : /iPhone|iPad|iOS/i.test(ua) ? 'iOS'
        : /Mac OS/i.test(ua) ? 'macOS'
        : /Linux/i.test(ua) ? 'Linux' : '—';
    const br = /Edg\//i.test(ua) ? 'Edge'
        : /OPR\//i.test(ua) ? 'Opera'
        : /Firefox\//i.test(ua) ? 'Firefox'
        : /Chrome\//i.test(ua) ? 'Chrome'
        : /Safari\//i.test(ua) ? 'Safari' : '';
    return br ? `${os} • ${br}` : os;
}
function fmtDateTime(ts) {
    if (!ts) return '—';
    try {
        return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: true
        }).format(new Date(ts));
    } catch { return new Date(ts).toLocaleString(); }
}
function toIso(ts) {
    if (!ts) return null;
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return null;
    try { return new Date(n).toISOString(); } catch { return null; }
}
function fmtDT(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '—';
    try {
        return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: true
        }).format(new Date(n));
    } catch { return new Date(n).toISOString().slice(0, 16).replace('T', ' '); }
}

/** يحلّل اسم الديسكورد: [TAG] اسم الشخصية | الاسم الحقيقي */
function parseIdentity(raw) {
    const full = String(raw || '').trim();
    let callsign = '';
    const tag = full.match(/[\[({]([^\])}]{1,24})[\])}]/);
    if (tag) callsign = tag[1].trim();
    let rest = full;
    if (tag) rest = full.replace(tag[0], ' ');
    rest = rest.replace(/\s{2,}/g, ' ').trim();
    let charName = rest;
    let oocName = '';
    const pipe = rest.split(/\s*\|\s*/);
    if (pipe.length > 1) { charName = pipe[0].trim(); oocName = pipe.slice(1).join(' | ').trim(); }
    return { full, callsign, charName: charName || rest, oocName };
}

/** ينظّف اسم الرتبة من الزخرفة (نجوم، إيموجي، شرطات) ليبقى الإنجليزي نظيف */
function cleanRoleName(name) {
    return String(name || '')
        .replace(/<a?:\w+:\d+>/g, ' ')   // إيموجي مخصّص
        .replace(/[\u200B-\u200F\uFE0E\uFE0F]/g, ' ')
        .replace(/[★☆✦✧✪✫]/g, ' ')
        .replace(/[^\p{L}\p{N}\s.\-()/&']/gu, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/* ------------------------- إدارة الرتب ------------------------- */
/* الرتب تنقرأ من رومات الديسكورد مباشرة، وترتيبها يتحكم به المشرف من الموقع.
   الصيغة المحفوظة: db.rankConfig = [{ id, name, order, enabled }]  — order أصغر = رتبة أعلى */

/** كلمات دالة على رتبة — أي روم فيها وحدة منها يُعتبر رتبة، حتى لو أضفت رتبة جديدة */
const RANK_NOUNS = [
    'chief', 'deputy', 'captain', 'lieutenant', 'sergeant', 'officer', 'cadet',
    'corporal', 'detective', 'inspector', 'marshal', 'commander', 'supervisor',
    'constable', 'trooper', 'agent', 'sheriff', 'patrolman', 'recruit'
];

function rankDefForRoleName(roleName) {
    const n = normKey(roleName);
    if (!n) return null;

    // 1) تطابق كامل أو جزئي مع القوائم المعروفة
    for (const def of CONFIG.ranks) {
        for (const kw of def.kw) {
            const k = normKey(kw);
            if (k && n === k) return def;
        }
    }
    for (const def of CONFIG.ranks) {
        for (const kw of def.kw) {
            const k = normKey(kw);
            if (k.length >= 4 && n.includes(k)) return def;
        }
    }

    // 2) أي كلمة دالة على رتبة (يغطي الرتب الجديدة تلقائياً)
    const words = cleanRoleName(roleName)
        .split(/[\s_\-/|(),.]+/)
        .map(w => normKey(w))
        .filter(Boolean);
    if (words.some(w => RANK_NOUNS.includes(w))) {
        return { level: 50, en: cleanRoleName(roleName) || roleName, ar: '', kw: [], guessed: true };
    }
    return null;
}

/** روم تقنية/بوتات ما نبيها تظهر.
 *  ملاحظة: ما نخفي "Member" ولا "رئيس..." — هذي مسؤوليات، المشرف يفعّلها بنفسه. */
const JUNK_ROLE_RES = [
    /\bbots?\b/i, /pro\s*bot/i, /server\s*booster/i, /valorant/i, /sapph?ire/i,
    /^security$/i, /luna\s*bot/i, /^vacations?$/i, /^wicks?$/i, /^all\s*wings?$/i,
    /^\s*et\b/i, /^staff$/i, /^server$/i, /^clan$/i, /^family$/i
];

function classifyRole(role) {
    if (role.managed) return 'hide';
    if (role.id === role.guild?.id) return 'hide';
    if (role.name === '@everyone') return 'hide';
    if (CONFIG.certifications[role.id]) return 'cert';
    if (CONFIG.memberRoles.includes(role.id)) return 'hide';   // LSPD — عضوية
    if (CONFIG.cadetRoles.includes(role.id)) return 'hide';
    if (rankDefForRoleName(role.name)) return 'rank';
    const clean = cleanRoleName(role.name) || role.name;
    if (JUNK_ROLE_RES.some(re => re.test(clean))) return 'hide';
    // مسؤوليات: أي روم ثاني فيه أعضاء
    const count = role.members?.size ?? 0;
    if (count > 0) return 'duty';
    return 'hide';
}

/** يكتشف كل رومات السيرفر مقسّمة حسب النوع */
function detectAllRoles(guild) {
    if (!guild) return [];
    const out = [];
    for (const role of guild.roles.cache.values()) {
        const type = classifyRole(role);
        if (type === 'hide') continue;
        out.push({
            id: role.id,
            type,
            name: cleanRoleName(role.name) || role.name,
            rawName: role.name,
            position: role.position ?? 0,
            members: role.members?.size ?? 0
        });
    }
    out.sort((a, b) => (a.type === b.type) ? b.position - a.position : typeRank(a.type) - typeRank(b.type));
    return out;
}
function typeRank(t) { return t === 'rank' ? 0 : (t === 'cert' ? 1 : 2); }

/** يدمج المكتشف مع المحفوظ: يحافظ على ترتيب المشرف وأسماؤه، ويضيف الجديد تلقائياً.
 *  الأدوار اللي أضافها المشرف يدوياً (فاضية بالديسكورد) ما تتحذف. */
function syncRoleConfig(guild) {
    const detected = detectAllRoles(guild);
    const detectedIds = new Set(detected.map(d => d.id));
    const saved = new Map((db.roleConfig || []).map(r => [r.id, r]));
    const legacy = new Map((db.rankConfig || []).map(r => [r.id, r]));   // ترحيل من النسخة السابقة
    const result = [];
    const counters = { rank: 0, cert: 0, duty: 0 };
    const handled = new Set();

    for (const d of detected) {
        const s = saved.get(d.id) || legacy.get(d.id);
        handled.add(d.id);
        counters[d.type]++;
        result.push({
            id: d.id,
            type: d.type,
            name: (s && s.name) || d.name,
            order: s && Number.isFinite(s.order) ? s.order : counters[d.type],
            // المسؤوليات الجديدة تبدأ مخفية — المشرف يفعّل اللي يبيه
            enabled: s ? s.enabled !== false : (d.type !== 'duty'),
            position: d.position
        });
    }

    // اللي أضافه المشرف يدوياً وغير موجود بقائمة المكتشف — نخليه مكانه
    for (const [id, s] of saved) {
        if (handled.has(id)) continue;
        const role = guild?.roles.cache.get(id);
        const type = (s.type === 'rank' || s.type === 'cert') ? s.type : 'duty';
        counters[type]++;
        result.push({
            id,
            type,
            name: s.name || (role ? (cleanRoleName(role.name) || role.name) : id),
            order: Number.isFinite(s.order) ? s.order : counters[type],
            enabled: s.enabled !== false,
            position: role ? (role.position ?? 0) : null
        });
    }

    result.sort((a, b) => (b.enabled - a.enabled) || (a.type === b.type ? (a.order - b.order) : typeRank(a.type) - typeRank(b.type)));
    db.roleConfig = result;
    db.rankConfig = result.filter(r => r.type === 'rank').map(({ id, name, order, enabled }) => ({ id, name, order, enabled }));
    saveDb();
    return result;
}

/** توافق مع الاسم القديم */
function syncRankConfig(guild) { return syncRoleConfig(guild); }

function roleConfigList(type) {
    const all = (Array.isArray(db.roleConfig) ? db.roleConfig : []).filter(r => r.enabled !== false);
    return type ? all.filter(r => r.type === type) : all;
}
function rankConfigList() { return roleConfigList('rank'); }
function dutyConfigList() { return roleConfigList('duty'); }

function roleOrder(roleId) {
    const list = roleConfigList();
    const i = list.findIndex(r => r.id === roleId);
    return i === -1 ? 9999 : i;
}
function isRankRoleId(roleId) { return rankConfigList().some(r => r.id === roleId); }
function isDutyRoleId(roleId) { return dutyConfigList().some(r => r.id === roleId); }

/** رتبة الفرد = رتبة رومه الأعلى (حسب ترتيب المشرف) */
function memberRankInfo(member) {
    if (!member) return null;
    const list = rankConfigList();
    let best = null;
    for (const role of member.roles.cache.values()) {
        const i = list.findIndex(r => r.id === role.id);
        if (i === -1) continue;
        if (!best || i < best.index) {
            best = { roleId: role.id, name: list[i].name, order: list[i].order, index: i };
        }
    }
    if (best) return best;
    // احتياط: ما لقى رتبة معروفة — نعطيه ترتيب عشوائي فريد بعد كل الرتب
    // (ما نبيه ياخذ التاج، وما نبيه يطلع قبل أحد)
    const def = rankDefForRoleName(member.roles.cache.map(r => r.name).join(' '));
    if (def) {
        return { roleId: null, name: def.en, order: 900 + (def.level || 0), index: 900 + (def.level || 0), guessed: true };
    }
    return null;
}

/** مسؤوليات الفرد (روم غير رتبة ولا شهادة) */
function memberDuties(member) {
    if (!member) return [];
    const list = dutyConfigList();
    const out = [];
    for (const role of member.roles.cache.values()) {
        const cfg = list.find(r => r.id === role.id);
        if (!cfg) continue;
        out.push({ roleId: role.id, name: cfg.name, order: cfg.order });
    }
    return out.sort((a, b) => a.order - b.order);
}

/** يرجع رتبة الفرد بالشكل القديم (level) — للتوافق مع الكود القديم */
function memberRank(member) {
    const info = memberRankInfo(member);
    if (!info) return null;
    return { level: info.order, en: info.name, ar: '', roleId: info.roleId, custom: !!info.roleId };
}

function memberCertifications(member) {
    if (!member) return [];
    const out = [];
    for (const role of member.roles.cache.values()) {
        const def = CONFIG.certifications[role.id];
        if (def) out.push({ roleId: role.id, roleName: role.name, ...def });
    }
    return out;
}

function isCadetMember(member) {
    if (!member) return false;
    if ([...member.roles.cache.keys()].some(id => CONFIG.cadetRoles.includes(id))) return true;
    const info = memberRankInfo(member);
    if (!info) return false;
    // كاديت/سولو كاديت = آخر رتبتين بالترتيب
    const list = rankConfigList();
    const i = list.findIndex(r => r.id === info.roleId);
    if (i === -1) return false;
    return i >= list.length - 2;
}

function isMemberOfPolice(member) {
    if (!member) return false;
    const ids = [...member.roles.cache.keys()];
    if (ids.some(id => CONFIG.memberRoles.includes(id))) return true;
    if (ids.some(id => CONFIG.cadetRoles.includes(id))) return true;
    const r = memberRank(member);
    if (r) return true;
    if (ids.some(id => CONFIG.certifications[id])) return true;
    return false;
}

/* ============================================================================
 * 4) سجل العمليات (Logs)
 * ==========================================================================*/

function addLog(action, { by, byCopyId, target, targetId, details } = {}) {
    db.logs.unshift({
        at: Date.now(),
        action,
        by: by || 'النظام',
        byCopyId: byCopyId || null,
        target: target || '—',
        targetId: targetId || null,
        details: details || null
    });
    if (db.logs.length > 800) db.logs.length = 800;
    saveDb();
}

function addHistory(memberId, entry) {
    const st = officerStore(memberId);
    st.history.unshift({ at: Date.now(), ...entry });
    if (st.history.length > 200) st.history.length = 200;
}

/* ============================================================================
 * 5) بوت الديسكورد
 * ==========================================================================*/

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let guildRef = null;
const memberNameCache = new Map(); // id -> { name, tag }
let officersCache = [];
let registryReady = false;
let isSyncing = false;

function rememberMember(id, member) {
    if (!id || !member) return;
    const name = member.displayName || member.user.username;
    memberNameCache.set(id, {
        name,
        display: name,
        tag: member.user.tag || member.user.username,
        avatar: member.user.displayAvatarURL({ extension: 'png', size: 128 })
    });
    if (memberNameCache.size > 800) memberNameCache.delete(memberNameCache.keys().next().value);
}
function cachedName(id) {
    if (!id) return 'النظام';
    return memberNameCache.get(id)?.name || 'عضو غير معروف';
}
function cachedAvatar(id) {
    return memberNameCache.get(id)?.avatar || null;
}

function fullMessage(msg) {
    const parts = [];
    if (msg.content && msg.content.trim()) parts.push(msg.content.trim());
    for (const emb of (msg.embeds || [])) {
        if (emb.title) parts.push(`[${emb.title}]`);
        if (emb.description) parts.push(emb.description);
        for (const f of (emb.fields || [])) parts.push(`${f.name}: ${f.value}`);
    }
    if (msg.attachments && msg.attachments.size) parts.push('[مرفق / صورة]');
    return parts.length ? parts.join('\n') : 'بدون نص';
}

function extractMention(text, msg) {
    if (msg.mentions && msg.mentions.users.size) return msg.mentions.users.first().id;
    const m = String(text || '').match(/<@!?(\d{17,19})>/);
    if (m) return m[1];
    const ids = String(text || '').match(/\b\d{17,19}\b/g);
    if (ids && ids.length) return ids[0];
    return null;
}

function extractHours(text) {
    const t = String(text || '');
    let m = t.match(/Total\s*Minutes\s*:?\s*([\d,]+)/i) || t.match(/دقائق\s*:?\s*([\d,]+)/i) || t.match(/minutes\s*:?\s*([\d,]+)/i);
    if (m) return +( (+m[1].replace(/,/g, '')) / 60 ).toFixed(2);
    m = t.match(/Total\s*Duty\s*Time\s*:?\s*([\d.]+)\s*h/i);
    if (m) return +parseFloat(m[1]).toFixed(2);
    m = t.match(/([\d]+(?:\.\d+)?)\s*(?:ساعة|ساعه|ساعات|hours?|hrs?)/i);
    if (m) return +parseFloat(m[1]).toFixed(2);
    return null;
}

/* ================= قالب رسائل الخصم / النقاط / الترقيات ================= */

/**
 * يحوّل رسالة القالب (Embed) لكائن منظّم.
 * يقرأ: محتوى الرسالة + كل حقول الـ Embeds + الوصف، ويقبل أي ترتيب أو اسم حقل.
 * مثال:  Officer Name: <@1>  From: X  To: Y  Reason: Z  Coommend By: <@2>
 */
function parseTemplate(msg) {
    const key = s => String(s || '').toLowerCase()
        .replace(/[\u200B-\u200F]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '');

    const fields = [];       // { key, label, value }
    const push = (label, value) => {
        const k = key(label);
        if (!k) return;
        // منشن شخص <@id>  •  منشن رتبة <@&id>  •  منشن روم <@&id>
        const v = String(value ?? '')
            .replace(/<@!?(\d{17,19})>/g, '@$1')
            .replace(/<@&(\w+)>/g, '&$1')     // منشن رتبة
            .trim();
        const hit = fields.find(x => x.key === k);
        if (hit) hit.value = (hit.value ? hit.value + '\n' : '') + v;
        else fields.push({ key: k, label: String(label).trim(), value: v });
    };

    let title = '';
    for (const emb of (msg.embeds || [])) {
        if (emb.title && !title) title = emb.title;
        if (emb.description) push(emb.title || 'description', emb.description);
        for (const f of (emb.fields || [])) push(f.name, f.value);
    }
    // محتوى الرسالة نفسه — لو ما استخدم Embed
    if (msg.content) push('content', msg.content);

    const get = (re) => {
        const f = fields.find(x => re.test(x.key) || re.test(x.label));
        return f ? f.value.trim() : '';
    };
    const idIn = (re) => {
        const f = fields.find(x => re.test(x.key) || re.test(x.label));
        if (!f) return null;
        const m = f.value.match(/@(\d{17,19})/);
        return m ? m[1] : null;
    };

    return {
        title, fields,
        byKey: get,
        firstId: idIn,
        /** أول اسم شخص ظاهر بالحقول (لو ما فيه منشن) */
        firstName: (re) => {
            const v = get(re);
            if (!v) return '';
            return v.split('\n')[0].replace(/@\d{17,19}/g, '').replace(/[*_`~>#|]/g, '').trim();
        },
        raw: fullMessage(msg)
    };
}

/** ينظّف قيمة "أمرها" — منشن أو اسم مكتوب */
function cleanIssuer(rawVal, idVal) {
    if (idVal) return `${cachedName(idVal)} (${idVal})`;
    const t = String(rawVal || '').replace(/\s*\|\s*/g, ' ').replace(/[*_`~>]/g, '').trim();
    if (!t) return 'الديسكورد';
    return t.replace(/^@/, '').trim() || 'الديسكورد';
}

/** يلقى الفرد بالمنشن أو بالاسم (لو ما فيه منشن) */
function resolveTarget(t, msg) {
    const OFFICER_RE = /officer|staff|member|name|person|ضابط|عضو|شرطي/;
    const byId = t.firstId(OFFICER_RE);
    if (byId) return byId;
    // منشن بأي حقل ثاني
    for (const f of t.fields) {
        const m = f.value.match(/@(\d{17,19})/);
        if (m) {
            // نتجاهل منشن "أمرها" لو كان الحقلOfficer فاضي
            if (/commend|coommend|by|issued|signed|بامر/i.test(f.key)) continue;
            return m[1];
        }
    }
    const viaMention = extractMention(t.raw, msg);
    if (viaMention) return viaMention;

    // آخر محاولة: بالاسم
    const nm = t.firstName(OFFICER_RE);
    if (nm && nm.length >= 2) {
        const k = normKey(nm);
        for (const o of officersCache) {
            const cands = [o.name, o.charName, o.callsign, o.username].filter(Boolean).map(normKey);
            if (cands.some(c => c === k || (k.length > 3 && c.length > 3 && (c.includes(k) || k.includes(c))))) return o.id;
        }
    }
    return null;
}

/** يستخرج أول رقم "منطقي" — يتجاهل آيدات الديسكورد الطويلة */
function saneNumber(text) {
    const m = String(text || '').match(/-?\d+(?:\.\d+)?/g);
    if (!m) return null;
    for (const raw of m) {
        const n = Number(raw);
        if (Number.isFinite(n) && Math.abs(n) < 100000) return n;
    }
    return null;
}

/** يطبّق حركة نقاط (إضافة/خصم) ويسجّلها بالسجل.
 *  msgId مفتاح منع التكرار — بدونه كل إعادة تشغيل للسيرفر تعيد تطبيق الخصم. */
function applyPoints(memberId, delta, { type, reason, by, byId, at, channelName, msgId }) {
    if (!memberId || !Number.isFinite(delta) || delta === 0) return null;
    const st = officerStore(memberId);

    if (msgId) {
        if (!Array.isArray(st.pointsLog)) st.pointsLog = [];
        if (st.pointsLog.some(x => x.msgId === msgId)) return null;   // مطبّق مسبقاً
    }

    const before = st.points || 0;
    st.points = Math.max(0, before + delta);
    const applied = st.points - before;

    if (!Array.isArray(st.pointsLog)) st.pointsLog = [];
    st.pointsLog.unshift({
        msgId: msgId || null,
        at: at || Date.now(),
        delta: applied,             // اللي طُبّق فعلاً
        requested: delta,           // اللي طلبوه
        balanceAfter: st.points,
        type, reason: reason || '', by: by || '', byId: byId || null,
        channel: channelName || ''
    });
    if (st.pointsLog.length > 150) st.pointsLog.length = 150;

    if (type === 'strike') {
        st.strikeCount = (st.strikeCount || 0) + 1;
        st.lastStrikeAt = at || Date.now();
    }

    addHistory(memberId, {
        type: type === 'strike' ? 'strike' : 'points',
        icon: type === 'strike' ? 'fa-gavel' : 'fa-star',
        title: type === 'strike' ? 'خصم نقاط (Strike)' : (applied >= 0 ? 'إضافة نقاط' : 'خصم نقاط'),
        detail: `${applied >= 0 ? '+' : ''}${applied} نقطة — ${before} ← ${st.points}` +
            (applied === 0 && delta < 0 ? '\n⚠ الرصيد كان صفر فما انخصم شي' : '') +
            (reason ? `\nالسبب: ${reason}` : ''),
        by: by || 'الديسكورد'
    });
    saveDb();
    return { before, after: st.points, applied, requested: delta };
}

function handleStrikeMessage(msg) {
    if (msg.author.bot) return;
    const t = parseTemplate(msg);
    const targetId = resolveTarget(t, msg);
    if (!targetId) { console.warn('[strike] ما لقيت الفرد بالرسالة', msg.id); return; }

    const st = officerStore(targetId);
    if ((st.pointsLog || []).some(x => x.msgId === msg.id)) return;   // مطبّق مسبقاً

    let amount = saneNumber(t.byKey(/strike|strikes|deduct|punish|number|count|خصم/));
    if (amount === null) {
        const m = t.raw.match(/strike\s*:?\s*(\d+)/i);
        amount = m ? parseInt(m[1], 10) : saneNumber(t.raw);
    }
    if (amount === null || amount <= 0) amount = 1;
    amount = Math.min(Math.abs(amount), 100000);

    const reason = t.byKey(/reason|desc|description|سبب|وصف/) || '(ما ذكر سبب)';
    const byId = t.firstId(/commend|coommend|by|issued|signed|amir|بامر/);
    const by = cleanIssuer(t.byKey(/commend|coommend|by|issued|signed|amir|بامر/), byId);

    const res = applyPoints(targetId, -amount, {
        type: 'strike',
        reason,
        by, byId,
        at: msg.createdTimestamp,
        channelName: msg.channel.name || 'Strike',
        msgId: msg.id
    });
    if (res) {
        addLog('خصم نقاط (Strike)', { by, byCopyId: byId, target: targetId, details: `-${res.applied} • ${reason}` });
        refreshRegistry(true);
    }
}

function handlePointsMessage(msg) {
    if (msg.author.bot) return;
    const t = parseTemplate(msg);
    const targetId = resolveTarget(t, msg);
    if (!targetId) { console.warn('[points] ما لقيت الفرد بالرسالة', msg.id); return; }

    const st = officerStore(targetId);
    if ((st.pointsLog || []).some(x => x.msgId === msg.id)) return;

    const rawVal = t.byKey(/point|points|nadda|نقاط|score/) || t.raw;
    let amount = saneNumber(rawVal);
    if (amount === null) { console.warn('[points] ما لقيت رقم', msg.id); return; }

    // إشارة السالب = خصم
    if (/(^|[\s:>])-\s*\d/.test(String(rawVal))) amount = -Math.abs(amount);
    else amount = Math.abs(amount);

    const reason = t.byKey(/reason|desc|description|سبب|وصف/) || '';
    const byId = t.firstId(/commend|coommend|by|issued|signed|amir|بامر/);
    const by = cleanIssuer(t.byKey(/commend|coommend|by|issued|signed|amir|بامر/), byId);

    const res = applyPoints(targetId, amount, {
        type: 'points',
        reason, by, byId,
        at: msg.createdTimestamp,
        channelName: msg.channel.name || 'Points',
        msgId: msg.id
    });
    if (res) {
        addLog(amount >= 0 ? 'إضافة نقاط' : 'خصم نقاط', { by, byCopyId: byId, target: targetId, details: `${res.applied >= 0 ? '+' : ''}${res.applied} • ${reason}` });
        refreshRegistry(true);
    }
}

function handlePromotionMessage(msg) {
    if (msg.author.bot) return;
    const t = parseTemplate(msg);
    const targetId = resolveTarget(t, msg);
    if (!targetId) { console.warn('[promotion] ما لقيت الفرد بالرسالة', msg.id); return; }

    const st = officerStore(targetId);
    if (!Array.isArray(st.promotions)) st.promotions = [];
    if (st.promotions.some(p => p.msgId === msg.id)) return;   // مطبّق مسبقاً

    // نلتقط من/إلى — يقبل منشن رتبة <@&id> أو نص عادي
    const clean = (s) => String(s || '').replace(/\s*\|\s*/g, ' ').replace(/[*_`~>]/g, '').trim();

    const rankOf = (val) => {
        const v = String(val || '').trim();
        if (!v) return '';
        // منشن رتبة: <@&id> أو &id — نحوّله لاسم الرتبة الحقيقي
        const rm = v.match(/<@&(\w+)>|^&(\w+)$/);
        if (rm) {
            const rid = rm[1] || rm[2];
            const role = guildRef?.roles.cache.get(rid);
            const cfg = (db.roleConfig || []).find(r => r.id === rid);
            return cfg?.name || (role ? (cleanRoleName(role.name) || role.name) : '');
        }
        // منشن شخص عادي كرتبة؟ نتجاهل
        if (/^@(\d{17,19})$/.test(v)) return '';
        return v.replace(/^@/, '').trim();
    };

    let fromRaw = t.byKey(/^from$|oldrank|old|prev|previous|fromrank|من/) || t.byKey(/^from/);
    let toRaw = t.byKey(/^to$|newrank|new|next|promoteto|الي|الى|إلى/) || t.byKey(/^to/);
    let fromRank = rankOf(fromRaw);
    let toRank = rankOf(toRaw);

    if (!fromRank || !toRank) {
        const m = t.raw.match(/(?:^|\n)\s*from\s*:?\s*([^\n]+)[\s\S]*?\n?\s*to\s*:?\s*([^\n]+)/i);
        if (m) { fromRank = fromRank || rankOf(m[1]); toRank = toRank || rankOf(m[2]); }
    }

    const reason = clean(t.byKey(/reason|desc|description|سبب|وصف/));
    // "أمرها" أحياناً اسم مكتوب مو منشن — ننظفه بدل ما نتجاهله
    const byRaw = t.byKey(/commend|coommend|by|issued|signed|amir|بامر/);
    const byId = t.firstId(/commend|coommend|by|issued|signed|amir|بامر/);
    const by = byId
        ? `${cachedName(byId)} (${byId})`
        : (clean(byRaw).replace(/^@/, '').trim() || 'الديسكورد');

    st.promotions.unshift({
        msgId: msg.id,
        at: msg.createdTimestamp,
        from: fromRank || 'غير محدد',
        to: toRank || 'غير محدد',
        reason, by, byId,
        channelName: msg.channel.name || 'Promotion'
    });
    if (st.promotions.length > 80) st.promotions.length = 80;

    addHistory(targetId, {
        type: 'promote',
        icon: 'fa-arrow-trend-up',
        title: `ترقية: ${fromRank || '—'} ← ${toRank || '—'}`,
        detail: (reason ? `السبب: ${reason}\n` : '') + `أمرها: ${by}`,
        by
    });
    addLog('ترقية', { by, byCopyId: byId, target: targetId, details: `${fromRank || '—'} ← ${toRank || '—'}${reason ? ' • ' + reason : ''}` });
    saveDb();
    refreshRegistry(true);
}

/** يشرح سبب فشل تغيير الرتبة بشكل مفهوم */
function explainRoleError(e) {
    const m = String(e?.message || e);
    if (/Missing Permissions/i.test(m)) {
        return 'البوت ما عنده صلاحية **Manage Roles** — فعّلها له من إعدادات السيرفر.';
    }
    if (/higher role|role.*higher|position/i.test(m)) {
        return '**رتبة البوت بالسيرفر أقل** من الرتبة الجديدة. لازم ترفع رتبة البوت فوق كل الرتب (إعدادات السيرفر ← الأدوار).';
    }
    if (/Missing Access/i.test(m)) {
        return 'البوت ما عنده صلاحية **View Server** على هذي العضو.';
    }
    if (/rate ?limit|429/i.test(m)) {
        return 'ديسكورد يطلبنا نستنى — حاول مرة ثانية بعد ٥ ثواني.';
    }
    return m;
}

/** يقرأ أرشيف الرومات الثلاثة أول ما يشتغل.
 *  مهم: نجمع كل الرسائل من الرومات الثلاث ونرتبها زمنياً قبل التطبيق —
 *  وإلا صار الرصيد حسب ترتيب الرومات مو حسب الوقت. */
async function syncSanctions() {
    if (!guildRef) return;
    const map = [
        { ids: CONFIG.strikeChannels, type: 'strike', fn: handleStrikeMessage },
        { ids: CONFIG.pointsChannels, type: 'points', fn: handlePointsMessage },
        { ids: CONFIG.promotionChannels, type: 'promotion', fn: handlePromotionMessage }
    ];

    // 1) نجمع كل الرسائل
    const collected = [];
    for (const entry of map) {
        for (const cid of entry.ids) {
            const channel = await guildRef.channels.fetch(cid).catch(() => null);
            if (!channel || !channel.isTextBased()) continue;
            let lastId, count = 0;
            while (count < CONFIG.sanctionsScanLimit) {
                const opts = { limit: 100 };
                if (lastId) opts.before = lastId;
                const messages = await channel.messages.fetch(opts).catch(() => null);
                if (!messages || messages.size === 0) break;
                for (const m of byOldest(messages)) collected.push({ m, type: entry.type, fn: entry.fn });
                count += messages.size;
                lastId = oldestId(messages);
                if (messages.size < 100 || !lastId) break;
            }
        }
    }

    // 2) نطبّقها كلّها من الأقدم للأحدث — مهما كان الروم
    collected.sort((a, b) => a.m.createdTimestamp - b.m.createdTimestamp);
    let applied = 0;
    for (const c of collected) {
        try { c.fn(c.m, true); applied++; } catch (e) { console.warn('sanction parse:', e.message); }
    }
    console.log(`[الجزاءات] ${collected.length} رسالة روم (${applied} معالَجة) — روم الخصم والنقاط والترقيات`);
    saveDb();
}

/* ---------------------------- حالة البوت ---------------------------- */

let loginError = null;

/** يختار السيرفر المطلوب من أول آيدي لقيه، أو أكبر سيرفر كاحتياط */
async function resolveGuild() {
    if (!client.isReady()) return null;
    for (const id of CONFIG.guildIds) {
        try {
            const g = client.guilds.cache.get(id) || await client.guilds.fetch(id);
            if (g) return g;
        } catch { /* السيرفر مو موجود أو البوت مو داخله — نجرب التالي */ }
    }
    if (client.guilds.cache.size > 0) {
        const list = [...client.guilds.cache.values()].sort((a, b) => b.memberCount - a.memberCount);
        const pick = list[0];
        console.warn(`[تحذير] آيدي السيرفر (${CONFIG.guildIds.join(', ')}) ما لقيته عند البوت.`);
        console.warn(`[تحذير] راح يستخدم السيرفر الأكبر: "${pick.name}"`);
        console.warn(`[تحذير] الآيدي الصحيح — حطه بمتغيّر GUILD_ID:  ${pick.id}`);
        return pick;
    }
    return null;
}

/** ملخص الحالة — المشرف يقدر يفحصه من المتصفح على /api/health */
function botDiagnostics() {
    return {
        botReady: client.isReady(),
        botTag: client.user?.tag || null,
        loginError,
        configuredGuildIds: CONFIG.guildIds,
        activeGuildId: guildRef?.id || null,
        activeGuildName: guildRef?.name || null,
        activeGuildMembers: guildRef?.memberCount ?? null,
        guildMatchedConfig: !!guildRef && CONFIG.guildIds.includes(guildRef.id),
        botGuilds: [...client.guilds.cache.values()]
            .map(g => ({ id: g.id, name: g.name, members: g.memberCount }))
            .sort((a, b) => b.members - a.members)
    };
}

/* ---------------------------- مزامنة السجل ---------------------------- */

async function sweepAuditLogs(guild) {
    if (!guild) return;
    console.log('[سجل الديسكورد] بدء القراءة…');

    const targets = [
        { type: AuditLogEvent.MemberRoleUpdate, pages: 8 },
        { type: AuditLogEvent.MemberJoin, pages: 6 },
        { type: AuditLogEvent.MemberNicknameUpdate, pages: 4 }
    ];

    for (const target of targets) {
        let before;
        for (let p = 0; p < target.pages; p++) {
            let logs;
            try {
                logs = await guild.fetchAuditLogs({ type: target.type, limit: 100, before });
            } catch (e) {
                console.warn('  تعذّر جلب سجل:', e.message);
                break;
            }
            if (!logs || logs.size === 0) break;

            for (const entry of logs.values()) {
                if (!entry.targetId) continue;
                const st = officerStore(entry.targetId);

                if (entry.type === AuditLogEvent.MemberRoleUpdate) {
                    for (const ch of (entry.changes || [])) {
                        const kind = ch.key === '$add' ? 'add' : (ch.key === '$remove' ? 'remove' : null);
                        if (!kind) continue;
                        const raw = Array.isArray(ch.newValue) ? ch.newValue : (ch.newValue ? [ch.newValue] : []);
                        for (const item of raw) {
                            const roleId = typeof item === 'string' ? item : item.id;
                            if (!roleId) continue;
                            const roleName = (typeof item === 'object' && item.name) || (guild.roles.cache.get(roleId)?.name || roleId);
                            st.roleEvents.push({
                                roleId, roleName, kind,
                                by: entry.executorId || null,
                                at: entry.createdTimestamp
                            });
                        }
                    }
                } else if (entry.type === AuditLogEvent.MemberJoin) {
                    if (!st.joinedTimestamp || entry.createdTimestamp < st.joinedTimestamp) {
                        st.joinedTimestamp = entry.createdTimestamp;
                    }
                } else if (entry.type === AuditLogEvent.MemberNicknameUpdate) {
                    // نتجاهله فقط نضيف لمعلومة
                    st.lastNicknameChange = { at: entry.createdTimestamp, by: entry.executorId || null };
                }
            }

            before = logs.last().id;
            if (logs.size < 100) break;
            await sleep(3200);
        }
        // تنظيف التكرار + الترتيب
        for (const st of Object.values(db.officers)) {
            const seen = new Set();
            st.roleEvents = st.roleEvents
                .filter(e => {
                    const k = `${e.roleId}|${e.kind}|${e.at}|${e.by}`;
                    if (seen.has(k)) return false;
                    seen.add(k);
                    return true;
                })
                .sort((a, b) => b.at - a.at)
                .slice(0, 120);
        }
        saveDb();
    }

    db.meta.auditSweptAt = Date.now();
    saveDb();
    console.log('[سجل الديسكورد] انتهت القراءة.');
}

async function syncJoinDates(guild) {
    if (!guild) return;
    for (const cid of CONFIG.adsChannels) {
        const channel = await guild.channels.fetch(cid).catch(() => null);
        if (!channel || !channel.isTextBased()) continue;
        let lastId;
        for (let i = 0; i < 12; i++) {
            const opts = { limit: 100 };
            if (lastId) opts.before = lastId;
            const messages = await channel.messages.fetch(opts).catch(() => null);
            if (!messages || messages.size === 0) break;
            for (const msg of messages.values()) {
                msg.mentions.users.forEach(u => {
                    const st = officerStore(u.id);
                    if (!st.joinedTimestamp || msg.createdTimestamp < st.joinedTimestamp) {
                        st.joinedTimestamp = msg.createdTimestamp;
                    }
                });
            }
            lastId = oldestId(messages);
            if (messages.size < 100 || !lastId) break;
        }
    }
    saveDb();
}

async function syncReports() {
    if (!guildRef) return;
    for (const cid of CONFIG.reportChannels) {
        const channel = await guildRef.channels.fetch(cid).catch(() => null);
        if (!channel || !channel.isTextBased()) continue;
        const channelName = channel.name || cid;
        let lastId, count = 0;
        while (count < CONFIG.reportsScanLimit) {
            const opts = { limit: 100 };
            if (lastId) opts.before = lastId;
            const messages = await channel.messages.fetch(opts).catch(() => null);
            if (!messages || messages.size === 0) break;

            for (const msg of messages.values()) {
                if (msg.author.bot) continue;
                const targetId = extractMention(fullMessage(msg), msg);
                if (!targetId) continue;
                const st = officerStore(targetId);
                if (!st.reports) st.reports = [];
                if (st.reports.some(r => r.msgId === msg.id)) continue;
                st.reports.push({
                    msgId: msg.id,
                    channelId: cid,
                    channelName,
                    title: channelName,
                    body: fullMessage(msg),
                    at: msg.createdTimestamp,
                    author: msg.author.id,
                    authorName: msg.member?.displayName || msg.author.username
                });
            }
            count += messages.size;
            lastId = oldestId(messages);
            if (messages.size < 100 || !lastId) break;
        }
    }
    for (const st of Object.values(db.officers)) {
        if (Array.isArray(st.reports)) {
            st.reports.sort((a, b) => (b.at || 0) - (a.at || 0));
            if (st.reports.length > 120) st.reports.length = 120;
        }
    }
    db.meta.reportsSweptAt = Date.now();
    saveDb();
}

async function syncHours() {
    if (!guildRef) return;
    for (const cid of CONFIG.hoursChannels) {
        const channel = await guildRef.channels.fetch(cid).catch(() => null);
        if (!channel || !channel.isTextBased()) continue;
        let lastId, count = 0;
        while (count < 500) {
            const opts = { limit: 100 };
            if (lastId) opts.before = lastId;
            const messages = await channel.messages.fetch(opts).catch(() => null);
            if (!messages || messages.size === 0) break;
            for (const msg of messages.values()) {
                const text = fullMessage(msg);
                const targetId = extractMention(text, msg);
                const hours = extractHours(text);
                if (!targetId || hours === null) continue;
                const st = officerStore(targetId);
                st.hoursAuto = Math.max(st.hoursAuto || 0, hours);
            }
            count += messages.size;
            lastId = oldestId(messages);
            if (messages.size < 100 || !lastId) break;
        }
    }
    saveDb();
}

/* ------------------------- بناء قائمة الأفراد ------------------------- */

function buildOfficerRecord(member, now) {
    const st = officerStore(member.id);
    const ident = parseIdentity(member.displayName || member.user.username);
    const rankInfo = memberRankInfo(member);
    const certs = memberCertifications(member);

    // أوقات ومن أعطى كل شهادة من سجل الديسكورد
    const certMeta = certs.map(c => {
        const ev = st.roleEvents.find(e => e.roleId === c.roleId && e.kind === 'add');
        return {
            roleId: c.roleId, name: c.name, ar: c.ar, icon: c.icon, color: c.color,
            grantedAt: ev ? ev.at : null,
            grantedBy: ev ? ev.by : null,
            grantedByName: ev ? cachedName(ev.by) : null
        };
    });

    // الرتبة الحالية + من أعطاها
    let rankSource = null;
    if (rankInfo && rankInfo.roleId) {
        const role = member.roles.cache.get(rankInfo.roleId);
        if (role) {
            const ev = st.roleEvents.find(e => e.roleId === role.id && e.kind === 'add');
            if (ev) rankSource = { at: ev.at, by: ev.by, byName: cachedName(ev.by), roleName: cleanRoleName(role.name) };
        }
    }

    const joinTs = st.joinedTimestamp || member.joinedTimestamp || null;
    const days = joinTs ? Math.max(0, Math.floor((now - joinTs) / 86400000)) : 0;

    const status = st.disabled ? 'suspended' : (st.onLeave ? 'leave' : 'active');
    const rankName = st.customRank || (rankInfo ? rankInfo.name : '—');

    // نحفظ قائمة الروم اللي عنده — منها نعرف لو يقدر يعدّل الموقع
    st.heldRoleIds = [...member.roles.cache.keys()].filter(id => id !== '0');

    return {
        id: member.id,
        name: member.displayName || member.user.username,
        username: member.user.username,
        tag: member.user.tag || member.user.username,
        avatar: member.user.displayAvatarURL({ extension: 'png', size: 128 }),
        callsign: ident.callsign || '',
        charName: ident.charName || '',
        oocName: ident.oocName || '',
        isLSPD: [...member.roles.cache.keys()].some(id => CONFIG.memberRoles.includes(id)),

        rank: rankName,
        rankRoleId: rankInfo?.roleId || null,
        rankLevel: rankInfo ? rankInfo.order : 9999,
        rankIsGuess: !!rankInfo?.guessed,
        rankRoleName: rankSource ? rankSource.roleName : (rankInfo ? rankInfo.name : null),
        rankGrantedAt: rankSource ? rankSource.at : null,
        rankGrantedBy: rankSource ? rankSource.byName : null,
        rankIsCustom: !!st.customRank,

        certifications: certMeta,
        certCount: certMeta.length,
        duties: memberDuties(member),
        dutyCount: memberDuties(member).length,

        hours: st.hours === null || st.hours === undefined ? +(st.hoursAuto || 0) : +st.hours,
        hoursManual: st.hours !== null && st.hours !== undefined,
        hoursAuto: +(st.hoursAuto || 0),
        points: st.points || 0,
        strikeCount: st.strikeCount || 0,
        lastStrikeAt: st.lastStrikeAt || null,
        lastPointsChange: (st.pointsLog || [])[0] || null,
        reportsCount: (st.reports || []).length,

        joinTs,
        joinDate: toIso(joinTs),
        daysInService: days,
        accountCreated: new Date(member.user.createdTimestamp).toISOString(),

        status,
        onLeave: !!st.onLeave,
        leaveUntil: st.leaveUntil,
        notes: st.notes || '',

        isCadet: isCadetMember(member),
        reports: st.reports || []
    };
}

/** نسخة خفيفة من بيانات الأفراد (بدون مصفوفة التقارير) — للبث عبر السوكيت */
function lightOfficers() {
    return officersCache.map(({ reports, ...rest }) => rest);
}

async function refreshRegistry(force = false) {
    if (isSyncing && !force) return;
    if (!client.isReady()) return;
    isSyncing = true;
    try {
        const guild = guildRef || await resolveGuild();
        if (!guild) { isSyncing = false; return; }
        guildRef = guild;

        // نحدّث قائمة الرتب من رومات الديسكورد قبل ما نرتب الأفراد
        syncRankConfig(guild);

        const members = await guild.members.fetch().catch(() => null);
        if (!members) { isSyncing = false; return; }

        const now = Date.now();
        const list = [];
        for (const member of members.values()) {
            if (member.user.bot) continue;
            rememberMember(member.id, member);
            if (!isMemberOfPolice(member)) continue;
            list.push(buildOfficerRecord(member, now));
        }
        list.sort((a, b) => (a.rankLevel - b.rankLevel) || a.name.localeCompare(b.name, 'ar'));

        officersCache = list;
        registryReady = true;
        io.emit('officers:update', { officers: lightOfficers(), meta: db.meta });
        saveDb();
    } catch (e) {
        console.error('خطأ تحديث السجل:', e.message);
    } finally {
        isSyncing = false;
    }
}

/* ============================================================================
 * 6) الحسابات والتوثيق
 * ==========================================================================*/

/** الروم اللي.filterّعطي صلاحية التعديل + الاستثناءات اليدوية */
function editorRoleIds() {
    const saved = (db.settings && Array.isArray(db.settings.editorRoles)) ? db.settings.editorRoles : [];
    return [...new Set([...CONFIG.editorRoleIds, ...saved.map(String)])].filter(Boolean);
}
/** هل هذا الحساب يعدّل؟ (المشرف دائماً + أي أحد عنده روم معدّل + استثناء يدوي) */
function canEditAccount(a) {
    if (!a) return false;
    if (CONFIG.adminIds.includes(a.copyId)) return true;
    if (a.canEdit === true) return true;                    // منح يدوي من الإدارة
    if (a.canEdit === false) return false;                  // منع يدوي
    const roles = editorRoleIds();
    if (!roles.length) return false;                        // ما في روم معدّل = ما أحد يعدّل
    const st = officerStore(a.copyId);
    const have = roles.filter(r => (st.heldRoleIds || []).includes(r));
    if (have.length) {
        st.editorViaRoles = have;                           // نخزّنها عشان نعرف ليش
        return true;
    }
    return false;
}

function publicAccount(a) {
    if (!a) return null;
    const canEdit = canEditAccount(a);
    return {
        id: a.id,
        username: a.username,
        charName: a.charName,
        email: a.email,
        copyId: a.copyId,
        avatar: a.avatar,
        status: a.status,
        verified: a.verified,
        verifyNote: a.verifyNote,
        isAdmin: CONFIG.adminIds.includes(a.copyId),
        canEdit,
        editVia: CONFIG.adminIds.includes(a.copyId) ? 'admin'
            : (a.canEdit === true ? 'granted' : (a.canEdit === false ? 'denied' : (st_roles(a) ? 'role' : null))),
        firstLoginAt: a.firstLoginAt,
        lastLoginAt: a.lastLoginAt,
        loginCount: a.loginCount || 0,
        createdAt: a.createdAt,
        lastIp: a.lastIp,
        lastDevice: a.lastDevice,
        blockReason: a.blockReason || null,
        resetCount: a.resetCount || 0
    };
}
/** اختصار: يحقّق إن الفرد عنده روم المعدّل (يرجّع مصفوفة أو null) */
function st_roles(a) {
    const st = officerStore(a.copyId);
    const roles = editorRoleIds();
    if (!roles.length) return null;
    const have = roles.filter(r => (st.heldRoleIds || []).includes(r));
    return have.length ? have : null;
}

function findAccountByToken(token) {
    if (!token) return null;
    for (const a of Object.values(db.accounts)) {
        if (a.token && a.token === token) return a;
    }
    return null;
}
function findAccountByCopyId(copyId) {
    return Object.values(db.accounts).find(a => a.copyId === copyId) || null;
}

function touchAccount(a, req) {
    a.lastLoginAt = Date.now();
    a.loginCount = (a.loginCount || 0) + 1;
    if (req) {
        a.lastIp = clientIp(req);
        a.lastDevice = prettyUa(req.headers['user-agent'] || '');
    }
    saveDb();
}

function requireAuth(req, res, next) {
    const token = req.get('x-auth-token') || (req.query && req.query.token) || (req.body && req.body.token);
    const a = findAccountByToken(token);
    if (!a) return res.status(401).json({ error: 'unauthorized', message: 'الجلسة غير صالحة — سجّل دخولك من جديد' });
    if (a.status === 'suspended') return res.status(403).json({ error: 'suspended', message: a.blockReason || 'حسابك موقوف من قِبل الإدارة' });
    if (a.status === 'pending') return res.status(403).json({ error: 'pending', message: 'طلبك بانتظار موافقة الإدارة' });
    req.account = a;
    a.lastPing = Date.now();
    next();
}
function requireAdmin(req, res, next) {
    if (!req.account || !CONFIG.adminIds.includes(req.account.copyId)) {
        return res.status(403).json({ error: 'forbidden', message: 'هذه العملية للمشرفين فقط' });
    }
    next();
}
function requireEdit(req, res, next) {
    if (!canEditAccount(req.account)) {
        return res.status(403).json({
            error: 'forbidden',
            message: 'ما عندك صلاحية التعديل — راجع المشرف (عندك حق تقرأ بس)'
        });
    }
    next();
}

/** يتحقق أن المستخدم فعلاً عضو في سيرفر شرطة الديسكورد (مو كذاب) */
async function verifyIdentity({ username, charName, copyId }) {
    if (!/^\d{17,19}$/.test(String(copyId || ''))) {
        return { ok: false, code: 'bad-id', message: 'كوبى آى دى غير صحيح — لازم 17 رقم' };
    }
    if (!client.isReady()) {
        return {
            ok: false, code: 'bot-offline',
            message: loginError
                ? `البوت ما قدر يتصل بالديسكورد: ${loginError}`
                : 'البوت ما قدر يتصل بالديسكورد بعد — تأكد إن التوكن صحيح وإن البوت شغّال'
        };
    }
    if (!guildRef) {
        return {
            ok: false, code: 'bot-no-guild',
            message: 'البوت متصل بالديسكورد بس مو داخل سيرفر الشرطة — ضيفه للسيرفر وحيّطه'
        };
    }

    let member;
    try {
        member = await guildRef.members.fetch(copyId);
        if (!member || typeof member !== 'object') member = null;
    } catch { member = null; }

    if (!member || !member.user) {
        return {
            ok: false, code: 'not-in-guild',
            message: 'هذا الآيدي غير موجود في سيرفر شرطة الديسكورد — ما تقدر تسجل'
        };
    }
    if (member.user.bot) {
        return { ok: false, code: 'is-bot', message: 'هذا الآيدي لحساب بوت وليس شخص' };
    }
    try {
        rememberMember(member.id, member);
    } catch { /* الكاش فقط — نتجاهله */ }

    let ident, candidates, isPolice, rank;
    try {
        ident = parseIdentity(member.displayName || member.user.username);
        candidates = [
            normKey(member.displayName),
            normKey(member.user.username),
            normKey(member.user.tag || ''),
            normKey(ident.callsign),
            normKey(ident.charName),
            normKey(ident.oocName)
        ].filter(Boolean);
        isPolice = isMemberOfPolice(member);
        rank = memberRank(member);
    } catch (e) {
        console.error('خطأ التحقق من الهوية:', e.message);
        return { ok: false, code: 'verify-error', message: 'تعذّر التحقق من بياناتك — جرّب بعد قليل' };
    }

    const wantUser = normKey(username);
    const wantChar = normKey(charName);
    const loose = (a, b) => a === b || (a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a)));
    const userMatch = !wantUser || candidates.some(c => loose(c, wantUser));
    const charMatch = !wantChar || candidates.some(c => loose(c, wantChar));

    if (!userMatch && !charMatch) {
        return {
            ok: false, code: 'name-mismatch',
            message: `اسمك ما يطابق الديسكورد. اسمك في السيرفر: «${member.displayName}»`
        };
    }
    if (CONFIG.requireMemberRole && !isPolice) {
        return { ok: false, code: 'not-police', message: 'ما عندك رتبة بالشرطة — راجع أحد المشرطين' };
    }

    return {
        ok: true,
        verified: true,
        isPolice,
        isCadet: isCadetMember(member),
        rank: rank?.ar || '',
        realName: member.displayName,
        avatar: member.user.displayAvatarURL({ extension: 'png', size: 128 }),
        message: isPolice ? 'تم التحقق — أنت من أفراد الشرطة' : 'تم التحقق — أنت بالسيرفر (بدون رتبة شرطة حالياً)'
    };
}

/* ============================================================================
 * 7) المسارات (API)
 * ==========================================================================*/

const rateLimit = new Map();
function rateOk(key, max = 8, windowMs = 10 * 60 * 1000) {
    const now = Date.now();
    const rec = rateLimit.get(key);
    if (!rec || now - rec.start > windowMs) { rateLimit.set(key, { start: now, count: 1 }); return true; }
    rec.count++;
    return rec.count <= max;
}

/* --- صلاحيات التعديل --- */

/** إعدادات الموقع — أي روم يعطي صلاحية التعديل */
app.get('/api/settings', requireAuth, (req, res) => {
    res.json({
        ok: true,
        editorRoleIds: editorRoleIds(),
        isAdmin: CONFIG.adminIds.includes(req.account.copyId),
        canEdit: canEditAccount(req.account)
    });
});

/** يختار المشرف الروم اللي تعطي صلاحية التعديل */
app.post('/api/settings/editor-roles', requireAuth, requireAdmin, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    const valid = new Set([...(guildRef?.roles.cache.keys() || [])].map(String));
    db.settings = db.settings || {};
    db.settings.editorRoles = ids.filter(id => valid.has(id) && id !== '0');
    saveDb();
    addLog('تغيير رومModifiers', {
        by: req.account.charName || req.account.username, byCopyId: req.account.copyId,
        target: `${db.settings.editorRoles.length} روم`,
        details: db.settings.editorRoles.map(id => guildRef?.roles.cache.get(id)?.name || id).join('، ')
    });
    broadcastPresence();
    res.json({ ok: true, editorRoleIds: db.settings.editorRoles });
});

/** يعطي/يسحب صلاحية التعديل لحساب واحد يدوياً */
app.post('/api/accounts/:id/can-edit', requireAuth, requireAdmin, (req, res) => {
    const a = db.accounts[req.params.id];
    if (!a) return res.status(404).json({ error: 'not-found' });
    const v = req.body?.canEdit;
    if (v === true) a.canEdit = true;
    else if (v === false) a.canEdit = false;
    else a.canEdit = null;                 // يعودDecision للروم
    saveDb();
    addLog('تعديل صلاحية', { by: req.account.charName || req.account.username, byCopyId: req.account.copyId, target: `${a.charName} (${a.copyId})`, details: a.canEdit === null ? 'حسب الروم' : (a.canEdit ? 'ممنوح' : 'ممنوع') });
    io.emit('accounts:update', accountsPublicList());
    res.json({ ok: true, account: publicAccount(a) });
});

/* --- إدارة الأدوار (رتب + شهادات + مسؤوليات) --- */

/** كل الرومات المكتشفة مجمّعة بالنوع، مع ترتيب المشرف وحالة التفعيل */
app.get('/api/roles', requireAuth, (req, res) => {
    const detected = detectAllRoles(guildRef);
    const saved = new Map((db.roleConfig || []).map(r => [r.id, r]));
    const all = new Map(detected.map(d => [d.id, d]));
    for (const s of (db.roleConfig || [])) {
        if (!all.has(s.id)) all.set(s.id, { id: s.id, name: s.name, type: s.type, position: null, members: 0 });
    }

    const list = [...all.values()].map(r => ({
        id: r.id,
        type: r.type,
        name: saved.get(r.id)?.name || r.name,
        rawName: r.rawName || r.name,
        position: r.position ?? null,
        members: r.members ?? 0,
        order: saved.get(r.id)?.order ?? null,
        enabled: saved.get(r.id)?.enabled !== false,
        missing: !detected.some(d => d.id === r.id)
    })).sort((a, b) => {
        if (a.enabled !== b.enabled) return b.enabled - a.enabled;
        if (a.type !== b.type) return typeRank(a.type) - typeRank(b.type);
        const ao = a.order ?? 5000, bo = b.order ?? 5000;
        if (ao !== bo) return ao - bo;
        return (b.position ?? 0) - (a.position ?? 0);
    });

    res.json({ ok: true, roles: list, canEdit: CONFIG.adminIds.includes(req.account.copyId) });
});

/** الرومات اللي ما انكشفت تلقائياً (فاضية) — يقدر المشرف يضيفها يدوي */
app.get('/api/roles/undetected', requireAuth, requireAdmin, (req, res) => {
    const known = new Set((db.roleConfig || []).map(r => r.id));
    const out = [];
    for (const role of (guildRef?.roles.cache.values() || [])) {
        if (role.managed || role.name === '@everyone') continue;
        if (role.id === guildRef.id) continue;
        if (known.has(role.id)) continue;
        if (CONFIG.certifications[role.id] || CONFIG.memberRoles.includes(role.id) || CONFIG.cadetRoles.includes(role.id)) continue;
        if (rankDefForRoleName(role.name)) continue;         // رتبة — ظاهرة أصلاً
        out.push({ id: role.id, name: cleanRoleName(role.name) || role.name, rawName: role.name, position: role.position ?? 0, members: role.members?.size ?? 0 });
    }
    out.sort((a, b) => (b.members - a.members) || (b.position - a.position));
    res.json({ ok: true, roles: out });
});

/** يضيف رومات responsibility يدوياً */
app.post('/api/roles/add-duty', requireAuth, requireAdmin, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) return res.status(400).json({ error: 'bad-request' });
    const guild = guildRef;
    if (!guild) return res.status(503).json({ error: 'bot-offline' });

    const current = new Map((db.roleConfig || []).map(r => [r.id, r]));
    let maxOrder = Math.max(0, ...dutyConfigList().map(r => r.order || 0));
    let added = 0;
    for (const id of ids) {
        const role = guild.roles.cache.get(id);
        if (!role || current.has(id)) continue;
        maxOrder++;
        current.set(id, {
            id, type: 'duty', name: cleanRoleName(role.name) || role.name,
            order: maxOrder, enabled: true, position: role.position ?? 0
        });
        added++;
    }
    db.roleConfig = [...current.values()].sort((a, b) => (b.enabled - a.enabled) || (a.type === b.type ? (a.order - b.order) : typeRank(a.type) - typeRank(b.type)));
    db.rankConfig = db.roleConfig.filter(r => r.type === 'rank').map(({ id, name, order, enabled }) => ({ id, name, order, enabled }));
    saveDb();
    if (added) {
        addLog('إضافة مسؤوليات', { by: req.account.charName || req.account.username, byCopyId: req.account.copyId, target: `${added} دور`, details: ids.join(', ') });
        refreshRegistry(true);
    }
    res.json({ ok: true, added });
});

/* المسار القديم — للتوافق */
app.get('/api/ranks', requireAuth, (req, res) => {
    const list = roleConfigList('rank');
    res.json({ ok: true, ranks: list.map(r => ({ ...r, position: null })), canEdit: CONFIG.adminIds.includes(req.account.copyId) });
});

/** يحفظ ترتيب الأدوار وأسماؤها وتفعيلها */
app.post('/api/roles', requireAuth, requireAdmin, (req, res) => {
    const list = Array.isArray(req.body?.roles) ? req.body.roles : null;
    if (!list) return res.status(400).json({ error: 'bad-request' });

    const detected = new Map(detectAllRoles(guildRef).map(r => [r.id, r]));
    const current = new Map((db.roleConfig || []).map(r => [r.id, r]));
    const next = [];
    const counters = { rank: 0, cert: 0, duty: 0 };

    for (const r of list) {
        const id = String(r.id || '');
        if (!id) continue;
        const d = detected.get(id);
        const prev = current.get(id);
        if (!d && !prev) continue;                     // روم غير موجود بالديسكورد ولا محفوظ
        const type = d ? d.type : (prev.type || 'duty');
        counters[type]++;
        const name = String(r.name || '').trim().slice(0, 80) || prev?.name || d?.name || id;
        next.push({ id, type, name, order: counters[type], enabled: r.enabled !== false });
    }

    db.roleConfig = next;
    db.rankConfig = next.filter(r => r.type === 'rank').map(({ id, name, order, enabled }) => ({ id, name, order, enabled }));
    saveDb();
    addLog('تعديل الأدوار', { by: req.account.charName || req.account.username, byCopyId: req.account.copyId, target: `${next.length} دور`, details: next.filter(r=>r.type==='rank').map(r => r.name).join(' ← ') });
    refreshRegistry(true);
    io.emit('roles:update', { roles: next });
    res.json({ ok: true, roles: next });
});

/* المسار القديم */
app.post('/api/ranks', requireAuth, requireAdmin, (req, res) => {
    const list = Array.isArray(req.body?.ranks) ? req.body.ranks : [];
    const combined = roleConfigList().map(r => ({ ...r }));
    const byId = new Map(combined.map(r => [r.id, r]));
    list.forEach(r => { if (byId.has(r.id)) byId.get(r.id).name = String(r.name || '').slice(0, 80); });
    const ordered = list.map((r, i) => {
        const base = byId.get(r.id) || { id: r.id, type: 'rank', enabled: r.enabled !== false };
        return { ...base, order: i + 1, enabled: r.enabled !== false };
    });
    for (const r of combined) if (!list.find(x => x.id === r.id)) ordered.push(r);

    db.roleConfig = ordered;
    db.rankConfig = ordered.filter(r => r.type === 'rank').map(({ id, name, order, enabled }) => ({ id, name, order, enabled }));
    saveDb();
    refreshRegistry(true);
    res.json({ ok: true, roles: ordered });
});

/** يعطي/يشيل روم مسؤوليات لفرد */
app.post('/api/officers/:id/roles', requireAuth, requireAdmin, async (req, res) => {
    const id = req.params.id;
    const { add = [], remove = [], reason = '' } = req.body || {};
    if (!client.isReady() || !guildRef) return res.status(503).json({ error: 'bot-offline', message: 'البوت مو متصل' });

    let member;
    try { member = await guildRef.members.fetch(id); }
    catch { return res.status(404).json({ error: 'not-found', message: 'ما قدرت أجيب العضو' }); }

    const duties = new Map(dutyConfigList().map(d => [d.id, d]));
    const toAdd = [...new Set(add)].filter(r => duties.has(r));
    const toRemove = [...new Set(remove)].filter(r => duties.has(r) && member.roles.cache.has(r));
    if (!toAdd.length && !toRemove.length) return res.status(400).json({ error: 'nothing', message: 'ما فيه تغيير' });

    const why = `تعديل مسؤوليات من نظام إدارة الشرطة${reason ? ' — ' + reason : ''}`;
    try {
        if (toRemove.length) await member.roles.remove(toRemove, why);
        for (const r of toAdd) if (!member.roles.cache.has(r)) await member.roles.add(r, why);
    } catch (e) {
        return res.status(400).json({ error: 'discord-fail', message: explainRoleError(e) });
    }

    const names = [...toAdd, ...toRemove].map(r => duties.get(r).name);
    addHistory(id, { type: 'edit', icon: 'fa-user-shield', title: 'تعديل المسؤوليات', detail: names.join(' • '), by: req.account.charName || req.account.username });
    addLog('تعديل مسؤوليات', { by: req.account.charName || req.account.username, byCopyId: req.account.copyId, target: `${member.displayName} (${id})`, details: names.join(' • ') });
    await refreshRegistry(true);
    io.emit('officers:update', { officers: lightOfficers(), meta: db.meta });
    res.json({ ok: true, added: toAdd.length, removed: toRemove.length });
});

/** يغيّر رتبة فرد — ويعدّلها فعلياً في الديسكورد */
app.post('/api/officers/:id/rank', requireAuth, requireAdmin, async (req, res) => {
    const id = req.params.id;
    const rankRoleId = req.body?.rankRoleId ? String(req.body.rankRoleId) : null;
    const reason = String(req.body?.reason || '').trim();

    if (!client.isReady() || !guildRef) {
        return res.status(503).json({ error: 'bot-offline', message: 'البوت مو متصل بالديسكورد' });
    }

    let member;
    try { member = await guildRef.members.fetch(id); }
    catch { return res.status(404).json({ error: 'not-found', message: 'ما قدرت أجيب العضو من الديسكورد' }); }

    const oldRank = memberRankInfo(member);
    const allRankRoles = rankConfigList().map(r => r.id);

    if (rankRoleId && !allRankRoles.includes(rankRoleId)) {
        return res.status(400).json({ error: 'bad-rank', message: 'الرتبة المختارة مو رتبة معروفة' });
    }

    const why = `تغيير رتبة من نظام إدارة الشرطة${reason ? ' — ' + reason : ''}`;

    try {
        const remove = allRankRoles.filter(rid => rid !== rankRoleId && member.roles.cache.has(rid));
        if (remove.length) await member.roles.remove(remove, why);
        if (rankRoleId && !member.roles.cache.has(rankRoleId)) await member.roles.add(rankRoleId, why);
    } catch (e) {
        return res.status(400).json({ error: 'discord-fail', message: explainRoleError(e) });
    }

    // تأكيد إن ديسكورد قبل التغيير فعلياً — بدون هذا يطلع النجاح وهي ما تغيّرت
    try {
        await sleep(900);
        const check = await guildRef.members.fetch(id, { force: true });
        const hasNew = !rankRoleId || check.roles.cache.has(rankRoleId);
        const stillOld = remove.filter(rid => check.roles.cache.has(rid));
        if (!hasNew || stillOld.length) {
            return res.status(400).json({
                error: 'not-applied',
                message: 'ديسكورد ما قبل التغيير (راجعت بالنت مباشرة). غالباً رتبة البوت بالسيرفر أقل من الرتبة الجديدة — ارفع رتبة البوت فوق كل الرتب.'
            });
        }
    } catch (e) {
        console.warn('تعذّر التأكد من التغيير:', e.message);
    }

    const newCfg = rankConfigList().find(r => r.id === rankRoleId);
    const newName = newCfg ? newCfg.name : '—';
    const st = officerStore(id);
    st.customRank = null;   // الرتبة صارت من الديسكورد
    addHistory(id, {
        type: 'promote', icon: 'fa-user-shield',
        title: `تغيير رتبة من الموقع: ${oldRank ? oldRank.name : '—'} ← ${newName}`,
        detail: reason || 'بدون سبب محدد',
        by: req.account.charName || req.account.username
    });
    addLog('تغيير رتبة', { by: req.account.charName || req.account.username, byCopyId: req.account.copyId, target: `${member.displayName} (${id})`, details: `${oldRank ? oldRank.name : '—'} ← ${newName}${reason ? ' • ' + reason : ''}` });

    await refreshRegistry(true);
    io.emit('officers:update', { officers: lightOfficers(), meta: db.meta });
    res.json({ ok: true, from: oldRank ? oldRank.name : null, to: newName });
});

/* --- التسجيل (مرة واحدة) --- */
app.post('/api/auth/register', async (req, res) => {
    const ip = clientIp(req);
    if (!rateOk('reg:' + ip, 8)) {
        return res.status(429).json({ error: 'rate', message: 'محاولات كثيرة — انتظر 10 دقائق' });
    }

    const { username, charName, email, copyId } = req.body || {};
    const uname = String(username || '').trim();
    const cname = String(charName || '').trim();
    const mail = String(email || '').trim().toLowerCase();
    const cid = String(copyId || '').trim();

    if (!uname) return res.status(400).json({ error: 'fields', message: 'اكتب اسمك في ديسكورد' });
    if (!cname) return res.status(400).json({ error: 'fields', message: 'اكتب اسم شخصيتك' });
    if (!/^\S+@\S+\.\S+$/.test(mail)) return res.status(400).json({ error: 'fields', message: 'الإيميل غير صحيح' });
    if (!/^\d{17,19}$/.test(cid)) return res.status(400).json({ error: 'fields', message: 'كوبى آى دى غير صحيح' });

    const v = await verifyIdentity({ username: uname, charName: cname, copyId: cid });
    addLog('محاولة تسجيل', { by: uname, byCopyId: cid, target: cname, details: v.ok ? 'تم التحقق' : v.message });
    if (!v.ok) {
        return res.status(400).json({ error: v.code, message: v.message });
    }

    const isAdmin = CONFIG.adminIds.includes(cid);
    let account = findAccountByCopyId(cid);

    if (account && account.status === 'suspended') {
        return res.status(403).json({ error: 'suspended', message: account.blockReason || 'حسابك موقوف — كلّم الإدارة' });
    }

    if (!account) {
        account = {
            id: newId('u_'),
            username: uname, charName: cname, email: mail, copyId: cid,
            token: newToken(),
            status: isAdmin ? 'approved' : 'pending',
            verified: true, verifyNote: v.message,
            isPolice: v.isPolice, rank: v.rank,
            avatar: v.avatar || cachedAvatar(cid) || null,
            canEdit: CONFIG.defaultCanEdit,
            firstLoginAt: Date.now(), lastLoginAt: null, loginCount: 0,
            createdAt: Date.now(), lastIp: ip,
            lastDevice: prettyUa(req.headers['user-agent'] || ''),
            blockReason: null, resetCount: 0
        };
        db.accounts[account.id] = account;
        addLog('تسجيل حساب جديد', { by: uname, byCopyId: cid, target: cname, details: account.status === 'approved' ? 'مشرف' : 'بانتظار الموافقة' });
    } else {
        // إعادة تسجيل (بعد ما الإدارة تمسح تسجيله)
        Object.assign(account, {
            username: uname, charName: cname, email: mail,
            token: newToken(),
            status: isAdmin ? 'approved' : 'pending',
            verified: true, verifyNote: v.message,
            isPolice: v.isPolice, rank: v.rank,
            avatar: v.avatar || account.avatar,
            firstLoginAt: account.firstLoginAt || Date.now(),
            resetCount: (account.resetCount || 0) + 1,
            blockReason: null
        });
        addLog('إعادة تسجيل', { by: uname, byCopyId: cid, target: cname, details: 'حساب موجود' });
    }

    saveDb();
    io.emit('accounts:update', accountsPublicList());
    res.json({
        ok: true,
        status: account.status,
        token: account.status === 'approved' ? account.token : null,
        account: publicAccount(account)
    });
});

/* --- الدخول بالأكواد فقط (بعد أول تسجيل) --- */
app.post('/api/auth/login', (req, res) => {
    const { copyId, token } = req.body || {};
    let account = token ? findAccountByToken(token) : null;
    if (!account && copyId) account = findAccountByCopyId(String(copyId).trim());

    if (!account) {
        return res.status(404).json({ error: 'not-registered', message: 'ما في حساب مسجّل بهذا الآيدي — سجّل من جديد' });
    }
    if (account.status === 'suspended') {
        return res.status(403).json({ error: 'suspended', message: account.blockReason || 'حسابك موقوف من الإدارة' });
    }
    if (account.status === 'pending') {
        return res.status(403).json({ error: 'pending', message: 'طلبك بانتظار موافقة الإدارة على الدخول' });
    }
    if (!account.verified) {
        return res.status(403).json({ error: 'unverified', message: 'حسابك غير موثّق — سجّل من جديد ليتحقق البوت' });
    }

    touchAccount(account, req);
    addLog('دخول للموقع', { by: account.username, byCopyId: account.copyId, target: account.charName, details: `${account.lastIp} • ${account.lastDevice}` });
    markOnline(account, req);
    io.emit('accounts:update', accountsPublicList());
    broadcastPresence();

    res.json({ ok: true, token: account.token, account: publicAccount(account) });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
    touchAccount(req.account, req);
    markOnline(req.account, req);
    broadcastPresence();
    res.json({ ok: true, account: publicAccount(req.account) });
});

app.post('/api/auth/logout', (req, res) => {
    const token = req.get('x-auth-token') || req.body?.token;
    const a = findAccountByToken(token);
    if (a) {
        addLog('خروج من الموقع', { by: a.username, byCopyId: a.copyId, target: a.charName });
        markOffline(a.id);
    }
    broadcastPresence();
    res.json({ ok: true });
});

/* --- بيانات الأفراد --- */
app.get('/api/officers', requireAuth, (req, res) => {
    if (!registryReady) refreshRegistry(true);
    const list = officersCache.map(o => {
        const p = presence.get(o.id);
        const a = Object.values(db.accounts).find(x => x.copyId === o.id);
        return {
            ...o,
            reports: undefined,
            onSite: !!p?.online,
            accountName: a ? a.charName : null,
            accountStatus: a ? a.status : null
        };
    });
    res.json({
        ok: true,
        officers: list,
        meta: db.meta,
        botTag: client.user?.tag || null,
        botOnline: client.isReady() && !!guildRef,
        guildName: guildRef?.name || null
    });
});

app.get('/api/officers/:id', requireAuth, (req, res) => {
    const id = req.params.id;
    const off = officersCache.find(o => o.id === id);
    if (!off) return res.status(404).json({ error: 'not-found', message: 'الفرد غير موجود في الجدول' });

    const st = officerStore(id);
    const account = findAccountByCopyId(id);

    // سجل الخدمة: مدموج من كل المصادر
    const timeline = [];

    if (off.joinTs) {
        timeline.push({ at: off.joinTs, type: 'join', icon: 'fa-door-open', title: 'انضمام للديسكورد', detail: off.isLSPD ? 'دخل كفرد شرطة' : 'دخل السيرفر', by: null });
    }

    for (const ev of st.roleEvents) {
        const isRank = CONFIG.ranks.some(r => r.kw.some(k => normKey(ev.roleName) === normKey(k)));
        const isCert = !!CONFIG.certifications[ev.roleId];
        if (!isRank && !isCert) continue;
        const cert = CONFIG.certifications[ev.roleId];
        timeline.push({
            at: ev.at,
            type: ev.kind === 'add' ? (isCert ? 'cert' : 'promote') : 'remove',
            icon: isCert ? 'fa-award' : (ev.kind === 'add' ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'),
            title: isCert
                ? (ev.kind === 'add' ? `حصل على ${cert.ar}` : `سُحب منه ${cert.ar}`)
                : (ev.kind === 'add' ? `ترقية إلى ${ev.roleName}` : `سُحب منه ${ev.roleName}`),
            detail: ev.by ? `بواسطة ${cachedName(ev.by)}` : 'بدون تسجيل',
            by: ev.by, byName: ev.by ? cachedName(ev.by) : null
        });
    }

    for (const h of st.history) {
        timeline.push({ at: h.at, type: h.type || 'edit', icon: h.icon || 'fa-pen', title: h.title, detail: h.detail, by: h.by || null, byName: h.by || null });
    }

    for (const r of (st.reports || []).slice(0, 30)) {
        timeline.push({ at: r.at, type: 'report', icon: 'fa-file-lines', title: `تقرير ${r.channelName || 'MDT'}`, detail: (r.body || '').slice(0, 140), by: r.author, byName: r.authorName });
    }

    timeline.sort((a, b) => (b.at || 0) - (a.at || 0));

    res.json({
        ok: true,
        officer: { ...off, reports: st.reports || [] },
        timeline: timeline.slice(0, 120),
        pointsLog: (st.pointsLog || []).slice(0, 60),
        promotions: (st.promotions || []).slice(0, 40),
        strikeCount: st.strikeCount || 0,
        lastStrikeAt: st.lastStrikeAt || null,
        account: account ? publicAccount(account) : null
    });
});

app.post('/api/officers/:id', requireAuth, requireEdit, async (req, res) => {
    const id = req.params.id;
    if (!officersCache.find(o => o.id === id)) {
        return res.status(404).json({ error: 'not-found', message: 'الفرد غير موجود' });
    }
    const st = officerStore(id);
    const b = req.body || {};
    const who = req.account.charName || req.account.username;
    const changes = [];

    if (b.points !== undefined && b.points !== null && b.points !== '') {
        const p = Math.max(0, Math.round(+b.points || 0));
        if (p !== st.points) { changes.push(`النقاط ${st.points} ← ${p}`); st.points = p; }
    }
    if (b.hours !== undefined && b.hours !== null && b.hours !== '') {
        const h = +b.hours;
        if (Number.isFinite(h)) {
            if (h !== st.hours) { changes.push(`الساعات ${st.hours ?? 'تلقائي'} ← ${h}`); st.hours = h; }
        }
    }
    if (b.hoursReset) { changes.push('رجوع الساعات للتلقائي'); st.hours = null; }
    if (b.onLeave !== undefined) {
        const v = !!b.onLeave;
        if (v !== st.onLeave) { changes.push(v ? 'أُخذت إجازة' : 'رجع من الإجازة'); st.onLeave = v; }
    }
    if (b.leaveUntil !== undefined) {
        const v = b.leaveUntil || null;
        if (v !== st.leaveUntil) { changes.push(`نهاية الإجازة ${st.leaveUntil ? fmtDT(Date.parse(st.leaveUntil)) : '—'} ← ${v ? fmtDT(Date.parse(v)) : '—'}`); }
        st.leaveUntil = v;
    }
    if (b.disabled !== undefined) {
        const v = !!b.disabled;
        if (v !== st.disabled) { changes.push(v ? 'إيقاف' : 'رفع الإيقاف'); st.disabled = v; }
    }
    if (b.customRank !== undefined) { changes.push('تغيير الرتبة المعروضة'); st.customRank = b.customRank || null; }
    if (b.notes !== undefined && b.notes !== st.notes) { changes.push('تحديث الملاحظات'); st.notes = String(b.notes || '').slice(0, 1200); }
    if (b.addPoints !== undefined && b.addPoints !== null && b.addPoints !== '') {
        const d = Math.round(+b.addPoints || 0);
        if (d) { st.points = Math.max(0, st.points + d); changes.push(`${d > 0 ? '+' : ''}${d} نقطة (${st.points} الإجمالي)`); }
    }

    let type = 'edit', icon = 'fa-pen', title = 'تعديل بيانات';
    if (changes.length === 1 && /إجازة|الإجازة/.test(changes[0])) { type = 'leave'; icon = 'fa-plane'; title = 'تغيّر حالة الإجازة'; }
    else if (changes.some(c => /إيقاف/.test(c))) { type = 'status'; icon = 'fa-ban'; title = 'تغيّر حالة الفرد'; }
    else if (changes.some(c => /نقطة/.test(c))) { type = 'points'; icon = 'fa-star'; title = 'تعديل النقاط'; }
    else if (changes.some(c => /ساعات/.test(c))) { type = 'hours'; icon = 'fa-clock'; title = 'تعديل الساعات'; }
    else if (changes.some(c => /الرتبة/.test(c))) { type = 'rank'; icon = 'fa-arrow-trend-up'; title = 'تعديل الرتبة'; }

    if (changes.length) {
        st.updatedAt = Date.now();
        st.updatedBy = who;
        addHistory(id, { type, icon, title, detail: changes.join(' • '), by: who });
        addLog(title, { by: who, byCopyId: req.account.copyId, target: id, details: changes.join(' • ') });
        await refreshRegistry(true);
        io.emit('officers:update', { officers: lightOfficers(), meta: db.meta });
    }
    res.json({ ok: true, changed: changes.length });
});

/** يعيد حساب النقاط من السجل — يلصّح الأرقام اللي تكررت بسبب إعادة التشغيل */
app.post('/api/officers/:id/recalc', requireAuth, requireAdmin, (req, res) => {
    const id = req.params.id;
    const st = officerStore(id);
    const log = st.pointsLog || [];

    // 1) نشيل التكرار (نفس الرسالة) ونرتّب من الأقدم
    const seen = new Set();
    const uniq = log.filter(e => {
        const k = e.msgId || `x${e.at}|${e.delta}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    }).sort((a, b) => a.at - b.at);

    // 2) نعيد الحساب من الصفر
    let bal = 0;
    for (const e of uniq) {
        const d = Number(e.requested ?? e.delta) || 0;
        bal = Math.max(0, bal + d);
        e.delta = d;
        e.balanceAfter = bal;
    }
    st.pointsLog = uniq.slice().reverse();
    st.points = bal;
    st.strikeCount = uniq.filter(e => e.type === 'strike').length;
    st.lastStrikeAt = uniq.filter(e => e.type === 'strike').at(-1)?.at ?? st.lastStrikeAt ?? null;

    addLog('إعادة حساب النقاط', { by: req.account.charName || req.account.username, byCopyId: req.account.copyId, target: id, details: `${log.length} ← ${uniq.length} حركة، الرصيد ${bal}` });
    saveDb();
    refreshRegistry(true);
    io.emit('officers:update', { officers: lightOfficers(), meta: db.meta });
    res.json({ ok: true, points: bal, removed: log.length - uniq.length, strikes: st.strikeCount });
});

/* --- الحسابات والإدارة --- */
function accountsPublicList() {
    return Object.values(db.accounts)
        .sort((a, b) => (b.lastLoginAt || b.createdAt || 0) - (a.lastLoginAt || a.createdAt || 0))
        .map(a => ({ ...publicAccount(a), online: !!presence.get(a.id)?.online, lastSeenAt: presence.get(a.id)?.lastSeen || a.lastPing || a.lastLoginAt || null, page: presence.get(a.id)?.page || null }));
}

app.get('/api/accounts', requireAuth, (req, res) => res.json({ ok: true, accounts: accountsPublicList() }));

app.post('/api/accounts/:id/status', requireAuth, requireAdmin, (req, res) => {
    const a = db.accounts[req.params.id];
    if (!a) return res.status(404).json({ error: 'not-found' });
    const { status, reason, canEdit } = req.body || {};
    if (canEdit !== undefined) a.canEdit = !!canEdit;
    if (status) {
        if (!['approved', 'pending', 'suspended'].includes(status)) {
            return res.status(400).json({ error: 'bad-status' });
        }
        a.status = status;
        a.blockReason = status === 'suspended' ? (reason || 'موقوف من الإدارة') : null;
        if (status === 'approved') a.verified = true;
        addLog(status === 'approved' ? 'موافقة على حساب' : (status === 'suspended' ? 'إيقاف حساب' : 'إرجاع للانتظار'), {
            by: req.account.charName || req.account.username, byCopyId: req.account.copyId, target: `${a.charName} (${a.copyId})`, details: a.blockReason
        });
        if (status !== 'approved') markOffline(a.id);
    }
    saveDb();
    io.emit('accounts:update', accountsPublicList());
    broadcastPresence();
    res.json({ ok: true, account: publicAccount(a) });
});

/** يمسح تسجيل المستخدم خلنه يسجّل دخول مرة ثانية ويعيد تعبئة بياناته */
app.post('/api/accounts/:id/reset', requireAuth, requireAdmin, (req, res) => {
    const a = db.accounts[req.params.id];
    if (!a) return res.status(404).json({ error: 'not-found' });
    a.token = newToken();
    a.status = 'pending';
    a.verified = false;
    a.blockReason = null;
    a.email = a.email || '';
    a.resetCount = (a.resetCount || 0) + 1;
    a.firstLoginAt = null;
    markOffline(a.id);
    addLog('مسح تسجيل حساب', { by: req.account.charName || req.account.username, byCopyId: req.account.copyId, target: `${a.charName} (${a.copyId})` });
    saveDb();
    io.emit('accounts:update', accountsPublicList());
    broadcastPresence();
    res.json({ ok: true, account: publicAccount(a) });
});

app.delete('/api/accounts/:id', requireAuth, requireAdmin, (req, res) => {
    const a = db.accounts[req.params.id];
    if (!a) return res.status(404).json({ error: 'not-found' });
    delete db.accounts[req.params.id];
    markOffline(a.id);
    addLog('حذف حساب', { by: req.account.charName || req.account.username, byCopyId: req.account.copyId, target: `${a.charName} (${a.copyId})` });
    saveDb();
    io.emit('accounts:update', accountsPublicList());
    broadcastPresence();
    res.json({ ok: true });
});

/* --- الحضور --- */
app.get('/api/presence', requireAuth, (req, res) => res.json({ ok: true, presence: presencePublic() }));

/* --- السجل --- */
app.get('/api/logs', requireAuth, (req, res) => res.json({ ok: true, logs: db.logs.slice(0, 250) }));

app.post('/api/refresh', requireAuth, requireAdmin, async (req, res) => {
    await refreshRegistry(true);
    res.json({ ok: true, count: officersCache.length });
});

app.get('/api/health', (req, res) => {
    const d = botDiagnostics();
    res.json({
        ok: d.botReady && !!d.activeGuildId,
        ...d,
        officers: officersCache.length,
        accounts: Object.keys(db.accounts).length,
        online: [...presence.values()].filter(p => p.online).length,
        registryReady
    });
});

/* ============================================================================
 * 8) الحضور اللحظي (Socket.IO)
 * ==========================================================================*/

const presence = new Map(); // accountId -> {...}

function presencePublic() {
    return [...presence.entries()].map(([id, p]) => {
        const a = db.accounts[id];
        return {
            accountId: id,
            copyId: a?.copyId || null,
            username: a?.username || '—',
            charName: a?.charName || '—',
            email: a?.email || null,
            avatar: a?.avatar || null,
            isAdmin: a ? CONFIG.adminIds.includes(a.copyId) : false,
            status: a?.status || 'pending',
            online: !!p.online,
            since: p.since || null,
            lastSeen: p.lastSeen || null,
            ip: p.ip || null,
            device: p.device || null,
            page: p.page || null,
            loginCount: a?.loginCount || 0,
            firstLoginAt: a?.firstLoginAt || null
        };
    }).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}

function markOnline(account, req) {
    const p = presence.get(account.id) || {};
    if (!p.online) p.since = Date.now();
    p.online = true;
    p.lastSeen = Date.now();
    p.ip = req ? clientIp(req) : p.ip;
    p.device = req ? prettyUa(req.headers['user-agent'] || '') : p.device;
    presence.set(account.id, p);
}
function markOffline(accountId) {
    const p = presence.get(accountId);
    if (!p) return;
    p.online = false;
    p.lastSeen = Date.now();
}
function broadcastPresence() {
    io.emit('presence:update', presencePublic());
}

setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const p of presence.values()) {
        if (p.online && now - (p.lastSeen || 0) > CONFIG.presenceTimeout) {
            p.online = false; p.lastSeen = now; changed = true;
        }
    }
    if (changed) broadcastPresence();
}, 20000);

io.on('connection', (socket) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    // أرسل الحالة الحالية فوراً عشان الجداول ما تبقى فاضية
    socket.emit('presence:update', presencePublic());
    if (registryReady) socket.emit('officers:update', { officers: lightOfficers(), meta: db.meta });
    socket.emit('accounts:update', accountsPublicList());

    if (!token) return;

    socket.on('auth', ({ token: tk } = {}) => {
        const a = findAccountByToken(tk || token);
        if (!a || a.status !== 'approved') return;
        markOnline(a);
        socket.data.accountId = a.id;
        socket.join('site');
        socket.emit('presence:ok', { account: publicAccount(a), presence: presencePublic() });
        broadcastPresence();
    });

    socket.on('page', (page) => {
        const p = presence.get(socket.data.accountId);
        if (p) { p.page = String(page || '').slice(0, 60); p.lastSeen = Date.now(); broadcastPresence(); }
    });

    socket.on('ping:site', () => {
        const p = presence.get(socket.data.accountId);
        if (p) p.lastSeen = Date.now();
        socket.emit('pong:site', presencePublic());
    });

    socket.on('disconnect', () => {
        if (socket.data.accountId) {
            markOffline(socket.data.accountId);
            broadcastPresence();
        }
    });
});

/* ============================================================================
 * 9) أحداث البوت الحيّة
 * ==========================================================================*/

client.on('ready', async () => {
    loginError = null;
    console.log(`[تم الاتصال] البوت جاهز: ${client.user.tag}`);
    console.log(`[البوت داخل ${client.guilds.cache.size} سيرفر:]`);
    for (const g of client.guilds.cache.values()) {
        console.log(`   • "${g.name}"  —  ${g.id}  (${g.memberCount} عضو)`);
    }

    guildRef = await resolveGuild();
    if (!guildRef) {
        console.error('[خطأ] البوت مو داخل أي سيرفر! ضيفه لسيرفر الشرطة وحيّطه.');
    } else {
        console.log(`[السيرفر المستخدم] ${guildRef.name} — ${guildRef.id} (${guildRef.memberCount} عضو)`);
    }

    // الرتب تنقرأ من الرومات أول ما يشتغل
    const ranks = syncRankConfig(guildRef);
    console.log(`[الرتب] ${ranks.length} رتبة مكتشفة: ${ranks.map(r => r.name).join(' ← ')}`);

    refreshRegistry(true).then(async () => {
        // عمليات طويلة في الخلفية — الموقع يبقى شغّال طول هالفترة
        try { await syncJoinDates(guildRef); } catch (e) { console.warn('join-dates:', e.message); }
        try { await syncHours(); } catch (e) { console.warn('hours:', e.message); }
        try { await syncReports(); } catch (e) { console.warn('reports:', e.message); }
        try { await syncSanctions(); } catch (e) { console.warn('sanctions:', e.message); }
        try { await sweepAuditLogs(guildRef); } catch (e) { console.warn('audit:', e.message); }
        await refreshRegistry(true);
        io.emit('accounts:update', accountsPublicList());
        console.log('[جاهز] كل المزامنة انتهت ✓');
    });
});

client.on('guildMemberAdd', async (member) => {
    if (!guildRef || member.guild.id !== guildRef.id) return;
    rememberMember(member.id, member);
    const st = officerStore(member.id);
    if (!st.joinedTimestamp) st.joinedTimestamp = member.joinedTimestamp;
    addLog('عضو جديد بالسيرفر', { by: 'البوت', target: `${member.displayName} (${member.id})` });
    setTimeout(() => refreshRegistry(true), 2500);
});

client.on('guildMemberUpdate', async (oldM, newM) => {
    if (!guildRef || newM.guild.id !== guildRef.id) return;
    rememberMember(newM.id, newM);
    const before = oldM.roles.cache.map(r => r.id).sort().join(',');
    const after = newM.roles.cache.map(r => r.id).sort().join(',');
    if (before !== after) {
        setTimeout(() => refreshRegistry(true), 1200);
    }
});

client.on('guildMemberRemove', (member) => {
    if (!guildRef || member.guild.id !== guildRef.id) return;
    addLog('عضو غادر السيرفر', { by: 'البوت', target: `${member.displayName || member.user.username} (${member.id})` });
    const st = officerStore(member.id);
    st.leftAt = Date.now();
    saveDb();
    refreshRegistry(true);
});

client.on('messageCreate', async (message) => {
    if (!guildRef || message.guild?.id !== guildRef.id) return;
    const text = fullMessage(message);

    if (CONFIG.reportChannels.includes(message.channel.id)) {
        if (message.author.bot) return;
        const targetId = extractMention(text, message);
        if (!targetId) return;
        const st = officerStore(targetId);
        if (!st.reports.some(r => r.msgId === message.id)) {
            st.reports.unshift({
                msgId: message.id,
                channelId: message.channel.id,
                channelName: message.channel.name || message.channel.id,
                title: message.channel.name || 'تقرير',
                body: text,
                at: message.createdTimestamp,
                author: message.author.id,
                authorName: message.member?.displayName || message.author.username
            });
            addHistory(targetId, { type: 'report', icon: 'fa-file-lines', title: `تقرير ${message.channel.name || 'MDT'}`, detail: text.slice(0, 140), by: message.member?.displayName || message.author.username });
            saveDb();
            refreshRegistry(true);
        }
    }

    if (CONFIG.hoursChannels.includes(message.channel.id)) {
        const targetId = extractMention(text, message);
        const hours = extractHours(text);
        if (targetId && hours !== null) {
            const st = officerStore(targetId);
            if (hours > (st.hoursAuto || 0)) {
                st.hoursAuto = hours;
                if (st.hours === null || st.hours === undefined) {
                    addHistory(targetId, { type: 'hours', icon: 'fa-clock', title: 'تحديث الساعات', detail: `${hours} ساعة (تلقائي من بوت الساعات)`, by: 'بوت الساعات' });
                }
                saveDb();
                refreshRegistry(true);
            }
        }
    }

    for (const cid of CONFIG.adsChannels) {
        if (message.channel.id !== cid) continue;
        message.mentions.users.forEach(u => {
            const st = officerStore(u.id);
            if (!st.joinedTimestamp || message.createdTimestamp < st.joinedTimestamp) {
                st.joinedTimestamp = message.createdTimestamp;
                addHistory(u.id, { type: 'join', icon: 'fa-door-open', title: 'أول ظهور في روم الإعلانات', detail: 'تاريخ التعيين', by: 'النظام' });
            }
        });
        saveDb();
        refreshRegistry(true);
    }

    // ============ رومات الخصم / النقاط / الترقيات ============
    if (CONFIG.strikeChannels.includes(message.channel.id)) {
        try { handleStrikeMessage(message); } catch (e) { console.warn('strike:', e.message); }
    }
    if (CONFIG.pointsChannels.includes(message.channel.id)) {
        try { handlePointsMessage(message); } catch (e) { console.warn('points:', e.message); }
    }
    if (CONFIG.promotionChannels.includes(message.channel.id)) {
        try { handlePromotionMessage(message); } catch (e) { console.warn('promotion:', e.message); }
    }
});

client.on('error', (e) => { loginError = e.message; console.error('[خطأ البوت]', e.message); });
client.on('shardError', (e) => console.error('[خطأ اتصال]', e.message));

/* ============================================================================
 * 10) التشغيل
 * ==========================================================================*/

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[السيرفر] يعمل على المنفذ ${PORT}`));

if (CONFIG.token) {
    console.log('[تسجيل الدخول] جاري الاتصال بالديسكورد…');
    client.login(CONFIG.token).catch(err => {
        loginError = err.message;
        console.error('==============================================');
        console.error('[فشل تسجيل دخول البوت]:', err.message);
        if (/token/i.test(err.message)) {
            console.error('→ التوكن غلط أو خلصت صلاحيته. سوِّ توكن جديد من Discord Developer Portal');
            console.error('→ وحطه بمتغيّر BOT_TOKEN على السيرفر (تأكد ما فيه مسافات زايدة)');
        }
        if (/intents/i.test(err.message)) {
            console.error('→ شغّل Presence Intent من Developer Portal ثم أعد التشغيل');
        }
        console.error('==============================================');
    });
} else {
    loginError = 'ما في BOT_TOKEN على السيرفر';
    console.log('[تنبيه] ما في BOT_TOKEN — وضع العرض يعمل بدون ديسكورد.');
}

process.on('SIGINT', () => { saveDbNow(); process.exit(0); });
process.on('SIGTERM', () => { saveDbNow(); process.exit(0); });
